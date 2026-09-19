import { isTrustedAppRequest } from '@/lib/auth';
import { ATTACHMENT_MAX_BYTES, extractAttachmentText, isBinaryAttachmentName } from '@/lib/attachments/extract';

export const runtime = 'nodejs';
export const maxDuration = 120;

function formatMegabytes(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/**
 * 用户上传的 Word/Excel/PPT/PDF 在这里解析成纯文本，前端只保存解析结果。
 * 这样对话链路完全不用改：附件进上下文时本来就只有文本一种形态。
 */
export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const file = (await request.formData()).get('file');
    if (!(file instanceof File)) return Response.json({ error: '缺少要解析的文件。' }, { status: 400 });
    if (!isBinaryAttachmentName(file.name)) {
      return Response.json({ error: '这个文件类型不支持解析，请上传 Word、Excel、PPT 或 PDF 文件。' }, { status: 415 });
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      return Response.json({ error: `${file.name} 超过 ${formatMegabytes(ATTACHMENT_MAX_BYTES)}，请拆分后上传。` }, { status: 413 });
    }
    const parsed = await extractAttachmentText(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!parsed) return Response.json({ error: '这个文件类型不支持解析。' }, { status: 415 });
    if (!parsed.text.trim()) {
      return Response.json({ error: `${file.name} 里没有可提取的文字，可能是扫描件或纯图片内容，请改用文字版或直接粘贴文字。` }, { status: 422 });
    }
    return Response.json({ ok: true, name: file.name, size: file.size, text: parsed.text, truncated: parsed.truncated });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '文件解析失败。' }, { status: 400 });
  }
}
