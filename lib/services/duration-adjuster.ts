import { clip } from "@/lib/utils/weighted-statistics";
import { algorithmConfig } from "./algorithm-config";

const cfg = algorithmConfig;

/**
 * 후보 축제의 예산을 요청한 개최 일수 기준으로 보정한다.
 * 기간 데이터가 없는 후보(sourceDurationDays === null)는 원 예산을 그대로 반환한다.
 */
export function adjustDuration(sourceBudgetKrw: number, sourceDurationDays: number | null, targetDurationDays: number): number {
    if (sourceDurationDays === null || sourceDurationDays <= 0) return sourceBudgetKrw;
    const rawRatio = targetDurationDays / sourceDurationDays;
    const clampedRatio = clip(rawRatio, cfg.durationRatioClampMin, cfg.durationRatioClampMax);
    return sourceBudgetKrw * Math.pow(clampedRatio, cfg.durationElasticity);
}
