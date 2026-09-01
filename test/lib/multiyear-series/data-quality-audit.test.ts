import { describe, expect, it } from "vitest";
import {
  auditSeriesDataQuality,
  SeriesRecordBudgetComponents,
  summarizeGlobalDataQualityAudit,
  topDataQualityAnomalies,
} from "@/lib/multiyear-series/data-quality-audit";
import { buildSeriesTrainingPool } from "@/lib/multiyear-series/fold";
import { buildFrozenSeriesModel } from "@/lib/multiyear-series/series-linker";
import { computeOwnHistorySignal } from "@/lib/multiyear-series/own-history";
import { computeSeriesSignal } from "@/lib/multiyear-series/series-signal";
import { SeriesRecordWithQuality } from "@/lib/multiyear-series/record-loader";
import { rec } from "./helpers";

/**
 * READ-ONLY DIAGNOSTIC 감사 모듈 단위 테스트 - DB 없이 순수 in-memory fixture로만 검증한다.
 * 실제 DB 기반 golden case(밀양대추축제/밀양아리랑대축제/부산국제록페스티벌)는
 * data-quality-audit-golden.test.ts가 별도로 담당한다(여기서는 재현 가능한 합성 데이터로 각
 * reason/severity 규칙 하나하나를 독립적으로 확인한다).
 */

function withValid(records: ReturnType<typeof rec>[]): SeriesRecordWithQuality[] {
  return records.map((r) => ({ ...r, budgetQualityFlag: "VALID" as const }));
}

/** 편의 헬퍼 - id를 datasetYear로 결정적으로 생성해 여러 series를 섞어도 충돌하지 않게 한다. */
function seriesRecords(
  name: string,
  points: { year: number; budgetKrw: number }[],
  idOffset: number
): SeriesRecordWithQuality[] {
  return withValid(
    points.map((p, i) =>
      rec({ id: idOffset + i, datasetYear: p.year, festivalName: p.year === points[0].year ? name : `제${i + 1}회 ${name}`, budgetKrw: p.budgetKrw })
    )
  );
}

function buildModel(records: SeriesRecordWithQuality[], cutoffYear: number) {
  const { trainingPool } = buildSeriesTrainingPool(records, cutoffYear);
  return buildFrozenSeriesModel(trainingPool);
}

function emptyComponents(): Map<number, SeriesRecordBudgetComponents> {
  return new Map();
}

function componentsFor(id: number, overrides: Partial<SeriesRecordBudgetComponents>): [number, SeriesRecordBudgetComponents] {
  return [
    id,
    {
      budgetTotalRaw: null,
      budgetTotalMillion: null,
      budgetNationalMillion: null,
      budgetLocalMillion: null,
      budgetOtherMillion: null,
      ...overrides,
    },
  ];
}

describe("auditSeriesDataQuality - COMPONENT_SUM_MISMATCH", () => {
  it("밀양아리랑대축제 2023 실측 패턴(total=23100M, national=30M+local=2280M=2310M, ratio=10.0) → HIGH", () => {
    const records = seriesRecords("가상아리랑축제", [{ year: 2023, budgetKrw: 23_100_000_000 }], 9000);
    const model = buildModel(records, 2024);
    const components = new Map([componentsFor(9000, { budgetTotalMillion: 23100, budgetNationalMillion: 30, budgetLocalMillion: 2280 })]);

    const [group] = auditSeriesDataQuality(model, records, components);
    const [row] = group.records;
    expect(row.reasons).toContain("COMPONENT_SUM_MISMATCH");
    expect(row.severity).toBe("HIGH");
    expect(row.componentTotalKrw).toBe(23_100_000_000);
    expect(row.componentSumKrw).toBe(2_310_000_000);
    expect(row.componentMismatchRatio).toBeCloseTo(10.0, 5);
  });

  it("정상 케이스(부산국제록페스티벌 2025 실측: total=7200M, national=0+local=730+other=6470=7200M) → mismatch 없음", () => {
    const records = seriesRecords("가상록페스티벌", [{ year: 2025, budgetKrw: 7_200_000_000 }], 9010);
    const model = buildModel(records, 2026);
    const components = new Map([
      componentsFor(9010, { budgetTotalMillion: 7200, budgetNationalMillion: 0, budgetLocalMillion: 730, budgetOtherMillion: 6470 }),
    ]);

    const [group] = auditSeriesDataQuality(model, records, components);
    expect(group.records[0].reasons).not.toContain("COMPONENT_SUM_MISMATCH");
    expect(group.records[0].severity).toBe("NONE");
  });

  it("component 필드가 전혀 보고되지 않은 record는 비교 자체를 하지 않는다(componentTotalKrw=null)", () => {
    const records = seriesRecords("가상무보고축제", [{ year: 2025, budgetKrw: 500_000_000 }], 9020);
    const model = buildModel(records, 2026);
    const [group] = auditSeriesDataQuality(model, records, emptyComponents());
    expect(group.records[0].componentTotalKrw).toBeNull();
    expect(group.records[0].reasons).not.toContain("COMPONENT_SUM_MISMATCH");
  });

  it("합계가 명시적으로 0인데 총액은 0보다 크면(0으로 나눔) HIGH, ratio는 null", () => {
    const records = seriesRecords("가상제로축제", [{ year: 2025, budgetKrw: 100_000_000 }], 9030);
    const model = buildModel(records, 2026);
    const components = new Map([componentsFor(9030, { budgetTotalMillion: 100, budgetNationalMillion: 0, budgetLocalMillion: 0 })]);
    const [group] = auditSeriesDataQuality(model, records, components);
    expect(group.records[0].reasons).toContain("COMPONENT_SUM_MISMATCH");
    expect(group.records[0].severity).toBe("HIGH");
    expect(group.records[0].componentMismatchRatio).toBeNull();
  });
});

describe("auditSeriesDataQuality - YEAR_OVER_YEAR_SCALE_JUMP / prior-median / digit-shift / isolated-spike", () => {
  it("YoY 10x는 MEDIUM, 20x 이상은 HIGH(문서화된 threshold 그대로)", () => {
    const r10x = seriesRecords("가상10배축제", [{ year: 2023, budgetKrw: 100_000_000 }, { year: 2024, budgetKrw: 1_000_000_000 }], 9100);
    const model10x = buildModel(r10x, 2025);
    const [g10x] = auditSeriesDataQuality(model10x, r10x, emptyComponents());
    const row10x = g10x.records.find((r) => r.datasetYear === 2024)!;
    expect(row10x.yearOverYearRatio).toBeCloseTo(10, 5);
    expect(row10x.reasons).toContain("YEAR_OVER_YEAR_SCALE_JUMP");
    expect(row10x.severity).toBe("MEDIUM");
    // 정확히 10.0x는 DIGIT_SHIFT_PATTERN(±5%)에도 걸린다 - 별도 reason으로 severity를 HIGH로 끌어올린다.
    expect(row10x.reasons).toContain("DIGIT_SHIFT_PATTERN");

    const r21x = seriesRecords("가상21배축제", [{ year: 2023, budgetKrw: 100_000_000 }, { year: 2024, budgetKrw: 2_100_000_000 }], 9110);
    const model21x = buildModel(r21x, 2025);
    const [g21x] = auditSeriesDataQuality(model21x, r21x, emptyComponents());
    const row21x = g21x.records.find((r) => r.datasetYear === 2024)!;
    expect(row21x.yearOverYearRatio).toBeCloseTo(21, 5);
    expect(row21x.severity).toBe("HIGH");
    expect(row21x.reasons).not.toContain("DIGIT_SHIFT_PATTERN"); // 21x는 10/100/1000 어디에도 안 걸림
  });

  it("밀양대추축제 실측 패턴(20M → 2000M → 20M, ratio=100.0) → DIGIT_SHIFT_PATTERN + ISOLATED_SPIKE_PATTERN + HIGH", () => {
    const records = seriesRecords(
      "가상대추축제",
      [
        { year: 2023, budgetKrw: 20_000_000 },
        { year: 2024, budgetKrw: 2_000_000_000 },
        { year: 2025, budgetKrw: 20_000_000 },
      ],
      9200
    );
    const model = buildModel(records, 2026);
    const [group] = auditSeriesDataQuality(model, records, emptyComponents());
    const spikeRow = group.records.find((r) => r.datasetYear === 2024)!;

    expect(spikeRow.previousBudgetKrw).toBe(20_000_000);
    expect(spikeRow.nextBudgetKrw).toBe(20_000_000);
    expect(spikeRow.yearOverYearRatio).toBeCloseTo(100, 5);
    expect(spikeRow.suspectedDigitShiftFactor).toBe(100);
    expect(spikeRow.reasons).toEqual(
      expect.arrayContaining(["YEAR_OVER_YEAR_SCALE_JUMP", "SERIES_PRIOR_MEDIAN_DEVIATION", "DIGIT_SHIFT_PATTERN", "ISOLATED_SPIKE_PATTERN"])
    );
    expect(spikeRow.severity).toBe("HIGH");

    // 앞뒤 정상 record는 severity NONE이어야 한다(스스로 previous/next와 비교했을 때 정상 범위).
    const before = group.records.find((r) => r.datasetYear === 2023)!;
    expect(before.severity).toBe("NONE");
  });

  it("청송사과축제 실측 패턴 — YoY(9.2x)는 MEDIUM 미만이지만 prior median(10.6x)은 MEDIUM: 두 reason이 서로 다른 신호를 잡는다", () => {
    const records = seriesRecords(
      "가상사과축제",
      [
        { year: 2017, budgetKrw: 450_000_000 },
        { year: 2019, budgetKrw: 550_000_000 },
        { year: 2020, budgetKrw: 717_000_000 },
        { year: 2021, budgetKrw: 660_000_000 },
        { year: 2023, budgetKrw: 760_000_000 },
        { year: 2024, budgetKrw: 7_000_000_000 },
      ],
      9300
    );
    const model = buildModel(records, 2025);
    const [group] = auditSeriesDataQuality(model, records, emptyComponents());
    const row2024 = group.records.find((r) => r.datasetYear === 2024)!;

    expect(row2024.yearOverYearRatio).toBeCloseTo(9.2105, 3);
    expect(row2024.priorMedianBudgetKrw).toBe(660_000_000); // median(450,550,660,717,760)=660
    expect(row2024.priorMedianRatio).toBeCloseTo(10.606, 2);
    expect(row2024.reasons).toContain("YEAR_OVER_YEAR_SCALE_JUMP"); // INFO 수준(>=3)이라도 reason 자체는 채워짐
    expect(row2024.reasons).toContain("SERIES_PRIOR_MEDIAN_DEVIATION");
    // 최종 severity는 두 reason 중 더 강한 쪽(prior-median, MEDIUM)을 따른다.
    expect(row2024.severity).toBe("MEDIUM");
  });
});

describe("auditSeriesDataQuality - false-positive 방지(진짜 지속 성장은 HIGH로 오판하지 않는다)", () => {
  it("부산국제록페스티벌 실측 패턴(500→500→500→730→2930→4000→7200) — DIGIT_SHIFT/ISOLATED_SPIKE/COMPONENT_MISMATCH 전혀 없음, HIGH 없음", () => {
    const records = seriesRecords(
      "가상록페스티벌성장",
      [
        { year: 2017, budgetKrw: 500_000_000 },
        { year: 2018, budgetKrw: 500_000_000 },
        { year: 2019, budgetKrw: 500_000_000 },
        { year: 2021, budgetKrw: 730_000_000 },
        { year: 2023, budgetKrw: 2_930_000_000 },
        { year: 2024, budgetKrw: 4_000_000_000 },
        { year: 2025, budgetKrw: 7_200_000_000 },
      ],
      9400
    );
    const model = buildModel(records, 2026);
    const [group] = auditSeriesDataQuality(model, records, emptyComponents());

    expect(group.highCount).toBe(0);
    expect(group.hasDigitShiftPattern).toBe(false);
    expect(group.hasIsolatedSpike).toBe(false);
    expect(group.hasComponentMismatch).toBe(false);

    // 2025(최근 record, G0 LATEST 분기 point estimate source가 될 값)는 prior-median 기준으로만
    // MEDIUM일 수 있다 - 이는 실제 성장을 반영한 정당한 review 신호이지 오판이 아니다.
    const row2025 = group.records.find((r) => r.datasetYear === 2025)!;
    expect(["NONE", "INFO", "MEDIUM"]).toContain(row2025.severity);
    expect(row2025.reasons).not.toContain("DIGIT_SHIFT_PATTERN");
    expect(row2025.reasons).not.toContain("ISOLATED_SPIKE_PATTERN");
    expect(row2025.reasons).not.toContain("COMPONENT_SUM_MISMATCH");
  });

  it("완전히 안정적인 series(500,500,500) — reason 전혀 없음, 전부 NONE", () => {
    const records = seriesRecords(
      "가상안정축제",
      [
        { year: 2023, budgetKrw: 500_000_000 },
        { year: 2024, budgetKrw: 500_000_000 },
        { year: 2025, budgetKrw: 500_000_000 },
      ],
      9500
    );
    const model = buildModel(records, 2026);
    const [group] = auditSeriesDataQuality(model, records, emptyComponents());
    expect(group.records.every((r) => r.severity === "NONE" && r.reasons.length === 0)).toBe(true);
  });
});

describe("auditSeriesDataQuality - 경계/누락 케이스", () => {
  it("historyCount=1(첫 관측) — previous/priorMedian/next 전부 null, severity NONE", () => {
    const records = seriesRecords("가상단독축제", [{ year: 2025, budgetKrw: 300_000_000 }], 9600);
    const model = buildModel(records, 2026);
    const [group] = auditSeriesDataQuality(model, records, emptyComponents());
    const row = group.records[0];
    expect(row.previousBudgetKrw).toBeNull();
    expect(row.priorMedianBudgetKrw).toBeNull();
    expect(row.priorMedianSampleSize).toBe(0);
    expect(row.nextBudgetKrw).toBeNull();
    expect(row.severity).toBe("NONE");
    expect(row.reasons).toEqual([]);
  });

  it("UNIT_SCALE_SUSPECT record는 own-history eligibility에서 이미 걸러져 audit 대상에 아예 나타나지 않는다", () => {
    const valid = seriesRecords("가상혼합품질축제", [{ year: 2023, budgetKrw: 500_000_000 }], 9700);
    const suspect = withValid(
      [rec({ id: 9701, datasetYear: 2024, festivalName: "제2회 가상혼합품질축제", budgetKrw: 999_999_999 })]
    ).map((r) => ({ ...r, budgetQualityFlag: "UNIT_SCALE_SUSPECT" as const }));
    const records = [...valid, ...suspect];

    const model = buildModel(records, 2025);
    const [group] = auditSeriesDataQuality(model, records, emptyComponents());
    expect(group.records.some((r) => r.recordId === 9701)).toBe(false);
    expect(group.records.length).toBe(1);
  });

  it("leakage-safe: model이 특정 planningYear cutoff로 빌드되면 audit도 그 cutoff 밖 record를 절대 보지 않는다", () => {
    const records = seriesRecords(
      "가상누출확인축제",
      [
        { year: 2024, budgetKrw: 500_000_000 },
        { year: 2025, budgetKrw: 500_000_000 },
        { year: 2026, budgetKrw: 50_000_000_000 }, // 극단값이어도 leakage cutoff 밖이면 절대 안 보여야 함
      ],
      9800
    );
    const model = buildModel(records, 2026); // planningYear=2026 -> datasetYear<2026만 포함
    const [group] = auditSeriesDataQuality(model, records, emptyComponents());
    expect(group.records.every((r) => r.datasetYear < 2026)).toBe(true);
    expect(group.recordCount).toBe(2);
  });
});

describe("auditSeriesDataQuality - estimator 불변성(회귀)", () => {
  it("audit 실행 전후로 computeOwnHistorySignal/computeSeriesSignal 결과가 완전히 동일하다", () => {
    const records = seriesRecords(
      "가상불변성축제",
      [
        { year: 2023, budgetKrw: 20_000_000 },
        { year: 2024, budgetKrw: 2_000_000_000 }, // 알려진 HIGH anomaly가 껴 있어도
        { year: 2025, budgetKrw: 20_000_000 },
      ],
      9900
    );
    const target = rec({ id: 9999, datasetYear: 2026, festivalName: "가상불변성축제", budgetKrw: 0 });
    const model = buildModel(records, 2026);

    const before = computeOwnHistorySignal(target, 2026, model);
    const beforeSignal = computeSeriesSignal("가상불변성축제", target.region!, target.district, target.typeTokens, 2026, model);

    auditSeriesDataQuality(model, records, emptyComponents());
    summarizeGlobalDataQualityAudit(auditSeriesDataQuality(model, records, emptyComponents()));
    topDataQualityAnomalies(auditSeriesDataQuality(model, records, emptyComponents()), 10);

    const after = computeOwnHistorySignal(target, 2026, model);
    const afterSignal = computeSeriesSignal("가상불변성축제", target.region!, target.district, target.typeTokens, 2026, model);

    expect(after).toEqual(before);
    expect(afterSignal).toEqual(beforeSignal);
    // 알려진 HIGH anomaly(2024=2000M)가 껴 있어도 estimate는 여전히 gap<=2 LATEST 분기(2025=20M) 그대로.
    expect(afterSignal.estimateSource).toBe("LATEST");
    expect(afterSignal.seriesEstimatedBudgetKrw).toBe(20_000_000);
  });
});

describe("summarizeGlobalDataQualityAudit / topDataQualityAnomalies - 집계와 정렬", () => {
  it("전체 요약 카운트가 group별 합과 일치한다", () => {
    const a = seriesRecords("가상A축제", [{ year: 2023, budgetKrw: 100_000_000 }, { year: 2024, budgetKrw: 3_000_000_000 }], 9500001);
    const b = seriesRecords("가상B축제", [{ year: 2023, budgetKrw: 200_000_000 }, { year: 2024, budgetKrw: 200_000_000 }], 9500011);
    const records = [...a, ...b];
    const model = buildModel(records, 2025);
    const groups = auditSeriesDataQuality(model, records, emptyComponents());
    const summary = summarizeGlobalDataQualityAudit(groups);

    const flat = groups.flatMap((g) => g.records);
    expect(summary.auditPoolRecordCount).toBe(flat.length);
    expect(summary.highCount + summary.mediumCount + summary.infoCount + summary.severityDistribution.NONE).toBe(flat.length);
    expect(summary.reviewRequiredCount).toBe(summary.highCount + summary.mediumCount + summary.infoCount);
  });

  it("deterministic 정렬 — HIGH 먼저 → ratio 큰 순 → datasetYear → canonicalName", () => {
    // 두 개의 HIGH(비율이 다름) + 하나의 MEDIUM을 만들어 정렬 순서를 확인한다.
    const high100 = seriesRecords("가상정렬Z축제", [{ year: 2023, budgetKrw: 10_000_000 }, { year: 2024, budgetKrw: 1_000_000_000 }], 9600001);
    const high30 = seriesRecords("가상정렬A축제", [{ year: 2023, budgetKrw: 100_000_000 }, { year: 2024, budgetKrw: 3_000_000_000 }], 9600011);
    const medium10 = seriesRecords("가상정렬M축제", [{ year: 2023, budgetKrw: 100_000_000 }, { year: 2024, budgetKrw: 1_000_000_000 }], 9600021);
    const records = [...high100, ...high30, ...medium10];
    const model = buildModel(records, 2025);
    const groups = auditSeriesDataQuality(model, records, emptyComponents());

    const top = topDataQualityAnomalies(groups, 10);
    const severities = top.map((r) => r.severity);
    // HIGH 두 건이 먼저 오고(ratio 큰 순: 100배 > 30배), 그 다음 MEDIUM.
    expect(severities.slice(0, 2)).toEqual(["HIGH", "HIGH"]);
    expect(top[0].canonicalSeriesName).toBe("가상정렬Z축제"); // ratio=100(더 큼)
    expect(top[1].canonicalSeriesName).toBe("가상정렬A축제"); // ratio=30
    expect(top.some((r) => r.severity === "MEDIUM")).toBe(true);
  });
});
