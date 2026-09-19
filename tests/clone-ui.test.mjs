import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const canvas = await readFile(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8");
const dialog = await readFile(new URL("../components/canvas/CanvasCloneDialog.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/clone/jobs/route.ts", import.meta.url), "utf8");
const jobRoute = await readFile(new URL("../app/api/clone/jobs/[id]/route.ts", import.meta.url), "utf8");
const cancelRoute = await readFile(new URL("../app/api/clone/jobs/[id]/cancel/route.ts", import.meta.url), "utf8");
const pipeline = await readFile(new URL("../lib/clone/pipeline.ts", import.meta.url), "utf8");
const store = await readFile(new URL("../lib/clone/store.ts", import.meta.url), "utf8");
const match_types = await readFile(new URL("../lib/types.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/canvas.css", import.meta.url), "utf8");
const storeLib = await readFile(new URL("../lib/store.ts", import.meta.url), "utf8");

test("克隆弹窗是合法 TSX，并且具备三步式傻瓜操作", () => {
  const source = ts.createSourceFile("CanvasCloneDialog.tsx", dialog, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(source.parseDiagnostics ?? [], []);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-label="一键克隆出片"/);
  assert.match(dialog, /选参考视频/);
  assert.match(dialog, /一句话要求/);
  assert.match(dialog, /想做成什么片子/);
  assert.match(dialog, /预计最多 \{maxShots\} 次生图/);
  assert.match(dialog, /超出默认成本闸门/);
  assert.match(dialog, /capability="speech"/);
  // 一个在线配音模型都没配时，弹窗要提示服务端有没有「本机离线配音」兜底。
  assert.match(dialog, /fetch\("\/api\/health", \{ cache: "no-store" \}\)/);
  assert.match(dialog, /本机离线配音，免费，音色偏机械/);
  assert.match(dialog, /list="clone-voice-presets"/);
  assert.match(dialog, /不贴脸、不换脸、不做数字人/);
});

test("克隆弹窗拦住画布的指针事件，避免按钮点不动", () => {
  // 弹窗挂在 document.body 上，但仍是画布 stage 在 React 树里的子节点：
  // 不拦指针事件时画布平移会抢走 pointer capture，按钮收不到 click。
  assert.ok(dialog.includes("onPointerDown={(event) => {"), "backdrop 用函数式 onPointerDown");
  assert.ok(dialog.includes("event.stopPropagation();"), "backdrop 里要 stopPropagation");
  for (const handler of ["onPointerMove", "onPointerUp", "onClick", "onDoubleClick", "onWheel"]) {
    assert.ok(dialog.includes(`${handler}={(event) => event.stopPropagation()}`), handler);
  }
  assert.ok(canvas.includes('className="smart-variant-backdrop"'), "同类弹窗保持同一处理");
  assert.ok(canvas.includes("onPointerDown={(event) => event.stopPropagation()}"), "智能一键变体同款");
});

test("弹窗按真实任务状态轮询并可取消、可放入画布", () => {
  assert.match(dialog, /await fetch\("\/api\/clone\/jobs", \{\s*method: "POST"/);
  assert.match(dialog, /fetch\(`\/api\/clone\/jobs\/\$\{jobId\}`, \{ cache: "no-store" \}\)/);
  assert.match(dialog, /fetch\(`\/api\/clone\/jobs\/\$\{job\.id\}\/cancel`, \{ method: "POST" \}\)/);
  assert.match(dialog, /TERMINAL_STAGES: CloneJob\["stage"\]\[\] = \["done", "failed", "cancelled"\]/);
  assert.match(dialog, /onApply\(job\)/);
  assert.match(dialog, /job\.stage === "done" && readyShots > 0/);
});

test("画布工具栏与创建菜单都能打开克隆弹窗", () => {
  assert.match(canvas, /import CanvasCloneDialog, \{/);
  assert.match(canvas, /className="canvas-soft-button canvas-clone-button"/);
  assert.match(canvas, /✦ 克隆出片/);
  assert.match(canvas, /className="canvas-menu-item canvas-menu-item-clone"/);
  assert.match(canvas, /const \[cloneDialogOpen, setCloneDialogOpen\] = useState\(false\)/);
  assert.match(canvas, /references=\{cloneReferences\}/);
  assert.match(canvas, /preselectedReferenceId=\{preselectedCloneReferenceId\}/);
  assert.match(canvas, /onApply=\{\(job\) => applyCloneJob\(job\)\}/);
});

test("克隆结果落成镜头素材 + 带时间轴的视频编辑节点", () => {
  assert.match(canvas, /const applyCloneJob = useCallback\(/);
  assert.match(canvas, /createVideoEditorNode\(\{ x: originX \+ 1180, y: originY \}\)/);
  assert.match(canvas, /syncCanvasVideoEditorReferences\(next\)/);
  assert.match(canvas, /role: isVideo \? "video" : "reference-image"/);
  assert.match(canvas, /const match = \/\^clone-\(video\|audio\|caption\)-\(\\d\+\)\$\/\.exec\(clip\.id\)/);
  assert.match(canvas, /videoEditor: normalizeVideoEditorState\(\{/);
  assert.match(canvas, /clip\.track === "video"\)\.length} 个镜头/);
});

test("克隆接口创建任务、后台跑管线并暴露进度与取消", () => {
  assert.match(route, /export async function GET\(request: Request\)/);
  assert.match(route, /export async function POST\(request: Request\)/);
  assert.match(route, /beginRuntimeRequest\('clone'\)/);
  assert.match(route, /void runCloneJob\(created\.task\.id\)/);
  assert.match(route, /指定的配音模型不可用/);
  assert.match(route, /offlineSpeech: offlineSpeechSupported\(\)/);
  assert.match(route, /capabilities\.offlineSpeech \? OFFLINE_SPEECH_LABEL : undefined/);
  assert.match(route, /没有可用的生图模型/);
  assert.match(jobRoute, /findCloneJob\(id\)/);
  assert.match(cancelRoute, /cancelRequested: true/);
  assert.match(store, /createTaskStore<CloneJob>\(\{ fileName: 'clone-jobs\.json', maxList: 200 \}\)/);
});

test("管线包含抽帧、拆解、配音、生图、生视频五步与三条降级链", () => {
  assert.match(pipeline, /extractFrameFiles\(/);
  assert.match(pipeline, /probeMediaSeconds\(/);
  assert.match(pipeline, /synthesizeSpeech\(runtime, \{ text: shot\.line, voice: job\.options\.voice \}\)/);
  // 在线 TTS 不可用时用系统自带语音合成，不把「调用不了」留给用户。
  assert.match(pipeline, /synthesizeOfflineSpeech\(shot\.line, \{ voice: job\.options\.voice \}\)/);
  assert.match(pipeline, /const voiceMode: 'model' \| 'offline' \| 'none' = speechRuntime \? 'model' : offlineSpeechSupported\(\) \? 'offline' : 'none';/);
  assert.match(pipeline, /if \(voiceMode !== 'none'\) \{/);
  // 配音落盘必须按服务商真实返回的容器（Gitee 会忽略 response_format 直接回 wav）。
  assert.match(pipeline, /persistAudioBuffer\(audio\.buffer, audio\.contentType\)/);
  assert.match(pipeline, /audioExtension\(audio\.contentType\)/);
  assert.match(pipeline, /generateShotImage\(imageRuntime, started, shot\)/);
  assert.match(pipeline, /createVideoGeneration\(\{ modelId: runtime\.model\.id, input, source: 'canvas' \}\)/);
  assert.match(pipeline, /没有视觉模型/);
  assert.match(pipeline, /const IMAGE_CONCURRENCY = 2;/);
  assert.match(pipeline, /const runningJobs = new Set<string>\(\);/);
  assert.match(pipeline, /if \(runningJobs\.has\(id\)\) return await findCloneJob\(id\);/);
  assert.match(pipeline, /const VIDEO_CONCURRENCY = 1;/);
  assert.match(pipeline, /const VIDEO_RETRY_WAITS_MS = \[30_000, 60_000\];/);
  assert.match(pipeline, /isTransientVideoError\(failure\)/);
  assert.match(pipeline, /clampShotSeconds\(Math\.round\(shot\.audioSeconds \|\| 4\), getVideoModelLimits\(runtime\.model, runtime\.provider\)\)/);
  assert.match(pipeline, /firstFrameTransportReady\(videoRuntime\)/);
  assert.match(pipeline, /useFirstFrame && shot\.imageUrl \? \{ firstFrame: shot\.imageUrl \}/);
  assert.match(pipeline, /退回静态图/);
});

test("模型库把 TTS 归类为配音模型并给出配音能力", () => {
  assert.match(storeLib, /if \(isSpeechModelId\(id\) \|\| inferredKind === 'audio'\) return \{ kind: 'audio', capabilities: \['speech'\] \};/);
  assert.match(storeLib, /!\['chat', 'image', 'video', 'audio'\]\.includes\(selectedKind\)/);
  assert.match(match_types, /export type ModelKind = 'chat' \| 'image' \| 'video' \| 'audio' \| 'unknown';/);
  assert.match(match_types, /\| 'speech'/);
});

test("高级设置里选的模型真的生效，降级都不静默，幂等键不复用旧成片", () => {
  // 用户选的模型要带进任务并被执行层使用，否则高级设置只是摆设。
  assert.match(route, /modelIds: \{/);
  assert.match(pipeline, /resolveSelectedModel\(started\.modelIds\?\.chat/);
  assert.match(pipeline, /当前不可用（可能已停用或删除）/);
  // 视觉拆解失败 / 文案占位 / 配音失败都要留痕，不能静默。
  assert.match(pipeline, /视觉拆解失败（/);
  assert.match(pipeline, /const items = Array\.isArray\(payload\)/);
  assert.match(pipeline, /拆解降级要立刻落库/);
  assert.match(pipeline, /口播暂时用画面拆解描述代替/);
  assert.match(pipeline, /shots = replaceShot\(shots, index, \{ error: message \}\)/);
  assert.match(pipeline, /mergeWarnings\(job\?\.warnings \|\| started\.warnings, failures\)/);
  // 幂等键只挡正在跑的任务：已完成/已取消的旧任务不再占着键，避免第二次点「开始」拿回旧成片。
  assert.match(store, /const CLONE_FINISHED_STAGES: CloneStage\[\] = \['done', 'cancelled'\];/);
  assert.match(store, /delete existing\.idempotencyKey;/);
  assert.match(store, /return store\.mutate\(\(tasks\) => \{/);
  // 弹窗的幂等键带上本次参数：同参数防连点，改了要求就是新任务。
  assert.match(dialog, /function requestKey\(value: string\)/);
  assert.match(dialog, /idempotencyKey: `canvas-clone-\$\{reference\.nodeId\}-\$\{requestKey\(\[/);
});

test("克隆弹窗样式跟随画布主题并且窄屏可用", () => {
  for (const selector of [".clone-backdrop{", ".clone-dialog{", ".clone-reference-card", ".clone-cost", ".clone-shots", ".clone-button.primary", ".clone-progress-track i{"]) {
    assert.ok(styles.includes(selector), selector);
  }
  assert.match(styles, /\.canvas-topbar \.canvas-clone-button::before\{content:"✦"\}/);
  assert.match(styles, /@media\(max-width:720px\)\{\.clone-dialog/);
});