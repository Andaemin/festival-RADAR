import { normalizeFestivalName, fuzzyKey } from "./festival-name-normalizer";
import { levenshteinRatio } from "./levenshtein-similarity";
import {
  bucketKeyString,
  CHAIN_CLUSTER_MIN_SIMILARITY,
  CHAIN_EDGE_MAX_YEAR_GAP,
  CHAIN_EDGE_MIN_NAME_SIMILARITY,
  clusterKeyOf,
  clusterKeyString,
  hasYearOverlap,
  makeScoreCluster,
  resolveDistrictKey,
  score,
  ScoreCluster,
  ScoredCandidate,
  trimmedEquals,
} from "./scoring";
import { FrozenSeriesGroup, FrozenSeriesModel, MatchMethod, resolveRegionKey, SeriesRecordLite } from "./types";

/**
 * PHASE 9B-1 — Spring `FestivalSeriesLinkingService.computeSeriesGroupsInMemory`/
 * `linkAll`(결정적 클러스터링 + fuzzy HIGH 자동연결 + strict chain linking) 파이프라인의
 * TypeScript 1:1 포팅이다. `buildFrozenSeriesModel`은 Spring의
 * `buildFrozenSeriesModel`(Phase 9A EXPERIMENTAL로 Spring에 추가한 메서드)과 동일한 산출물을
 * 만든다 - training pool만 입력으로 받고, target을 절대 포함하지 않는다(series lookup은
 * `series-lookup.ts`가 별도로 담당).
 *
 * threshold/공식은 `scoring.ts`에 있고 이 파일에서 재정의하지 않는다.
 */

// ------------------------------------------------------------------
// union-find (preference: 다행 클러스터 우선, 그다음 이른 연도 우선 -> 결정적 결과)
// ------------------------------------------------------------------

class UnionFind {
  private parent: number[];
  constructor(private clusters: ScoreCluster[]) {
    this.parent = clusters.map((_, i) => i);
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.preferred(ra, rb) === ra) {
      this.parent[rb] = ra;
    } else {
      this.parent[ra] = rb;
    }
  }

  private preferred(a: number, b: number): number {
    const ca = this.clusters[a];
    const cb = this.clusters[b];
    if (ca.members.length !== cb.members.length) {
      return ca.members.length > cb.members.length ? a : b;
    }
    if (ca.firstYear !== cb.firstYear) {
      return ca.firstYear < cb.firstYear ? a : b;
    }
    return a < b ? a : b;
  }
}

// ------------------------------------------------------------------
// 1) 결정적 클러스터링
// ------------------------------------------------------------------

function computeModalRawName(members: SeriesRecordLite[]): string {
  const counts = new Map<string, number>();
  for (const r of members) {
    const key = r.festivalName.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = -1;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best!;
}

function buildDeterministicClusters(sorted: SeriesRecordLite[]): ScoreCluster[] {
  const grouped = new Map<string, SeriesRecordLite[]>();
  const keyByGroupKey = new Map<string, ReturnType<typeof clusterKeyOf>>();
  for (const r of sorted) {
    const key = clusterKeyOf(r);
    const groupKey = clusterKeyString(key);
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
      keyByGroupKey.set(groupKey, key);
    }
    grouped.get(groupKey)!.push(r);
  }

  const clusters: ScoreCluster[] = [];
  let idx = 0;
  for (const [groupKey, members] of grouped) {
    clusters.push(makeScoreCluster(idx++, keyByGroupKey.get(groupKey)!, members));
  }
  return clusters;
}

// ------------------------------------------------------------------
// 2) fuzzy 매칭
// ------------------------------------------------------------------

interface AppliedUnion {
  singletonClusterIndex: number;
  targetClusterIndex: number;
  score: number;
}

function runFuzzyMatching(clusters: ScoreCluster[], uf: UnionFind): { candidates: ScoredCandidate[]; appliedUnions: AppliedUnion[] } {
  const buckets = new Map<string, ScoreCluster[]>();
  for (const c of clusters) {
    const bk = bucketKeyString(c.key.scope, c.key.regionKey);
    if (!buckets.has(bk)) buckets.set(bk, []);
    buckets.get(bk)!.push(c);
  }

  const allCandidates: ScoredCandidate[] = [];
  const appliedUnions: AppliedUnion[] = [];

  for (const bucket of buckets.values()) {
    const singletons = bucket.filter((c) => c.members.length === 1);
    for (const source of singletons) {
      const forSource: ScoredCandidate[] = [];
      const yearConflictByTargetIndex = new Map<number, boolean>();

      for (const target of bucket) {
        if (target.index === source.index) continue;
        const candidate = score(source, target);
        if (candidate !== null) {
          forSource.push(candidate);
          yearConflictByTargetIndex.set(target.index, hasYearOverlap(source, target));
        }
      }
      forSource.sort((x, y) => y.score - x.score);

      const highEligible = forSource.filter((c) => c.band === "HIGH" && !yearConflictByTargetIndex.get(c.targetClusterIndex));
      const applied = highEligible.length === 1 ? highEligible[0] : null;

      for (const c of forSource) {
        allCandidates.push({ ...c, applied: applied !== null && c === applied });
      }

      if (applied !== null) {
        uf.union(source.index, applied.targetClusterIndex);
        appliedUnions.push({ singletonClusterIndex: source.index, targetClusterIndex: applied.targetClusterIndex, score: applied.score });
      }
    }
  }

  return { candidates: allCandidates, appliedUnions };
}

// ------------------------------------------------------------------
// 3) union-find 결과 -> 최종 series 빌드
// ------------------------------------------------------------------

interface SeriesBuild {
  anchor: ScoreCluster;
  originalClusters: ScoreCluster[];
  allMembers: SeriesRecordLite[];
  firstYear: number;
  lastYear: number;
}

function buildFinalSeries(clusters: ScoreCluster[], uf: UnionFind): SeriesBuild[] {
  const byRoot = new Map<number, ScoreCluster[]>();
  for (const c of clusters) {
    const root = uf.find(c.index);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root)!.push(c);
  }

  const builds: SeriesBuild[] = [];
  for (const [rootIndex, originalClusters] of byRoot) {
    const anchor = clusters[rootIndex];
    const allMembers: SeriesRecordLite[] = [];
    for (const c of originalClusters) allMembers.push(...c.members);
    allMembers.sort((a, b) => (a.datasetYear !== b.datasetYear ? a.datasetYear - b.datasetYear : a.id - b.id));

    const years = allMembers.map((m) => m.datasetYear);
    builds.push({ anchor, originalClusters, allMembers, firstYear: Math.min(...years), lastYear: Math.max(...years) });
  }
  return builds;
}

// ------------------------------------------------------------------
// 4) strict chain linking
// ------------------------------------------------------------------

interface PairwiseCheck {
  minPairwiseSimilarity: number;
  typeConflict: boolean;
  districtConflict: boolean;
  duplicateYear: boolean;
}

function fullPairwiseCheck(members: SeriesRecordLite[]): PairwiseCheck {
  const similarities: number[] = [];
  let typeConflict = false;
  let districtConflict = false;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const ra = members[i];
      const rb = members[j];
      const ka = fuzzyKey(normalizeFestivalName(ra.festivalName));
      const kb = fuzzyKey(normalizeFestivalName(rb.festivalName));
      similarities.push(levenshteinRatio(ka, kb));

      const da = resolveDistrictKey(ra);
      const db = resolveDistrictKey(rb);
      if (da !== null && db !== null && da !== db) districtConflict = true;

      const typesA = ra.typeTokensRaw;
      const typesB = rb.typeTokensRaw;
      if (typesA.size > 0 && typesB.size > 0) {
        let overlap = false;
        for (const t of typesA) {
          if (typesB.has(t)) {
            overlap = true;
            break;
          }
        }
        if (!overlap) typeConflict = true;
      }
    }
  }
  const duplicateYear = new Set(members.map((m) => m.datasetYear)).size < members.length;
  const min = similarities.length > 0 ? Math.min(...similarities) : 0.0;
  return { minPairwiseSimilarity: min, typeConflict, districtConflict, duplicateYear };
}

function pickAnchor(members: SeriesRecordLite[]): SeriesRecordLite {
  return members.reduce((best, r) =>
    r.datasetYear < best.datasetYear || (r.datasetYear === best.datasetYear && r.id < best.id) ? r : best
  );
}

function strictChainEdge(a: ScoreCluster, b: ScoreCluster): boolean {
  const candidate = score(a, b);
  if (candidate === null || candidate.band !== "HIGH") return false;
  if (candidate.nameSimilarity < CHAIN_EDGE_MIN_NAME_SIMILARITY) return false;
  if (candidate.districtSignal < 0 || candidate.typeSignal < 0) return false;
  if (Math.abs(a.firstYear - b.firstYear) > CHAIN_EDGE_MAX_YEAR_GAP) return false;
  return true;
}

interface ChainComponentResult {
  members: SeriesRecordLite[];
  applied: boolean;
}

function computeChainComponents(unmatchedRecords: SeriesRecordLite[]): ChainComponentResult[] {
  const pool: ScoreCluster[] = unmatchedRecords.map((r, i) => makeScoreCluster(i, clusterKeyOf(r), [r]));

  const buckets = new Map<string, ScoreCluster[]>();
  for (const c of pool) {
    const bk = bucketKeyString(c.key.scope, c.key.regionKey);
    if (!buckets.has(bk)) buckets.set(bk, []);
    buckets.get(bk)!.push(c);
  }

  const chainUf = new UnionFind(pool);
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        if (strictChainEdge(bucket[i], bucket[j])) {
          chainUf.union(bucket[i].index, bucket[j].index);
        }
      }
    }
  }

  const byRoot = new Map<number, ScoreCluster[]>();
  for (const c of pool) {
    const root = chainUf.find(c.index);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root)!.push(c);
  }

  const results: ChainComponentResult[] = [];
  for (const component of byRoot.values()) {
    if (component.length < 2) continue; // strict edge가 하나도 없어 혼자 남음
    const members = component.map((c) => c.members[0]);
    const check = fullPairwiseCheck(members);
    const applied = check.minPairwiseSimilarity >= CHAIN_CLUSTER_MIN_SIMILARITY && !check.typeConflict && !check.districtConflict && !check.duplicateYear;
    results.push({ members, applied });
  }
  return results;
}

// ------------------------------------------------------------------
// 5) 다인원 cluster 간 안전한 병합 (기존 파이프라인의 사각지대 보완)
// ------------------------------------------------------------------
// 위 1~4단계(runFuzzyMatching)는 singleton(이력 1건)만 다른 cluster에 흡수시킨다 - 이미 이력
// 2건 이상인 cluster끼리는 서로 한 번도 비교되지 않는다. 그래서 "가나다축제"/"가나다 축제"처럼
// 띄어쓰기만 다른 표기가 각각 독립적으로 2건 이상의 이력을 쌓으면 영구히 분리된 채로 남는다
// (research-series-merge-impact.md 참고 - 실제 leakage-safe backtest에서 이 사각지대 때문에
// 나뉘어 있던 이력을 안전하게 합치면 Estimate MdAPE 20.63%→20.21% 개선을 확인했다).
//
// 이 단계는 그 사각지대만 메운다 - 기존 1~4단계는 한 글자도 건드리지 않고, 그 출력(groupsById/
// groupIdByRecordId)에 대해서만 추가로 동작한다. score()/HIGH_THRESHOLD 등 기존 판정식도
// 그대로 재사용한다 - 다만 다인원 cluster 병합은 한 번 잘못 합치면 영향 범위가 singleton보다
// 훨씬 크므로, 이름 유사도 기준을 기존 HIGH band floor(0.90)보다 훨씬 보수적인 0.999(사실상
// 띄어쓰기 등 표기 차이만 허용)로 제한한다.
export const MULTI_MEMBER_MERGE_MIN_NAME_SIMILARITY = 0.999;

function groupToScoreCluster(g: FrozenSeriesGroup): ScoreCluster {
  return {
    index: g.groupId,
    key: { scope: g.scope, regionKey: g.canonicalRegion, districtKey: g.canonicalDistrict, normalizedName: g.canonicalName },
    members: g.members,
    firstYear: g.firstObservedYear,
    lastYear: g.lastObservedYear,
  };
}

/** union 시 "대표(canonicalName/district 등)로 남길 원본 group"을 고르는 결정적 tie-break -
 *  UnionFind.preferred()와 동일한 정책(이력 많은 쪽 -> 이른 연도 -> 낮은 id)을 group에 적용. */
function preferGroup(a: FrozenSeriesGroup, b: FrozenSeriesGroup): FrozenSeriesGroup {
  if (a.members.length !== b.members.length) return a.members.length > b.members.length ? a : b;
  if (a.firstObservedYear !== b.firstObservedYear) return a.firstObservedYear < b.firstObservedYear ? a : b;
  return a.groupId < b.groupId ? a : b;
}

function membersShareYear(a: SeriesRecordLite[], b: SeriesRecordLite[]): boolean {
  const yearsA = new Set(a.map((m) => m.datasetYear));
  for (const m of b) if (yearsA.has(m.datasetYear)) return true;
  return false;
}

export interface MultiMemberMergeResult {
  groupsById: Map<number, FrozenSeriesGroup>;
  groupIdByRecordId: Map<number, number>;
  /** 실제로 적용된 union 1건당 1개 항목(감사/테스트용) - survivor에 absorbed가 흡수됨. */
  appliedMerges: { survivingGroupId: number; absorbedGroupIds: number[] }[];
}

/**
 * 이력 2건 이상인 group끼리만 대상으로 한다(이력 1건짜리 singleton은 위 1~4단계가 이미 전담 -
 * 이 단계가 그 판정에 관여하면 기존 ambiguous 판정/회귀 위험이 커지므로 의도적으로 배제한다).
 *
 * 후보를 전부 모은 뒤 한꺼번에 union-find로 묶지 않는다 - **점수가 높은 후보부터 하나씩** union
 * 여부를 확정하면서, 매번 union 직전에 `find()`로 그 시점의 **현재 root**를 다시 조회하고 그
 * root에 지금까지 병합된 모든 구성원의 개최연도를 재검사한다. 예: A(2021,2022)-B(2023)가 먼저
 * 합쳐지면 그다음 C(2022,2024)와의 병합 판정은 "A 하나"가 아니라 "A+B 전체"(2021,2022,2023)를
 * 기준으로 하고, 2022년이 겹치므로 이 union만 차단한다 - A+B는 그대로 유지되고 C만 별도로
 * 남는다(묶음 전체를 버리지 않고 안전한 부분만 최대한 살린다).
 *
 * 후보 정렬은 점수 내림차순(동점이면 groupId 오름차순)이라 입력 배열 순서와 무관하게 항상 같은
 * 결과를 낸다(buildFrozenSeriesModel 호출부의 `sorted` 정렬도 이미 입력 순서 독립적이다).
 */
export function mergeMultiMemberGroups(
  groupsById: ReadonlyMap<number, FrozenSeriesGroup>,
  groupIdByRecordId: ReadonlyMap<number, number>
): MultiMemberMergeResult {
  const groups = [...groupsById.values()].filter((g) => g.members.length >= 2);

  const buckets = new Map<string, FrozenSeriesGroup[]>();
  for (const g of groups) {
    const bk = bucketKeyString(g.scope, g.canonicalRegion);
    if (!buckets.has(bk)) buckets.set(bk, []);
    buckets.get(bk)!.push(g);
  }

  interface Candidate {
    groupA: number;
    groupB: number;
    score: number;
  }
  const candidates: Candidate[] = [];
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const gA = bucket[i];
        const gB = bucket[j];
        const candidate = score(groupToScoreCluster(gA), groupToScoreCluster(gB));
        if (!candidate) continue;
        if (candidate.nameSimilarity < MULTI_MEMBER_MERGE_MIN_NAME_SIMILARITY) continue;
        if (candidate.band !== "HIGH") continue;
        candidates.push({ groupA: gA.groupId, groupB: gB.groupId, score: candidate.score });
      }
    }
  }
  candidates.sort((x, y) => (y.score !== x.score ? y.score - x.score : x.groupA !== y.groupA ? x.groupA - y.groupA : x.groupB - y.groupB));

  const parent = new Map<number, number>();
  for (const g of groups) parent.set(g.groupId, g.groupId);
  function find(x: number): number {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }

  const rootMembers = new Map<number, SeriesRecordLite[]>();
  const rootOriginalGroupIds = new Map<number, number[]>();
  for (const g of groups) {
    rootMembers.set(g.groupId, g.members);
    rootOriginalGroupIds.set(g.groupId, [g.groupId]);
  }

  const appliedMerges: MultiMemberMergeResult["appliedMerges"] = [];

  for (const cand of candidates) {
    const rootA = find(cand.groupA);
    const rootB = find(cand.groupB);
    if (rootA === rootB) continue; // 이미 같은 cluster로 병합됨(또는 재평가) - 다시 합칠 필요 없음

    const membersA = rootMembers.get(rootA)!;
    const membersB = rootMembers.get(rootB)!;
    if (membersShareYear(membersA, membersB)) continue; // 지금까지 병합된 전체 연도 기준 재검사

    const sizeA = membersA.length;
    const sizeB = membersB.length;
    const firstYearA = Math.min(...membersA.map((m) => m.datasetYear));
    const firstYearB = Math.min(...membersB.map((m) => m.datasetYear));
    let survivor = rootA;
    let absorbed = rootB;
    if (sizeB > sizeA || (sizeB === sizeA && (firstYearB < firstYearA || (firstYearB === firstYearA && rootB < rootA)))) {
      survivor = rootB;
      absorbed = rootA;
    }
    parent.set(absorbed, survivor);
    rootMembers.set(survivor, [...membersA, ...membersB]);
    rootMembers.delete(absorbed);
    rootOriginalGroupIds.set(survivor, [...rootOriginalGroupIds.get(rootA)!, ...rootOriginalGroupIds.get(rootB)!]);
    rootOriginalGroupIds.delete(absorbed);
    appliedMerges.push({ survivingGroupId: survivor, absorbedGroupIds: [absorbed] });
  }

  const newGroupsById = new Map<number, FrozenSeriesGroup>(groupsById);
  const newGroupIdByRecordId = new Map<number, number>(groupIdByRecordId);

  const finalRoots = new Set<number>();
  for (const g of groups) finalRoots.add(find(g.groupId));

  for (const rootId of finalRoots) {
    const constituentIds = rootOriginalGroupIds.get(rootId)!;
    if (constituentIds.length === 1) continue; // 병합 없음 - 원본 group 그대로 유지

    const constituentGroups = constituentIds.map((id) => groupsById.get(id)!);
    for (const id of constituentIds) if (id !== rootId) newGroupsById.delete(id);
    const anchor = constituentGroups.reduce((best, g) => preferGroup(best, g));
    const allMembers = [...rootMembers.get(rootId)!].sort((a, b) => (a.datasetYear !== b.datasetYear ? a.datasetYear - b.datasetYear : a.id - b.id));
    const merged: FrozenSeriesGroup = {
      groupId: rootId,
      canonicalName: computeModalRawName(allMembers),
      scope: anchor.scope,
      canonicalRegion: anchor.canonicalRegion,
      canonicalDistrict: anchor.canonicalDistrict,
      firstObservedYear: Math.min(...constituentGroups.map((g) => g.firstObservedYear)),
      lastObservedYear: Math.max(...constituentGroups.map((g) => g.lastObservedYear)),
      members: allMembers,
    };
    newGroupsById.set(rootId, merged);
    for (const m of allMembers) newGroupIdByRecordId.set(m.id, rootId);
  }

  return { groupsById: newGroupsById, groupIdByRecordId: newGroupIdByRecordId, appliedMerges };
}

// ------------------------------------------------------------------
// 공개 API
// ------------------------------------------------------------------

/**
 * trainingPool만으로 historical series 구조(그리고 각 record의 matchMethod)를 계산한다.
 * Spring `FestivalSeriesLinkingService.buildFrozenSeriesModel`과 동일한 파이프라인.
 */
export function buildFrozenSeriesModel(trainingPool: SeriesRecordLite[]): FrozenSeriesModel {
  const sorted = [...trainingPool].sort((a, b) =>
    a.datasetYear !== b.datasetYear ? a.datasetYear - b.datasetYear : a.sourceRow !== b.sourceRow ? a.sourceRow - b.sourceRow : a.id - b.id
  );

  const clusters = buildDeterministicClusters(sorted);
  const uf = new UnionFind(clusters);
  const { candidates: fuzzyCandidates } = runFuzzyMatching(clusters, uf);
  const builds = buildFinalSeries(clusters, uf);

  const candidatesBySourceRecordId = new Map<number, ScoredCandidate[]>();
  for (const c of fuzzyCandidates) {
    const id = c.sourceRecord.id;
    if (!candidatesBySourceRecordId.has(id)) candidatesBySourceRecordId.set(id, []);
    candidatesBySourceRecordId.get(id)!.push(c);
  }

  const groupIdByRecordId = new Map<number, number>();
  const matchMethodByRecordId = new Map<number, MatchMethod>();
  const groupsById = new Map<number, FrozenSeriesGroup>();
  const unmatchedRecords: SeriesRecordLite[] = [];
  let nextId = 1;

  for (const build of builds) {
    const groupId = nextId++;
    for (const c of build.originalClusters) {
      if (c.members.length >= 2) {
        const modalRawName = computeModalRawName(c.members);
        for (const r of c.members) {
          matchMethodByRecordId.set(r.id, trimmedEquals(r.festivalName, modalRawName) ? "EXACT" : "NORMALIZED_EXACT");
        }
      } else {
        const only = c.members[0];
        const method: MatchMethod = build.originalClusters.length > 1 ? "FUZZY" : "UNMATCHED";
        matchMethodByRecordId.set(only.id, method);
        if (method === "UNMATCHED") unmatchedRecords.push(only);
      }
    }
    for (const r of build.allMembers) groupIdByRecordId.set(r.id, groupId);
    groupsById.set(groupId, {
      groupId,
      canonicalName: build.anchor.key.normalizedName,
      scope: build.anchor.key.scope,
      canonicalRegion: build.anchor.key.regionKey,
      canonicalDistrict: build.anchor.key.districtKey,
      firstObservedYear: build.firstYear,
      lastObservedYear: build.lastYear,
      members: build.allMembers,
    });
  }

  // ambiguous(같은 singleton에 서로 다른 series를 가리키는 HIGH 후보가 2개 이상) - chain으로
  // 나중에 실제 병합되면 더 이상 ambiguous로 세지 않는다.
  const ambiguousBeforeChain = new Set<number>();
  for (const r of unmatchedRecords) {
    const cs = candidatesBySourceRecordId.get(r.id) ?? [];
    const highCount = cs.filter((c) => c.band === "HIGH").length;
    const anyApplied = cs.some((c) => c.applied);
    if (!anyApplied && highCount >= 2) ambiguousBeforeChain.add(r.id);
  }

  // strict chain linking
  const chainComponents = computeChainComponents(unmatchedRecords);
  for (const comp of chainComponents) {
    if (!comp.applied) continue;
    const groupId = nextId++;
    const anchor = pickAnchor(comp.members);
    for (const r of comp.members) {
      // 이 record가 fuzzy 단계 루프에서 만들어졌던 자기 자신만의 singleton group을 반드시
      // 제거해야 한다 - 안 지우면 groupsById에 아무도 안 가리키는 낡은 singleton 그룹이 남아
      // lookupTarget의 후보 스캔이 같은 record를 옛 group과 새 chain group 양쪽에서 중복으로
      // 만난다(Spring FestivalSeriesLinkingService.buildFrozenSeriesModel에서 실제로 발견된
      // 버그와 동일 - 이 포트에서도 동일하게 수정한다).
      const staleGroupId = groupIdByRecordId.get(r.id);
      if (staleGroupId !== undefined) groupsById.delete(staleGroupId);

      groupIdByRecordId.set(r.id, groupId);
      matchMethodByRecordId.set(r.id, "CHAIN_HIGH_CONFIDENCE");
      ambiguousBeforeChain.delete(r.id);
    }
    const years = comp.members.map((m) => m.datasetYear);
    groupsById.set(groupId, {
      groupId,
      canonicalName: normalizeFestivalName(anchor.festivalName),
      scope: clusterKeyOf(anchor).scope,
      canonicalRegion: resolveRegionKey(anchor),
      canonicalDistrict: resolveDistrictKey(anchor),
      firstObservedYear: Math.min(...years),
      lastObservedYear: Math.max(...years),
      members: comp.members,
    });
  }

  // 5) 다인원 cluster 간 안전한 병합 - 위 1~4단계(EXACT/NORMALIZED_EXACT/FUZZY/CHAIN_HIGH_CONFIDENCE)
  // 판정 결과(matchMethodByRecordId)는 그대로 두고, 그 결과로 만들어진 groupsById/
  // groupIdByRecordId에만 추가로 적용한다 - 각 record가 "어떻게" 자기 원래 group에 합류했는지의
  // 기록(matchMethod)은 병합 이후에도 바뀌지 않는다.
  const multiMemberMerge = mergeMultiMemberGroups(groupsById, groupIdByRecordId);

  return {
    groupIdByRecordId: multiMemberMerge.groupIdByRecordId,
    matchMethodByRecordId,
    groupsById: multiMemberMerge.groupsById,
    ambiguousTrainingRecordCount: ambiguousBeforeChain.size,
  };
}
