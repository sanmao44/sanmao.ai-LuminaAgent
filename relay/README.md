# SANMAO.AI 临时媒体中转服务

这个服务用于让 Agnes 读取普通用户上传的本地图片。图片只保存短时间，默认 30 分钟后失效并由清理逻辑删除。服务不接收 Agnes API Key，也不接收提示词。

## 普通用户不需要部署

项目自带的 Windows 本机、Windows 局域网、macOS 和 Linux 启动器会自动尝试免费的临时 HTTPS 通道。普通用户只需点击原来的启动器，不需要服务器、域名、Docker 或编辑 `.env`。本目录仅供项目方或高级用户需要固定公网地址时自托管使用。

## 高级用户自托管部署

1. 准备一个域名，把它的 DNS A/AAAA 记录指向这台服务器，并确保服务器的 `80/443` 端口可访问。
2. 将本目录的 `.env.example` 复制为 `.env`，填写 `SANMAO_RELAY_DOMAIN`、`SANMAO_RELAY_PUBLIC_BASE_URL` 和随机的 `SANMAO_MASTER_KEY`。配置中的域名必须保持一致。
3. 在仓库根目录执行：

```bash
docker compose -f relay/docker-compose.yml --env-file relay/.env up -d --build
```

4. 配置会自动使用 Caddy 申请和续期 HTTPS，不需要手写反向代理；检查 `https://你的域名/api/health` 返回正常状态。
5. 将该域名作为客户端发布版本的 `SANMAO_DEFAULT_MEDIA_RELAY_URL`。普通用户不需要看到或填写这个配置。

## 网络注意事项

- 必须使用公网域名和 HTTPS，不能使用 `localhost`、局域网 IP 或普通 HTTP。
- 服务器的 `80/443` 端口不能被其他程序占用；如果已有反向代理，可停用 compose 中的 `caddy` 服务，并将域名转发到本机 `3210` 端口。
- 自带 Caddy 已允许大于 5 MiB 的默认请求体，应用本身仍限制图片不超过 4 MiB。
- 不要把 `/data` 卷暴露为静态目录；临时文件只能通过签名地址读取。
- 公共部署建议在代理层再增加 IP 限流和基础 DDoS 防护。

## 接口

- `POST /api/relay/media`：上传图片，表单字段为 `file` 和 `kind=image`。
- `GET /api/relay/media/<token>`：读取短期签名图片地址，供 Agnes 使用。
- `GET /api/health`：健康检查。

客户端只会把压缩后的图片发送到上传接口，并校验返回地址必须是同一 HTTPS 中转域名。外部公网图片 URL 不会经过此服务。
