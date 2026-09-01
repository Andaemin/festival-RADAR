import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getMultiYearDataRevision } from "@/lib/multiyear-series/data-revision";
import { computeReliabilityBacktestSummary, ReliabilityBacktestSummary } from "@/lib/multiyear-series/reliability-backtest";
import { getCachedSeriesRecords } from "@/lib/multiyear-series/runtime-cache";

/**
 * PHASE — G0 이후 Reliability Revalidation. READ-ONLY DIAGNOSTIC endpoint. `/assistant-tester`
 * 전용이며 production 사용자 플로우는 이 endpoint를 호출하지 않는다. DB write 없음. reliability
 * tier 판정식/threshold는 전혀 건드리지 않는다 - 실제 production 함수를 leakage-safe backtest에
 * 그대로 적용한 사후 집계만 돌려준다(lib/multiyear-series/reliability-backtest.ts 참고).
 *
 * 계산 비용이 크므로(fold 3개 × 각 fold 전체 재평가) dataRevision 단위 process-local
 * 캐시(single-flight)를 둔다 - runtime-cache.ts와 같은 패턴이지만 그 파일은 건드리지 않는다.
 */
interface CacheEntry {
  revision: number;
  promise: Promise<ReliabilityBacktestSummary>;
}
let cache: CacheEntry | null = null;

function getCachedBacktestSummary(revision: number, compute: () => Promise<ReliabilityBacktestSummary>): Promise<ReliabilityBacktestSummary> {
  if (cache !== null && cache.revision !== revision) cache = null;
  if (cache === null) cache = { revision, promise: compute() };
  return cache.promise;
}

/** 테스트 전용 - 모듈 레벨 캐시 초기화. production 코드는 호출하지 않는다. */
export function __resetReliabilityAuditCacheForTests() {
  cache = null;
}

export async function GET() {
  try {
    const dataRevision = await getMultiYearDataRevision(prisma);
    const summary = await getCachedBacktestSummary(dataRevision, async () => {
      const allSeriesRecords = await getCachedSeriesRecords(prisma, dataRevision);
      return computeReliabilityBacktestSummary(allSeriesRecords);
    });

    return NextResponse.json({
      dataRevision,
      summary,
      helpText:
        "신뢰도는 '이 예산이 맞을 확률'이 아니라, 이 추정에 사용한 동일 축제 과거 데이터 근거의 안정성/강도를 나타냅니다. " +
        "이 backtest는 leakage-safe 2024~2026 fold의 사후 집계이며 production reliability 판정식을 전혀 바꾸지 않습니다.",
    });
  } catch (error) {
    console.error("[GET /api/v1/reliability-audit]", error);
    return NextResponse.json({ message: "Reliability 감사 조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
