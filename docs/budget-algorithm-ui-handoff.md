# 예산 추정 UI 인계 문서

독자: **최종 UI를 구현하는 팀원.**

이 문서는 알고리즘 내부 계산을 길게 설명하지 않는다(내부 계산이 궁금하면 `docs/budget-algorithm-final.md` 참고). 여기서는 **API의 이 값을 사용자에게 어떤 이름과 설명으로 보여줘야 하는가**만 다룬다.

이 문서는 information architecture / semantics / field mapping / copy guideline까지만 다룬다. CSS, component 구현, responsive 대응, 색상, 최종 시각 레이아웃은 다루지 않는다 — 최종 UI 담당자의 작업 범위를 침범하지 않는다.

## 1. UI가 보여줘야 할 핵심 4개

### 예상 예산

- API: `estimatedBudgetKrw`
- 사용자 표현: **예상 예산**
- 설명: 과거 축제 데이터를 바탕으로 계산한 중심 예산 추정값

### 추천 계획 예산

- API: `recommendedBudgetKrw`
- 사용자 표현: **추천 계획 예산**
- 설명: 실제 계획 단계에서 참고할 수 있도록 보수적으로 조정한 예산

**예상 예산과 추천 계획 예산을 같은 값/같은 개념처럼 합치지 않는다.** 어느 쪽을 화면에서 더 강조(primary emphasis)할지는 제품 디자인 담당의 판단에 맡기되, 두 값의 의미 차이(하나는 중심 추정치, 하나는 보수적 제안)는 반드시 보존한다.

### 유사 축제 참고 범위

- API: `p25Krw`(하단) ~ `p75Krw`(상단)
- 사용자 표현: **유사 축제 참고 범위**
- 설명: 비교에 사용된 유사 축제들의 예산 분포를 참고할 수 있는 범위

절대 다음처럼 표현하지 않는다:

- 신뢰구간
- 예상 오차 범위
- 50% 확률 범위

### 신뢰도

- API: `reliabilityTier`, `reliabilityReason`
- UI: **신뢰도 높음 / 신뢰도 보통 / 신뢰도 낮음**(또는 디자인 시스템에 맞는 동등 표현)

숫자 % confidence로 변환하지 않는다 — API 자체가 숫자 confidence를 제공하지 않는다.

## 2. Series UI

`estimateBasis === "SERIES_HISTORY_MEDIAN"`인 경우:

- 강조 메시지: "동일 축제의 과거 예산 이력을 활용했습니다."
- recommendation 설명: "과거 예산 추정값에 계획 단계의 고정 여유분을 반영했습니다."

내부적으로 +5%라는 숫자를 UI에 직접 표시할지는 제품 요구에 따라 결정할 수 있다. 단 **"AI가 5%의 위험을 계산했다"** 같은 표현은 금지한다 — 이 5%는 데이터로부터 산출된 위험 계수가 아니라 모든 Series 대상에 예외 없이 적용되는 고정값이다.

## 3. HIGH + single history

`reliabilityTier === "HIGH"`이면서 이력이 1개뿐인 경우, 현재 API가 실제로 돌려주는 `reliabilityReason`을 그대로 존중한다:

> 동일 축제의 과거 예산 이력을 활용해 예산을 추정했습니다.

UI가 임의로 다음처럼 바꾸면 안 된다:

> 과거 여러 해 동안 안정적이었습니다. ❌

(이력이 1개뿐이면 "여러 해 동안 안정적이었는지" 자체를 측정할 수 없다 — API가 이미 이 문구를 쓰지 않도록 설계돼 있다.)

## 4. HIGH + multiple stable histories

`reliabilityTier === "HIGH"`이고 이력이 2개 이상(측정된 변동성이 낮음)인 경우:

> 동일 축제 과거 예산 이력을 활용했고, 물가 보정 후 연도별 예산 변동이 비교적 안정적입니다.

현재 API `reliabilityReason`을 가능하면 그대로 source-of-truth로 사용하고, UI에서 별도로 reason을 재구성(reconstruction)하는 것은 최소화한다 — §3의 사례처럼, "HIGH니까 안정적"이라는 식으로 tier만 보고 문구를 지어내면 historyCount=1 케이스에서 부정확한 설명이 된다.

## 5. MEDIUM

의미: 동일 축제의 과거 이력은 활용했지만 연도별 예산 변동이 상대적으로 큰 경우.

**"데이터가 틀렸다"는 의미가 아니다** — 오히려 데이터가 정상적으로 존재하고, 그 데이터가 보여주는 변동폭 자체가 큰 것이다.

## 6. LOW

Peer fallback을 의미한다. 설명: "동일 축제의 충분한 과거 이력 대신 유사 축제 데이터를 바탕으로 추정했습니다."

**LOW라고 해서 결과를 숨기지 않는다.** 다만 `reliabilityReason`을 결과와 함께 보여줄 것을 권장한다 — 사용자가 "왜 이 값이 다른 축제보다 신뢰도가 낮은지" 맥락 없이 숫자만 보지 않도록 한다.

## 7. Peer UI

`estimateBasis === "PEER_SIMILARITY"`인 경우:

- 설명: "지역·축제 유형·장소·개최기간 등이 유사한 과거 축제를 비교해 계산했습니다."
- recommendation 설명: "비교 축제들의 예산 분포도 함께 고려해 계획 예산을 제안합니다."

`P60`이라는 내부 quantile 명칭을 일반 사용자에게 반드시 노출할 필요는 없다 — 위 recommendation 설명 정도로 충분하다.

## 8. 같은 축제 이력 여부

API의 `estimateBasis`(`"SERIES_HISTORY_MEDIAN"` | `"PEER_SIMILARITY"`)만으로 Series/Peer 여부를 판별할 수 있다 — `seriesSignal.status`(`"MATCHED"` 등)를 추가로 확인할 필요는 없다(`estimateBasis`가 이미 그 판정 결과를 반영한 최종 필드다). badge/label 예:

- Series → "동일 축제 이력 기반"
- Peer → "유사 축제 기반"

프론트에서 조건을 지어내지 말고 위 필드값을 정확히 확인해 분기한다.

## 9. 금지 표현

| 피해야 할 표현 | 이유 |
| --- | --- |
| 정확도 80% | numeric confidence가 아니다 — API에 그런 필드 자체가 없다 |
| 50% 신뢰구간 | P25–P75는 confidence interval이 아니다 |
| 실제 집행 예산 | 계획 예산(planned budget) 데이터 기반이지 실제 집행 실적이 아니다 |
| AI가 보장하는 예산 | 어떤 값도 보장(guarantee)하는 모델이 아니다 |
| HIGH = 정확함 | 상대적 reliability tier일 뿐, 절대적 정확성 보증이 아니다 |
| LOW = 잘못된 결과 | Peer fallback을 썼다는 의미일 뿐, 결과가 틀렸다는 뜻이 아니다 |

## 10. Recommended layout(정보 위계 제안)

실제 component/코드는 이 문서에서 만들지 않는다. 정보 위계만 제안한다:

```
[추천 계획 예산]
4억 2,000만원

예상 예산
3억 8,000만원

유사 축제 참고 범위
2억 8,000만 ~ 4억 5,000만원

신뢰도: 보통
[신뢰도 이유]

추정 기준
동일 축제 이력 기반 / 유사 축제 기반
```

위 숫자는 illustration(예시)이며 production 예시로 오인되지 않도록 한다 — 실제 API 응답값이 아니다.

## 11. API mapping table

`app/api/v1/multiyear-budget-estimates/route.ts` + `lib/api/multiyear-budget-estimates.ts`(`MultiYearBudgetEstimateResponse`)를 직접 읽고 확인한 실제 필드명이다.

| UI | API field | 타입 | 사용 조건 | 비고 |
| --- | --- | --- | --- | --- |
| 예상 예산 | `estimatedBudgetKrw` | `number` | 항상 | §12 참고 — 0일 수 있음(값 없음과 구분 필요) |
| 추천 계획 예산 | `recommendedBudgetKrw` | `number` | 항상 | 항상 `estimatedBudgetKrw` 이상 |
| 참고 범위 하단 | `p25Krw` | `number` | 항상 | Series/Peer 무관하게 항상 Peer 분포 기준(§12) |
| 참고 범위 상단 | `p75Krw` | `number` | 항상 | 위와 동일 |
| 신뢰도 | `reliabilityTier` | `"HIGH" \| "MEDIUM" \| "LOW"` | 항상 | |
| 신뢰도 설명 | `reliabilityReason` | `string` | 항상 | 항상 비어있지 않음 |
| 추정 방식 | `estimateBasis` | `"PEER_SIMILARITY" \| "SERIES_HISTORY_MEDIAN"` | 항상 | §8 참고 |
| 동일 축제 이력 수 | `seriesSignal.historyCount` | `number \| undefined` | `seriesSignal.status === "MATCHED"`일 때만 존재 | §12 참고 |

참고 — 화면에 직접 노출하지 않아도 되지만 존재하는 필드: `weightedAverageBudgetKrw`(단순 가중평균, 최종 estimate가 아님), `p50Krw`/`p60Krw`(내부 계산용 quantile), `sampleCount`/`fallbackLevel`/`averageSimilarity`/`dataQualityV3`(§9의 "정확도 %"로 오용 금지), `recommendationBasis`/`rangeBasis`/`dataQualityBasis`(basis 계열 metadata, 필요시 디버깅/내부 표시용).

## 12. null / unavailable semantics

`MultiYearBudgetEstimateResponse`의 `estimatedBudgetKrw`/`recommendedBudgetKrw`/`p25Krw`/`p75Krw` 등은 TypeScript 타입상 **`number`이며 `null`이 아니다.** 다만 다음 두 가지 "값이 사실상 없음" 상황을 구분해야 한다:

1. **API가 422를 응답하는 경우**: 참조 가능한 데이터 자체가 0건(`referencePool.length === 0`)이면 200이 아니라 422 상태코드와 `message` 필드가 온다 — 이 경우는 일반적인 에러 처리 흐름(fetch 실패/에러 메시지 표시)을 따르면 된다.
2. **200이지만 후보가 선정되지 않은 경우**: 참조 데이터는 있지만 유사도 threshold를 넘는 후보가 하나도 없으면 `sampleCount: 0`, `fallbackLevel: "NONE"`, 그리고 `estimatedBudgetKrw`/`recommendedBudgetKrw`/`p25Krw`/`p75Krw` 등이 **전부 `0`(숫자 0)** 으로 채워진 200 응답이 온다.

즉 `estimatedBudgetKrw === 0`은 "예산이 0원으로 계산됐다"는 뜻이 아니라 "계산할 근거 자체가 없었다"는 뜻일 수 있다. UI는 다음 중 하나를 하지 말고:

- 무조건 `0원`으로 표시
- 무조건 `"-"`로 표시
- 임의의 fallback 값을 지어내 표시

**`sampleCount === 0`(또는 `fallbackLevel === "NONE"`)을 먼저 확인해 "참고할 유사 축제를 찾지 못했습니다" 같은 명시적 안내를 보여주는 것을 권장한다.**

reference range(`p25Krw`/`p75Krw`)는 Series/Peer 어느 경로든 **항상 Peer(유사 축제) 분포에서 계산된 값**이 온다(§11 참고) — Series 경로라고 해서 다른 계산식의 범위가 오는 것이 아니다. 다만 위와 같이 후보 자체가 없으면(`sampleCount===0`) 이 범위도 0으로 채워진다는 점은 동일하게 적용된다.

## 13. 모바일/최종 디자인 범위

이 문서는 information architecture / semantics / field mapping / copy guideline까지만 다룬다. 실제 CSS, component, responsive 구현, 색상, 최종 시각 레이아웃은 다루지 않는다 — 최종 UI 담당자의 작업 범위를 침범하지 않는다.

## 14. Known limitation을 UI에서 어디까지 알릴지

일반 결과 화면에 연구 보고서를 전부 보여줄 필요는 없다. 최소 권장 노출:

- **LOW(Peer)일 때**: "동일 축제 자체 이력이 부족하여 유사 축제 데이터를 사용했습니다." 정도는 결과 화면에 노출 권장.

duration monotonicity(§`budget-algorithm-final.md` §26.2)나 visitor 연구(같은 문서 §26.4) 같은 기술적 limitation은 일반 결과 화면이 아니라 도움말 / 상세 설명 / 내부 문서 수준으로 처리 가능하다.

## 15. UI handoff 최종 체크리스트

- [ ] `estimatedBudget`과 `recommendedBudget`을 구분했는가
- [ ] `P25–P75`를 confidence interval로 부르지 않는가
- [ ] numeric confidence(%)를 만들지 않았는가
- [ ] `reliabilityReason`을 임의로 재해석하지 않는가
- [ ] Series/Peer basis(`estimateBasis`)를 사용자에게 설명 가능한가
- [ ] HIGH + historyCount=1을 "안정적"이라고 표현하지 않는가
- [ ] LOW를 오류처럼 표현하지 않는가
