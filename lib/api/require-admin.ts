import { jwtVerify } from "jose";
import { NextRequest } from "next/server";

/**
 * 관리자 전용 route handler를 위한 최소 서버사이드 guard. lib/services/auth.service.ts가
 * 발급하는 JWT(HS256, payload={role}, subject=username, 만료 24h)를 정확히 그 규칙 그대로
 * 검증한다 - 새 secret/새 token 포맷을 만들지 않는다.
 *
 * localStorage의 role 값은 클라이언트가 조작 가능하므로 신뢰하지 않는다 - 반드시 서버가
 * Authorization 헤더의 서명된 JWT를 직접 검증해서 role을 판정한다.
 *
 * 이번 Phase에서는 신규 admin route(publication-status 계열)에만 적용하고, 기존 API 전체에
 * 소급 적용하지 않는다.
 */

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export type AdminGuardResult =
  | { ok: true; username: string; role: string }
  | { ok: false; status: 401 | 403; message: string };

export async function requireAdmin(request: NextRequest): Promise<AdminGuardResult> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, message: "인증이 필요합니다." };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return { ok: false, status: 401, message: "인증이 필요합니다." };
  }

  let payload;
  try {
    // jose의 jwtVerify는 서명 검증과 함께 exp(만료)도 기본으로 검사한다 - 만료 토큰은 여기서 throw.
    const result = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    payload = result.payload;
  } catch {
    return { ok: false, status: 401, message: "유효하지 않거나 만료된 토큰입니다." };
  }

  const role = typeof payload.role === "string" ? payload.role : null;
  const username = typeof payload.sub === "string" ? payload.sub : "";

  if (role !== "ADMIN") {
    return { ok: false, status: 403, message: "관리자 권한이 필요합니다." };
  }

  return { ok: true, username, role };
}
