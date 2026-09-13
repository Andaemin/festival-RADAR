import { CPI_TABLE } from "@/lib/multiyear-series/cpi";
import { CpiProvider, ResolvedCpiDataset } from "./cpi-provider";

/**
 * §10/§11 — 기존 static CPI 상수(`lib/multiyear-series/cpi.ts`의 `CPI_TABLE`)를 삭제하지 않고
 * 그대로 재노출한다. 이 provider는 KOSIS 연동 전과 100% 동일한 값을 돌려준다 - production
 * fallback과 test/canonical benchmark의 공통 source다.
 *
 * canonical benchmark/regression test는 이 provider를 explicit하게 쓰거나(직접 `CPI_TABLE`을
 * import해 그대로 쓰는 기존 코드를 바꾸지 않아도 됨), 아무 cpiTable도 넘기지 않아 각 함수의
 * default 인자(=CPI_TABLE)로 자연스럽게 떨어진다 - 실시간 KOSIS 호출 경로를 절대 타지 않는다.
 */
const STATIC_DATASET: ResolvedCpiDataset = Object.freeze({
  table: CPI_TABLE,
  source: "STATIC_FALLBACK",
  resolvedAt: "static",
  version: 0,
  diagnosticReason: null,
});

export const staticCpiProvider: CpiProvider = {
  async getCpiDataset(): Promise<ResolvedCpiDataset> {
    return STATIC_DATASET;
  },
};
