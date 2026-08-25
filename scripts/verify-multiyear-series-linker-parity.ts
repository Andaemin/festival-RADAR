/**
 * PHASE 9B-1 — Spring reference(`공모전 예산 알고리즘/backend`)가 실제 로컬 MySQL로 생성한
 * multiyear-series-ownhistory-fixture.csv(fold-local series linker golden fixture, 2024/2025/
 * 2026 fold x training pool 전체, 21,399행)를 ground-truth로 삼아 Express series linker
 * (lib/multiyear-series/*)가 동일한 결과를 내는지 검증한다. DB에 아무것도 쓰지 않는다
 * (읽기 전용).
 *
 * DB-generated ID는 비교 기준으로 쓰지 않는다 - fixture 행과 DB record는
 * (targetYear, sourceSha256, sourceSheet, sourceRow) natural key로 조인한다.
 * seriesGroupStableKey는 Spring과 동일한 알고리즘(그룹 구성원의 natural key를 정렬해 이어붙인
 * 문자열의 SHA-256 앞 8바이트 hex)으로 Express 쪽에서도 다시 계산해서 비교한다.
 *
 * 실행: npx tsx scripts/verify-multiyear-series-linker-parity.ts [--file <csv-path>]
 */
import "dotenv/config";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";
import { buildSeriesTrainingPool } from "../lib/multiyear-series/fold";
import { loadAllSeriesRecords, SeriesRecordWithQuality } from "../lib/multiyear-series/record-loader";
import { buildFrozenSeriesModel } from "../lib/multiyear-series/series-linker";
import { MatchMethod, SeriesRecordLite } from "../lib/multiyear-series/types";

const DEFAULT_FIXTURE_PATH = "fixtures/multiyear/series-linker-parity-reference.csv";
const FOLD_TARGET_YEARS = [2024, 2025, 2026];

function parseArgs(argv: string[]): { file: string } {
  let file = DEFAULT_FIXTURE_PATH;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") file = argv[++i];
    else if (argv[i].startsWith("--file=")) file = argv[i].slice("--file=".length);
  }
  return { file: path.resolve(file) };
}

interface FixtureRow {
  targetYear: number;
  datasetYear: number;
  sourceSheet: string;
  sourceRow: number;
  sourceSha256: string;
  seriesGroupStableKey: string;
  canonicalName: string;
  matchMethod: MatchMethod;
  seriesRecordCount: number;
}

function loadFixture(filePath: string): FixtureRow[] {
  if (!fs.existsSync(filePath)) throw new Error(`fixture CSV를 찾을 수 없습니다: ${filePath}`);
  let content = fs.readFileSync(filePath, "utf-8");
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const wb = XLSX.read(content, { type: "string" });
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number | null>>(wb.Sheets[wb.SheetNames[0]], { defval: null });

  return rows.map((r) => ({
    targetYear: Number(r["targetYear"]),
    datasetYear: Number(r["datasetYear"]),
    sourceSheet: String(r["sourceSheet"]),
    sourceRow: Number(r["sourceRow"]),
    sourceSha256: String(r["sourceSha256"]),
    // seriesGroupStableKey는 16자리 hex 문자열이다 - 우연히 전부 0-9 숫자로만 이뤄진 값(a-f
    // 없음)이면 xlsx 파서가 이걸 자동으로 숫자로 인식해 leading zero를 지워버린다(예:
    // "0431271023164572" -> 431271023164572). 알고리즘 결과가 아니라 CSV 파싱 단계의 문제이므로
    // 16자리로 다시 zero-pad해서 복구한다.
    seriesGroupStableKey: String(r["seriesGroupStableKey"]).padStart(16, "0"),
    canonicalName: String(r["canonicalName"]),
    matchMethod: String(r["matchMethod"]) as MatchMethod,
    seriesRecordCount: Number(r["seriesRecordCount"]),
  }));
}

function naturalKey(r: { sourceSha256: string; sourceSheet: string; sourceRow: number }): string {
  return `${r.sourceSha256}|${r.sourceSheet}|${r.sourceRow}`;
}

/** Spring MultiYearOwnHistoryFixtureWriter.seriesGroupStableKey와 동일한 알고리즘. */
function seriesGroupStableKey(members: SeriesRecordLite[]): string {
  const naturalKeys = members.map((r) => naturalKey(r)).sort();
  const joined = naturalKeys.join(";");
  const hash = crypto.createHash("sha256").update(joined, "utf-8").digest();
  return hash.subarray(0, 8).toString("hex");
}

interface Mismatch {
  targetYear: number;
  naturalKey: string;
  field: string;
  expected: string;
  actual: string;
}

async function main() {
  const { file } = parseArgs(process.argv.slice(2));
  console.log(`fixture: ${file}`);
  const fixtureRows = loadFixture(file);
  console.log(`fixture rows: ${fixtureRows.length}`);

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });
  let allRecords: SeriesRecordWithQuality[];
  try {
    allRecords = await loadAllSeriesRecords(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log(`DB records: ${allRecords.length}`);

  const fieldCounts: Record<string, { pass: number; fail: number }> = {};
  const mismatches: Mismatch[] = [];
  const bump = (field: string, pass: boolean) => {
    fieldCounts[field] ??= { pass: 0, fail: 0 };
    fieldCounts[field][pass ? "pass" : "fail"]++;
  };

  let rowsMatched = 0;
  let rowsMissingInExpress = 0;

  for (const targetYear of FOLD_TARGET_YEARS) {
    const { trainingPool } = buildSeriesTrainingPool(allRecords, targetYear);
    const model = buildFrozenSeriesModel(trainingPool);

    const byNaturalKey = new Map<string, SeriesRecordLite>();
    for (const r of trainingPool) byNaturalKey.set(naturalKey(r), r);

    // ── row별 비교 ──
    const fixtureRowsForFold = fixtureRows.filter((r) => r.targetYear === targetYear);
    for (const row of fixtureRowsForFold) {
      const record = byNaturalKey.get(naturalKey(row));
      if (!record) {
        rowsMissingInExpress++;
        mismatches.push({ targetYear, naturalKey: naturalKey(row), field: "record_presence", expected: "present", actual: "missing" });
        bump("record_presence", false);
        continue;
      }
      bump("record_presence", true);

      const groupId = model.groupIdByRecordId.get(record.id);
      const group = groupId !== undefined ? model.groupsById.get(groupId) : undefined;
      const matchMethod = model.matchMethodByRecordId.get(record.id);
      const stableKey = group ? seriesGroupStableKey(group.members) : "";

      let rowOk = true;
      const checkExact = (field: string, expected: unknown, actual: unknown) => {
        const ok = String(expected) === String(actual);
        bump(field, ok);
        if (!ok) {
          rowOk = false;
          mismatches.push({ targetYear, naturalKey: naturalKey(row), field, expected: String(expected), actual: String(actual) });
        }
      };

      checkExact("seriesGroupStableKey", row.seriesGroupStableKey, stableKey);
      checkExact("canonicalName", row.canonicalName, group?.canonicalName ?? "");
      checkExact("matchMethod", row.matchMethod, matchMethod ?? "");
      checkExact("seriesRecordCount", row.seriesRecordCount, group?.members.length ?? 0);

      if (rowOk) rowsMatched++;
    }

    // ── fold summary 비교 ──
    const total = trainingPool.length;
    const distinctSeries = model.groupsById.size;
    let singleton = 0;
    let twoPlus = 0;
    const methodCounts: Record<MatchMethod, number> = { EXACT: 0, NORMALIZED_EXACT: 0, FUZZY: 0, CHAIN_HIGH_CONFIDENCE: 0, MANUAL: 0, UNMATCHED: 0 };
    for (const g of model.groupsById.values()) {
      if (g.members.length === 1) singleton++;
      else twoPlus++;
    }
    for (const m of model.matchMethodByRecordId.values()) methodCounts[m]++;

    const summaryFixtureLine = fixtureRowsForFold.length; // 비교 참고용(요약 카운트는 리포트에서 별도 텍스트로 사람이 대조)
    console.log(
      `[targetYear=${targetYear}] total=${total} distinctSeries=${distinctSeries} singleton=${singleton} 2+=${twoPlus} ` +
        `EXACT=${methodCounts.EXACT} NORMALIZED_EXACT=${methodCounts.NORMALIZED_EXACT} FUZZY=${methodCounts.FUZZY} ` +
        `CHAIN_HIGH_CONFIDENCE=${methodCounts.CHAIN_HIGH_CONFIDENCE} UNMATCHED=${methodCounts.UNMATCHED} ` +
        `ambiguous=${model.ambiguousTrainingRecordCount} (fixture rows for this fold: ${summaryFixtureLine})`
    );
  }

  console.log("");
  console.log("── 필드별 결과 ──────────────────────────────");
  for (const [field, c] of Object.entries(fieldCounts)) {
    console.log(`${c.fail === 0 ? "✅" : "❌"} ${field.padEnd(28)} pass=${c.pass} fail=${c.fail}`);
  }
  console.log("");
  console.log(`row 전체 일치: ${rowsMatched} / ${fixtureRows.length} (DB에서 못 찾은 행: ${rowsMissingInExpress})`);

  if (mismatches.length > 0) {
    console.log("");
    console.log(`불일치 샘플 (최대 30건 / 전체 ${mismatches.length}건):`);
    for (const m of mismatches.slice(0, 30)) {
      console.log(`  [targetYear=${m.targetYear} key=${m.naturalKey}] ${m.field}: expected=${m.expected} actual=${m.actual}`);
    }
  }

  const anyFail = Object.values(fieldCounts).some((c) => c.fail > 0);
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error("검증 실패:", e);
  process.exit(1);
});
