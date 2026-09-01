import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { loadAllSeriesRecords } from "@/lib/multiyear-series/record-loader";
import { buildSeriesTrainingPool } from "@/lib/multiyear-series/fold";
import { buildFrozenSeriesModel } from "@/lib/multiyear-series/series-linker";
import { auditSeriesDataQuality, loadSeriesRecordBudgetComponents, SeriesGroupDataQualitySummary } from "@/lib/multiyear-series/data-quality-audit";

/**
 * 실제 DB(2017~2026 MultiYearFestivalRecord) 기준 golden case - spec 19절 "Known case
 * acceptance"를 그대로 재현한다. 읽기 전용(아무것도 쓰지 않는다). 값은
 * `scripts/_audit-verify.ts`(연구용, 미커밋)로 먼저 재현/확인한 것과 정확히 같다.
 *
 * "전체 데이터 감사" 문맥(spec 21절)이므로 특정 planningYear의 leakage-safe cutoff를 적용하지
 * 않는다 - 보유 데이터 전체(2017~2026)를 대상으로 감사한다(cutoff = maxDatasetYear+1).
 */
async function auditWholeDataset(): Promise<SeriesGroupDataQualitySummary[]> {
  const allRecords = await loadAllSeriesRecords(prisma);
  const maxYear = Math.max(...allRecords.map((r) => r.datasetYear));
  const { trainingPool } = buildSeriesTrainingPool(allRecords, maxYear + 1);
  const model = buildFrozenSeriesModel(trainingPool);
  const componentsById = await loadSeriesRecordBudgetComponents(prisma);
  return auditSeriesDataQuality(model, allRecords, componentsById);
}

function findGroup(groups: SeriesGroupDataQualitySummary[], canonicalName: string): SeriesGroupDataQualitySummary {
  const g = groups.find((g) => g.canonicalName === canonicalName);
  if (!g) throw new Error(`group not found: ${canonicalName}`);
  return g;
}

describe("Series Data Quality Audit - 실제 DB golden case(spec 19절)", () => {
  it("밀양대추축제 2024 — budgetQualityFlag=VALID인데 ratio≈100x, REVIEW_REQUIRED(HIGH) + DIGIT_SHIFT_PATTERN, 자동 제외되지 않음", async () => {
    const groups = await auditWholeDataset();
    const group = findGroup(groups, "밀양대추축제");
    const row2024 = group.records.find((r) => r.datasetYear === 2024)!;

    expect(row2024.budgetQualityFlag).toBe("VALID");
    expect(row2024.budgetKrw).toBe(2_000_000_000);
    expect(row2024.previousBudgetKrw).toBe(20_000_000);
    expect(row2024.yearOverYearRatio).toBeCloseTo(100, 3);
    expect(row2024.severity).toBe("HIGH");
    expect(row2024.reasons).toEqual(
      expect.arrayContaining(["YEAR_OVER_YEAR_SCALE_JUMP", "SERIES_PRIOR_MEDIAN_DEVIATION", "DIGIT_SHIFT_PATTERN", "ISOLATED_SPIKE_PATTERN"])
    );
    expect(row2024.suspectedDigitShiftFactor).toBe(100);

    // "자동 제외되지 않는다" - 이 record가 여전히 group.records(=own-history eligibility를
    // 통과한 leakage-safe 목록)에 나타난다는 사실 자체가 증거다. 값이 바뀌지도 않았다.
    expect(row2024.budgetKrw).toBe(2_000_000_000);
  });

  it("밀양아리랑대축제 2023 — total=23,100M vs national+local=2,310M, ratio=10.0, COMPONENT_SUM_MISMATCH + HIGH", async () => {
    const groups = await auditWholeDataset();
    const group = findGroup(groups, "밀양아리랑대축제");
    const row2023 = group.records.find((r) => r.datasetYear === 2023)!;

    expect(row2023.budgetQualityFlag).toBe("VALID");
    expect(row2023.componentTotalKrw).toBe(23_100_000_000);
    expect(row2023.componentSumKrw).toBe(2_310_000_000);
    expect(row2023.componentMismatchRatio).toBeCloseTo(10.0, 5);
    expect(row2023.reasons).toContain("COMPONENT_SUM_MISMATCH");
    expect(row2023.severity).toBe("HIGH");
  });

  it("부산국제록페스티벌 — 지속 성장(500→500→500→730→2930→4000→7200)은 DIGIT_SHIFT/ISOLATED_SPIKE/COMPONENT_MISMATCH로 오판되지 않는다(G0 estimate와 무관하게 HIGH 없음)", async () => {
    const groups = await auditWholeDataset();
    const group = findGroup(groups, "부산국제록페스티벌");

    expect(group.hasDigitShiftPattern).toBe(false);
    expect(group.hasIsolatedSpike).toBe(false);
    expect(group.hasComponentMismatch).toBe(false);
    expect(group.highCount).toBe(0);

    // G0 point estimate source가 될 수 있는 최근 record(2025=72억)는 prior-median 기준 MEDIUM
    // 정도의 정당한 review 신호는 가질 수 있지만, DATA_ERROR류로 보이는 reason은 전혀 없다.
    const row2025 = group.records.find((r) => r.datasetYear === 2025)!;
    expect(row2025.budgetKrw).toBe(7_200_000_000);
    expect(row2025.reasons).not.toContain("DIGIT_SHIFT_PATTERN");
    expect(row2025.reasons).not.toContain("ISOLATED_SPIKE_PATTERN");
    expect(row2025.reasons).not.toContain("COMPONENT_SUM_MISMATCH");
  });
});
