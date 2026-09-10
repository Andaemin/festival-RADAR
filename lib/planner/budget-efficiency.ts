import { BudgetEfficiencySummary, BudgetScatterPoint, PlannerRecord, ReferenceFestival } from "./types";
import { toReferenceFestival } from "./reference";

/**
 * 방문객 대비 예산 효율(1인당 투입비 = 총예산 / 직전 방문객 수).
 *
 * 낮을수록 같은 돈으로 더 많은 방문객을 모았다는 뜻이다. 다만 이 지표만으로 축제의
 * 성패를 판단하면 안 된다 - 방문객 수는 집계 방식이 제각각이고(추산/실측), 무료 개방
 * 대형 행사가 유리하게 나온다. 그래서 화면에는 항상 중앙값과 함께 표본 수를 같이 보여준다.
 */

/** 이 인원 미만은 분모가 불안정해 제외한다. */
const MIN_VISITORS = 1_000;

/**
 * 산점도에 실어 보낼 점의 상한.
 *
 * 전국 코호트는 문화예술만 1,152건이라 그대로 보내면 응답이 부풀고 점도 뭉갠다.
 * 넘칠 때는 1인당 투입비 순으로 줄 세운 뒤 균등 간격으로 솎아낸다 - 앞에서 자르면
 * 저비용 쪽만 남아 분포가 왜곡되기 때문이다.
 */
const MAX_SCATTER_POINTS = 250;

/** 상·하위 이상치를 이 분위수로 절단(winsorize)한다. */
const WINSOR_LOW = 0.05;
const WINSOR_HIGH = 0.95;

export function costPerVisitor(record: PlannerRecord): number | null {
    if (record.totalBudgetKrw === null || record.totalBudgetKrw <= 0) return null;
    if (record.visitors === null || record.visitors < MIN_VISITORS) return null;
    return record.totalBudgetKrw / record.visitors;
}

function quantile(sorted: number[], q: number): number | null {
    if (sorted.length === 0) return null;
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sorted[base + 1];
    return next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}

export function summarizeBudgetEfficiency(
    cohort: PlannerRecord[],
    /** cohort가 지역 것인지 전국 것인지. 계산에는 쓰지 않고 화면 문구 판단에만 쓴다. */
    cohortScope: BudgetEfficiencySummary["cohortScope"]
): BudgetEfficiencySummary {
    const scored = cohort
        .map((r) => ({ record: r, cpv: costPerVisitor(r) }))
        .filter((x): x is { record: PlannerRecord; cpv: number } => x.cpv !== null);

    if (scored.length === 0) {
        return {
            medianCostPerVisitorKrw: null,
            p25CostPerVisitorKrw: null,
            p75CostPerVisitorKrw: null,
            sampleCount: 0,
            cohortScope,
            topEfficient: [],
            scatter: [],
        };
    }

    const values = scored.map((x) => x.cpv).sort((a, b) => a - b);

    // 이상치 절단 후 통계를 낸다. 표본이 적으면 절단이 오히려 왜곡하므로 20건 이상일 때만.
    const trimmed =
        values.length >= 20
            ? values.slice(
                  Math.floor(values.length * WINSOR_LOW),
                  Math.ceil(values.length * WINSOR_HIGH)
              )
            : values;

    const round = (n: number | null) => (n === null ? null : Math.round(n));

    // 효율 상위: 1인당 투입비가 낮으면서 방문객이 코호트 중앙값 이상인 축제.
    const visitorMedian =
        quantile(
            scored.map((x) => x.record.visitors ?? 0).sort((a, b) => a - b),
            0.5
        ) ?? 0;

    const topEfficient: ReferenceFestival[] = scored
        .filter((x) => (x.record.visitors ?? 0) >= visitorMedian)
        .sort((a, b) => a.cpv - b.cpv)
        .slice(0, 5)
        .map((x) => toReferenceFestival(x.record));

    const byCpv = [...scored].sort((a, b) => a.cpv - b.cpv);
    const step = Math.ceil(byCpv.length / MAX_SCATTER_POINTS);
    const scatter: BudgetScatterPoint[] = byCpv
        .filter((_, i) => i % step === 0)
        .map((x) => ({
            festivalName: x.record.festivalName,
            // costPerVisitor()를 통과했으므로 두 값 모두 유효한 양수다.
            totalBudgetKrw: x.record.totalBudgetKrw as number,
            visitors: x.record.visitors as number,
            costPerVisitorKrw: Math.round(x.cpv),
        }));

    return {
        medianCostPerVisitorKrw: round(quantile(trimmed, 0.5)),
        p25CostPerVisitorKrw: round(quantile(trimmed, 0.25)),
        p75CostPerVisitorKrw: round(quantile(trimmed, 0.75)),
        sampleCount: scored.length,
        cohortScope,
        topEfficient,
        scatter,
    };
}
