import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nightfall Stocks",
  description: "Lightweight watchlist & charts",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Nightfall Stocks",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      {/* Keep body styles minimal so our inner gradient shows */}
      <body className="text-gray-100">
        <div className="min-h-screen bg-gradient-to-br from-[#0b1020] via-[#0b1b33] to-[#000000]">
          {children}
        </div>
      </body>
    </html>
  );
}
