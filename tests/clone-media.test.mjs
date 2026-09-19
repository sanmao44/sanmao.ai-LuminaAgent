import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";

const source = await readFile(new URL("../lib/clone/media.ts", import.meta.url), "utf8");

/** 把源码里的单引号字符串字面量还原成运行时真正传给 ffmpeg 的值。 */
function decodeLiteral(literal) {
  const body = literal.slice(1, -1);
  return body.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, escape) => {
    if (escape[0] === "u" || escape[0] === "x") return String.fromCharCode(parseInt(escape.slice(1), 16));
    return { n: "\n", r: "\r", t: "\t", 0: "\0" }[escape] ?? escape;
  });
}

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
    child.once("error", (error) => resolve({ code: -1, stderr: String(error?.message || error) }));
    child.once("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

test("抽帧的 ffmpeg -vf 参数能在真实 ffmpeg 上跑通", async (t) => {
  if (!ffmpegPath || !existsSync(ffmpegPath)) return t.skip("ffmpeg-static 不可用");
  const match = /'-vf',\s*('(?:[^'\\]|\\.)*')/.exec(source);
  assert.ok(match, "lib/clone/media.ts 里应能读到抽帧的 -vf 参数");
  const filter = decodeLiteral(match[1]);
  // scale 表达式里的逗号必须转义，否则 ffmpeg 会把 min(720,iw) 拆成两个过滤器，抽帧全部失败。
  assert.ok(filter.includes("\\,"), `-vf 里的逗号要转义：${filter}`);

  const dir = await mkdtemp(path.join(tmpdir(), "clone-media-"));
  try {
    const clip = path.join(dir, "clip.mp4");
    const generated = await run([ffmpegPath, "-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=15:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
    assert.equal(generated.code, 0, generated.stderr);
    const frame = path.join(dir, "frame.jpg");
    const extracted = await run([ffmpegPath, "-hide_banner", "-loglevel", "error", "-y", "-ss", "0.4", "-i", clip, "-frames:v", "1", "-vf", filter, "-q:v", "4", frame]);
    assert.equal(extracted.code, 0, extracted.stderr);
    assert.ok((await stat(frame)).size > 0, "抽出来的帧不能是空文件");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
