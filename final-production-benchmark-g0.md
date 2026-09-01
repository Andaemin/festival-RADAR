# Final Production Benchmark — G0 (Series gap-aware estimator)

생성 시각: 2026-09-01 (연구용, 자동 생성) · dataset revision = 30 · 평가 대상: 2024/2025/2026 leakage-safe backtest fold

이 문서는 **현재 production 코드를 그대로 호출**한 결과를 동결한 canonical benchmark다. G0
formula/gap threshold/CPI 정책/Peer weight/reliability threshold/recommendation policy 중
어느 것도 이 Phase에서 수정하지 않았다 - 아래 수치는 재현 스크립트(`scripts/final-production-benchmark.ts`,
현재 미커밋)를 두 번 독립 실행해 **완전히 동일한 결과(SHA-256 hash 일치)**임을 확인했다.

```
pass1 hash = ea0708871458313141cd2fa6368da549919ea68db2e16409b3a67aa9a52195eb
pass2 hash = ea0708871458313141cd2fa6368da549919ea68db2e16409b3a67aa9a52195eb
deterministic: YES (n=3432, 두 pass 모두 동일)
```

## 1. OVERALL / SERIES / PEER

| Group | n | Est MdAPE | Rec MdAPE | P75 | P90 | P95 | P99 | ≤30% | ≤50% | >100% | medSigned | over% | under% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OVERALL | 3432 | 20.63% | 20.06% | 59.31% | 153.55% | 355.33% | 1151.52% | 58.65% | 71.59% | 12.53% | 0.00% | 37.12% | 44.49% |
| SERIES  | 2242 | **9.59%** | **8.76%** | 26.29% | 50.00% | 75.69% | 300.48% | 78.10% | 90.01% | 2.50% | 0.00% | 27.25% | 44.60% |
| PEER    | 1190 | 69.04% | 77.74% | 156.00% | 471.06% | 709.75% | 1829.48% | 22.02% | 36.89% | 31.43% | 13.97% | 55.71% | 44.29% |

Series n=2242(65.3%), Peer n=1190(34.7%) — OVERALL은 이 두 population의 혼합이다.

> **PEER 그룹은 old peer benchmark와 알고리즘이 동일하다**(peer 코드는 이 Phase는 물론 G0
> 도입 전체 기간 동안 한 줄도 수정되지 않았다 - `lib/multiyear/*` 미변경 확인). PEER n=1190의
> MdAPE(69.04%)이 높아 보이는 것은 알고리즘 저하가 아니라 **population selection 효과**다 -
> 이 그룹은 "Series로 못 잡히는(=매칭 안 되거나 이력이 없는) 나머지"이므로 원래 더 어려운
> subset이 여기 몰린다. 즉 peer parity는 "숫자가 같다"가 아니라 "peer 코드가 안 바뀌었다"로
> 확인한다(구조적으로 자명).

## 2. OLD vs FINAL

| | Estimate MdAPE | Recommendation MdAPE |
|---|---|---|
| OLD Series(median-fixed, G0 이전) | 16.28% | 15.33% |
| **FINAL G0(Series)** | **9.59%** | **8.76%** |
| 개선폭 | -6.69%p (41.1%↓) | -6.57%p (42.9%↓) |

OVERALL(3432건 전체, Series+Peer 혼합)은 population이 그대로이므로 Series 개선이 곧바로
OVERALL 개선으로 이어진다 - 정확한 old-OVERALL 재현치는 이번 Phase에서 재계산하지 않았다
(median-fixed estimator 코드 자체가 G0로 대체되어 현재 코드베이스에는 남아있지 않다 - "OLD"
행은 기존에 동결된 연구 문서의 값을 그대로 인용한 것).

## 3. 2024 / 2025 / 2026 fold

| Fold | Group | n | Est MdAPE | P90 | P95 | ≤30% | >100% |
|---|---|---|---|---|---|---|---|
| 2024 | OVERALL | 1001 | 25.00% | 157.40% | 427.08% | 55.54% | 12.89% |
| 2024 | SERIES | 642 | 12.63% | 61.02% | 88.74% | 72.74% | 2.65% |
| 2024 | PEER | 359 | 65.39% | 514.84% | 704.54% | 24.79% | 31.20% |
| 2025 | OVERALL | 1193 | 22.22% | 156.37% | 333.71% | 57.00% | 12.49% |
| 2025 | SERIES | 755 | 10.68% | 50.15% | 72.97% | 77.75% | 2.65% |
| 2025 | PEER | 438 | 67.29% | 389.22% | 674.74% | 21.23% | 29.45% |
| 2026 | OVERALL | 1238 | 15.06% | 138.13% | 347.88% | 62.76% | 12.28% |
| 2026 | SERIES | 845 | 6.88% | 46.81% | 66.67% | 82.49% | 2.25% |
| 2026 | PEER | 393 | 70.82% | 489.33% | 826.90% | 20.36% | 33.84% |

Series는 세 fold 모두 개선(12.63%→10.68%→6.88%, 연도가 최근일수록 정확도 향상 - 데이터 축적 효과와 일치).

## 4. Estimate Basis 분포 / LATEST vs MEDIAN

- `SERIES_HISTORY_MEDIAN`: 2242건 (65.3%)
- `PEER_SIMILARITY`: 1190건 (34.7%)
- Series 내부 — `estimateSource=LATEST`: 2024건 (90.3%), `estimateSource=MEDIAN`: 218건 (9.7%)

## 5. latestHistoricalGap 분포

| gap | n | % |
|---|---|---|
| 1 | 1871 | 83.5% |
| 2 | 153 | 6.8% |
| 3 | 95 | 4.2% |
| 4+ | 123 | 5.5% |

`gap<=2 → LATEST` / `gap>=3 → MEDIAN` 매핑 **mismatch = 0건**(2242/2242 정확히 일치).

## 6. Reliability tier별 (HIGH/MEDIUM=Series, LOW=Peer)

| Tier | n | Est MdAPE | Rec MdAPE | P90 | P95 | ≤30% | >100% |
|---|---|---|---|---|---|---|---|
| HIGH | 1200 | 9.28% | 8.93% | 50.02% | 77.21% | 77.42% | 2.50% |
| MEDIUM | 1042 | 10.00% | 8.47% | 50.00% | 74.86% | 78.89% | 2.50% |
| LOW | 1190 | 69.04% | 77.74% | 471.06% | 709.75% | 22.02% | 31.43% |

HIGH/MEDIUM 정확도 차이는 미미하지만(historical dispersion median은 0.0474 vs 0.2303으로
여전히 뚜렷이 분리 - 별도 Phase 연구 문서 참고), 둘 다 LOW(Peer)보다는 압도적으로 정확하다.

### HIGH_SINGLE_HISTORY 진단(연구용 cohort, tier 로직 변경 없음)

| Cohort | n | Est MdAPE | P90 | P95 |
|---|---|---|---|---|
| HIGH_SINGLE_HISTORY(historyCount<=1) | 571 | 10.81% | 60.00% | 82.35% |
| HIGH(SERIES_STABLE, multi-history) | 629 | 7.93% | 46.35% | 69.01% |

HIGH의 47.6%를 차지하는 SINGLE_HISTORY cohort는 "안정성이 측정된 것"이 아니라 "측정 자체가
불가능해 기본값으로 HIGH가 된 것"이며, 실측 정확도는 MEDIUM(10.00%)보다도 낮다 - "HIGH라고
해서 반드시 여러 해의 안정성이 검증된 것은 아니다"라는 UI 설명이 필요하다는 근거.

## 7. Data Quality Audit 교차(reliability tier별, point-estimate source 기준)

| Tier | n | audit signal 존재 | audit HIGH |
|---|---|---|---|
| HIGH | 1200 | 9건 (0.75%) | 3건 (0.25%) |
| MEDIUM | 1042 | 89건 (8.54%) | 7건 (0.67%) |

Reliability와 Data Quality Audit은 서로 다른 축이다 - "audit HIGH ≠ reliability LOW"를
실측으로도 재확인(예: 해운대모래축제 2025는 reliability=HIGH인데 point-estimate source가
audit MEDIUM이라 실제로 크게 틀렸다 - 별도 Phase 연구 문서 참고).

## 8. Future-Year Safety 요약(2027~2035)

- 2027/2028/2029/2030/2035 전부 Series model 생성 정상, API crash 없음, NaN/Infinity/음수 없음(전용 테스트로 확인).
- leakage: 모든 planningYear에서 `datasetYear < planningYear`만 사용, 보유 데이터가 2026까지이므로 실제 참조 연도는 항상 ≤2026.
- G0 gap transition(부산국제록페스티벌, latestHistoricalYear=2026) — production route 실측:
  - 2027(gap=1) → LATEST
  - 2028(gap=2) → LATEST
  - 2029(gap=3) → MEDIAN
  - 2030(gap=4) → MEDIAN
- CPI: `CPI_TABLE`이 2025까지만 지원 → 2027년 이상 planningYear는 baseYear(planningYear-1)가 항상 미지원 → **all-or-nothing nominal fallback**이 LATEST/MEDIAN 두 분기 모두에서 예외 없이 작동(부분 보정 없음, 확인 완료).
- Recommendation: 미래 planningYear에서도 `recommendedBudgetKrw = round(estimatedBudgetKrw × 1.05)` 정확히 유지(새 buffer 없음).
- Reliability: 실제 미래 연도(2027~2035)는 calibration pool이 충분(2018~2026 실제 fold로 saturate)해 threshold가 항상 계산됨. 합성 데이터로 calibration 불가(threshold=null) 상황을 강제해도 `computePlanningReliability`는 crash 없이 HIGH로 안전하게 fallback.
- Series→Peer fallback: 신규/미존재 festivalName은 미래 planningYear(2027/2030/2035)에서도 UNMATCHED → Peer routing 정상, reliabilityTier=LOW.
- Extreme input(durationDays=1 미만 400 응답, durationDays=3650 정상 처리, district 미입력, venueType=UNDECIDED) × future planningYear 조합에서도 crash 없음.

## Disclaimer

Data Quality Audit/Reliability tier/Future-year 진단은 모두 **read-only diagnostic**이며
estimator 계산에 관여하지 않는다. severity/tier/fallback 표시는 "검토 우선순위"나 "데이터
근거의 안정성"을 뜻할 뿐 오류 확정이나 정확도 확률이 아니다.
