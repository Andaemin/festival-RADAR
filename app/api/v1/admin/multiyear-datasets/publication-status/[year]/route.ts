import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/require-admin";
import { MultiYearPublicationStatusValue } from "@/lib/multiyear/reference-data-policy";
import { upsertPublicationStatus } from "@/lib/multiyear/publication-status";

const ALLOWED_STATUSES = new Set<string>(["PARTIAL", "PUBLISHED_PLAN_COMPLETE"]);

/**
 * 다년도 publication status 관리자 API - 유일한 쓰기 endpoint. 이 값이
 * ReferenceDataPolicy.INCLUDE_PUBLISHED_SAME_YEAR의 same-year 허용 여부를 직접 결정하므로
 * (lib/multiyear/reference-data-policy.ts) 반드시 명시적 운영자 action으로만 바뀐다 - import
 * 성공/row 수/최신 연도/앱 기동 등으로 자동 COMPLETE 처리하는 로직은 이 파일을 포함해 어디에도
 * 없다.
 *
 * PUBLISHED_PLAN_COMPLETE의 의미: "해당 연도의 공식 축제 개최계획 데이터셋이 충분히 완성·공개되어
 * 같은 연도의 Planning reference로 사용 가능하다고 운영자가 판단한 상태" - "그 해 축제가 모두
 * 끝났다"거나 "집행예산이 확정됐다"는 뜻이 아니다.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  if (process.env.MULTIYEAR_ADMIN_UI_ENABLED !== "true") {
    return NextResponse.json({ message: "Not Found" }, { status: 404 });
  }

  const guard = await requireAdmin(request);
  if (!guard.ok) {
    return NextResponse.json({ message: guard.message }, { status: guard.status });
  }

  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ message: "year는 정수여야 합니다." }, { status: 400 });
  }

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "요청 본문이 올바른 JSON 형식이 아닙니다." }, { status: 400 });
  }

  if (!body.status || !ALLOWED_STATUSES.has(body.status)) {
    return NextResponse.json(
      { message: `status는 PARTIAL 또는 PUBLISHED_PLAN_COMPLETE만 허용됩니다: ${body.status}` },
      { status: 400 }
    );
  }

  const entry = await upsertPublicationStatus(prisma, year, body.status as MultiYearPublicationStatusValue);
  return NextResponse.json(entry);
}
