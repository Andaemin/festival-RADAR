/**
 * PHASE 27-B — duration recovery의 CSV 조작 mechanics만 모아둔 순수 모듈(I/O 없음).
 *
 * `scripts/phase27-duration-recovery.ts`(실제 적용 스크립트)와 `scripts/phase27b-verify-
 * reproducibility.ts`(재현성 검증 스크립트)가 **동일한 함수**를 그대로 재사용한다 - "같은 로직을
 * 복붙해서 결과가 비슷한지 비교"가 아니라 "완전히 같은 코드 경로를 서로 다른 입력에 돌려서
 * 재현성을 증명"하는 구조다. 이 파일 자체는 duration_days 계산 규칙(classifyRecoverableDuration,
 * duration-recovery.ts)을 갖고 있지 않다 - 오직 "그 결과를 CSV 텍스트에 어떻게 안전하게
 * 반영하는가"만 다룬다.
 */
import type { RawCsvRow } from "./csv-loader";
import { classifyRecoverableDuration, RECOVERY_DURATION_SOURCE } from "./duration-recovery";

export interface RecoveryRow {
  datasetYear: number;
  sourceSheet: string;
  sourceRow: number;
  festivalName: string;
  periodRaw: string;
  recoveredDays: number;
  rule: string;
}

/**
 * 파싱된 canonical CSV row 목록에서, targetYears에 속하고 duration_days가 null이며
 * duration_source=UNPARSED인 행 중 SAFE_RECOVERABLE로 분류되는 것만 골라 복구 목록을 만든다.
 * 순수 함수 - 파일/DB를 전혀 건드리지 않는다. SAFE_RECOVERABLE 판정 자체는
 * `classifyRecoverableDuration`(duration-recovery.ts)에 전적으로 위임한다 - 이 함수는 그 결과를
 * targetYears로 필터링하고 CSV 반영에 필요한 형태로 모으기만 한다("1,480건을 맞추기 위해" 규칙을
 * 조정하지 않는다 - 규칙은 duration-recovery.ts에서 독립적으로 결정되고, 이 함수는 그 결과를
 * 그대로 센다).
 */
export function computeRecoveryPreview(rows: RawCsvRow[], targetYears: number[]): RecoveryRow[] {
  const previewRows: RecoveryRow[] = [];
  for (const r of rows) {
    const year = Number(r["dataset_year"]);
    if (!targetYears.includes(year)) continue;
    if (r["duration_days"] !== null) continue; // 기존 값이 있으면 절대 안 건드림
    if (r["duration_source"] !== "UNPARSED") continue;
    const result = classifyRecoverableDuration(r["period_raw"], year, r["duration_note_raw"]);
    if (result.category !== "SAFE_RECOVERABLE" || result.recoveredDays === null) continue;
    previewRows.push({
      datasetYear: year,
      sourceSheet: String(r["source_sheet"]),
      sourceRow: Number(r["source_row"]),
      festivalName: String(r["festival_name"] ?? ""),
      periodRaw: String(r["period_raw"] ?? ""),
      recoveredDays: result.recoveredDays,
      rule: result.rule,
    });
  }
  return previewRows;
}

// ============================================================================================
// 원본 CSV를 "수정 대상 2개 컬럼(duration_days/duration_source)의 정확한 문자 오프셋"까지
// 보존한 채로 파싱한다 - 다른 모든 바이트는 절대 건드리지 않기 위해서다(일반적인 object→CSV
// 재직렬화는 숫자 포맷/따옴표 스타일이 미세하게 달라질 위험이 있어 채택하지 않았다).
// ============================================================================================
export interface CsvCell { value: string; start: number; end: number }
export interface CsvParseResult { header: string[]; rows: CsvCell[][] }

export function parseCsvWithOffsets(content: string): CsvParseResult {
  const allRows: CsvCell[][] = [];
  let row: CsvCell[] = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    const fieldStart = i;
    let value = "";
    if (content[i] === '"') {
      i++;
      while (i < n) {
        if (content[i] === '"') {
          if (content[i + 1] === '"') { value += '"'; i += 2; continue; }
          i++;
          break;
        }
        value += content[i];
        i++;
      }
    } else {
      while (i < n && content[i] !== "," && content[i] !== "\n" && content[i] !== "\r") {
        value += content[i];
        i++;
      }
    }
    const fieldEnd = i;
    row.push({ value, start: fieldStart, end: fieldEnd });
    if (i < n && content[i] === ",") { i++; continue; }
    if (i < n && content[i] === "\r") i++;
    if (i < n && content[i] === "\n") i++;
    allRows.push(row);
    row = [];
  }
  if (row.length > 0) allRows.push(row);
  const header = allRows[0].map((c) => c.value);
  return { header, rows: allRows.slice(1) };
}

export interface Splice { start: number; end: number; replacement: string }
export function applySplices(content: string, splices: Splice[]): string {
  const sorted = [...splices].sort((a, b) => b.start - a.start); // 뒤에서부터 적용 - 앞쪽 offset이 안 밀리게
  let out = content;
  for (const s of sorted) out = out.slice(0, s.start) + s.replacement + out.slice(s.end);
  return out;
}

/**
 * previewRows(복구 대상 목록)를 실제 CSV 텍스트에 반영한다. BOM 유무를 스스로 처리하고,
 * "duration_days가 실제로 비어있고 duration_source가 UNPARSED일 때만" splice하는 안전조건을
 * 다시 한번 확인한다(이미 채워진 행은 절대 다시 건드리지 않음 - idempotency의 근거).
 * 파일 I/O는 하지 않는다 - 호출자가 원본 content를 읽어 넘기고 반환된 content를 어디에 쓸지 결정한다.
 */
export function applyRecoveryToCsvContent(originalContent: string, previewRows: RecoveryRow[]): { newContent: string; splicedCount: number } {
  const bom = originalContent.charCodeAt(0) === 0xfeff ? "﻿" : "";
  const contentNoBom = bom ? originalContent.slice(1) : originalContent;
  const parsed = parseCsvWithOffsets(contentNoBom);
  const colIdx = (name: string) => parsed.header.indexOf(name);
  const durationDaysCol = colIdx("duration_days");
  const durationSourceCol = colIdx("duration_source");
  const dataYearCol = colIdx("dataset_year");
  const sourceSheetCol = colIdx("source_sheet");
  const sourceRowCol = colIdx("source_row");

  const previewByKey = new Map<string, RecoveryRow>();
  for (const p of previewRows) previewByKey.set(`${p.datasetYear}|${p.sourceSheet}|${p.sourceRow}`, p);

  const splices: Splice[] = [];
  let splicedCount = 0;
  for (const row of parsed.rows) {
    const key = `${row[dataYearCol].value}|${row[sourceSheetCol].value}|${row[sourceRowCol].value}`;
    const p = previewByKey.get(key);
    if (!p) continue;
    // 안전조건: 실제로 duration_days 필드가 빈 값(null)이고 duration_source가 UNPARSED일 때만
    // splice한다 - 이미 채워진 행이면 재실행 시 자동으로 건너뛴다(idempotency 보장의 핵심).
    if (row[durationDaysCol].value !== "" || row[durationSourceCol].value !== "UNPARSED") continue;
    splices.push({ start: row[durationDaysCol].start, end: row[durationDaysCol].end, replacement: String(p.recoveredDays) });
    splices.push({ start: row[durationSourceCol].start, end: row[durationSourceCol].end, replacement: RECOVERY_DURATION_SOURCE });
    splicedCount++;
  }

  const newContentNoBom = applySplices(contentNoBom, splices);
  return { newContent: bom + newContentNoBom, splicedCount };
}
