import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "사업계획서 작성",
  description: "입력한 사업장 값으로 대주단 제출용 사업계획서를 만듭니다.",
};

/** 루트 레이아웃 — 한국어 문서 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
