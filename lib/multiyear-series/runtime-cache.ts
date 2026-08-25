import { PrismaClient } from "@/lib/generated/prisma";
import { buildSeriesTrainingPool } from "./fold";
import { loadAllSeriesRecords, SeriesRecordWithQuality } from "./record-loader";
import { computeLeakageSafeVolatilityThreshold, VolatilityThresholdResult } from "./reliability";
import { buildFrozenSeriesModel } from "./series-linker";
import { FrozenSeriesModel } from "./types";

/**
 * PHASE 9C-A.1 — process-local(단일 Node 프로세스 메모리) 캐시. Redis 등 외부 캐시나 persisted
 * table은 전혀 쓰지 않는다. 알고리즘/scoring/threshold "규칙" 자체는 이 파일이 절대 건드리지
 * 않는다 - 캐시가 없을 때와 정확히 같은 {@link buildSeriesTrainingPool}/{@link buildFrozenSeriesModel}
 * (PHASE 19-A부터는 {@link computeLeakageSafeVolatilityThreshold}도) 호출 결과를 그대로
 * 재사용/저장만 한다 - "이 결과를 어떻게 계산하는가"는 여전히 `series-linker.ts`/`reliability.ts`의
 * 몫이고, 이 파일은 "언제 다시 계산할지"만 결정한다.
 *
 * 캐시 키는 planningYear가 아니라 (dataRevision, effectiveTrainingThroughYear)다 - 보유 데이터의
 * 최댓값(예: 2026)보다 planningYear가 더 미래(2027/2028/2030...)여도 trainingPool은 더 이상
 * 늘어나지 않으므로(포화) 전부 같은 모델을 공유한다.
 *
 * <p><b>배포 환경 제약(중요)</b>: 이 저장소에는 vercel.json/Dockerfile/serverless 관련 설정이나
 * CI 배포 워크플로가 없고, `package.json`의 `start` 스크립트도 `next start`(장수 프로세스 전제)
 * 뿐이다 - 즉 이 캐시가 "실제로 여러 요청에 걸쳐 살아남는 하나의 Node 프로세스" 위에서 도는지,
 * 아니면 요청마다(혹은 매우 자주) 새 프로세스/인스턴스가 뜨는 serverless 환경에서 도는지가
 * 이 저장소 설정만으로는 확정되지 않는다. 이 캐시는 어디까지나 **process-local, per-instance
 * best-effort**다 - serverless cold start(또는 인스턴스 재시작/스케일아웃)마다 이 모듈의
 * module-level 변수가 초기화되므로, 그 시점의 첫 series 요청은 다시 ~2.6~3.5초 cold 비용을
 * 그대로 치른다. Redis 등 프로세스 밖 공유 캐시는 이번 Phase에서 의도적으로 도입하지 않았다
 * (금지 항목) - 실제 배포 환경이 짧게 재활용되는 serverless라면 이 최적화의 체감 효과가
 * 제한적일 수 있다는 뜻이고, 그 경우 별도 Phase에서 공유 캐시 도입을 검토해야 한다.</p>
 */

interface RecordsCacheEntry {
  revision: number;
  promise: Promise<SeriesRecordWithQuality[]>;
}
let recordsCache: RecordsCacheEntry | null = null;

interface ModelCacheState {
  revision: number;
  resolved: Map<number, FrozenSeriesModel>; // key = effectiveTrainingThroughYear
  inFlight: Map<number, Promise<FrozenSeriesModel>>;
}
let modelCache: ModelCacheState | null = null;

/** PHASE 19-A - {@link computeLeakageSafeVolatilityThreshold}는 연도 수만큼 FrozenSeriesModel을
 *  다시 만드는 무거운 계산이라 modelCache와 동일한 (revision, cutoff) 키 방식으로 별도 캐싱한다. */
interface ThresholdCacheState {
  revision: number;
  resolved: Map<number, VolatilityThresholdResult>; // key = effectiveTrainingThroughYear
  inFlight: Map<number, Promise<VolatilityThresholdResult>>;
}
let thresholdCache: ThresholdCacheState | null = null;

function ensureRevision(revision: number) {
  if (recordsCache !== null && recordsCache.revision !== revision) {
    recordsCache = null;
  }
  if (modelCache !== null && modelCache.revision !== revision) {
    modelCache = null;
  }
  if (thresholdCache !== null && thresholdCache.revision !== revision) {
    thresholdCache = null;
  }
}

/**
 * 이 revision의 {@link SeriesRecordWithQuality}[] 스냅샷 - 동시에 여러 요청이 들어와도 DB 쿼리는
 * 1번만 나간다(같은 in-flight Promise를 공유하는 single-flight). revision이 바뀌면(새 import)
 * 자동으로 캐시가 버려지고 다음 요청이 새로 로드한다.
 */
export function getCachedSeriesRecords(prisma: PrismaClient, revision: number): Promise<SeriesRecordWithQuality[]> {
  ensureRevision(revision);
  if (recordsCache === null) {
    recordsCache = { revision, promise: loadAllSeriesRecords(prisma) };
  }
  return recordsCache.promise;
}

/**
 * planningYear를 "실제로 trainingPool 구성에 영향을 주는 마지막 datasetYear"로 정규화한다.
 * buildSeriesTrainingPool은 `datasetYear < targetYear`만 남기므로, planningYear가 보유 데이터의
 * 최댓값보다 크면(예: 2027~2030) 어차피 전체 데이터가 다 포함돼 결과가 똑같다.
 */
export function effectiveTrainingThroughYear(planningYear: number, maxAvailableDatasetYear: number): number {
  return Math.min(planningYear - 1, maxAvailableDatasetYear);
}

/**
 * (dataRevision, effectiveTrainingThroughYear) 단위로 {@link FrozenSeriesModel}을 캐시한다 -
 * festivalName/target과 완전히 무관하다(모델 자체가 target을 포함하지 않으므로 같은 cutoff라면
 * 어떤 festivalName으로 조회하든 항상 같은 모델을 재사용할 수 있다). 동일 키에 대해 동시에 여러
 * 요청이 들어오면 in-flight Promise를 공유해 buildFrozenSeriesModel을 중복 실행하지 않는다.
 */
export async function getCachedFrozenSeriesModel(
  allSeriesRecords: SeriesRecordWithQuality[],
  revision: number,
  planningYear: number
): Promise<FrozenSeriesModel> {
  ensureRevision(revision);
  if (modelCache === null) {
    modelCache = { revision, resolved: new Map(), inFlight: new Map() };
  }
  const state = modelCache;

  const maxAvailableDatasetYear = allSeriesRecords.reduce((max, r) => Math.max(max, r.datasetYear), -Infinity);
  const cutoff = effectiveTrainingThroughYear(planningYear, maxAvailableDatasetYear);

  const cached = state.resolved.get(cutoff);
  if (cached) return cached;

  let buildPromise = state.inFlight.get(cutoff);
  if (!buildPromise) {
    // cutoff는 "실제로 포함되는 마지막 연도"이므로, buildSeriesTrainingPool의
    // `datasetYear < targetYear` 기준과 맞추려면 targetYear = cutoff+1을 넘겨야 원래
    // planningYear로 직접 호출했을 때와 정확히 같은 필터 결과가 나온다.
    //
    // 순서가 중요하다: inFlight.set()이 항상 build 시작 직후·완료 전에 먼저 실행되도록
    // build 자체를 별도 IIFE로 감싸 promise 변수에 담고, resolved.set()/inFlight.delete()는
    // 그 promise를 만든 "다음" 문장에서(= 반드시 나중에) 실행한다. (buildFrozenSeriesModel이
    // 지금은 순수 동기 함수라 실제 경쟁이 생기지 않지만, "set이 delete보다 먼저"라는 불변식을
    // 텍스트 순서 그대로 보장해 두면 나중에 이 계산이 비동기로 바뀌어도(예: worker thread)
    // 깨지지 않는다.)
    buildPromise = (async () => {
      const { trainingPool } = buildSeriesTrainingPool(allSeriesRecords, cutoff + 1);
      return buildFrozenSeriesModel(trainingPool);
    })();
    state.inFlight.set(cutoff, buildPromise);
  }

  const model = await buildPromise;
  state.resolved.set(cutoff, model);
  state.inFlight.delete(cutoff);
  return model;
}

/**
 * PHASE 19-A - (dataRevision, effectiveTrainingThroughYear) 단위로 leakage-safe volatility
 * threshold(Phase 18-B Part 6/`reliability.ts`)를 캐시한다. `getCachedFrozenSeriesModel`과
 * 완전히 동일한 정규화(cutoff)/single-flight 패턴을 쓴다 - planningYear가 보유 데이터 최댓값보다
 * 미래여도(2027, 2030...) 같은 cutoff를 공유해 캐시가 saturate된다.
 */
export async function getCachedVolatilityThreshold(
  allSeriesRecords: SeriesRecordWithQuality[],
  revision: number,
  planningYear: number
): Promise<VolatilityThresholdResult> {
  ensureRevision(revision);
  if (thresholdCache === null) {
    thresholdCache = { revision, resolved: new Map(), inFlight: new Map() };
  }
  const state = thresholdCache;

  const maxAvailableDatasetYear = allSeriesRecords.reduce((max, r) => Math.max(max, r.datasetYear), -Infinity);
  const cutoff = effectiveTrainingThroughYear(planningYear, maxAvailableDatasetYear);

  const cached = state.resolved.get(cutoff);
  if (cached) return cached;

  let buildPromise = state.inFlight.get(cutoff);
  if (!buildPromise) {
    // cutoff+1을 넘겨야 computeLeakageSafeVolatilityThreshold의 `yh < planningYear` 기준이
    // 원래 planningYear로 직접 불렀을 때와 정확히 같은 연도 범위를 순회한다(getCachedFrozenSeriesModel과
    // 동일한 이유).
    buildPromise = (async () => computeLeakageSafeVolatilityThreshold(allSeriesRecords, cutoff + 1))();
    state.inFlight.set(cutoff, buildPromise);
  }

  const result = await buildPromise;
  state.resolved.set(cutoff, result);
  state.inFlight.delete(cutoff);
  return result;
}

/** 테스트 전용 - 모듈 레벨 캐시 상태를 초기화한다(vitest 격리용). production 코드는 호출하지 않는다. */
export function __resetRuntimeCacheForTests() {
  recordsCache = null;
  modelCache = null;
  thresholdCache = null;
}

/** 진단/보고용 - 캐시 크기(메모리 사용량 추정에 참고), production 로직에서는 안 쓴다. */
export function getRuntimeCacheStats() {
  return {
    recordsCached: recordsCache !== null,
    recordsRevision: recordsCache?.revision ?? null,
    modelRevision: modelCache?.revision ?? null,
    modelResolvedCutoffs: modelCache ? [...modelCache.resolved.keys()] : [],
    modelInFlightCount: modelCache?.inFlight.size ?? 0,
    thresholdRevision: thresholdCache?.revision ?? null,
    thresholdResolvedCutoffs: thresholdCache ? [...thresholdCache.resolved.keys()] : [],
    thresholdInFlightCount: thresholdCache?.inFlight.size ?? 0,
  };
}
