import { REGION_DISPLAY, Region } from "@/lib/domain/enums";
import { FrozenSeriesModel } from "./types";

/**
 * PHASE — Explicit Series Identity Routing. `/budget-estimator`에서 사용자가 검색 결과로
 * 기존 축제를 **직접 선택**한 경우에만 쓰는 별도 재확인 경로다.
 *
 * 문제 배경: 자동 matcher(`series-lookup.ts`의 `lookupTarget`)는 `district`를 identity의
 * 일부로 취급해 `group.scope !== targetKey.scope`(REGION_LEVEL ↔ DISTRICT_LEVEL 불일치)를
 * hard gate로 쓴다(scoring.ts의 `clusterKeyOf`). 이는 "이름만 보고 자동으로 series를 찾아야
 * 하는" 상황에서는 필요한 안전장치이지만, 사용자가 이미 어떤 축제인지 **명시적으로 선택**한
 * 상황에서도 그대로 적용되면 "이번 계획연도에 시군구가 바뀌었다"는 planning metadata 때문에
 * 기존 축제가 신규 축제(Peer)로 오분류되는 문제가 생긴다.
 *
 * 이 모듈은 `lookupTarget`/`scoring.ts`/`series-linker.ts`(자동 matcher) 어느 것도 건드리지
 * 않는다 - district 없이 그냥 canonicalName+region만으로 group을 다시 찾는 **완전히 별도의
 * 조회**를 추가할 뿐이다. `canonicalName`은 `series-search.ts`가 이미 groupId 대신 안정적인
 * "논리적 identity"로 채택한 값과 동일하다(같은 실제 데이터가 클러스터링되는 한 재계산 사이에도
 * 값 자체는 결정적으로 재현된다 - groupId만 매 빌드마다 바뀌는 임시 counter다).
 */

export interface ExplicitSeriesIdentityAnchor {
  canonicalName: string;
  /** 요청 바디의 regionCode 원문 문자열(검증 전) - 여기서는 등호 비교에만 쓰므로 별도로
   *  Region enum 유효성을 다시 검사하지 않는다(유효하지 않으면 그냥 매칭되지 않을 뿐, 이미
   *  상위에서 regionCode 자체는 검증됨). */
  regionCode: string;
}

export interface ExplicitSeriesIdentityResolution {
  matchedGroupId: number | null;
  /** 같은 canonicalName+region으로 그룹이 2개 이상 걸리면 true - 이때는 임의로 하나를 고르지
   *  않고 matchedGroupId=null로 두어(자동 matcher fallback) 안전하게 처리한다. */
  ambiguous: boolean;
}

/**
 * @param anchor 사용자가 검색 결과에서 실제로 선택한 시점의 canonicalName + 현재 요청의
 *               regionCode(요청 바디 원문 문자열, 이미 검증된 `regionCode`와 반드시 같아야
 *               호출부가 이 함수를 부른다 - 호출부 책임).
 * @param region 검증된 Region enum(REGION_DISPLAY 조회용) - anchor.regionCode와 별개로 받는
 *               이유는 호출부가 이미 `regionCode as Region` 캐스팅을 마친 값을 그대로 넘기게
 *               하기 위함이다(이 함수 안에서 다시 문자열 파싱을 하지 않는다).
 */
export function resolveExplicitSeriesIdentity(
  anchor: ExplicitSeriesIdentityAnchor,
  region: Region,
  model: FrozenSeriesModel
): ExplicitSeriesIdentityResolution {
  const regionKey = REGION_DISPLAY[region];
  const matches = [...model.groupsById.values()].filter(
    (g) => g.canonicalName === anchor.canonicalName && g.canonicalRegion === regionKey
  );

  if (matches.length === 0) return { matchedGroupId: null, ambiguous: false };
  if (matches.length > 1) return { matchedGroupId: null, ambiguous: true };
  return { matchedGroupId: matches[0].groupId, ambiguous: false };
}
