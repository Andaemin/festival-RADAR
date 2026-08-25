import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetRuntimeCacheForTests,
  effectiveTrainingThroughYear,
  getCachedFrozenSeriesModel,
  getCachedVolatilityThreshold,
  getRuntimeCacheStats,
} from "@/lib/multiyear-series/runtime-cache";
import { rec } from "./helpers";

/**
 * PHASE 9C-A.1 — process-local FrozenSeriesModel 캐시의 hit/miss/invalidation을 DB 없이
 * 검증한다. {@link getCachedFrozenSeriesModel}은 `allSeriesRecords: SeriesRecordWithQuality[]`를
 * 직접 인자로 받으므로(DB 쿼리는 별도의 getCachedSeriesRecords가 담당) 여기서는 순수 in-memory
 * fixture로만 테스트한다. 알고리즘/scoring 자체(deterministic/ambiguous/chain)는
 * series-linker.test.ts가 이미 검증하므로, 여기서는 "같은 키면 재사용, 다른 키면 재계산,
 * revision이 바뀌면 무효화"라는 캐시 계약만 좁게 확인한다.
 */
describe("effectiveTrainingThroughYear", () => {
  it("planningYear가 보유 데이터 최댓값보다 미래면 최댓값으로 포화(saturate)한다", () => {
    expect(effectiveTrainingThroughYear(2027, 2026)).toBe(2026);
    expect(effectiveTrainingThroughYear(2028, 2026)).toBe(2026);
    expect(effectiveTrainingThroughYear(2030, 2026)).toBe(2026);
  });

  it("planningYear가 보유 데이터 범위 안이면 planningYear-1을 그대로 쓴다", () => {
    expect(effectiveTrainingThroughYear(2026, 2026)).toBe(2025);
    expect(effectiveTrainingThroughYear(2020, 2026)).toBe(2019);
  });
});

describe("getCachedFrozenSeriesModel - hit/miss/invalidation", () => {
  const members = [
    rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", budgetKrw: 100 }),
    rec({ id: 2, datasetYear: 2018, festivalName: "제2회 가나다축제", budgetKrw: 200 }),
    rec({ id: 3, datasetYear: 2026, festivalName: "마바사축제", budgetKrw: 300 }),
  ].map((r) => ({ ...r, budgetQualityFlag: "VALID" as const }));

  beforeEach(() => {
    __resetRuntimeCacheForTests();
  });

  it("같은 (revision, planningYear)로 두 번 호출하면 동일 object reference를 반환한다(재계산 안 함)", async () => {
    const a = await getCachedFrozenSeriesModel(members, 1, 2020);
    const b = await getCachedFrozenSeriesModel(members, 1, 2020);
    expect(a).toBe(b); // 참조 동일 = 다시 안 만들고 캐시에서 그대로 반환했다는 뜻
  });

  it("다른 planningYear라도 effectiveTrainingThroughYear가 같으면(포화 구간) 같은 model을 공유한다", async () => {
    // 보유 데이터 최댓값(2026)보다 미래인 2027/2028/2030은 전부 cutoff=2026으로 포화된다.
    const a = await getCachedFrozenSeriesModel(members, 1, 2027);
    const b = await getCachedFrozenSeriesModel(members, 1, 2028);
    const c = await getCachedFrozenSeriesModel(members, 1, 2030);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("effectiveTrainingThroughYear가 다르면(실제 cutoff가 다름) 다른 model을 새로 만든다", async () => {
    const a = await getCachedFrozenSeriesModel(members, 1, 2019); // cutoff=2018, 2017/2018만 포함
    const b = await getCachedFrozenSeriesModel(members, 1, 2020); // cutoff=2019, 여전히 2017/2018만 포함(내용은 같을 수 있음)
    const c = await getCachedFrozenSeriesModel(members, 1, 2027); // cutoff=2026, 2017/2018/2026 전부 포함
    expect(a).not.toBe(c); // 서로 다른 cutoff는 항상 별개 cache entry(내용이 같아도 reference는 다르다)
    expect(b).not.toBe(c);
  });

  it("dataRevision이 바뀌면 이전 캐시를 버리고 새로 만든다", async () => {
    const before = await getCachedFrozenSeriesModel(members, 1, 2020);
    const afterSameRevision = await getCachedFrozenSeriesModel(members, 1, 2020);
    expect(before).toBe(afterSameRevision);

    const afterNewRevision = await getCachedFrozenSeriesModel(members, 2, 2020);
    expect(afterNewRevision).not.toBe(before);

    // revision 2로 넘어간 뒤에는 revision 1 캐시가 더 이상 유효하지 않다(통째로 비워짐) -
    // revision 1로 다시 요청하면 참조가 달라야 한다(재계산).
    const backToRevision1 = await getCachedFrozenSeriesModel(members, 1, 2020);
    expect(backToRevision1).not.toBe(before);
  });

  it("동시 요청(같은 키)이 들어와도 in-flight Promise를 공유해 중복 계산하지 않는다(single-flight)", async () => {
    __resetRuntimeCacheForTests();
    const [a, b, c] = await Promise.all([
      getCachedFrozenSeriesModel(members, 5, 2020),
      getCachedFrozenSeriesModel(members, 5, 2020),
      getCachedFrozenSeriesModel(members, 5, 2020),
    ]);
    // 세 호출 모두 await 전에 동시에 시작됐는데도 전부 같은 object를 받아야 한다 -
    // single-flight가 없다면 서로 다른 buildFrozenSeriesModel() 결과(다른 reference)를 받는다.
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("__resetRuntimeCacheForTests 이후에는 같은 키라도 다시 계산한다", async () => {
    const a = await getCachedFrozenSeriesModel(members, 1, 2020);
    __resetRuntimeCacheForTests();
    const b = await getCachedFrozenSeriesModel(members, 1, 2020);
    expect(a).not.toBe(b);
  });

  it("getRuntimeCacheStats가 캐시 상태를 반영한다", async () => {
    expect(getRuntimeCacheStats().modelResolvedCutoffs).toEqual([]);
    await getCachedFrozenSeriesModel(members, 1, 2020);
    await getCachedFrozenSeriesModel(members, 1, 2027);
    const stats = getRuntimeCacheStats();
    expect(stats.modelRevision).toBe(1);
    expect(stats.modelResolvedCutoffs.sort()).toEqual([2019, 2026]);
    expect(stats.modelInFlightCount).toBe(0);
  });
});

/**
 * PHASE 9C-A.1 pre-commit hardening 1절 — revision이 바뀌면 이전 revision의 Map/snapshot을
 * "다시 안 쓴다" 정도가 아니라 실제로 module-level 변수 참조 자체를 통째로 버리는지(=이전
 * revision이 몇 개를 거쳐가든 활성 캐시는 항상 현재 revision 1개분만 남는지) 확인한다.
 * recordsCache/modelCache가 Map<revision, ...>가 아니라 단일 변수라서, revision이 바뀌면
 * `ensureRevision`이 그 변수를 통째로 null로 덮어써 이전 객체(Map 포함)가 더 이상 어디서도
 * 참조되지 않게 만든다 - 그래서 오래된 revision이 프로세스 생애주기 동안 계속 쌓이지 않는다.
 */
describe("revision cache lifecycle - 누적 방지", () => {
  const members = [rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제" })].map((r) => ({
    ...r,
    budgetQualityFlag: "VALID" as const,
  }));

  beforeEach(() => {
    __resetRuntimeCacheForTests();
  });

  it("revision을 여러 번 바꿔가며 호출해도 활성 캐시는 항상 현재 revision 1개분만 남는다(누적 없음)", async () => {
    for (let revision = 1; revision <= 20; revision++) {
      await getCachedFrozenSeriesModel(members, revision, 2020);
      const stats = getRuntimeCacheStats();
      // 매 revision마다 "현재 revision" 하나만 active해야 한다 - 과거 19개 revision의 흔적이
      // 전혀 없어야 한다(Map 크기가 revision 수만큼 계속 커지면 안 됨).
      // members의 유일한 record가 2017년이라 effectiveTrainingThroughYear(2020, 2017)=2017.
      expect(stats.modelRevision).toBe(revision);
      expect(stats.modelResolvedCutoffs).toEqual([2017]);
    }
  });

  it("이전 revision으로 되돌아가면 재사용이 아니라 완전히 새로 빌드한다(과거 상태가 어딘가 남아있다가 재사용되지 않음)", async () => {
    const rev1First = await getCachedFrozenSeriesModel(members, 1, 2020);
    await getCachedFrozenSeriesModel(members, 2, 2020); // revision=1 캐시를 완전히 버림
    await getCachedFrozenSeriesModel(members, 3, 2020); // revision=2도 완전히 버림
    const rev1Again = await getCachedFrozenSeriesModel(members, 1, 2020); // revision=1로 복귀
    expect(rev1Again).not.toBe(rev1First); // 예전 revision=1 객체가 어딘가 캐시돼 있다가 재사용된 게 아니라 새로 빌드됨
    expect(getRuntimeCacheStats().modelRevision).toBe(1);
  });
});

/**
 * PHASE 9C-A.1 pre-commit hardening 2절 — old revision의 build가 아직 진행 중일 때 new
 * revision이 활성화되면, old build가 나중에 완료돼도 current(new revision) 캐시를 오염시키지
 * 않아야 한다. getCachedFrozenSeriesModel은 함수 진입 시점의 모듈 상태(state)를 지역 변수로
 * 캡처해 두므로, 그 이후 함수 바깥에서 modelCache가 다른 객체로 교체돼도 이 함수는 여전히
 * "자기가 시작할 때 캡처했던(이제는 고아가 된) old 객체"에만 쓴다 - current 캐시 변수는 건드리지
 * 않는다. 이 특성을 실제 레이스 상황(첫 번째 호출을 await하기 전에 두 번째 호출을 먼저 실행)으로
 * 재현해서 검증한다.
 */
describe("stale in-flight 방어 - old revision 완료가 current 캐시를 오염시키지 않음", () => {
  const members = [rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제" })].map((r) => ({
    ...r,
    budgetQualityFlag: "VALID" as const,
  }));

  beforeEach(() => {
    __resetRuntimeCacheForTests();
  });

  it("revision=1 build가 아직 안 끝난 채로 revision=2가 활성화된 뒤, revision=1 build가 뒤늦게 끝나도 revision=2 캐시는 그대로다", async () => {
    // 두 호출 모두 await하지 않고 먼저 시작만 시킨다(자바스크립트는 async 함수를 첫 await까지
    // 동기 실행하므로, promise1이 자기 await 지점에서 양보한 바로 그 순간에 promise2가 이어서
    // 시작되며 ensureRevision(2)가 modelCache를 통째로 교체한다).
    const promise1 = getCachedFrozenSeriesModel(members, 1, 2020);
    const promise2 = getCachedFrozenSeriesModel(members, 2, 2020);

    const [model1, model2] = await Promise.all([promise1, promise2]);

    // 둘 다 정상적으로(오염 없이) 빌드된 유효한 모델이어야 한다.
    expect(model1.groupsById.size).toBeGreaterThan(0);
    expect(model2.groupsById.size).toBeGreaterThan(0);

    // 최종 활성 캐시는 나중에 활성화된 revision=2여야 하고, revision=1 build가 뒤늦게 끝난 것이
    // 이를 되돌리지 않는다.
    const stats = getRuntimeCacheStats();
    expect(stats.modelRevision).toBe(2);

    // revision=1로 다시 요청하면(오염된 캐시를 재사용하는 게 아니라) 정상적으로 다시 빌드된다.
    const model1Again = await getCachedFrozenSeriesModel(members, 1, 2020);
    expect(model1Again.groupsById.size).toBeGreaterThan(0);
  });
});

/**
 * PHASE 19-A — getCachedVolatilityThreshold도 getCachedFrozenSeriesModel과 완전히 동일한
 * (revision, effectiveTrainingThroughYear) 키/single-flight/invalidation 계약을 따르는지 좁게
 * 확인한다(계산 결과 자체의 leakage-safety는 reliability.test.ts가 검증한다 - 여기서는 "캐시가
 * 언제 재사용되고 언제 재계산되는지"만 본다).
 */
describe("getCachedVolatilityThreshold - hit/miss/invalidation", () => {
  const members = [
    rec({ id: 1, datasetYear: 2017, festivalName: "가나다축제", budgetKrw: 100_000_000 }),
    rec({ id: 2, datasetYear: 2018, festivalName: "제2회 가나다축제", budgetKrw: 200_000_000 }),
    rec({ id: 3, datasetYear: 2019, festivalName: "제3회 가나다축제", budgetKrw: 300_000_000 }),
  ].map((r) => ({ ...r, budgetQualityFlag: "VALID" as const }));

  beforeEach(() => {
    __resetRuntimeCacheForTests();
  });

  it("같은 (revision, planningYear)로 두 번 호출하면 동일 object reference를 반환한다(재계산 안 함)", async () => {
    const a = await getCachedVolatilityThreshold(members, 1, 2020);
    const b = await getCachedVolatilityThreshold(members, 1, 2020);
    expect(a).toBe(b);
  });

  it("다른 planningYear라도 effectiveTrainingThroughYear가 같으면(포화 구간) 같은 결과를 공유한다", async () => {
    const a = await getCachedVolatilityThreshold(members, 1, 2027); // cutoff=2019(최대 datasetYear)
    const b = await getCachedVolatilityThreshold(members, 1, 2028);
    expect(a).toBe(b);
  });

  it("effectiveTrainingThroughYear가 다르면 다른 결과를 새로 계산한다", async () => {
    const a = await getCachedVolatilityThreshold(members, 1, 2019); // cutoff=2018
    const b = await getCachedVolatilityThreshold(members, 1, 2027); // cutoff=2019
    expect(a).not.toBe(b);
  });

  it("dataRevision이 바뀌면 이전 캐시를 버리고 새로 계산한다", async () => {
    const before = await getCachedVolatilityThreshold(members, 1, 2020);
    const afterNewRevision = await getCachedVolatilityThreshold(members, 2, 2020);
    expect(afterNewRevision).not.toBe(before);
    const backToRevision1 = await getCachedVolatilityThreshold(members, 1, 2020);
    expect(backToRevision1).not.toBe(before);
  });

  it("동시 요청(같은 키)이 들어와도 single-flight로 중복 계산하지 않는다", async () => {
    const [a, b, c] = await Promise.all([
      getCachedVolatilityThreshold(members, 5, 2020),
      getCachedVolatilityThreshold(members, 5, 2020),
      getCachedVolatilityThreshold(members, 5, 2020),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("getRuntimeCacheStats가 threshold 캐시 상태도 반영한다", async () => {
    expect(getRuntimeCacheStats().thresholdResolvedCutoffs).toEqual([]);
    await getCachedVolatilityThreshold(members, 1, 2020);
    const stats = getRuntimeCacheStats();
    expect(stats.thresholdRevision).toBe(1);
    expect(stats.thresholdResolvedCutoffs).toEqual([2019]);
    expect(stats.thresholdInFlightCount).toBe(0);
  });

  it("modelCache와 thresholdCache는 서로 독립적으로 무효화되지 않는다(같은 revision 전환에 함께 반응)", async () => {
    await getCachedFrozenSeriesModel(members, 1, 2020);
    await getCachedVolatilityThreshold(members, 1, 2020);
    let stats = getRuntimeCacheStats();
    expect(stats.modelRevision).toBe(1);
    expect(stats.thresholdRevision).toBe(1);

    await getCachedVolatilityThreshold(members, 2, 2020); // revision 변경은 threshold 호출을 통해서도 전체 캐시를 무효화한다
    stats = getRuntimeCacheStats();
    expect(stats.modelRevision).toBeNull(); // revision 2로 넘어가며 modelCache도 함께 버려짐(ensureRevision)
    expect(stats.thresholdRevision).toBe(2);
  });
});
