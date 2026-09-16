import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../lib/generated/prisma";

/**
 * 스크립트용 PrismaClient 생성.
 * TiDB Cloud 등 원격 DB는 프로토콜을 mariadb://로 변환하고 ssl=true를 추가한다.
 */
export function createScriptPrisma(): PrismaClient {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new Error("DATABASE_URL 이 설정되지 않았습니다.");
    return new PrismaClient({ adapter: new PrismaMariaDb(toMariadbUrl(raw)) });
}

function toMariadbUrl(url: string): string {
    let u = url.replace(/^mysql:\/\//, "mariadb://");
    if (u.includes("tidbcloud")) {
        u += (u.includes("?") ? "&" : "?") + "ssl=true&connectTimeout=10000";
    }
    return u;
}
