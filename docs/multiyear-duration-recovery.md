# 다년도 개최기간(duration) 데이터 복구 워크플로우

## 왜 필요한가

2017-2026 canonical 데이터셋(`festival_2017_2026_sanitized.csv`)의 `durationDays`는 2022-2024
3개 연도에서 전량(2022: 944/944, 2023: 1,129/1,129, 2024: 1,170/1,170) `UNPARSED`였다.

원인 조사 결과(`phase26-duration-venue-data-integrity-audit.md` 참고):

- 원본 개최기간 텍스트(`period_raw`)는 이 3개 연도 모두 100% 보존돼 있었다 - **원본 자체의
  결측이 아니다.**
- 텍스트 스타일은 정상적으로 파싱에 성공한 인접 연도(2017-2021, 2025-2026)와 동일한 계열의
  단순 날짜범위("5.25~5.26" 등)가 다수였다.
- canonical CSV → DB 반영 단계(`scripts/multiyear-import/canonicalize.ts`)는 duration_days를
  그대로 통과시킬 뿐 파싱하지 않는다 - 이 저장소 코드의 문제가 아니다.
- 원본 `festival_2017_2026_sanitized.csv`를 만든 외부 생성 도구는 이 저장소에도, 인접 Spring
  참고 프로젝트("공모전 예산 알고리즘/backend")에도 존재하지 않는다(git에 이 CSV가 커밋된 적이
  없고 `/prisma/data/`가 전체 gitignore 대상). 따라서 원본 도구를 고치는 대신, 이 저장소 안에
  **재현 가능한 결정적(deterministic) 복구 유틸리티**를 새로 만들었다.

## 무엇을 고치는가

- **2022-2024, SAFE_RECOVERABLE로 판정된 1,480건의 `duration_days`만** 복구한다(2022=392,
  2023=539, 2024=549).
- SAFE_RECOVERABLE = 원문에서 규칙 기반으로 **결정적으로** 계산 가능한 경우만:
  - 명시적 시작~종료 날짜범위(예: `5.25~5.26`, 연도 context 포함)
  - 같은 달 축약범위(예: `9.24.~25.`)
  - 단일일자(1일 행사)
  - 원문에 명시된 총일수 주석(예: `10월(3일간)`) - 단 "(N일간)"류 주석이 **정확히 1개**일 때만
    (2개 이상이면 어느 것이 진짜 duration인지 결정적으로 알 수 없어 제외)
  - 2017년 한정으로, `duration_note_raw`에 명시된 총일수가 있으면 그것을 최우선 사용(2017의
    실제 기존 정상값과의 golden parity 대조로 확인된 규칙 - 2022-2024는 이 컬럼이 비어있어
    영향 없음)
- 이 규칙은 2017-2021의 이미 정상 처리된 3,025건에 대해 **golden parity mismatch 0건**으로
  검증됐다 - 새 규칙이 정상 연도의 기존 값을 재현하지 못하는 사례가 하나도 없다.

## 무엇을 고치지 않는가

- **Ambiguous 표현**: 월 단위("N월 중"), 계절 표현(봄/여름/가을/겨울/상반기/하반기), 반복 개최
  (매주/격주/상시), 복수 구간, 연도 미명시+월 역순(연도걸침 추정 필요), 명시적 "미정" 등은
  사람이 대략 추정 가능해도 자동 복구하지 않는다(null 유지).
- **Venue**: venue 결측(2017-2024, 7,718건)은 별도 audit에서 "원본 자체에 분류 항목이 없음
  (source limitation)"으로 확인됐다 - 이번 workflow의 대상이 아니다.
- **Budget/Visitor**: 전혀 손대지 않는다.
- **예산 추정 알고리즘**: Series/Peer estimator, CandidateSelectorV1, similarity weight
  (duration weight=0.15 등), durationElasticity=0.55, winsorize, CPI, recommendation,
  reliability, API/UI, Prisma schema 중 어느 것도 이 workflow로 변경되지 않는다 - 순수 데이터
  교정이다.

## 실행

repository 루트에서 실행한다(경로는 모두 repo 상대 경로).

### Dry-run (기본값 - 아무것도 바꾸지 않음)

```
npx tsx scripts/phase27-duration-recovery.ts
```

또는 명시적으로:

```
npx tsx scripts/phase27-duration-recovery.ts --dry-run
```

인자 없이 실행해도 항상 dry-run이다(`--apply`를 명시해야만 실제 변경이 일어난다) - preview
검증만 수행하고 `phase27-duration-recovery-preview.csv`를 생성한다. canonical CSV/DB는 전혀
바뀌지 않는다.

### Apply (검증 통과 시에만 실제 적용)

```
npx tsx scripts/phase27-duration-recovery.ts --apply
```

다음을 순서대로 수행하며, 각 단계에서 검증 실패 시 자동 중단한다:

1. 시작 row count(10,198) 확인
2. golden parity check(정상 연도 재현, mismatch 0 요구)
3. recovery preview 생성 + pre-apply validation(음수/중복 등)
4. canonical CSV 백업(`festival_2017_2026_sanitized.BEFORE_PHASE27.csv`) 생성 + sha256 무결성 확인
5. duration_days/duration_source만 surgical text-splice로 수정(다른 컬럼은 문자 단위로도 건드리지 않음)
6. 전체 필드 diff로 "duration 외 필드 변경 = 0" 확인 - 위반 시 즉시 백업 복원 후 중단
7. MultiYear 테이블(및 그 관계 테이블)만 초기화 후 기존 importer 경로(`scripts/import-multiyear-festivals.ts`와 동일한 함수)로 재적재
8. canonical↔DB duration mismatch = 0 확인
9. 2024-2026 leakage-safe before/after benchmark 산출

### DB reimport만 별도로 하고 싶을 때(예: 백업으로 되돌리기)

이미 검증된 canonical CSV를 기존 importer로 그대로 재적재하려면:

```
npx tsx scripts/import-multiyear-festivals.ts --dry-run
npx tsx scripts/import-multiyear-festivals.ts
```

(백업으로 되돌리려면 `festival_2017_2026_sanitized.BEFORE_PHASE27.csv`를
`festival_2017_2026_sanitized.csv`로 복사한 뒤 위 명령을 실행하기 전에, MultiYear 테이블을
비워야 한다 - `phase27-duration-recovery.ts --apply`가 하는 것과 동일한 절차다.)

### 재현성 / idempotency 검증(읽기 전용, 아무것도 바꾸지 않음)

```
npx tsx scripts/phase27b-verify-reproducibility.ts
```

백업 CSV만으로 실제 교정 결과를 재현할 수 있는지, 그리고 이미 교정된 데이터에 다시 돌려도
안전한지(idempotent)를 검증한다. OS temp 디렉토리에만 쓰고 종료 시 정리한다.

## 검증 결과(authoritative, 2026-08-25 기준)

| 항목 | 값 |
| --- | --- |
| 전체 row count | 10,198 (변경 전/후 동일) |
| 복구된 duration 건수 | 1,480 (2022=392, 2023=539, 2024=549) |
| Golden parity mismatch | 0 / 3,025 |
| Canonical ↔ DB duration mismatch | 0 |
| Duration 외 필드 변경 | 0 |
| Reconstructed AFTER ↔ 실제 canonical | 완전 동일(byte-level hash 일치) |
| Idempotency | 확인됨(재적용 시 추가 변경 0건) |

Peer 추정 정확도(2024-2026 leakage-safe benchmark, n=3,432)에 미친 영향:

| Metric | Before | After |
| --- | --- | --- |
| Overall Estimate MdAPE | 26.65% | 26.57% |
| Series MdAPE | 16.28% | 16.28%(불변 - Series는 duration을 쓰지 않음) |
| Peer MdAPE | 69.15% | 67.62% |
| Peer P90 | 487.24% | 450.46% |
| Peer P95 | 767.24% | 723.90% |

상세 근거와 fold별/필드별 검증은 `phase27-duration-recovery-validation.md`,
`phase27b-reproducibility-verification.md`를 참고.
