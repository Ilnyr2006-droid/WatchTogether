import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "WatchTogether — смотрите вместе",
    short_name: "WatchTogether",
    description: "Синхронный просмотр видео с голосом и чатом",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#08090a",
    theme_color: "#08090a",
    icons: [
      { src: "/icons/watchtogether-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/watchtogether-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/watchtogether-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/watchtogether.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
