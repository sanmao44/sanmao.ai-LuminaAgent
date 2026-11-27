import type { CreativeReviewEvidence, CreativeReviewReport, CreativeReviewSection } from '@/packages/contracts/creative-review';

type Props = {
  reports?: readonly CreativeReviewReport[];
};

const DIMENSION_LABELS: Record<string, string> = {
  black_frame_hints: '黑帧检查',
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

function statusLabel(status: CreativeReviewEvidence['status']) {
  return status === 'pass' ? '符合该检查' : status === 'fail' ? '发现问题' : '未评估';
}

function sectionStatusLabel(status: CreativeReviewSection['status']) {
  return status === 'pass' ? '已检查项符合' : status === 'fail' ? '发现问题' : '尚有未评估项';
}

function sourceLabel(evidence: CreativeReviewEvidence) {
  if (evidence.source === 'rule') return '规则检查';
  if (evidence.source === 'embedding') return evidence.status === 'unknown' ? '图像向量评审未完成' : '图像向量';
  return evidence.status === 'unknown' ? '视觉评审未完成' : '视觉模型';
}

function valueLabel(value: CreativeReviewEvidence['observed'] | CreativeReviewEvidence['expected']) {
  return value === undefined ? null : String(value);
}

function ReviewEvidence({ evidence }: { evidence: CreativeReviewEvidence }) {
  const observed = valueLabel(evidence.observed);
  const expected = valueLabel(evidence.expected);
  return <li className="creative-review-evidence">
    <div className="creative-review-evidence-heading">
      <strong>{DIMENSION_LABELS[evidence.dimension] || evidence.dimension.replaceAll('_', ' ')}</strong>
      <span className={'creative-review-status ' + evidence.status}>{statusLabel(evidence.status)}</span>
    </div>
    <p>{evidence.reason}</p>
    <small>{evidence.criterion}</small>
    {(observed !== null || expected !== null) && <dl>
      {observed !== null && <div><dt>实测</dt><dd>{observed}</dd></div>}
      {expected !== null && <div><dt>标准</dt><dd>{expected}</dd></div>}
    </dl>}
    <small className="creative-review-source">依据：{sourceLabel(evidence)}</small>
  </li>;
}

function ReviewSection({ title, value }: { title: string; value: CreativeReviewSection }) {
  return <section className="creative-review-section">
    <header><strong>{title}</strong><span className={'creative-review-status ' + value.status}>{sectionStatusLabel(value.status)}</span></header>
    <ul>{value.evidence.map((evidence, index) => <ReviewEvidence key={evidence.dimension + '-' + index} evidence={evidence} />)}</ul>
  </section>;
}

export default function CreativeReviewPanel({ reports }: Props) {
  return <section className="creative-review-panel" aria-label="产物评审结果">
    <header className="creative-review-panel-heading">
      <strong>产物评审</strong>
      <span>能力检查与安全判断分开列出；“未评估”不代表通过。</span>
    </header>
    {reports && reports.length > 0 ? reports.map((report, index) => <article className="creative-review-report" key={report.artifactRef + '-' + index}>
      {reports.length > 1 && <h4>第 {index + 1} {report.mediaKind === 'image' ? '张图片' : '个视频'}</h4>}
      <div className="creative-review-sections">
        <ReviewSection title="能力检查" value={report.capability} />
        <ReviewSection title="安全判断" value={report.safety} />
      </div>
    </article>) : <p className="creative-review-empty">此任务没有已保存的评审记录。</p>}
  </section>;
}
