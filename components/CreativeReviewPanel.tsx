import type { CreativeReviewEvidence, CreativeReviewReport, CreativeReviewSection } from '@/packages/contracts/creative-review';

type Props = {
  reports?: readonly CreativeReviewReport[];
};

const DIMENSION_LABELS: Record<string, string> = {
  black_frame_hints: '黑帧检查',
  brief_alignment: '画面与需求一致性',
  brief_visual_compliance: '画面与需求一致性',
  content_safety: '内容安全',
  freeze_hints: '画面冻结检查',
  image_decode: '图片完整解码',
  local_artifact_access: '本地文件访问边界',
  local_artifact_read: '本地文件读取',
  pixel_dimensions: '图片尺寸',
  requested_aspect_ratio: '目标画面比例',
  requested_duration: '目标时长',
  video_decode: '视频完整解码',
  video_decoder: '本地视频解码器',
  video_dimensions: '视频尺寸',
  video_duration: '视频时长',
  video_review: '视频评审',
  visual_quality: '视觉质量',
};

function statusLabel(evidence: CreativeReviewEvidence) {
  if (evidence.status === 'pass') return '符合该检查';
  if (evidence.status === 'fail') return '发现问题';
  return isUnevaluated(evidence) ? '未评估' : '未得出结论';
}
function sectionStatusLabel(status: CreativeReviewSection['status']) {
  return status === 'pass' ? '已检查项符合' : status === 'fail' ? '发现问题' : '部分检查无结论';
}

function sourceLabel(evidence: CreativeReviewEvidence) {
  if (evidence.status === 'unknown') return null;
  if (evidence.source === 'rule') return '规则检查';
  return evidence.source === 'embedding' ? '图像向量' : '视觉模型';
}

function isUnevaluated(evidence: CreativeReviewEvidence) {
  return unevaluatedCause(evidence) !== null;
}

function unevaluatedCause(evidence: CreativeReviewEvidence): string | null {
  if (evidence.status !== 'unknown' || evidence.observed !== undefined) return null;
  const reason = evidence.reason;
  if (/没有启用|未启用|没有经标注|没有经校准|没有已校准|没有可验证的质量模型/u.test(reason)) {
    return '没有启用可用的对应评审器';
  }
  if (evidence.dimension === 'content_safety'
    && /本地文件和比例检查不分析画面语义|未评审内容安全|没有已校准的本地内容安全评审器/u.test(reason)) {
    return '没有启用可用的对应评审器';
  }
  if (evidence.dimension === 'subtitle_timeline' && /未提取|未识别|尚未评审/u.test(reason)) {
    return '本版本没有进行字幕时间线评审';
  }
  if (/没有保留到原始创作需求|没有有效的明确目标比例|没有有效的目标时长/u.test(reason)) {
    return '缺少可评估的需求信息';
  }
  return null;
}
function unevaluatedLabel(evidence: CreativeReviewEvidence) {
  return DIMENSION_LABELS[evidence.dimension] || evidence.dimension.replaceAll('_', ' ');
}

function valueLabel(value: CreativeReviewEvidence['observed'] | CreativeReviewEvidence['expected']) {
  return value === undefined ? null : String(value);
}

function ReviewEvidence({ evidence }: { evidence: CreativeReviewEvidence }) {
  const observed = valueLabel(evidence.observed);
  const expected = valueLabel(evidence.expected);
  const source = sourceLabel(evidence);
  return <li className="creative-review-evidence">
    <div className="creative-review-evidence-heading">
      <strong>{DIMENSION_LABELS[evidence.dimension] || evidence.dimension.replaceAll('_', ' ')}</strong>
      <span className={'creative-review-status ' + evidence.status}>{statusLabel(evidence)}</span>
    </div>
    <p>{evidence.reason}</p>
    <small>{evidence.criterion}</small>
    {(observed !== null || expected !== null) && <dl>
      {observed !== null && <div><dt>实测</dt><dd>{observed}</dd></div>}
      {expected !== null && <div><dt>标准</dt><dd>{expected}</dd></div>}
    </dl>}
    {source && <small className="creative-review-source">依据：{source}</small>}
  </li>;
}

function ReviewSection({ title, value }: { title: string; value: CreativeReviewSection }) {
  const visibleEvidence = value.evidence.filter((evidence) => !isUnevaluated(evidence));
  const hasUnevaluated = visibleEvidence.length !== value.evidence.length;
  const status = value.status === 'unknown' && hasUnevaluated && !visibleEvidence.some((evidence) => evidence.status === 'unknown')
    ? '部分检查未评估'
    : sectionStatusLabel(value.status);
  return <section className="creative-review-section">
    <header><strong>{title}</strong><span className={'creative-review-status ' + value.status}>{status}</span></header>
    {visibleEvidence.length > 0
      ? <ul>{visibleEvidence.map((evidence, index) => <ReviewEvidence key={evidence.dimension + '-' + index} evidence={evidence} />)}</ul>
      : <p className="creative-review-note">本节有未评估的检查项，原因见上方说明。</p>}
  </section>;
}

export default function CreativeReviewPanel({ reports }: Props) {
  if (!reports?.length) return <p className="creative-review-empty">此任务没有已保存的评审记录。</p>;

  const issues = reports.reduce((count, report) => count
    + report.capability.evidence.filter((item) => item.status === 'fail').length
    + report.safety.evidence.filter((item) => item.status === 'fail').length, 0);
  if (issues === 0) return null;

  const unevaluatedEvidence = reports.flatMap((report) => [...report.capability.evidence, ...report.safety.evidence])
    .filter(isUnevaluated);
  const unevaluated = unevaluatedEvidence.map(unevaluatedLabel);
  const unevaluatedCounts = [...new Set(unevaluated)].map((label) => ({
    label,
    count: unevaluated.filter((item) => item === label).length,
  }));
  const unevaluatedCauses = [...new Set(unevaluatedEvidence.map(unevaluatedCause).filter((cause): cause is string => cause !== null))];

  return <details className="creative-review-panel">
    <summary>
      产物检查明细
      {issues > 0 && <span className="creative-review-status fail">发现 {issues} 项问题</span>}
    </summary>
    <div className="creative-review-panel-content">
      <p className="creative-review-note">
        检查结果按项目记录。
        {unevaluatedCounts.length > 0
          ? ` ${unevaluatedCounts.map(({ label, count }) => `${label}${count > 1 ? `（${count} 项）` : ''}`).join('、')}暂未评估（${unevaluatedCauses.join('；')}）；这不代表图片失败。`
          : ' 未评估的项目暂无通过或失败结论。'}
      </p>
      {reports.map((report, index) => <article className="creative-review-report" key={report.artifactRef + '-' + index}>
        {reports.length > 1 && <h4>第 {index + 1} {report.mediaKind === 'image' ? '张图片' : '个视频'}</h4>}
        <div className="creative-review-sections">
          <ReviewSection title="能力检查" value={report.capability} />
          <ReviewSection title="安全判断" value={report.safety} />
        </div>
      </article>)}
    </div>
  </details>;
}
