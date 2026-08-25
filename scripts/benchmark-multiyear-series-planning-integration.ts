/**
 * PHASE 9C-C — 6절 최종 offline benchmark. `applySeriesPlanningSemantics`(실제 production
 * 함수, lib/multiyear-series/apply-planning-semantics.ts)와 `computeSeriesSignal`(route.ts가
 * 쓰는 것과 동일한 함수)을 그대로 이용해 leakage-safe backtest(2024/2025/2026 fold, target
 * 3,432건) 전체를 다시 평가한다.
 *
 * 목적:
 *  1) estimatedBudgetKrw가 Phase 9C-B의 B1과, recommendedBudgetKrw가 R1과 정확히 일치하는지
 *     교차검증(같은 수식을 손으로 다시 짠 게 아니라 실제 production 함수로 재현).
 *  2) series unavailable(NOT_REQUESTED/UNMATCHED/AMBIGUOUS/NO_VALID_HISTORY) subset은
 *     기존 Planning V1과 완전히 동일해야 함을 assert.
 *  3) 최종 성능(overall/series-eligible/budget-size/fold별 MdAPE 등)을 기록.
 *
 * 실행: npx tsx scripts/benchmark-multiyear-series-planning-integration.ts
 */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";
import { computeCoreStats, selectFinalSample } from "../lib/multiyear/baseline-estimator";
import { selectMultiYearCandidatesV1 } from "../lib/multiyear/candidate-selector-v1";
import { MultiYearQuery } from "../lib/multiyear/types";
import { quantile } from "../lib/utils/weighted-statistics";
import { applySeriesPlanningSemantics } from "../lib/multiyear-series/apply-planning-semantics";
import { buildSeriesEvalTargets, buildSeriesTrainingPool } from "../lib/multiyear-series/fold";
import { loadAllSeriesRecords, SeriesRecordWithQuality } from "../lib/multiyear-series/record-loader";
import { buildFrozenSeriesModel } from "../lib/multiyear-series/series-linker";
import { computeSeriesSignal } from "../lib/multiyear-series/series-signal";
import { SeriesRecordLite } from "../lib/multiyear-series/types";

const FOLD_YEARS = [2024, 2025, 2026];
const BUDGET_BUCKET_LABELS = ["<= 100M", "100M~300M", "300M~1B", "1B~3B", "> 3B"];
const BUDGET_BUCKET_UPPER = [100_000_000, 300_000_000, 1_000_000_000, 3_000_000_000];

function bucketLabel(actualKrw: number): string {
  for (let i = 0; i < BUDGET_BUCKET_UPPER.length; i++) {
    if (actualKrw <= BUDGET_BUCKET_UPPER[i]) return BUDGET_BUCKET_LABELS[i];
  }
  return BUDGET_BUCKET_LABELS[BUDGET_BUCKET_LABELS.length - 1];
}

interface Row {
  targetYear: number;
  actualBudget: number;
  b0Estimated: number;
  b0Recommended: number;
  seriesEligible: boolean;
  finalEstimated: number;
  finalRecommended: number;
  estimateBasis: string;
  recommendationBasis: string;
}

function ape(estimate: number, actual: number): number {
  if (actual <= 0) return NaN;
  return Math.abs(estimate - actual) / actual;
}
function signedLogError(estimate: number, actual: number): number {
  if (estimate <= 0 || actual <= 0) return NaN;
  return Math.log(estimate / actual);
}
function pct(x: number): string {
  return Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "N/A";
}
function num(x: number): string {
  return Number.isFinite(x) ? x.toFixed(3) : "N/A";
}

function metricsLine(label: string, rows: Row[], valueOf: (r: Row) => number) {
  const apes: number[] = [];
  const sles: number[] = [];
  let over100 = 0,
    over300 = 0,
    over1000 = 0,
    within25 = 0,
    within50 = 0;
  for (const r of rows) {
    const est = valueOf(r);
    const a = ape(est, r.actualBudget);
    if (Number.isFinite(a)) {
      apes.push(a);
      if (a <= 0.25) within25++;
      if (a <= 0.5) within50++;
      if (a > 1.0) over100++;
      if (a > 3.0) over300++;
      if (a > 10.0) over1000++;
    }
    const sle = signedLogError(est, r.actualBudget);
    if (Number.isFinite(sle)) sles.push(sle);
  }
  const n = rows.length;
  const mdApe = apes.length ? quantile(apes, 0.5) : NaN;
  const p75Ape = apes.length ? quantile(apes, 0.75) : NaN;
  const p90Ape = apes.length ? quantile(apes, 0.9) : NaN;
  const medianSignedLog = sles.length ? quantile(sles, 0.5) : NaN;
  console.log(
    `  ${label.padEnd(28)} n=${String(n).padEnd(5)} MdAPE=${pct(mdApe).padStart(7)} P75APE=${pct(p75Ape).padStart(7)} P90APE=${pct(p90Ape).padStart(8)} medianSignedLog=${num(medianSignedLog).padStart(7)} ±25%=${pct(within25 / n).padStart(6)} ±50%=${pct(within50 / n).padStart(6)} | APE>100%=${over100} >300%=${over300} >1000%=${over1000}`
  );
}

function buildQueryFromRecord(r: SeriesRecordLite): MultiYearQuery {
  return { region: r.region!, district: r.district, typeTokens: r.typeTokens, venueType: r.venueType, durationDays: r.durationDays };
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });
  let allSeriesRecords: SeriesRecordWithQuality[];
  try {
    allSeriesRecords = await loadAllSeriesRecords(prisma);
  } finally {
    await prisma.$disconnect();
  }

  const rows: Row[] = [];
  let crossCheckMismatches = 0;
  let unavailableMismatches = 0;

  for (const targetYear of FOLD_YEARS) {
    const { trainingPool } = buildSeriesTrainingPool(allSeriesRecords, targetYear);
    const evalTargets = buildSeriesEvalTargets(allSeriesRecords, targetYear);
    const seriesModel = buildFrozenSeriesModel(trainingPool);

    for (const target of evalTargets) {
      const query = buildQueryFromRecord(target);
      const fs = selectFinalSample(trainingPool, query, selectMultiYearCandidatesV1);
      if (fs === null) continue;
      const weights = fs.finalSample.map((c) => c.score.weight);
      const stats = computeCoreStats(fs, weights, query.district !== null);

      const b0Estimated = Math.round(stats.estimated);
      const b0Recommended = Math.round(stats.recommendedBudget);
      const b0P60 = Math.round(stats.p60);

      // route.ts와 완전히 동일한 두 production 함수 호출.
      const seriesSignal = computeSeriesSignal(target.festivalName, target.region!, target.district, target.typeTokens, targetYear, seriesModel);
      const applied = applySeriesPlanningSemantics({ estimatedBudgetKrw: b0Estimated, recommendedBudgetKrw: b0Recommended, p60Krw: b0P60 }, seriesSignal);

      const seriesEligible = seriesSignal.status === "MATCHED" && seriesSignal.seriesEstimatedBudgetKrw !== undefined;

      // 교차검증: Phase 9C-B B1/R1 정의를 손으로 재현해서 production 함수 결과와 완전히 일치하는지.
      const existingContingency = b0Recommended / Math.max(b0Estimated, b0P60) - 1;
      const expectedEstimated = seriesEligible ? seriesSignal.seriesEstimatedBudgetKrw! : b0Estimated;
      const expectedRecommended = seriesEligible ? Math.round(seriesSignal.seriesEstimatedBudgetKrw! * (1 + existingContingency)) : b0Recommended;
      if (applied.estimatedBudgetKrw !== expectedEstimated || applied.recommendedBudgetKrw !== expectedRecommended) {
        crossCheckMismatches++;
      }
      if (!seriesEligible && (applied.estimatedBudgetKrw !== b0Estimated || applied.recommendedBudgetKrw !== b0Recommended)) {
        unavailableMismatches++;
      }

      rows.push({
        targetYear,
        actualBudget: target.budgetKrw,
        b0Estimated,
        b0Recommended,
        seriesEligible,
        finalEstimated: applied.estimatedBudgetKrw,
        finalRecommended: applied.recommendedBudgetKrw,
        estimateBasis: applied.estimateBasis,
        recommendationBasis: applied.recommendationBasis,
      });
    }
  }

  console.log("================ Phase 9C-C: applySeriesPlanningSemantics 최종 offline benchmark ================");
  console.log(`target 평가 대상: ${rows.length}건`);
  console.log(`Phase 9C-B B1/R1 정의와의 교차검증 불일치: ${crossCheckMismatches}건 (0이어야 정상)`);
  console.log(`series unavailable subset 중 peer와 다른 값이 나온 건수: ${unavailableMismatches}건 (0이어야 정상 - 기존 Planning V1과 exact 동일해야 함)`);
  const eligible = rows.filter((r) => r.seriesEligible);
  console.log(`series-eligible(=estimateBasis SERIES_HISTORY_MEDIAN): ${eligible.length}건 (${((100 * eligible.length) / rows.length).toFixed(1)}%)`);
  console.log("");

  console.log("--- 최종 estimatedBudgetKrw 성능 (final = applySeriesPlanningSemantics 결과) ---");
  metricsLine("peer(B0) overall", rows, (r) => r.b0Estimated);
  metricsLine("final overall", rows, (r) => r.finalEstimated);
  metricsLine("peer(B0) series-eligible", eligible, (r) => r.b0Estimated);
  metricsLine("final series-eligible", eligible, (r) => r.finalEstimated);
  console.log("");
  for (const label of BUDGET_BUCKET_LABELS) {
    const group = rows.filter((r) => bucketLabel(r.actualBudget) === label);
    metricsLine(`peer [${label}]`, group, (r) => r.b0Estimated);
    metricsLine(`final [${label}]`, group, (r) => r.finalEstimated);
  }
  console.log("");
  for (const targetYear of FOLD_YEARS) {
    const group = rows.filter((r) => r.targetYear === targetYear);
    metricsLine(`peer [${targetYear}]`, group, (r) => r.b0Estimated);
    metricsLine(`final [${targetYear}]`, group, (r) => r.finalEstimated);
  }
  console.log("");

  console.log("--- 최종 recommendedBudgetKrw 성능(series-eligible subset) ---");
  metricsLine("peer(B0.recommended)", eligible, (r) => r.b0Recommended);
  metricsLine("final(recommended)", eligible, (r) => r.finalRecommended);
  console.log("");

  console.log("================ benchmark 끝 ================");
  process.exit(crossCheckMismatches > 0 || unavailableMismatches > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
