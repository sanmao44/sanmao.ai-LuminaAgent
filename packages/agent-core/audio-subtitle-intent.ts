const subtitleDenialPattern = /(?:不要|无需|不需要|不必|不用|别|不想|先不|暂时不).{0,10}(?:生成|制作|做|导出|输出|字幕|srt|vtt)|(?:don't|do not|no need to|without|skip).{0,24}(?:subtitle|captions|srt|vtt)/iu;
const subtitleRequestPattern = /(?:生成|制作|做成?|导出|输出|创建|转换成|转成|转为|配上|加上).{0,12}(?:字幕|srt|vtt)|(?:字幕|srt|vtt).{0,12}(?:文件|时间轴|生成|制作|导出|输出|转换)|(?:给我|帮我|请|需要|想要).{0,8}(?:字幕|srt|vtt)|(?:subtitle|captions|srt|vtt).{0,16}(?:file|generate|create|export)/iu;

export function isAudioSubtitleRequest(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || subtitleDenialPattern.test(text)) return false;
  return subtitleRequestPattern.test(text);
}
