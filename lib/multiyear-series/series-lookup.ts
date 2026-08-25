import { clusterKeyOf, makeScoreCluster, score, ScoredCandidate } from "./scoring";
import { ClusterKey, FrozenSeriesGroup, FrozenSeriesModel, SeriesRecordLite, TargetSeriesMatch } from "./types";

/**
 * PHASE 9B-1 — Spring `FestivalSeriesLinkingService.lookupTarget`의 1:1 포팅.
 *
 * target을 clustering에 절대 포함시키지 않고(union-find 미참여, chain component 미참여),
 * 이미 계산된 {@link FrozenSeriesModel}에만 deterministic exact -> (없을 때만) fuzzy 순서로
 * 조회한다. fuzzy 채점은 `scoring.ts`의 `score()`를 그대로 재사용한다 - 새 threshold나 새
 * 판정식을 추가하지 않는다.
 *
 * ambiguous 규칙도 기존 fuzzy 단계와 동일: 서로 다른 series를 가리키는 HIGH 후보가 2개 이상이면
 * 연결하지 않는다(series signal 사용 안 함).
 */
export function lookupTarget(target: SeriesRecordLite, model: FrozenSeriesModel): TargetSeriesMatch {
  const targetKey = clusterKeyOf(target);
  const targetCluster = makeScoreCluster(-1, targetKey, [target]);

  // 1) deterministic exact (scope+region+district+normalizedName 완전 일치)
  for (const group of model.groupsById.values()) {
    if (group.scope !== targetKey.scope || group.canonicalRegion !== targetKey.regionKey) continue;
    const byKey = groupByClusterKey(group.members);
    for (const [key, subCluster] of byKey) {
      if (!clusterKeyEquals(key, targetKey)) continue;
      const rawExact = subCluster.some((m) => m.festivalName.trim() === target.festivalName.trim());
      return {
        targetRecordId: target.id,
        matchMethod: rawExact ? "EXACT" : "NORMALIZED_EXACT",
        ambiguous: false,
        matchedGroupId: group.groupId,
        matchedCanonicalName: group.canonicalName,
        bestScore: 1.0,
        bestNameSimilarity: 1.0,
        ambiguousGroupIds: [],
      };
    }
  }

  // 2) fuzzy (같은 scope+region 버킷 안에서만, 결정적 매칭이 전혀 없을 때만)
  const scored: { group: FrozenSeriesGroup; candidate: ScoredCandidate }[] = [];
  for (const group of model.groupsById.values()) {
    if (group.scope !== targetKey.scope || group.canonicalRegion !== targetKey.regionKey) continue;
    let bestForGroup: ScoredCandidate | null = null;
    for (const [key, subMembers] of groupByClusterKey(group.members)) {
      const subCluster = makeScoreCluster(-1, key, subMembers);
      const candidate = score(targetCluster, subCluster);
      if (candidate !== null && (bestForGroup === null || candidate.score > bestForGroup.score)) {
        bestForGroup = candidate;
      }
    }
    if (bestForGroup !== null) scored.push({ group, candidate: bestForGroup });
  }

  const highOnes = scored.filter((s) => s.candidate.band === "HIGH");
  const distinctHighGroupIds = [...new Set(highOnes.map((s) => s.group.groupId))];
  const bestAnyScore = scored.length > 0 ? Math.max(...scored.map((s) => s.candidate.score)) : null;

  if (distinctHighGroupIds.length === 1) {
    const winner = highOnes[0];
    return {
      targetRecordId: target.id,
      matchMethod: "FUZZY",
      ambiguous: false,
      matchedGroupId: winner.group.groupId,
      matchedCanonicalName: winner.group.canonicalName,
      bestScore: winner.candidate.score,
      bestNameSimilarity: winner.candidate.nameSimilarity,
      ambiguousGroupIds: [],
    };
  }
  if (distinctHighGroupIds.length >= 2) {
    return {
      targetRecordId: target.id,
      matchMethod: "UNMATCHED",
      ambiguous: true,
      matchedGroupId: null,
      matchedCanonicalName: null,
      bestScore: bestAnyScore,
      bestNameSimilarity: null,
      ambiguousGroupIds: distinctHighGroupIds,
    };
  }
  return {
    targetRecordId: target.id,
    matchMethod: "UNMATCHED",
    ambiguous: false,
    matchedGroupId: null,
    matchedCanonicalName: null,
    bestScore: bestAnyScore,
    bestNameSimilarity: null,
    ambiguousGroupIds: [],
  };
}

function clusterKeyEquals(a: ClusterKey, b: ClusterKey): boolean {
  return a.scope === b.scope && a.regionKey === b.regionKey && a.districtKey === b.districtKey && a.normalizedName === b.normalizedName;
}

function groupByClusterKey(members: SeriesRecordLite[]): Map<ClusterKey, SeriesRecordLite[]> {
  const byKey = new Map<string, { key: ClusterKey; members: SeriesRecordLite[] }>();
  for (const r of members) {
    const key = clusterKeyOf(r);
    const keyStr = `${key.scope} ${key.regionKey} ${key.districtKey ?? ""} ${key.normalizedName}`;
    if (!byKey.has(keyStr)) byKey.set(keyStr, { key, members: [] });
    byKey.get(keyStr)!.members.push(r);
  }
  return new Map([...byKey.values()].map((v) => [v.key, v.members]));
}
