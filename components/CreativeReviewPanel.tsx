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
  if ((evidence.dimension === 'brief_visual_compliance' || evidence.dimension === 'brief_alignment')
    && evidence.observed !== undefined) return '未得出结论';
  return '未评估';
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
  return evidence.status === 'unknown' && evidence.observed === undefined;
}

function unevaluatedLabel(evidence: CreativeReviewEvidence) {
  return DIMENSION_LABELS[evidence.dimension] || evidence.dimension.replaceAll('_', ' ');
}

function unevaluatedCause(evidence: CreativeReviewEvidence) {
  if (/超时|取消|失败|未能完成/u.test(evidence.reason)) return '评审未完成';
  if (/评审器|模型/u.test(evidence.reason)) return '没有启用可用的对应评审器';
  return '缺少可复核的评审输入';
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
    ? '未启用相关评审'
    : sectionStatusLabel(value.status);
  return <section className="creative-review-section">
    <header><strong>{title}</strong><span className={'creative-review-status ' + value.status}>{status}</span></header>
    {visibleEvidence.length > 0
      ? <ul>{visibleEvidence.map((evidence, index) => <ReviewEvidence key={evidence.dimension + '-' + index} evidence={evidence} />)}</ul>
      : <p className="creative-review-note">本节没有启用可用的评审器。</p>}
  </section>;
}

export default function CreativeReviewPanel({ reports }: Props) {
  if (!reports?.length) return <p className="creative-review-empty">此任务没有已保存的评审记录。</p>;

  const issues = reports.reduce((count, report) => count
    + report.capability.evidence.filter((item) => item.status === 'fail').length
    + report.safety.evidence.filter((item) => item.status === 'fail').length, 0);
  const unevaluatedEvidence = reports.flatMap((report) => [...report.capability.evidence, ...report.safety.evidence])
    .filter(isUnevaluated);
  const unevaluated = unevaluatedEvidence.map(unevaluatedLabel);
  const unevaluatedCounts = [...new Set(unevaluated)].map((label) => ({
    label,
    count: unevaluated.filter((item) => item === label).length,
  }));
  const unevaluatedCauses = [...new Set(unevaluatedEvidence.map(unevaluatedCause))];

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
