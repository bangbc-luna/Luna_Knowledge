import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// Một font cho cả app, phân vai bằng độ đậm (T2). Đổi font: thay Inter ở đây.
const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "Luna Knowledge", template: "%s · Luna Knowledge" },
  description: "Kho tài liệu và video nội bộ Lunatech",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={inter.variable}>
      <body className="bg-background font-sans text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
