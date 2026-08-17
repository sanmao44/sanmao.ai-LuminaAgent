# SANMAO.AI 0.5.2

## 启动器

- Windows：双击 `启动 SANMAO.AI - Windows.cmd`
- macOS：优先双击 `SANMAO.AI.app`；也可以双击 `启动 SANMAO.AI - macOS.command`

首次在 macOS 上使用时，如果系统提示没有执行权限，请在项目目录打开终端运行：

```bash
chmod +x '启动 SANMAO.AI - macOS.command' 'SANMAO.AI.app/Contents/MacOS/SANMAO.AI'
```

启动器会自动检查 Node.js 20.9+、安装依赖、构建项目、使用 SANMAO.AI 专用的 3210～3220 端口段并打开浏览器。重复双击不会启动第二个后台服务，而是打开已有网页；关闭最后一个网页后后台服务会自动退出。

一个可运行的中文多模型 AI 生图平台：支持在网页内添加多个第三方 API 服务、读取模型列表、选择实际要使用的模型，并提供独立的智能助手、生图工作台、图片修改和本地生成历史。

## 0.5.2 完整发布

- GitHub Release 已包含完整项目源码，CI 测试与生产构建均通过。
- 应用启动后会检查官方 `update.json`，发现新版本时显示轻量更新提示。
- 本地源码运行环境在更新清单提供可信 `packageUrl` 与 SHA-256 后，可直接下载、校验并重启更新。

## 0.5.1 构建修复

修复 Windows 上 `npm run build` 在 `lib/providers.ts` 的 TypeScript 兼容错误。若你是从 0.5.0 升级，直接使用本版本即可。

## 0.5.1 重点升级

### 图片结果不再只是“展示”
每张生成图片都可以：
- 大图预览
- 继续修改（调用图片编辑接口）
- 调整提示词/模型/比例后重新生成
- 复用提示词与参数
- 作为新的参考图继续创作
- 收藏
- 下载
- 删除

### 参考图
- 生图页和智能助手在工具层最多接收、处理 16 张参考图
- 实际可用数量取决于所选模型、服务商和上游接口限制
- 不同模型可能只支持 1 张、少量多图，或完全不支持参考图
- 对话模型还需要支持视觉输入，图片编辑也需要模型支持图片编辑能力
- 支持点击上传、拖拽、聊天输入框粘贴图片
- 对话模型若支持视觉输入，会收到参考图用于分析
- 用户要求“基于这张图修改”时，Agent 会尝试调用图片编辑工具
- 历史图片可以一键转成参考图

### 生成历史
生成结果保存在当前浏览器 IndexedDB 中，不依赖数据库即可工作：
- 搜索提示词或模型
- 按直接生成 / 助手生成 / 图片修改 / 收藏筛选
- 每页 12 / 24 / 48 / 96 张
- 上一页 / 下一页 / 页码切换
- 批量选择
- 批量删除
- 逐张下载
- 全屏浏览和左右切换

### 模型库逻辑简化
服务商读取完模型后：
1. 进入“模型库”
2. 系统自动猜测“对话模型 / 图片模型”
3. 猜错时点一下模型类型即可修正
4. 直接勾选“使用”
5. 该模型立即出现在智能助手或生图页的模型下拉菜单

不再要求用户理解“启用 + 发布”两套开关。

### 两套完整主题
浅色和深色都使用 SANMAO.AI 自己的设计变量，侧栏、卡片、弹窗、输入框、按钮、下拉菜单、图片查看器、移动端底栏会整套切换，不依赖系统默认控件外观。

## Windows 启动

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

如果部分网络无法稳定访问 GitHub 的源码压缩包，可以配置一个自己控制的 HTTPS 镜像地址作为备用下载源。备用源只负责传输，应用仍会用 `update.json` 中的 SHA-256 校验包内容；不要使用来源不明的公共代理。

```env
SANMAO_UPDATE_MIRRORS=https://your-cdn.example.com/sanmao-ai-v0.5.4.zip
```

应用启动后会定期检查更新。侧栏会显示当前版本，发现新版本后弹出更新提示；检查失败不会影响本地使用。

如果 `update.json` 同时提供可信的 GitHub 源码压缩包地址和 SHA-256：

```json
{
  "latestVersion": "0.5.2",
  "releaseUrl": "https://github.com/sanmao44/sanmao.ai-LuminaAgent/releases/tag/v0.5.2",
  "projectUrl": "https://github.com/sanmao44/sanmao.ai-LuminaAgent",
  "packageUrl": "https://codeload.github.com/sanmao44/sanmao.ai-LuminaAgent/zip/refs/tags/v0.5.2",
  "sha256": "在发布后填写 64 位 SHA-256",
  "mirrorUrls": [
    "https://your-cdn.example.com/sanmao-ai-v0.5.2.zip"
  ]
}
```

本地源码运行时，更新提示会显示“立即更新并重启”：下载包会显示实时进度，网络失败时会自动重试并按顺序尝试 `mirrorUrls` 与 `SANMAO_UPDATE_MIRRORS`，下载包随后校验 SHA-256，再只替换程序文件，并保留 `.data`、`.env.local`、API Key、历史记录和图片。Docker 环境默认关闭此按钮，应通过更新镜像完成升级。没有 `packageUrl` 或 SHA-256 时，按钮只会打开 GitHub Release 下载页。

设置页面的“导出本地备份”会生成包含服务端配置、主密钥、日志、浏览器历史和图片文件的 `.sanmao-backup.tar.gz`。备份文件包含 API Key 恢复所需信息，请勿上传 GitHub 或发送给他人。

默认图片目录为 `.data/images`。旧版本项目同级的 `image_generation_records` 会保留读取兼容；确认迁移完成前不要删除旧目录。
