import { prisma } from "@/lib/db/prisma";
import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import {
    SuppressionCounts,
    createSuppressionCounts,
    describeSuppression,
    isLoneOutlier,
    isTrustworthyBudget,
    suppressImplausibleValues,
    trustedVisitorCount,
} from "./data-quality";
import { buildKeywordVocabulary, extractKeywords } from "./keyword-mining";
import { parseStartMonth } from "./period-parse";
import { PlannerRecord } from "./types";

export interface PlannerCorpus {
    /** 코퍼스에 포함된 가장 최근 데이터셋 연도 */
    datasetYear: number;
    /** 코퍼스가 포괄하는 연도 범위 [최소, 최대] */
    datasetYearRange: [number, number];
    records: PlannerRecord[];
    /** 소재 토큰 → 코퍼스 등장 횟수 */
    vocabulary: Map<string, number>;
    districtNames: string[];
    /**
     * 원본 값 오류로 통계에서 제외한 필드 수(./data-quality.ts).
     * 원본 CSV가 정상화되면 전부 0이 되고, 그때 임시 조치를 걷어도 된다.
     */
    suppressed: SuppressionCounts;
}

/**
 * 코퍼스는 요청마다 다시 만들 필요가 없다(연 1회 갱신되는 정적 데이터셋).
 * dev의 HMR에서도 살아남도록 globalThis에 캐시한다 - lib/db/prisma.ts와 같은 방식.
 */
const globalForCorpus = globalThis as unknown as { plannerCorpus?: PlannerCorpus };

export function invalidatePlannerCorpus(): void {
    globalForCorpus.plannerCorpus = undefined;
}

/**
 * 회차·연도·공백을 걷어낸 축제 동일성 키.
 * "제25회 서울억새축제"와 "2024 서울억새축제"를 같은 축제로 묶는다.
 *
 * 회차 접두사는 `재`도 받는다. 원본에 "재41회 금산세계인삼축제"처럼 제/재를 혼동한
 * 표기가 4건 있어(2026-08-26 확인) 이것을 걸러내지 않으면 같은 축제가 "재금산세계인삼축제"와
 * "금산세계인삼축제"로 쪼개진다. 쪼개지면 최신 연도 우선 병합이 깨져 2026년 예산 11억 대신
 * 2025년의 자릿수 오류값 350억이 대표값으로 남는다.
 */
function identityKey(region: string | null, festivalName: string): string {
    const name = festivalName
        .normalize("NFC")
        .replace(/[제재]?\s*\d+\s*(회|주년|차|번째)/g, "")
        .replace(/(19|20)\d{2}\s*년?/g, "")
        .replace(/[\s\-–—~!?:,./&()（）[\]'"]/g, "");
    return `${region ?? "?"}|${name}`;
}

/** 다년도 유형(7종)을 플래너 유형(5종)으로 좁힌다. OTHER/UNKNOWN은 매핑하지 않는다. */
function toPlannerType(types: { type: string }[]): FestivalType | null {
    for (const t of types) {
        if ((Object.values(FestivalType) as string[]).includes(t.type)) return t.type as FestivalType;
    }
    return null;
}


/**
 * 다년도 원장(MultiYearFestivalRecord, 2017~2026 10,198행)에서 플래너 코퍼스를 만든다.
 *
 * **같은 축제가 해마다 한 행씩 쌓여 있다.** 그대로 쓰면 "전국 문화예술 축제 3,276건"처럼
 * 건수가 개최 횟수만큼 부풀어 카드 문구가 틀린 말을 하게 된다. 그래서 축제 동일성
 * (지역 + 회차/연도를 뗀 이름)으로 묶어 **축제 1개당 1행**으로 만든다.
 * 실측(2026-08-26): 10,198행 -> 유니크 축제 3,582개.
 *
 * 필드는 **최신 연도를 우선하되 비어 있으면 과거에서 채운다**. 원본의 항목 구성이
 * 해마다 달라 이렇게 해야 손실이 적다:
 *   - venue_type : 2025~2026에만 있다(그 이전은 원본에 항목 자체가 없음)
 *   - duration_days : 2022~2024가 전부 비어 있다
 *   - startMonth : 컬럼이 없어 period_raw에서 파생한다(./period-parse.ts, 실측 정확도 99.8%)
 */
export async function loadPlannerCorpus(): Promise<PlannerCorpus> {
    if (globalForCorpus.plannerCorpus) return globalForCorpus.plannerCorpus;

    const rows = await prisma.multiYearFestivalRecord.findMany({
        // 최신 연도가 먼저 오게 해서, 그룹의 첫 행을 대표로 삼는다.
        orderBy: [{ datasetYear: "desc" }, { id: "asc" }],
        select: {
            id: true,
            datasetYear: true,
            festivalName: true,
            region: true,
            district: true,
            types: { select: { type: true } },
            venueType: true,
            periodRaw: true,
            durationDays: true,
            budgetTotalKrw: true,
            budgetQualityFlag: true,
            visitorTotalPersons: true,
        },
    });

    if (rows.length === 0) {
        const empty: PlannerCorpus = {
            datasetYear: 0,
            datasetYearRange: [0, 0],
            records: [],
            vocabulary: new Map(),
            districtNames: [],
            suppressed: createSuppressionCounts(),
        };
        globalForCorpus.plannerCorpus = empty;
        return empty;
    }

    const years = rows.map((r) => r.datasetYear);
    const datasetYear = Math.max(...years);
    const datasetYearRange: [number, number] = [Math.min(...years), datasetYear];

    // ── 연도 간 대조를 위해 먼저 축제별로 원장 행을 모아 둔다.
    //
    // 원본의 `budgetQualityFlag`가 담은 인접 연도 대조는 2024년 시트에만 수행됐고
    // (UNIT_SCALE_SUSPECT 10건 전부 2024년), 방문객에는 그런 판정이 아예 없다.
    // 그런데 아래 병합은 최신 연도를 우선하므로 **대표값이 될 행이 검증을 못 받은 행**이다.
    // 그래서 같은 판정을 여기서 직접 한다(./data-quality.ts의 isLoneOutlier).
    const rowsByFestival = new Map<string, typeof rows>();
    for (const row of rows) {
        const key = identityKey(row.region, row.festivalName);
        const group = rowsByFestival.get(key);
        if (group) group.push(row);
        else rowsByFestival.set(key, [row]);
    }

    /** 같은 축제의 **다른 행**들이 가진 값. 자기 자신은 id로 제외한다(값이 같은 해가 있을 수 있다). */
    const peerValues = (
        row: (typeof rows)[number],
        pick: (r: (typeof rows)[number]) => number | null
    ): number[] => {
        const group = rowsByFestival.get(identityKey(row.region, row.festivalName)) ?? [];
        const out: number[] = [];
        for (const other of group) {
            if (other.id === row.id) continue;
            const value = pick(other);
            if (value !== null && value > 0) out.push(value);
        }
        return out;
    };

    // ── 축제 동일성으로 묶고, 필드별로 "가장 최근의 값이 있는 해"를 채택한다.
    const merged = new Map<string, PlannerRecord>();
    const suppressed = createSuppressionCounts();

    /**
     * 예산은 임포터가 VALID로 판정한 행의 값만 받는다(./data-quality.ts).
     * **병합 전에** 걸러야 한다. 자릿수가 어긋난 값이 대표값 자리를 차지한 뒤에는
     * 정상 연도의 값을 다시 끌어올 수 없기 때문이다.
     * BigInt는 JSON 직렬화가 안 되므로 경계에서 number로 낮춘다.
     */
    const trustedBudget = (row: (typeof rows)[number]): number | null => {
        if (row.budgetTotalKrw === null) return null;
        if (!isTrustworthyBudget(row.budgetQualityFlag)) {
            suppressed.budgetQualityFlag += 1;
            return null;
        }
        const value = Number(row.budgetTotalKrw);
        // 임포터가 보지 못한 연도의 자릿수 오류. 버리면 `??=`가 정상 연도를 끌어온다.
        if (isLoneOutlier(value, peerValues(row, (r) => (r.budgetTotalKrw === null ? null : Number(r.budgetTotalKrw))))) {
            suppressed.crossYearBudget += 1;
            return null;
        }
        return value;
    };

    /**
     * 방문객 0은 "아무도 안 왔다"가 아니라 미집계다(./data-quality.ts).
     * 예산과 같은 이유로 **병합 전에** null로 낮춰야 한다. 0인 채로 대표값이 되면
     * `??=`가 nullish만 채우므로 과거 연도의 실제 실적을 영영 끌어올 수 없다.
     */
    const trustedVisitors = (row: (typeof rows)[number]): number | null => {
        const value = trustedVisitorCount(row.visitorTotalPersons);
        if (value === null) {
            if (row.visitorTotalPersons !== null) suppressed.nonPositiveVisitors += 1;
            return null;
        }
        // 방문객에는 원장 품질 플래그가 없다. 연도 간 대조가 유일한 판정 수단이다.
        if (isLoneOutlier(value, peerValues(row, (r) => r.visitorTotalPersons))) {
            suppressed.crossYearVisitors += 1;
            return null;
        }
        return value;
    };

    for (const row of rows) {
        // 지역을 못 매핑한 행과 플래너 5개 유형에 없는 행(OTHER/UNKNOWN)은 제외한다.
        // 억지로 끼워 넣으면 코호트 통계가 오염된다.
        // Prisma 생성 enum과 도메인 enum은 값이 같지만 타입이 별개다(이전 구현과 동일하게 캐스팅).
        const region = row.region as Region | null;
        if (region === null) continue;
        const festivalType = toPlannerType(row.types);
        if (festivalType === null) continue;

        const key = identityKey(region, row.festivalName);
        const existing = merged.get(key);

        if (!existing) {
            merged.set(key, {
                id: row.id,
                festivalName: row.festivalName,
                region,
                district: row.district,
                festivalType,
                // 2024년 이전 원본에는 장소 유형 항목이 없다. UNDECIDED로 두면
                // whitespace의 장소 축에서 자동으로 제외된다(./whitespace.ts).
                venueType: (row.venueType as VenueType | null) ?? VenueType.UNDECIDED,
                startMonth: parseStartMonth(row.periodRaw, row.datasetYear),
                durationDays: row.durationDays,
                totalBudgetKrw: trustedBudget(row),
                visitors: trustedVisitors(row),
                // rows가 datasetYear 내림차순이라 그룹의 첫 행이 곧 마지막 등장 연도다.
                lastSeenYear: row.datasetYear,
                keywords: [],
            });
            continue;
        }

        // 이미 최신 연도 행이 자리를 잡았다. 빈 항목만 과거 연도에서 메운다.
        existing.district ??= row.district;
        if (existing.venueType === VenueType.UNDECIDED && row.venueType)
            existing.venueType = row.venueType as VenueType;
        existing.startMonth ??= parseStartMonth(row.periodRaw, row.datasetYear);
        existing.durationDays ??= row.durationDays;
        existing.totalBudgetKrw ??= trustedBudget(row);
        existing.visitors ??= trustedVisitors(row);
    }

    const records = [...merged.values()];
    const districtNames = [...new Set(records.map((r) => r.district).filter((d): d is string => !!d))];

    const vocabulary = buildKeywordVocabulary(
        records.map((r) => r.festivalName),
        districtNames
    );
    // 값 자체의 타당성은 병합이 끝난 뒤에 본다. 필드마다 채택 연도가 달라(위 ④ 참고)
    // 병합 전 값으로 보면 실제로 쓰이지 않을 값까지 세게 된다.
    for (const record of records) {
        record.keywords = extractKeywords(record.festivalName, vocabulary, districtNames);
        suppressImplausibleValues(record, suppressed);
    }
    const suppressionNote = describeSuppression(suppressed, records.length);
    if (suppressionNote) console.warn(suppressionNote);

    const corpus: PlannerCorpus = {
        datasetYear,
        datasetYearRange,
        records,
        vocabulary,
        districtNames,
        suppressed,
    };
    globalForCorpus.plannerCorpus = corpus;
    return corpus;
}
