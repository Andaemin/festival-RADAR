import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "mayoui-react/styles";

const pretendard = localFont({
    src: "../public/fonts/PretendardVariable.woff2",
    variable: "--font-pretendard",
    display: "swap",
});

export const metadata: Metadata = {
    // MetaData - next 에서 제공하는  <head> 임
    title: "Festival-Radar",
    description: "지역 축제 혼잡도 예측 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
    return (
        <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
            <body className="min-h-full flex flex-col font-[family-name:var(--font-pretendard)]">{children}</body>
        </html>
    );
}
