/**
 * Feature: KOSIS CPI OpenAPI 연동 — provider 공통 계약.
 *
 * 이 모듈은 "CPI 값이 어디서 왔는지"를 계산 코드가 몰라도 되게 하는 얇은 경계다. 기존
 * `lib/multiyear-series/cpi.ts`의 `tryAdjustForCpi` 공식/all-or-nothing fallback 정책은
 * 전혀 바꾸지 않는다 - 그 함수가 참조하는 `CPI_TABLE`(연도→지수 map)을 어디서 채워 넣을지만
 * 이 provider 계층이 결정한다.
 *
 * repo 관례(순수 함수 + plain object, class 기반 DI 없음)를 따라 `CpiProvider`를 인터페이스가
 * 아니라 "그 모양을 만족하는 plain object"로 다룬다 - `KosisCpiProvider`/`StaticCpiProvider`는
 * ES class가 아니라 이 인터페이스를 만족하는 상수 object/함수다.
 */

export type CpiSource = "KOSIS" | "STATIC_FALLBACK";

export interface ResolvedCpiDataset {
  /** 기존 `CPI_TABLE`과 정확히 같은 모양(연도 -> 지수). `tryAdjustForCpi`가 그대로 받는다. */
  table: Readonly<Record<number, number>>;
  source: CpiSource;
  /** 이 dataset이 실제로 resolve된 시각(ISO). server 진단 전용 - public response에 그대로
   *  노출하지 않는다(§14 - 기존 public contract를 불필요하게 늘리지 않는다). */
  resolvedAt: string;
  /** threshold cache(runtime-cache.ts) 무효화용 단조 증가 버전 - source/table 내용이 실제로
   *  바뀔 때만 증가한다. 같은 KOSIS 응답을 캐시에서 재사용하는 동안에는 절대 바뀌지 않는다. */
  version: number;
  /** 왜 이 source가 선택됐는지(예: "KOSIS_API_KEY 미설정", "KOSIS timeout", "KOSIS invalid
   *  response: TBL_ID mismatch") - server 진단 전용. API key/전체 URL은 절대 포함하지 않는다. */
  diagnosticReason: string | null;
}

export interface CpiProvider {
  getCpiDataset(): Promise<ResolvedCpiDataset>;
}
