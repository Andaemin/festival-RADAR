/**
 * PHASE 9C-A.1 — cache 적용 전(매번 buildSeriesTrainingPool+buildFrozenSeriesModel을 새로 계산)과
 * 적용 후(runtime-cache.ts 경유)의 seriesSignal이 완전히 동일한지 실제 DB로 직접 대조한다.
 * DB에 아무것도 쓰지 않는다.
 *
 * 실행: npx tsx scripts/verify-multiyear-series-cache-equivalence.ts
 */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";
import { getMultiYearDataRevision } from "../lib/multiyear-series/data-revision";
import { buildSeriesTrainingPool } from "../lib/multiyear-series/fold";
import { loadAllSeriesRecords } from "../lib/multiyear-series/record-loader";
import { getCachedFrozenSeriesModel, getCachedSeriesRecords, __resetRuntimeCacheForTests } from "../lib/multiyear-series/runtime-cache";
import { buildFrozenSeriesModel } from "../lib/multiyear-series/series-linker";
import { computeSeriesSignal, SeriesSignalResponse } from "../lib/multiyear-series/series-signal";

const planningYear = 2026;
const CASES = [
  { label: "EXACT", festivalName: "한강페스티벌", regionCode: "SEOUL", district: "-", festivalTypes: ["CULTURE_ART"] },
  { label: "NORMALIZED_EXACT", festivalName: "2026 서울무형문화축제", regionCode: "SEOUL", district: "-", festivalTypes: ["CULTURE_ART"] },
  { label: "FUZZY", festivalName: "노원수제맥주축제", regionCode: "SEOUL", district: "노원구", festivalTypes: ["COMMUNITY"] },
  { label: "AMBIGUOUS", festivalName: "제21회 인천 펜타포트 음악축제", regionCode: "INCHEON", district: "-", festivalTypes: ["CULTURE_ART"] },
  { label: "UNMATCHED", festivalName: "2026 한강 서래섬 피크닉 콘서트(봄)", regionCode: "SEOUL", district: "-", festivalTypes: ["CULTURE_ART"] },
  // 포화 구간(보유 데이터 최댓값 이후) planningYear도 같은 케이스로 한 번 더 - cutoff 공유 로직까지 검증.
] as const;

function eq(a: SeriesSignalResponse, b: SeriesSignalResponse): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });
  const allSeriesRecords = await loadAllSeriesRecords(prisma);
  const revision = await getMultiYearDataRevision(prisma);

  let allOk = true;

  for (const py of [planningYear, 2030]) {
    for (const c of CASES) {
      const region = c.regionCode as import("../lib/domain/enums").Region;
      const typeTokens = new Set((c.festivalTypes as readonly string[]) as import("../lib/domain/enums").FestivalType[]);
      const district = c.district;

      // (a) 캐시 없이 - 매번 직접 계산(기존 Phase 9C-A 원안과 동일한 경로)
      const { trainingPool } = buildSeriesTrainingPool(allSeriesRecords, py);
      const uncachedModel = buildFrozenSeriesModel(trainingPool);
      const uncached = computeSeriesSignal(c.festivalName, region, district, typeTokens, py, uncachedModel);

      // (b) 캐시 경유 - route.ts가 실제로 쓰는 경로
      __resetRuntimeCacheForTests(); // 이번 케이스만 놓고 보면 cold/warm 둘 다 아래에서 한 번 더 검증
      const cachedRecords = await getCachedSeriesRecords(prisma, revision);
      const cachedModel = await getCachedFrozenSeriesModel(cachedRecords, revision, py);
      const cached = computeSeriesSignal(c.festivalName, region, district, typeTokens, py, cachedModel);

      const ok = eq(uncached, cached);
      allOk &&= ok;
      console.log(`${ok ? "✅" : "❌"} planningYear=${py} [${c.label}] uncached=${JSON.stringify(uncached)}`);
      if (!ok) {
        console.log(`   cached=${JSON.stringify(cached)}`);
      }
    }
  }

  await prisma.$disconnect();
  console.log(allOk ? "\n모든 케이스 cache 적용 전/후 seriesSignal 동일" : "\n불일치 발견");
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
