/**
 * Spring에서 직접 생성한 golden fixture(fixtures/multiyear/candidate-selector-v1-reference.csv,
 * 1,692건 - MultiYearSelectorLabBenchmarkBuilder가 만드는 2026 실데이터 기반 벤치마크 쿼리
 * 전량)를 ground-truth로 삼아 Express V0/V1 selector가 동일한 결과를 내는지 검증한다.
 * DB에 아무것도 쓰지 않는다(읽기 전용).
 *
 * 실행: npx tsx scripts/verify-multiyear-candidate-selector-v1.ts [--file <csv-path>] [--limit N]
 */
import "dotenv/config";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";
import { FestivalType, Region, VenueType } from "../lib/domain/enums";
import { buildTrainingPool, selectFinalSample } from "../lib/multiyear/baseline-estimator";
import { selectMultiYearCandidates } from "../lib/multiyear/candidate-selector";
import { selectMultiYearCandidatesV1 } from "../lib/multiyear/candidate-selector-v1";
import { loadAllMultiYearRecords } from "../lib/multiyear/record-loader";
import { MultiYearQuery, MultiYearRecordLite, MultiYearScoredCandidate } from "../lib/multiyear/types";
import { effectiveYearCount, latestYearWeightShare, maxYearWeightShare } from "../lib/multiyear/year-concentration";
import { weightedGeometricMean, weightedMean } from "../lib/utils/weighted-statistics";

const DEFAULT_FIXTURE_PATH = "fixtures/multiyear/candidate-selector-v1-reference.csv";
const KNOWN_FESTIVAL_TYPES = new Set<string>(Object.values(FestivalType));
const NUMERIC_ABS_TOLERANCE = 1e-6;
const BUDGET_REL_TOLERANCE = 1e-4; // 예산은 Phase 3에서 이미 확인된 Math.pow 1ULP 한계가 있어 약간 넓게

function parseArgs(argv: string[]): { file: string; limit: number | null } {
  let file = DEFAULT_FIXTURE_PATH;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") file = argv[++i];
    else if (argv[i].startsWith("--file=")) file = argv[i].slice("--file=".length);
    else if (argv[i] === "--limit") limit = Number(argv[++i]);
    else if (argv[i].startsWith("--limit=")) limit = Number(argv[i].slice("--limit=".length));
  }
  return { file: path.resolve(file), limit };
}

interface FixtureRow {
  benchmarkType: string;
  region: string;
  district: string | null;
  festivalType: string;
  venueType: string | null;
  durationDays: number;
  v0_selectorCandidateCount: number;
  v0_selectorTopYearShare: number;
  v0_reachedFallbackLevel: string;
  v0_finalSampleCount: number;
  v0_finalDistinctYearsUsed: number;
  v0_finalEffectiveYearCount: number;
  v0_finalLatestYearWeightShare: number;
  v0_averageSimilarity: number;
  v0_minimumSimilarity: number;
  v0_estimatedBudget: number;
  v0_selectedCandidatesHash: string;
  v0_finalSampleHash: string;
  v1_selectorCandidateCount: number;
  v1_selectorTopYearShare: number;
  v1_reachedFallbackLevel: string;
  v1_qualityGateActivated: boolean;
  v1_qualityFloor: number;
  v1_bestSimilarityAtActivation: number;
  v1_topYearShareAtDecision: number;
  v1_finalSampleCount: number;
  v1_finalDistinctYearsUsed: number;
  v1_finalEffectiveYearCount: number;
  v1_finalLatestYearWeightShare: number;
  v1_averageSimilarity: number;
  v1_minimumSimilarity: number;
  v1_estimatedBudget: number;
  v1_selectedCandidatesHash: string;
  v1_finalSampleHash: string;
}

function loadFixture(filePath: string): FixtureRow[] {
  if (!fs.existsSync(filePath)) throw new Error(`fixture CSV를 찾을 수 없습니다: ${filePath}`);
  let content = fs.readFileSync(filePath, "utf-8");
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const wb = XLSX.read(content, { type: "string" });
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number | null>>(wb.Sheets[wb.SheetNames[0]], { defval: null });

  const num = (v: unknown) => (v === null || v === "" ? NaN : Number(v));
  const str = (v: unknown) => (v === null ? null : String(v));

  return rows.map((r) => ({
    benchmarkType: String(r["benchmarkType"]),
    region: String(r["region"]),
    district: str(r["district"]),
    festivalType: String(r["festivalType"]),
    venueType: str(r["venueType"]),
    durationDays: num(r["durationDays"]),
    v0_selectorCandidateCount: num(r["v0_selectorCandidateCount"]),
    v0_selectorTopYearShare: num(r["v0_selectorTopYearShare"]),
    v0_reachedFallbackLevel: String(r["v0_reachedFallbackLevel"]),
    v0_finalSampleCount: num(r["v0_finalSampleCount"]),
    v0_finalDistinctYearsUsed: num(r["v0_finalDistinctYearsUsed"]),
    v0_finalEffectiveYearCount: num(r["v0_finalEffectiveYearCount"]),
    v0_finalLatestYearWeightShare: num(r["v0_finalLatestYearWeightShare"]),
    v0_averageSimilarity: num(r["v0_averageSimilarity"]),
    v0_minimumSimilarity: num(r["v0_minimumSimilarity"]),
    v0_estimatedBudget: num(r["v0_estimatedBudget"]),
    v0_selectedCandidatesHash: String(r["v0_selectedCandidatesHash"]),
    v0_finalSampleHash: String(r["v0_finalSampleHash"]),
    v1_selectorCandidateCount: num(r["v1_selectorCandidateCount"]),
    v1_selectorTopYearShare: num(r["v1_selectorTopYearShare"]),
    v1_reachedFallbackLevel: String(r["v1_reachedFallbackLevel"]),
    v1_qualityGateActivated: String(r["v1_qualityGateActivated"]) === "true",
    v1_qualityFloor: num(r["v1_qualityFloor"]),
    v1_bestSimilarityAtActivation: num(r["v1_bestSimilarityAtActivation"]),
    v1_topYearShareAtDecision: num(r["v1_topYearShareAtDecision"]),
    v1_finalSampleCount: num(r["v1_finalSampleCount"]),
    v1_finalDistinctYearsUsed: num(r["v1_finalDistinctYearsUsed"]),
    v1_finalEffectiveYearCount: num(r["v1_finalEffectiveYearCount"]),
    v1_finalLatestYearWeightShare: num(r["v1_finalLatestYearWeightShare"]),
    v1_averageSimilarity: num(r["v1_averageSimilarity"]),
    v1_minimumSimilarity: num(r["v1_minimumSimilarity"]),
    v1_estimatedBudget: num(r["v1_estimatedBudget"]),
    v1_selectedCandidatesHash: String(r["v1_selectedCandidatesHash"]),
    v1_finalSampleHash: String(r["v1_finalSampleHash"]),
  }));
}

function buildQuery(row: FixtureRow): MultiYearQuery {
  const typeTokens = new Set<FestivalType>();
  for (const token of row.festivalType.split("+")) {
    const trimmed = token.trim();
    if (KNOWN_FESTIVAL_TYPES.has(trimmed)) typeTokens.add(trimmed as FestivalType);
  }
  return {
    region: row.region as Region,
    district: row.district,
    typeTokens,
    venueType: row.venueType ? (row.venueType as VenueType) : null,
    durationDays: Number.isFinite(row.durationDays) ? row.durationDays : null,
  };
}

/** Java MessageDigest("SHA-256") + 자연키 문자열 정렬 + ";" join과 동일한 해시. */
function hashNaturalKeys(records: MultiYearRecordLite[]): string {
  const keys = records
    .map((r) => `${r.datasetYear}|${r.sourceSha256}|${r.sourceSheet}|${r.sourceRow}`)
    .sort();
  return crypto.createHash("sha256").update(keys.join(";"), "utf-8").digest("hex");
}

interface RowSummary {
  selectorCandidateCount: number;
  selectorTopYearShare: number;
  reachedLevel: string;
  finalSampleCount: number;
  finalDistinctYears: number;
  finalEffectiveYearCount: number;
  finalLatestYearWeightShare: number;
  averageSimilarity: number;
  minimumSimilarity: number;
  estimatedBudget: number;
  selectedCandidatesHash: string;
  finalSampleHash: string;
}

function summarize(
  candidates: MultiYearRecordLite[],
  topYearShare: number,
  reachedLevel: string,
  fs: { finalSample: MultiYearScoredCandidate[] } | null
): RowSummary {
  const selectedHash = hashNaturalKeys(candidates);
  if (fs === null) {
    return {
      selectorCandidateCount: candidates.length,
      selectorTopYearShare: topYearShare,
      reachedLevel,
      finalSampleCount: 0,
      finalDistinctYears: 0,
      finalEffectiveYearCount: 0,
      finalLatestYearWeightShare: 0,
      averageSimilarity: 0,
      minimumSimilarity: 0,
      estimatedBudget: 0,
      selectedCandidatesHash: selectedHash,
      finalSampleHash: "EMPTY",
    };
  }
  const finalSample = fs.finalSample;
  const weights = finalSample.map((c) => c.score.weight);
  const similarities = finalSample.map((c) => c.score.similarity);
  const values = finalSample.map((c) => c.winsorizedBudgetKrw);
  const avgSim = weightedMean(similarities, weights);
  const minSim = Math.min(...similarities);
  const estimated = weightedGeometricMean(values, weights);

  const yearWeightRows = finalSample.map((c, i) => ({ datasetYear: c.record.datasetYear, weight: weights[i] }));
  const distinctYears = new Set(finalSample.map((c) => c.record.datasetYear)).size;
  const effYearCount = effectiveYearCount(yearWeightRows);
  const latestShare = latestYearWeightShare(yearWeightRows);

  const finalRecords = finalSample.map((c) => c.record);
  const finalHash = hashNaturalKeys(finalRecords);

  return {
    selectorCandidateCount: candidates.length,
    selectorTopYearShare: topYearShare,
    reachedLevel,
    finalSampleCount: finalSample.length,
    finalDistinctYears: distinctYears,
    finalEffectiveYearCount: effYearCount,
    finalLatestYearWeightShare: latestShare,
    averageSimilarity: avgSim,
    minimumSimilarity: minSim,
    estimatedBudget: estimated,
    selectedCandidatesHash: selectedHash,
    finalSampleHash: finalHash,
  };
}

interface Mismatch {
  row: FixtureRow;
  field: string;
  expected: string;
  actual: string;
}

async function main() {
  const { file, limit } = parseArgs(process.argv.slice(2));
  console.log(`fixture: ${file}`);
  const fixtureRows = loadFixture(file);
  const rowsToCheck = limit ? fixtureRows.slice(0, limit) : fixtureRows;
  console.log(`fixture rows: ${fixtureRows.length}, 검증 대상: ${rowsToCheck.length}`);

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });
  let allRecords;
  try {
    allRecords = await loadAllMultiYearRecords(prisma);
  } finally {
    await prisma.$disconnect();
  }
  const { trainingPool } = buildTrainingPool(allRecords, 2026);
  console.log(`training pool size: ${trainingPool.length}`);

  const exactFields = new Set([
    "reachedFallbackLevel",
    "selectorCandidateCount",
    "finalSampleCount",
    "finalDistinctYearsUsed",
    "qualityGateActivated",
    "selectedCandidatesHash",
    "finalSampleHash",
  ]);

  const fieldCounts: Record<string, { pass: number; fail: number }> = {};
  const mismatches: Mismatch[] = [];
  let rowsFullyMatched = 0;

  const bump = (field: string, pass: boolean) => {
    fieldCounts[field] ??= { pass: 0, fail: 0 };
    fieldCounts[field][pass ? "pass" : "fail"]++;
  };

  let progress = 0;
  for (const row of rowsToCheck) {
    progress++;
    if (progress % 200 === 0) console.log(`progress ${progress}/${rowsToCheck.length}`);

    const query = buildQuery(row);

    const sel0 = selectMultiYearCandidates(trainingPool, query);
    const topShare0 = maxYearWeightShare(sel0.candidates, query);
    const fs0 = selectFinalSample(trainingPool, query, selectMultiYearCandidates);
    const s0 = summarize(sel0.candidates, topShare0, sel0.level, fs0);

    const sel1 = selectMultiYearCandidatesV1(trainingPool, query);
    const fs1 = selectFinalSample(trainingPool, query, selectMultiYearCandidatesV1);
    const s1 = summarize(sel1.candidates, sel1.candidates.length > 0 ? maxYearWeightShare(sel1.candidates, query) : 0, sel1.level, fs1);

    let rowOk = true;
    const checkExact = (field: string, expected: unknown, actual: unknown) => {
      const ok = String(expected) === String(actual);
      bump(field, ok);
      if (!ok) {
        rowOk = false;
        mismatches.push({ row, field, expected: String(expected), actual: String(actual) });
      }
    };
    const checkNumeric = (field: string, expected: number, actual: number, relTolerance = NUMERIC_ABS_TOLERANCE) => {
      const ok =
        (Number.isNaN(expected) && Number.isNaN(actual)) ||
        Math.abs(expected - actual) <= NUMERIC_ABS_TOLERANCE ||
        Math.abs(expected - actual) <= Math.abs(expected) * relTolerance;
      bump(field, ok);
      if (!ok) {
        rowOk = false;
        mismatches.push({ row, field, expected: String(expected), actual: String(actual) });
      }
    };

    // V0 - exact
    checkExact("v0_reachedFallbackLevel", row.v0_reachedFallbackLevel, s0.reachedLevel);
    checkExact("v0_selectorCandidateCount", row.v0_selectorCandidateCount, s0.selectorCandidateCount);
    checkExact("v0_finalSampleCount", row.v0_finalSampleCount, s0.finalSampleCount);
    checkExact("v0_finalDistinctYearsUsed", row.v0_finalDistinctYearsUsed, s0.finalDistinctYears);
    checkExact("v0_selectedCandidatesHash", row.v0_selectedCandidatesHash, s0.selectedCandidatesHash);
    checkExact("v0_finalSampleHash", row.v0_finalSampleHash, s0.finalSampleHash);
    // V0 - tolerance
    checkNumeric("v0_selectorTopYearShare", row.v0_selectorTopYearShare, s0.selectorTopYearShare);
    checkNumeric("v0_finalEffectiveYearCount", row.v0_finalEffectiveYearCount, s0.finalEffectiveYearCount);
    checkNumeric("v0_finalLatestYearWeightShare", row.v0_finalLatestYearWeightShare, s0.finalLatestYearWeightShare);
    checkNumeric("v0_averageSimilarity", row.v0_averageSimilarity, s0.averageSimilarity);
    checkNumeric("v0_minimumSimilarity", row.v0_minimumSimilarity, s0.minimumSimilarity);
    checkNumeric("v0_estimatedBudget", row.v0_estimatedBudget, s0.estimatedBudget, BUDGET_REL_TOLERANCE);

    // V1 - exact
    checkExact("v1_reachedFallbackLevel", row.v1_reachedFallbackLevel, s1.reachedLevel);
    checkExact("v1_selectorCandidateCount", row.v1_selectorCandidateCount, s1.selectorCandidateCount);
    checkExact("v1_finalSampleCount", row.v1_finalSampleCount, s1.finalSampleCount);
    checkExact("v1_finalDistinctYearsUsed", row.v1_finalDistinctYearsUsed, s1.finalDistinctYears);
    checkExact("v1_qualityGateActivated", row.v1_qualityGateActivated, sel1.qualityGateActivated);
    checkExact("v1_selectedCandidatesHash", row.v1_selectedCandidatesHash, s1.selectedCandidatesHash);
    checkExact("v1_finalSampleHash", row.v1_finalSampleHash, s1.finalSampleHash);
    // V1 - tolerance
    checkNumeric("v1_selectorTopYearShare", row.v1_selectorTopYearShare, s1.selectorTopYearShare);
    if (row.v1_qualityGateActivated) {
      checkNumeric("v1_qualityFloor", row.v1_qualityFloor, sel1.qualityFloor);
      checkNumeric("v1_bestSimilarityAtActivation", row.v1_bestSimilarityAtActivation, sel1.bestSimilarityAtActivation);
      checkNumeric("v1_topYearShareAtDecision", row.v1_topYearShareAtDecision, sel1.topYearShareAtDecision);
    }
    checkNumeric("v1_finalEffectiveYearCount", row.v1_finalEffectiveYearCount, s1.finalEffectiveYearCount);
    checkNumeric("v1_finalLatestYearWeightShare", row.v1_finalLatestYearWeightShare, s1.finalLatestYearWeightShare);
    checkNumeric("v1_averageSimilarity", row.v1_averageSimilarity, s1.averageSimilarity);
    checkNumeric("v1_minimumSimilarity", row.v1_minimumSimilarity, s1.minimumSimilarity);
    checkNumeric("v1_estimatedBudget", row.v1_estimatedBudget, s1.estimatedBudget, BUDGET_REL_TOLERANCE);

    if (rowOk) rowsFullyMatched++;
  }

  console.log("");
  console.log("── 필드별 결과 ──────────────────────────────");
  for (const [field, c] of Object.entries(fieldCounts)) {
    console.log(`${c.fail === 0 ? "✅" : "❌"} ${field.padEnd(32)} pass=${c.pass} fail=${c.fail}`);
  }
  console.log("");
  console.log(`행 전체 일치: ${rowsFullyMatched} / ${rowsToCheck.length}`);

  // concentration 해결 사례 / V0 그대로 유지 사례 카운트
  let resolvedConcentration = 0;
  let unchangedFromV0 = 0;
  for (const row of rowsToCheck) {
    if (row.v0_finalDistinctYearsUsed === 1 && row.v1_finalDistinctYearsUsed > 1) resolvedConcentration++;
    if (row.v0_selectedCandidatesHash === row.v1_selectedCandidatesHash) unchangedFromV0++;
  }
  console.log(`concentration 해결 사례(v0 distinctYears=1 -> v1 >1): ${resolvedConcentration}`);
  console.log(`V0와 V1 후보 집합이 동일(quality gate 미발동)한 사례: ${unchangedFromV0}`);

  if (mismatches.length > 0) {
    console.log("");
    console.log(`불일치 샘플 (최대 30건 / 전체 ${mismatches.length}건):`);
    for (const m of mismatches.slice(0, 30)) {
      console.log(
        `  [${m.row.benchmarkType}/${m.row.region}/${m.row.district ?? "-"}/${m.row.festivalType}/${m.row.venueType ?? "-"}/${m.row.durationDays}] ${m.field}: expected=${m.expected} actual=${m.actual}`
      );
    }
  }

  const criticalFail = Object.entries(fieldCounts).some(([f, c]) => exactFields.has(f.replace(/^v[01]_/, "")) && c.fail > 0);
  process.exit(criticalFail ? 1 : 0);
}

main().catch((e) => {
  console.error("검증 실패:", e);
  process.exit(1);
});
