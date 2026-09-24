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
const cloneTypes = await readFile(new URL("../lib/clone/types.ts", import.meta.url), "utf8");
const modelPicker = await readFile(new URL("../components/ModelPicker.tsx", import.meta.url), "utf8");
const workbench = await readFile(new URL("../components/VideoEditorWorkbench.tsx", import.meta.url), "utf8");

test("克隆弹窗是合法 TSX，并且具备三步式傻瓜操作", () => {
  const source = ts.createSourceFile("CanvasCloneDialog.tsx", dialog, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(source.parseDiagnostics ?? [], []);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-label="一键克隆出片"/);
  assert.match(dialog, /选参考图或视频/);
  assert.match(dialog, /一句话要求/);
  assert.match(dialog, /想做成什么片子/);
  assert.match(dialog, /预计最多 \{maxShots\} 次生图/);
  assert.match(dialog, /超出默认成本闸门/);
  assert.match(dialog, /capability="speech"/);
  assert.doesNotMatch(dialog, /<select\b/);
  assert.equal((dialog.match(/<SelectMenu\b/g) || []).length, 4, "克隆弹窗的下拉框统一使用 SelectMenu");
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
  assert.match(dialog, /job\.stage === "done" && \(readyShots > 0 \|\| hasFinalVideo\)/);
});

test("克隆出片只从「创建节点」菜单进入，顶栏和节点「更多」都不放", () => {
  assert.match(canvas, /import CanvasCloneDialog, \{/);
  assert.match(canvas, /className="canvas-menu-item canvas-menu-item-clone"/);
  assert.match(canvas, /<b>克隆出片<\/b>/);
  // 顶栏不挂常驻按钮，视频节点快捷菜单的「更多」里也没有这条：它属于「新建一条流程」，
  // 不属于某个节点的属性操作。
  assert.doesNotMatch(canvas, /canvas-clone-button/);
  assert.doesNotMatch(canvas, /clone-from-video/);
  assert.match(canvas, /const \[cloneDialogOpen, setCloneDialogOpen\] = useState\(false\)/);
  assert.match(canvas, /references=\{cloneReferences\}/);
  assert.match(canvas, /preselectedReferenceId=\{preselectedCloneReferenceId\}/);
  assert.match(canvas, /onApply=\{\(job\) => applyCloneJob\(job\)\}/);
});

test("克隆结果落成镜头素材 + 带时间轴的视频编辑节点", () => {
  assert.match(canvas, /const applyCloneJob = useCallback\(/);
  assert.match(canvas, /createVideoEditorNode\(\{ x: originX \+ 1180, y: originY \}\)/);
  assert.match(canvas, /syncCanvasVideoEditorReferences\(next\)/);
  assert.match(canvas, /connectSource\(node, isVideo \? "video" : "reference-image"\)/);
  assert.match(canvas, /const match = \/\^clone-\(video\|audio\|caption\|graphics\)-\(\\d\+\)\$\/\.exec\(clip\.id\)/);
  assert.match(canvas, /videoEditor: normalizeVideoEditorState\(\{/);
  assert.match(canvas, /clip\.track === "video"\)\.length} 个镜头/);
  assert.match(canvas, /const finalNode = job\.timeline\.finalVideoUrl/);
  assert.match(canvas, /nodes: \[\.\.\.value\.nodes, \.\.\.\(finalNode \? \[finalNode\] : \[\]\), \.\.\.created, editorNode\]/);
});

test("effect events stay editable without requiring a source node", () => {
  assert.match(canvas, /track: "effect"/);
  assert.match(workbench, /id: "effect", label: "动效"/);
  assert.match(workbench, /selectedClip\.track === "effect"/);
  assert.match(workbench, /activeEffects/);
});

test("克隆接口创建任务、后台跑管线并暴露进度与取消", () => {
  assert.match(route, /export async function GET\(request: Request\)/);
  assert.match(route, /export async function POST\(request: Request\)/);
  assert.match(route, /beginRuntimeRequest\('clone'\)/);
  assert.match(route, /void analyzeCloneJob\(created\.task\.id\)/);
  assert.match(route, /指定的配音模型不可用/);
  assert.match(route, /offlineSpeech: offlineSpeechSupported\(\)/);
  assert.match(route, /capabilities\.offlineSpeech \? OFFLINE_SPEECH_LABEL : undefined/);
  assert.match(route, /hasImageModel: Boolean\(imageRuntime\)/);
  assert.match(jobRoute, /findCloneJob\(id\)/);
  assert.match(cancelRoute, /cancelRequested: true/);
  assert.match(store, /createTaskStore<CloneJob>\(\{ fileName: 'clone-jobs\.json', maxList: 200 \}\)/);
  assert.match(route, /参考图或参考视频/);
});

test("克隆自动模型策略主要使用 Seedance，但显式选择其他模型仍保留", () => {
  assert.match(storeLib, /export async function getRuntimeCloneVideoModel/);
  assert.match(storeLib, /const isSeedance = \/seedance\/iu\.test\(name\)/);
  assert.match(storeLib, /if \(id && id !== 'auto'\)/);
  assert.match(modelPicker, /automaticMode\?: 'default' \| 'clone'/);
  assert.match(modelPicker, /克隆主要使用 Seedance/);
  assert.match(dialog, /automaticMode="clone"/);
  assert.match(dialog, /克隆主要使用 Seedance；其他模型可手动选择，能力不匹配时自动回退/);
});

test("编辑器预览会叠加同一时刻的多个 B-roll，而不是只显示最后一个", () => {
  assert.match(workbench, /const activeBrollClips = activeClips\.filter\(\(clip\) => clip\.track === "broll"\)/);
  assert.match(workbench, /activeBrollClips\.map\(\(clip\) =>/);
  assert.match(workbench, /brollVideoRefs = useRef\(new Map<string, HTMLVideoElement>\(\)\)/);
});

test("镜头计划只保存需要的素材，并按本地视频模型能力选择执行策略", () => {
  assert.match(route, /hasReferenceImages: Boolean\(videoRuntime\?\.model\.capabilities\.includes\('video-reference'\)\)/);
  assert.match(route, /hasFirstFrame: Boolean\(videoRuntime\?\.model\.capabilities\.includes\('video-first-frame'\)\)/);
  assert.match(route, /hasReferenceAudio: Boolean\(videoRuntime\?\.model\.capabilities\.includes\('video-audio'\)\)/);
  assert.match(pipeline, /不确定时宁可留空，不要把所有素材分配给每个镜头/);
  assert.match(pipeline, /function fallbackShotAssets\(job: CloneJob, shot: CloneShot\)/);
  assert.match(pipeline, /if \(!assetIds\.length\) return job\.capabilities\.video \? 'text' as const : 'static' as const/);
  assert.match(pipeline, /if \(job\.capabilities\.referenceImages\) return 'reference'/);
  assert.match(pipeline, /if \(job\.capabilities\.firstFrame\) return 'keyframe'/);
  assert.match(pipeline, /shot\.strategy === 'reference' \|\| legacyStrategy/);
  assert.match(pipeline, /shot\.strategy === 'keyframe' \|\| legacyStrategy/);
  assert.match(pipeline, /shot\.speechMode === 'talking' && job\.capabilities\.referenceAudio/);
  assert.match(pipeline, /shot\.strategy === 'reference' \|\| legacyStrategy \|\| Boolean\(shot\.referenceFrameUrl\)/);
  assert.match(pipeline, /shot\.referenceFrameUrl\n\s*\? await cloneImageReferences\(job, shot\)/);
  assert.match(pipeline, /shot\.strategy === 'text' && !shot\.referenceFrameUrl/);
  assert.match(jobRoute, /normalizeShotStrategy\(/);
  assert.match(jobRoute, /validAssetIds\.has\(item\)/);
});

test("分析结果和用户确认会保存可复用 Blueprint，旧任务保持原有首帧链路", () => {
  assert.match(cloneTypes, /export type CloneBlueprint = \{/);
  assert.match(cloneTypes, /blueprint\?: CloneBlueprint;/);
  assert.match(pipeline, /blueprint: \{ version: 1, sourceVideo: job\.reference, assets: job\.assets \|\| \[\], shots: planned/);
  assert.match(jobRoute, /blueprint: latest\.blueprint \? \{ \.\.\.latest\.blueprint, shots, updatedAt: new Date\(\)\.toISOString\(\) \} : undefined/);
  assert.match(pipeline, /const legacyStrategy = !shot\.strategy;/);
  assert.match(pipeline, /executionCapabilities\.firstFrame !== false/);
  assert.match(jobRoute, /preserveReferenceFrame: Boolean\(source\.preserveReferenceFrame \?\? original\.preserveReferenceFrame\)/);
  assert.match(dialog, /className="clone-plan-preserve"/);
});

test("completed jobs can reuse Blueprint for a local re-assembly", () => {
  assert.match(pipeline, /export async function rerenderCloneJob\(/u);
  assert.match(pipeline, /const needsNewImages = started\.shots\.some/u);
  assert.match(pipeline, /async function runCloneReassembly\(id: string\)/u);
  assert.match(pipeline, /assembleCloneVideo\(/u);
  assert.match(pipeline, /void runCloneReassembly\(id\)\.catch/u);
  assert.doesNotMatch(pipeline, /rerenderCloneJob[\s\S]{0,120}void runCloneJob\(id\)\.catch/u);
  assert.match(jobRoute, /action === 'rerender'/u);
  assert.match(jobRoute, /const rawTimeline = body[\s\S]*normalizeVideoEditorState/u);
  assert.match(jobRoute, /rerenderCloneJob\(id, shots, timeline\)/u);
});

test("Blueprint 变体提供计划与本地完整 MP4 合成入口", () => {
  assert.match(jobRoute, /action === 'variant-plan'/u);
  assert.match(jobRoute, /action === 'variant-render'/u);
  assert.match(jobRoute, /action === 'variant-render-batch'/u);
  assert.match(jobRoute, /renderBlueprintVariants\(id, variants\)/u);
  assert.match(pipeline, /export async function renderBlueprintVariant\(/u);
  assert.match(pipeline, /export async function renderBlueprintVariants\(/u);
  assert.match(pipeline, /generationShotIndexes\.length \|\| plan\.voiceShotIndexes\.length/u);
  assert.match(pipeline, /renderVariantMedia\(/u);
  assert.match(pipeline, /renderVariantVoice\(/u);
  assert.match(pipeline, /补生成/u);
  assert.match(dialog, /Blueprint 组件变体/u);
  assert.match(dialog, /action: "variant-plan"/u);
  assert.match(dialog, /action: "variant-render"/u);
  assert.match(dialog, /action: "variant-render-batch"/u);
  assert.match(dialog, /variantBatchText/u);
  assert.match(dialog, /variantSpecs\.find\(\(item\) => item\.id === plan\.id\)/u);
  assert.match(dialog, /合成完整 MP4/u);
  assert.match(styles, /\.clone-variant-panel\{/u);
});

test("管线包含抽帧、拆解、配音、生图、生视频五步与三条降级链", () => {
  assert.match(pipeline, /extractFrameFiles\(/);
  assert.match(pipeline, /referenceEvidenceSampleTimes\(duration, scene\.times, beatResult\.beats, referenceTranscript\)/);
  assert.match(pipeline, /evidenceForFrameTimes\(extracted\.times, evidence\)/);
  assert.match(pipeline, /evidence:\s*frames\.evidence/);
  assert.match(pipeline, /取证原因来自本地分析/);
  // 参考视频必须和 /api/storage/video 用同一套解析（回退历史目录），否则旧素材会解析成不存在的路径。
  assert.match(pipeline, /resolveStoredVideoFileWithFallback\(state\.settings\.videoStoragePath \|\| '', name\)/);
  assert.match(pipeline, /if \(!file \|\| !existsSync\(file\)\) throw new Error\('参考素材已不在本地存储里/);
  // 抽帧失败要把 ffmpeg 的真实报错带进降级提示，否则「没拆出画面」无从排查。
  assert.match(pipeline, /const reason = frames\.error \|\| \(frames\.files\.length \? '抽出来的帧读不出来' : '没有抽到帧'\)/);
  assert.match(pipeline, /参考素材拆解不了（/);
  assert.match(pipeline, /prepareImageFrame\(/);
  assert.match(pipeline, /job\.reference\.kind === 'image'[\s\S]{0,120}transcript: null/);
  assert.match(pipeline, /job\.reference\.kind === 'image'[\s\S]{0,180}times: \[\], error: ''/);
  assert.match(pipeline, /job\.reference\.kind === 'image'\n\s*\? \[\{ start: 0, end: round3\(durationSeconds\)/);
  assert.match(pipeline, /probeMediaSeconds\(/);
  assert.match(pipeline, /synthesizeSpeech\(runtime, \{ text: shot\.line, voice: job\.options\.voice \}\)/);
  // 在线 TTS 不可用时用系统自带语音合成，不把「调用不了」留给用户。
  assert.match(pipeline, /synthesizeOfflineSpeech\(shot\.line, \{ voice: job\.options\.voice \}\)/);
  assert.match(pipeline, /const voiceMode: 'model' \| 'offline' \| 'none' = speechRuntime \? 'model' : offlineSpeechSupported\(\) \? 'offline' : 'none';/);
  assert.match(pipeline, /if \(voiceMode !== 'none'\) \{/);
  // 配音落盘必须按服务商真实返回的容器（Gitee 会忽略 response_format 直接回 wav）。
  assert.match(pipeline, /persistAudioBuffer\(audio\.buffer, audio\.contentType\)/);
  assert.match(pipeline, /audioExtension\(audio\.contentType\)/);
  assert.match(pipeline, /generateShotImage\(imageRuntime, executionJob, shot\)/);
  assert.match(pipeline, /cloneShotDirection\(shot, job\.options\.brief\)/);
  assert.match(pipeline, /prompt: `\$\{cloneShotDirection\(shot, job\.options\.brief\)\}/);
  assert.match(pipeline, /referenceVideos = referenceVideo \? \[referenceVideo\] : \[\]/);
  assert.match(pipeline, /async function ensureReferenceVideoUrl\(job: CloneJob, shot: CloneShot, referenceFile: string\)/);
  assert.match(pipeline, /referenceVideoUrl: stored\.url/);
  assert.match(pipeline, /referenceVideo = await referenceVideoDataUrl\(shot\.referenceVideoUrl\) \|\| undefined/);
  assert.match(pipeline, /Backfill reusable source windows for older Blueprints/);
  assert.match(pipeline, /response\.headers\.get\('content-length'\)/);
  assert.match(pipeline, /shots = alignShotsWithLines\(merged, scriptLines, \{ preserveShotStructure: true \}\)/);
  assert.match(pipeline, /const resumed = Boolean\(started\.planConfirmed && started\.shots\.length\)/);
  assert.match(pipeline, /const visualBible = await analyzeVisualBible\(chatPick\.value, await frameDataUrls\(frames\.files\), plannedWithFrames, job\)/);
  assert.match(pipeline, /referenceAnalysis,[\s\S]*blueprint: \{ version: 1, sourceVideo: job\.reference, assets: job\.assets \|\| \[\], shots: plannedWithFrames, visualBible/);
  assert.match(pipeline, /const existingVisualBible = executionJob\.blueprint\?\.visualBible \|\| executionJob\.referenceAnalysis\?\.visualBible/);
  assert.match(pipeline, /const nextReferenceAnalysis = referenceAnalysis/);
  assert.match(pipeline, /const nextBlueprint = blueprint/);
  assert.match(pipeline, /return parts\.length \? `；\$\{parts\.join\('；'\)\}` : ''/);
  assert.match(pipeline, /transcribeLocalAudio\(extracted, seconds \|\| Math\.max\(1, shot\.end - shot\.start\)\)/);
  assert.match(pipeline, /audioWords: voice\.words/);
  assert.match(pipeline, /createVideoGeneration\(\{ modelId: runtime\.model\.id, input, source: 'canvas' \}\)/);
  assert.match(pipeline, /没有视觉模型/);
  assert.match(pipeline, /const IMAGE_CONCURRENCY = 2;/);
  assert.match(pipeline, /const runningJobs = new Set<string>\(\);/);
  assert.match(pipeline, /if \(runningJobs\.has\(id\)\) return await findCloneJob\(id\);/);
  assert.match(pipeline, /const VIDEO_CONCURRENCY = 1;/);
  assert.match(pipeline, /const VIDEO_RETRY_WAITS_MS = \[30_000, 60_000\];/);
  assert.match(pipeline, /isTransientVideoError\(failure\)/);
  assert.match(pipeline, /clampShotSeconds\(Math\.round\(requestedSeconds\), getVideoModelLimits\(runtime\.model, runtime\.provider\)\)/);
  assert.match(pipeline, /firstFrameTransportReady\(videoRuntime\)/);
  assert.match(pipeline, /useKeyframe && useFirstFrame && \(shot\.imageUrl \|\| shot\.referenceFrameUrl\)/);
  assert.match(pipeline, /firstFrame: shot\.imageUrl \|\| shot\.referenceFrameUrl/);
  assert.match(pipeline, /退回静态图/);
  assert.match(pipeline, /普通镜头已保留参考帧静态出片/);
  assert.match(pipeline, /const canCarryReferenceFrame = useFirstFrame \|\| executionCapabilities\.referenceVideo \|\| executionCapabilities\.referenceImages/);
  assert.match(pipeline, /fallbackShotToReferenceFrame/);
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
  assert.match(pipeline, /mergeWarnings\(job\?\.warnings \|\| started\.warnings, voiceWarnings\)/);
  // 幂等键只挡正在跑的任务：已完成/已取消的旧任务不再占着键，避免第二次点「开始」拿回旧成片。
  assert.match(store, /const CLONE_FINISHED_STAGES: CloneStage\[\] = \['done', 'cancelled'\];/);
  assert.match(store, /delete existing\.idempotencyKey;/);
  assert.match(store, /return store\.mutate\(\(tasks\) => \{/);
  // 弹窗的幂等键带上本次参数：同参数防连点，改了要求就是新任务。
  assert.match(dialog, /function requestKey\(value: string\)/);
  assert.match(dialog, /idempotencyKey: `canvas-clone-\$\{reference\.nodeId\}-\$\{requestKey\(\[/);
});

test("克隆弹窗样式跟随画布主题并且窄屏可用", () => {
  for (const selector of [".clone-backdrop{", ".clone-dialog{", ".clone-reference-card", ".clone-cost", ".clone-shots", ".clone-button.primary", ".clone-progress-track i{", ".clone-reference-stack{", ".clone-import-row{", ".canvas-clone-chip{", ".canvas-clone-chip em{"]) {
    assert.ok(styles.includes(selector), selector);
  }
  assert.match(styles, /\.canvas-clone-chip span\{flex:none/);
  // 弹窗里的模型选择器必须抬到 .clone-backdrop 之上：默认 300 会被 560 的遮罩压住，点开什么都看不到。
  assert.match(dialog, /import \{ CANVAS_Z_INDEX \} from "@\/lib\/canvas\/layers"/);
  const pickers = dialog.match(/portalZIndex=\{CANVAS_Z_INDEX\.modalPopover\}/g) || [];
  assert.equal(pickers.length, 8, "四枚模型选择器和四枚克隆下拉都要显式给 z-index");
  assert.match(dialog, /dialogPortalZIndex=\{CANVAS_Z_INDEX\.modalPopover\}/);
  assert.match(styles, /@media\(max-width:720px\)\{\.clone-dialog/);
  assert.match(styles, /\.clone-asset-row \.select-menu-trigger/);
  assert.match(styles, /\.clone-plan-controls \.select-menu-trigger/);
  assert.match(styles, /\.clone-plan-body\{flex:1;min-height:0\}/);
  assert.match(styles, /\.clone-plan-actions\{position:sticky;bottom:0;/);
  assert.doesNotMatch(styles, /\.clone-plan-actions\{position:sticky;bottom:-/);
});

test("新任务完成后优先提供单个最终成片，而不是要求镜头必须存在", () => {
  assert.match(dialog, /const hasFinalVideo = Boolean\(job\?\.timeline\.finalVideoUrl\)/);
  assert.match(dialog, /job\.stage === "done" && \(readyShots > 0 \|\| hasFinalVideo\)/);
  assert.match(canvas, /完整 MP4 是直接交付物；下面继续建立一个可编辑的多轨工程/);
  assert.match(canvas, /const finalNode = job\.timeline\.finalVideoUrl/);
  assert.match(canvas, /完整成片与可编辑工程/);
});

test("关掉弹窗不等于任务丢了：重开接回任务、失败可续跑、成片只放一次", () => {
  // 打开弹窗先看有没有没跑完 / 没放进画布的任务，有就直接接回来接着显示。
  assert.match(dialog, /const \[restoring, setRestoring\] = useState\(true\)/);
  assert.match(dialog, /await fetch\("\/api\/clone\/jobs", \{ cache: "no-store" \}\)/);
  assert.match(dialog, /if \(item\.appliedAt\) return false;/);
  // 失败任务只在 24 小时内自动接回：陈年失败任务否则会永远顶掉向导。
  assert.match(dialog, /const RESTORE_FAILED_WINDOW_MS = 24 \* 60 \* 60 \* 1000;/);
  assert.match(dialog, /Date\.now\(\) - stamp < RESTORE_FAILED_WINDOW_MS/);
  // 用户从画布某条视频点名进来时，不让旧任务顶掉他刚选的参考素材。
  assert.match(dialog, /if \(preselectedReferenceId\) \{/);
  assert.match(canvas, /return selectedVideos\.length === 1 \? selectedVideos\[0\] : null;/);
  // 「重新设置」等于明确放弃这条任务，标记已处理后重开弹窗不再拿它来问。
  assert.match(dialog, /markHandled\(\); setJob\(null\); setApplied\(false\)/);
  assert.match(dialog, /function markHandled\(\)/);
  assert.match(dialog, /正在读取最近的克隆任务/);
  // 关弹窗时讲清楚任务还在跑，免得用户以为白跑一趟。
  assert.match(dialog, /克隆任务在后台继续跑，重开「克隆出片」可查看进度或放入画布/);
  assert.match(dialog, /function closeDialog\(\)/);
  // 放进画布要落一个「已应用」标记，否则重开弹窗会把同一份成片再落一遍节点。
  assert.match(dialog, /body: JSON\.stringify\(\{ action: "applied" \}\)/);
  assert.match(jobRoute, /action === 'applied'/);
  assert.match(jobRoute, /appliedAt: job\.appliedAt \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(cloneTypes, /appliedAt\?: string;/);
  assert.match(store, /appliedAt: job\.appliedAt,/);
  // 失败任务给一个显式的「继续任务」，而不是让用户靠「再点一次开始」去赌幂等键。
  assert.match(dialog, /action: "resume" \}\)/);
  assert.match(dialog, /沿用这条任务接着跑/);
  assert.match(jobRoute, /if \(action !== 'resume'\)/);
  assert.match(jobRoute, /void runCloneJob\(id\)/);
});

test("拆解轨道自动优先带视觉的模型，不再被默认纯文本模型拖成等间隔切分", () => {
  assert.match(storeLib, /export async function getRuntimeVisionModel\(id: string \| null \| undefined\)/);
  assert.match(storeLib, /const visionModels = compatible\.filter\(\(item\) => item\.capabilities\.includes\('vision'\)\);/);
  assert.match(route, /getRuntimeVisionModel\(body\.chatModel \|\| null\)/);
  assert.match(pipeline, /resolveSelectedModel\(started\.modelIds\?\.chat, '对话 \/ 拆解模型', \(id\) => getRuntimeVisionModel\(id\)\)/);
  // 高级设置里的拆解模型按「视觉」筛，和服务端实际执行口径一致。
  assert.match(dialog, /<span>拆解模型（需要视觉）<\/span>/);
  assert.match(dialog, /models=\{models\} capability="vision" value=\{selectedModels\.chat\}/);
});

test("参考素材可以在弹窗里直接导入，成片落盘后清掉任务临时目录", () => {
  assert.match(dialog, /onImportReference\?: \(\) => void;/);
  assert.match(dialog, /＋ 导入参考素材/);
  assert.match(dialog, /＋ 导入新的参考素材/);
  assert.match(canvas, /onImportReference=\{\(\) => openFilePicker\(screenToWorld/);
  // 参考视频副本 / 抽帧 / 配音探测文件在成片落盘后没有保留价值，不清就会一直堆着。
  assert.match(pipeline, /export async function cleanupCloneJobDirectory\(id: string\)/);
  assert.match(pipeline, /await cleanupCloneJobDirectory\(id\);/);
  assert.match(pipeline, /if \(!relative \|\| relative\.startsWith\('\.\.'\) \|\| path\.isAbsolute\(relative\)\) return;/);
  // 一句话要求可能很长，节点名只留开头。
  assert.match(canvas, /\(job\.options\.brief \|\| job\.reference\.name \|\| "未命名"\)\.slice\(0, 24\)/);
});
test("没有对话模型也能出片：降级为纯画面，成片超长不静默", () => {
  // 弹窗先把「文案只能靠对话模型」摆出来，用户才知道缺什么。
  assert.match(dialog, /文案与字幕：\{flags\.hasChatModel \? "可用" : "缺对话模型，成片只有画面"\}/);
  // 没有对话模型不再整条失败，降级成「只有画面」的成片。
  assert.doesNotMatch(pipeline, /throw new Error\('文案生成失败/);
  assert.match(pipeline, /本次成片只有画面，没有配音与字幕/);
  // 成片时长按配音实际长度排，超过设置上限要提示而不是默默出片。
  assert.match(pipeline, /秒超过设置的参考上限/);
  // 阶段进度统一取 plan 的常量，避免两处手写数字漂移。
  assert.match(pipeline, /progress: cloneStageProgress\('analyzing'\)/);
  assert.match(pipeline, /progress: round3\(cloneStageProgress\('imaging'\) \+ 0\.26/);
  assert.doesNotMatch(pipeline, /progress: 0\.(08|2|3|42|68|94)/);
  // 离线配音真实用到的音色会回传，并在替换掉用户填的音色时说清楚。
  assert.match(pipeline, /voice: audio\.voice/);
  assert.match(pipeline, /本机离线配音没有「/);
});

test("克隆进度挂在画布右上角状态胶囊上，跑完/失败提示一次", () => {
  assert.match(canvas, /const \[cloneTask, setCloneTask\] = useState/);
  assert.match(canvas, /className="canvas-status-chip canvas-clone-chip"/);
  assert.match(canvas, /title={`克隆出片进行中：\$\{cloneTask\.message/);
  assert.match(canvas, /onClick=\{\(event\) => \{\s*\n\s*event\.stopPropagation\(\);\s*\n\s*setCloneDialogOpen\(true\);\s*\n\s*\}\}/);
  // 画布 stage 会在 pointerdown 时 setPointerCapture，把 click 抢走；胶囊必须列进
  // 「自己处理指针事件」的浮层清单里，否则点它不会有反应。
  assert.match(canvas, /\.canvas-context-menu,\.canvas-status-chip,/);
  assert.match(canvas, /!\["planned", "done", "failed", "cancelled"\]\.includes\(job\.stage\)/);
  assert.match(canvas, /克隆出片已完成（\$\{finished\.shotCount \|\| 0\} 个镜头）/);
  assert.match(canvas, /克隆出片失败：\$\{finished\.message/);
  assert.match(canvas, /window\.setInterval\(\(\) => void tick\(\), 5000\)/);
  // 隐藏的标签页不轮询；动画跟随项目的 reduced-motion 约定。
  assert.match(canvas, /if \(window\.document\.hidden\) return;/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)\{html:not\(\[data-motion="on"\]\) \.canvas-clone-chip span\{animation:none\}\}/);
});

test("克隆任务在等不回来时自愈成可续跑，而不是永远卡在旧阶段", () => {
  // 三个文件在文件顶部已经读过：pipeline / route / store。
  // 等服务商出片时的静默期必须续心跳，否则 10 分钟没更新就会被判定成中断。
  assert.match(pipeline, /const HEARTBEAT_INTERVAL_MS = 60 \* 1000;/);
  assert.match(pipeline, /await touchCloneJob\(job\.id\);/);
  // 自愈入口挂在画布每 5 秒轮询的列表接口上；正在跑的任务不能被误伤。
  assert.match(pipeline, /export async function reapStaleCloneJobs\(\)/);
  assert.match(pipeline, /isCloneJobStale\(job\) && !runningJobs\.has\(job\.id\)/);
  assert.match(pipeline, /已经生成好的配音和镜头不会重做/);
  assert.match(route, /await reapStaleCloneJobs\(\);/);
  assert.match(store, /export async function touchCloneJob\(id: string\)/);
});
test("视频节点的「更多」只放这个节点自己的操作，成片入口在创建菜单", () => {
  const at = canvas.indexOf("id: \"video-tools\"");
  assert.ok(at > 0, "video-tools menu group missing");
  const group = canvas.slice(at, at + 600);
  assert.ok(group.includes("depth-video"), "深度图节点应留在「更多」里");
  assert.ok(!group.includes("clone-from-video"));
  // 成片好了之后，靠提示把用户指回创建菜单，弹窗自己会接回这条任务。
  assert.match(canvas, /双击画布空白处打开「创建节点 → 克隆出片」/);
  // 用户明确选中一条视频时仍然自动预选，弹窗因此跳过旧任务接回直接进第二步。
  assert.match(canvas, /const selectedVideos = \[\.\.\.selectedIds\]\.filter/);
  assert.match(canvas, /return selectedVideos\.length === 1 \? selectedVideos\[0\] : null;/);
});

test("任务可以删除：弹窗有删除入口，DELETE 路由先取消再清记录", () => {
  // 缺口：出片了不想要、失败或取消的任务会一直顶在弹窗里，原来没有任何删除入口。
  assert.match(jobRoute, /export async function DELETE\(request: Request, context/);
  assert.match(jobRoute, /removeCloneJob\(id\)/);
  assert.match(jobRoute, /cleanupCloneJobDirectory\(id\)/);
  // 还在跑的任务要先标记取消，否则管线会继续烧生图、生视频。
  assert.match(jobRoute, /cancelRequested: true/);
  assert.match(store, /export async function removeCloneJob\(id: string\)/);
  assert.match(dialog, /className="clone-button danger" onClick=\{removeJob\}/);
  assert.match(dialog, /method: "DELETE"/);
  assert.match(dialog, /const \[deleting, setDeleting\] = useState\(false\);/);
  assert.match(styles, /\.clone-button\.danger\{/);
});

test("删除运行中的任务不会留下任务目录残留", () => {
  // 实测：DELETE 之后管线还会 mkdir 一次，不在取消收尾里清目录就会漏下参考视频副本与抽帧。
  assert.match(pipeline, /async function finishCancelled\(id: string\)/);
  assert.match(pipeline, /await cleanupCloneJobDirectory\(id\)/);
  // 三条取消出口都要走同一个收尾，不能只改一处。
  assert.equal(pipeline.split('return await finishCancelled(id);').length - 1, 3);
  assert.ok(!pipeline.includes('isCancelled(id)) return await patchJob('), "不再散落内联取消写法");
});
