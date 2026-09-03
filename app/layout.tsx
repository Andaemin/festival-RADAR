import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "mayoui-react/styles";
import AppSidebar from "@/components/AppSidebar";

const pretendard = localFont({
    src: "../public/fonts/PretendardVariable.woff2",
    variable: "--font-pretendard",
    display: "swap",
});

const tossface = localFont({
    src: "../public/fonts/TossFaceFontMac.ttf",
    variable: "--font-tossface",
    display: "swap",
});

export const metadata: Metadata = {
    // MetaData - next 에서 제공하는  <head> 임
    title: "Festival-Radar",
    description: "지역 축제 혼잡도 예측 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
    return (
        <html lang="ko" className={`${pretendard.variable} ${tossface.variable} h-full antialiased`}>
            <body className="min-h-full flex">
                <AppSidebar />
                <main className="flex-1 min-h-screen overflow-auto">
                    {children}
                </main>
            </body>
        </html>
    );
}
