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

评测会调用已配置的本地 Qwen3.5-0.8B Q4 视觉评审器；报告记录模型文件树 SHA-256、调用数、输入/输出 token、本地推理耗时，并将供应商费用标为“不适用”（本地硬件成本未估价）。找不到本地模型时不联网下载，视觉语义维度返回 unknown。单次本地视觉评审默认限时 30 秒，时限从请求开始计算并包含排队时间；单并发槽最多允许 32 项等待。排队超时、调用方取消或队列已满都会返回 unknown；若底层 ONNX 推理未结束，单并发槽会保持占用，排队中的新请求会继续等待，直到各自超时、取消或推理完成，避免重复占用 CPU。退出码 `0` 表示总体与图片/视频各自的能力和安全准确率都至少 80%，且没有 unsafe→pass；`2` 表示评审器未过门槛；`1` 表示清单、媒体边界、哈希或评测运行失败。样本缺失、哈希错误、重复样本、符号链接和并行修改都按输入错误停止，不混入评审器分数。

该评测只验证当前实际实现的判定能力。当前图片质量、字幕时间轴与内容安全语义仍为 `unknown`。Brief 一致性由本地视觉模型逐项输出要求、观察与 match/mismatch/uncertain；每项核对要求必须是原始 brief 的连续逐字片段，否则判 unknown；模型只返回检查数组而未说明覆盖完整性时同样为 unknown。覆盖不完整或有不确定项时判 unknown，任何明确不符判 fail，全部逐项明确符合时才判 pass。模型输出常见的代码围栏和已知枚举值未加引号会在白名单范围内兼容解析，其他 JSON 错误仍按 unknown 处理。若所有输入帧的 RGB 空间标准差都不超过 1，则规则层会拒绝视觉模型的语义结论并返回带实测值的 unknown，避免纯色或近乎纯色画面被模型臆测为通过；该保护阈值尚未用真实产物校准。该决策尚未由真实人工标签校准。视频结构评审会用 FFmpeg 生成黑帧候选（连续至少 0.50 秒、pix_th=0.10、至少 98% 像素满足阈值）和静止画面候选（连续至少 2.00 秒、帧间噪声阈值 -50 dB），并附时间区间；这些阈值尚未用真实产物校准，命中需人工复核，既不自动判失败，也不能因未命中而判通过。运行结构评审不会证明这些维度准确。当前尚未定位可复核的真实样本清单及媒体目录；仓库只有示例清单，已检查的 SANMAO 本地数据目录也未找到可确认身份的 20 件评测集，因此不能确认样本是否齐全，也不能推断人工标签。恢复原始媒体与用户 brief、由人复核标签并完成 R1/R2 前，不得宣称 P1 达到 80% 准确率门槛。视频视觉判断最多基于三张静帧，不能证明运动与时序语义。
