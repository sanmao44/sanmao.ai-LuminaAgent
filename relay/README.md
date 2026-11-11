# SANMAO.AI 临时媒体中转服务

中转服务让远程模型读取用户电脑上的参考图片。客户端先用 `sharp` 校验图片，再以原始流上传；Worker 将图片写入 R2。服务不接收模型 API Key 或提示词。图片链接 30 分钟后失效，R2 生命周期规则负责随后删除对象。

## 面向普通用户

项目维护者部署并发布一个共享 Worker 后，只需将它的 HTTPS 地址设为发行版的 `SANMAO_DEFAULT_MEDIA_RELAY_URL`。Windows 本机、Windows 局域网、macOS 和 Linux 启动器会识别这个默认值并跳过本机 Quick Tunnel。用户无需 Cloudflare 账号、域名或服务器。

当前仓库提供 Worker 和客户端接入，但还没有已部署的共享地址。填入并分发真实地址之前，发行版仍会沿用现有的本机临时隧道，或使用用户配置的自托管服务。

## Cloudflare Worker + R2 部署

此部署由项目维护者完成一次，所有发行版用户共用。Workers Free 当前有每日 100,000 次请求和每次 HTTP 请求 10 ms CPU 限制；公开共享服务建议使用 Workers Paid，并观察真实请求的 CPU 和 R2 用量。详见 [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)。

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

8. 将 Worker 的 HTTPS 根地址作为发布配置注入 `SANMAO_DEFAULT_MEDIA_RELAY_URL`。启动器和 Next.js 会从进程环境或项目根目录的 `.env` 加载此变量。有默认地址时启动器会关闭旧 Quick Tunnel；空缺时仍使用原启动流程。确认配置随 Windows、macOS、Linux 和局域网发行包分发后，再向用户发布。

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
