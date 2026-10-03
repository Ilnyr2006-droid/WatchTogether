import type { Metadata } from "next";
import { isE2ETestMode } from "@/server/e2e-mode";
import "./globals.css";

export const metadata: Metadata = {
  title: "WatchTogether — смотрите вместе",
  description: "Синхронный просмотр видео с голосом и чатом",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" data-watchtogether-e2e={isE2ETestMode() ? "true" : undefined}><body>{children}</body></html>;
}
