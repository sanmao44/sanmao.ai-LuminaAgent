import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTsRequire } from "./ts-require.mjs";

const ImageCard = createTsRequire(process.cwd())("./components/ImageCard").default;
const Icon = ({ name }) => createElement("i", { "data-icon": name });

const item = {
  id: "image-1",
  url: "https://example.com/image.png",
  prompt: "A quiet studio",
  source: "generate",
  createdAt: 1_735_000_000_000,
  favorite: false,
  modelName: "image-model",
  references: [{ id: "ref-1", name: "brief.txt", url: "", kind: "text", text: "warm light" }],
};

test("image card renders history metadata, references, and page-owned actions", () => {
  const markup = renderToStaticMarkup(createElement(ImageCard, {
    item,
    Icon,
    sourceLabel: (source) => source === "generate" ? "直接生成" : source,
    onEdit: () => {},
    onReuse: () => {},
    onReference: () => {},
    onDownload: () => {},
    onFavorite: () => {},
    onDelete: () => {},
    onOpenAngle: () => {},
    onOpenOutpaint: () => {},
  }));
  assert.match(markup, /image-card/);
  assert.match(markup, /A quiet studio/);
  assert.match(markup, /reference-text-thumb/);
  assert.match(markup, /直接生成/);
  assert.match(markup, /修改/);
  assert.match(markup, /参考图/);
});

test("image card keeps selection presentation separate from preview", () => {
  const markup = renderToStaticMarkup(createElement(ImageCard, {
    item,
    Icon,
    selected: true,
    selectionMode: true,
    sourceLabel: () => "直接生成",
    onSelect: () => {},
    onPreview: () => {},
  }));
  assert.match(markup, /select-mark checked/);
  assert.match(markup, /data-icon="check"/);
});
