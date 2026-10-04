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

## Final convergence checkpoint (2026-10-04)

The architecture lock does not claim full product regression recovery.
User-facing regressions remain tracked separately and are the first item of the
next phase. The Agent transport, runtime ports and Worker boundaries are covered
by behavior/contract tests; historical UI source assertions remain backlog items
and are not ownership blockers.
