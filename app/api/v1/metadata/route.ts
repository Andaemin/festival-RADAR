import { NextResponse } from "next/server";
import { getMetadata } from "@/lib/services/metadata.service";

export async function GET() {
  try {
    const metadata = await getMetadata();
    return NextResponse.json(metadata);
  } catch (error) {
    console.error("[GET /api/v1/metadata]", error);
    return NextResponse.json({ message: "메타데이터 조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
