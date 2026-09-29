import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_DISPLAY_NAME, SITE_PAGE_TITLE } from "@/lib/siteBrand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_PAGE_TITLE,
    short_name: SITE_DISPLAY_NAME,
    id: "/",
    description: SITE_DESCRIPTION,
    lang: "ko-KR",
    start_url: "/?pwa_icon=door-v2",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#070910",
    theme_color: "#070910",
    categories: ["entertainment", "social"],
    related_applications: [{ platform: "webapp", url: "/manifest.webmanifest" }],
    icons: [
      {
        src: "/icons/icon-door-v2-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-door-v2-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-door-v2-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
