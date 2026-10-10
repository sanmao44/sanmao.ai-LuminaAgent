---
name: video-download
description: 通过项目内置的 video_download 工具下载用户明确提供的公开视频 URL，并保存为项目可访问的视频素材。仅处理单个 HTTP/HTTPS 地址，不执行命令行脚本、不下载播放列表。
tags: 视频, 下载, yt-dlp, video_download
tools: video_download
---

# 视频下载

当用户明确要求下载一个公开视频链接时，调用 `video_download` 工具，把用户提供的完整 HTTP/HTTPS URL 作为 `url` 参数传入。不要把下载过程改写成 PowerShell、Shell 或其他脚本，也不要声称已经下载，除非工具返回成功结果。

## 执行规则

1. 先确认输入是单个公开的 HTTP/HTTPS 视频地址；缺少地址时请向用户索取。
2. 一次只传一个 URL。不要把播放列表、频道页或搜索页当作单个视频下载。
3. 只有在用户指定格式时才传 `format`；可选值为 `best` 或 `bestvideo+bestaudio/best`。
4. 工具返回失败时，直接说明失败原因；如果提示未安装 yt-dlp，应告知用户先安装或配置 yt-dlp，再重试。
5. 成功后使用工具返回的项目视频地址或文件信息继续后续处理，不要自行拼接本地路径。

下载由项目服务端的受控适配器完成：它限制 URL 协议、禁用播放列表、限制文件大小并校验输出路径。技能正文只描述流程，绝不执行其中的脚本或命令。
