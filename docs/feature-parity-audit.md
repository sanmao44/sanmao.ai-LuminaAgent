# Feature Parity Audit

基线：`v0.7.66`（重构前可用行为）；当前实现：`0.7.76`。本表记录已执行的
生产路径检查和仍需真实外部凭据才能完成的检查。附件中的回归说明是验收规范，
不是产品内指令。

| Feature | Expected behavior | Current behavior | Status | Severity | Regression / limitation / unknown | Owning boundary | Test coverage | Recovery status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Relay health | Local launcher can expose a reachable public media relay | `/api/relay/status` reports `mode=relay`, `relayConfigured=true`, `reachable=true` in the running instance | verified | P1 | none observed | launcher / media adapter | relay status endpoint, `agnes.test.mjs` | recovered |
| Text chat with inline image | Vision capable OpenAI compatible gateways receive an accepted image URL | Inline `data:image/*` stays inline; local storage paths are promoted only when required | verified | P1 | DeepSeek previously rejected the relay representation | Provider adapter | `provider-compat.test.mjs`, `agnes.test.mjs` | fixed |
| Agnes vision chat | Agnes receives a publicly reachable media URL and never receives the app API key in relay upload | Agnes path still uses the shared relay adapter and provider auth remains on the model request | verified | P1 | relay availability remains an external dependency | Provider adapter / signed media | `agnes.test.mjs` | preserved |
| Canvas Agent conversation scope | History and memory stay isolated by project, chat and canvas | Dock state and memory are keyed by the canvas session and bounded history is summarized | verified | P1 | long term server persistence is still bounded by current storage policy | Canvas Agent application | `canvas-agent-dock.test.mjs`, `agent-memory.test.mjs` | recovered |
| Canvas reference image | A saved canvas image can be read by the dock and submitted to the model | Existing local storage and legacy fallback paths work; one historical referenced file is absent from all known roots | partial | P0 | missing bytes cannot be reconstructed | Canvas media adapter / storage repository | `canvas-api.test.mjs`, `media-library.test.mjs` | UI reports loss and asks for re-import |
| Workspace persistence | Save, reload and restart preserve the active workspace | Repository and SQLite paths are present and covered by persistence tests | verified | P0 | live restart smoke requires the running app | Workspace repository | `workspace-context-activity.test.mjs`, storage tests | recovered |
| Image generation and edit | Generate, edit and persist a local result | Provider normalization and local persistence paths are covered | verified | P1 | provider quotas and credentials remain external | Image capability / Provider Runtime | `provider-compat.test.mjs`, canvas API tests | recovered |
| Video, clone and upscale tasks | Submit, poll, cancel and reload task state | Worker boundaries and task routes are covered; live provider queues are external | partial | P1 | live queue availability cannot be proven without provider credentials | Worker / Task Runtime | video, clone and upscale suites | tracked |
| Backup and restore | Create an archive and restore transactionally with rollback safety | Canonical archive and staged restore paths are implemented | verified | P0 | encrypted archive smoke needs a fixture key | Backup application service | backup suites | recovered |
| Native, MCP, skill and artifact tools | Tool calls resolve through the shared Tool Runtime and return inspectable results | Runtime and capability tests pass; external MCP credentials are optional | partial | P1 | external connector availability is unknown in this environment | Tool Runtime / adapters | tool and artifact suites | tracked |

## Live checks performed

- `GET /api/relay/status` returned HTTP 200 and a reachable relay.
- Relay health returned `service=sanmao-ai-studio` and `ok=true`.
- The running service was left in place during the audit.

## Known limits

- The historical canvas asset referenced by `canvas-1789985738220-01bf0ec5-fda1-4821-afef-86cef542a5e0.png` is absent from the current data directory, user media library, legacy media roots and the `v0.7.66` reference archive. It cannot be restored from code.
- Live provider success depends on the configured credentials, quota and upstream availability. Automated tests cover request shape, routing, failover rules and error mapping without exposing credentials.
