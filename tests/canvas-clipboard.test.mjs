import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadClipboard() {
  const sourceUrl = new URL("../lib/canvas/clipboard.ts", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const clipboard = await loadClipboard();

test("copies a canvas image as PNG through the system clipboard", async () => {
  const originalFetch = globalThis.fetch;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ClipboardItem");
  let written;

  class MockClipboardItem {
    constructor(data) {
      this.data = data;
    }
  }

  try {
    globalThis.fetch = async () => ({
      ok: true,
      async blob() {
        return new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
      },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { write: async (items) => { written = items; } } },
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: MockClipboardItem,
    });

    await clipboard.copyCanvasImageToClipboard("/api/storage/file?name=image.png");
    assert.equal(written.length, 1);
    assert.equal(written[0].data["image/png"].type, "image/png");
  } finally {
    globalThis.fetch = originalFetch;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
    if (clipboardItemDescriptor) Object.defineProperty(globalThis, "ClipboardItem", clipboardItemDescriptor);
    else delete globalThis.ClipboardItem;
  }
});

test("reports unsupported image clipboard APIs instead of copying a URL", async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ClipboardItem");
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText: async () => {} } },
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: undefined,
    });
    await assert.rejects(
      clipboard.copyCanvasImageToClipboard("/image.png"),
      /不支持复制图片/,
    );
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
    if (clipboardItemDescriptor) Object.defineProperty(globalThis, "ClipboardItem", clipboardItemDescriptor);
    else delete globalThis.ClipboardItem;
  }
});
