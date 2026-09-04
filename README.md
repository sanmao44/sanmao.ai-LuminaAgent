# SANMAO.AI

一个可运行的中文多模型 AI 创作平台：支持在网页内添加多个第三方 API 服务、读取模型列表、选择实际要使用的模型，并提供独立的智能助手、图片与视频工作台、图片修改和本地生成历史。

> 开发与发布流程请见 [WORKFLOW.md](WORKFLOW.md)；版本更新记录见 [CHANGELOG.md](CHANGELOG.md)。

## 启动方式

### Windows 本机启动

推荐解压到一个全新的文件夹，然后双击带蓝色 Logo 的 `启动 SANMAO.AI - Windows.lnk`（本机启动）。

如果还没有快捷方式，先双击备用入口 `启动 SANMAO.AI - Windows.cmd`，它会自动生成或刷新本机的 Logo 快捷方式。项目目录移动后，用 `.cmd` 启动一次即可修复快捷方式；旧文件名 `启动 SANMAO.AI.cmd` 仍可继续使用。

启动器会自动：

1. 检查 Node.js 20.9+
2. 安装/修复 npm 依赖
3. 构建正式版本
4. 使用专用端口段（3210～3220）中的可用端口
5. 等服务器真的启动后再打开浏览器

首次安装依赖通常需要几分钟。

### Windows 局域网共享

主机和其他电脑连接同一个路由器即可（主机接网线、其他电脑连 WiFi 也可以）。优先双击带绿色 Logo 的 `启动 SANMAO.AI - 局域网共享.lnk`；如果还没有快捷方式，双击 `启动 SANMAO.AI - 局域网共享.cmd`，它会先自动生成快捷方式。

首次启动会单独弹出密码设置窗口，设置至少 8 位管理员密码；确认后服务会在后台启动，并弹出“局域网共享已启动”窗口，显示和复制局域网画布地址，例如：

`http://192.168.1.20:3210/canvas`

其他电脑打开这个地址，输入管理员密码后即可使用主机上的同一个画布、图库、资产和生成服务。主机需要保持 SANMAO.AI 运行；现有同步约每 5 秒更新一次，同时编辑时以后保存的版本会覆盖先保存的版本，不是实时多人协同。

管理员密码会以当前 Windows 用户可解密的密文保存于 `.data/lan-password`，不会进入 GitHub 或工作区同步；如需重新设置，停止服务后删除该文件再启动局域网入口。局域网入口默认只建议在可信的家庭或办公网络使用，不要做公网端口转发。如果其他电脑无法打开，需确认 Windows 网络类型为“专用网络”，并按启动器提示在管理员 PowerShell 中放行当前端口的 Private 入站规则。普通 `启动 SANMAO.AI - Windows.cmd` 仍然只允许本机访问，也不需要管理员密码。

### macOS 启动

优先双击带橙色 Logo 的 `SANMAO.AI.app`；备用入口为 `启动 SANMAO.AI - macOS.command`。

首次在 macOS 上使用时，如果系统提示没有执行权限，请在项目目录打开终端运行：

```bash
chmod +x '启动 SANMAO.AI - macOS.command' 'SANMAO.AI.app/Contents/MacOS/SANMAO.AI'
```

### 手动启动

```bash
npm install
npm run build
npm start
```

然后打开：

`http://localhost:3210`

## 启动器说明

- 快捷方式只在本机生成，不会把当前电脑的绝对路径提交到 GitHub。
- 颜色标识：蓝色＝本机启动，绿色＝局域网共享，橙色＝macOS 应用。
- 启动器会自动检查 Node.js 20.9+、安装依赖、构建项目、使用 3210～3220 端口段并打开浏览器。
- 只有检测到已保存且有访问密钥、且视频传输需要公网媒体地址的服务商或模型时，启动入口才会按需准备免费的临时 HTTPS 通道（首次使用可能自动下载 Cloudflare 通道组件），不需要服务器、域名、`.env` 或手工配置。没有此类配置时不会下载或启动中转；原生任务接口和本机 CLI 仍保持原有启动行为。
- 重复双击不会启动第二个后台服务，而是打开已有网页；本地服务不会因为页面暂时不操作、切到后台或电脑从睡眠中恢复而自动退出。请使用“停止 SANMAO.AI”入口停止服务，临时通道也会随服务停止而清理。

## 第一次配置

进入“接口服务商”：

1. 选择你使用的平台
2. 中转站或聚合平台粘贴 API 地址；官方平台地址由系统内置
3. 粘贴访问密钥
4. 点击“测试并连接”

协议、模型路径、对话路径、图片接口和鉴权方式会按平台自动配置，不需要填写高级参数。读取完成后会自动跳到“模型库”，直接勾选你要使用的模型。

### 即梦 CLI 一键安装

安装包内提供跨平台的一键安装入口：

- Windows：双击 `一键安装即梦 CLI - Windows.cmd`
- macOS：双击 `一键安装即梦 CLI - macOS.command`
- Linux：运行 `bash ./scripts/install-jimeng.sh`

安装器会从即梦官方地址下载对应架构的 CLI，写入当前用户 PATH，并用 `dreamina --version` 完成验证。不需要管理员权限。安装完成后回到“接口服务商”中的即梦卡片，点击“重新检测”，再点击“连接即梦”。如果 macOS 阻止脚本运行，请先在终端执行 `chmod +x '一键安装即梦 CLI - macOS.command'`。

## API 兼容说明

### 通用兼容接口

当前主要按 OpenAI 风格接口调用：

- `GET /models`
- `POST /chat/completions`
- `POST /images/generations`
- `POST /images/edits`

图片修改会先尝试 JSON 形式的参考图输入；如果上游不支持，会自动回退 multipart/form-data。

不同中转平台对“参考图 / 图片编辑 / 自定义尺寸 / 多图数量”的支持可能不同。SANMAO.AI 会把真实接口报错显示出来，不伪造成功结果。

### 远程图生视频的本地图片

普通用户直接上传图片即可，应用会自动完成图片压缩和临时中转，不需要编辑 `.env`、配置 HTTPS 或重启应用。外部公网图片 URL 会直接使用，不会重复上传。只有当前视频服务商的接口确实需要公网媒体地址时才会启用中转；原生任务接口和本机 CLI 不会触发它。

如果自动中转服务暂时不可用，任务会在提交远程视频服务商前停止，不会创建无效任务或扣除视频额度；后台会继续尝试恢复，恢复后无需重启应用即可继续。文本和普通图片不受影响。高级用户仍可使用自己的公网媒体地址，具体部署方式见 [`relay/README.md`](relay/README.md) 和 `.env.example`。

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

服务商/API Key：服务端 `.data/` 目录保存，API Key 使用 AES-256-GCM 加密。源码运行在 Git 工作树时，服务商配置会自动跟随主工作树的 `.data/state.json` 和 `.data/master.key`，因此不同工作树可以直接共用已保存的服务商与模型；画布、图库、图片、日志和任务等其他本地数据仍按各自工作树隔离。需要自定义位置时可设置 `SANMAO_PROVIDER_CONFIG_DIR`，它优先于自动判断。

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

### 部署项目媒体中转服务

需要公网媒体地址的远程视频服务商必须能通过公网 HTTPS 读取图生视频参考图。项目提供独立的通用中转部署包，详见 [`relay/README.md`](relay/README.md)。部署完成后，将中转域名作为发布版本的默认配置；普通用户端无需填写任何地址。原生任务接口和本机 CLI 不会启用中转。

## SeedVR2-7B 图片超分

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

无梯子环境会自动做多源回退：更新清单会并发请求 GitHub、jsDelivr(Fastly/Gcore) 以及国内可达的 raw 加速镜像，取最先成功的结果；安装包优先尝试清单 `mirrorUrls`、`SANMAO_UPDATE_MIRRORS` 以及内置的 `ghfast.top`/`gh-proxy.com` 公共加速，GitHub 官方 Release 保留为备用。安装包下载后仍会强制校验 SHA-256，校验失败不会执行更新。也可以自定义镜像：

```env
SANMAO_UPDATE_MANIFEST_MIRRORS=https://gitee.com/sanmao44/sanmao.ai-LuminaAgent/raw/main/update.json
SANMAO_UPDATE_MIRRORS=https://ghfast.top/https://github.com/sanmao44/sanmao.ai-LuminaAgent/releases/download/v0.7.24/SANMAO.AI-0.7.24.zip
SANMAO_UPDATE_GITHUB_PROXIES=https://ghfast.top/,https://gh-proxy.com/
```

如果 `update.json` 同时提供可信的 GitHub 源码压缩包地址和 SHA-256：

```json
{
  "latestVersion": "0.7.24",
  "releaseUrl": "https://github.com/sanmao44/sanmao.ai-LuminaAgent/releases/tag/v0.7.24",
  "projectUrl": "https://github.com/sanmao44/sanmao.ai-LuminaAgent",
  "packageUrl": "https://codeload.github.com/sanmao44/sanmao.ai-LuminaAgent/zip/refs/tags/v0.7.24",
  "sha256": "在发布后填写 64 位 SHA-256"
}
```

本地源码运行时，更新提示会显示“立即更新并重启”：下载包会先校验 SHA-256，然后只替换程序文件，并保留 `.data`、`.env.local`、API Key、历史记录和图片。Docker 环境默认关闭此按钮，应通过更新镜像完成升级。没有 `packageUrl` 或 SHA-256 时，按钮只会打开 GitHub Release 下载页。

设置页面的“导出本地备份”会生成包含服务端配置、主密钥、日志、浏览器历史和图片文件的加密 `.sanmao-backup`。每次导出都需输入至少 12 位的备份密码；密码不会保存，恢复时也必须输入。备份文件仍包含 API Key 恢复所需信息，请勿上传 GitHub 或发送给他人。

应用会每天创建一次本机自动快照，并保留最近 7 份；恢复完整备份或自动快照前也会先创建保护快照。自动快照用于本机误操作恢复，不替代带独立密码、可移动到其他设备的完整备份。

默认图片目录为 `.data/images`。旧版本项目同级的 `image_generation_records` 会保留读取兼容；确认迁移完成前不要删除旧目录。

## 相关文档

- [WORKFLOW.md](WORKFLOW.md) — 开发与发布流程
- [CHANGELOG.md](CHANGELOG.md) — 版本更新记录
