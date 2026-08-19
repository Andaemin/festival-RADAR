/**
 * 예산 추정 알고리즘의 모든 설정값 (Java AlgorithmConfig 직접 이식).
 * 숫자를 바꿀 때는 이 파일만 수정한다.
 */
export const algorithmConfig = {
  version: "v1.0.0",

  // 유사도 가중치 (합 = 1.0)
  festivalTypeWeight: 0.40,
  regionWeight: 0.25,
  venueTypeWeight: 0.20,
  durationWeight: 0.15,

  // 유사도 하위 점수
  festivalTypeSameScore: 1.00,
  festivalTypeDifferentScore: 0.10,

  regionSameDistrictScore: 1.00,
  regionSameProvinceScore: 0.80,
  regionDifferentProvinceScore: 0.30,

  venueTypeSameScore: 1.00,
  venueTypeOneUndecidedScore: 0.45,
  venueTypeDifferentScore: 0.25,

  durationMissingScore: 0.35,
  similarityMinThreshold: 0.35,

  // 기간 보정
  durationElasticity: 0.55,
  durationRatioClampMin: 0.5,
  durationRatioClampMax: 2.0,

  // 표본 크기
  minSampleCount: 8,
  recommendedSampleCount: 20,
  maxSampleCount: 50,

  // 예비비
  contingencyBaseRate: 0.05,
  contingencyMaxExtraRate: 0.10,

  // 신뢰도 가중치 (legacy v1.0)
  confidenceSampleWeight: 0.30,
  confidenceSimilarityWeight: 0.40,
  confidenceStabilityWeight: 0.20,
  confidenceCompletenessWeight: 0.10,

  confidenceHighThreshold: 80,
  confidenceMediumThreshold: 60,
  confidenceLowSampleCap: 5,
  confidenceLowSampleCapScore: 55,
  confidenceInsufficientSampleThreshold: 3,
  confidenceSampleScoreDivisor: 25,
  confidenceDispersionCap: 1.5,

  // 이상치 완화
  winsorizeLowerPercentile: 0.05,
  winsorizeUpperPercentile: 0.95,

  // 추천 예산 기준 백분위
  recommendedBasePercentile: 0.60,

  // 신뢰도 v1.1
  confidenceV11EffectiveSampleDivisor: 30,
  confidenceV11SampleWeight: 0.20,
  confidenceV11SimilarityWeight: 0.35,
  confidenceV11StabilityWeight: 0.25,
  confidenceV11CompletenessWeight: 0.10,
  confidenceV11ScopeWeight: 0.10,

  scopeScoreSameDistrictTypeVenue: 1.00,
  scopeScoreSameRegionTypeVenue: 0.90,
  scopeScoreNationwideTypeVenue: 0.70,
  scopeScoreSameRegionType: 0.60,
  scopeScoreNationwideType: 0.45,
  scopeScoreGlobalSimilarity: 0.30,

  // 신뢰도 v1.2
  confidenceV12SampleWeight: 0.20,
  confidenceV12SimilarityWeight: 0.40,
  confidenceV12StabilityWeight: 0.30,
  confidenceV12CompletenessWeight: 0.10,
} as const;

export type AlgorithmConfig = typeof algorithmConfig;
