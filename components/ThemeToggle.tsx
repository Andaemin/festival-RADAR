"use client";

import { useEffect, useState } from "react";
import { MayoToggle } from "mayoui-react";

export default function ThemeToggle() {
    const [dark, setDark] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem("theme");
        const isDark = saved === "dark";
        setDark(isDark);
        document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
        setMounted(true);
    }, []);

    function toggle(checked: boolean) {
        setDark(checked);
        document.documentElement.setAttribute("data-theme", checked ? "dark" : "light");
        localStorage.setItem("theme", checked ? "dark" : "light");
    }

    if (!mounted) return null;

    return (
        <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>☀️</span>
            <MayoToggle checked={dark} onChange={toggle} size="sm" color="blue" />
            <span className="text-xs" style={{ color: "var(--mayo-text-muted)" }}>🌙</span>
        </div>
    );
}
