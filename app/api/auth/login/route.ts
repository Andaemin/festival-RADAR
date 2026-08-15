import { NextResponse } from "next/server";
import { loginUser } from "@/lib/services/auth.service";

export async function POST(request: Request) {
    const { username, password } = await request.json();

    if (!username || !password) {
        return NextResponse.json(
            { message: "아이디와 비밀번호를 입력해주세요." },
            { status: 400 }
        );
    }

    try {
        const data = await loginUser(username, password);
        return NextResponse.json(data);
    } catch (err) {
        return NextResponse.json(
            { message: err instanceof Error ? err.message : "로그인에 실패했습니다." },
            { status: 401 }
        );
    }
}
