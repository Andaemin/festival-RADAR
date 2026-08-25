import { describe, expect, it } from "vitest";
import { FestivalType, Region } from "@/lib/domain/enums";
import { tryAdjustForCpi } from "@/lib/multiyear-series/cpi";
import {
  computeCpiAdjustedVolatility,
  computeLeakageSafeVolatilityThreshold,
  computePlanningReliability,
  earliestOofYear,
  RELIABILITY_MIN_CALIBRATION_N,
  tierFromVolatility,
} from "@/lib/multiyear-series/reliability";
import { SeriesRecordWithQuality } from "@/lib/multiyear-series/record-loader";
import { buildFrozenSeriesModel } from "@/lib/multiyear-series/series-linker";
import { computeSeriesSignal, SERIES_SIGNAL_NOT_REQUESTED } from "@/lib/multiyear-series/series-signal";
import { rec } from "./helpers";

/**
 * PHASE 19-A — reliability.ts의 순수 함수 계약을 DB 없이 검증한다. Phase 17/18/18-B에서 확정한
 * 정의(volatility=log(P75/P25) of CPI-adjusted historical budgets, historyCount<=1은 항상
 * HIGH, threshold는 leakage-safe nested OOF median)를 새로 해석하지 않고 그대로 옮겼는지가
 * 핵심이다.
 */

describe("computeCpiAdjustedVolatility", () => {
  it("historyCount<2면 null(P25/P75 정의 불가)", () => {
    expect(computeCpiAdjustedVolatility([], 2020)).toBeNull();
    expect(computeCpiAdjustedVolatility([{ budgetKrw: 100_000_000, datasetYear: 2019 }], 2020)).toBeNull();
  });

  it("historyCount=2 - CPI-adjusted 값의 log(P75/P25)를 실제 cpi.ts 공식으로 재계산해 비교", () => {
    const historical = [
      { budgetKrw: 100_000_000, datasetYear: 2017 },
      { budgetKrw: 300_000_000, datasetYear: 2018 },
    ];
    const targetYear = 2020; // baseYear=2019, CPI_TABLE에 존재.
    const vol = computeCpiAdjustedVolatility(historical, targetYear);

    const adjusted = historical.map((h) => tryAdjustForCpi(h.budgetKrw, h.datasetYear, targetYear)!).sort((a, b) => a - b);
    const index25 = 0.25 * (adjusted.length - 1);
    const index75 = 0.75 * (adjusted.length - 1);
    const p25 = adjusted[Math.floor(index25)] + (adjusted[Math.ceil(index25)] - adjusted[Math.floor(index25)]) * (index25 - Math.floor(index25));
    const p75 = adjusted[Math.floor(index75)] + (adjusted[Math.ceil(index75)] - adjusted[Math.floor(index75)]) * (index75 - Math.floor(index75));
    expect(vol).toBeCloseTo(Math.log(p75 / p25), 10);
  });

  it("CPI_TABLE에 baseYear가 없으면(targetYear>=2027) nominal budget으로 fallback해 계산한다(own-history.ts와 대칭 정책)", () => {
    const historical = [
      { budgetKrw: 100_000_000, datasetYear: 2023 },
      { budgetKrw: 300_000_000, datasetYear: 2024 },
    ];
    const targetYear = 2027; // baseYear=2026, CPI_TABLE에 없음.
    const vol = computeCpiAdjustedVolatility(historical, targetYear);
    // fallback: nominal 값([100M,300M])의 선형보간 P25/P75 - n=2라 정확히 두 끝값이 아니다
    // (index=0.25*(2-1)=0.25 -> 150M, index=0.75 -> 250M).
    const p25 = 100_000_000 + (300_000_000 - 100_000_000) * 0.25;
    const p75 = 100_000_000 + (300_000_000 - 100_000_000) * 0.75;
    expect(vol).toBeCloseTo(Math.log(p75 / p25), 10);
  });
});

describe("tierFromVolatility", () => {
  it("historyCount<=1이면 volatility/threshold와 무관하게 항상 HIGH", () => {
    expect(tierFromVolatility(0, null, 0.1)).toBe("HIGH");
    expect(tierFromVolatility(1, null, 0.1)).toBe("HIGH");
    expect(tierFromVolatility(1, 999, 0.001)).toBe("HIGH"); // volatility가 커도 historyCount=1이면 무조건 HIGH
  });

  it("threshold가 null(calibration 불가)이면 기본값 HIGH", () => {
    expect(tierFromVolatility(3, 0.5, null)).toBe("HIGH");
  });

  it("volatility<=threshold면 HIGH, 초과하면 MEDIUM", () => {
    expect(tierFromVolatility(2, 0.05, 0.1)).toBe("HIGH");
    expect(tierFromVolatility(2, 0.1, 0.1)).toBe("HIGH"); // 경계값 포함
    expect(tierFromVolatility(2, 0.15, 0.1)).toBe("MEDIUM");
  });
});

describe("computePlanningReliability", () => {
  it("PEER_FALLBACK(NOT_REQUESTED/UNMATCHED/AMBIGUOUS/NO_VALID_HISTORY)이면 항상 LOW/PEER_FALLBACK", () => {
    const model = buildFrozenSeriesModel([]);
    const statuses = [SERIES_SIGNAL_NOT_REQUESTED, { status: "UNMATCHED" as const }, { status: "AMBIGUOUS" as const }, { status: "NO_VALID_HISTORY" as const }];
    for (const signal of statuses) {
      const result = computePlanningReliability(signal, "아무 축제", Region.SEOUL, null, new Set([FestivalType.CULTURE_ART]), 2026, model, 0.1);
      expect(result.tier).toBe("LOW");
      expect(result.reasonKey).toBe("PEER_FALLBACK");
    }
  });

  it("historyCount=1인 SERIES_APPLIED는 항상 HIGH이지만, reasonKey는 SERIES_STABLE_SINGLE_HISTORY다(PHASE 31-B - 변동 안정성을 측정할 수 없으므로 '안정적'이라 주장하지 않는다)", () => {
    const members = [rec({ id: 1, datasetYear: 2024, festivalName: "가나다축제", budgetKrw: 100_000_000 })];
    const model = buildFrozenSeriesModel(members);
    const signal = computeSeriesSignal("제2회 가나다축제", Region.SEOUL, null, new Set([FestivalType.CULTURE_ART]), 2026, model);
    expect(signal.status).toBe("MATCHED");
    expect(signal.historyCount).toBe(1);

    const result = computePlanningReliability(signal, "제2회 가나다축제", Region.SEOUL, null, new Set([FestivalType.CULTURE_ART]), 2026, model, 0.0001);
    expect(result.tier).toBe("HIGH"); // tier 산정 자체는 변경 없음
    expect(result.reasonKey).toBe("SERIES_STABLE_SINGLE_HISTORY");
    expect(result.reasonText).toBe("동일 축제의 과거 예산 이력을 활용해 예산을 추정했습니다.");
    expect(result.reasonText).not.toContain("안정적"); // "변동이 안정적"이라는 근거 없는 주장을 하지 않는다
  });

  it("historyCount>=2이고 volatility<=threshold면 HIGH, threshold 초과면 MEDIUM(같은 history, threshold만 다름)", () => {
    const members = [
      rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", budgetKrw: 100_000_000 }),
      rec({ id: 2, datasetYear: 2018, festivalName: "제2회 가나다축제", budgetKrw: 300_000_000 }),
    ];
    const model = buildFrozenSeriesModel(members);
    const signal = computeSeriesSignal("제3회 가나다축제", Region.SEOUL, null, new Set([FestivalType.CULTURE_ART]), 2020, model);
    expect(signal.status).toBe("MATCHED");
    expect(signal.historyCount).toBe(2);

    const stable = computePlanningReliability(signal, "제3회 가나다축제", Region.SEOUL, null, new Set([FestivalType.CULTURE_ART]), 2020, model, 999);
    expect(stable.tier).toBe("HIGH");
    // PHASE 31-B — historyCount=2(변동을 실제로 측정 가능)이므로 SINGLE_HISTORY가 아니라 기존
    // SERIES_STABLE 문구를 그대로 유지해야 한다.
    expect(stable.reasonKey).toBe("SERIES_STABLE");
    expect(stable.reasonText).toBe("동일 축제의 과거 예산 이력을 활용했고, 물가 보정 후 연도별 예산 변동이 비교적 안정적입니다.");

    const volatile_ = computePlanningReliability(signal, "제3회 가나다축제", Region.SEOUL, null, new Set([FestivalType.CULTURE_ART]), 2020, model, 0.0000001);
    expect(volatile_.tier).toBe("MEDIUM");
    expect(volatile_.reasonKey).toBe("SERIES_VOLATILE");
  });

  it("reasonText는 tier/reasonKey와 무관하게 항상 채워져 있다(빈 문자열 없음)", () => {
    const model = buildFrozenSeriesModel([]);
    const result = computePlanningReliability(SERIES_SIGNAL_NOT_REQUESTED, "x", Region.SEOUL, null, new Set(), 2026, model, null);
    expect(result.reasonText.length).toBeGreaterThan(0);
  });
});

describe("earliestOofYear", () => {
  it("보유 데이터 최소 datasetYear+1을 돌려준다(하드코딩 아님)", () => {
    expect(earliestOofYear([{ datasetYear: 2017 }, { datasetYear: 2020 }])).toBe(2018);
    expect(earliestOofYear([{ datasetYear: 2015 }])).toBe(2016);
  });

  it("레코드가 없으면 Infinity(계산 불가)", () => {
    expect(earliestOofYear([])).toBe(Infinity);
  });
});

describe("computeLeakageSafeVolatilityThreshold - leakage-safe 재현성", () => {
  /** 2017~2021년 5개 edition으로 이어지는 단일 series 하나 - 매 fold마다 historyCount가 1씩 늘어난다. */
  function buildSeries(extraYears: number[] = []): SeriesRecordWithQuality[] {
    const names: Record<number, string> = {
      2017: "가나다축제",
      2018: "제2회 가나다축제",
      2019: "제3회 가나다축제",
      2020: "제4회 가나다축제",
      2021: "제5회 가나다축제",
      2022: "제6회 가나다축제",
      2023: "제7회 가나다축제",
    };
    const years = [2017, 2018, 2019, 2020, 2021, ...extraYears];
    return years.map((y, i) => rec({ id: i + 1, datasetYear: y, festivalName: names[y], budgetKrw: 100_000_000 + i * 20_000_000 })).map((r) => ({ ...r, budgetQualityFlag: "VALID" as const }));
  }

  it("데이터가 MIN_CALIBRATION_N보다 적으면 usable=false, threshold=null(하드코딩 대체값을 쓰지 않음)", () => {
    const records = buildSeries();
    const result = computeLeakageSafeVolatilityThreshold(records, 2022);
    expect(result.poolN).toBeLessThan(RELIABILITY_MIN_CALIBRATION_N);
    expect(result.usable).toBe(false);
    expect(result.threshold).toBeNull();
    // yh=2018(historyCount=1,제외)/2019/2020/2021 중 volatility 계산 가능한 3개(hc>=2)만 pool에 들어간다.
    expect(result.poolN).toBe(3);
  });

  it("planningYear 이후(미래) 데이터를 추가해도 결과가 완전히 동일하다(미래 데이터 미사용 증명)", () => {
    const withoutFuture = buildSeries();
    const withFuture = buildSeries([2022, 2023]); // planningYear=2022 기준으로 2022/2023은 미래

    const a = computeLeakageSafeVolatilityThreshold(withoutFuture, 2022);
    const b = computeLeakageSafeVolatilityThreshold(withFuture, 2022);
    expect(b.poolN).toBe(a.poolN);
    expect(b.threshold).toBe(a.threshold);
    expect(b.usable).toBe(a.usable);
  });

  it("보유 데이터 최댓값보다 훨씬 미래인 planningYear(예: 2027 provenance)로 불러도 - 실제로 존재하는 과거 데이터만으로 동일 규칙이 재현된다(하드코딩 threshold 없음)", () => {
    const records = buildSeries(); // 최대 datasetYear=2021
    const nearFuture = computeLeakageSafeVolatilityThreshold(records, 2022); // 사실상 "현재 시점" 호출
    const farFuture = computeLeakageSafeVolatilityThreshold(records, 2027); // Phase 18-B의 2027 데모에 해당
    // yh=2022~2026은 evalTarget이 하나도 없어(그 해 데이터가 없음) pool에 아무것도 추가하지 못한다 -
    // 따라서 두 호출은 완전히 같은 결과를 내야 한다(미래 연도로 확장해도 threshold가 안 바뀜).
    expect(farFuture).toEqual(nearFuture);
  });

  it("레코드가 전혀 없으면 poolN=0, usable=false, threshold=null", () => {
    const result = computeLeakageSafeVolatilityThreshold([] as SeriesRecordWithQuality[], 2026);
    expect(result.poolN).toBe(0);
    expect(result.usable).toBe(false);
    expect(result.threshold).toBeNull();
  });
});
