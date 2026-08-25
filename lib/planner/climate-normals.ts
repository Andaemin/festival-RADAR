import * as fs from "node:fs";
import * as path from "node:path";
import { Region } from "@/lib/domain/enums";

/**
 * 기상청 30년 기후평년값(1991~2020) — 시도별 월평균 기온·강수량.
 *
 * 기획 추천은 "그 지역 N월이 한산하다"까지만 말할 수 있고, **그 달에 야외 행사를 여는 게
 * 현실적인지**는 모른다. 이 데이터가 그 빈칸을 메운다. 숫자를 바꾸지는 않고 경고 문구만 붙인다.
 *
 * 출처: 기상자료개방포털 > 기후통계분석 > 평년값 > 우리나라 기후평년값 (월별평년값).
 * 월별로 12개 파일을 받아 `prisma/data/climate_normals_1991_2020.csv` 하나로 합쳐 두었다
 * (219개 지점 x 12개월 = 2,628행, UTF-8).
 *
 * **예보가 아니라 30년 평년값이라 2027년 기획에도 그대로 쓸 수 있다.** 갱신 주기도
 * 10년이라 사실상 정적 데이터다.
 */

const CSV_PATH = path.join(process.cwd(), "prisma", "data", "climate_normals_1991_2020.csv");

/**
 * 시도 -> 대표 관측지점 번호.
 *
 * 기상 데이터는 행정구역이 아니라 관측지점 단위라 대표를 골라야 한다. 원칙은
 * **도청·시청 소재지에 가장 가까운, 12개월 결측이 없는 지점**이다.
 * (시도 내 지점을 평균하면 대관령 같은 산간이 강원 전체를 끌어내려 왜곡된다.)
 *
 * 2026-08-25 전수 확인: 219개 지점 중 기온·강수량 결측이 있는 곳은 대구(143) 하나뿐이라
 * 대구는 도심 관측소인 신암(860)으로 대체했다.
 * 전주·홍성에는 관측소가 없어 각각 완주(734)·예산(628)을 쓴다 - 둘 다 도청에서 15km 이내다.
 */
const STATION_ID: Record<Region, string> = {
    [Region.SEOUL]: "108", // 서울
    [Region.BUSAN]: "159", // 부산
    [Region.DAEGU]: "860", // 신암 (대구 143은 강수량 결측)
    [Region.INCHEON]: "112", // 인천
    [Region.GWANGJU]: "156", // 광주
    [Region.DAEJEON]: "133", // 대전
    [Region.ULSAN]: "152", // 울산
    [Region.SEJONG]: "611", // 세종연서
    [Region.GYEONGGI]: "119", // 수원 (도청)
    [Region.GANGWON]: "101", // 춘천 (도청)
    [Region.CHUNGBUK]: "131", // 청주 (도청)
    [Region.CHUNGNAM]: "628", // 예산 (내포 도청 인근, 홍성 관측소 없음)
    [Region.JEONBUK]: "734", // 완주 (전주 관측소 없음)
    [Region.JEONNAM]: "165", // 목포 (무안 도청 인근)
    [Region.GYEONGBUK]: "136", // 안동 (도청)
    [Region.GYEONGNAM]: "155", // 창원 (도청)
    [Region.JEJU]: "184", // 제주
};

export interface MonthlyNormal {
    month: number;
    avgTempC: number;
    maxTempC: number | null;
    minTempC: number | null;
    precipitationMm: number;
}

export interface RegionClimate {
    stationName: string;
    /** 1~12월. 결측 월은 담지 않는다. */
    byMonth: Map<number, MonthlyNormal>;
    /** 강수량이 많은 순서로 매긴 월 순위. 1위 = 가장 많이 온다. */
    precipitationRank: Map<number, number>;
}

export type ClimateNormals = Map<Region, RegionClimate>;

/** 정적 파일이라 한 번만 읽는다. dev의 HMR에서도 살아남도록 globalThis에 둔다. */
const globalForClimate = globalThis as unknown as { climateNormals?: ClimateNormals };

function toNumber(v: string | undefined): number | null {
    const n = Number((v ?? "").trim());
    return (v ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
}

/**
 * 평년값 CSV를 읽어 시도별로 정리한다.
 * 파일이 없으면 **빈 Map을 돌려준다** - 기후 경고는 부가 기능이므로 추천 자체를 막지 않는다.
 */
export function loadClimateNormals(): ClimateNormals {
    if (globalForClimate.climateNormals) return globalForClimate.climateNormals;

    const result: ClimateNormals = new Map();
    if (!fs.existsSync(CSV_PATH)) {
        globalForClimate.climateNormals = result;
        return result;
    }

    const wanted = new Map(Object.entries(STATION_ID).map(([region, id]) => [id, region as Region]));
    const lines = fs.readFileSync(CSV_PATH, "utf-8").replace(/^\uFEFF/, "").split(/\r?\n/);
    const header = lines[0].split(",");
    const col = (name: string) => header.indexOf(name);
    const iId = col("station_id");
    const iName = col("station_name");
    const iMonth = col("month");
    const iAvg = col("avg_temp_c");
    const iMax = col("max_temp_c");
    const iMin = col("min_temp_c");
    const iPrcp = col("precipitation_mm");

    for (const line of lines.slice(1)) {
        if (!line.trim()) continue;
        const cells = line.split(",");
        const region = wanted.get(cells[iId]?.trim());
        if (!region) continue;

        const month = toNumber(cells[iMonth]);
        const avgTempC = toNumber(cells[iAvg]);
        const precipitationMm = toNumber(cells[iPrcp]);
        if (month === null || avgTempC === null || precipitationMm === null) continue;

        const entry =
            result.get(region) ??
            ({ stationName: cells[iName]?.trim() ?? "", byMonth: new Map(), precipitationRank: new Map() } as RegionClimate);
        entry.byMonth.set(month, {
            month,
            avgTempC,
            maxTempC: toNumber(cells[iMax]),
            minTempC: toNumber(cells[iMin]),
            precipitationMm,
        });
        result.set(region, entry);
    }

    // 강수량 순위는 지역 안에서 매긴다("연중 3위로 비가 많다"는 표현을 쓰기 위해).
    for (const climate of result.values()) {
        const sorted = [...climate.byMonth.values()].sort((a, b) => b.precipitationMm - a.precipitationMm);
        sorted.forEach((m, i) => climate.precipitationRank.set(m.month, i + 1));
    }

    globalForClimate.climateNormals = result;
    return result;
}

/** 강수량 순위가 이 안에 들면 "비가 많은 달"로 경고한다. */
const WET_RANK_THRESHOLD = 3;
/** 평균기온이 이 아래면 야외 행사에 부담이 된다. */
const COLD_TEMP_C = 5;
/** 평균기온이 이 위면 폭염 부담이 된다. */
const HOT_TEMP_C = 25;

/**
 * 해당 지역·월의 기후 특성을 한 문장으로 만든다.
 * 특이사항이 없으면 null - 굳이 "평범합니다"를 카드에 넣지 않는다.
 */
export function describeMonthClimate(
    normals: ClimateNormals,
    region: Region,
    month: number
): string | null {
    const climate = normals.get(region);
    const entry = climate?.byMonth.get(month);
    if (!climate || !entry) return null;

    const notes: string[] = [];
    const rank = climate.precipitationRank.get(month);
    if (rank !== undefined && rank <= WET_RANK_THRESHOLD) {
        notes.push(
            rank === 1
                ? `강수량 ${entry.precipitationMm.toFixed(0)}mm로 연중 가장 비가 많습니다`
                : `강수량 ${entry.precipitationMm.toFixed(0)}mm로 연중 ${rank}번째로 비가 많습니다`
        );
    }
    if (entry.avgTempC <= COLD_TEMP_C) {
        notes.push(`평균기온 ${entry.avgTempC.toFixed(1)}℃로 야외 체류가 어렵습니다`);
    } else if (entry.avgTempC >= HOT_TEMP_C) {
        notes.push(`평균기온 ${entry.avgTempC.toFixed(1)}℃로 폭염 대비가 필요합니다`);
    }
    if (notes.length === 0) return null;

    return `${month}월 ${climate.stationName} 기준 평년값: ${notes.join(", ")}. (기상청 1991~2020 평년값)`;
}
