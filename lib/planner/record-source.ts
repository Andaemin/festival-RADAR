import { prisma } from "@/lib/db/prisma";
import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { buildKeywordVocabulary, extractKeywords } from "./keyword-mining";
import { PlannerRecord } from "./types";

export interface PlannerCorpus {
    datasetYear: number;
    records: PlannerRecord[];
    /** 소재 토큰 → 코퍼스 등장 횟수 */
    vocabulary: Map<string, number>;
    districtNames: string[];
}

/**
 * 코퍼스는 요청마다 다시 만들 필요가 없다(연 1회 갱신되는 정적 데이터셋).
 * dev의 HMR에서도 살아남도록 globalThis에 캐시한다 - lib/db/prisma.ts와 같은 방식.
 */
const globalForCorpus = globalThis as unknown as { plannerCorpus?: PlannerCorpus };

export function invalidatePlannerCorpus(): void {
    globalForCorpus.plannerCorpus = undefined;
}

export async function loadPlannerCorpus(): Promise<PlannerCorpus> {
    if (globalForCorpus.plannerCorpus) return globalForCorpus.plannerCorpus;

    const latest = await prisma.festivalRecord.aggregate({ _max: { datasetYear: true } });
    const datasetYear = latest._max.datasetYear ?? 0;

    const rows =
        datasetYear === 0
            ? []
            : await prisma.festivalRecord.findMany({
                  where: { datasetYear },
                  orderBy: { id: "asc" },
                  select: {
                      id: true,
                      festivalName: true,
                      region: true,
                      administrativeDistrict: true,
                      festivalType: true,
                      venueType: true,
                      startMonth: true,
                      durationDays: true,
                      totalBudgetKrw: true,
                      previousVisitors: true,
                  },
              });

    const districtNames = [
        ...new Set(rows.map((r) => r.administrativeDistrict).filter((d): d is string => !!d)),
    ];

    const vocabulary = buildKeywordVocabulary(
        rows.map((r) => r.festivalName),
        districtNames
    );

    const records: PlannerRecord[] = rows.map((r) => ({
        id: r.id,
        festivalName: r.festivalName,
        region: r.region as Region,
        district: r.administrativeDistrict,
        festivalType: r.festivalType as FestivalType,
        venueType: r.venueType as VenueType,
        startMonth: r.startMonth,
        durationDays: r.durationDays,
        // BigInt는 JSON 직렬화가 안 되므로 경계에서 number로 낮춘다.
        // 예산은 최대 수천억 원 규모라 Number.MAX_SAFE_INTEGER를 넘지 않는다.
        totalBudgetKrw: r.totalBudgetKrw !== null ? Number(r.totalBudgetKrw) : null,
        visitors: r.previousVisitors,
        keywords: extractKeywords(r.festivalName, vocabulary, districtNames),
    }));

    const corpus: PlannerCorpus = { datasetYear, records, vocabulary, districtNames };
    globalForCorpus.plannerCorpus = corpus;
    return corpus;
}
