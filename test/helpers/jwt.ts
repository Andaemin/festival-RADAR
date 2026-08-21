import { SignJWT } from "jose";

/**
 * lib/services/auth.service.ts의 loginUser가 실제로 발급하는 토큰과 정확히 같은 방식(같은
 * JWT_SECRET env, 같은 alg=HS256, 같은 payload 구조 {role}, 같은 subject=username 규칙)으로
 * 테스트용 JWT를 서명한다. lib/api/require-admin.ts는 서명된 JWT의 claim만 검증하므로(DB User
 * row 존재 여부는 안 봄) 실제 DB에 사용자를 만들지 않고도 진짜 guard 로직을 그대로 통과시킬 수
 * 있다 - 인증 우회 bypass가 아니라 production과 동일한 서명 경로다.
 */
function secret() {
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

export async function signTestToken(role: "ADMIN" | "USER", username = "test-user"): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setExpirationTime("24h")
    .sign(secret());
}

/** 발급 시점에 이미 만료된 토큰 - exp 검증 경로를 실제로 태운다. */
export async function signExpiredTestToken(role: "ADMIN" | "USER" = "ADMIN", username = "test-admin"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setIssuedAt(now - 3600)
    .setExpirationTime(now - 1800)
    .sign(secret());
}
