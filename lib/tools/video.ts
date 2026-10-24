import { defineTool, nativeToolId, TOOL_GATE } from './registry';
import { VIDEO_DOWNLOAD_BROWSER_SESSIONS } from '@/packages/contracts/video-download';

/** Download one public video URL through the server-side yt-dlp adapter. */
export const videoDownloadTool = defineTool({
  id: nativeToolId('video_download'),
  name: 'video_download',
  description: '下载用户明确提供的公开 HTTP/HTTPS 视频地址。使用 yt-dlp 官方提取器覆盖抖音等支持平台；仅下载单个视频，不下载播放列表。微信视频号分享页目前没有官方提取器，但用户有权访问的直接媒体 URL 仍可按通用地址尝试。成功后返回项目内可访问的视频地址。需要真实执行时必须调用此工具，不能只描述命令或假造下载链接。',
  permissions: ['network', 'process', 'artifact:write'],
  tags: ['video'],
  source: 'native',
  risk: 'write',
  gating: TOOL_GATE.video,
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', format: 'uri', description: '公开 HTTP 或 HTTPS 视频地址' },
      format: { type: 'string', enum: ['best', 'bestvideo+bestaudio/best'], description: '可选格式偏好；默认使用最佳可用音视频' },
      cookiesFromBrowser: {
        type: 'string',
        enum: [...VIDEO_DOWNLOAD_BROWSER_SESSIONS],
        description: 'Optional explicit authorization: read cookies from this browser on the machine running SANMAO.AI and send matching cookies to the video site for this download. Set only when the user explicitly authorizes this for the current URL. Never use to bypass a paywall, DRM, or access restriction.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
});
