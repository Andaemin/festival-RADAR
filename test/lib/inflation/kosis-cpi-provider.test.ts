import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetKosisCpiProviderForTests, buildUrl, kosisCpiProvider, resolveDataset, validateAndParse } from "@/lib/inflation/kosis-cpi-provider";
import { staticCpiProvider } from "@/lib/inflation/static-cpi-provider";
import { CPI_TABLE } from "@/lib/multiyear-series/cpi";

/**
 * Feature: KOSIS CPI OpenAPI 연동 — 20절 최소 테스트.
 *
 * `kosisCpiProvider.getCpiDataset()`은 production 안전장치로 `process.env.VITEST`(vitest가
 * 모든 테스트 실행에서 자동 설정)를 감지하면 항상 static fallback만 돌려주고 네트워크를 전혀
 * 시도하지 않는다(§11 - canonical benchmark/regression test는 실시간 KOSIS를 호출하지 않는다).
 * 그래서:
 *   - "정상 파싱"/"invalid response" 검증은 network-free한 `validateAndParse`를 직접 부른다.
 *   - "network failure -> static fallback"/"cache" 검증은 VITEST guard를 거치지 않는
 *     `resolveDataset()`(export됨, 순수하게 "KOSIS_API_KEY 확인 -> fetch -> validate ->
 *     실패 시 fallback"만 한다)을 직접 부르거나, cache 테스트에서만 `process.env.VITEST`를
 *     일시적으로 지워 실제 production 경로(`kosisCpiProvider.getCpiDataset()`)를 그대로 태운다.
 */

const ORIGINAL_ENV = { ...process.env };

function fakeFetchOk(rows: unknown[]) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
}

function validRow(year: number, dt: number) {
  return { TBL_ID: "DT_1J22003", ITM_ID: "T", ITM_NM: "총지수", PRD_DE: String(year), DT: String(dt), UNIT_NM: "2020=100", C1: "00", C1_NM: "전국", LST_CHN_DE: "20260101" };
}

beforeEach(() => {
  __resetKosisCpiProviderForTests();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("buildUrl — 쿼리 파라미터(2026-09-13 라이브 smoke test로 objL1=T10 확정, §17)", () => {
  it("objL1=T10을 쓴다(objL1=00은 실제 KOSIS가 err=21 잘못된 요청 변수로 거부함 - 회귀 방지)", () => {
    const url = new URL(buildUrl("dummy-key-for-test"));
    expect(url.searchParams.get("objL1")).toBe("T10");
    expect(url.searchParams.get("objL1")).not.toBe("00");
  });

  it("tblId/itmId/orgId/prdSe/method/format이 §2/§3 요구사항대로 고정돼 있다", () => {
    const url = new URL(buildUrl("dummy-key-for-test"));
    expect(url.searchParams.get("tblId")).toBe("DT_1J22003");
    expect(url.searchParams.get("itmId")).toBe("T");
    expect(url.searchParams.get("orgId")).toBe("101");
    expect(url.searchParams.get("prdSe")).toBe("Y");
    expect(url.searchParams.get("method")).toBe("getList");
    expect(url.searchParams.get("format")).toBe("json");
  });

  it("startPrdDe=2017 고정, endPrdDe=현재 연도(newEstPrdCnt 미사용, §3)", () => {
    const url = new URL(buildUrl("dummy-key-for-test"));
    expect(url.searchParams.get("startPrdDe")).toBe("2017");
    expect(url.searchParams.get("endPrdDe")).toBe(String(new Date().getFullYear()));
    expect(url.searchParams.has("newEstPrdCnt")).toBe(false);
  });
});

describe("validateAndParse — KOSIS response parsing", () => {
  it("정상 response -> year -> CPI map 생성", () => {
    const result = validateAndParse([validRow(2017, 97.645), validRow(2018, 99.086), validRow(2019, 99.466)]);
    expect(result).toEqual({ table: { 2017: 97.645, 2018: 99.086, 2019: 99.466 } });
  });

  it("빈 배열(0 row)은 reject", () => {
    const result = validateAndParse([]);
    expect("error" in result).toBe(true);
  });

  it("invalid DT(숫자 아님)는 reject", () => {
    const result = validateAndParse([{ ...validRow(2017, 0), DT: "not-a-number" }]);
    expect("error" in result).toBe(true);
  });

  it("DT<=0(0 이하)은 reject", () => {
    const result = validateAndParse([{ ...validRow(2017, 0), DT: "0" }]);
    expect("error" in result).toBe(true);
  });

  it("PRD_DE 누락은 reject", () => {
    const result = validateAndParse([{ TBL_ID: "DT_1J22003", ITM_ID: "T", DT: "100" }]);
    expect("error" in result).toBe(true);
  });

  it("PRD_DE가 4자리 연도가 아니면(예: 202001 월간) reject", () => {
    const result = validateAndParse([{ ...validRow(2017, 97.645), PRD_DE: "202001" }]);
    expect("error" in result).toBe(true);
  });

  it("중복 연도는 reject", () => {
    const result = validateAndParse([validRow(2017, 97.645), validRow(2017, 98.0)]);
    expect("error" in result).toBe(true);
  });

  it("예상과 다른 TBL_ID는 reject(다른 통계표가 섞여 들어온 경우)", () => {
    const result = validateAndParse([{ ...validRow(2017, 97.645), TBL_ID: "DT_9999999" }]);
    expect("error" in result).toBe(true);
  });

  it("예상과 다른 ITM_ID는 reject(총지수가 아닌 다른 항목)", () => {
    const result = validateAndParse([{ ...validRow(2017, 97.645), ITM_ID: "X" }]);
    expect("error" in result).toBe(true);
  });

  it("일부 row만 유효해도 all-or-nothing으로 전체 reject한다(부분 반영 금지, §6/§9)", () => {
    const result = validateAndParse([validRow(2017, 97.645), { ...validRow(2018, 0), DT: "invalid" }]);
    expect("error" in result).toBe(true);
  });
});

describe("resolveDataset — KOSIS_API_KEY 미설정", () => {
  it("KOSIS_API_KEY가 없으면 네트워크 시도 없이 즉시 static fallback", async () => {
    delete process.env.KOSIS_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const dataset = await resolveDataset();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dataset.source).toBe("STATIC_FALLBACK");
    expect(dataset.table).toEqual(CPI_TABLE);
    expect(dataset.diagnosticReason).toContain("KOSIS_API_KEY");
  });
});

describe("resolveDataset — KOSIS network failure/invalid response -> static fallback", () => {
  beforeEach(() => {
    process.env.KOSIS_API_KEY = "test-key";
  });

  it("network error -> static fallback (API key가 에러 메시지에 노출되지 않음)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const dataset = await resolveDataset();
    expect(dataset.source).toBe("STATIC_FALLBACK");
    expect(dataset.table).toEqual(CPI_TABLE);
    expect(dataset.diagnosticReason).not.toContain("test-key");
  });

  it("HTTP error(4xx/5xx) -> static fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const dataset = await resolveDataset();
    expect(dataset.source).toBe("STATIC_FALLBACK");
  });

  it("invalid JSON -> static fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      })
    );
    const dataset = await resolveDataset();
    expect(dataset.source).toBe("STATIC_FALLBACK");
  });

  it("KOSIS 오류 응답({err, errMsg} 단일 object) -> static fallback, apiKey 노출 없음", async () => {
    // KOSIS는 오류 시 배열이 아니라 { err, errMsg } 단일 object를 돌려준다 - fakeFetchOk(배열
    // 전용 헬퍼)를 쓰지 않고 여기서 직접 mock한다.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ err: "10", errMsg: "인증키가 유효하지 않습니다." }) }));
    const dataset = await resolveDataset();
    expect(dataset.source).toBe("STATIC_FALLBACK");
    expect(dataset.diagnosticReason).toContain("errMsg");
    expect(dataset.diagnosticReason).not.toContain("test-key");
  });

  it("timeout -> static fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      })
    );
    vi.useFakeTimers();
    const promise = resolveDataset();
    await vi.advanceTimersByTimeAsync(9_000);
    const dataset = await promise;
    vi.useRealTimers();
    expect(dataset.source).toBe("STATIC_FALLBACK");
    expect(dataset.diagnosticReason).toContain("timeout");
  }, 15_000);

  it("required field(DT) 누락 -> reject -> static fallback", async () => {
    vi.stubGlobal("fetch", fakeFetchOk([{ TBL_ID: "DT_1J22003", ITM_ID: "T", PRD_DE: "2017" }]));
    const dataset = await resolveDataset();
    expect(dataset.source).toBe("STATIC_FALLBACK");
  });
});

describe("resolveDataset — 정상 KOSIS 응답", () => {
  beforeEach(() => {
    process.env.KOSIS_API_KEY = "test-key";
  });

  it("정상 응답이면 source=KOSIS, table에 파싱된 값이 들어간다", async () => {
    vi.stubGlobal("fetch", fakeFetchOk([validRow(2017, 97.645), validRow(2018, 99.086)]));
    const dataset = await resolveDataset();
    expect(dataset.source).toBe("KOSIS");
    expect(dataset.table).toEqual({ 2017: 97.645, 2018: 99.086 });
    expect(dataset.diagnosticReason).toBeNull();
  });
});

describe("kosisCpiProvider.getCpiDataset — cache (VITEST guard를 일시적으로 해제한 production 경로)", () => {
  it("연속 요청이 KOSIS를 반복 호출하지 않는다(24h TTL 캐시)", async () => {
    process.env.KOSIS_API_KEY = "test-key";
    const fetchSpy = fakeFetchOk([validRow(2017, 97.645)]);
    vi.stubGlobal("fetch", fetchSpy);

    const savedVitestFlag = process.env.VITEST;
    delete process.env.VITEST; // production 경로(cache 포함)를 실제로 태우기 위한 일시적 해제.
    try {
      const a = await kosisCpiProvider.getCpiDataset();
      const b = await kosisCpiProvider.getCpiDataset();
      const c = await kosisCpiProvider.getCpiDataset();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(a).toBe(b); // 같은 캐시 object 참조(runtime-cache.ts의 threshold cache 키 비교와 맞물림).
      expect(b).toBe(c);
    } finally {
      process.env.VITEST = savedVitestFlag;
    }
  });

  it("동시(concurrent) 요청은 KOSIS를 한 번만 호출한다(single-flight)", async () => {
    process.env.KOSIS_API_KEY = "test-key";
    const fetchSpy = fakeFetchOk([validRow(2017, 97.645)]);
    vi.stubGlobal("fetch", fetchSpy);

    const savedVitestFlag = process.env.VITEST;
    delete process.env.VITEST;
    try {
      const [a, b, c] = await Promise.all([kosisCpiProvider.getCpiDataset(), kosisCpiProvider.getCpiDataset(), kosisCpiProvider.getCpiDataset()]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(a).toBe(b);
      expect(b).toBe(c);
    } finally {
      process.env.VITEST = savedVitestFlag;
    }
  });

  it("VITEST 환경에서는 KOSIS_API_KEY가 있어도 네트워크를 시도하지 않는다(§11)", async () => {
    process.env.KOSIS_API_KEY = "test-key"; // VITEST guard가 이 값보다 우선해야 한다.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const dataset = await kosisCpiProvider.getCpiDataset();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dataset.source).toBe("STATIC_FALLBACK");
    expect(dataset.table).toEqual(CPI_TABLE);
  });
});

describe("static/KOSIS 형태 동등성", () => {
  it("staticCpiProvider가 돌려주는 table은 CPI_TABLE과 값이 완전히 같다(값 변경 없음, §10)", async () => {
    const dataset = await staticCpiProvider.getCpiDataset();
    expect(dataset.table).toEqual(CPI_TABLE);
    expect(dataset.source).toBe("STATIC_FALLBACK");
  });
});
