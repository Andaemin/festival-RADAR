"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { MayoSidebar } from "mayoui-react";
import type { MayoSidebarItem } from "mayoui-react";
import ThemeToggle from "./ThemeToggle";

const SIDEBAR_ITEMS: MayoSidebarItem[] = [
    { label: "메인", icon: "🏠", href: "/" },
    { label: "대시보드", icon: "📊", href: "/dashboard" },
    { label: "플래너", icon: "📝", href: "/planner" },
    {
        label: "분석",
        icon: "🧪",
        children: [
            { label: "관광지 집중률", href: "/concentration" },
            { label: "예산 추정", href: "/budget-estimator" },
        ],
    },
];

export default function AppSidebar() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    // 페이지 이동 시 모바일 메뉴 닫기
    useEffect(() => {
        setOpen(false);
    }, [pathname]);

    // 모바일에서 메뉴 열렸을 때 스크롤 방지
    useEffect(() => {
        if (open) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
        return () => { document.body.style.overflow = ""; };
    }, [open]);

    return (
        <>
            {/* 모바일 상단 바 */}
            <div
                className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-12 md:hidden"
                style={{ background: "var(--mayo-surface)", borderBottom: "1px solid var(--mayo-border)" }}
            >
                <span className="text-sm font-bold" style={{ color: "var(--mayo-text)" }}>Festival Radar</span>
                <button
                    onClick={() => setOpen((v) => !v)}
                    className="flex flex-col justify-center items-center w-8 h-8 gap-1"
                    aria-label="메뉴 열기"
                >
                    <span
                        className="block w-5 h-0.5 rounded transition-transform"
                        style={{
                            background: "var(--mayo-text)",
                            transform: open ? "rotate(45deg) translateY(3px)" : "none",
                        }}
                    />
                    <span
                        className="block w-5 h-0.5 rounded transition-opacity"
                        style={{
                            background: "var(--mayo-text)",
                            opacity: open ? 0 : 1,
                        }}
                    />
                    <span
                        className="block w-5 h-0.5 rounded transition-transform"
                        style={{
                            background: "var(--mayo-text)",
                            transform: open ? "rotate(-45deg) translateY(-3px)" : "none",
                        }}
                    />
                </button>
            </div>

            {/* 모바일 오버레이 */}
            {open && (
                <div
                    className="fixed inset-0 z-30 bg-black/40 md:hidden"
                    onClick={() => setOpen(false)}
                />
            )}

            {/* 사이드바 */}
            <aside
                className={[
                    // 모바일: 왼쪽에서 슬라이드
                    "fixed top-12 left-0 bottom-0 z-30 w-56 transition-transform duration-200 md:transition-none",
                    // 데스크톱: 항상 보이는 정적 사이드바
                    "md:static md:top-0 md:z-auto md:w-auto md:translate-x-0",
                    // 모바일 열림/닫힘
                    open ? "translate-x-0" : "-translate-x-full",
                ].join(" ")}
            >
                <div
                    className="flex flex-col h-full md:h-screen md:sticky md:top-0 shrink-0"
                    style={{ background: "var(--mayo-surface)", borderRight: "1px solid var(--mayo-border)" }}
                >
                    <div className="flex-1 overflow-y-auto">
                        <MayoSidebar items={SIDEBAR_ITEMS} activePath={pathname} />
                    </div>
                    <div style={{ borderTop: "1px solid var(--mayo-border)" }}>
                        <ThemeToggle />
                    </div>
                </div>
            </aside>
        </>
    );
}
