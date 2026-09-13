import { staticCpiProvider } from "./static-cpi-provider";
import { CpiProvider, ResolvedCpiDataset } from "./cpi-provider";

/**
 * Feature: KOSIS 소비자물가지수(CPI) OpenAPI 연동.
 *
 * server-side 전용 — 이 파일은 route handler(`app/api/**`)에서만 import한다. 절대
 * `"use client"` 컴포넌트/`NEXT_PUBLIC_*`/page.tsx에서 import하지 않는다(API key가 브라우저
 * 번들에 들어가는 것을 막기 위함 - §2).
 *
 * 통계표: DT_1J22003(소비자물가지수), 항목: T(총지수), 연간(prdSe=Y). §3 요구사항대로
 * `newEstPrdCnt`(최근 N개)가 아니라 `startPrdDe=2017`~`endPrdDe=<현재 연도>` 범위로 조회한다 -
 * 시간이 지나 2017이 "최근 N개"에서 밀려나도 계속 조회되게 하기 위함. endpoint/파라미터는
 * KOSIS 공식 개발가이드(Param/statisticsParameterData.do, tblId+itmId+objL1 기반 조회)를
 * 기준으로 구성했다.
 *
 * objL1(분류1 코드) = `T10` — **실제 KOSIS_API_KEY로 라이브 호출해 확인 완료**(2026-09-13 smoke
 * test). `objL1=00`은 KOSIS가 `{err:"21", errMsg:"잘못된 요청 변수를 호출 하였습니다."}`로
 * 거부한다(추측이 틀렸었다 - production에서 한 번도 성공하지 못하고 매번 static fallback으로
 * 빠졌을 것). `objL1=T10` 응답은 9개 row(2017~2025) 전부 `C1_NM="전국"`, `TBL_ID="DT_1J22003"`,
 * `ITM_NM="소비자물가지수(총지수)"`, `UNIT_NM="2020＝100"`이었고, DT 값이 기존 static CPI_TABLE과
 * 1원 단위까지 정확히 일치했다(parity 100%, 차이 0). 이 값이 다시 바뀌면(예: KOSIS가 분류 체계를
 * 개편하면) 이 상수만 조정하면 된다 - 나머지 검증/캐시/fallback 로직은 objL1 값 자체에 의존하지
 * 않는다.
 */
const KOSIS_ENDPOINT = "https://kosis.kr/openapi/Param/statisticsParameterData.do";
const TBL_ID = "DT_1J22003";
const ITM_ID = "T";
/** "전국" 분류 코드 - 실제 API 응답으로 확인 완료(위 클래스 주석 참고). */
const OBJ_L1 = "T10";
/** 통계청(KOSTAT) 기관 코드 - 실제 API 응답의 ORG_ID로도 확인됨("101"). */
const ORG_ID = "101";

const FETCH_TIMEOUT_MS = 8_000;
/** §8 — 정상 응답 캐시 TTL. CPI는 연간 통계라 요청마다 조회할 필요가 없다. */
const POSITIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 실패(네트워크/timeout/invalid response) 시 매 요청마다 KOSIS를 재시도하지 않기 위한 짧은
 *  negative cache. 너무 길면 KOSIS가 복구된 뒤에도 오래 static에 머문다 - 10분으로 균형을 맞춘다. */
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;

interface KosisRow {
  TBL_ID?: string;
  ITM_ID?: string;
  ITM_NM?: string;
  PRD_DE?: string;
  DT?: string;
  UNIT_NM?: string;
  C1?: string;
  C1_NM?: string;
  LST_CHN_DE?: string;
}

interface KosisErrorResponse {
  err?: string;
  errMsg?: string;
}

interface CacheEntry {
  dataset: ResolvedCpiDataset;
  expiresAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<ResolvedCpiDataset> | null = null;
/** cache가 비어있기 전 마지막으로 실제 사용됐던 dataset - version 연속성/변경 감지에만 쓴다. */
let lastDataset: ResolvedCpiDataset | null = null;

/** export한다 — objL1=T10 같은 핵심 쿼리 파라미터를 회귀 테스트로 직접 확인하기 위함(라이브
 *  응답 없이도 "잘못된 objL1로 되돌아가는" 실수를 다음에 코드 리뷰/CI에서 바로 잡아낸다). */
export function buildUrl(apiKey: string): string {
  const endYear = new Date().getFullYear();
  const params = new URLSearchParams({
    method: "getList",
    apiKey,
    tblId: TBL_ID,
    itmId: ITM_ID,
    objL1: OBJ_L1,
    orgId: ORG_ID,
    prdSe: "Y",
    startPrdDe: "2017",
    endPrdDe: String(endYear),
    format: "json",
    jsonVD: "Y",
  });
  return `${KOSIS_ENDPOINT}?${params.toString()}`;
}

/** 두 CPI table의 내용이 완전히 같은지(연도 집합 + 값) 비교한다 - version을 불필요하게 올리지
 *  않기 위함(같은 값을 다시 받아도 threshold cache 등을 헛되이 무효화하지 않도록). */
function tableContentEquals(a: Readonly<Record<number, number>>, b: Readonly<Record<number, number>>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[Number(k)] === b[Number(k)]);
}

/**
 * §4 — TBL_ID/ITM_ID/PRD_DE/DT 등 필수 field를 검증한다. 하나라도 기대와 다르면(row 단위든
 * 전체든) **전체를 reject**한다(all-or-nothing — 일부만 맞는 값을 섞어 쓰지 않는다, §6/§9).
 * 실패 사유는 diagnosticReason으로만 넘긴다(API key/URL 노출 없음).
 *
 * export한다 — §16 테스트가 실제 network 없이 이 검증 로직만 직접 확인할 수 있어야 하므로.
 */
export function validateAndParse(rows: KosisRow[]): { table: Record<number, number> } | { error: string } {
  if (rows.length === 0) return { error: "empty response(0 rows)" };

  const table: Record<number, number> = {};
  const seenYears = new Set<number>();

  for (const row of rows) {
    if (row.TBL_ID !== undefined && row.TBL_ID !== TBL_ID) {
      return { error: `unexpected TBL_ID: ${row.TBL_ID}` };
    }
    if (row.ITM_ID !== undefined && row.ITM_ID !== ITM_ID) {
      return { error: `unexpected ITM_ID: ${row.ITM_ID}` };
    }
    const prdDe = row.PRD_DE;
    if (prdDe === undefined || !/^\d{4}$/.test(prdDe)) {
      return { error: `invalid PRD_DE: ${String(prdDe)}` };
    }
    const year = Number(prdDe);
    if (seenYears.has(year)) {
      return { error: `duplicate year in response: ${year}` };
    }
    const dt = row.DT === undefined ? NaN : Number(row.DT);
    if (!Number.isFinite(dt) || dt <= 0) {
      return { error: `invalid DT for year ${year}: ${String(row.DT)}` };
    }
    seenYears.add(year);
    table[year] = dt;
  }

  return { table };
}

async function fetchFromKosis(apiKey: string): Promise<{ table: Record<number, number> } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(buildUrl(apiKey), { signal: controller.signal });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { error: "invalid JSON response" };
    }
    if (!Array.isArray(json)) {
      // KOSIS는 오류 시 배열이 아니라 { err, errMsg } 형태의 단일 object를 돌려준다.
      const errBody = json as KosisErrorResponse;
      return { error: `KOSIS error response: err=${errBody?.err ?? "?"} errMsg=${errBody?.errMsg ?? "?"}` };
    }
    return validateAndParse(json as KosisRow[]);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { error: `timeout after ${FETCH_TIMEOUT_MS}ms` };
    }
    return { error: `network error: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

function nextVersion(newTable: Readonly<Record<number, number>>): number {
  if (lastDataset === null) return 1;
  if (tableContentEquals(lastDataset.table, newTable)) return lastDataset.version;
  return lastDataset.version + 1;
}

/**
 * §16 테스트 전용 export — VITEST guard를 거치지 않는 실제 "KOSIS_API_KEY 확인 -> fetch ->
 * validate -> (실패 시) static fallback" 로직 그 자체다. production `getCpiDataset()`은 이
 * 함수를 호출하기 **전에** VITEST guard를 먼저 통과시킨다(아래 kosisCpiProvider 참고) - 이
 * 함수 자체에는 test-환경 분기가 없으므로 테스트가 `global.fetch`를 mock해 그대로 이 함수의
 * 실제 네트워크/캐시-없는 단일 호출 동작을 검증할 수 있다.
 */
export async function resolveDataset(): Promise<ResolvedCpiDataset> {
  const apiKey = process.env.KOSIS_API_KEY;
  if (!apiKey) {
    const fallback = await staticCpiProvider.getCpiDataset();
    return { ...fallback, diagnosticReason: "KOSIS_API_KEY 미설정" };
  }

  const result = await fetchFromKosis(apiKey);
  if ("error" in result) {
    const fallback = await staticCpiProvider.getCpiDataset();
    // §9 — 오류를 숨기지 않되 API key/전체 URL은 절대 포함하지 않는다(result.error는 이미
    // key를 포함하지 않는 문자열만 담는다 - fetchFromKosis/validateAndParse 참고).
    console.error(`[kosis-cpi-provider] KOSIS 조회 실패, static CPI로 fallback: ${result.error}`);
    return { ...fallback, diagnosticReason: `KOSIS fallback: ${result.error}` };
  }

  const version = nextVersion(result.table);
  const dataset: ResolvedCpiDataset = {
    table: Object.freeze(result.table),
    source: "KOSIS",
    resolvedAt: new Date().toISOString(),
    version,
    diagnosticReason: null,
  };
  return dataset;
}

export const kosisCpiProvider: CpiProvider = {
  async getCpiDataset(): Promise<ResolvedCpiDataset> {
    // §11 — canonical benchmark/regression test는 실시간 KOSIS를 절대 호출하지 않는다. Vitest는
    // 모든 테스트 실행에서 process.env.VITEST를 자동으로 설정한다(공식 동작) - 이 값이 있으면
    // KOSIS_API_KEY가 우연히 로컬 .env에 설정돼 있어도 네트워크 시도 자체를 하지 않는다. 이
    // provider의 캐시/single-flight 상태도 전혀 건드리지 않는다(테스트가 resolveDataset을 직접
    // 호출해 network 로직만 별도로 검증할 수 있도록 - 아래 export한 resolveDataset 참고).
    if (process.env.VITEST) {
      const fallback = await staticCpiProvider.getCpiDataset();
      return { ...fallback, diagnosticReason: "test environment(VITEST) - static CPI 강제 사용" };
    }

    const now = Date.now();
    if (cache !== null && cache.expiresAt > now) {
      return cache.dataset;
    }
    if (inFlight !== null) {
      return inFlight;
    }

    inFlight = (async () => {
      const dataset = await resolveDataset();
      const ttl = dataset.source === "KOSIS" ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
      cache = { dataset, expiresAt: Date.now() + ttl };
      lastDataset = dataset;
      return dataset;
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  },
};

/** 테스트 전용 - 모듈 레벨 캐시 초기화(vitest 격리용). production 코드는 호출하지 않는다. */
export function __resetKosisCpiProviderForTests() {
  cache = null;
  inFlight = null;
  lastDataset = null;
}
