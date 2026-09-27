import type { CloneBeatCue } from './types';

function round3(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

/** Parse FFmpeg ametadata/astats RMS samples into bounded local beat cues. */
export function parseAudioBeatMetadata(stderr: string, durationSeconds = 0): CloneBeatCue[] {
  const values: Array<{ time: number; energy: number }> = [];
  let time = 0;
  for (const line of String(stderr || '').split(/\r?\n/u)) {
    const timeMatch = line.match(/pts_time[:=](-?(?:\d+(?:\.\d+)?))/iu);
    if (timeMatch) time = Math.max(0, Number(timeMatch[1]) || time);
    const rms = line.match(/(?:RMS[_ ]level(?: dB)?[:=]|lavfi\.astats\.Overall\.RMS_level=)\s*(-?(?:\d+(?:\.\d+)?|inf))/iu);
    if (!rms) continue;
    const db = Number(rms[1]);
    if (Number.isFinite(db)) values.push({ time: round3(time), energy: Math.max(0, db + 60) });
    time = round3(time + 0.1);
  }
  if (values.length < 3) return [];
  const sorted = values.map((item) => item.energy).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.55)] || 0;
  const threshold = Math.max(floor + 6, sorted[Math.floor(sorted.length * 0.78)] || floor + 6);
  const beats: CloneBeatCue[] = [];
  values.forEach((item, index) => {
    if (item.energy < threshold || item.energy < values[index - 1]?.energy || item.energy < values[index + 1]?.energy) return;
    const previous = beats.at(-1);
    const strength = round3(Math.min(1, item.energy / 60));
    if (previous && item.time - previous.time < 0.24) {
      if (strength > previous.strength) beats[beats.length - 1] = { time: item.time, strength };
      return;
    }
    if (Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0 && item.time >= Number(durationSeconds)) return;
    beats.push({ time: item.time, strength });
  });
  return beats.slice(0, 256);
}
