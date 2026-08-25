/**
 * Spring `com.festival.budgetassist.multiyear.series.LevenshteinSimilarity`의 1:1 포팅.
 * 의존성 없는 최소 Levenshtein 거리 기반 문자열 유사도. ratio = 1 - editDistance/maxLen,
 * 범위는 [0,1](완전 동일=1, 공통점 없음에 가까울수록 0에 가까움).
 *
 * Java String.length()/charAt()는 UTF-16 code unit 기준이고 JS string.length/[i]도 동일하게
 * UTF-16 code unit 기준이라, 이 도메인의 한글/기호(전부 BMP 내)에서는 두 구현이 정확히 같은
 * 길이/문자 단위로 계산한다.
 */

export function editDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    const ca = a.charAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ca === b.charAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(Math.min(curr[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[m];
}

export function levenshteinRatio(a: string | null | undefined, b: string | null | undefined): number {
  if (a === null || a === undefined || b === null || b === undefined) return 0.0;
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const distance = editDistance(a, b);
  return 1.0 - distance / maxLen;
}

/** 길이 차이만으로 유사도 상한을 빠르게 걸러낼 수 있는지 확인 - 전체 DP를 돌리기 전 값싼 사전 필터용. */
export function lengthBoundedMaxRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const lenDiff = Math.abs(a.length - b.length);
  return 1.0 - lenDiff / maxLen;
}
