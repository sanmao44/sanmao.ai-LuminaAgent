# SANMAO.AI 0.7.5

## 启动器

- Windows：双击 `启动 SANMAO.AI - Windows.cmd`
- macOS：优先双击 `SANMAO.AI.app`；也可以双击 `启动 SANMAO.AI - macOS.command`

首次在 macOS 上使用时，如果系统提示没有执行权限，请在项目目录打开终端运行：

```bash
chmod +x '启动 SANMAO.AI - macOS.command' 'SANMAO.AI.app/Contents/MacOS/SANMAO.AI'
```

启动器会自动检查 Node.js 20.9+、安装依赖、构建项目、使用 SANMAO.AI 专用的 3210～3220 端口段并打开浏览器。重复双击不会启动第二个后台服务，而是打开已有网页；关闭最后一个网页后后台服务会自动退出。

一个可运行的中文多模型 AI 生图平台：支持在网页内添加多个第三方 API 服务、读取模型列表、选择实际要使用的模型，并提供独立的智能助手、生图工作台、图片修改和本地生成历史。

## 0.7.5 更新器兼容性与自动重启修复

- 修复早期安装包升级时把旧更新运行时覆盖进新版本、造成重建失败和无法自动重启的问题。
- 更新包校验后以包内文件为唯一来源；进度接口同时兼容旧运行时，确保 `0.7.3` 用户可正常升级。
- 对从旧版迁移的用户，重启后的启动器会自动恢复新版更新器入口，后续更新不再继续沿用旧脚本。
- 更新器运行期间保留当前执行的临时脚本，避免 Windows 在替换脚本自身时中断自动重启；重启后由新版启动器恢复固定入口。


推荐解压到一个全新的文件夹，然后双击：

`启动 SANMAO.AI - Windows.cmd`

或：

旧文件名 `启动 SANMAO.AI.cmd` 仍可继续使用。

启动器会自动：
1. 检查 Node.js 20.9+
2. 安装/修复 npm 依赖
3. 构建正式版本
4. 使用专用端口段（3210～3220）中的可用端口
5. 等服务器真的启动后再打开浏览器

首次安装依赖通常需要几分钟。

## 手动启动

```bash
npm install
npm run build
npm start
```

然后打开：

`http://localhost:3210`

## 第一次配置

进入“接口服务商”：
1. 选择你使用的平台
2. 中转站或聚合平台粘贴 API 地址；官方平台地址由系统内置
3. 粘贴访问密钥
4. 点击“测试并连接”

协议、模型路径、对话路径、图片接口和鉴权方式会按平台自动配置，不需要填写高级参数。

读取完成后会自动跳到“模型库”，直接勾选你要使用的模型。

## API 兼容说明

### 通用兼容接口
当前主要按 OpenAI 风格接口调用：
- `GET /models`
- `POST /chat/completions`
- `POST /images/generations`
- `POST /images/edits`

图片修改会先尝试 JSON 形式的参考图输入；如果上游不支持，会自动回退 multipart/form-data。

不同中转平台对“参考图 / 图片编辑 / 自定义尺寸 / 多图数量”的支持可能不同。SANMAO.AI 会把真实接口报错显示出来，不伪造成功结果。

### Google Gemini
支持独立 Gemini 服务商配置，并使用 Google 的 OpenAI compatibility 地址调用兼容接口。具体模型是否支持图片生成/修改，仍由该模型和服务端能力决定。

## 智能助手和图片模型的关系

智能助手是“对话与调度层”，不是图片模型本身。

- 问提示词、问模型、让它分析参考图：调用对话模型
- 明确要求生成新图：Agent 可调用图片生成工具
- 上传参考图并要求修改：Agent 可调用图片编辑工具

因此至少建议选择：
- 1 个对话模型
- 1 个图片模型

## 本地数据

服务商/API Key：服务端 `.data/` 目录保存，API Key 使用 AES-256-GCM 加密。

生成历史：浏览器 IndexedDB 保存。这样图片不会因为刷新页面立即丢失，也无需第一版就搭数据库。

如果未来给大量公网用户使用，建议把生成历史迁移到 PostgreSQL + 对象存储（S3/R2）。

## 管理员保护（可选）

公开部署时建议设置：

```env
SANMAO_ADMIN_PASSWORD=你的后台密码
SANMAO_MASTER_KEY=一段足够长的随机字符串
```

不设置时，本机使用默认不要求管理员登录。

## Docker

```bash
docker compose up -d --build
```
# SeedVR2-7B 图片超分

SeedVR2-7B 会在模型同步后自动识别为“图片模型 / 超分”。在生成历史或生成结果的图片卡片中点击“超分”，选择 2× 或 4×，即可把当前图片作为输入提交给 SeedVR2-7B。

65535 的注册页本身不包含 API 文档，因此连接地址、超分路径仍以 65535 控制台显示的接口说明为准：

1. 在“接口服务商”选择“65535 聚合接口”，填写控制台提供的 API 根地址和访问密钥。
2. OpenAI 兼容方式使用 `https://api2.65535.space/v1`，图片超分路径为 `/images/edits`。
3. 原生异步方式使用 `https://task-api-1-cn.65535.space`，提交路径为 `/v1/tasks`，查询路径为 `/v1/tasks/{taskId}`。
4. 保存后点击“重新读取模型”，确认 `seedvr2-7b` 显示“超分”标签，并勾选“使用”。

SeedVR2 请求必须传 `size: WIDTHxHEIGHT`，且目标尺寸与原图比例必须完全一致。SANMAO.AI 会先读取原图尺寸，再根据 2×/4× 或目标档位计算精确尺寸，并传递 `seed`、`color_correction`、`resize_method` 和 `response_format=b64_json`。每次只提交一张图片。

## 更新提醒与完整备份

SANMAO.AI 默认会检查官方仓库的 `update.json`。如果你使用自己的分支或镜像，可在 `.env.local` 中覆盖 `SANMAO_UPDATE_MANIFEST_URL`，例如：

```env
SANMAO_UPDATE_MANIFEST_URL=https://raw.githubusercontent.com/sanmao44/sanmao.ai-LuminaAgent/main/update.json
```

应用启动后会定期检查更新。侧栏会显示当前版本，发现新版本后弹出更新提示；检查失败不会影响本地使用。

无梯子环境会自动做多源回退：更新清单先请求 GitHub，失败后尝试 jsDelivr；安装包优先尝试清单 `mirrorUrls`、`SANMAO_UPDATE_MIRRORS` 以及内置的 `ghfast.top`/`ghproxy.net` 公共加速，GitHub 官方 Release 保留为备用。安装包下载后仍会强制校验 SHA-256，校验失败不会执行更新。也可以自定义镜像：

```env
SANMAO_UPDATE_MANIFEST_MIRRORS=https://gitee.com/sanmao44/sanmao.ai-LuminaAgent/raw/main/update.json
SANMAO_UPDATE_MIRRORS=https://ghfast.top/https://github.com/sanmao44/sanmao.ai-LuminaAgent/releases/download/v0.7.4/SANMAO.AI-0.7.4.zip
SANMAO_UPDATE_GITHUB_PROXIES=https://ghfast.top/,https://ghproxy.net/
```

如果 `update.json` 同时提供可信的 GitHub 源码压缩包地址和 SHA-256：

```json
{
  "latestVersion": "0.5.2",
  "releaseUrl": "https://github.com/sanmao44/sanmao.ai-LuminaAgent/releases/tag/v0.5.2",
  "projectUrl": "https://github.com/sanmao44/sanmao.ai-LuminaAgent",
  "packageUrl": "https://codeload.github.com/sanmao44/sanmao.ai-LuminaAgent/zip/refs/tags/v0.5.2",
  "sha256": "在发布后填写 64 位 SHA-256"
}
```

本地源码运行时，更新提示会显示“立即更新并重启”：下载包会先校验 SHA-256，然后只替换程序文件，并保留 `.data`、`.env.local`、API Key、历史记录和图片。Docker 环境默认关闭此按钮，应通过更新镜像完成升级。没有 `packageUrl` 或 SHA-256 时，按钮只会打开 GitHub Release 下载页。

设置页面的“导出本地备份”会生成包含服务端配置、主密钥、日志、浏览器历史和图片文件的加密 `.sanmao-backup`。每次导出都需输入至少 12 位的备份密码；密码不会保存，恢复时也必须输入。备份文件仍包含 API Key 恢复所需信息，请勿上传 GitHub 或发送给他人。

应用会每天创建一次本机自动快照，并保留最近 7 份；恢复完整备份或自动快照前也会先创建保护快照。自动快照用于本机误操作恢复，不替代带独立密码、可移动到其他设备的完整备份。

默认图片目录为 `.data/images`。旧版本项目同级的 `image_generation_records` 会保留读取兼容；确认迁移完成前不要删除旧目录。
