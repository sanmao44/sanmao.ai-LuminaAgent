# PLANS.md 鈥?SANMAO.AI 鏋舵瀯婕旇繘鎵ц璁″垝

> **褰撳墠鐘舵€侊紙2026-10-02锛?*锛欳anvas Document銆丠istory銆丼election 宸茬敱 CanvasCore 瀹屾垚 authority cutover锛涘叏鍩?Legacy removal 浠嶆湭瀹屾垚銆傚悇棰嗗煙鐪熷疄璋冪敤閾俱€佸弻杞ㄧ姸鎬併€佺粫杩囩偣鍜屽垹闄ゆ潯浠惰 [`docs/next-architecture/migration-status.md`](docs/next-architecture/migration-status.md)銆?

> **褰撳墠浠诲姟锛?026-10-03锛夛細Data Cutover Closure 宸插畬鎴愬疄鐜板苟閫氳繃 targeted/full verification锛汸hysical Architecture / Remaining Migration / Legacy Purge 澶勪簬 migration in progress銆?* SQLite logical authoritative cutover 宸插畬鎴愶紝浣?legacy database compatibility/removal 浠嶅湪杩佺Щ锛汸art B 鍙兘娌跨湡瀹?ownership seam 鎺ㄨ繘锛屼笉鍒涘缓绌虹殑 apps 鐩綍鎴栧鍒?God File銆?

## 褰撳墠闃舵鐘舵€?

| 闃舵 | 鐘舵€?| 璇存槑 |
| --- | --- | --- |
| Phase 1 Agent Runtime | migration in progress | Compact non-streaming text path uses `packages/agent-core` through `apps/api/agent-entry.ts`; provider-neutral SSE adaptation uses `apps/api/agent-stream.ts`; The Route owns auth/transport; `apps/api/agent-application.ts` now owns capability and execution orchestration while further domain extraction remains. |
| Phase 2 Test Decoupling | migration in progress | Tool/MCP behavior is covered; remaining Agent/UI/Route source-coupled assertions migrate by domain. |
| Phase 3 Storage Boundary | migration in progress | Session, workspace gallery, asset collections, provider state, server workspace, MCP configuration, video/upscale, clone and progress use repository adapters; UI preferences, artifact/media and legacy storage internals remain. |
| Phase 4 Task Runtime | migration in progress | State, polling and cancellation/retry decisions reuse Runtime; Clone, Video and Upscale submission/reconciliation cross `apps/worker/task-entry.ts`; cancel/retry/removal/local-save control crosses `apps/worker/task-control.ts` with shared lifecycle instrumentation, while provider polling and family-specific persistence remain specialized. |
| Phase 5 Provider Runtime | migration in progress | Text invocation, bounded failover, streaming response deadlines and image/edit compatibility fallback use `packages/model-runtime`; `agent-invoker.ts` adapts application calls to the coordinator and health persistence crosses `ProviderHealthPort`; provider transport, health persistence implementation and video branches remain injected legacy adapters. |
| Phase 6 Tool Runtime | migration in progress | packages/tool-runtime owns policy, resolution, dispatch, execution, loop and MCP executor; Web/File/Canvas capability ports are active, while `apps/api/agent-application.ts` still supplies artifact/image/skill compatibility bindings to the migration adapter. |
| Phase 7 Canvas Core | cutover completed | CanvasCore 宸叉垚涓?Document銆丠istory銆丼election 鐨勫敮涓€ authority锛汼uperCanvas 鍙繚鐣?projection銆乬esture銆乸ersistence 涓?UI adapter銆?|
| Phase 8 UI cleanup | migration in progress | Shell, sidebar and Agent presentation are extracted; app/page.tsx remains composition/state owner. |
| Data Architecture Gate 1 | cutover completed | Server business data crosses repository/port boundaries; client IndexedDB/localStorage and blob adapters remain bounded compatibility owners. |
| Backup / Restore Hardening | cutover completed | Restore uses multi-root staged rollback transactions; archive schema v1 and canonical `client/client.json` are enforced; HTTP and legacy JSON restore use the transaction boundary, browser IndexedDB restore captures and rolls back the current repository snapshot, and HTTP export/archive/encryption plus upload/decryption/tar extraction are disk/stream based, while local snapshots retain compatibility Buffer APIs. |
| Database Cutover | cutover completed | SQLite (`node:sqlite`) is the local authoritative adapter. `npm run migrate:database` stages, validates, activates and records rollback sources; legacy JSON is migration/rollback only. |
| Round 7 Architecture Audit | cutover completed | Migration matrix established from real call paths. |
| Round 8 Agent / Tool / MCP test seam | cutover completed | Tool/MCP behavior is covered by real Runtime/MCP executor paths; remaining source assertions migrate by domain. |

鍚庣画鎵ц閬靛惊绾靛悜鍒囩墖鍘熷垯锛氬厛琛ヨ涓鸿鐩栵紝鍐嶆敹鏁涗竴涓竟鐣岋紱涓嶅洜瀹¤缁撹璺宠繃 Tool Runtime 鎴栨彁鍓嶅垹闄?Legacy銆?

## 0. Purpose

鏈枃浠跺畾涔夊綋鍓嶆灦鏋勬紨杩涚殑鏂藉伐椤哄簭銆?

鍘熷垯锛?

**涓嶅仛鈥滃ぇ鐖嗙偢寮忛噸鍐欌€濓紝閲囩敤鍙繍琛岀殑绾靛悜鍒囩墖閫愭鏇挎崲銆?*

姣忎竴涓?Phase 蹇呴』鐙珛鍙獙璇併€?

---

# Phase 0 鈥?寤虹珛娌荤悊鍩虹嚎

## 鐩爣

璁╂墍鏈夊悗缁?Coding Agent 閮介伒瀹堝悓涓€濂楄鍒欍€?

## Deliverables

- [x] `AGENTS.md`
- [x] `ARCHITECTURE.md`
- [x] `PLANS.md`
- [x] 纭 `WORKFLOW.md` 浠嶄负鍙戝竷娴佺▼鍞竴浜嬪疄鏉ユ簮
- [x] 寤虹珛 `docs/next-architecture/`
- [ ] 寤虹珛 Architecture Decision Record 鐩綍锛堝彲閫夛級

## 瀹屾垚鏍囧噯

鏈潵 Agent 寮€濮嬩换鍔″墠鍙互鏄庣‘鐭ラ亾锛?
- 褰撳墠鐩爣鏋舵瀯
- Legacy 杈圭晫
- 鍝簺瑙勫垯涓嶅彲鐮村潖
- 褰撳墠姝ｅ湪鏂藉伐鍝竴闃舵

---

# Phase 1 鈥?Agent Runtime Vertical Slice

## 鐩爣

璇佹槑鈥滃湪鏃?SANMAO 鍐呴噸鍐欐柊鏍稿績鈥濆彲琛屻€?

绗竴闃舵涓嶈姹傞噸鍐欐暣涓?Agent銆?

鍙缓绔嬩竴涓渶灏忋€佺湡瀹炪€佸彲杩愯鐨勬柊 Agent Runtime锛屽苟璁╄嚦灏戜竴鏉＄幇鏈夎姹傝矾寰勭粡杩囧畠銆?

## 鍏堢爺绌?

蹇呴』闃呰锛?

- `app/api/agent/route.ts`
- `lib/agent/**`
- `lib/agent-*`
- `lib/tools/**`
- `lib/mcp/**`
- Provider 鐩稿叧浠ｇ爜
- Agent 鐩稿叧娴嬭瘯

涓嶈鏃犵洰鐨勬壂鎻忔暣涓粨搴撱€?

## Deliverables

### 1. Architecture Assessment

鍒涘缓锛?

```text
docs/next-architecture/agent-runtime.md
```

蹇呴』鎻忚堪锛?

- 褰撳墠 Agent 璇锋眰鐢熷懡鍛ㄦ湡
- `app/api/agent/route.ts` 褰撳墠鑱岃矗
- 宸插瓨鍦ㄤ笖鍊煎緱淇濈暀鐨勬ā鍧?
- 鐪熸鑰﹀悎鐐?
- Target Architecture
- Migration Boundary

### 2. Contracts

寤虹珛鏈€灏忓繀瑕?Contract锛?

- AgentRun
- AgentRunId
- AgentRunState
- AgentEvent
- AgentRequest
- AgentResult
- ModelRuntime / ModelProvider
- ModelDescriptor
- ModelCapabilities
- ToolRuntime
- ToolDefinition
- ToolCall
- ToolResult
- ContextBuilder
- PolicyDecision

涓嶈杩囧害璁捐銆?

### 3. Minimal Runtime

瀹炵幇鏈€灏?Agent Runtime銆?

瑕佹眰锛?
- 鍙劚绂?HTTP 鐙珛娴嬭瘯
- 涓嶄緷璧?Next Route
- 涓嶄緷璧?MCP SDK
- 涓嶄緷璧栧叿浣?Provider SDK
- 涓嶄緷璧栨暟鎹簱瀹炵幇

### 4. Existing Path Integration

鑷冲皯閫変竴鏉″凡鏈?Agent 鎵ц璺緞閫氳繃鏂?Runtime銆?

涓嶈姹備竴娆¤縼绉绘墍鏈?Tool / Provider / Canvas 琛屼负銆?

### 5. Tests

鏂板琛屼负娴嬭瘯銆?

绂佹鏂板婧愮爜瀛楃涓叉祴璇曘€?

## 瀹屾垚鏍囧噯

- [x] `docs/next-architecture/agent-runtime.md`
- [x] 鏈€灏?Contract
- [x] 鏈€灏?Runtime
- [x] 涓€鏉＄湡瀹炶矾寰勬帴鍏?
- [x] 琛屼负娴嬭瘯
- [x] typecheck 閫氳繃
- [x] 鐩稿叧 tests 閫氳繃
- [x] 鏃?Agent API 浠嶅伐浣?
- [x] 鏄庣‘鍒楀嚭灏氭湭杩佺Щ鑱岃矗

> Phase 1 鐨勨€滃畬鎴愨€濇寚鏈€灏忕旱鍚戝垏鐗囧畬鎴愶紱瀹冧笉琛ㄧず Route銆乀ool銆丼treaming 鎴?Provider 鍏ㄩ潰杩佺Щ銆傚叏鍩熻縼绉荤姸鎬佽 `docs/next-architecture/migration-status.md`銆?

---

# Phase 2 鈥?Test Decoupling

## 鐩爣

瑙ｉ櫎婧愮爜缁撴瀯瀵归噸鏋勭殑閿佹銆?

浼樺厛澶勭悊锛?
- `SuperCanvas.tsx`
- `app/page.tsx`

鐩稿叧婧愮爜瀛楃涓叉柇瑷€銆?

## 鏂规硶

涓嶈鐩存帴鍒犳棫娴嬭瘯銆?

閲囩敤锛?

```text
寤虹珛琛屼负娴嬭瘯
鈫?楠岃瘉瑕嗙洊绛変环
鈫?鍒犻櫎婧愮爜瀛楃涓叉柇瑷€
```

## 瀹屾垚鏍囧噯

- [ ] 鍏抽敭鐢ㄦ埛琛屼负宸茬敱琛屼负娴嬭瘯瑕嗙洊
- [ ] 涓嶅啀渚濊禆鏌愭婧愮爜蹇呴』鍑虹幇鍦ㄥ浐瀹氭枃浠?
- [ ] 鎷嗗垎缁勪欢涓嶄細鍥犱负绉诲姩浠ｇ爜瀵艰嚧澶ч噺鏃犳剰涔夋祴璇曞け璐?

---

# Phase 3 鈥?Storage Boundary

## 鐩爣

鎶婁笟鍔￠€昏緫浠庡叿浣撳瓨鍌ㄦ柟妗堜腑鎷斿嚭鏉ャ€?

## Deliverables

瀹氫箟鐪熷疄 Repository Ports锛屼緥濡傦細

- ConversationRepository
- WorkspaceRepository
- AssetRepository
- TaskRepository
- ProviderConfigRepository

寤虹珛 Legacy Adapter 杩炴帴鐜版湁锛?
- IndexedDB
- localStorage
- `.data`
- JSON
- filesystem

姝ら樁娈典笉瑕佹眰绔嬪嵆鎹㈡暟鎹簱銆?

## 瀹屾垚鏍囧噯

鏍稿績涓氬姟涓嶇洿鎺ョ煡閬撳瓨鍌ㄥ疄鐜般€?

---

# Phase 4 鈥?Task Runtime

## 鐩爣

缁熶竴鍥剧墖銆佽棰戙€佽秴鍒嗐€佸鍑虹瓑闀夸换鍔℃ā鍨嬨€?

## Deliverables

- Task Contract
- TaskState
- progress event
- retry policy
- cancellation semantics
- unified task query

灏介噺澶嶇敤鐜版湁 `lib/task-store.ts` 涓凡缁忓悎鐞嗙殑閮ㄥ垎銆?

涓嶈涓轰簡鏂扮洰褰曡€岄噸鍐欏凡姝ｇ‘浠ｇ爜銆?

---

# Phase 5 鈥?Model / Provider Runtime

## 鐩爣

褰诲簳娓呴櫎鏂颁唬鐮佷腑鐨?provider-specific business branching銆?

## Deliverables

- ModelProvider Port
- ModelDescriptor
- capability model
- Provider Adapters
- routing policy
- provider health / availability abstraction

## 瀹屾垚鏍囧噯

Agent Core 涓嶇煡閬?OpenAI / Anthropic / Gemini 鍏蜂綋 SDK銆?

---

# Phase 6 鈥?Tool Runtime Consolidation

## 鐩爣

璁?Native / MCP / Remote Tool 鍏变韩缁熶竴鎵ц璇箟銆?

## 鐢熷懡鍛ㄦ湡

```text
discover
resolve
validate
authorize
execute
observe
return
```

## 閲嶇偣

浼樺厛澶嶇敤鐜版湁锛?
- registry
- selector
- policy
- executor

鍙噸鍐欑湡姝ｄ笉鍚堢悊杈圭晫銆?

---

# Phase 7 鈥?Canvas Core Rewrite

## 鐩爣

杩欐槸鍓嶇鏈€澶х粨鏋勬€ф妧鏈€虹殑鏍稿績娌荤悊闃舵銆?

**涓嶈鍏堟媶 `SuperCanvas.tsx` UI銆?*

鍏堝垱寤虹湡姝ｇ嫭绔嬬殑 Canvas Core銆?

## Deliverables

- CanvasDocument
- Node / Edge
- Selection
- Operation / Command
- Transaction
- History
- Undo / Redo

鐒跺悗锛?

```text
Legacy SuperCanvas UI
        鈫?
Compatibility Adapter
        鈫?
New Canvas Core
```

## 瀹屾垚鏍囧噯

Canvas 鐨勬牳蹇冪姸鎬佸彉鏇翠笌 React 瑙ｈ€︺€?

---

# Phase 8 鈥?SuperCanvas UI Decomposition

鍙湁 Phase 7 瀹屾垚鍒拌冻澶熺▼搴﹀悗鍐嶆墽琛屻€?

杩欐椂鍐嶆寜鑱岃矗鎷嗭細
- shell
- viewport
- node renderer
- panels
- menus
- agent dock
- asset interaction

鐩爣涓嶆槸鍗曠函闄嶄綆鏂囦欢琛屾暟銆?

鐩爣鏄 UI 鎴愪负瀵?Canvas Core 鐨勮杽閫傞厤灞傘€?

---

# Phase 9 鈥?page.tsx Decomposition

鏈€鍚庡鐞嗕富椤甸潰銆?

鍥犱负鍦?Agent / Storage / Task / Provider / Canvas 琚娊绂诲悗锛宍page.tsx` 鐨勫緢澶氬鏉傚害浼氳嚜鐒舵秷澶便€?

鎷嗗垎鏂瑰悜锛?

- WorkspaceShell
- Conversation
- CanvasPanel
- AssetPanel
- Settings
- Provider UI
- History

椤甸潰鍙礋璐?composition銆?

---

# Phase 10 鈥?Frontend / Backend Hard Separation

濡傛灉鍓嶉潰鏍稿績杈圭晫宸茬粡绋冲畾锛屽啀鎶婂綋鍓?Next.js 涓€浣撳寲缁撴瀯閫愭婕旇繘涓猴細

```text
apps/web
apps/api
apps/worker
```

涓嶈鍦ㄤ笟鍔¤竟鐣屽皻鏈ǔ瀹氭椂鍏堝仛鐗╃悊鎷嗕粨銆?

鍏堥€昏緫鍒嗙锛屽啀鐗╃悊鍒嗙銆?

---

# Phase 11 鈥?Database Modernization

鏈疆宸查€夋嫨 SQLite 浣滀负鏈湴 authoritative database銆俙node:sqlite` 閫氳繃
`lib/database/sqlite.ts` 鏆撮湶缁?Repository锛岃縼绉诲懡浠や负
`npm run migrate:database`锛屽洖婊氬懡浠や负 `npm run migrate:database -- rollback`銆?
杩佺Щ journal 浼氳褰?staging銆乿alidation銆乨atabase installation銆乤ctivation
鍜?rollback 闃舵锛涜繘绋嬩腑鏂椂鍙竻鐞嗘湭婵€娲荤殑 staging锛屽凡婵€娲绘暟鎹簱浠嶇敱 marker
鍜?rollback source 鎺у埗銆?
PostgreSQL 浠嶄繚鐣欎负鏈潵浜戠 adapter锛屼笉灞炰簬鏈疆銆?

鍊欓€夋柟鍚戯細

- Local锛氳瘎浼?PGlite / SQLite
- Server / Cloud锛歅ostgreSQL

閫夋嫨鏍囧噯锛?

- migration quality
- backup / restore
- local packaging
- concurrent access
- FTS / vector
- operational simplicity

涓嶈浠呭洜涓衡€滄柊鈥濋€夋嫨鎶€鏈€?

---

# Phase 12 鈥?Observability

灏嗗叧閿柊閾捐矾鎺ュ叆缁熶竴 telemetry銆?

浼樺厛锛?
- AgentRun
- ModelCall
- ToolCall
- Task
- Provider failure

闀挎湡鍙噰鐢?OpenTelemetry銆?

---

# Phase 13 鈥?Multi-Agent / A2A

鍙湁鍗?Agent Runtime 杈圭晫绋冲畾鍚庡啀鎵╁睍銆?

鏂板锛?
- delegation
- child runs
- handoff
- external agent adapter

A2A 鏄?Adapter锛屼笉渚靛叆 Domain銆?

---

# Phase 14 鈥?Legacy Removal

鍙湁鍚屾椂婊¤冻浠ヤ笅鏉′欢鎵嶅垹闄ゆ棫瀹炵幇锛?

1. 鏂拌矾寰勫凡鏈夎涓鸿鐩?
2. 鏂拌矾寰勭ǔ瀹氳繍琛?
3. 娌℃湁鍓╀綑璋冪敤鑰?
4. Migration Adapter 宸叉棤蹇呰
5. 鏁版嵁鍏煎 / migration 宸叉槑纭?

涓嶈涓轰簡鈥滅洰褰曠湅璧锋潵骞插噣鈥濊繃鏃╁垹闄ゆ棫閫昏緫銆?

---

# 姣忎釜 Phase 鐨勬爣鍑嗘墽琛屾ā鏉?

Coding Agent 姣忔鎵ц涓€涓?Phase 鏃讹細

## 1. Read

璇诲彇锛?
- `AGENTS.md`
- `ARCHITECTURE.md`
- `PLANS.md`
- `WORKFLOW.md`
- 鐩稿叧棰嗗煙鏂囦欢

## 2. Assess

鍏堣鏄庯細
- Current State
- Scope
- Non-goals
- Existing code worth preserving

## 3. Implement

鍙疄鐜板綋鍓?Phase 鐨勬渶灏忓畬鏁寸旱鍚戝垏鐗囥€?

## 4. Verify

鍏堣窇鏈€鐩稿叧娴嬭瘯锛屽啀杩愯锛?

```bash
npm run check
```

闄ら潪鐢ㄦ埛鏄庣‘瑕佹眰浠呭仛鍒嗘瀽銆佷笉淇敼銆?

## 5. Report

杈撳嚭锛?

```text
What changed
Architecture introduced
Legacy still remaining
Tests
Unresolved issues
Next recommended slice
```

---

# 褰撳墠绔嬪嵆鎵ц浠诲姟

褰撳墠闃舵锛?

```text
Data Cutover Closure 宸插畬鎴愶紱Part B 涓?migration in progress
```

涓嬩竴娆′唬鐮佹柦宸ヤ紭鍏堢骇锛?

```text
Part A 宸插畬鎴?server repository 鏀跺彛銆佸鐗╃悊鏍?restore rollback銆佹祦寮?HTTP backup銆乧rash journal銆丼QLite cutover銆乵igration command 涓?observer 鎺ョ嚎锛汸art B 宸插缓绔?Agent API 涓?Clone Worker 鐨勭湡瀹炲叆鍙ｏ紝纭/鎭㈠鍚庣殑 Clone 鎵ц涔熺粺涓€缁?Worker dispatch锛孭rovider 璋冪敤鐢熷懡鍛ㄦ湡宸叉敹鍙ｅ埌 `packages/model-runtime/invocation.ts`锛屽苟鍒犻櫎鏃犺皟鐢ㄧ殑 Agent/Provider 鍏煎妗ャ€俙packages/tool-runtime/adapter.ts` 浠嶆槸鏈夊垹闄ゆ潯浠剁殑 migration adapter锛岀户缁部鐪熷疄 ownership seam 鎺ㄨ繘銆?
```

## Part B observability update (2026-10-03)

`RuntimeObserver` 鍚屾椂鏀寔 bounded in-process diagnostics 涓?`packages/observability` 鐨?redacted JSONL operational sink銆侫gent銆乀ool銆丮CP銆丳rovider銆乀ask銆丏atabase 鍜?Backup 浜嬩欢鍐欏叆 `.data/runtime-events/`锛屾寜鏃ュ垎鐗囧苟淇濈暀 7 澶╋紝鍙繚瀛?RuntimeEvent 鐧藉悕鍗曞瓧娈碉紝涓嶈褰?prompt銆乼ool arguments銆佹枃浠跺唴瀹规垨 secrets銆俙GET /api/observability` 鎻愪緵鍙绠＄悊鍛樻煡璇紱闀挎湡鍙浛鎹负 OpenTelemetry exporter锛屽綋鍓嶅垏鐗囦笉寮曞叆 SDK銆?
