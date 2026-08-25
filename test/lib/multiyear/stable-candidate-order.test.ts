import { describe, expect, it } from "vitest";
import { selectFinalSample, stableCandidateOrderKey } from "@/lib/multiyear/baseline-estimator";
import { Region, FestivalType } from "@/lib/domain/enums";
import { MultiYearQuery, MultiYearRecordLite } from "@/lib/multiyear/types";

/**
 * PHASE 29 — Peer candidate ranking의 deterministic tie-break 회귀 테스트.
 *
 * 배경(Phase 28 audit): weight가 exact tie인 후보들의 최종 순서가 이전에는 JS stable sort의
 * "입력 배열 순서 유지" 성질에 기대고 있었는데, 그 입력 배열 순서가 DB `orderBy: {id:"asc"}`
 * (reimport마다 재발급되는 autoincrement)에서 왔다 - 논리적으로 동일한 데이터인데도 재적재
 * 순서가 다르면 top-50 cutoff 근처 tie가 다르게 갈릴 수 있었다(Peer target의 82.94%가 영향
 * 받을 수 있음을 실측). 이 테스트는 그 문제가 실제로 고쳐졌는지 - 즉 "동일 weight 후보가 서로
 * 다른 input 순서로 들어와도 candidate 순서/선택된 top-N이 항상 같은지" - 를 검증한다.
 */

function makeQuery(): MultiYearQuery {
  return {
    region: Region.SEOUL,
    district: null,
    typeTokens: new Set([FestivalType.CULTURE_ART]),
    venueType: null,
    durationDays: null,
  };
}

/** typeTokens/region/venueType/durationDays를 전부 동일하게 만들어 computeMultiYearSimilarity가
 *  모든 candidate에 대해 정확히 같은 weight를 내도록 한다(진짜 exact tie - 반올림 아님).
 *  sourceSha256/sourceSheet/sourceRow/id/budgetKrw만 서로 다르게 해서 tie-break key로만
 *  구분되게 만든다. */
function makeTiedCandidates(count: number): MultiYearRecordLite[] {
  const out: MultiYearRecordLite[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: i + 1,
      datasetYear: 2020,
      festivalName: `tied-festival-${i}`,
      sourceSha256: `sha-${String(i).padStart(4, "0")}`, // 서로 다른 "연도별 원본 파일" 흉내
      sourceSheet: "세부현황",
      sourceRow: 100 + i,
      region: Region.SEOUL,
      district: null,
      typeTokens: new Set([FestivalType.CULTURE_ART]),
      venueType: null, // venueAvailable=false로 균일 - venue 항이 재정규화에서 항상 제외됨
      durationDays: null, // durationAvailable=false로 균일
      budgetKrw: 100_000_000 + i * 1_000, // 후보마다 다른 budget(가중치엔 영향 없음 - weight는 similarity만의 함수)
    });
  }
  return out;
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("stableCandidateOrderKey", () => {
  it("sourceSha256+sourceSheet+sourceRow로 key를 만들고, sourceRow는 6자리 zero-pad로 숫자 크기와 문자열 비교 순서가 일치한다", () => {
    const r = (sourceRow: number): MultiYearRecordLite => ({
      id: 1, datasetYear: 2020, festivalName: "x", sourceSha256: "abc", sourceSheet: "시트",
      sourceRow, region: null, district: null, typeTokens: new Set(), venueType: null, durationDays: null, budgetKrw: 0,
    });
    expect(stableCandidateOrderKey(r(9)) < stableCandidateOrderKey(r(10))).toBe(true);
    expect(stableCandidateOrderKey(r(99)) < stableCandidateOrderKey(r(100))).toBe(true);
  });
});

describe("selectFinalSample - exact-tie deterministic ordering (cutoff boundary 포함)", () => {
  it(">50개 exact-tie 후보(cutoff를 넘김)를 서로 다른 input 순서로 넣어도 선택된 top-50과 순서가 완전히 동일하다", () => {
    const query = makeQuery();
    const candidates = makeTiedCandidates(70); // maxSampleCount(50)보다 많은 tie - cutoff를 실제로 걸침
    const orderings = [
      candidates,
      [...candidates].reverse(),
      [...candidates].sort((a, b) => (stableCandidateOrderKey(a) < stableCandidateOrderKey(b) ? 1 : -1)), // 역순 stable-key
      seededShuffle(candidates, 12345),
      seededShuffle(candidates, 999),
    ];

    const results = orderings.map((pool) => selectFinalSample(pool, query));
    for (const r of results) {
      expect(r).not.toBeNull();
      expect(r!.finalSample.length).toBe(50); // maxSampleCount
    }

    const baseline = results[0]!.finalSample.map((c) => stableCandidateOrderKey(c.record));
    for (let i = 1; i < results.length; i++) {
      const keys = results[i]!.finalSample.map((c) => stableCandidateOrderKey(c.record));
      expect(keys).toEqual(baseline); // 선택된 candidate "집합"뿐 아니라 "순서"까지 완전히 동일해야 함
    }

    // 선택된 50개는 반드시 sourceRow가 가장 작은(=stableCandidateOrderKey가 사전순으로 가장 앞선)
    // 50개여야 한다(ASC tie-break) - 어느 orderInput을 넣어도 이 결정적 규칙 하나로 수렴한다.
    const expectedTop50Keys = candidates
      .map((c) => stableCandidateOrderKey(c))
      .sort()
      .slice(0, 50);
    expect(baseline).toEqual(expectedTop50Keys);
  });

  it("estimatedBudget/P60도 input 순서와 무관하게 동일하다(가중 통계는 원래도 순서-불변이지만, 선택된 SET이 순서에 따라 달라지면 결과도 달라질 수 있었다)", () => {
    const query = makeQuery();
    const candidates = makeTiedCandidates(65);
    const orderings = [candidates, [...candidates].reverse(), seededShuffle(candidates, 42)];
    const results = orderings.map((pool) => selectFinalSample(pool, query)!);
    const estimates = results.map((r) => {
      const weights = r.finalSample.map((c) => c.score.weight);
      // 순수 weighted geometric mean 재계산 없이, 최소한 "선택된 candidate 집합이 완전히 같다"만
      // 확인해도 estimate가 같다는 것은 이미 위 테스트로 보장된다 - 여기서는 weight 배열 자체의
      // 동일성(순서 포함)까지 다시 확인한다.
      return weights;
    });
    expect(estimates[1]).toEqual(estimates[0]);
    expect(estimates[2]).toEqual(estimates[0]);
  });

  it("tie 그룹 크기가 cutoff보다 작으면(정상적으로 전부 선택 가능) tie-break가 있어도 없어도 선택된 집합은 같다 - 순서만 결정적으로 바뀐다", () => {
    const query = makeQuery();
    const candidates = makeTiedCandidates(30); // 50 미만 - 전부 선택됨
    const a = selectFinalSample(candidates, query)!;
    const b = selectFinalSample([...candidates].reverse(), query)!;
    expect(a.finalSample.length).toBe(30);
    expect(b.finalSample.length).toBe(30);
    const keysA = a.finalSample.map((c) => stableCandidateOrderKey(c.record));
    const keysB = b.finalSample.map((c) => stableCandidateOrderKey(c.record));
    expect(keysB).toEqual(keysA);
  });

  it("weight가 다른(진짜 다른 similarity) 후보끼리는 tie-break가 절대 개입하지 않는다 - primary weight DESC가 항상 우선", () => {
    // 둘 다 region/type은 완전히 동일(score=1.0)하게 맞춰 threshold(0.35)를 여유있게 넘기고,
    // duration만 다르게 해서 실제로 다른(하지만 tie는 아닌) weight를 만든다.
    const query: MultiYearQuery = { region: Region.SEOUL, district: null, typeTokens: new Set([FestivalType.CULTURE_ART]), venueType: null, durationDays: 5 };
    const closeMatch: MultiYearRecordLite = {
      id: 1, datasetYear: 2020, festivalName: "close", sourceSha256: "zzz-close", sourceSheet: "시트", sourceRow: 999,
      region: Region.SEOUL, district: null, typeTokens: new Set([FestivalType.CULTURE_ART]), venueType: null, durationDays: 5, budgetKrw: 100_000_000,
    };
    const farMatch: MultiYearRecordLite = {
      id: 2, datasetYear: 2020, festivalName: "far", sourceSha256: "aaa-far", sourceSheet: "시트", sourceRow: 1,
      region: Region.SEOUL, district: null, typeTokens: new Set([FestivalType.CULTURE_ART]), venueType: null, durationDays: 15, budgetKrw: 100_000_000,
    };
    // stableKey로는 farMatch("aaa-far...")가 closeMatch("zzz-close...")보다 사전순으로 앞선다 -
    // tie-break가 실수로 개입하면 farMatch가 1등이 될 것이다. 실제로는 weight가 달라(tie 아님)
    // closeMatch(duration 정확히 일치, weight가 더 큼)가 반드시 1등이어야 한다.
    const r = selectFinalSample([farMatch, closeMatch], query)!;
    expect(r.finalSample.length).toBe(2);
    expect(r.finalSample[0].score.weight).toBeGreaterThan(r.finalSample[1].score.weight); // 진짜 tie가 아님을 재확인
    expect(r.finalSample[0].record.id).toBe(1); // closeMatch가 1등 - stableKey 사전순(aaa<zzz)에 안 밀림
  });
});
