import "dotenv/config";
import { createHash } from "crypto";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";
import { loadAllMultiYearRecords, MultiYearRecordWithQuality } from "../lib/multiyear/record-loader";
import { ReferenceDataPolicy } from "../lib/multiyear/reference-data-policy";
import { loadPublicationStatusByYear } from "../lib/multiyear/publication-status";
import { estimateForPlanning } from "../lib/multiyear/planning-estimator";
import { MultiYearQuery } from "../lib/multiyear/types";
import { quantile } from "../lib/utils/weighted-statistics";
import { applySeriesPlanningSemantics } from "../lib/multiyear-series/apply-planning-semantics";
import {
  auditSeriesDataQuality,
  loadSeriesRecordBudgetComponents,
  SeriesRecordBudgetComponents,
} from "../lib/multiyear-series/data-quality-audit";
import { buildSeriesEvalTargets, buildSeriesTrainingPool } from "../lib/multiyear-series/fold";
import { SeriesEstimateSource } from "../lib/multiyear-series/own-history";
import { loadAllSeriesRecords, SeriesRecordWithQuality } from "../lib/multiyear-series/record-loader";
import {
  computeCpiAdjustedVolatility,
  computeLeakageSafeVolatilityThreshold,
  computePlanningReliability,
  PlanningReliabilityReasonKey,
  PlanningReliabilityTier,
} from "../lib/multiyear-series/reliability";
import { buildFrozenSeriesModel } from "../lib/multiyear-series/series-linker";
import { lookupTarget } from "../lib/multiyear-series/series-lookup";
import { computeSeriesSignal } from "../lib/multiyear-series/series-signal";
import { buildSyntheticTargetRecord } from "../lib/multiyear-series/target-from-query";

const FOLD_YEARS = [2024, 2025, 2026];

interface Row {
  targetYear: number;
  canonicalName: string;
  actualBudget: number;
  peerEstimated: number;
  finalEstimated: number;
  finalRecommended: number;
  estimateBasis: "SERIES_HISTORY_MEDIAN" | "PEER_SIMILARITY";
  seriesEligible: boolean;
  reliabilityTier: PlanningReliabilityTier;
  reasonKey: PlanningReliabilityReasonKey;
  historyCount: number | null;
  estimateSource: SeriesEstimateSource | null;
  latestHistoricalGap: number | null;
  volatility: number | null;
  auditPointSeverities: string[];
}

function ape(estimate: number, actual: number): number | null {
  if (actual <= 0) return null;
  const v = Math.abs(estimate - actual) / actual;
  return Number.isFinite(v) ? v : null;
}
function signedPct(estimate: number, actual: number): number | null {
  if (actual <= 0) return null;
  const v = (estimate - actual) / actual;
  return Number.isFinite(v) ? v : null;
}
function pct(x: number | null): string {
  return x === null || !Number.isFinite(x) ? "N/A" : `${(x * 100).toFixed(2)}%`;
}

interface Summary {
  n: number;
  estMdApe: number | null;
  recMdApe: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  under30: number | null;
  under50: number | null;
  over100: number | null;
  medianSigned: number | null;
  overRate: number | null;
  underRate: number | null;
  /** recommendedBudgetKrw < actualBudget * 0.7인 비율 - "보수적으로 제안했는데도 실제보다
   *  크게 부족했던" 케이스(추천액 자체의 심각한 과소추정, docs/budget-algorithm-final.md §25). */
  severeUnderRecommendationRate: number | null;
}

function summarize(rows: Row[]): Summary {
  const estApes = rows.map((r) => ape(r.finalEstimated, r.actualBudget)).filter((v): v is number => v !== null);
  const recApes = rows.map((r) => ape(r.finalRecommended, r.actualBudget)).filter((v): v is number => v !== null);
  const signed = rows.map((r) => signedPct(r.finalEstimated, r.actualBudget)).filter((v): v is number => v !== null);
  const severeUnderRows = rows.filter((r) => r.actualBudget > 0);
  const n = rows.length;
  return {
    n,
    estMdApe: estApes.length ? quantile(estApes, 0.5) : null,
    recMdApe: recApes.length ? quantile(recApes, 0.5) : null,
    p75: estApes.length ? quantile(estApes, 0.75) : null,
    p90: estApes.length ? quantile(estApes, 0.9) : null,
    p95: estApes.length ? quantile(estApes, 0.95) : null,
    p99: estApes.length ? quantile(estApes, 0.99) : null,
    under30: estApes.length ? estApes.filter((a) => a <= 0.3).length / estApes.length : null,
    under50: estApes.length ? estApes.filter((a) => a <= 0.5).length / estApes.length : null,
    over100: estApes.length ? estApes.filter((a) => a > 1.0).length / estApes.length : null,
    medianSigned: signed.length ? quantile(signed, 0.5) : null,
    overRate: signed.length ? signed.filter((s) => s > 0).length / signed.length : null,
    underRate: signed.length ? signed.filter((s) => s < 0).length / signed.length : null,
    severeUnderRecommendationRate: severeUnderRows.length
      ? severeUnderRows.filter((r) => r.finalRecommended < r.actualBudget * 0.7).length / severeUnderRows.length
      : null,
  };
}

function printSummary(label: string, s: Summary) {
  console.log(
    `  ${label.padEnd(28)} n=${String(s.n).padEnd(5)} EstMdAPE=${pct(s.estMdApe).padStart(8)} RecMdAPE=${pct(s.recMdApe).padStart(8)} P75=${pct(s.p75).padStart(8)} P90=${pct(s.p90).padStart(8)} P95=${pct(s.p95).padStart(8)} P99=${pct(s.p99).padStart(8)} | <=30%=${pct(s.under30).padStart(7)} <=50%=${pct(s.under50).padStart(7)} >100%=${pct(s.over100).padStart(7)} | medSigned=${pct(s.medianSigned).padStart(8)} over%=${pct(s.overRate).padStart(7)} under%=${pct(s.underRate).padStart(7)} severeUnderRec(<0.7x)=${pct(s.severeUnderRecommendationRate).padStart(7)}`
  );
}

function buildQueryFromRecord(r: { region: import("../lib/domain/enums").Region | null; district: string | null; typeTokens: Set<import("../lib/domain/enums").FestivalType>; venueType: import("../lib/domain/enums").VenueType | null; durationDays: number | null }): MultiYearQuery {
  return { region: r.region!, district: r.district, typeTokens: r.typeTokens, venueType: r.venueType, durationDays: r.durationDays };
}

async function runBenchmark(
  allMultiYearRecords: MultiYearRecordWithQuality[],
  publicationStatusByYear: Map<number, import("../lib/multiyear/publication-status").MultiYearPublicationStatusEntry["status"]>,
  allSeriesRecords: SeriesRecordWithQuality[],
  componentsById: Map<number, SeriesRecordBudgetComponents>
): Promise<Row[]> {
  const rows: Row[] = [];

  for (const targetYear of FOLD_YEARS) {
    const { trainingPool } = buildSeriesTrainingPool(allSeriesRecords, targetYear);
    const evalTargets = buildSeriesEvalTargets(allSeriesRecords, targetYear);
    const model = buildFrozenSeriesModel(trainingPool);
    const thresholdResult = computeLeakageSafeVolatilityThreshold(allSeriesRecords, targetYear);
    const auditGroups = auditSeriesDataQuality(model, allSeriesRecords, componentsById);
    const auditByGroupId = new Map(auditGroups.map((g) => [g.groupId, g]));

    for (const target of evalTargets) {
      if (target.region === null) continue;
      const query = buildQueryFromRecord(target);

      // Peer(production estimateForPlanning 그대로) - route.ts와 동일한 함수 호출.
      const peerResult = estimateForPlanning(query, targetYear, ReferenceDataPolicy.HISTORICAL_ONLY, allMultiYearRecords, publicationStatusByYear);

      const signal = computeSeriesSignal(target.festivalName, target.region, target.district, target.typeTokens, targetYear, model);
      const applied = applySeriesPlanningSemantics(
        { estimatedBudgetKrw: peerResult.estimatedBudgetKrw, recommendedBudgetKrw: peerResult.recommendedBudgetKrw, p60Krw: peerResult.p60Krw },
        signal
      );
      const reliability = computePlanningReliability(
        signal,
        target.festivalName,
        target.region,
        target.district,
        target.typeTokens,
        targetYear,
        model,
        thresholdResult.threshold
      );

      const seriesEligible = signal.status === "MATCHED" && signal.seriesEstimatedBudgetKrw !== undefined;

      let volatility: number | null = null;
      let auditPointSeverities: string[] = [];
      if (seriesEligible) {
        const syntheticTarget = buildSyntheticTargetRecord({
          festivalName: target.festivalName,
          region: target.region,
          district: target.district,
          typeTokens: target.typeTokens,
          planningYear: targetYear,
        });
        const lookup = lookupTarget(syntheticTarget, model);
        if (lookup.matchedGroupId !== null) {
          const historical = model.groupsById.get(lookup.matchedGroupId)!.members.filter((m) => m.datasetYear < targetYear);
          volatility = computeCpiAdjustedVolatility(historical, targetYear);
          const auditGroup = auditByGroupId.get(lookup.matchedGroupId);
          if (auditGroup && signal.estimateSource !== undefined && signal.latestHistoricalYear !== undefined) {
            const records =
              signal.estimateSource === "MEDIAN"
                ? auditGroup.records
                : auditGroup.records.filter((r) => r.datasetYear === signal.latestHistoricalYear).sort((a, b) => a.recordId - b.recordId).slice(0, 1);
            auditPointSeverities = records.map((r) => r.severity);
          }
        }
      }

      rows.push({
        targetYear,
        canonicalName: signal.canonicalName ?? target.festivalName,
        actualBudget: target.budgetKrw,
        peerEstimated: peerResult.estimatedBudgetKrw,
        finalEstimated: applied.estimatedBudgetKrw,
        finalRecommended: applied.recommendedBudgetKrw,
        estimateBasis: applied.estimateBasis,
        seriesEligible,
        reliabilityTier: reliability.tier,
        reasonKey: reliability.reasonKey,
        historyCount: seriesEligible ? signal.historyCount! : null,
        estimateSource: seriesEligible ? signal.estimateSource! : null,
        latestHistoricalGap: seriesEligible ? signal.latestHistoricalGap! : null,
        volatility,
        auditPointSeverities,
      });
    }
  }
  return rows;
}

function stableHash(rows: Row[]): string {
  // deterministic ordering(정렬 후 hash) - Map 순회 순서 등에 의존하지 않도록.
  const sorted = [...rows].sort((a, b) =>
    a.targetYear !== b.targetYear ? a.targetYear - b.targetYear : a.canonicalName.localeCompare(b.canonicalName)
  );
  const summary = sorted.map((r) => [r.targetYear, r.canonicalName, r.actualBudget, r.finalEstimated, r.finalRecommended, r.reliabilityTier, r.estimateSource].join("|"));
  return createHash("sha256").update(summary.join("\n")).digest("hex");
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });
  const allMultiYearRecords = await loadAllMultiYearRecords(prisma);
  const publicationStatusByYear = await loadPublicationStatusByYear(prisma);
  const allSeriesRecords = await loadAllSeriesRecords(prisma);
  const componentsById = await loadSeriesRecordBudgetComponents(prisma);

  console.log("=".repeat(100));
  console.log("9. REPRODUCIBILITY - 동일 스크립트를 두 번 실행(fresh model)");
  console.log("=".repeat(100));
  const rows1 = await runBenchmark(allMultiYearRecords, publicationStatusByYear, allSeriesRecords, componentsById);
  const rows2 = await runBenchmark(allMultiYearRecords, publicationStatusByYear, allSeriesRecords, componentsById);
  const hash1 = stableHash(rows1);
  const hash2 = stableHash(rows2);
  console.log(`pass1 n=${rows1.length} hash=${hash1}`);
  console.log(`pass2 n=${rows2.length} hash=${hash2}`);
  console.log(`deterministic: ${hash1 === hash2 ? "YES" : "NO - MISMATCH"}`);
  console.log("");

  const rows = rows1;

  console.log("=".repeat(100));
  console.log("1/3. OVERALL / SERIES / PEER");
  console.log("=".repeat(100));
  const series = rows.filter((r) => r.seriesEligible);
  const peer = rows.filter((r) => !r.seriesEligible);
  printSummary("OVERALL", summarize(rows));
  printSummary("SERIES", summarize(series));
  printSummary("PEER", summarize(peer));
  console.log("");

  console.log("=".repeat(100));
  console.log("4. 2024/2025/2026 fold");
  console.log("=".repeat(100));
  for (const y of FOLD_YEARS) {
    printSummary(`OVERALL [${y}]`, summarize(rows.filter((r) => r.targetYear === y)));
    printSummary(`SERIES [${y}]`, summarize(series.filter((r) => r.targetYear === y)));
    printSummary(`PEER [${y}]`, summarize(peer.filter((r) => r.targetYear === y)));
  }
  console.log("");

  console.log("=".repeat(100));
  console.log("5. Estimate Basis 분포 + LATEST/MEDIAN");
  console.log("=".repeat(100));
  console.log(`SERIES_HISTORY_MEDIAN: ${series.length} (${((series.length / rows.length) * 100).toFixed(1)}%)`);
  console.log(`PEER_SIMILARITY: ${peer.length} (${((peer.length / rows.length) * 100).toFixed(1)}%)`);
  const latestN = series.filter((r) => r.estimateSource === "LATEST").length;
  const medianN = series.filter((r) => r.estimateSource === "MEDIAN").length;
  console.log(`Series 내부 - LATEST: ${latestN} (${((latestN / series.length) * 100).toFixed(1)}%)  MEDIAN: ${medianN} (${((medianN / series.length) * 100).toFixed(1)}%)`);
  console.log("");

  console.log("=".repeat(100));
  console.log("6. latestHistoricalGap 분포 + gap<=2->LATEST / gap>=3->MEDIAN mismatch 확인");
  console.log("=".repeat(100));
  let mismatch = 0;
  const gapCounts: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4+": 0 };
  for (const r of series) {
    const g = r.latestHistoricalGap!;
    const bucket = g === 1 ? "1" : g === 2 ? "2" : g === 3 ? "3" : "4+";
    gapCounts[bucket]++;
    const expectedSource: SeriesEstimateSource = g <= 2 ? "LATEST" : "MEDIAN";
    if (r.estimateSource !== expectedSource) mismatch++;
  }
  for (const [k, v] of Object.entries(gapCounts)) {
    console.log(`gap=${k}: ${v} (${((v / series.length) * 100).toFixed(1)}%)`);
  }
  console.log(`gap<=2->LATEST / gap>=3->MEDIAN mismatch: ${mismatch}건 (0이어야 정상)`);
  console.log("");

  console.log("=".repeat(100));
  console.log("7. Reliability tier별 최종 benchmark (HIGH/MEDIUM=Series, LOW=Peer)");
  console.log("=".repeat(100));
  for (const tier of ["HIGH", "MEDIUM", "LOW"] as const) {
    printSummary(tier, summarize(rows.filter((r) => r.reliabilityTier === tier)));
  }
  console.log("");

  console.log("=".repeat(100));
  console.log("8. HIGH_SINGLE_HISTORY 진단(연구용 cohort - tier 변경 없음)");
  console.log("=".repeat(100));
  const high = rows.filter((r) => r.reliabilityTier === "HIGH");
  const highSingle = high.filter((r) => r.reasonKey === "SERIES_STABLE_SINGLE_HISTORY");
  const highMulti = high.filter((r) => r.reasonKey === "SERIES_STABLE");
  printSummary("HIGH_SINGLE_HISTORY", summarize(highSingle));
  printSummary("HIGH (SERIES_STABLE, multi)", summarize(highMulti));
  console.log("");

  console.log("=".repeat(100));
  console.log("9. Data Quality Audit 교차(reliability tier별)");
  console.log("=".repeat(100));
  for (const tier of ["HIGH", "MEDIUM"] as const) {
    const tRows = series.filter((r) => r.reliabilityTier === tier);
    const anySignal = tRows.filter((r) => r.auditPointSeverities.some((s) => s !== "NONE"));
    const anyHigh = tRows.filter((r) => r.auditPointSeverities.includes("HIGH"));
    console.log(`${tier}: n=${tRows.length}  audit signal 존재: ${anySignal.length}(${((anySignal.length / tRows.length) * 100).toFixed(2)}%)  audit HIGH: ${anyHigh.length}(${((anyHigh.length / tRows.length) * 100).toFixed(2)}%)`);
  }

  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
