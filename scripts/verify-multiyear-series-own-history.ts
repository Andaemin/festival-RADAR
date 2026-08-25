/**
 * PHASE 9B-2 — own-history signal primitives 결과 리포트. linker parity가 확인된 뒤,
 * eval target(각 fold의 datasetYear===targetYear)에 대해 computeOwnHistorySignal을 돌려
 * coverage/matchMethod 분포/seriesEstimatedBudget(=median) 계산이 Spring Phase 9A 리포트
 * (own-history usable coverage 65.3%, match method EXACT=646/NORMALIZED_EXACT=1348/
 * FUZZY=248/AMBIGUOUS=29/UNMATCHED=1161)와 같은 수준인지 sanity-check한다. DB에 아무것도
 * 쓰지 않는다(읽기 전용) - Planning API에는 연결하지 않는다.
 *
 * 실행: npx tsx scripts/verify-multiyear-series-own-history.ts
 */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";
import { buildSeriesEvalTargets, buildSeriesTrainingPool } from "../lib/multiyear-series/fold";
import { loadAllSeriesRecords, SeriesRecordWithQuality } from "../lib/multiyear-series/record-loader";
import { computeOwnHistorySignal } from "../lib/multiyear-series/own-history";
import { buildFrozenSeriesModel } from "../lib/multiyear-series/series-linker";
import { MatchMethod } from "../lib/multiyear-series/types";

const FOLD_TARGET_YEARS = [2024, 2025, 2026];

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });
  let allRecords: SeriesRecordWithQuality[];
  try {
    allRecords = await loadAllSeriesRecords(prisma);
  } finally {
    await prisma.$disconnect();
  }

  const methodCounts: Record<string, number> = { EXACT: 0, NORMALIZED_EXACT: 0, FUZZY: 0, AMBIGUOUS: 0, UNMATCHED: 0 };
  let totalTargets = 0;
  let usable = 0; // seriesEstimatedBudget !== null
  let over1bTotal = 0;
  let over1bUsable = 0;
  let leakageViolations = 0;

  for (const targetYear of FOLD_TARGET_YEARS) {
    const { trainingPool } = buildSeriesTrainingPool(allRecords, targetYear);
    const evalTargets = buildSeriesEvalTargets(allRecords, targetYear);
    const model = buildFrozenSeriesModel(trainingPool);

    let foldUsable = 0;
    for (const target of evalTargets) {
      totalTargets++;
      const signal = computeOwnHistorySignal(target, targetYear, model);

      const label = signal.ambiguous ? "AMBIGUOUS" : (signal.targetMatchMethod as MatchMethod);
      if (label in methodCounts) methodCounts[label]++;

      const isOver1b = target.budgetKrw > 1_000_000_000;
      if (isOver1b) over1bTotal++;

      if (signal.seriesEstimatedBudget !== null) {
        usable++;
        foldUsable++;
        if (isOver1b) over1bUsable++;
        // leakage 재확인: historicalYears가 전부 targetYear보다 과거인지
        if (signal.historicalYears.some((y) => y >= targetYear)) leakageViolations++;
      }
    }
    console.log(`[targetYear=${targetYear}] evalTargets=${evalTargets.length} usable(seriesEstimatedBudget!=null)=${foldUsable}`);
  }

  console.log("");
  console.log("── Phase 9B-2 own-history 요약 ──────────────────────────────");
  console.log(`전체 target: ${totalTargets}건`);
  console.log(`seriesEstimatedBudget usable: ${usable}건 (${((100 * usable) / totalTargets).toFixed(1)}%)`);
  console.log(`  (참고 Spring Phase 9A: own-history usable coverage 2242/3432 = 65.3%)`);
  console.log(`1B 이상 target 중 usable: ${over1bUsable}/${over1bTotal}`);
  console.log("matchMethod 분포:", methodCounts);
  console.log(`  (참고 Spring Phase 9A: EXACT=646 NORMALIZED_EXACT=1348 FUZZY=248 AMBIGUOUS=29 UNMATCHED=1161)`);
  console.log(`leakage 위반(historicalYears >= targetYear): ${leakageViolations}건 (0이어야 정상)`);

  process.exit(leakageViolations > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
