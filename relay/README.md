# SANMAO.AI 临时媒体中转服务

公共媒体中转让远程模型读取用户电脑上的参考图片。发行版在确有需要时会按需启动免费临时通道，不要求用户订阅、注册账号或配置域名。Cloudflare Worker + R2 是可选的稳定共享部署方案，不是发布或使用本应用的前置条件。

## 面向普通用户

Windows 本机、Windows 局域网、macOS 和 Linux 启动器会检查已配置的服务商是否需要公网媒体地址。需要时，如果没有配置共享中转地址，启动器会自动建立临时 Quick Tunnel；服务停止时通道也会关闭，网络不可用时文本和普通图片功能仍可使用。

如果项目之后部署了共享 Worker，可将它的 HTTPS 根地址写入 `relay/default-config.json` 的 `defaultMediaRelayUrl`，让所有用户共用稳定地址并跳过本机临时通道。留空即使用按需临时通道。

发布 ZIP 和 macOS DMG 时，打包校验允许共享地址留空；非空时必须是公网 HTTPS 根地址。不要把 `MEDIA_SIGNING_KEY` 写入该文件或任何应用包，它只应保存在自托管 Worker secret 中。

## 可选：Cloudflare Worker + R2 部署

以下步骤只适用于希望维护稳定共享中转服务的项目维护者。普通用户安装和使用发行版无需完成这些步骤。

1. 安装 Wrangler 并登录目标 Cloudflare 账号：

```bash
npm install --global wrangler
npx wrangler login
```

2. 在该账号中创建 R2 bucket，名称与 `wrangler.jsonc` 中的 `bucket_name` 一致：

```bash
npx wrangler r2 bucket create sanmao-media-relay
```

3. 检查 `relay/cloudflare/wrangler.jsonc` 里的 `ratelimits[0].namespace_id`。它必须是当前账号内未使用过的正整数 ID；多人协作时先协调这个值，避免与其他 Worker 共用计数器。当前限额为每个客户端 IP 每分钟 10 次上传，是防滥用措施，不是全局账单上限。Cloudflare 的限流按边缘位置近似执行，请求可能超过阈值，也可能让共享出口 IP 的用户共同触发限制；详见 [Rate limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。

4. 首次部署 Worker：

```bash
npx wrangler deploy --config relay/cloudflare/wrangler.jsonc
```

5. 为签名链接设置至少 32 字节的随机密钥。`secret put` 会立即部署一个新版本：

```bash
npx wrangler secret put MEDIA_SIGNING_KEY --config relay/cloudflare/wrangler.jsonc
```

6. 对 R2 bucket 添加 `media/` 前缀的一天生命周期规则，作为对象清理机制：

```bash
npx wrangler r2 bucket lifecycle add sanmao-media-relay expire-media-after-one-day media/ --expire-days 1
```

生命周期是异步清理；链接在 30 分钟后即不可读，而对象删除通常会在生命周期到期后 24 小时内完成。详见 [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)。部署后确认规则存在：

```bash
npx wrangler r2 bucket lifecycle list sanmao-media-relay
```

7. 检查 `https://<worker-host>/api/health` 返回 `200` 和 `"ok":true`，再用 SANMAO.AI 测试一张参考图的上传及回读。

8. 将 Worker 的稳定 HTTPS 根地址写入仓库根目录 `relay/default-config.json` 的 `defaultMediaRelayUrl` 字段。它是公开地址，不包含签名密钥。先确认 `/api/health`、上传和签名图片回读均成功，再从包含该配置的 `main` 构建 ZIP 和 DMG。

## 费用、滥用与停用

- 公开匿名上传入口限制图片为 4 MiB，并通过 Cloudflare Rate Limiting 按 IP 约束频率。该计数是按 Cloudflare 位置分布的近似值，可能超出阈值，也可能让共享出口 IP 的用户共同触发限流；它不是硬性的用量或费用封顶。
- 上线前启用 Cloudflare 账号的用量/账单通知，并定期查看 Worker 请求量、CPU 错误和 R2 存储与操作量。Worker 可观测性已开启。不要对外承诺服务永久免费或绝对可用。
- 暂停新上传：在 Worker 的变量中将 `MEDIA_UPLOADS_ENABLED` 设为 `false` 并部署。健康检查和新上传会返回 `503`，已有签名图片仍可读到各自 30 分钟到期。完全停服可删除 Worker；R2 lifecycle 规则仍负责清理存量对象。
- 图片会经过 Cloudflare Worker 并存入项目方的 R2 bucket。签名链接无需登录即可在有效期内读取，因此不要上传不应交给所选模型服务商处理的图片。

## 高级用户自托管 Docker relay

1. 准备一个域名，把 DNS A/AAAA 记录指向服务器，并确保服务器 `80/443` 端口可访问。
2. 将 `relay/.env.example` 复制为 `relay/.env`，填写 `SANMAO_RELAY_DOMAIN`、`SANMAO_RELAY_PUBLIC_BASE_URL` 和随机的 `SANMAO_MASTER_KEY`。域名配置必须一致。
3. 在仓库根目录执行：

```bash
docker compose -f relay/docker-compose.yml --env-file relay/.env up -d --build
```

4. Caddy 会申请和续期 HTTPS。检查 `https://你的域名/api/health`，再将该地址配置为客户端的 `SANMAO_MEDIA_RELAY_URL`。

## 接口与兼容性

- `POST /api/relay/media`：Worker 接受 `image/jpeg`、`image/png`、`image/webp` 或 `image/gif` 原始请求体；自托管服务仍兼容 `multipart/form-data`（`file` 和 `kind=image`）。
- `GET /api/relay/media/<token>`：读取短期签名图片。
- `GET /api/health`：健康检查。

客户端只转发本地图片，不会转发已有公网图片 URL。Worker 的轻量格式/尺寸检查与客户端的完整图片解码校验配合使用；Worker 本身不承担图像转码。
