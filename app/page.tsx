import Link from "next/link";

const pages = [
    { href: "/dashboard", label: "대시보드", desc: "축제 현황 한눈에 보기", icon: "📊" },
    { href: "/festivals", label: "축제 목록", desc: "전국 축제 데이터 조회", icon: "🎪" },
    { href: "/planner", label: "플래너", desc: "축제 기획 추천", icon: "📝" },
    { href: "/concentration", label: "관광지 집중률", desc: "관광지 방문자 집중률 예측", icon: "📈" },
    { href: "/budget-estimator", label: "예산 추정", desc: "축제 예산 추정 분석", icon: "💰" },
];

export default function HomePage() {
    return (
        <main className="min-h-screen flex items-center justify-center" style={{ background: "var(--mayo-bg-subtle)" }}>
            <div style={{ maxWidth: 480, width: "100%", padding: "0 16px" }}>
                <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--mayo-text)" }}>
                    Festival Radar
                </h1>
                <p className="text-sm mb-8" style={{ color: "var(--mayo-text-muted)" }}>
                    지역 축제 혼잡도 예측 서비스
                </p>
                <nav className="flex flex-col gap-3">
                    {pages.map((p) => (
                        <Link
                            key={p.href}
                            href={p.href}
                            className="flex items-center gap-3 rounded-lg p-4 transition-colors"
                            style={{
                                background: "var(--mayo-surface)",
                                border: "1px solid var(--mayo-border)",
                                textDecoration: "none",
                                color: "var(--mayo-text)",
                            }}
                        >
                            <span className="text-xl">{p.icon}</span>
                            <div>
                                <span className="font-medium">{p.label}</span>
                                <span className="block text-xs" style={{ color: "var(--mayo-text-muted)" }}>{p.desc}</span>
                            </div>
                        </Link>
                    ))}
                </nav>
            </div>
        </main>
    );
}
