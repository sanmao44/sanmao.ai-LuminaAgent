/**
 * P1 creative-review contract.
 *
 * A review deliberately has two independent sections.  A media file can be
 * structurally valid while its brief or safety cannot be confirmed, so there
 * is no combined score and `unknown` never counts as a pass.
 */

export type CreativeReviewStatus = 'pass' | 'fail' | 'unknown';
export type CreativeReviewMediaKind = 'image' | 'video';
export type CreativeReviewEvidenceSource = 'rule' | 'embedding' | 'vision';

export type CreativeReviewEvidence = {
  dimension: string;
  status: CreativeReviewStatus;
  criterion: string;
  observed?: string | number | boolean;
  expected?: string | number | boolean;
  reason: string;
  source: CreativeReviewEvidenceSource;
  /** Bounded, human-readable location inside the artifact. */
  location?: string;
};

export type CreativeReviewSection = {
  status: CreativeReviewStatus;
  evidence: readonly CreativeReviewEvidence[];
};

export type CreativeReviewReport = {
  version: 'p1';
  mediaKind: CreativeReviewMediaKind;
  artifactRef: string;
  checkedAt: string;
  capability: CreativeReviewSection;
  safety: CreativeReviewSection;
};



function isStatus(value: unknown): value is CreativeReviewStatus {
  return value === 'pass' || value === 'fail' || value === 'unknown';
}

function isEvidenceValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string'
    ? value.trim().length > 0
    : typeof value === 'number' ? Number.isFinite(value) : typeof value === 'boolean';
}

function isEvidence(value: unknown): value is CreativeReviewEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const evidence = value as Partial<CreativeReviewEvidence>;
  return typeof evidence.dimension === 'string'
    && evidence.dimension.trim().length > 0
    && isStatus(evidence.status)
    && typeof evidence.criterion === 'string'
    && evidence.criterion.trim().length > 0
    && typeof evidence.reason === 'string'
    && evidence.reason.trim().length > 0
    && ['rule', 'embedding', 'vision'].includes(String(evidence.source))
    && (evidence.observed === undefined || isEvidenceValue(evidence.observed))
    && (evidence.expected === undefined || isEvidenceValue(evidence.expected))
    && (evidence.location === undefined
      || (typeof evidence.location === 'string' && evidence.location.trim().length > 0))
    && (evidence.status === 'unknown' || evidence.observed !== undefined);
}

function statusFromEvidence(evidence: readonly CreativeReviewEvidence[]): CreativeReviewStatus {
  if (evidence.some((item) => item.status === 'fail')) return 'fail';
  return evidence.some((item) => item.status === 'unknown') ? 'unknown' : 'pass';
}

/** Validate the JSON-persisted report before rendering it from chat history. */
export function isCreativeReviewReport(value: unknown): value is CreativeReviewReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Partial<CreativeReviewReport>;
  const isSection = (section: unknown): section is CreativeReviewSection => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) return false;
    const candidate = section as Partial<CreativeReviewSection>;
    return isStatus(candidate.status)
      && Array.isArray(candidate.evidence)
      && candidate.evidence.length > 0
      && candidate.evidence.every(isEvidence)
      && statusFromEvidence(candidate.evidence) === candidate.status;
  };
  return report.version === 'p1'
    && (report.mediaKind === 'image' || report.mediaKind === 'video')
    && typeof report.artifactRef === 'string'
    && report.artifactRef.trim().length > 0
    && typeof report.checkedAt === 'string'
    && Number.isFinite(Date.parse(report.checkedAt))
    && isSection(report.capability)
    && isSection(report.safety);
}
