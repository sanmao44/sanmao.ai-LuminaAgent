# AGENTS.md - 项目操作指令（Codex 每次都会自动读取）

Codex 在操作本项目时，请严格遵守以下规则：

## 1. 先看流程说明
- 操作前先阅读本项目根目录的 `WORKFLOW.md`，了解完整的“开发与发布流程”。

## 2. 铁律：平时只同步，不发布
- **“同步 / 备份 / 推到 GitHub”** → 只执行 `git commit` + `git push`（到 `main`）。
  - **不要**升级版本号、**不要**打 tag、**不要**创建 Release、**不要**更新 `update.json`。
- **只有用户明确说“发布 / 出个版本 / 通知用户更新”** 时，才执行发布：
  1. 升级版本号（`package.json`、`update.json`）
  2. 打 tag（如 `v0.7.25`）
  3. 创建 GitHub Release
  4. 上传打包好的 zip
  5. 更新 `update.json`（版本号 + 地址 + sha256）

## 3. 改动必须回到 main
- 用分支开发时，**完工后必须合并回 `main` 再 `push`**，不要只把改动留在 `feature` / `codex` 分支上。
- 否则别人拉 `main` 拿不到这些改动。

## 4. 分支处理规则
- 用户说“合并所有分支”时，只处理最近有实际修改（存在近期新提交或相对 `main` 有差异）且已确认的分支；**长期未修改的历史分支一律视为过期，不自动合并**。
- 分支成功合并到 `main` 并推送后，默认删除对应的本地分支和 GitHub 远程分支；只有用户明确要求保留时才保留。
- 删除前必须确认该分支已经合并；不得删除 `main`，也不得删除尚未合并的分支。

## 5. 发布必须包含全部改动和双平台安装包
- 发布用的 ZIP 和 DMG 都必须基于同一个最新的 `main` 全量代码生成，确保用户端能拿到**所有**改动。
- **ZIP** 是应用内自动更新包：`update.json.packageUrl` 必须继续指向 ZIP，并核对其 SHA-256。
- **DMG** 是 macOS 首次安装包：每次正式发布都要与 ZIP 一起作为 GitHub Release 资产上传，不能只上传其中一个。
- DMG 是发布产物，不提交进 `main`；优先由 macOS runner/CI 生成。发布前必须确认 DMG 中的应用可从 DMG 拖入“应用程序”后独立启动。
- 在用户没有明确说“发布 / 出个版本 / 通知用户更新”之前，即使代码已同步到 GitHub，也不得创建 Release、打 tag 或上传 ZIP/DMG。

## 6. 用户端更新
- 用户通过 `update.json` 检测新版本，并下载 `packageUrl` 的 zip 覆盖运行目录。
- 确保 `update.json` 的版本号与 `package.json` 一致。

# AGENTS.md

## Repository Engineering Rules

This file defines the default engineering rules for this repository.

These rules apply unless a more specific `AGENTS.md` exists in a subdirectory
or the user explicitly gives different instructions.

---

## 1. Before Editing Code

Before modifying existing code:

1. Read this `AGENTS.md` and any more specific `AGENTS.md` files that apply.
2. Inspect the relevant implementation before changing it.
3. Search for similar patterns already used in the repository.
4. Inspect related callers, tests, types, schemas, and configuration.
5. For bugs, identify the root cause before applying a fix.
6. Prefer the smallest correct change.
7. Avoid unrelated refactoring or formatting.
8. After changes, run the most relevant available verification.
9. Inspect the final diff before completion.

When available, use the relevant repository skill:

- `repo-engineering` for general code changes and repository work.
- `bug-fixing` for bugs, regressions, crashes, and failing behavior.
- `feature-implementation` for new features and functionality.
- `code-review` for reviewing diffs, commits, branches, or pull requests.

---

## 2. Core Engineering Principles

Follow these principles:

- Read before editing.
- Search before inventing.
- Root cause before patch.
- Existing patterns before new abstractions.
- Minimal diff before broad cleanup.
- Tests before confidence.
- Evidence before claims.
- Repository conventions before personal preference.

Do not optimize for the largest amount of code.

Optimize for the smallest maintainable change that correctly solves the task.

---

## 3. Change Discipline

Unless the task explicitly requires otherwise:

- Do not perform unrelated refactors.
- Do not rename unrelated symbols.
- Do not reformat unrelated files.
- Do not change public APIs unnecessarily.
- Do not replace existing libraries just because another library is preferred.
- Do not add new dependencies when existing code or standard libraries are sufficient.
- Do not upgrade unrelated dependencies.
- Do not modify generated files manually unless the repository expects it.
- Do not weaken tests merely to make them pass.
- Do not leave debug code, temporary logs, commented experiments, or dead code.
- Do not commit secrets, credentials, tokens, private keys, or production data.

Every changed line should have a reason connected to the requested task.

---

## 4. Repository Discovery

Before implementing a meaningful change, inspect the repository for relevant
project information.

Useful sources may include:

- `README.md`
- `CONTRIBUTING.md`
- `docs/`
- `package.json`
- `pyproject.toml`
- `Cargo.toml`
- `go.mod`
- `Makefile`
- `Taskfile.yml`
- workspace configuration
- CI workflows
- test configuration
- database/schema configuration

Do not invent project commands or conventions when they can be discovered from
the repository.

---

## 5. Architecture

Respect existing architecture and module boundaries.

Prefer existing layers, abstractions, and extension points.

Do not bypass established architecture merely because a shortcut is easier.

Examples:

- Keep presentation/UI logic out of data-access layers.
- Keep database access in the repository's existing database/data layer.
- Reuse existing service/domain abstractions.
- Reuse existing API clients instead of creating duplicates.
- Reuse existing validation and error-handling patterns.
- Avoid duplicating domain logic across modules.
- Avoid introducing global state when the repository already has a state pattern.

If architecture documentation exists, read it before making structural changes.

---

## 6. Bug Fixes

For bug fixes, follow this sequence whenever practical:

1. Identify the expected behavior.
2. Identify the actual failing behavior.
3. Reproduce the issue or establish clear evidence.
4. Trace the relevant execution path.
5. Determine the root cause.
6. Inspect existing tests.
7. Add or update a regression test when appropriate.
8. Make the smallest correct fix.
9. Run relevant verification.
10. Check nearby edge cases if they are realistically affected.

Avoid symptom-hiding fixes such as:

- arbitrary sleeps;
- unexplained retries;
- broad exception swallowing;
- disabling validation;
- unsafe fallback values;
- weakening assertions.

Use those techniques only when they are part of the correct design.

---

## 7. Feature Implementation

For new features:

1. Clarify the intended behavior from the task.
2. Find the existing extension point.
3. Inspect similar functionality already in the repository.
4. Identify affected interfaces, schemas, callers, and tests.
5. Implement only what the current requirement needs.
6. Add tests for important behavior.
7. Verify integration with existing code.
8. Preserve backward compatibility unless a breaking change is explicitly requested.

Avoid speculative infrastructure and premature abstractions.

---

## 8. Refactoring

When refactoring is explicitly requested:

- Preserve externally observable behavior unless behavior changes are requested.
- Prefer incremental changes.
- Identify public interfaces and important invariants first.
- Ensure relevant tests exist before large structural changes.
- Avoid combining a large refactor with unrelated feature work.
- Re-run relevant tests after the refactor.
- Inspect the diff for accidental semantic changes.

---

## 9. Dependencies

Prefer, in this order:

1. existing repository utilities;
2. existing dependencies;
3. language/runtime standard library;
4. a new dependency only when genuinely justified.

Before adding a dependency, check whether equivalent functionality already
exists in the repository.

Do not perform broad dependency upgrades as part of unrelated work.

Use the repository's existing package manager and lockfile workflow.

---

## 10. Testing and Verification

Discover the repository's actual verification commands.

Run the narrowest useful checks first.

A reasonable order is:

1. test directly related to the changed behavior;
2. affected module/package tests;
3. typecheck;
4. lint/static analysis;
5. formatting check;
6. build;
7. broader integration/end-to-end/full test suite when justified.

Do not claim a command passed unless it was actually executed successfully.

If a check cannot be run, say exactly what could not be verified and why.

If a failure appears pre-existing or unrelated, distinguish it from failures
introduced by the current change.

---

## 11. Tests

Tests are evidence, not obstacles.

Do not:

- delete meaningful tests to make the suite pass;
- weaken assertions without a behavioral reason;
- rewrite unrelated tests during a focused change;
- change expected behavior solely because the implementation currently fails.

For bug fixes, prefer a regression test that demonstrates the original failure.

For features, test important observable behavior and relevant edge cases.

Prefer behavior-oriented tests over tests tightly coupled to implementation
details.

---

## 12. Types, Lint, and Static Analysis

Respect existing type and lint rules.

Avoid unnecessary:

- `any`;
- unchecked casts;
- ignore directives;
- lint-disable comments;
- broad suppressions.

Do not silence an error without understanding it.

If suppression is necessary, keep it as narrow as possible and explain the
reason when it is not obvious.

---

## 13. Generated Code

Before editing a file, determine whether it is generated.

Examples:

- generated API clients;
- generated schemas/types;
- compiled output;
- code generated from protobuf/OpenAPI/GraphQL schemas;
- generated snapshots;
- generated migration artifacts.

Prefer modifying the source definition and regenerating output using the
repository's supported workflow.

---

## 14. Database and Migrations

Treat schema and migration changes as high-impact.

When applicable:

- use the repository's migration tooling;
- do not edit already-applied migrations unless repository policy allows it;
- review destructive operations carefully;
- consider backward compatibility and rolling deployments;
- inspect related queries and models;
- test migrations when practical;
- never use production credentials or production data for local verification.

---

## 15. APIs and Compatibility

When modifying a public or internal API:

- inspect existing callers;
- update related types and schemas consistently;
- preserve compatibility unless a breaking change is requested;
- update generated clients through the normal workflow;
- update tests;
- update documentation if the contract materially changes.

Do not silently introduce breaking changes.

---

## 16. Security and Data Safety

Do not expose or commit:

- API keys;
- passwords;
- tokens;
- credentials;
- private keys;
- secrets;
- sensitive production data.

Do not weaken:

- authentication;
- authorization;
- input validation;
- security checks;
- permission boundaries;

merely to make a task easier.

Pay extra attention to changes involving authentication, authorization,
payments, file handling, user-provided input, database queries, secrets,
deployment configuration, and external integrations.

---

## 17. Final Diff Review

Before completion, inspect the final diff.

Look for:

- unrelated changes;
- accidental formatting churn;
- debug logs;
- temporary code;
- commented-out experiments;
- duplicated logic;
- unexpected dependency changes;
- accidental API changes;
- missing tests;
- missing error handling;
- secrets or sensitive data;
- generated files edited by hand.

Remove anything that does not belong in the final solution.

---

## 18. Completion Format

At the end of a coding task, provide a concise report:

### Changed
What was modified.

### Reason
The root cause, requirement, or design reason.

### Verified
The tests, typechecks, lint, builds, or other checks actually executed.

### Notes
Remaining risks, limitations, unverified assumptions, or follow-up work.

Never claim tests, builds, or checks passed unless they were actually run.

---

## 19. Project-Specific Configuration

Fill in this section for this repository.

### Repository Overview

- Product/system: `<describe this repository>`
- Main language: `<language>`
- Framework: `<framework>`
- Package manager: `<package manager>`
- Database: `<database, if any>`
- Test framework: `<test framework>`

### Important Paths

- `<path>` — `<purpose>`
- `<path>` — `<purpose>`
- `<path>` — `<purpose>`

### Development Commands

Install dependencies:

```bash
<command>
```

Run development environment:

```bash
<command>
```

Run focused tests:

```bash
<command>
```

Run all tests:

```bash
<command>
```

Typecheck:

```bash
<command>
```

Lint:

```bash
<command>
```

Build:

```bash
<command>
```

### Architecture Rules

- `<project-specific rule>`
- `<project-specific rule>`
- `<project-specific rule>`

### Protected / Generated Areas

Do not modify unless explicitly required:

- `<path>`
- `<path>`

### Important Documentation

- `<path>`
- `<path>`
