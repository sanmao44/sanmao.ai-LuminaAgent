# Regression Backlog

This file records known product regressions separately from architecture gate
results. Items remain here until a behavior test and a production fix exist.

This backlog is not a claim of complete product regression coverage.
Architecture Migration and Final Architecture Lock are complete; user-facing
regressions from the migration are restored in the Product Regression Recovery
phase. Non-blocking architecture debt is tracked separately in
`docs/next-architecture/post-lock-improvements.md`.

| Feature | Last known good version | Current symptom | Affected domain | Severity | Automated coverage | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Windows offline voice synthesis | 0.7.x baseline | `System.Speech` is unavailable in the current restricted Windows test context | media / voice | medium | test is skipped with environment evidence | tracked |
| Remaining source-coupled UI assertions | 0.7.x baseline | Some historical UI tests still assume implementation file locations | UI / migration tooling | low | existing source assertions | tracked; not a pre-lock blocker |
| Canvas Agent memory and conversation scope | 0.7.66 behavior | Canvas Agent history was stored in one shared key and requests only carried the latest bounded turns; long or switched-canvas conversations lost continuity | Agent / Canvas | P1 | canvas dock, memory and architecture tests | resolved |
| OpenAI-compatible vision media protocol | 0.7.66 behavior | All compatible chat providers converted inline `data:image/*` references into relay URLs; DeepSeek rejected the resulting `image_url` format | Provider / Agent | P1 | provider compatibility and Agnes relay tests | resolved |
| Historical canvas media reference | 0.7.66 workspace behavior | One saved canvas node references an image that is absent from the current and legacy media roots | Canvas / Storage | P0 | media library and canvas reference tests; live file audit | confirmed data loss; UI asks for re-import |

## Final convergence checkpoint (2026-10-04)

The architecture lock does not claim full product regression recovery.
User-facing regressions remain tracked separately and are the first item of the
next phase. The Agent transport, runtime ports and Worker boundaries are covered
by behavior/contract tests; historical UI source assertions remain backlog items
and are not ownership blockers.
