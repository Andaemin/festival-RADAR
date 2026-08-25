/**
 * PHASE 9C-A.1 pre-commit hardening 3절 — records snapshot / FrozenSeriesModel 각각의
 * "retained memory"만 대략적으로 측정한다(정밀 profiler 아님, 최적화도 하지 않는다). 이전
 * 측정(+293MB whole-process delta, 20회 요청 + GC 미실행 섞임)은 판단 근거로 쓰지 않는다.
 *
 * --expose-gc가 필요하다(global.gc()를 명시적으로 호출해 각 단계 사이 GC를 강제한다).
 * 실행: NODE_OPTIONS=--expose-gc npx tsx scripts/measure-multiyear-series-cache-memory.ts
 */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";
import { getMultiYearDataRevision } from "../lib/multiyear-series/data-revision";
import { __resetRuntimeCacheForTests, getCachedFrozenSeriesModel, getCachedSeriesRecords } from "../lib/multiyear-series/runtime-cache";

function fmtMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

async function gcAndMeasure(label: string, prev: NodeJS.MemoryUsage | null) {
  if (typeof global.gc !== "function") {
    throw new Error("--expose-gc 없이 실행됨. NODE_OPTIONS=--expose-gc npx tsx ... 로 실행하세요.");
  }
  global.gc();
  global.gc(); // 한 번으로는 안 돌 수도 있어서 두 번(major GC 유도 목적, 과학적 정밀도 주장 안 함)
  const mem = process.memoryUsage();
  const deltaHeap = prev ? mem.heapUsed - prev.heapUsed : 0;
  const deltaRss = prev ? mem.rss - prev.rss : 0;
  console.log(
    `[${label}] heapUsed=${fmtMb(mem.heapUsed)}${prev ? ` (Δ${deltaHeap >= 0 ? "+" : ""}${fmtMb(deltaHeap)})` : ""}  rss=${fmtMb(mem.rss)}${prev ? ` (Δ${deltaRss >= 0 ? "+" : ""}${fmtMb(deltaRss)})` : ""}`
  );
  return mem;
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });
  const revision = await getMultiYearDataRevision(prisma);

  __resetRuntimeCacheForTests();
  let mem = await gcAndMeasure("0) baseline (GC 직후, DB/캐시 아직 안 씀)", null);

  const allSeriesRecords = await getCachedSeriesRecords(prisma, revision);
  console.log(`   records snapshot: ${allSeriesRecords.length}건`);
  mem = await gcAndMeasure("1) records snapshot 캐시 후", mem);

  const model = await getCachedFrozenSeriesModel(allSeriesRecords, revision, 2027); // 포화 cutoff = 데이터 전체
  console.log(`   FrozenSeriesModel: groupsById=${model.groupsById.size}개, groupIdByRecordId=${model.groupIdByRecordId.size}건`);
  mem = await gcAndMeasure("2) FrozenSeriesModel 1개 캐시 후", mem);

  __resetRuntimeCacheForTests();
  await gcAndMeasure("3) cache reset 후(참조 해제, GC로 회수됐는지)", mem);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
