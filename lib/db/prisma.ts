import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
    const raw = process.env.DATABASE_URL;
    if (!raw) {
        throw new Error("DATABASE_URL 이 설정되지 않았습니다. .env 파일을 확인하세요.");
    }
    let url = raw.replace(/^mysql:\/\//, "mariadb://");
    if (url.includes("tidbcloud")) {
        url += (url.includes("?") ? "&" : "?") + "ssl=true&connectTimeout=10000";
    }
    return new PrismaClient({ adapter: new PrismaMariaDb(url) });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// dev에서는 HMR로 모듈이 다시 평가될 때 커넥션이 늘어나는 걸 막고, production(Vercel
// 서버리스)에서는 warm 인스턴스가 살아있는 동안 요청마다 새 커넥션을 맺지 않도록 항상 재사용한다.
globalForPrisma.prisma = prisma;
