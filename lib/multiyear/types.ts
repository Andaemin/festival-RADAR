import { FallbackLevel, FestivalType, Region, VenueType } from "@/lib/domain/enums";

/**
 * 계산에 필요한 필드만 담은 경량 레코드. DB의 MultiYearFestivalRecord 전체가 아니라
 * baseline S0 계산에 실제로 쓰이는 값만 미리 뽑아 둔다(성능 + 계산 코드와 Prisma 모델 분리).
 *
 * districtRaw는 의도적으로 placeholder 정규화(Phase 2의 `district` 컬럼)를 거치지 않은 원문이다 -
 * Spring MultiYearFeatureResolver.resolveDistrict와 동일하게 원문 그대로 비교한다.
 *
 * typeTokens는 production FestivalType 5종과의 교집합만 담는다(OTHER/UNKNOWN은 제외) -
 * Spring MultiYearFeatureResolver.resolveTypeTokens와 동일.
 */
export interface MultiYearRecordLite {
  id: number;
  datasetYear: number;
  festivalName: string;
  /** 자연키 구성요소 - Spring reference와 hash 비교를 위해 보존(계산 자체에는 안 씀). */
  sourceSha256: string;
  sourceSheet: string;
  sourceRow: number;
  region: Region | null;
  /** districtRaw를 trim한 값(placeholder 정규화는 거치지 않음) - resolveDistrict()의 결과. */
  district: string | null;
  typeTokens: Set<FestivalType>;
  venueType: VenueType | null;
  durationDays: number | null;
  budgetKrw: number;
}

export interface MultiYearQuery {
  region: Region;
  district: string | null;
  typeTokens: Set<FestivalType>;
  venueType: VenueType | null;
  durationDays: number | null;
}

export interface MultiYearSimilarityScore {
  typeScore: number;
  regionScore: number;
  venueAvailable: boolean;
  venueScore: number;
  durationAvailable: boolean;
  durationScore: number;
  similarity: number;
  weight: number;
}

export interface MultiYearLevelContribution {
  level: FallbackLevel;
  added: number;
  cumulativeTotal: number;
}

export interface MultiYearCandidateSelectionResult {
  level: FallbackLevel;
  candidates: MultiYearRecordLite[];
  levelBreakdown: MultiYearLevelContribution[];
  originLevelByRecordId: Map<number, FallbackLevel>;
}

export interface MultiYearScoredCandidate {
  record: MultiYearRecordLite;
  score: MultiYearSimilarityScore;
  adjustedBudgetKrw: number;
  winsorizedBudgetKrw: number;
  originLevel: FallbackLevel | null;
}

export interface MultiYearDataQualityV3 {
  sampleQuality: number;
  similarityQuality: number;
  stabilityQuality: number;
  completenessQuality: number;
  localEvidenceQuality: number;
  score: number;
}

export interface MultiYearPredictionCandidate {
  sourceYear: number;
  festivalName: string;
  region: string | null;
  district: string | null;
  festivalType: string;
  venueType: string | null;
  durationDays: number | null;
  originalBudgetKrw: number;
  durationAdjustedBudgetKrw: number;
  similarity: number;
  finalWeight: number;
  fallbackStage: string | null;
}

export interface MultiYearPredictionResult {
  targetYear: number;
  trainingYearFrom: number;
  trainingYearTo: number;
  estimatedBudgetKrw: number;
  weightedAverageBudgetKrw: number;
  recommendedBudgetKrw: number;
  p25Krw: number;
  p50Krw: number;
  p75Krw: number;
  sampleCount: number;
  distinctYearsUsed: number;
  earliestSourceYear: number | null;
  latestSourceYear: number | null;
  fallbackLevel: string;
  averageSimilarity: number;
  dataQualityV3: number;
  topCandidates: MultiYearPredictionCandidate[];
}
