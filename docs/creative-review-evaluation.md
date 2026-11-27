# 创作评审器真实样本评测

评测数据只保存在本地；仓库只提供清单格式示例，不收录用户图片、视频或人工标签。准备 20 件有明确来源、已由人标注的真实作品，图片和视频各至少 5 件；每类都要同时包含合格/不合格能力标签，以及安全/不安全标签。样本应有不同 SHA-256，且每个文件必须是媒体目录里的普通文件，不能使用符号链接。

清单格式见 `docs/creative-review-evaluation-manifest.example.json`。将每个真实文件的 SHA-256、未经改写的用户原始 `brief`、目标比例/视频时长（只填 brief 明确写明的条件）、`expectedCapability`、`expectedSafety` 及两项人工 `labelRationale` 填入本地 JSON 清单。清单必须恰好 20 项，图片和视频各至少 5 项；每种媒体中的能力 `pass/fail` 和安全 `safe/unsafe` 标签都至少各有 2 项，避免一个标签占多数掩盖漏检。人工标签含义如下：

- `expectedCapability`: `pass` 表示该产物满足人评的交付要求；`fail` 表示有明确交付问题。
- `expectedSafety`: `safe` 表示可交付；`unsafe` 表示存在明确安全问题。不要把“模型没把握”标成 safe/unsafe；标签必须由人工复核给出。
- `labelRationale.capability` 与 `labelRationale.safety`: 分别记录人工标签的可复核依据；清单和报告保留这些内容，供结果复核。

先在一个全新空目录中保存 R1 报告，再用同一清单运行 R2：

```powershell
node scripts/evaluate-creative-review.mjs `
  --manifest "C:\path\to\private-labels.json" `
  --media-dir "C:\path\to\private-media" `
  --output "C:\path\to\reports\creative-review-R1.json"

node scripts/evaluate-creative-review.mjs `
  --manifest "C:\path\to\private-labels.json" `
  --media-dir "C:\path\to\private-media" `
  --previous "C:\path\to\reports\creative-review-R1.json" `
  --output "C:\path\to\reports\creative-review-R2.json"
```

R2 会拒绝清单哈希、样本文件、评审器指纹、R1 样本身份或证据不完整/不一致；并报告能力与安全各自的 R1/R2 判定一致数。两轮报告均保存逐件检查依据、人工标签依据、原始媒体哈希、耗时、`pass/fail/unknown` 混淆矩阵、准确率、覆盖率和未评估数量。`unknown` 永远不算命中。能力和安全指标分开报告，不生成总分。把人工标成 `unsafe` 的样本判成 `pass` 会触发安全零容忍失败。

当前结构评审没有模型调用，报告会将 token 与模型成本标为“不适用”，不会伪造成本。退出码 `0` 表示总体与图片/视频各自的能力和安全准确率都至少 80%，且没有 unsafe→pass；`2` 表示评审器未过门槛；`1` 表示清单、媒体边界、哈希或评测运行失败。样本缺失、哈希错误、重复样本、符号链接和并行修改都按输入错误停止，不混入评审器分数。

该评测只验证当前实际实现的判定能力。当前 brief 一致性、图片质量、字幕时间轴与内容安全语义仍为 `unknown`。视频结构评审会用 FFmpeg 生成黑帧候选（连续至少 0.50 秒、pix_th=0.10、至少 98% 像素满足阈值）和静止画面候选（连续至少 2.00 秒、帧间噪声阈值 -50 dB），并附时间区间；这些阈值尚未用真实产物校准，命中需人工复核，既不自动判失败，也不能因未命中而判通过。运行结构评审不会证明这些维度准确。当前未找到真实人工标注作品集，示例清单和自动测试都不算真实样本；因此在提供 20 件真实作品及人工标签前，不得报告 P1 的 80% 准确率门槛已通过。要覆盖视觉语义维度，仍需在不新增 npm 依赖的前提下接入经标注数据验证的视觉评审器，并将原始 brief 纳入评审输入。

