import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "仮想通貨家計簿",
  description: "MetaMaskウォレットの取引履歴を自動取得・Excel出力",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
