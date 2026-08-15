"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MayoBtn, MayoInput } from "mayoui-react";
import { login } from "@/lib/api/auth";

export default function LoginPage() {
    const router = useRouter();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const data = await login({ username, password });
            localStorage.setItem("accessToken", data.accessToken);
            localStorage.setItem("user", JSON.stringify({ username: data.username, name: data.name, role: data.role }));
            router.push("/dashboard");
        } catch (err) {
            setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-8">
                <h1 className="text-2xl font-bold text-center mb-1">축제레이더</h1>
                <p className="text-sm text-gray-500 text-center mb-8">지역 축제 혼잡도 예측 서비스</p>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <MayoInput
                        label="아이디"
                        type="text"
                        placeholder="아이디를 입력하세요"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        error={error ? " " : undefined}
                    />
                    <MayoInput
                        label="비밀번호"
                        type="password"
                        placeholder="비밀번호를 입력하세요"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        error={error || undefined}
                    />
                    <MayoBtn type="submit" variant="primary" size="md" disabled={loading}>
                        {loading ? "로그인 중..." : "로그인"}
                    </MayoBtn>
                </form>
            </div>
        </main>
    );
}
