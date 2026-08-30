import { PlannerRecord } from "./types";

/**
 * 원본 데이터의 단위 오류가 통계·화면에 새는 것을 막는 방어막.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 * `prisma/data/festival_2017_2026_sanitized.csv`에는 자릿수가 어긋난 값이 섞여 있다
 * (2026-08-26 전수 확인).
 *   영주풍기인삼축제 2019 : 방문객 361,044,000명   같은 축제 다른 해는 33~36만명
 *   무주반딧불축제  2024 : 예산 2조 5천억원        실제 규모의 1,000배
 *   정동야행축제    2024 : 예산 3,590억원 / 방문 10.3만명 → 1인당 34만원
 *
 * 그대로 두면 두 곳에서 눈에 띈다.
 *   1) 근거 축제는 방문객 내림차순으로 고르므로(recommendation-engine.ts) **부풀려진
 *      행이 구조적으로 표 맨 윗줄에 온다.**
 *   2) 예산 효율 카드의 "효율 상위"는 winsorize 이전 표본에서 뽑으므로
 *      (budget-efficiency.ts) 1인당 투입비 0~30원짜리가 모범 사례로 제시된다.
 *
 * ── 무엇을 하는가 ───────────────────────────────────────────────────────
 * **레코드를 버리지 않고, 못 믿을 숫자 필드만 null로 바꾼다.**
 * 축제가 존재한다는 사실 자체는 맞으므로 코호트 건수·화이트스페이스·월별 분포에는
 * 그대로 남고, 예산·방문객이 필요한 계산에서만 빠진다. period-parse.ts가 판정 불가한
 * 개최월을 null로 두는 것과 같은 원칙이다 — 모르는 것은 모르는 채로 둔다.
 *
 * ── 왜 방문객을 먼저 의심하는가 ─────────────────────────────────────────
 * 1인당 투입비가 상식을 벗어난 37건을 전수로 보면 양쪽 끝 모두 방문객이 원인이었다.
 *   예산 196억 / 방문 2명      (2022계룡세계군문화엑스포)
 *   예산 0.1억 / 방문 400만명  (과역 참살이 매화 축제)
 * 예산은 예산서에서 온 행정 수치라 98.9%가 채워지고 자릿수도 안정적인 반면,
 * 방문객은 지자체 자체 추산이라 집계 방식이 제각각이다(visitor-stats.ts 주석 참고).
 * 그래서 둘 다 버리지 않고 **방문객만** 버린다.
 *
 * ── 판정 수단은 둘이다 ──────────────────────────────────────────────────
 *   1) 연도 간 대조 (`isLoneOutlier`)  같은 축제의 다른 해와 견준다. 정확하지만
 *      비교할 해가 있어야 한다.
 *   2) 절대 임계값 (MAX_PLAUSIBLE_*)   비교할 해가 없을 때의 최후 방어선.
 * 1)이 우선이고 2)는 1)이 판정할 수 없는 행만 받는다.
 *
 * ── 이것은 임시 조치다 ──────────────────────────────────────────────────
 * 원본 CSV가 바로잡히면 이 모듈은 저절로 아무 일도 하지 않는다. 특정 축제명이나 행을
 * 지목하지 않고 **값의 타당성만** 보기 때문이다. 정상 데이터는 임계값에 닿지 않는다.
 * 무효화 건수가 0이 되면(record-source.ts가 로그로 알려준다) 이 파일과 호출부 한 줄을
 * 지우는 것으로 원복된다.
 */

/**
 * 예산 값을 믿을 수 있는지. 임포터가 이미 판정해 둔 결과를 그대로 따른다.
 *
 * `budgetQualityFlag`는 원장 적재 시점에 붙는다(scripts/multiyear-import).
 *   VALID                  9,930행
 *   MISSING_OR_NONPOSITIVE   258행  예산이 없거나 0 이하
 *   UNIT_SCALE_SUSPECT        10행  인접 연도 같은 축제와 자릿수가 어긋남
 *
 * UNIT_SCALE_SUSPECT는 **연도 간 교차검증 결과**라 어떤 절대 임계값보다 정확하다.
 * 실제로 붙은 근거가 이렇다.
 *   제27회 무주반딧불축제 2.5조원  ratio=1046.0x vs 2023 제27회 무주반딧불축제
 *   정동야행축제        3,590억원  ratio=867.1x  vs 2025 정동야행
 *   선농대제            2,380억원  ratio=1220.5x vs 2025 선농대제
 * 10건 전부 2024년 행으로, 그 해 원본이 천원 단위로 기재된 것으로 보인다.
 *
 * 이 플래그를 그대로 쓰는 이유는, 원본이 바로잡혀 다시 임포트되면 VALID로 돌아오고
 * 값이 저절로 다시 쓰이기 때문이다.
 *
 * ⚠️ **다만 이 판정은 2024년 행에만 붙어 있다**(2026-08-27 원본 CSV 전수 확인).
 * 인접 연도 대조가 2024년 시트에만 수행됐기 때문이다. 나머지 9개 연도 — 특히 병합에서
 * 대표값이 되는 최신 연도 — 는 이 플래그로 걸러지지 않는다. 그 구멍은 `isLoneOutlier`가
 * 메운다.
 */
export function isTrustworthyBudget(budgetQualityFlag: string): boolean {
    return budgetQualityFlag === "VALID";
}

/**
 * 방문객 수를 받되, **0 이하는 "미집계"로 보고 버린다.**
 *
 * 원장에 방문객이 0인 행이 653건 있는데 실제로 아무도 오지 않은 것이 아니다.
 *   2026년 이태원 지구촌 축제  예산 30억 / 방문 0명
 *   보성차밭빛축제 2024        방문 0명   (2020년에는 28만명)
 * 집계를 안 했거나 코로나로 열리지 않은 해를 0으로 적어 둔 것이다.
 *
 * 0을 그대로 두면 두 가지가 어긋난다.
 *   1) 화면이 "0명"이라고 단언한다. 근거 축제 표는 null만 "미상"으로 찍는다.
 *   2) **병합의 과거 연도 채우기가 막힌다.** record-source.ts가 `??=`로 빈 항목을 메우는데
 *      0은 nullish가 아니라 건너뛴다. 실측 38건이 이 상태로, 최신 연도의 0 때문에
 *      과거의 실제 실적을 쓰지 못하고 있었다.
 *
 * 그래서 **병합 전에** null로 바꾼다. 그러면 "미상"으로 표시되고, 과거 연도에 실적이 있으면
 * 그 값이 올라온다. 예산의 MISSING_OR_NONPOSITIVE 플래그와 같은 취급이다.
 *
 * 음수는 원장에 없지만(2026-08-26 확인) 같은 조건으로 함께 막는다.
 */
export function trustedVisitorCount(visitors: number | null): number | null {
    return visitors !== null && visitors > 0 ? visitors : null;
}

/**
 * 단일 축제 방문객 상한.
 *
 * 국내 최대 실적이 진해군항제 약 450만명이다. 이를 넘는 값은 통행객을 누적 집계했거나
 * 자릿수가 어긋난 것으로 본다. 어느 쪽이든 1인당 투입비의 분모로 쓸 수 없다.
 * 실측: 이 선을 넘는 15건 중 8건이 2,000만명을 넘는다(최대 3억 6,104만명).
 */
export const MAX_PLAUSIBLE_VISITORS = 5_000_000;

/**
 * 총예산 상한. 연도 간 대조(`isLoneOutlier`)가 **판정할 수 없는 행**을 받는 그물이다.
 *
 * 대조는 비교할 다른 해가 있어야 성립한다. 상한이 유일한 방어선인 경우는 둘이다.
 *   - 원장에 한 해만 등장하는 축제(코퍼스의 48.2%)
 *   - 나머지 연도끼리 3배 넘게 흔들려 판정을 보류한 축제
 *
 * ── 값의 근거 (2026-08-30, 연도 간 대조 적용 후 재측정) ─────────────────
 * 이전 주석은 "정상 최대값 218억(바우덕이축제, 실재)"을 근거로 삼았는데 **그 값이 틀렸다.**
 * 안성맞춤 남사당 바우덕이축제는 2017~2025년이 15~23억이고 2026년만 218.26억이다.
 * 지금은 `isLoneOutlier`가 이 행을 걸러내고 2025년 22.86억이 대표값이 된다.
 *
 * 걸러낸 뒤 코퍼스의 실제 상위 분포는 이렇고, 전부 **실재하는 대형 행사**다.
 *   200.0억  민관군화합페스티벌 (2025, 단일 연도)
 *   196.4억  2022계룡세계군문화엑스포   (2020 부대행사 1.6억 → 2022 본행사)
 *   162.9억  2025영동세계국악엑스포
 *   159.4억  제16회 광주비엔날레        (2024년 151.0억과 정합)
 *   156.4억  영주세계풍기 인삼엑스포
 * 실질 최대가 약 200억이므로 상한 500억은 그 2.5배다. 값 자체는 바꾸지 않았다 —
 * 더 조이면 위 엑스포급 행사의 예산을 지우게 된다.
 *
 * ── 한계 ────────────────────────────────────────────────────────────────
 * 이 상한은 **자릿수가 크게 어긋난 값만** 잡는다. 예산 2억짜리 일회성 축제가 100배로
 * 잘못 적히면 200억이 되는데, 그건 위 엑스포들과 구분되지 않는다. 그런 값을 잡으려면
 * 연도 간 대조가 필요하고, 일회성 축제에는 그 방법이 없다.
 * 현재 이 상한에 걸리는 건수는 0건이다(로그로 확인 가능).
 */
export const MAX_PLAUSIBLE_BUDGET_KRW = 50_000_000_000;

/**
 * 1인당 투입비(총예산 ÷ 방문객)의 타당 범위.
 *
 * 하한 100원: 무료 개방 대형 행사라도 이보다 낮을 수 없다. 예산 1억원이면 방문객이
 *   100만명을 넘어야 나오는 값이다. 실측 하위 1%가 43원으로, 정상 분포에서 떨어져 있다.
 * 상한 100만원: 1인당 100만원을 쓰는 지역축제는 없다. 이 구간은 전부 방문객이
 *   2명·3명·27명처럼 기재되지 않았거나 잘못 들어간 행이다.
 * 중앙값은 6,800원, 상위 5%가 60,000원이라 정상 표본은 넉넉히 안쪽에 들어온다.
 */
export const MIN_PLAUSIBLE_COST_PER_VISITOR = 100;
export const MAX_PLAUSIBLE_COST_PER_VISITOR = 1_000_000;

/**
 * 나머지 연도끼리 이 배율 안쪽으로 일치할 때만 "단독 이상치" 판정을 시도한다.
 * 원래 값이 해마다 크게 출렁이는 축제는 어느 해가 틀렸는지 알 수 없으므로 판정을 보류한다.
 */
const PEER_AGREEMENT_RATIO = 3;

/** 나머지 연도의 중앙값 대비 이 배율 밖이면 그 값 하나만 틀린 것으로 본다. */
const LONE_OUTLIER_RATIO = 5;

/** 판정에 필요한 최소 비교 연도 수. 2개 미만이면 중앙값이 의미가 없다. */
const MIN_PEER_YEARS = 2;

function median(values: number[]): number {
    const s = [...values].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/**
 * 같은 축제의 다른 연도 값과 견주어, 이 값 하나만 자릿수가 어긋났는지 판정한다.
 *
 * ── 왜 직접 하는가 ──────────────────────────────────────────────────────
 * `isTrustworthyBudget`이 신뢰하는 `budgetQualityFlag`의 `UNIT_SCALE_SUSPECT`는
 * **원본 CSV에 2024년 행 10건에만 붙어 있다**(2026-08-27 전수 확인). 인접 연도 대조가
 * 2024년 시트에만 수행됐기 때문이다. 그런데 코퍼스 병합은 **최신 연도를 우선**하므로,
 * 대표값이 될 확률이 가장 높은 2026년 행이 교차검증을 한 번도 받지 않은 행이 된다.
 *   안성맞춤 남사당 바우덕이축제  2017~2025 15~23억 → 2026년만 218.26억  [VALID]
 *   2026 수성못페스티벌          다른 9개 연도 12~24만명 → 2026년만 2,463명
 * 방문객은 아예 품질 플래그가 없어서 어느 해도 대조를 받지 못한다.
 *
 * ── 왜 버리는가(고치지 않고) ────────────────────────────────────────────
 * 중앙값으로 대체하면 없는 실적을 지어내는 것이 된다. **null로 낮추고 병합에 맡긴다.**
 * `record-source.ts`가 `??=`로 빈 항목을 과거 연도에서 채우므로, 결과적으로 그 축제의
 * 정상 연도 값이 대표값으로 올라온다. 0 이하 방문객을 병합 전에 null로 낮추는 것과 같은
 * 처리다 - 모르는 것은 모르는 채로 두고, 아는 해가 있으면 그 해를 쓴다.
 *
 * ── 보수적으로 판정한다 ─────────────────────────────────────────────────
 * 나머지 연도끼리 3배 넘게 흔들리면(성장하는 축제, 코로나 전후) 판정을 보류한다.
 * 부산국제록페스티벌처럼 5억 → 90억으로 **꾸준히** 오른 축제는 걸리지 않는다.
 *
 * @param value      판정 대상 값
 * @param otherYears 같은 축제의 다른 연도 값들(양수만). 자기 자신은 빼고 넘길 것.
 */
export function isLoneOutlier(value: number, otherYears: number[]): boolean {
    const peers = otherYears.filter((v) => v > 0);
    if (peers.length < MIN_PEER_YEARS) return false;

    const max = Math.max(...peers);
    const min = Math.min(...peers);
    if (min <= 0 || max / min > PEER_AGREEMENT_RATIO) return false;

    const center = median(peers);
    if (center <= 0) return false;

    const ratio = value / center;
    return ratio >= LONE_OUTLIER_RATIO || ratio <= 1 / LONE_OUTLIER_RATIO;
}

/** 무효화 사유별 건수. 원본이 정상화되면 전부 0이 된다. */
export interface SuppressionCounts {
    /** 임포터가 VALID로 보지 않은 예산을 버린 행 수(원장 행 기준) */
    budgetQualityFlag: number;
    /** 연도 간 대조에서 단독 이상치로 판정해 버린 예산 행 수 */
    crossYearBudget: number;
    /** 연도 간 대조에서 단독 이상치로 판정해 버린 방문객 행 수 */
    crossYearVisitors: number;
    /** 0 이하라 미집계로 본 방문객 수(원장 행 기준) */
    nonPositiveVisitors: number;
    /** 방문객이 상한을 넘어 버린 건수 */
    visitors: number;
    /** 예산이 상한을 넘어 버린 건수 */
    budget: number;
    /** 1인당 투입비가 타당 범위를 벗어나 방문객을 버린 건수 */
    costPerVisitor: number;
}

export function createSuppressionCounts(): SuppressionCounts {
    return {
        budgetQualityFlag: 0,
        crossYearBudget: 0,
        crossYearVisitors: 0,
        nonPositiveVisitors: 0,
        visitors: 0,
        budget: 0,
        costPerVisitor: 0,
    };
}

/**
 * 레코드 1건에서 신뢰할 수 없는 숫자 필드를 제자리에서 null로 바꾼다.
 *
 * 순서가 중요하다. 절대 상한을 먼저 걷어내야 남은 값으로 1인당 투입비를 판정할 수 있다.
 *
 * @param record 코호트 병합이 끝난 레코드. 이 함수가 직접 수정한다.
 * @param counts 사유별 건수 누적기.
 */
export function suppressImplausibleValues(record: PlannerRecord, counts: SuppressionCounts): void {
    if (record.visitors !== null && record.visitors > MAX_PLAUSIBLE_VISITORS) {
        record.visitors = null;
        counts.visitors += 1;
    }

    if (record.totalBudgetKrw !== null && record.totalBudgetKrw > MAX_PLAUSIBLE_BUDGET_KRW) {
        record.totalBudgetKrw = null;
        counts.budget += 1;
    }

    // 두 값이 서로 모순되는 경우. 예산 쪽이 더 믿을 만하므로 방문객을 버린다(위 주석 참고).
    if (record.totalBudgetKrw !== null && record.totalBudgetKrw > 0 && record.visitors !== null && record.visitors > 0) {
        const costPerVisitor = record.totalBudgetKrw / record.visitors;
        if (costPerVisitor < MIN_PLAUSIBLE_COST_PER_VISITOR || costPerVisitor > MAX_PLAUSIBLE_COST_PER_VISITOR) {
            record.visitors = null;
            counts.costPerVisitor += 1;
        }
    }
}

/**
 * 로그 한 줄. 무효화한 값이 하나도 없으면 null을 돌려준다.
 * 원본 CSV가 바로잡히면 이 로그가 사라지는 것이 곧 임시 조치를 걷어도 된다는 신호다.
 */
export function describeSuppression(counts: SuppressionCounts, totalRecords: number): string | null {
    const total =
        counts.budgetQualityFlag +
        counts.crossYearBudget +
        counts.crossYearVisitors +
        counts.nonPositiveVisitors +
        counts.visitors +
        counts.budget +
        counts.costPerVisitor;
    if (total === 0) return null;

    return (
        `[planner] 신뢰할 수 없는 값 ${total}건을 통계에서 제외했습니다 - ` +
        `원장 행 기준 예산 품질 플래그 ${counts.budgetQualityFlag}건, 방문객 0 이하 ${counts.nonPositiveVisitors}건, ` +
        `연도 간 대조 단독 이상치 예산 ${counts.crossYearBudget}건·방문객 ${counts.crossYearVisitors}건. ` +
        `축제 ${totalRecords}건 기준 예산 상한 초과 ${counts.budget}건, ` +
        `방문객 상한 초과 ${counts.visitors}건, 1인당 투입비 이상 ${counts.costPerVisitor}건. ` +
        `원본이 정상화되면 이 로그는 사라집니다 (lib/planner/data-quality.ts).`
    );
}
