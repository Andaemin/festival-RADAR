import { NextRequest, NextResponse } from "next/server";
import {
    fetchConcentrationRates,
    AREA_CODES,
    SIGNGU_CODES,
} from "@/lib/external/concentration-api";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const areaCd = searchParams.get("areaCd");
    const signguCd = searchParams.get("signguCd");
    const tAtsNm = searchParams.get("tAtsNm") ?? undefined;
    const pageNo = Number(searchParams.get("pageNo") ?? "1");
    const numOfRows = Number(searchParams.get("numOfRows") ?? "300");

    if (!areaCd || !signguCd) {
        return NextResponse.json(
            {
                message: "areaCd와 signguCd는 필수입니다.",
                areas: AREA_CODES,
                districts: SIGNGU_CODES,
            },
            { status: 400 }
        );
    }

    try {
        const data = await fetchConcentrationRates({
            areaCd,
            signguCd,
            tAtsNm,
            pageNo,
            numOfRows,
        });
        return NextResponse.json(data);
    } catch (error) {
        console.error("[GET /api/v1/concentration]", error);
        return NextResponse.json(
            { message: error instanceof Error ? error.message : "집중률 조회 중 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
