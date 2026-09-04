import { NextRequest, NextResponse } from "next/server";
import { fetchMonthlyVisitorProfiles } from "@/lib/external/visitor-stats";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const yearStr = searchParams.get("year");
    const monthStr = searchParams.get("month");

    if (!yearStr || !monthStr) {
        return NextResponse.json(
            { message: "year와 month는 필수입니다." },
            { status: 400 }
        );
    }

    const year = Number(yearStr);
    const month = Number(monthStr);

    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return NextResponse.json(
            { message: "year와 month가 올바르지 않습니다." },
            { status: 400 }
        );
    }

    try {
        const profiles = await fetchMonthlyVisitorProfiles(year, month);
        return NextResponse.json({ profiles });
    } catch (error) {
        console.error("[GET /api/v1/visitor-stats]", error);
        return NextResponse.json(
            { message: error instanceof Error ? error.message : "방문자 데이터 조회 중 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
