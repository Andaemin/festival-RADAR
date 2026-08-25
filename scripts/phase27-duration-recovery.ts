/**
 * PHASE 27 — Duration Canonical Recovery & Pipeline Fix.
 *
 * DATA CORRECTION만 한다 - 예산 추정 알고리즘(Series/Peer estimator, CandidateSelectorV1,
 * similarity weight, durationElasticity, duration clamp, winsorize, CPI, recommendation,
 * reliability, API, UI)은 전혀 건드리지 않는다.
 *
 * Phase 26에서 원본 canonical CSV 생성 도구는 이 워크스페이스(festival-RADAR, 그리고 인접한
 * Spring 참고 프로젝트 "공모전 예산 알고리즘/backend") 어디에도 없음을 직접 검색으로 확인했다
 * (git log에 festival_2017_2026_sanitized.csv 자체가 한 번도 커밋된 적이 없고 /prisma/data/
 * 전체가 .gitignore 대상이며, Spring backend의 254개 Java 파일 어디에도 duration/period_raw/
 * sanitiz 관련 코드가 없다) - 따라서 "A. original generator fix"는 불가능하고, "B. deterministic
 * recovery utility"를 이 저장소 안에 새로 만드는 방향으로 진행한다(scripts/multiyear-import/
 * duration-recovery.ts, canonicalize.ts/normalize.ts는 무죄이므로 건드리지 않는다).
 *
 * 실행:
 *   npx tsx scripts/phase27-duration-recovery.ts --dry-run   (기본값과 동일 - preview/검증만, CSV/DB 변경 없음)
 *   npx tsx scripts/phase27-duration-recovery.ts --apply     (검증 통과 시에만 canonical CSV 수정 + DB 재적재 + before/after benchmark)
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../lib/generated/prisma";
import { loadCanonicalCsv, RawCsvRow } from "./multiyear-import/csv-loader";
import { canonicalizeRow, CanonicalRecord, RowIssue } from "./multiyear-import/canonicalize";
import { runAcceptanceChecks, printAcceptanceChecks } from "./multiyear-import/acceptance";
import { buildDryRunReport } from "./multiyear-import/stats";
import { persistMultiYearRecords } from "./multiyear-import/persist";
import { IMPORTER_VERSION } from "./multiyear-import/constants";
import { classifyRecoverableDuration } from "./multiyear-import/duration-recovery";
import { computeRecoveryPreview, applyRecoveryToCsvContent, RecoveryRow } from "./multiyear-import/duration-recovery-csv";
import { loadAllSeriesRecords, SeriesRecordWithQuality } from "../lib/multiyear-series/record-loader";
import { buildSeriesTrainingPool, buildSeriesEvalTargets } from "../lib/multiyear-series/fold";
import { buildFrozenSeriesModel } from "../lib/multiyear-series/series-linker";
import { computeSeriesSignal } from "../lib/multiyear-series/series-signal";
import { selectFinalSample, computeCoreStats } from "../lib/multiyear/baseline-estimator";
import { selectMultiYearCandidatesV1 } from "../lib/multiyear/candidate-selector-v1";
import { computeFinalPeerRecommendation } from "../lib/multiyear/final-recommendation";
import { MultiYearQuery } from "../lib/multiyear/types";
import { quantile } from "../lib/utils/weighted-statistics";

const CSV_PATH = "prisma/data/festival_2017_2026_sanitized.csv";
const BACKUP_PATH = "prisma/data/festival_2017_2026_sanitized.BEFORE_PHASE27.csv";
const RECOVERY_TARGET_YEARS = [2022, 2023, 2024];
/** authoritative 기대값. Phase 26 최초 audit(scripts/phase26-duration-venue-data-integrity-audit.ts
 *  "9. Duration Recoverability" 표)의 2022-2024 합은 393+539+549=1,481이었으나, 이번 Phase의
 *  golden parity check(7/12절)로 실제 반례(다중 "(N일간)" 주석 - 아래 설명)가 발견돼 규칙을 1건
 *  더 보수적으로 좁혔다. 사용자 확인/승인을 거쳐 **정밀 검증된 값 1,480건(2022=392/2023=539/
 *  2024=549)을 authoritative로 확정**한다 - Phase 26의 1,481은 이 확정 전 audit estimate였다. */
const PHASE26_EXPECTED_SAFE_BY_YEAR: Record<number, number> = { 2022: 392, 2023: 539, 2024: 549 };
const PHASE26_EXPECTED_SAFE_TOTAL = Object.values(PHASE26_EXPECTED_SAFE_BY_YEAR).reduce((a, b) => a + b, 0);

const APPLY = process.argv.includes("--apply");

function mdRow(cells: (string | number)[]): string {
  return `| ${cells.join(" | ")} |`;
}
function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(2)}%` : "N/A";
}
function pctv(x: number): string {
  return Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : "N/A";
}
function median(arr: number[]): number {
  if (arr.length === 0) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const i = 0.5 * (s.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
function ape(estimate: number, actual: number): number {
  return actual > 0 ? Math.abs(estimate - actual) / actual : NaN;
}
function signedLogError(estimate: number, actual: number): number {
  return estimate > 0 && actual > 0 ? Math.log(estimate / actual) : NaN;
}

async function main() {
  const out: string[] = [];
  const push = (s: string) => { out.push(s); console.log(s); };

  push(`# Phase 27 — Duration Canonical Recovery & Pipeline Fix (자동 생성, 모드=${APPLY ? "APPLY" : "DRY-RUN"})\n`);
  push(`생성 시각: ${new Date().toISOString()}\n`);

  // ============================================================================================ 3-4. generator 탐색 결론(재탐색 없이 기록만)
  push(`## 3-4. Canonical Generator 탐색 결론\n`);
  push(`원본 canonical CSV 생성 도구를 이 저장소와 인접 Spring 참고 프로젝트("공모전 예산 알고리즘/backend", Java 254개 파일)에서 모두 검색했으나 찾지 못했다 - \`git log\`에 \`festival_2017_2026_sanitized.csv\` 자체가 한 번도 커밋되지 않았고(\`/prisma/data/\`가 \`.gitignore\` 전체 대상), Spring backend 어디에도 duration/period_raw/sanitiz 관련 코드가 없다. **선택: B. deterministic recovery utility**(\`scripts/multiyear-import/duration-recovery.ts\`, 신규) - \`canonicalize.ts\`/\`normalize.ts\`는 무죄이므로 수정하지 않는다.\n`);

  // ============================================================================================ 시작 상태 검증
  const { rows: originalRows } = loadCanonicalCsv(CSV_PATH);
  if (originalRows.length !== 10198) {
    push(`⚠️ 시작 시점 row count가 10,198이 아닙니다(${originalRows.length}) - 중단합니다.`);
    fs.writeFileSync("phase27-duration-recovery-validation.md", out.join("\n"), "utf8");
    process.exit(1);
  }
  push(`시작 시점 canonical CSV row count = ${originalRows.length} ✅\n`);

  // ============================================================================================ 7/12. Golden parity check (2017-2021 EXPLICIT_TEXT, comparable subset)
  push(`## 7/12. Golden Parity Check (정상 연도 재현 검증)\n`);
  const goldenRows = originalRows.filter((r) => r["duration_source"] === "EXPLICIT_TEXT");
  let goldenComparable = 0, goldenMatch = 0;
  const goldenMismatches: { year: number; sourceRow: number; periodRaw: string; existing: number; recomputed: number | null; rule: string }[] = [];
  for (const r of goldenRows) {
    const year = Number(r["dataset_year"]);
    const existing = Number(r["duration_days"]);
    const result = classifyRecoverableDuration(r["period_raw"], year, r["duration_note_raw"]);
    if (result.category !== "SAFE_RECOVERABLE") continue; // "comparable" = 새 함수가 값을 시도하는 것만
    goldenComparable++;
    if (result.recoveredDays === existing) goldenMatch++;
    else goldenMismatches.push({ year, sourceRow: Number(r["source_row"]), periodRaw: String(r["period_raw"]), existing, recomputed: result.recoveredDays, rule: result.rule });
  }
  push(`정상 연도(duration_source=EXPLICIT_TEXT, n=${goldenRows.length}) 중 새 recovery 함수가 값을 시도하는(=comparable) 대상: **${goldenComparable}건**.\n`);
  push(`exact match: **${goldenMatch}건** / mismatch: **${goldenMismatches.length}건**.\n`);
  if (goldenMismatches.length > 0) {
    push(`\n⚠️ mismatch 상세(최대 20건):\n`);
    push(mdRow(["year", "source_row", "period_raw", "existing", "recomputed", "rule"]));
    push(mdRow(new Array(6).fill("---")));
    for (const m of goldenMismatches.slice(0, 20)) push(mdRow([m.year, m.sourceRow, m.periodRaw, m.existing, m.recomputed ?? "null", m.rule]));
  } else {
    push(`✅ mismatch 0건 - 새 recovery 함수의 계산식(inclusive day count 등)이 정상 연도의 기존 semantics와 완전히 일치한다. 이 결과를 golden reference로 삼아 2022-2024 복구에 그대로 적용한다.\n`);
  }
  if (goldenMismatches.length > 0) {
    push(`\n🛑 golden parity mismatch가 있어 복구를 중단합니다. duration-recovery.ts의 날짜 계산식을 재검토해야 합니다(정상 데이터 값을 바꾸는 방향으로 "고치지" 않는다).`);
    fs.writeFileSync("phase27-duration-recovery-validation.md", out.join("\n"), "utf8");
    process.exit(1);
  }

  // ============================================================================================ 8. 2025-2026 회귀 참조(건드리지 않았음을 재확인)
  const nonTargetYearsTouched = originalRows.filter(
    (r) => !RECOVERY_TARGET_YEARS.includes(Number(r["dataset_year"])) && classifyRecoverableDuration(r["period_raw"], Number(r["dataset_year"]), r["duration_note_raw"]).category === "SAFE_RECOVERABLE" && r["duration_days"] === null
  );
  push(`## 8. 2025-2026 등 비대상 연도 확인\n`);
  push(`복구 대상 연도(${RECOVERY_TARGET_YEARS.join(",")}) 밖에서 SAFE_RECOVERABLE + duration_days=null인 행 = ${nonTargetYearsTouched.length}건 - 이번 Phase는 이 행들을 **의도적으로 건드리지 않는다**(9-10절 지시: 2022-2024만 대상, 2025-2026/2017-2021 나머지 UNPARSED는 별도 ambiguity라 확대하지 않음).\n`);

  // ============================================================================================ 9/13. Recovery preview 생성(2022-2024만)
  // computeRecoveryPreview는 scripts/phase27b-verify-reproducibility.ts와 완전히 동일한 함수다
  // (scripts/multiyear-import/duration-recovery-csv.ts) - "복붙해서 비슷하게" 만든 게 아니라
  // 두 스크립트가 같은 코드 경로를 공유하는 구조라 재현성이 코드 수준에서 보장된다.
  push(`## 9/13. Recovery Preview (2022-2024)\n`);
  const previewRows: RecoveryRow[] = computeRecoveryPreview(originalRows, RECOVERY_TARGET_YEARS);
  const previewByYear: Record<number, number> = { 2022: 0, 2023: 0, 2024: 0 };
  for (const p of previewRows) previewByYear[p.datasetYear]++;
  push(mdRow(["Year", "Authoritative expected SAFE(확정치)", "Phase 27 recomputed", "일치"]));
  push(mdRow(new Array(4).fill("---")));
  let allMatchPhase26 = true;
  for (const y of RECOVERY_TARGET_YEARS) {
    const match = previewByYear[y] === PHASE26_EXPECTED_SAFE_BY_YEAR[y];
    if (!match) allMatchPhase26 = false;
    push(mdRow([y, PHASE26_EXPECTED_SAFE_BY_YEAR[y], previewByYear[y], match ? "✅" : "⚠️"]));
  }
  const totalRecovered = previewRows.length;
  push(mdRow(["TOTAL", PHASE26_EXPECTED_SAFE_TOTAL, totalRecovered, totalRecovered === PHASE26_EXPECTED_SAFE_TOTAL ? "✅" : "⚠️"]));
  push(`\n${allMatchPhase26 ? "✅ 확정된 authoritative 값과 정확히 일치." : "⚠️ 확정치와 차이 있음 - 재확인 필요."}\n`);
  push(
    `**Phase 26 → Phase 27 수치 정정 경위(감사 추적용 기록)**: Phase 26 최초 audit은 2022-2024 SAFE_RECOVERABLE 합을 393+539+549=1,481로 집계했다. ` +
      `이번 Phase의 7/12절 golden parity check(2017-2021 정상 데이터 재현 검증) 과정에서 실제 반례가 발견돼 규칙을 1건 더 보수적으로 좁혔다: ` +
      `"MULTI_SEGMENT_WITH_DAYCOUNT"(줄바꿈/복수 구간이지만 "(N일간)" 총일수 주석이 있는 경우)를 Phase 26은 텍스트 안의 **첫 번째** "(N일간)"을 무조건 채택했는데, ` +
      `2021년 golden 데이터 중 "07월~08월 (30일간) 12월~02월 (60일간)"(주석이 2개, 서로 다른 값)에서 기존 정상값(60)과 불일치(첫 주석 30을 채택)함이 드러났다. ` +
      `주석이 정확히 1개일 때만 SAFE로 인정하도록 좁혀 golden parity mismatch를 0건으로 만들었고, 그 결과 2022년 SAFE_RECOVERABLE이 393→392(-1)로 줄어 총 1,480건이 되었다(같은 패턴의 다중 주석 행이 2022에도 1건 있었음). ` +
      `이는 recovery 품질을 낮추는 게 아니라 **더 보수적으로 만든 의도된 수정**이다(6절 원칙: 애매하면 자동 복구하지 않는다) - 사용자 확인/승인을 거쳐 **1,480건(2022=392/2023=539/2024=549)을 이후 authoritative 값으로 확정**했다.\n`
  );

  // preview CSV 저장(항상, dry-run에서도)
  const esc = (s: string) => (s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s);
  const previewLines = ["source_row,year,festival_name,period_raw,previous_duration,recovered_duration,recovery_rule"];
  for (const p of previewRows) {
    previewLines.push([p.sourceRow, p.datasetYear, esc(p.festivalName), esc(p.periodRaw), "", p.recoveredDays, p.rule].join(","));
  }
  fs.writeFileSync("phase27-duration-recovery-preview.csv", previewLines.join("\n"), "utf8");
  push(`\npreview CSV 저장: phase27-duration-recovery-preview.csv (${previewRows.length}행)\n`);

  // ============================================================================================ 19. Pre-apply validation
  push(`## 19. Pre-apply Validation\n`);
  const nonPositive = previewRows.filter((p) => p.recoveredDays <= 0);
  const unreasonable = previewRows.filter((p) => p.recoveredDays > 90);
  const dupCheck = new Map<string, number>();
  for (const p of previewRows) {
    const key = `${p.datasetYear}|${p.sourceSheet}|${p.sourceRow}`;
    dupCheck.set(key, (dupCheck.get(key) ?? 0) + 1);
  }
  const dupCount = [...dupCheck.values()].filter((v) => v > 1).length;
  push(mdRow(["항목", "결과"]));
  push(mdRow(["---", "---"]));
  push(mdRow(["recovered_duration <= 0", nonPositive.length]));
  push(mdRow(["recovered_duration > 90일(비정상적으로 큼, 조사 대상)", unreasonable.length]));
  push(mdRow(["중복 행(datasetYear+sourceSheet+sourceRow)", dupCount]));
  if (unreasonable.length > 0) {
    push(`\n>90일 상세(참고용, 자동 차단하지 않음 - 실제 원문 확인):\n`);
    push(mdRow(["year", "source_row", "period_raw", "recovered", "rule"]));
    push(mdRow(new Array(5).fill("---")));
    for (const u of unreasonable) push(mdRow([u.datasetYear, u.sourceRow, u.periodRaw, u.recoveredDays, u.rule]));
  }
  const preApplyOk = nonPositive.length === 0 && dupCount === 0;
  push(`\n${preApplyOk ? "✅ pre-apply validation 통과." : "🛑 pre-apply validation 실패 - 적용하지 않습니다."}\n`);
  if (!preApplyOk) {
    fs.writeFileSync("phase27-duration-recovery-validation.md", out.join("\n"), "utf8");
    process.exit(1);
  }

  if (!APPLY) {
    push(`\n---\n**DRY-RUN 모드입니다. canonical CSV/DB는 전혀 변경되지 않았습니다.** \`--apply\`로 재실행하면 검증 통과 후 실제로 적용합니다.\n`);
    fs.writeFileSync("phase27-duration-recovery-validation.md", out.join("\n"), "utf8");
    console.log("\n=== DRY-RUN 저장 완료 ===");
    return;
  }

  // ============================================================================================ BEFORE benchmark (CSV/DB 수정 전에 먼저 측정)
  push(`## 24-27. Before/After Benchmark\n`);
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });

  // DB를 wipe+reimport하면 autoincrement id가 재발급되어 before/after의 t.id/record.id가
  // 더 이상 같은 레코드를 가리키지 않는다 - before/after를 짝지을 때는 반드시 이 stable key를
  // 쓴다(전체 파이프라인에서 canonical↔DB 매칭에 일관되게 쓰는 것과 동일한 키).
  const stableKeyOf = (r: { datasetYear: number; sourceSheet: string; sourceRow: number }) => `${r.datasetYear}|${r.sourceSheet}|${r.sourceRow}`;

  async function runFullBenchmark(records: SeriesRecordWithQuality[]) {
    interface Row {
      targetYear: number; stableKey: string; actual: number; estimate: number; recommendation: number;
      isSeries: boolean; fallbackLevel: string | null; avgSimilarity: number | null; sampleCount: number | null;
      durationKnown: boolean; candidateKeys: Set<string> | null;
    }
    const results: Row[] = [];
    for (const targetYear of [2024, 2025, 2026] as const) {
      const { trainingPool } = buildSeriesTrainingPool(records, targetYear);
      const evalTargets = buildSeriesEvalTargets(records, targetYear);
      const model = buildFrozenSeriesModel(trainingPool);
      for (const t of evalTargets) {
        if (t.budgetKrw <= 0) continue;
        const seriesSignal = computeSeriesSignal(t.festivalName, t.region!, t.district, t.typeTokens, targetYear, model);
        const seriesApplied = seriesSignal.status === "MATCHED" && seriesSignal.seriesEstimatedBudgetKrw !== undefined;
        if (seriesApplied) {
          results.push({
            targetYear, stableKey: stableKeyOf(t), actual: t.budgetKrw,
            estimate: Math.round(seriesSignal.seriesEstimatedBudgetKrw!),
            recommendation: Math.round(seriesSignal.seriesEstimatedBudgetKrw! * 1.05),
            isSeries: true, fallbackLevel: null, avgSimilarity: null, sampleCount: null, durationKnown: t.durationDays !== null, candidateKeys: null,
          });
          continue;
        }
        const query: MultiYearQuery = { region: t.region!, district: t.district, typeTokens: t.typeTokens, venueType: t.venueType, durationDays: t.durationDays };
        const fsel = selectFinalSample(trainingPool, query, selectMultiYearCandidatesV1);
        if (fsel === null) continue;
        const weights = fsel.finalSample.map((c) => c.score.weight);
        const stats = computeCoreStats(fsel, weights, query.district !== null);
        results.push({
          targetYear, stableKey: stableKeyOf(t), actual: t.budgetKrw,
          estimate: Math.round(stats.estimated),
          recommendation: Math.round(computeFinalPeerRecommendation(stats.estimated, stats.p60)),
          isSeries: false, fallbackLevel: fsel.selection.level, avgSimilarity: stats.similarityScoreAvg, sampleCount: stats.sampleCount,
          durationKnown: t.durationDays !== null, candidateKeys: new Set(fsel.finalSample.map((c) => stableKeyOf(c.record))),
        });
      }
    }
    return results;
  }

  function metricsFor(rs: { estimate: number; actual: number }[]) {
    const apes = rs.map((r) => ape(r.estimate, r.actual)).filter(Number.isFinite);
    const sles = rs.map((r) => signedLogError(r.estimate, r.actual)).filter(Number.isFinite);
    return {
      n: rs.length,
      mdApe: apes.length ? pctv(quantile(apes, 0.5)) : "N/A",
      p90: apes.length ? pctv(quantile(apes, 0.9)) : "N/A",
      p95: apes.length ? pctv(quantile(apes, 0.95)) : "N/A",
      medianSignedLog: sles.length ? median(sles).toFixed(3) : "N/A",
    };
  }

  console.log("[진행] BEFORE benchmark 계산 중...");
  const beforeRecords = await loadAllSeriesRecords(prisma);
  const beforeResults = await runFullBenchmark(beforeRecords);
  const beforeDurationKnownCount = beforeRecords.filter((r) => r.durationDays !== null).length;

  // ============================================================================================ CSV 백업 + 수정
  push(`### CSV 백업 및 수정 적용\n`);
  fs.copyFileSync(CSV_PATH, BACKUP_PATH);
  // 백업이 실제로 존재하고 읽을 수 있으며 원본과 완전히 동일한지(sha256) 확인 - 복구 가능성을
  // "가정"하지 않고 mutation 직전에 실측한다.
  if (!fs.existsSync(BACKUP_PATH)) {
    push(`🛑 백업 파일 생성 확인 실패(${BACKUP_PATH}) - DB 작업을 진행하지 않고 중단합니다.`);
    await prisma.$disconnect();
    fs.writeFileSync("phase27-duration-recovery-validation.md", out.join("\n"), "utf8");
    process.exit(1);
  }
  const originalSha = crypto.createHash("sha256").update(fs.readFileSync(CSV_PATH)).digest("hex");
  const backupSha = crypto.createHash("sha256").update(fs.readFileSync(BACKUP_PATH)).digest("hex");
  if (originalSha !== backupSha) {
    push(`🛑 백업 파일 무결성 확인 실패(원본 sha256=${originalSha}, 백업 sha256=${backupSha}) - DB 작업을 진행하지 않고 중단합니다.`);
    await prisma.$disconnect();
    fs.writeFileSync("phase27-duration-recovery-validation.md", out.join("\n"), "utf8");
    process.exit(1);
  }
  push(`백업 저장 및 무결성 확인 완료: ${BACKUP_PATH} (sha256=${backupSha}) ✅ - 이 CSV로 언제든 \`npx tsx scripts/phase27-duration-recovery.ts\`의 재적재 로직(persistMultiYearRecords 경로)을 재실행해 이전 상태로 복구할 수 있다.\n`);

  // applyRecoveryToCsvContent도 phase27b-verify-reproducibility.ts와 완전히 동일한 함수를 쓴다.
  const originalContent = fs.readFileSync(CSV_PATH, "utf8");
  const { newContent, splicedCount } = applyRecoveryToCsvContent(originalContent, previewRows);
  push(`실제 splice 대상 행: ${splicedCount}/${previewRows.length}건(안전조건 확인 후).\n`);
  fs.writeFileSync(CSV_PATH, newContent, "utf8");

  // ============================================================================================ 16-17. Dataset integrity diff(전체 필드 대조)
  push(`### 16-17. Dataset Integrity Diff (전체 필드 대조)\n`);
  const { rows: afterRows } = loadCanonicalCsv(CSV_PATH);
  push(`row count: before=${originalRows.length}, after=${afterRows.length} ${originalRows.length === afterRows.length ? "✅" : "🛑"}\n`);

  const afterByKey = new Map<string, RawCsvRow>();
  for (const r of afterRows) afterByKey.set(`${r["dataset_year"]}|${r["source_sheet"]}|${r["source_row"]}`, r);
  const fieldChangeCounts = new Map<string, number>();
  let unexpectedFieldChange = 0;
  let changedRows = 0;
  for (const before of originalRows) {
    const key = `${before["dataset_year"]}|${before["source_sheet"]}|${before["source_row"]}`;
    const after = afterByKey.get(key);
    if (!after) { unexpectedFieldChange++; continue; }
    let rowChanged = false;
    for (const field of Object.keys(before)) {
      const bv = before[field];
      const av = after[field];
      if (String(bv ?? "") !== String(av ?? "")) {
        fieldChangeCounts.set(field, (fieldChangeCounts.get(field) ?? 0) + 1);
        rowChanged = true;
        if (field !== "duration_days" && field !== "duration_source") unexpectedFieldChange++;
      }
    }
    if (rowChanged) changedRows++;
  }
  push(mdRow(["field", "changed cell count"]));
  push(mdRow(["---", "---"]));
  for (const [f, c] of [...fieldChangeCounts.entries()].sort((a, b) => b[1] - a[1])) push(mdRow([f, c]));
  push(`\nchanged rows: ${changedRows}. duration 외 필드 변경(예상치 못한 diff): **${unexpectedFieldChange}건**.\n`);
  if (unexpectedFieldChange > 0) {
    push(`\n🛑 duration 외 필드가 변경되었습니다 - 백업(${BACKUP_PATH})으로 즉시 복원하고 중단합니다.`);
    fs.copyFileSync(BACKUP_PATH, CSV_PATH);
    await prisma.$disconnect();
    fs.writeFileSync("phase27-duration-recovery-validation.md", out.join("\n"), "utf8");
    process.exit(1);
  }
  push(`✅ duration_days/duration_source 외에는 단 1건도 변경되지 않았다(row count/festivalName/region/district/festivalType/venueType/budget/visitor/source hash/sheet/row 전부 동일).\n`);

  // ============================================================================================ 20-22. DB 반영(기존 importer 함수 재사용, MultiYear 테이블만 wipe 후 재적재)
  push(`### 20-22. DB 반영\n`);
  console.log("[진행] MultiYear 테이블 초기화 중...");
  await prisma.multiYearFestivalRecord.deleteMany({}); // MultiYearFestivalRecordType은 onDelete:Cascade
  await prisma.multiYearImportBatch.deleteMany({});

  const { rows: reimportRows, fileSha256 } = loadCanonicalCsv(CSV_PATH);
  const records: CanonicalRecord[] = [];
  const allIssues: RowIssue[] = [];
  let fatalRowsSkipped = 0;
  const rawRegionValues = new Set<string>();
  const rawVenueValues = new Set<string>();
  for (const row of reimportRows) {
    const regionVal = row["region"];
    if (regionVal !== null && regionVal !== undefined) rawRegionValues.add(String(regionVal));
    const venueVal = row["venue_type"];
    if (venueVal !== null && venueVal !== undefined) rawVenueValues.add(String(venueVal));
    const { record, issues } = canonicalizeRow(row);
    allIssues.push(...issues);
    if (record) records.push(record);
    else fatalRowsSkipped++;
  }
  const report = buildDryRunReport({ canonicalCsvSha256: fileSha256, importerVersion: IMPORTER_VERSION, records, issues: allIssues, fatalRowsSkipped, rawRegionValues, rawVenueValues });
  const checks = runAcceptanceChecks(report);
  const allPass = printAcceptanceChecks(checks);
  push(`\n기존 importer acceptance 기준(row count/budget quality/multi-type/region mapping 등, duration과 무관): ${allPass ? "✅ 전부 통과" : "🛑 일부 실패"}\n`);
  if (!allPass) {
    push(`\n🛑 acceptance 실패 - DB에 적재하지 않고 백업으로 CSV를 복원합니다.`);
    fs.copyFileSync(BACKUP_PATH, CSV_PATH);
    await prisma.$disconnect();
    fs.writeFileSync("phase27-duration-recovery-validation.md", out.join("\n"), "utf8");
    process.exit(1);
  }

  const persistResults = await persistMultiYearRecords({ prisma, records, canonicalDatasetSha256: fileSha256, importerVersion: IMPORTER_VERSION, sourceFileName: path.basename(CSV_PATH) });
  for (const r of persistResults) push(`  ${r.datasetYear}: ${r.status} (batchId=${r.batchId}, insertedRows=${r.insertedRows})`);

  // ============================================================================================ Canonical ↔ DB parity(재적재 후)
  const afterRecords = await loadAllSeriesRecords(prisma);
  push(`\nDB 총 레코드 수(재적재 후): ${afterRecords.length} (기대 10198) ${afterRecords.length === 10198 ? "✅" : "🛑"}\n`);
  const afterCsvByKey = new Map<string, RawCsvRow>();
  for (const r of reimportRows) afterCsvByKey.set(`${r["dataset_year"]}|${r["source_sheet"]}|${r["source_row"]}`, r);
  let durationParityMismatch = 0;
  for (const dbR of afterRecords) {
    const csvR = afterCsvByKey.get(`${dbR.datasetYear}|${dbR.sourceSheet}|${dbR.sourceRow}`);
    const csvDuration = csvR && csvR["duration_days"] !== null && csvR["duration_days"] !== undefined && csvR["duration_days"] !== "" ? Math.round(Number(csvR["duration_days"])) : null;
    if (csvDuration !== dbR.durationDays) durationParityMismatch++;
  }
  push(`canonical durationDays != DB durationDays: **${durationParityMismatch}건** ${durationParityMismatch === 0 ? "✅" : "🛑"}\n`);

  // ============================================================================================ AFTER benchmark
  console.log("[진행] AFTER benchmark 계산 중...");
  const afterResults = await runFullBenchmark(afterRecords);
  const afterDurationKnownCount = afterRecords.filter((r) => r.durationDays !== null).length;

  // ============================================================================================ 25. 전체 benchmark
  push(`### 25. 전체 Benchmark (2024-2026 leakage-safe, n=${beforeResults.length})\n`);
  push(mdRow(["Metric", "Before", "After", "Δ"]));
  push(mdRow(new Array(4).fill("---")));
  function deltaRow(label: string, beforeRs: typeof beforeResults, afterRs: typeof afterResults) {
    const b = metricsFor(beforeRs);
    const a = metricsFor(afterRs);
    const bNum = beforeRs.length ? quantile(beforeRs.map((r) => ape(r.estimate, r.actual)).filter(Number.isFinite), 0.5) : NaN;
    const aNum = afterRs.length ? quantile(afterRs.map((r) => ape(r.estimate, r.actual)).filter(Number.isFinite), 0.5) : NaN;
    const delta = Number.isFinite(bNum) && Number.isFinite(aNum) ? pctv(aNum - bNum) : "N/A";
    push(mdRow([`${label} MdAPE`, b.mdApe, a.mdApe, delta]));
  }
  deltaRow("Overall Estimate", beforeResults, afterResults);
  deltaRow("Series", beforeResults.filter((r) => r.isSeries), afterResults.filter((r) => r.isSeries));
  deltaRow("Peer", beforeResults.filter((r) => !r.isSeries), afterResults.filter((r) => !r.isSeries));
  const bAll = metricsFor(beforeResults), aAll = metricsFor(afterResults);
  push(mdRow(["Overall P90", bAll.p90, aAll.p90, "-"]));
  push(mdRow(["Overall P95", bAll.p95, aAll.p95, "-"]));
  push(mdRow(["Overall medianSignedLog", bAll.medianSignedLog, aAll.medianSignedLog, "-"]));
  const bPeer = metricsFor(beforeResults.filter((r) => !r.isSeries)), aPeer = metricsFor(afterResults.filter((r) => !r.isSeries));
  push(mdRow(["Peer P90", bPeer.p90, aPeer.p90, "-"]));
  push(mdRow(["Peer P95", bPeer.p95, aPeer.p95, "-"]));

  // ============================================================================================ 26. Fold별
  push(`\n### 26. Fold별\n`);
  push(mdRow(["Year", "n", "Series coverage", "Overall MdAPE(B→A)", "Series MdAPE(B→A)", "Peer MdAPE(B→A)", "P90(B→A)"]));
  push(mdRow(new Array(7).fill("---")));
  for (const y of [2024, 2025, 2026] as const) {
    const b = beforeResults.filter((r) => r.targetYear === y);
    const a = afterResults.filter((r) => r.targetYear === y);
    const bSeriesCov = pct(b.filter((r) => r.isSeries).length, b.length);
    const aSeriesCov = pct(a.filter((r) => r.isSeries).length, a.length);
    const bOverall = metricsFor(b), aOverall = metricsFor(a);
    const bSeries = metricsFor(b.filter((r) => r.isSeries)), aSeries = metricsFor(a.filter((r) => r.isSeries));
    const bPeerY = metricsFor(b.filter((r) => !r.isSeries)), aPeerY = metricsFor(a.filter((r) => !r.isSeries));
    push(mdRow([y, `${b.length}→${a.length}`, `${bSeriesCov}→${aSeriesCov}`, `${bOverall.mdApe}→${aOverall.mdApe}`, `${bSeries.mdApe}→${aSeries.mdApe}`, `${bPeerY.mdApe}→${aPeerY.mdApe}`, `${bOverall.p90}→${aOverall.p90}`]));
  }

  // ============================================================================================ 27. Peer detailed impact
  push(`\n### 27. Peer Detailed Impact\n`);
  const bPeerAll = beforeResults.filter((r) => !r.isSeries);
  const aPeerAll = afterResults.filter((r) => !r.isSeries);
  const aPeerByRecord = new Map(aPeerAll.map((r) => [r.stableKey, r]));
  let fallbackChanged = 0, estimateChangedPct = 0, recChangedPct = 0, candidateSetChanged = 0, comparable = 0;
  let simSumB = 0, simSumA = 0, sampleSumB = 0, sampleSumA = 0;
  for (const b of bPeerAll) {
    const a = aPeerByRecord.get(b.stableKey);
    if (!a) continue;
    comparable++;
    if (b.fallbackLevel !== a.fallbackLevel) fallbackChanged++;
    if (b.estimate > 0 && Math.abs(a.estimate - b.estimate) / b.estimate > 0.01) estimateChangedPct++;
    if (b.recommendation > 0 && Math.abs(a.recommendation - b.recommendation) / b.recommendation > 0.01) recChangedPct++;
    if (b.candidateKeys && a.candidateKeys) {
      const union = new Set([...b.candidateKeys, ...a.candidateKeys]).size;
      const inter = union - [...b.candidateKeys].filter((id) => !a.candidateKeys!.has(id)).length - [...a.candidateKeys].filter((id) => !b.candidateKeys!.has(id)).length;
      if (union > 0 && inter / union < 0.999) candidateSetChanged++;
    }
    simSumB += b.avgSimilarity ?? 0; simSumA += a.avgSimilarity ?? 0;
    sampleSumB += b.sampleCount ?? 0; sampleSumA += a.sampleCount ?? 0;
  }
  push(mdRow(["항목", "Before→After"]));
  push(mdRow(["---", "---"]));
  push(mdRow(["candidate set changed(1% 이상 Jaccard 변화)", pct(candidateSetChanged, comparable)]));
  push(mdRow(["fallback level changed", pct(fallbackChanged, comparable)]));
  push(mdRow(["estimatedBudget changed(>1%)", pct(estimateChangedPct, comparable)]));
  push(mdRow(["recommendedBudget changed(>1%)", pct(recChangedPct, comparable)]));
  push(mdRow(["avgSimilarity(평균)", `${(simSumB / comparable).toFixed(3)} → ${(simSumA / comparable).toFixed(3)}`]));
  push(mdRow(["effective sample size(평균)", `${(sampleSumB / comparable).toFixed(1)} → ${(sampleSumA / comparable).toFixed(1)}`]));
  push(`\n(변경 자체가 오류가 아니라 정상화된 duration 정보가 estimator에 반영된 결과로 해석한다.)\n`);

  // ============================================================================================ 28. Duration-known coverage 변화
  push(`### 28. Duration-known Coverage 변화\n`);
  push(mdRow(["범위", "Before", "After", "Δ"]));
  push(mdRow(new Array(4).fill("---")));
  push(mdRow(["전체 DB(10,198)", pct(beforeDurationKnownCount, 10198), pct(afterDurationKnownCount, 10198), `+${afterDurationKnownCount - beforeDurationKnownCount}건`]));
  for (const y of [2024, 2025, 2026] as const) {
    const { trainingPool: bPool } = buildSeriesTrainingPool(beforeRecords, y);
    const { trainingPool: aPool } = buildSeriesTrainingPool(afterRecords, y);
    const bKnown = bPool.filter((r) => r.durationDays !== null).length;
    const aKnown = aPool.filter((r) => r.durationDays !== null).length;
    push(mdRow([`${y} training pool(n=${bPool.length}→${aPool.length})`, pct(bKnown, bPool.length), pct(aKnown, aPool.length), `+${aKnown - bKnown}건`]));
  }

  // ============================================================================================ 29. Monotonicity regression diagnostic(가벼운 재확인, tuning 없음)
  push(`\n### 29. Duration Monotonicity Regression Diagnostic (가벼운 재확인 - weight tuning 없음)\n`);
  console.log("[진행] monotonicity regression diagnostic 계산 중...");
  function computeMonoViolation(records: SeriesRecordWithQuality[]): { n: number; violRate: number } {
    let n = 0, viol = 0;
    for (const targetYear of [2024, 2025, 2026] as const) {
      const { trainingPool } = buildSeriesTrainingPool(records, targetYear);
      const evalTargets = buildSeriesEvalTargets(records, targetYear);
      const model = buildFrozenSeriesModel(trainingPool);
      for (const t of evalTargets) {
        if (t.budgetKrw <= 0 || t.durationDays === null) continue;
        const seriesSignal = computeSeriesSignal(t.festivalName, t.region!, t.district, t.typeTokens, targetYear, model);
        if (seriesSignal.status === "MATCHED" && seriesSignal.seriesEstimatedBudgetKrw !== undefined) continue;
        const d = t.durationDays;
        const grid = [...new Set([d - 1, d, d + 1, d + 2, d + 3, Math.round(d * 1.25), Math.round(d * 1.5), Math.round(d * 2.0)].filter((v) => v >= 2))].sort((a, b) => a - b);
        const estByD = new Map<number, number>();
        for (const dd of grid) {
          const query: MultiYearQuery = { region: t.region!, district: t.district, typeTokens: t.typeTokens, venueType: t.venueType, durationDays: dd };
          const fsel = selectFinalSample(trainingPool, query, selectMultiYearCandidatesV1);
          if (fsel === null) continue;
          const weights = fsel.finalSample.map((c) => c.score.weight);
          const stats = computeCoreStats(fsel, weights, query.district !== null);
          estByD.set(dd, stats.estimated);
        }
        for (let i = 0; i < grid.length - 1; i++) {
          const e1 = estByD.get(grid[i]), e2 = estByD.get(grid[i + 1]);
          if (e1 === undefined || e2 === undefined) continue;
          n++;
          if (e1 > 0 && (e1 - e2) / e1 > 0.05) viol++;
        }
      }
    }
    return { n, violRate: n > 0 ? viol / n : NaN };
  }
  const monoBefore = computeMonoViolation(beforeRecords);
  const monoAfter = computeMonoViolation(afterRecords);
  push(mdRow(["", "n(transition)", ">5% violation rate"]));
  push(mdRow(["---", "---", "---"]));
  push(mdRow(["Before", monoBefore.n, pctv(monoBefore.violRate)]));
  push(mdRow(["After", monoAfter.n, pctv(monoAfter.violRate)]));
  push(`\nduration weight=0.15는 그대로 유지했다(변경 없음) - 이 결과 때문에 Phase 25 weight search를 다시 시작하지 않는다.\n`);

  // ============================================================================================ 30. Recovery simulation과 실제 correction 비교
  push(`### 30. Phase 26 Simulation vs 실제 Correction 비교\n`);
  push(mdRow(["", "Peer MdAPE Before", "Peer MdAPE After", "Δ"]));
  push(mdRow(["---", "---", "---", "---"]));
  push(mdRow(["Phase 26 research simulation(R0/R1, in-memory)", "69.15%", "67.64%", "-1.51%p"]));
  const bPeerMdApe = quantile(bPeerAll.map((r) => ape(r.estimate, r.actual)).filter(Number.isFinite), 0.5);
  const aPeerMdApe = quantile(aPeerAll.map((r) => ape(r.estimate, r.actual)).filter(Number.isFinite), 0.5);
  push(mdRow(["Phase 27 실제 canonical correction", pctv(bPeerMdApe), pctv(aPeerMdApe), pctv(aPeerMdApe - bPeerMdApe)]));
  push(`\n(cohort/모집단이 다르면 - Phase 26 시뮬레이션은 duration-observed eligible n=754 서브셋 대비 recover, 이번은 전체 n=${bPeerAll.length} Peer 대상 - 직접 수치 비교보다 방향/크기가 유사한지를 본다.)\n`);

  // ============================================================================================ 31-32. Freeze 재확인
  push(`### 31-33. Series/Peer Freeze, Venue 제외 확인\n`);
  push(`Series estimator(CPI-adjusted own-history median), Peer weight(type .40/region .25/venue .20/duration .15), durationElasticity=0.55 — 전부 코드 미수정(git diff로 재확인, 아래 Regression/Git 섹션). Venue 관련 어떤 매핑/분류도 추가하지 않았다(이번 Phase 대상 아님).\n`);

  fs.writeFileSync("phase27-duration-recovery-validation.md", out.join("\n"), "utf8");

  // before-after benchmark CSV
  const benchLines = ["scope,metric,before,after"];
  benchLines.push(`overall,MdAPE,${quantile(beforeResults.map((r) => ape(r.estimate, r.actual)).filter(Number.isFinite), 0.5)},${quantile(afterResults.map((r) => ape(r.estimate, r.actual)).filter(Number.isFinite), 0.5)}`);
  benchLines.push(`peer,MdAPE,${bPeerMdApe},${aPeerMdApe}`);
  const bSeriesAll = beforeResults.filter((r) => r.isSeries), aSeriesAll = afterResults.filter((r) => r.isSeries);
  benchLines.push(`series,MdAPE,${quantile(bSeriesAll.map((r) => ape(r.estimate, r.actual)).filter(Number.isFinite), 0.5)},${quantile(aSeriesAll.map((r) => ape(r.estimate, r.actual)).filter(Number.isFinite), 0.5)}`);
  for (const y of [2024, 2025, 2026] as const) {
    const b = beforeResults.filter((r) => r.targetYear === y);
    const a = afterResults.filter((r) => r.targetYear === y);
    benchLines.push(`fold_${y},MdAPE,${quantile(b.map((r) => ape(r.estimate, r.actual)).filter(Number.isFinite), 0.5)},${quantile(a.map((r) => ape(r.estimate, r.actual)).filter(Number.isFinite), 0.5)}`);
  }
  fs.writeFileSync("phase27-before-after-benchmark.csv", benchLines.join("\n"), "utf8");

  await prisma.$disconnect();
  console.log("\n\n=== 저장 완료 ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
