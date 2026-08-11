import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WatchTogether — смотрите вместе",
  description: "Синхронный просмотр видео с голосом и чатом",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
