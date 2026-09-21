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

## 7. 铁律：同步后必须收尾，本地与远端对齐，不留残留
- 每次执行完“同步”（`git commit` + `git push`）后，必须紧接着执行下面的收尾命令，一条都不能跳过：
```powershell
git fetch origin main
git rev-parse HEAD origin/main   # 两个哈希必须一致
git status --short               # 必须为空（只允许出现被忽略的本地数据目录）
```
- `git status --short` 出现“已修改”时，先用 `git diff --ignore-cr-at-eol origin/main -- <路径>` 判断：
  - 与远端等价（最常见原因：运行目录被更新包覆盖）→ 直接 `git reset --hard origin/main` 丢弃，**不要再当成未提交改动上报**。
  - 与远端不等价 → 停下来问用户，禁止丢弃。
- 同一轮收尾里清理已过期的本地残留：
```powershell
git stash list        # 确认内容已进 origin/main 的 stash：先 `git stash show -p --binary > 备份.patch`，再 `git stash drop`
git worktree list     # 多余的 Codex 工作树：`git worktree remove <路径>`
```
- 绝对禁止：`git reset --hard` 到比 `origin/main` 更旧的提交、丢弃未推送的提交、在未确认内容已进远端前做任何清理。
- 收尾结束后，不允许再留下“本地落后远端”或“工作区一堆已修改”的状态。
