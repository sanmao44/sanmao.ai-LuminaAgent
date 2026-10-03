# Regression Backlog

This file records known product regressions separately from architecture gate
results. Items remain here until a behavior test and a production fix exist.

| Feature | Last known good version | Current symptom | Affected domain | Severity | Automated coverage | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Windows offline voice synthesis | 0.7.x baseline | `System.Speech` is unavailable in the current restricted Windows test context | media / voice | medium | test is skipped with environment evidence | tracked |
| Remaining source-coupled UI assertions | 0.7.x baseline | Some tests still assume implementation file locations | UI / migration tooling | low | existing source assertions | migration in progress |
