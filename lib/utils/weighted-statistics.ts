/**
 * 순수 함수로만 구성된 통계 유틸리티 (Java WeightedStatistics 직접 이식).
 * 외부 라이브러리에 의존하지 않는다.
 */

export function weightedMean(values: number[], weights: number[]): number {
  let sumValueWeight = 0;
  let sumWeight = 0;
  for (let i = 0; i < values.length; i++) {
    sumValueWeight += values[i] * weights[i];
    sumWeight += weights[i];
  }
  return sumWeight === 0 ? 0 : sumValueWeight / sumWeight;
}

/** values는 전부 0보다 커야 한다 (log 계산). */
export function weightedGeometricMean(values: number[], weights: number[]): number {
  let sumLogWeight = 0;
  let sumWeight = 0;
  for (let i = 0; i < values.length; i++) {
    sumLogWeight += Math.log(values[i]) * weights[i];
    sumWeight += weights[i];
  }
  return sumWeight === 0 ? 0 : Math.exp(sumLogWeight / sumWeight);
}

/**
 * 가중 백분위수 (Hazen 방식).
 * 내부에서 값 기준 정렬 후 계산한다.
 */
export function weightedQuantile(values: number[], weights: number[], q: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];

  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => values[a] - values[b]
  );

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) return quantile(values, q);

  const sortedValues: number[] = [];
  const cumFraction: number[] = [];
  let running = 0;
  for (let i = 0; i < n; i++) {
    const idx = order[i];
    sortedValues.push(values[idx]);
    running += weights[idx];
    cumFraction.push((running - 0.5 * weights[idx]) / totalWeight);
  }

  if (q <= cumFraction[0]) return sortedValues[0];
  if (q >= cumFraction[n - 1]) return sortedValues[n - 1];

  for (let i = 0; i < n - 1; i++) {
    if (q >= cumFraction[i] && q <= cumFraction[i + 1]) {
      const span = cumFraction[i + 1] - cumFraction[i];
      const fraction = span === 0 ? 0 : (q - cumFraction[i]) / span;
      return sortedValues[i] + (sortedValues[i + 1] - sortedValues[i]) * fraction;
    }
  }
  return sortedValues[n - 1];
}

/** 가중치 없는 선형 보간 백분위수. Winsorization 기준값 계산에 쓴다. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const index = q * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const fraction = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

/** value를 [lowerBound, upperBound] 범위로 클램핑한다. */
export function clip(value: number, lowerBound: number, upperBound: number): number {
  return Math.max(lowerBound, Math.min(upperBound, value));
}

/**
 * Kish's Effective Sample Size: (Σw)² / Σ(w²).
 * 가중치가 균등하면 실제 표본 수와 같고, 쏠릴수록 작아진다.
 */
export function effectiveSampleSize(weights: number[]): number {
  const sumWeight = weights.reduce((s, w) => s + w, 0);
  const sumWeightSquared = weights.reduce((s, w) => s + w * w, 0);
  return sumWeightSquared === 0 ? 0 : (sumWeight * sumWeight) / sumWeightSquared;
}
