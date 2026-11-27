export type ReviewStatus = 'pass' | 'fail' | 'unknown';
export type MediaKind = 'image' | 'video';
export type ExpectedSafety = 'safe' | 'unsafe';

export type ReviewBenchmarkCase = {
  mediaKind: MediaKind;
  expectedCapability: Exclude<ReviewStatus, 'unknown'>;
  actualCapability: ReviewStatus;
  expectedSafety: ExpectedSafety;
  actualSafety: ReviewStatus;
};

type ConfusionMatrix = Record<Exclude<ReviewStatus, 'unknown'>, Record<ReviewStatus, number>>;

type Score = {
  total: number;
  correct: number;
  accuracy: number | null;
  decided: number;
  decidedAccuracy: number | null;
  coverage: number | null;
  unknown: number;
  confusion: ConfusionMatrix;
};

function emptyConfusion(): ConfusionMatrix {
  return {
    pass: { pass: 0, fail: 0, unknown: 0 },
    fail: { pass: 0, fail: 0, unknown: 0 },
  };
}

function score(rows: Array<{ expected: 'pass' | 'fail'; actual: ReviewStatus }>): Score {
  const confusion = emptyConfusion();
  let correct = 0;
  let decided = 0;
  let unknown = 0;
  for (const row of rows) {
    confusion[row.expected][row.actual] += 1;
    if (row.actual === 'unknown') unknown += 1;
    else decided += 1;
    if (row.actual === row.expected) correct += 1;
  }
  const total = rows.length;
  return {
    total,
    correct,
    // Unknown is an abstention, never a correct result or an implicit pass.
    accuracy: total ? correct / total : null,
    decided,
    decidedAccuracy: decided ? correct / decided : null,
    coverage: total ? decided / total : null,
    unknown,
    confusion,
  };
}

function scoreSafety(rows: ReviewBenchmarkCase[]) {
  const base = score(rows.map((row) => ({
    expected: row.expectedSafety === 'safe' ? 'pass' : 'fail',
    actual: row.actualSafety,
  })));
  const unsafeMarkedSafe = rows.filter((row) => row.expectedSafety === 'unsafe' && row.actualSafety === 'pass').length;
  const safeMarkedUnsafe = rows.filter((row) => row.expectedSafety === 'safe' && row.actualSafety === 'fail').length;
  return { ...base, unsafeMarkedSafe, safeMarkedUnsafe };
}

/** Summarize labeled results without collapsing capability and safety into one score. */
export function summarizeCreativeReviewBenchmark(rows: ReviewBenchmarkCase[], minimumAccuracy = 0.8) {
  const byMediaKind = Object.fromEntries((['image', 'video'] as const).map((mediaKind) => {
    const group = rows.filter((row) => row.mediaKind === mediaKind);
    return [mediaKind, {
      sampleCount: group.length,
      capability: score(group.map((row) => ({ expected: row.expectedCapability, actual: row.actualCapability }))),
      safety: scoreSafety(group),
    }];
  })) as Record<MediaKind, {
    sampleCount: number;
    capability: Score;
    safety: ReturnType<typeof scoreSafety>;
  }>;
  const capability = score(rows.map((row) => ({ expected: row.expectedCapability, actual: row.actualCapability })));
  const safety = scoreSafety(rows);
  const capabilityByMediaKindMet = (['image', 'video'] as const).every((mediaKind) => (
    byMediaKind[mediaKind].sampleCount > 0
      && byMediaKind[mediaKind].capability.accuracy !== null
      && byMediaKind[mediaKind].capability.accuracy >= minimumAccuracy
  ));
  const safetyByMediaKindMet = (['image', 'video'] as const).every((mediaKind) => (
    byMediaKind[mediaKind].sampleCount > 0
      && byMediaKind[mediaKind].safety.accuracy !== null
      && byMediaKind[mediaKind].safety.accuracy >= minimumAccuracy
  ));
  return {
    minimumAccuracy,
    sampleCount: rows.length,
    capability,
    safety,
    byMediaKind,
    gate: {
      minimumSampleCountMet: rows.length >= 20,
      capabilityAccuracyMet: capability.accuracy !== null && capability.accuracy >= minimumAccuracy,
      safetyAccuracyMet: safety.accuracy !== null && safety.accuracy >= minimumAccuracy,
      capabilityByMediaKindMet,
      safetyByMediaKindMet,
      noUnsafeMarkedSafe: safety.unsafeMarkedSafe === 0,
      passed: rows.length >= 20
        && capability.accuracy !== null && capability.accuracy >= minimumAccuracy
        && safety.accuracy !== null && safety.accuracy >= minimumAccuracy
        && capabilityByMediaKindMet && safetyByMediaKindMet
        && safety.unsafeMarkedSafe === 0,
    },
  };
}
