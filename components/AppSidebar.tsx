"use client";

import { usePathname } from "next/navigation";
import { MayoSidebar } from "mayoui-react";
import type { MayoSidebarItem } from "mayoui-react";

const SIDEBAR_ITEMS: MayoSidebarItem[] = [
    { label: "대시보드", icon: "📊", href: "/dashboard" },
    { label: "축제 목록", icon: "🎪", href: "/festivals" },
    { label: "플래너", icon: "📝", href: "/planner" },
    {
        label: "테스터",
        icon: "🧪",
        children: [
            { label: "집중률 테스터", href: "/concentration-tester" },
            { label: "AI 어시스턴트", href: "/assistant-tester" },
        ],
    },
];

export default function AppSidebar() {
    const pathname = usePathname();

    return <MayoSidebar items={SIDEBAR_ITEMS} activePath={pathname} />;
}
