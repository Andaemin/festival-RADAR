import Link from "next/link";

const pages = [
    { href: "/concentration-tester", label: "관광지 집중률 테스터" },
    { href: "/assistant-tester", label: "AI 어시스턴트 테스터" },
    { href: "/dashboard", label: "대시보드" },
    { href: "/festivals", label: "축제 목록" },
    { href: "/planner", label: "플래너" },
    { href: "/login", label: "로그인" },
];

export default function HomePage() {
    return (
        <main style={{ maxWidth: 600, margin: "0 auto", padding: "48px 16px" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 32 }}>
                Festival Radar
            </h1>
            <nav style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {pages.map((p) => (
                    <Link
                        key={p.href}
                        href={p.href}
                        style={{
                            padding: "12px 16px",
                            borderRadius: 8,
                            border: "1px solid #ddd",
                            textDecoration: "none",
                            color: "inherit",
                        }}
                    >
                        {p.label}
                    </Link>
                ))}
            </nav>
        </main>
    );
}
