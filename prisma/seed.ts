/**
 * 지역축제 예산 데이터 seed 스크립트
 *
 * 실행:
 *   npx prisma db seed
 *
 * 엑셀 파일 위치:
 *   prisma/data/ 디렉토리에 .xlsx 파일을 넣으면 자동으로 찾아서 처리한다.
 *   파일이 여러 개면 파일명이 가장 나중인 것(가장 최신)을 사용한다.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as XLSX from "xlsx";
import { PrismaClient } from "../lib/generated/prisma";

const prisma = new PrismaClient();

// ─── 컬럼 인덱스 (0-based) ─────────────────────────────────────────────────
const COL = {
  SOURCE_ROW_NUMBER: 1,       // B: 연번
  REGION: 2,                  // C: 광역자치단체명
  ADMINISTRATIVE_DISTRICT: 3, // D: 기초자치단체명
  FESTIVAL_NAME: 4,           // E: 축제명
  FESTIVAL_TYPE: 5,           // F: 축제 유형
  VENUE_NAME: 6,              // G: 개최 장소(장소명)
  VENUE_TYPE: 7,              // H: 개최 장소 유형
  VENUE_REGION: 8,            // I: 개최지 시도
  VENUE_DISTRICT: 9,          // J: 개최지 시군구
  START_YEAR: 11,             // L
  START_MONTH: 12,            // M
  START_DAY: 13,              // N
  END_YEAR: 14,               // O
  END_MONTH: 15,              // P
  END_DAY: 16,                // Q
  DURATION_DAYS: 17,          // R: 총 일수
  DURATION_NOTE: 18,          // S: 개최기간 비고
  CYCLE: 19,                  // T: 개최 주기
  FIRST_HELD_YEAR: 20,        // U: 최초 개최연도
  TOTAL_BUDGET: 21,           // V: 예산 합계(백만원)
  NATIONAL_BUDGET: 22,        // W: 국비
  LOCAL_BUDGET: 23,           // X: 지방비
  OTHER_BUDGET: 24,           // Y: 기타
  PREVIOUS_VISITORS: 26,      // AA: 방문객수(전년)
  DOMESTIC_VISITORS: 27,      // AB: 내국인
  FOREIGN_VISITORS: 28,       // AC: 외국인
  MEASUREMENT_METHOD: 29,     // AD: 계측 방법
} as const;

const DATA_START_ROW = 8; // 9행(1-based) = 인덱스 8(0-based)

// ─── 코드 접두사 제거 ("01. 서울" → "서울") ───────────────────────────────
function stripPrefix(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.trim().replace(/^\d{1,2}\.\s*/, "");
}

function trimToNull(val: string | null | undefined): string | null {
  if (!val) return null;
  const t = String(val).trim();
  return t === "" ? null : t;
}

function normalizeDash(val: string | null | undefined): string | null {
  const t = trimToNull(val);
  return t === "-" ? null : t;
}

// ─── 셀 값 읽기 ──────────────────────────────────────────────────────────
type ExcelRow = (string | number | boolean | null)[];

function cellString(row: ExcelRow, col: number): string | null {
  const v = row[col];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function cellNumber(row: ExcelRow, col: number): number | null {
  const v = row[col];
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Math.round(v);
  return null;
}

function cellIsNumber(row: ExcelRow, col: number): boolean {
  return typeof row[col] === "number";
}

// ─── enum 매핑 ───────────────────────────────────────────────────────────

const REGION_MAP: Record<string, string> = {
  "서울": "SEOUL", "부산": "BUSAN", "대구": "DAEGU", "인천": "INCHEON",
  "광주": "GWANGJU", "대전": "DAEJEON", "울산": "ULSAN", "세종": "SEJONG",
  "경기": "GYEONGGI", "강원": "GANGWON", "충북": "CHUNGBUK", "충남": "CHUNGNAM",
  "전북": "JEONBUK", "전남": "JEONNAM", "경북": "GYEONGBUK", "경남": "GYEONGNAM",
  "제주": "JEJU",
};

const FESTIVAL_TYPE_MAP: Record<string, string> = {
  "문화예술": "CULTURE_ART", "자연생태": "NATURE_ECOLOGY", "주민화합": "COMMUNITY",
  "전통역사": "TRADITION_HISTORY", "지역특산물": "LOCAL_SPECIALTY",
};

const VENUE_TYPE_MAP: Record<string, string> = {
  "마을형": "VILLAGE", "녹지형": "GREEN", "수변형": "WATERFRONT",
  "독립형": "INDEPENDENT", "기타": "OTHER", "미정": "UNDECIDED",
};

const CYCLE_MAP: Record<string, string> = {
  "매년": "ANNUAL", "격년": "BIENNIAL", "일회성": "ONE_TIME", "최초": "FIRST_TIME",
};

const VISITOR_METHOD_MAP: Record<string, string> = {
  "계측": "MEASURED", "추정": "ESTIMATED", "미집계": "NOT_TALLIED",
  "기타": "OTHER", "무응답": "NO_RESPONSE",
};

const VISITOR_STATUS_MAP: Record<string, string> = {
  "미집계": "NOT_TALLIED", "최초 개최": "FIRST_TIME_HELD",
  "최근 미개최": "RECENTLY_NOT_HELD", "모름": "UNKNOWN",
};

function mapEnum<T extends string>(
  map: Record<string, string>,
  raw: string | null,
  fallback: T | null = null
): T | null {
  if (!raw) return fallback;
  const key = stripPrefix(raw);
  return (key && map[key] ? map[key] : fallback) as T | null;
}

// ─── 예산 상태 분류 ───────────────────────────────────────────────────────
function classifyBudgetStatus(row: ExcelRow): string {
  if (cellIsNumber(row, COL.TOTAL_BUDGET)) {
    const v = row[COL.TOTAL_BUDGET] as number;
    return v > 0 ? "CONFIRMED" : "ZERO";
  }
  const text = cellString(row, COL.TOTAL_BUDGET);
  if (text === "미확정") return "UNCONFIRMED";
  return "NO_RESPONSE";
}

// ─── 개최 기간 계산 ───────────────────────────────────────────────────────
function computeDuration(row: ExcelRow): { days: number | null; source: string } {
  const reported = cellNumber(row, COL.DURATION_DAYS);
  if (reported !== null) return { days: reported, source: "REPORTED" };

  const sy = cellNumber(row, COL.START_YEAR);
  const sm = cellNumber(row, COL.START_MONTH);
  const sd = cellNumber(row, COL.START_DAY);
  const ey = cellNumber(row, COL.END_YEAR);
  const em = cellNumber(row, COL.END_MONTH);
  const ed = cellNumber(row, COL.END_DAY);

  if (sy && sm && sd && ey && em && ed) {
    try {
      const start = new Date(sy, sm - 1, sd);
      const end = new Date(ey, em - 1, ed);
      const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      if (days > 0) return { days, source: "CALCULATED" };
    } catch {
      // 날짜 계산 실패
    }
  }
  return { days: null, source: "UNKNOWN" };
}

// ─── 예산 백만원 → 원 변환 ────────────────────────────────────────────────
function budgetToKrw(row: ExcelRow, col: number): bigint | null {
  if (!cellIsNumber(row, col)) return null;
  const v = row[col] as number;
  return BigInt(Math.round(v * 1_000_000));
}

// ─── 방문객 필드 처리 ─────────────────────────────────────────────────────
function resolveVisitor(row: ExcelRow, col: number): { value: number | null; status: string | null } {
  if (cellIsNumber(row, col)) return { value: cellNumber(row, col), status: null };
  const text = cellString(row, col);
  const status = text ? VISITOR_STATUS_MAP[text] ?? null : null;
  return { value: null, status };
}

// ─── 메인 실행 ───────────────────────────────────────────────────────────
async function main() {
  // prisma/data/ 에서 xlsx 파일 찾기
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) {
    throw new Error("prisma/data/ 디렉토리가 없습니다. 디렉토리를 만들고 엑셀 파일을 넣어주세요.");
  }
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".xlsx") || f.endsWith(".xls"));
  if (files.length === 0) {
    throw new Error("prisma/data/ 에 엑셀 파일(.xlsx)이 없습니다.");
  }
  // 파일명 정렬 후 마지막(최신) 파일 사용
  files.sort();
  const filePath = path.join(dataDir, files[files.length - 1]);
  const fileName = path.basename(filePath);
  console.log(`엑셀 파일: ${fileName}`);

  const fileBytes = fs.readFileSync(filePath);
  const fileHash = crypto.createHash("sha256").update(fileBytes).digest("hex");

  // 이미 동일 파일이 임포트됐으면 건너뜀
  const existing = await prisma.datasetImportBatch.findFirst({ where: { fileHash } });
  if (existing) {
    console.log(`동일 파일(해시 일치)이 이미 임포트되어 있습니다. (batchId: ${existing.id})`);
    return;
  }

  // 연도 추출 (파일명에 4자리 숫자가 있으면 사용, 없으면 현재 연도)
  const yearMatch = fileName.match(/(\d{4})/);
  const datasetYear = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
  console.log(`데이터셋 연도: ${datasetYear}`);

  // 엑셀 파싱
  const workbook = XLSX.read(fileBytes, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets["조사표"];
  if (!sheet) {
    throw new Error(`"조사표" 시트를 찾을 수 없습니다. 시트 목록: ${workbook.SheetNames.join(", ")}`);
  }

  // 전체를 2D 배열로 변환 (헤더 없이)
  const rawRows: ExcelRow[] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const records: any[] = [];
  let skipped = 0;
  const warnings: string[] = [];

  for (let i = DATA_START_ROW; i < rawRows.length; i++) {
    const row = rawRows[i];
    const sourceRowNumber = cellNumber(row, COL.SOURCE_ROW_NUMBER);
    if (sourceRowNumber === null) break; // B열 연번이 없으면 데이터 끝

    const rowLabel = `행 ${i + 1}(연번 ${sourceRowNumber})`;

    // 필수 필드 검증
    const festivalName = trimToNull(cellString(row, COL.FESTIVAL_NAME));
    const region = mapEnum(REGION_MAP, cellString(row, COL.REGION));
    const festivalType = mapEnum(FESTIVAL_TYPE_MAP, cellString(row, COL.FESTIVAL_TYPE));
    const venueType = mapEnum(VENUE_TYPE_MAP, cellString(row, COL.VENUE_TYPE));
    const cycleType = mapEnum(CYCLE_MAP, cellString(row, COL.CYCLE));

    if (!festivalName || !region || !festivalType || !venueType || !cycleType) {
      warnings.push(`${rowLabel}: 필수 필드 누락 → 건너뜀 (name=${festivalName}, region=${region}, type=${festivalType}, venue=${venueType}, cycle=${cycleType})`);
      skipped++;
      continue;
    }

    const duration = computeDuration(row);
    const budgetStatus = classifyBudgetStatus(row);
    const prev = resolveVisitor(row, COL.PREVIOUS_VISITORS);
    const domestic = resolveVisitor(row, COL.DOMESTIC_VISITORS);
    const foreign = resolveVisitor(row, COL.FOREIGN_VISITORS);

    void row[COL.FIRST_HELD_YEAR]; // unused raw ref
    const firstHeldYear = cellIsNumber(row, COL.FIRST_HELD_YEAR) ? cellNumber(row, COL.FIRST_HELD_YEAR) : null;
    const firstHeldYearNote = !cellIsNumber(row, COL.FIRST_HELD_YEAR) ? trimToNull(cellString(row, COL.FIRST_HELD_YEAR)) : null;

    records.push({
      datasetYear,
      sourceRowNumber,
      festivalName,
      region: region as any,
      regionName: stripPrefix(cellString(row, COL.REGION)) ?? "",
      administrativeDistrict: normalizeDash(cellString(row, COL.ADMINISTRATIVE_DISTRICT)),
      festivalType: festivalType as any,
      venueName: trimToNull(cellString(row, COL.VENUE_NAME)),
      venueType: venueType as any,
      venueRegion: stripPrefix(cellString(row, COL.VENUE_REGION)),
      venueDistrict: trimToNull(cellString(row, COL.VENUE_DISTRICT)),
      startYear: cellNumber(row, COL.START_YEAR),
      startMonth: cellNumber(row, COL.START_MONTH),
      startDay: cellNumber(row, COL.START_DAY),
      endYear: cellNumber(row, COL.END_YEAR),
      endMonth: cellNumber(row, COL.END_MONTH),
      endDay: cellNumber(row, COL.END_DAY),
      durationDays: duration.days,
      durationSource: duration.source as any,
      durationNote: trimToNull(cellString(row, COL.DURATION_NOTE)),
      cycleType: cycleType as any,
      firstHeldYear,
      firstHeldYearNote,
      totalBudgetKrw: budgetToKrw(row, COL.TOTAL_BUDGET),
      nationalBudgetKrw: budgetToKrw(row, COL.NATIONAL_BUDGET),
      localBudgetKrw: budgetToKrw(row, COL.LOCAL_BUDGET),
      otherBudgetKrw: budgetToKrw(row, COL.OTHER_BUDGET),
      budgetStatus: budgetStatus as any,
      previousVisitors: prev.value,
      previousVisitorsStatus: prev.status as any,
      domesticVisitors: domestic.value,
      domesticVisitorsStatus: domestic.status as any,
      foreignVisitors: foreign.value,
      foreignVisitorsStatus: foreign.status as any,
      visitorMeasurementMethod: mapEnum(VISITOR_METHOD_MAP, cellString(row, COL.MEASUREMENT_METHOD)) as any,
    });
  }

  console.log(`파싱 완료: ${records.length}건 적재 예정, ${skipped}건 건너뜀`);
  if (warnings.length > 0) {
    console.warn(`경고 ${warnings.length}건:`);
    warnings.slice(0, 20).forEach((w) => console.warn("  -", w));
    if (warnings.length > 20) console.warn(`  ... 외 ${warnings.length - 20}건 더 있음`);
  }

  // ImportBatch 생성 후 레코드 일괄 삽입
  const confirmedCount = records.filter((r) => r.budgetStatus === "CONFIRMED").length;

  const batch = await prisma.datasetImportBatch.create({
    data: {
      datasetYear,
      originalFileName: fileName,
      fileHash,
      totalRows: records.length + skipped,
      validBudgetRows: confirmedCount,
      invalidRows: skipped,
      status: "SUCCESS",
    },
  });

  console.log(`ImportBatch 생성: id=${batch.id}`);

  // createMany로 일괄 삽입
  const result = await prisma.festivalRecord.createMany({
    data: records.map((r) => ({ ...r, importBatchId: batch.id })),
    skipDuplicates: false,
  });

  console.log(`DB 삽입 완료: ${result.count}건`);
  console.log("─────────────────────────────────");
  console.log(`총 ${result.count}개 축제 데이터 임포트 완료`);
}

main()
  .catch((e) => {
    console.error("seed 실패:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
