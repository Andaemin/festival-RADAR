import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export async function loginUser(username: string, password: string) {
    const user = await prisma.user.findUnique({ where: { username } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
        throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    const accessToken = await new SignJWT({ role: user.role })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(user.username)
        .setExpirationTime("24h")
        .sign(secret);

    return {
        accessToken,
        username: user.username,
        name: user.name,
        role: user.role,
    };
}
