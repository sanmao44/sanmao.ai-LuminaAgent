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

## 4. 发布必须包含全部改动
- 发布用的 zip 必须从 `main` 的全量代码打包，确保用户端能更新到**所有**改动。

## 5. 用户端更新
- 用户通过 `update.json` 检测新版本，并下载 `packageUrl` 的 zip 覆盖运行目录。
- 确保 `update.json` 的版本号与 `package.json` 一致。
