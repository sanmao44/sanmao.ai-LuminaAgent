import type { CreativeReviewEvidence, CreativeReviewReport } from '@/packages/contracts/creative-review';

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
  return evidence.status === 'fail' ? '发现问题' : '需要关注';
}
function sourceLabel(evidence: CreativeReviewEvidence) {
  if (evidence.status === 'unknown') return null;
  if (evidence.source === 'rule') return '规则检查';
  return evidence.source === 'embedding' ? '图像向量' : '视觉模型';
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

export default function CreativeReviewPanel({ reports }: Props) {
  if (!reports?.length) return null;

  const actionableReports = reports.map((report, index) => ({
    report,
    index,
    findings: [report.capability, report.safety].flatMap((section) => section.evidence.filter((evidence) => evidence.status === 'fail')),
  })).filter((entry) => entry.findings.length > 0);
  const issues = actionableReports.reduce((count, entry) => count + entry.findings.length, 0);
  if (!actionableReports.length) return null;

  const findingLabels = [...new Set(actionableReports.flatMap((entry) => entry.findings)
    .map((evidence) => DIMENSION_LABELS[evidence.dimension] || evidence.dimension.replaceAll('_', ' ')))];

  return <details className="creative-review-panel">
    <summary>
      查看问题
      <span className="creative-review-status fail">发现 {issues} 项问题</span>
      <span className="creative-review-summary-findings">{findingLabels.slice(0, 2).join('、')}{findingLabels.length > 2 ? '等' : ''}</span>
    </summary>
    <div className="creative-review-panel-content">
      <p className="creative-review-note">
        这里只列出已确认的问题。没有结论的检查不会被当作失败。
      </p>
      {actionableReports.map(({ report, index, findings }) => {
        return <article className="creative-review-report" key={report.artifactRef + '-' + index}>
          {reports.length > 1 && <h4>第 {index + 1} {report.mediaKind === 'image' ? '张图片' : '个视频'}</h4>}
          <section className="creative-review-section">
            <header><strong>需要关注</strong><span className="creative-review-status fail">{findings.length} 项</span></header>
            <ul>{findings.map((evidence, itemIndex) => <ReviewEvidence key={evidence.dimension + '-' + itemIndex} evidence={evidence} />)}</ul>
          </section>
        </article>;
      })}
    </div>
  </details>;
}
