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
  if (evidence.status === 'pass') return '符合该检查';
  if (evidence.status === 'fail') return '发现问题';
  return isUnevaluated(evidence) ? '未评估' : '未得出结论';
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

function ReviewSection({ title, evidence }: { title: string; evidence: readonly CreativeReviewEvidence[] }) {
  if (evidence.length === 0) return null;

  return <section className="creative-review-section">
    <header><strong>{title}</strong></header>
    <ul>{evidence.map((item, index) => <ReviewEvidence key={item.dimension + '-' + index} evidence={item} />)}</ul>
  </section>;
}

export default function CreativeReviewPanel({ reports }: Props) {
  if (!reports?.length) return <p className="creative-review-empty">此任务没有已保存的评审记录。</p>;

  const issues = reports.reduce((count, report) => count
    + report.capability.evidence.filter((item) => item.status === 'fail').length
    + report.safety.evidence.filter((item) => item.status === 'fail').length, 0);
  if (issues === 0) return null;

  const findingLabels = [...new Set(reports.flatMap((report) => [...report.capability.evidence, ...report.safety.evidence])
    .filter((evidence) => evidence.status === 'fail')
    .map((evidence) => DIMENSION_LABELS[evidence.dimension] || evidence.dimension.replaceAll('_', ' ')))];

  return <details className="creative-review-panel">
    <summary>
      查看产物检查
      <span className="creative-review-status fail">发现 {issues} 项问题</span>
      <span className="creative-review-summary-findings">{findingLabels.slice(0, 2).join('、')}{findingLabels.length > 2 ? '等' : ''}</span>
    </summary>
    <div className="creative-review-panel-content">
      <p className="creative-review-note">
        这里只列出检查发现的问题。未评估表示没有可用的对应评审器，不代表产物失败。
      </p>
      {reports.map((report, index) => {
        const sections = [report.capability, report.safety];
        const findings = sections.flatMap((section) => section.evidence.filter((evidence) => evidence.status === 'fail'));
        const remaining = sections.flatMap((section) => section.evidence.filter((evidence) => evidence.status !== 'fail'));
        const passedCount = remaining.filter((evidence) => evidence.status === 'pass').length;
        const unevaluatedCount = remaining.filter(isUnevaluated).length;
        const inconclusiveCount = remaining.filter((evidence) => evidence.status === 'unknown' && !isUnevaluated(evidence)).length;

        return <article className="creative-review-report" key={report.artifactRef + '-' + index}>
          {reports.length > 1 && <h4>第 {index + 1} {report.mediaKind === 'image' ? '张图片' : '个视频'}</h4>}
          <section className="creative-review-section">
            <header><strong>需要关注</strong><span className="creative-review-status fail">{findings.length} 项</span></header>
            <ul>{findings.map((evidence, itemIndex) => <ReviewEvidence key={evidence.dimension + '-' + itemIndex} evidence={evidence} />)}</ul>
          </section>
          {remaining.length > 0 && <details className="creative-review-additional">
            <summary>其余检查结果：通过 {passedCount} 项 · 未评估 {unevaluatedCount} 项 · 无结论 {inconclusiveCount} 项</summary>
            <div className="creative-review-sections">
              <ReviewSection title="能力检查" evidence={report.capability.evidence.filter((evidence) => evidence.status !== 'fail')} />
              <ReviewSection title="安全判断" evidence={report.safety.evidence.filter((evidence) => evidence.status !== 'fail')} />
            </div>
          </details>}
        </article>;
      })}
    </div>
  </details>;
}
