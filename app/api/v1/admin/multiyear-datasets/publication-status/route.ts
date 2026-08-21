import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/require-admin";
import { listPublicationStatusWithRecordCounts } from "@/lib/multiyear/publication-status";

/**
 * 다년도 publication status 관리자 API - 읽기.
 *
 * MULTIYEAR_ADMIN_UI_ENABLED env flag로 기능 자체를 켜고 끈다(Spring의
 * festival.admin-ui.enabled=true와 동일한 역할 - 기본 꺼짐, 꺼져 있으면 이 route 자체가 없는 것처럼
 * 404). 다만 Spring은 이 flag 하나만으로 잠갔던 반면(로컬 개발 전제), 여기서는 실제 서비스 경로에
 * 이미 연결된 상태를 고려해 flag 통과 후에도 JWT 기반 ADMIN guard를 추가로 요구한다 - 이 차이는
 * 의도적이다.
 */
export async function GET(request: NextRequest) {
  if (process.env.MULTIYEAR_ADMIN_UI_ENABLED !== "true") {
    return NextResponse.json({ message: "Not Found" }, { status: 404 });
  }

  const guard = await requireAdmin(request);
  if (!guard.ok) {
    return NextResponse.json({ message: guard.message }, { status: guard.status });
  }

  const entries = await listPublicationStatusWithRecordCounts(prisma);
  return NextResponse.json({ entries });
}
