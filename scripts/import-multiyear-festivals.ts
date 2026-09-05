/**
 * 2017~2026 canonical CSV(festival_2017_2026.csv) → MultiYearFestivalRecord
 *
 * 실행:
 *   npm run import:multiyear -- --dry-run                검증만 하고 DB는 건드리지 않는다
 *   npm run import:multiyear -- --reset                  기존 MultiYear 데이터를 비우고 재적재
 *   npm run import:multiyear -- --file <csv-path> [...]  파일 생략 시 DEFAULT_CSV_PATH 사용
 *
 * 이 스크립트는 기존 prisma/seed.ts(2026 production)와 완전히 분리되어 있고,
 * MultiYear* 모델에만 쓴다. FestivalRecord/DatasetImportBatch는 절대 건드리지 않는다.
 */
import "dotenv/config";
import * as path from "path";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";
import { runAcceptanceChecks, printAcceptanceChecks } from "./multiyear-import/acceptance";
import { canonicalizeRow, CanonicalRecord, RowIssue } from "./multiyear-import/canonicalize";
import { DEFAULT_CSV_PATH, IMPORTER_VERSION } from "./multiyear-import/constants";
import { loadCanonicalCsv } from "./multiyear-import/csv-loader";
import { persistMultiYearRecords } from "./multiyear-import/persist";
import { buildDryRunReport, printDryRunReport } from "./multiyear-import/stats";

function parseArgs(argv: string[]): { file: string; dryRun: boolean; reset: boolean } {
  let file = DEFAULT_CSV_PATH;
  let dryRun = false;
  let reset = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--reset") reset = true;
    else if (arg === "--file") {
      file = argv[i + 1];
      i++;
    } else if (arg.startsWith("--file=")) {
      file = arg.slice("--file=".length);
    }
  }
  return { file: path.resolve(file), dryRun, reset };
}

async function main() {
  const { file, dryRun, reset } = parseArgs(process.argv.slice(2));
  console.log(`CSV 경로: ${file}`);
  console.log(
    `모드: ${dryRun ? "DRY-RUN (DB 미변경)" : reset ? "실제 적재 (--reset: 기존 MultiYear 데이터 삭제 후)" : "실제 적재"}`
  );
  console.log("");

  const { rows, fileSha256 } = loadCanonicalCsv(file);
  console.log(`CSV row 수: ${rows.length}, SHA256: ${fileSha256}`);

  const records: CanonicalRecord[] = [];
  const allIssues: RowIssue[] = [];
  let fatalRowsSkipped = 0;
  const rawRegionValues = new Set<string>();
  const rawVenueValues = new Set<string>();

  for (const row of rows) {
    const regionVal = row["region"];
    if (regionVal !== null && regionVal !== undefined) rawRegionValues.add(String(regionVal));
    const venueVal = row["venue_type"];
    if (venueVal !== null && venueVal !== undefined) rawVenueValues.add(String(venueVal));

    const { record, issues } = canonicalizeRow(row);
    allIssues.push(...issues);
    if (record) records.push(record);
    else fatalRowsSkipped++;
  }

  const report = buildDryRunReport({
    canonicalCsvSha256: fileSha256,
    importerVersion: IMPORTER_VERSION,
    records,
    issues: allIssues,
    fatalRowsSkipped,
    rawRegionValues,
    rawVenueValues,
  });
  printDryRunReport(report);

  const checks = runAcceptanceChecks(report);
  const allPass = printAcceptanceChecks(checks);

  if (dryRun) {
    console.log("");
    console.log("DRY-RUN 종료. DB는 변경되지 않았습니다.");
    process.exit(allPass ? 0 : 1);
  }

  if (!allPass) {
    console.error("");
    console.error("Acceptance 기준 실패 — 실제 DB insert를 진행하지 않습니다.");
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });
  try {
    // persist는 원본 파일이 바뀌면(canonicalDatasetSha256가 달라지면) 기존 행을 지우지 않고
    // 새 batch로 **덧쌓는다**. 원본 CSV를 교체할 때 이 단계를 건너뛰면 같은 축제가 두 벌로 남고,
    // record-source.ts가 batch 구분 없이 전부 읽으므로 통계가 오류 없이 조용히 2배가 된다.
    // MultiYearFestivalRecordType은 onDelete: Cascade라 record 삭제로 함께 지워진다.
    // production FestivalRecord는 여기서도 건드리지 않는다.
    if (reset) {
      const deletedRecords = await prisma.multiYearFestivalRecord.deleteMany({});
      const deletedBatches = await prisma.multiYearImportBatch.deleteMany({});
      console.log(`--reset: 기존 record ${deletedRecords.count}건, batch ${deletedBatches.count}건을 삭제했습니다.`);
      console.log("");
    }

    const results = await persistMultiYearRecords({
      prisma,
      records,
      canonicalDatasetSha256: fileSha256,
      importerVersion: IMPORTER_VERSION,
      sourceFileName: path.basename(file),
    });

    console.log("");
    console.log("── 적재 결과 ──────────────────────────────────");
    for (const r of results) {
      console.log(`${r.datasetYear}: ${r.status} (batchId=${r.batchId}, insertedRows=${r.insertedRows})`);
    }

    const totalCount = await prisma.multiYearFestivalRecord.count();
    const typeCount = await prisma.multiYearFestivalRecordType.count();
    const productionCount = await prisma.festivalRecord.count();
    console.log("");
    console.log(`MultiYearFestivalRecord 총 건수     : ${totalCount} (기대 10198)`);
    console.log(`MultiYearFestivalRecordType 총 건수 : ${typeCount}`);
    console.log(`기존 production FestivalRecord 건수 : ${productionCount} (변경 없어야 함)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("import 실패:", e);
  process.exit(1);
});
