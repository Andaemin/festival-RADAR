/**
 * MultiYearDatasetPublicationStatus 초기값을 채우는 별도의 명시적 스크립트.
 *
 * 이 상태는 "그 해 축제가 모두 개최·집행 완료됐다"는 뜻이 아니라 "해당 연도의 지역축제
 * 개최계획(예산 포함) 데이터셋 원본이 공개 기준으로 완성되어, 아직 그 해 축제가 실제로 열리기
 * 전이라도 계획예산 참고자료로 안전하게 쓸 수 있다"는 운영자 판단이다. MultiYear import 성공이나
 * 앱 기동을 이유로 자동으로 PUBLISHED_PLAN_COMPLETE 처리하는 로직은 어디에도 없고, 이 스크립트를
 * 명시적으로 실행해야만 값이 채워진다.
 *
 * 값은 Spring reference(festival_budget.multi_year_dataset_publication_status)의 실제 운영
 * 상태를 그대로 이관한 것이다(2026-08-08 Spring 운영자가 표시) - 2017~2024는 아직 PARTIAL이라
 * row를 만들지 않는다(row가 없으면 애플리케이션 로직이 PARTIAL로 취급하므로 굳이 8개를 미리
 * 넣지 않아도 동작은 동일하다). 2025/2026만 PUBLISHED_PLAN_COMPLETE로 upsert한다.
 *
 * 실행: npx tsx scripts/seed-multiyear-publication-status.ts
 */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";

/** Spring festival_budget.multi_year_dataset_publication_status에서 그대로 이관한 값
 *  (2026-08-08 Spring 운영자가 PUBLISHED_PLAN_COMPLETE로 표시한 시각). */
const SPRING_REFERENCE_PUBLICATION_STATE: { datasetYear: number; publishedAt: string }[] = [
  { datasetYear: 2025, publishedAt: "2026-08-08T06:47:06.522Z" },
  { datasetYear: 2026, publishedAt: "2026-08-08T06:47:05.512Z" },
];

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });
  try {
    for (const entry of SPRING_REFERENCE_PUBLICATION_STATE) {
      const saved = await prisma.multiYearDatasetPublicationStatus.upsert({
        where: { datasetYear: entry.datasetYear },
        update: { status: "PUBLISHED_PLAN_COMPLETE", publishedAt: new Date(entry.publishedAt) },
        create: { datasetYear: entry.datasetYear, status: "PUBLISHED_PLAN_COMPLETE", publishedAt: new Date(entry.publishedAt) },
      });
      console.log(`${saved.datasetYear}: ${saved.status} (publishedAt=${saved.publishedAt?.toISOString()})`);
    }
    const all = await prisma.multiYearDatasetPublicationStatus.findMany({ orderBy: { datasetYear: "asc" } });
    console.log("");
    console.log(`총 ${all.length}건 (2017~2024는 row 없음 = PARTIAL 취급, 정상)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("seed 실패:", e);
  process.exit(1);
});
