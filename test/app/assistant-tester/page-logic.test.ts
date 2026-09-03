import { describe, expect, it } from "vitest";
import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { computeMissingRequiredFields, isDurationValid, shouldResetMetadataOnNameEdit } from "@/app/budget-estimator/page";
import type { SeriesSearchResult } from "@/lib/multiyear-series/series-search";

/**
 * PHASE 5(17절) — page.tsx에서 뽑아낸 순수 폼 로직만 단위 테스트한다(컴포넌트 렌더링/DOM 없이).
 * 이 프로젝트에는 React 컴포넌트 테스트 인프라가 없고 이번 Phase에서 새로 추가하지 않으므로,
 * "Series 선택 후 이름 변경 → stale metadata 초기화"/"duration validation" 요구사항은 실제
 * 컴포넌트가 그대로 호출하는 이 순수 함수들로 검증한다(page.tsx의 handleFestivalNameChange/
 * handleSubmit이 내부적으로 정확히 이 함수들을 쓴다 - 로직이 어긋날 수 없다).
 */

function fakeSeries(overrides: Partial<SeriesSearchResult> = {}): SeriesSearchResult {
  return {
    canonicalName: "부산국제록페스티벌",
    scope: "REGION_LEVEL",
    regionCode: Region.BUSAN,
    district: null,
    firstObservedYear: 2017,
    lastObservedYear: 2026,
    historyCount: 8,
    autoFill: { regionCode: Region.BUSAN, district: null, festivalTypes: [FestivalType.CULTURE_ART], venueType: VenueType.GREEN },
    fieldStatus: { region: "STABLE", district: "MISSING", festivalTypes: "STABLE", venueType: "STABLE" },
    ...overrides,
  };
}

describe("shouldResetMetadataOnNameEdit - 1절/15절 acceptance", () => {
  it("선택된 series가 없으면 false(일반 신규 입력 경로에 영향 없음)", () => {
    expect(shouldResetMetadataOnNameEdit("아무 이름", null)).toBe(false);
  });

  it("선택된 series와 이름이 같으면(방금 선택 직후) false", () => {
    const series = fakeSeries();
    expect(shouldResetMetadataOnNameEdit(series.canonicalName, series)).toBe(false);
  });

  it("선택된 series가 있는데 이름이 달라지면 true — stale metadata 초기화 대상(핵심 P0 케이스)", () => {
    const series = fakeSeries({ canonicalName: "부산국제록페스티벌" });
    expect(shouldResetMetadataOnNameEdit("인천 새로운 축제", series)).toBe(true);
  });
});

describe("isDurationValid - 8절", () => {
  it("빈 문자열은 invalid", () => {
    expect(isDurationValid("")).toBe(false);
  });
  it("0은 invalid(>0 조건)", () => {
    expect(isDurationValid(0)).toBe(false);
  });
  it("음수는 invalid", () => {
    expect(isDurationValid(-3)).toBe(false);
  });
  it("NaN/Infinity는 invalid", () => {
    expect(isDurationValid(NaN)).toBe(false);
    expect(isDurationValid(Infinity)).toBe(false);
  });
  it("양수는 valid", () => {
    expect(isDurationValid(5)).toBe(true);
    expect(isDurationValid(1)).toBe(true);
  });
});

/**
 * PHASE 6 — computeMissingRequiredFields 시그니처에 festivalMode/selectedSeries가 추가됐다
 * (EXISTING mode에서는 selectedSeries가 없으면 "기존 축제 선택"이 최우선 누락 사유가 되도록).
 * 이 describe block의 원래 시나리오(Phase 5 당시 작성)는 전부 자유입력(NEW mode) 케이스이므로
 * festivalMode:"NEW", selectedSeries:null을 그대로 채워 기존 검증 내용은 100% 보존한다 - 새
 * 시나리오를 추가하는 게 아니라 새 필수 인자만 채워 컴파일/동작을 맞춘다.
 */
describe("computeMissingRequiredFields - 9절/13절 acceptance", () => {
  it("전부 채워져 있으면 빈 배열(submit 가능)", () => {
    expect(
      computeMissingRequiredFields({ festivalMode: "NEW", selectedSeries: null, regionCode: "BUSAN", festivalTypes: [FestivalType.CULTURE_ART], venueType: "GREEN", durationDays: 5 })
    ).toEqual([]);
  });

  it("duration이 빈 값이면 목록에 '개최일수'가 포함되고 submit 불가", () => {
    const missing = computeMissingRequiredFields({ festivalMode: "NEW", selectedSeries: null, regionCode: "BUSAN", festivalTypes: [FestivalType.CULTURE_ART], venueType: "GREEN", durationDays: "" });
    expect(missing).toContain("개최일수");
  });

  it("13절 acceptance — 부산국제록페스티벌 선택 직후(region/type/venue STABLE, duration 미입력) 상태는 '개최일수'만 누락", () => {
    const missing = computeMissingRequiredFields({ festivalMode: "NEW", selectedSeries: null, regionCode: "BUSAN", festivalTypes: [FestivalType.CULTURE_ART], venueType: "GREEN", durationDays: "" });
    expect(missing).toEqual(["개최일수"]);
  });

  it("14절 acceptance — 대학로 차 없는 거리 축제 선택 직후(venueType MIXED→'', duration 미입력) 상태는 '장소 유형', '개최일수' 누락", () => {
    const missing = computeMissingRequiredFields({ festivalMode: "NEW", selectedSeries: null, regionCode: "SEOUL", festivalTypes: [FestivalType.CULTURE_ART], venueType: "", durationDays: "" });
    expect(missing).toEqual(["장소 유형", "개최일수"]);
  });

  it("regionCode가 비어 있으면 목록 맨 앞에 '광역자치단체'", () => {
    const missing = computeMissingRequiredFields({ festivalMode: "NEW", selectedSeries: null, regionCode: "", festivalTypes: [], venueType: "", durationDays: "" });
    expect(missing).toEqual(["광역자치단체", "축제 유형", "장소 유형", "개최일수"]);
  });

  it("PHASE 6 — EXISTING mode인데 selectedSeries가 없으면 '기존 축제 선택'이 최우선 누락 사유다", () => {
    const missing = computeMissingRequiredFields({ festivalMode: "EXISTING", selectedSeries: null, regionCode: "BUSAN", festivalTypes: [FestivalType.CULTURE_ART], venueType: "GREEN", durationDays: 5 });
    expect(missing).toEqual(["기존 축제 선택"]);
  });

  it("PHASE 6 — EXISTING mode에서 selectedSeries가 있으면(다른 필드도 채워짐) 더 이상 '기존 축제 선택'이 누락되지 않는다", () => {
    const missing = computeMissingRequiredFields({ festivalMode: "EXISTING", selectedSeries: fakeSeries(), regionCode: "BUSAN", festivalTypes: [FestivalType.CULTURE_ART], venueType: "GREEN", durationDays: 5 });
    expect(missing).toEqual([]);
  });
});
