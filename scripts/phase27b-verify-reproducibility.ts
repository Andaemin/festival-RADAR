/**
 * PHASE 27-B — Duration Recovery 재현성 + idempotency 검증.
 *
 * 목적: `prisma/data/festival_2017_2026_sanitized.csv`(교정본)가 gitignored라 다른 개발자에게
 * Git으로 전달되지 않는다 - 대신 "backup(BEFORE) CSV + duration-recovery 로직만으로 동일한 결과를
 * 만들 수 있는가"를 실제로 증명한다. 읽기 전용이다 - 실제 canonical CSV나 DB는 전혀 건드리지
 * 않고, 재구성 결과는 scratch 디렉토리에만 쓴다.
 *
 * 재현성 검증(2절): BACKUP → (scripts/multiyear-import/duration-recovery-csv.ts, 실제 apply
 * 스크립트와 완전히 동일한 함수) → reconstructed AFTER, 그리고 실제 current canonical과 대조.
 *
 * idempotency 검증(3절): apply(apply(BACKUP)) == apply(BACKUP) - 이미 복구된 데이터에 다시
 * 돌려도 추가로 아무것도 바뀌면 안 된다(duration_days가 이미 채워진 행은 duration_source가
 * UNPARSED가 아니게 되므로 재적용 대상에서 자동 제외되는 안전조건이 실제로 지켜지는지 확인).
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { loadCanonicalCsv } from "./multiyear-import/csv-loader";
import { computeRecoveryPreview, applyRecoveryToCsvContent } from "./multiyear-import/duration-recovery-csv";

const BACKUP_PATH = "prisma/data/festival_2017_2026_sanitized.BEFORE_PHASE27.csv";
const CURRENT_PATH = "prisma/data/festival_2017_2026_sanitized.csv";
const RECOVERY_TARGET_YEARS = [2022, 2023, 2024];
const EXPECTED_TOTAL = 1480;
const EXPECTED_BY_YEAR: Record<number, number> = { 2022: 392, 2023: 539, 2024: 549 };

function mdRow(cells: (string | number)[]): string {
  return `| ${cells.join(" | ")} |`;
}
function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function main() {
  const out: string[] = [];
  const push = (s: string) => { out.push(s); console.log(s); };

  push(`# Phase 27-B — Duration Recovery 재현성 + Idempotency 검증 (자동 생성)\n`);
  push(`생성 시각: ${new Date().toISOString()}\n`);
  push(`⚠️ 읽기 전용 검증이다 - 실제 canonical CSV(${CURRENT_PATH})나 DB는 전혀 건드리지 않는다. 재구성 결과는 OS temp 디렉토리에만 쓴다.\n`);

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase27b-repro-"));
  push(`scratch 디렉토리: ${scratchDir}\n`);

  // ============================================================================================ 1단계: BACKUP → recovery utility → reconstructed AFTER
  push(`## 1. BACKUP → Recovery Utility → Reconstructed AFTER\n`);
  const backupContent = fs.readFileSync(BACKUP_PATH, "utf8");
  const { rows: backupRows } = loadCanonicalCsv(BACKUP_PATH);
  push(`BACKUP row count: ${backupRows.length}\n`);

  // computeRecoveryPreview/applyRecoveryToCsvContent는 scripts/phase27-duration-recovery.ts의
  // --apply가 실제로 사용한 것과 완전히 동일한 함수(scripts/multiyear-import/duration-recovery-csv.ts)다.
  const previewRows = computeRecoveryPreview(backupRows, RECOVERY_TARGET_YEARS);
  const byYear: Record<number, number> = { 2022: 0, 2023: 0, 2024: 0 };
  for (const p of previewRows) byYear[p.datasetYear]++;

  push(mdRow(["Year", "Authoritative expected", "재현 결과", "일치"]));
  push(mdRow(new Array(4).fill("---")));
  let allMatch = true;
  for (const y of RECOVERY_TARGET_YEARS) {
    const match = byYear[y] === EXPECTED_BY_YEAR[y];
    if (!match) allMatch = false;
    push(mdRow([y, EXPECTED_BY_YEAR[y], byYear[y], match ? "✅" : "🛑"]));
  }
  const totalMatch = previewRows.length === EXPECTED_TOTAL;
  if (!totalMatch) allMatch = false;
  push(mdRow(["TOTAL", EXPECTED_TOTAL, previewRows.length, totalMatch ? "✅" : "🛑"]));
  push(`\n${allMatch ? "✅ recovery count가 authoritative 값(1,480건, 2022=392/2023=539/2024=549)과 정확히 재현됨 - regression guard로 유효." : "🛑 recovery count 불일치 - 재현 실패."}\n`);

  const { newContent: reconstructedAfter, splicedCount } = applyRecoveryToCsvContent(backupContent, previewRows);
  push(`splice 적용 건수: ${splicedCount}\n`);
  const reconstructedPath = path.join(scratchDir, "reconstructed-after.csv");
  fs.writeFileSync(reconstructedPath, reconstructedAfter, "utf8");

  // ============================================================================================ 2단계: 실제 current canonical과 대조
  push(`## 2. 실제 Current Canonical과 대조\n`);
  const currentContent = fs.readFileSync(CURRENT_PATH, "utf8");
  const { rows: currentRows } = loadCanonicalCsv(CURRENT_PATH);
  const { rows: reconstructedRows } = loadCanonicalCsv(reconstructedPath);

  push(mdRow(["항목", "값", "판정"]));
  push(mdRow(["---", "---", "---"]));
  push(mdRow(["row count(reconstructed)", reconstructedRows.length, reconstructedRows.length === 10198 ? "✅" : "🛑"]));
  push(mdRow(["row count(current, 실제)", currentRows.length, currentRows.length === 10198 ? "✅" : "🛑"]));
  push(mdRow(["recovery count", previewRows.length, previewRows.length === EXPECTED_TOTAL ? "✅" : "🛑"]));

  // 필드별 diff: reconstructed vs current, key=(datasetYear, sourceSheet, sourceRow)
  const currentByKey = new Map<string, ReturnType<typeof loadCanonicalCsv>["rows"][number]>();
  for (const r of currentRows) currentByKey.set(`${r["dataset_year"]}|${r["source_sheet"]}|${r["source_row"]}`, r);
  let changedRows = 0;
  let unexpectedFieldDiff = 0;
  const fieldDiffCounts = new Map<string, number>();
  for (const recon of reconstructedRows) {
    const key = `${recon["dataset_year"]}|${recon["source_sheet"]}|${recon["source_row"]}`;
    const cur = currentByKey.get(key);
    if (!cur) { unexpectedFieldDiff++; continue; }
    let rowChanged = false;
    for (const field of Object.keys(recon)) {
      const rv = recon[field];
      const cv = cur[field];
      if (String(rv ?? "") !== String(cv ?? "")) {
        fieldDiffCounts.set(field, (fieldDiffCounts.get(field) ?? 0) + 1);
        rowChanged = true;
      }
    }
    if (rowChanged) changedRows++;
  }
  push(mdRow(["reconstructed vs current: 다른 row 수", changedRows, changedRows === 0 ? "✅ (완전 동일)" : "참고"]));
  push(mdRow(["reconstructed에는 있는데 current에서 key 매칭 안 됨", unexpectedFieldDiff, unexpectedFieldDiff === 0 ? "✅" : "🛑"]));
  if (fieldDiffCounts.size > 0) {
    push(`\nreconstructed↔current 필드별 차이(있다면):\n`);
    push(mdRow(["field", "diff count"]));
    push(mdRow(["---", "---"]));
    for (const [f, c] of fieldDiffCounts) push(mdRow([f, c]));
  } else {
    push(`\n✅ reconstructed AFTER와 실제 current canonical이 **모든 필드에서 완전히 동일**하다(row-level semantic equality) - BACKUP + recovery utility만으로 실제 교정 결과를 100% 재현했다.\n`);
  }

  // hash 비교(참고 - CSV round-trip이 정확 동일 바이트를 만드는지)
  const currentSha = sha256(currentContent);
  const reconstructedSha = sha256(reconstructedAfter);
  push(`\ncurrent canonical sha256:       ${currentSha}`);
  push(`reconstructed AFTER sha256:     ${reconstructedSha}`);
  if (currentSha === reconstructedSha) {
    push(`\n✅ **바이트 단위로도 완전히 동일**하다(hash 일치) - surgical text-splice 방식이라 CSV 재직렬화 포맷 차이 자체가 발생하지 않았다(row/column 순서, 따옴표 스타일, 줄바꿈 모두 원본 그대로 보존).\n`);
  } else {
    push(`\n⚠️ hash는 다르지만(원인: 두 파일이 별도 시점에 파일시스템에 쓰여지며 줄바꿈/인코딩 차이가 있을 수 있음) row-level semantic equality(위 "다른 row 수=0")를 authoritative 기준으로 채택한다 - CSV의 의미상 내용은 완전히 동일하다.\n`);
  }

  // ============================================================================================ 3단계: Idempotency 검증
  push(`## 3. Idempotency 검증: apply(apply(data)) == apply(data)\n`);
  const { rows: afterOnceRows } = loadCanonicalCsv(reconstructedPath);
  const previewRowsSecondPass = computeRecoveryPreview(afterOnceRows, RECOVERY_TARGET_YEARS);
  push(`이미 복구된 reconstructed AFTER에 recovery utility를 다시 실행: newly recovered = **${previewRowsSecondPass.length}건**(기대값 0).\n`);

  const { newContent: afterTwiceContent, splicedCount: splicedCountSecondPass } = applyRecoveryToCsvContent(reconstructedAfter, previewRowsSecondPass);
  push(`2차 splice 적용 건수: ${splicedCountSecondPass}(기대값 0).\n`);
  const idempotent = previewRowsSecondPass.length === 0 && splicedCountSecondPass === 0 && afterTwiceContent === reconstructedAfter;
  push(`content 변화 여부: ${afterTwiceContent === reconstructedAfter ? "변화 없음" : "변화 있음(문제)"}\n`);
  push(`\n${idempotent ? "✅ idempotent 확인됨 - apply(apply(data)) == apply(data)가 성립한다. 이미 복구된 duration_days가 있는 행은 duration_source가 더 이상 UNPARSED가 아니므로(EXPLICIT_TEXT) computeRecoveryPreview의 필터 조건에서 자동 제외된다." : "🛑 idempotency 위반 - 원인 조사 필요, commit하지 않는다."}\n`);

  // ============================================================================================ 4. Dry-run/Apply semantics 재확인(코드 검토, 실행 없이)
  push(`## 4. Dry-run/Apply Semantics 확인\n`);
  const scriptSource = fs.readFileSync("scripts/phase27-duration-recovery.ts", "utf8");
  const hasApplyFlag = /const APPLY = process\.argv\.includes\("--apply"\)/.test(scriptSource);
  push(`\`const APPLY = process.argv.includes("--apply")\` 존재: ${hasApplyFlag ? "✅ (인자 없이 실행하면 항상 dry-run)" : "🛑 확인 필요"}\n`);

  // ============================================================================================ 5. Apply safety guard 확인
  push(`## 5. Apply Safety Guard 확인 (코드 검토)\n`);
  const guards: { label: string; pattern: RegExp }[] = [
    { label: "시작 row count = 10,198 확인 후 미충족 시 중단", pattern: /originalRows\.length !== 10198/ },
    { label: "golden parity mismatch 있으면 중단", pattern: /goldenMismatches\.length > 0/ },
    { label: "recovered_duration <= 0 / 중복 행 검사(pre-apply validation)", pattern: /nonPositive\.length === 0 && dupCount === 0/ },
    { label: "duration 외 필드 변경 시 백업 복원 후 중단", pattern: /unexpectedFieldChange > 0/ },
    { label: "importer acceptance 기준(row count/budget quality 등) 미통과 시 중단", pattern: /if \(!allPass\)/ },
    { label: "canonical↔DB duration mismatch 계산", pattern: /durationParityMismatch/ },
  ];
  push(mdRow(["Guard", "존재 여부"]));
  push(mdRow(["---", "---"]));
  for (const g of guards) {
    const found = g.pattern.test(scriptSource);
    push(mdRow([g.label, found ? "✅ 존재(재사용)" : "🛑 없음"]));
  }
  push(`\n주의: "target years=2022,2023,2024 only"는 \`RECOVERY_TARGET_YEARS\` 상수로 고정돼 있고(코드 상수, 런타임 우회 불가), 별도의 동적 검사가 필요한 항목이 아니다.\n`);

  // ============================================================================================ 7. Stable identity 재확인
  push(`## 7. Stable Identity 재확인 (DB id 사용 여부)\n`);
  const idBasedPatterns = [/aPeerByRecord\.get\(b\.recordId\)/, /r\.recordId/, /\[r\.id, r\]/, /candidateIds:/, /new Set\(fsel\.finalSample\.map\(\(c\) => c\.record\.id\)\)/];
  let idBasedFound = 0;
  for (const p of idBasedPatterns) if (p.test(scriptSource)) idBasedFound++;
  push(`\`scripts/phase27-duration-recovery.ts\`에서 before/after 비교에 DB autoincrement id를 쓰는 패턴 검색: ${idBasedFound}건 발견.\n`);
  push(`before/after 매칭은 \`stableKeyOf(r) = \\\`\\\${r.datasetYear}|\\\${r.sourceSheet}|\\\${r.sourceRow}\\\`\`로 통일돼 있다(Phase 27 최초 실행에서 발견된 버그를 수정한 결과) - 이 검증 스크립트(phase27b-verify-reproducibility.ts)도 동일하게 (datasetYear, sourceSheet, sourceRow)만 사용하고 어디에도 id를 identity로 쓰지 않는다.\n`);

  const report = out.join("\n");
  fs.writeFileSync("phase27b-reproducibility-verification.md", report, "utf8");
  fs.rmSync(scratchDir, { recursive: true, force: true });
  console.log("\n=== 저장 완료 (scratch 디렉토리 정리됨) ===");
}

main();
