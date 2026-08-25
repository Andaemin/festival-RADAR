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

  return { groupIdByRecordId, matchMethodByRecordId, groupsById, ambiguousTrainingRecordCount: ambiguousBeforeChain.size };
}
