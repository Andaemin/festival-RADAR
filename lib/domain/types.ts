import { FallbackLevel, FestivalType, Region, VenueType } from "./enums";

// ─── FestivalRecord (DB row를 알고리즘에서 사용하는 형태) ─────────────────────

export interface FestivalRecord {
  id: number;
  datasetYear: number;
  festivalName: string;
  region: Region;
  administrativeDistrict: string | null;
  festivalType: FestivalType;
  venueType: VenueType;
  durationDays: number | null;
  totalBudgetKrw: bigint | null;
}

// ─── API 요청 DTO ──────────────────────────────────────────────────────────

export interface BudgetEstimateRequest {
  regionCode: string;
  district?: string;
  festivalType: string;
  venueType: string;
  durationDays: number;
}

// ─── API 응답 DTO ──────────────────────────────────────────────────────────

export interface CodeName {
  code: string;
  displayName: string;
}

export interface DurationMeta {
  minimum: number;
  maximumRecommended: number;
}

export interface MetadataResponse {
  regions: CodeName[];
  festivalTypes: CodeName[];
  venueTypes: CodeName[];
  districtsByRegion: Record<string, string[]>;
  duration: DurationMeta;
  datasetYear: number;
}

export interface BudgetRange {
  minKrw: number;
  maxKrw: number;
}

export interface ConfidenceInfo {
  score: number;
  level: "HIGH" | "MEDIUM" | "LOW";
  label: string;
}

export interface SimilarFestivalDto {
  festivalName: string;
  region: string;
  festivalType: string;
  venueType: string;
  durationDays: number | null;
  budgetKrw: number;
  similarity: number;
}

export interface ScopeWeightShare {
  level: string;
  label: string;
  weightSharePercent: number;
}

export interface BudgetEstimateResponse {
  datasetYear: number;
  algorithmVersion: string;
  weightedAverageBudgetKrw: number;
  estimatedBudgetKrw: number;
  recommendedBudgetKrw: number;
  typicalRange: BudgetRange;
  p50Krw: number;
  p60Krw: number;
  sampleCount: number;
  confidence: ConfidenceInfo;
  fallbackLevel: string;
  fallbackLabel: string;
  basis: string[];
  warnings: string[];
  similarFestivals: SimilarFestivalDto[];
  scopeWeightBreakdown: ScopeWeightShare[];
}

// ─── 알고리즘 내부 타입 ────────────────────────────────────────────────────

export interface SimilarityScore {
  typeScore: number;
  regionScore: number;
  venueScore: number;
  durationScore: number;
  similarity: number;
  weight: number;
}

export interface ScoredCandidate {
  record: FestivalRecord;
  score: SimilarityScore;
  adjustedBudgetKrw: number;
  winsorizedBudgetKrw: number;
}

export interface LevelContribution {
  level: FallbackLevel;
  added: number;
  cumulativeTotal: number;
}

export interface CandidateSelectionResult {
  level: FallbackLevel;
  candidates: FestivalRecord[];
  levelBreakdown: LevelContribution[];
  originLevelByCandidateId: Map<number, FallbackLevel>;
}

export interface ConfidenceResult {
  score: number;
  level: "HIGH" | "MEDIUM" | "LOW";
  label: string;
  sampleScore: number;
  similarityScore: number;
  stabilityScore: number;
  completenessScore: number;
}

export interface ConfidenceV11Result {
  score: number;
  level: "HIGH" | "MEDIUM" | "LOW";
  label: string;
  effectiveSampleSize: number;
  effectiveSampleScore: number;
  stabilityScore: number;
  scopeScore: number;
}

export interface ConfidenceV12Result {
  score: number;
  level: "HIGH" | "MEDIUM" | "LOW";
  label: string;
}
