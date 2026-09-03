"use client";

import { usePathname } from "next/navigation";
import { MayoSidebar } from "mayoui-react";
import type { MayoSidebarItem } from "mayoui-react";
import ThemeToggle from "./ThemeToggle";

const SIDEBAR_ITEMS: MayoSidebarItem[] = [
    { label: "메인", icon: "🏠", href: "/" },
    { label: "대시보드", icon: "📊", href: "/dashboard" },
    { label: "축제 목록", icon: "🎪", href: "/festivals" },
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

    return (
        <div className="flex flex-col h-screen" style={{ background: "var(--mayo-surface)", borderRight: "1px solid var(--mayo-border)" }}>
            <div className="flex-1 overflow-y-auto">
                <MayoSidebar items={SIDEBAR_ITEMS} activePath={pathname} />
            </div>
            <div style={{ borderTop: "1px solid var(--mayo-border)" }}>
                <ThemeToggle />
            </div>
        </div>
    );
}
