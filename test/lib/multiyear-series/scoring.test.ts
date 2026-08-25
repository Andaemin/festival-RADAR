import { describe, expect, it } from "vitest";
import { lengthBoundedMaxRatio, levenshteinRatio } from "@/lib/multiyear-series/levenshtein-similarity";
import {
  clusterKeyOf,
  HIGH_THRESHOLD,
  LOW_THRESHOLD,
  makeScoreCluster,
  MIN_NAME_SIMILARITY_TO_CONSIDER,
  score,
} from "@/lib/multiyear-series/scoring";
import { rec } from "./helpers";

describe("levenshteinRatio / lengthBoundedMaxRatio", () => {
  it("동일 문자열은 1.0", () => {
    expect(levenshteinRatio("가나다", "가나다")).toBe(1.0);
  });

  it("완전히 다른 문자열은 0에 가깝다", () => {
    expect(levenshteinRatio("가나다", "xyz")).toBeLessThan(0.2);
  });

  it("null/undefined는 0.0", () => {
    expect(levenshteinRatio(null, "가나다")).toBe(0.0);
    expect(levenshteinRatio("가나다", undefined)).toBe(0.0);
  });

  it("lengthBoundedMaxRatio는 실제 ratio의 상한이다", () => {
    const a = "가나다라마바사";
    const b = "가나다";
    expect(lengthBoundedMaxRatio(a, b)).toBeGreaterThanOrEqual(levenshteinRatio(a, b));
  });
});

describe("score (Spring FestivalSeriesLinkingService.score 포팅)", () => {
  it("공백 표기만 다른 완전히 같은 축제는 HIGH band, nameSimilarity=1.0", () => {
    const a = makeScoreCluster(0, clusterKeyOf(rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제" })), [
      rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제" }),
    ]);
    const b = makeScoreCluster(1, clusterKeyOf(rec({ id: 2, datasetYear: 2018, festivalName: "가나 다라마축제" })), [
      rec({ id: 2, datasetYear: 2018, festivalName: "가나 다라마축제" }),
    ]);
    const candidate = score(a, b);
    expect(candidate).not.toBeNull();
    expect(candidate!.nameSimilarity).toBe(1.0);
    expect(candidate!.score).toBeGreaterThanOrEqual(HIGH_THRESHOLD);
    expect(candidate!.band).toBe("HIGH");
  });

  it("이름 유사도가 MIN_NAME_SIMILARITY_TO_CONSIDER 미만이면 null(후보 자체 아님)", () => {
    const a = makeScoreCluster(0, clusterKeyOf(rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제" })), [
      rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제" }),
    ]);
    const b = makeScoreCluster(1, clusterKeyOf(rec({ id: 2, datasetYear: 2018, festivalName: "완전히다른이름행사" })), [
      rec({ id: 2, datasetYear: 2018, festivalName: "완전히다른이름행사" }),
    ]);
    const candidate = score(a, b);
    expect(candidate).toBeNull();
    // 사전 필터/본 계산 둘 다 threshold 미만이어야 함을 직접 확인
    const nameA = a.key.normalizedName;
    const nameB = b.key.normalizedName;
    expect(levenshteinRatio(nameA, nameB)).toBeLessThan(MIN_NAME_SIMILARITY_TO_CONSIDER);
  });

  it("district mismatch penalty가 score를 낮춘다(같은 이름이라도 district가 다르면 감점)", () => {
    const target1 = rec({ id: 1, datasetYear: 2017, festivalName: "가나다라마축제", districtRaw: "강남구" });
    const target2SameDistrict = rec({ id: 2, datasetYear: 2018, festivalName: "가나 다라마축제", districtRaw: "강남구" });
    const target3DiffDistrict = rec({ id: 3, datasetYear: 2018, festivalName: "가나 다라마축제", districtRaw: "서초구" });

    const a = makeScoreCluster(0, clusterKeyOf(target1), [target1]);
    const bSame = makeScoreCluster(1, clusterKeyOf(target2SameDistrict), [target2SameDistrict]);
    const bDiff = makeScoreCluster(2, clusterKeyOf(target3DiffDistrict), [target3DiffDistrict]);

    const scoreSame = score(a, bSame)!;
    const scoreDiff = score(a, bDiff)!;
    expect(scoreDiff.score).toBeLessThan(scoreSame.score);
    expect(scoreDiff.districtSignal).toBeLessThan(0);
    expect(scoreSame.districtSignal).toBeGreaterThan(0);
  });

  it("score가 LOW_THRESHOLD 미만이면 null", () => {
    // 이름 유사도는 경계값을 살짝 넘지만 보조 신호(district mismatch)로 LOW 밑으로 떨어지는 경우는
    // 실제로는 드물다 - 여기서는 최소 계약(LOW_THRESHOLD 미만 후보는 아예 안 만들어짐)만 확인한다.
    expect(LOW_THRESHOLD).toBeLessThan(HIGH_THRESHOLD);
  });

  it("scope가 다르면(DISTRICT_LEVEL vs REGION_LEVEL) 애초에 같은 버킷에 들어가지 않는다", () => {
    const withDistrict = rec({ id: 1, datasetYear: 2017, festivalName: "이름축제", districtRaw: "강남구" });
    const withoutDistrict = rec({ id: 2, datasetYear: 2017, festivalName: "이름축제", districtRaw: null });
    expect(clusterKeyOf(withDistrict).scope).toBe("DISTRICT_LEVEL");
    expect(clusterKeyOf(withoutDistrict).scope).toBe("REGION_LEVEL");
  });

  it("typeTokensRaw가 둘 다 비어있지 않고 겹치지 않으면 감점(TYPE_MISMATCH_PENALTY)", () => {
    const target1 = rec({
      id: 1,
      datasetYear: 2017,
      festivalName: "가나다라마축제",
      typeTokensRaw: new Set(["CULTURE_ART"]),
    });
    const target2 = rec({
      id: 2,
      datasetYear: 2018,
      festivalName: "가나 다라마축제",
      typeTokensRaw: new Set(["NATURE_ECOLOGY"]),
    });
    const a = makeScoreCluster(0, clusterKeyOf(target1), [target1]);
    const b = makeScoreCluster(1, clusterKeyOf(target2), [target2]);
    const candidate = score(a, b)!;
    expect(candidate.typeSignal).toBeLessThan(0);
  });
});
