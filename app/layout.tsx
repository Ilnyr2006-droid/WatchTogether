import type { Metadata, Viewport } from "next";
import { isE2ETestMode } from "@/server/e2e-mode";
import { PwaRuntime } from "./pwa-runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: "WatchTogether — смотрите вместе",
  description: "Синхронный просмотр видео с голосом и чатом",
  applicationName: "WatchTogether",
  appleWebApp: { capable: true, title: "WatchTogether", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icons/watchtogether.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/watchtogether-192.png", sizes: "192x192", type: "image/png" }],
  },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#08090a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" data-watchtogether-e2e={isE2ETestMode() ? "true" : undefined}><body><PwaRuntime />{children}</body></html>;
}
