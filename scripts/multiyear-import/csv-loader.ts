import * as crypto from "crypto";
import * as fs from "fs";
import * as XLSX from "xlsx";
import { REQUIRED_HEADERS } from "./constants";

export type RawCsvRow = Record<string, string | number | boolean | null>;

export interface LoadedCsv {
  rows: RawCsvRow[];
  fileSha256: string;
  headers: string[];
}

/**
 * canonical CSV를 header 이름 기준으로 읽는다. column index는 절대 하드코딩하지 않는다.
 * 필수 header가 하나라도 없으면 즉시 throw한다 (silent skip 금지).
 */
export function loadCanonicalCsv(filePath: string): LoadedCsv {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `CSV 파일을 찾을 수 없습니다: ${filePath}\n` +
        `--file <경로> 로 지정하거나, prisma/data/festival_2017_2026_sanitized.csv 에 파일을 두세요.`
    );
  }

  const buffer = fs.readFileSync(filePath);
  const fileSha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  // UTF-8 BOM 제거 (SheetJS가 BOM을 첫 header 이름에 붙여버리는 것을 방지)
  let content = buffer.toString("utf-8");
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const workbook = XLSX.read(content, { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<RawCsvRow>(sheet, { defval: null });

  if (rows.length === 0) {
    throw new Error(`CSV에 데이터 행이 없습니다: ${filePath}`);
  }

  const headers = Object.keys(rows[0]);
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    throw new Error(
      `CSV에 필수 header가 없습니다: ${missingHeaders.join(", ")}\n` +
        `실제 header: ${headers.join(", ")}`
    );
  }

  return { rows, fileSha256, headers };
}
