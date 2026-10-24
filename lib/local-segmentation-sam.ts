export type LocalSegmentationTensor = {
  dims: readonly number[];
  data: ArrayLike<number>;
};

export type LocalSegmentationMaskCandidate = {
  width: number;
  height: number;
  data: ArrayLike<number>;
  offset: number;
};

export function selectLocalSegmentationMaskCandidate(
  tensor: LocalSegmentationTensor | undefined,
  scores: ArrayLike<number>,
): LocalSegmentationMaskCandidate | null {
  if (!tensor || tensor.dims.length !== 4) return null;

  const [batchSize, candidateCount, height, width] = tensor.dims;
  const dimensions = [batchSize, candidateCount, height, width];
  if (dimensions.some((dimension) => !Number.isInteger(dimension) || dimension < 1)) return null;
  if (tensor.data.length < batchSize * candidateCount * height * width) return null;

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  const scoreCount = Math.min(candidateCount, scores.length);
  for (let index = 0; index < scoreCount; index += 1) {
    const score = Number(scores[index]);
    if (Number.isFinite(score) && score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }

  return {
    width,
    height,
    data: tensor.data,
    offset: bestIndex * height * width,
  };
}
