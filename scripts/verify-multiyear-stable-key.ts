/**
 * PHASE 29 — `stableCandidateOrderKey`(lib/multiyear/baseline-estimator.ts)의 무결성을
 * canonical 전체 dataset에서 확인하는 regression 스크립트. runtime production 경로에서는
 * 매 요청마다 이 검사를 하지 않는다(요청마다 전체 dataset을 스캔하는 비용을 피하기 위함) - 이
 * 스크립트를 정기적으로/배포 전에 실행해서 확인한다. DB에 아무것도 쓰지 않는다(읽기 전용).
 *
 * 실행: npx tsx scripts/verify-multiyear-stable-key.ts
 */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";
import { loadAllMultiYearRecords } from "../lib/multiyear/record-loader";
import { stableCandidateOrderKey } from "../lib/multiyear/baseline-estimator";

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });
  const records = await loadAllMultiYearRecords(prisma);
  await prisma.$disconnect();

  console.log(`전체 레코드 수: ${records.length}`);

  let missing = 0;
  const keyCounts = new Map<string, number>();
  for (const r of records) {
    if (!r.sourceSha256 || !r.sourceSheet || r.sourceRow === null || r.sourceRow === undefined) {
      missing++;
      continue;
    }
    const key = stableCandidateOrderKey(r);
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  const duplicates = [...keyCounts.entries()].filter(([, c]) => c > 1);

  console.log(`missing key(sourceSha256/sourceSheet/sourceRow 중 하나라도 없음): ${missing}`);
  console.log(`duplicate key: ${duplicates.length}`);
  if (duplicates.length > 0) {
    console.log("중복 상세(최대 20건):");
    for (const [key, count] of duplicates.slice(0, 20)) console.log(`  ${key}: ${count}건`);
  }

  const ok = missing === 0 && duplicates.length === 0;
  console.log(ok ? "✅ stable key 무결성 확인됨(missing=0, duplicate=0)." : "🛑 stable key 무결성 위반 - production tie-break가 완전히 결정적이지 않을 수 있다.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
