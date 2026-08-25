/**
 * PHASE 9C-A — Performance diagnostic. series signal이 꺼져있을 때(festivalName 없음)와
 * 켜져있을 때(festivalName 있음) 실제 라우트 핸들러(POST /api/v1/multiyear-budget-estimates)의
 * 실행 시간을 대표 쿼리 몇 개로 측정한다. 아직 cache/optimization은 설계하지 않는다 - 숫자만
 * 있는 그대로 보고한다.
 *
 * 실행: npx tsx scripts/measure-multiyear-series-signal-latency.ts
 */
import "dotenv/config";
import { NextRequest } from "next/server";
import { POST } from "../app/api/v1/multiyear-budget-estimates/route";
import { getRuntimeCacheStats } from "../lib/multiyear-series/runtime-cache";

function fmtMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const BASE_BODY = {
  regionCode: "SEOUL",
  district: "-",
  festivalTypes: ["CULTURE_ART"],
  venueType: "VILLAGE",
  durationDays: 2,
  planningYear: 2026,
};

const CASES: { label: string; body: Record<string, unknown> }[] = [
  { label: "series disabled (festivalName 없음)", body: { ...BASE_BODY } },
  { label: "series enabled - EXACT (한강페스티벌)", body: { ...BASE_BODY, festivalName: "한강페스티벌" } },
  {
    label: "series enabled - UNMATCHED (2026 한강 서래섬 피크닉 콘서트(봄))",
    body: { ...BASE_BODY, festivalName: "2026 한강 서래섬 피크닉 콘서트(봄)" },
  },
  {
    label: "series enabled - AMBIGUOUS (제21회 인천 펜타포트 음악축제)",
    body: { ...BASE_BODY, regionCode: "INCHEON", festivalName: "제21회 인천 펜타포트 음악축제" },
  },
];

async function call(body: Record<string, unknown>): Promise<number> {
  const req = new NextRequest("http://localhost/api/v1/multiyear-budget-estimates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t0 = performance.now();
  const res = await POST(req);
  await res.json();
  const t1 = performance.now();
  if (res.status !== 200) throw new Error(`unexpected status ${res.status} for ${JSON.stringify(body)}`);
  return t1 - t0;
}

async function main() {
  const REPEATS = 5;
  console.log(`각 케이스 ${REPEATS}회 반복 실행 (첫 실행=cold, 이후=warm, DB connection pool 재사용됨)\n`);

  const memBefore = process.memoryUsage();

  for (const c of CASES) {
    const timings: number[] = [];
    for (let i = 0; i < REPEATS; i++) {
      timings.push(await call(c.body));
    }
    const [first, ...rest] = timings;
    const warmAvg = rest.reduce((s, v) => s + v, 0) / rest.length;
    console.log(
      `[${c.label}]\n  cold(1st)=${first.toFixed(0)}ms  warm avg(2~${REPEATS})=${warmAvg.toFixed(0)}ms  all=[${timings.map((t) => t.toFixed(0)).join(", ")}]ms`
    );
  }

  const memAfter = process.memoryUsage();
  console.log("\n--- runtime cache 상태 ---");
  console.log(getRuntimeCacheStats());
  console.log("\n--- process 메모리 (전체 프로세스, series 캐시만의 값은 아님) ---");
  console.log(`  heapUsed: ${fmtMb(memBefore.heapUsed)} -> ${fmtMb(memAfter.heapUsed)} (증가분 ${fmtMb(memAfter.heapUsed - memBefore.heapUsed)})`);
  console.log(`  rss:      ${fmtMb(memBefore.rss)} -> ${fmtMb(memAfter.rss)} (증가분 ${fmtMb(memAfter.rss - memBefore.rss)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
