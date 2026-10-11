import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Suspense } from "react";
import "./globals.css";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import ChatRoomDocumentClass from "@/components/ChatRoomDocumentClass";
import MenuTransitionHost from "@/components/MenuTransition";
import PwaInstallPrompt from "@/components/PwaInstallPrompt";
import { SiteLegalFooter } from "@/components/SiteLegalFooter";
import { SITE_DESCRIPTION, SITE_DISPLAY_NAME, SITE_PAGE_TITLE } from "@/lib/siteBrand";
import { getConfiguredPublicOrigin } from "@/lib/publicOrigin";

const configuredPublicOrigin = getConfiguredPublicOrigin();

/** Frequency-ranked Hangul/Latin subsets used by nearly every screen; preloaded so first paint avoids a font-swap layout shift. */
const PRETENDARD_PRELOAD_SUBSETS = [78, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91] as const;

export const metadata: Metadata = {
  title: SITE_PAGE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_DISPLAY_NAME,
  ...(configuredPublicOrigin ? { metadataBase: new URL(configuredPublicOrigin) } : {}),
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-door-v2-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-door-v2-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon-door-v2.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: SITE_DISPLAY_NAME,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070910",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full">
      <head>
        <link rel="stylesheet" href="/fonts/pretendard/pretendard-variable-dynamic-subset.css" />
        {PRETENDARD_PRELOAD_SUBSETS.map((n) => (
          <link
            key={n}
            rel="preload"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
            href={`/fonts/pretendard/PretendardVariable.subset.${n}.woff2`}
          />
        ))}
      </head>
      <body className="flex min-h-full flex-col">
        {/* Paint-time chat-room class — avoids header/chrome flash before hydration. */}
        <Script id="chat-room-active-boot" strategy="beforeInteractive">
          {`(function(){try{var p=location.pathname;if(/^\\/chat\\/\\d+/.test(p))document.documentElement.classList.add("chat-room-active");if(/^\\/character\\/\\d+/.test(p)&&/(?:^|[?&])embed=chat-intro(?:&|$)/.test(location.search))document.documentElement.classList.add("character-intro-embed-active");}catch(e){}})();`}
        </Script>
        <ChatRoomDocumentClass />
        <PwaInstallPrompt />
        <Suspense fallback={null}>
          <MenuTransitionHost />
        </Suspense>
        <Header />
        <div className="app-shell mx-auto flex w-full max-w-7xl flex-1 items-start gap-6 px-4 pb-24 pt-4 md:pb-6">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>
        <SiteLegalFooter />
      </body>
    </html>
  );
}
