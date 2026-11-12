export type TimestampedTranscriptWord = {
  start: number;
  end: number;
  text: string;
};

export type TimestampedTranscriptSegment = {
  start: number;
  end: number;
  text: string;
  words?: TimestampedTranscriptWord[];
};

export type LocalTranscriptionResult = {
  text: string;
  segments: TimestampedTranscriptSegment[];
  words: TimestampedTranscriptWord[];
  model: string;
  language?: string;
};
