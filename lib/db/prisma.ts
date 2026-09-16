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

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}
