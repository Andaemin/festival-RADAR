import { prisma } from "@/lib/db/prisma";
import { FestivalType, Region, VenueType } from "@/lib/domain/enums";
import { FestivalRecord } from "@/lib/domain/types";

/**
 * 다년도 원장(MultiYearFestivalRecord, 2017~2026)에서 도메인 `FestivalRecord` 형태로 읽는다.
 *
 * 원래 이 자리에는 `prisma.festivalRecord`(2026년 단일 연도 표)가 있었다. 플래너 코퍼스가
 * 다년도 표로 옮겨간 뒤(lib/planner/record-source.ts) 남은 소비처들도 같은 표를 보게 해서,
 * 옛 표를 걷어낼 수 있도록 한 어댑터다.
 *
 * **의미를 바꾸지 않는 것이 원칙이다.** 예산 추정기는 원래 "최신 연도 + 예산 확정분"만
 * 봤으므로 여기서도 그대로 유지한다. 전 연도를 넣으면 결과가 달라지는데, 그건 표를
 * 옮기는 작업의 범위가 아니다(다년도 추정은 lib/multiyear/*가 따로 담당한다).
 *
 * 매핑 시 주의:
 *   - `festivalType`은 관계 테이블이고 OTHER/UNKNOWN이 섞여 있다. 도메인 enum 5종에
 *     없는 값은 **제외**한다(억지로 끼워 넣으면 코호트가 오염된다).
 *   - `venueType`은 2024년 이전 원본에 항목 자체가 없어 null이다. UNDECIDED로 채운다.
 *   - 옛 표의 `budgetStatus: CONFIRMED`에 대응하는 값은 `budgetQualityFlag: VALID`다.
 */

/** 다년도 원장에 적재된 가장 최근 데이터셋 연도. 없으면 0. */
export async function getLatestDatasetYear(): Promise<number> {
    const latest = await prisma.multiYearFestivalRecord.aggregate({ _max: { datasetYear: true } });
    return latest._max.datasetYear ?? 0;
}

/** 도메인 enum 5종에 해당하는 유형만 고른다. OTHER/UNKNOWN이면 null. */
function toDomainType(types: { type: string }[]): FestivalType | null {
    for (const t of types) {
        if ((Object.values(FestivalType) as string[]).includes(t.type)) return t.type as FestivalType;
    }
    return null;
}

export interface LoadFestivalRecordsOptions {
    /** 지정하면 해당 연도만. 생략하면 전 연도. */
    datasetYear?: number;
    /** 예산 품질이 VALID인 행만 (옛 `budgetStatus: CONFIRMED`에 대응). */
    budgetValidOnly?: boolean;
}

export async function loadFestivalRecords(
    options: LoadFestivalRecordsOptions = {}
): Promise<FestivalRecord[]> {
    const rows = await prisma.multiYearFestivalRecord.findMany({
        where: {
            ...(options.datasetYear !== undefined ? { datasetYear: options.datasetYear } : {}),
            ...(options.budgetValidOnly ? { budgetQualityFlag: "VALID" } : {}),
        },
        orderBy: { id: "asc" },
        select: {
            id: true,
            datasetYear: true,
            festivalName: true,
            region: true,
            district: true,
            types: { select: { type: true } },
            venueType: true,
            durationDays: true,
            budgetTotalKrw: true,
        },
    });

    const records: FestivalRecord[] = [];
    for (const row of rows) {
        const region = row.region as Region | null;
        if (region === null) continue;
        const festivalType = toDomainType(row.types);
        if (festivalType === null) continue;

        records.push({
            id: row.id,
            datasetYear: row.datasetYear,
            festivalName: row.festivalName,
            region,
            administrativeDistrict: row.district,
            festivalType,
            venueType: (row.venueType as VenueType | null) ?? VenueType.UNDECIDED,
            durationDays: row.durationDays,
            totalBudgetKrw: row.budgetTotalKrw,
        });
    }
    return records;
}

/**
 * 시군구 표기로 인정할 형태.
 *   "광진구" "평택시" "군위군"  그리고 "수원시 장안구"처럼 자치구가 붙는 경우까지.
 *
 * 전 연도 원본에는 시군구 자리에 조직명("서울관광재단", "인천도시공사"), placeholder 잔재
 * ("본청", "시자체,북구", "민간"), 읍면동("제주시 건입동")이 섞여 있다. 선택지에 그대로
 * 노출되면 사용자가 고를 수 없는 값이 되므로 형태로 거른다.
 */
const DISTRICT_SHAPE = /^[가-힣]+[시군구]$|^[가-힣]+시 [가-힣]+구$/;

/**
 * 지역별 시군구 목록. **전 연도를 훑는다** - 플래너 코퍼스가 2017~2026을 보게 됐으므로
 * 선택지도 같은 범위를 덮어야 과거에만 등장한 시군구가 빠지지 않는다.
 * (실측: 2026년만 보면 217개, 전 연도를 보면 서울 자치구 대부분과 제주시·서귀포시가 더해진다.)
 *
 * 원본의 오타("김친시", "에산군")까지 고쳐주지는 않는다. 지어낸 교정은 더 위험하다.
 */
export async function loadDistrictsByRegion(): Promise<Record<string, string[]>> {
    const rows = await prisma.multiYearFestivalRecord.findMany({
        where: { region: { not: null }, district: { not: null } },
        select: { region: true, district: true },
        distinct: ["region", "district"],
    });

    const byRegion: Record<string, Set<string>> = {};
    for (const r of rows) {
        if (!r.region || !r.district) continue;
        const district = r.district.trim();
        if (!DISTRICT_SHAPE.test(district)) continue;
        (byRegion[r.region] ??= new Set()).add(district);
    }
    return Object.fromEntries(
        Object.entries(byRegion).map(([region, set]) => [region, [...set].sort()])
    );
}
