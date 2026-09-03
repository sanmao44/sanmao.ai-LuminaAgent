# SANMAO.AI 开发与发布流程

> 本说明用于**公司 ⇄ 家里** 协作开发与发布，避免"在家更新后什么都没改"这类问题。

---

## 0. 一句话心法

> **`git push` 只是备份代码；`git release`（打 tag + 出 Release）才是发布给用户。**
> **凡是最终要让公司/家里拿到的改动，最后都必须出现在 `main` 分支里。**

---

## 1. 两个核心概念

| 动作 | 做什么 | 会不会发布给用户 |
|------|--------|------------------|
| `git push` | 把改动上传到 GitHub（备份/同步） | ❌ 不会 |
| 打 tag + 出 Release | 生成一个正式版本，通知用户更新 | ✅ 会 |

**平时改动 = 只 push，不发布。** **想发新版 = 打 tag + 出 Release。**

---

## 2. 平时开发（实时改动 + 同步 GitHub，但不发布）

**核心规矩：最终所有要分享的改动，必须回到 `main` 分支。**

### 方式 A（推荐，最简单）：直接在 `main` 上做

```powershell
git checkout main
# ....改代码....
git add .
git commit -m "改了什么"
git push origin main        # 同步到 GitHub（备份），不会发布
```

- 家里/公司只要 `git pull` 就能拿到。
- **平时不改版本号，不发布。**

### 方式 B（想用分支隔离开发）：用分支，但**完工后必须合并回 main**

```powershell
git checkout -b feature-xxx          # 建一个功能分支
# ....改代码....
git add .
git commit -m "加了某个功能"
git push origin feature-xxx          # 先备份到 GitHub（安全，不发布）

# ★ 关键：完工后务必合并回 main，别让它停在分支上 ★
git checkout main
git pull origin main                 # 先同步最新 main
git merge feature-xxx
git push origin main                 # 这样别人 pull main 才能拿到
```

> ⚠️ **如果改动只停留在 `feature-xxx` / `codex/xxx` 分支而没有合并进 `main`，那别人拉 `main` 是拿不到的。** 这就是"在家更新却什么都没变"的最常见原因。

---

## 3. 想正式发布给用户时

发布 = **升级版本号 + 打 tag + 出 GitHub Release**，这时才真正通知用户。

```powershell
# 1) 确认 main 是最新、改动都在
git checkout main
git pull origin main
git push origin main

# 2) 升级版本号：把 package.json 与 update.json 里的版本改成 0.7.25
#    改完后提交并推送
git add package.json update.json
git commit -m "bump version to 0.7.25"
git push origin main

# 3) 打 git tag（标记这个版本）并推送
git tag v0.7.25
git push origin v0.7.25

# 4) 创建 GitHub Release（真正发布/通知用户）
gh release create v0.7.25 "C:\path\to\SANMAO.AI-0.7.25.zip" --repo sanmao44/sanmao.ai-LuminaAgent --title "SANMAO.AI v0.7.25" --notes "本次更新说明..."
```

> 如果想**全自动**：配好 `.github/workflows` 里的 CI，之后**只要打 tag / 推分支**，GitHub 就会自动打包并出 Release，不用手动 `gh release create`。

---

## 4. 用户端如何真正拿到全部改动？

用户端（或更新脚本）的流程：

1. 读取 `update.json`
2. 发现 `latestVersion`（如 `0.7.25`）> 当前版本
3. 去 `packageUrl` 下载新的 zip
4. **解压覆盖整个运行目录** → 重启

> **只要发布用的 zip 是从 `main` 全量代码打包出来的，用户就能 100% 拿到所有改动。**
> 如果 zip 打包不全、或 `update.json` 的下载地址/版本对不上，用户就会漏改 → 类似今晚的情况。

---

## 5. 常见坑（避免再踩）

| 坑 | 结果 | 正确做法 |
|----|------|----------|
| 改动只推到 `codex/xxx` 分支，没合并进 `main` | 别人拉 `main` 拿到不到 | 完工后**合并回 main 再 push** |
| 改了但忘了 `git commit` / `git push` | GitHub 上没有，别人拉不到 | 每次改动**提交并推送** |
| `push` 了但没升级版本号 / 没出 Release | 代码更新了，但用户不知道、不更新 | 想发布时**打 tag + 出 Release** |
| zip 不是从 `main` 全量打的 | 用户更新后**漏改动** | 发布前确认 `main` 就是最新 |
| 版本号与 GitHub 不一致 | 用户端检测不到新版本 | 发布时同步升级 `package.json` / `update.json` |

---

## 6. 一分钟速查

- 平时小改：`git push origin main`（不发布）
- 想隔离开发：分支 → **合并回 main** → push（不发布）
- 想发一版：升级版本号 → `git tag` → `gh release create`（发布）
- 用户更新：`git pull` 或 下载 Release zip
