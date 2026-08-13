import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import ChatRoomDocumentClass from "@/components/ChatRoomDocumentClass";
import PwaInstallPrompt from "@/components/PwaInstallPrompt";

export const metadata: Metadata = {
  title: "하비 AI - AI 캐릭터 채팅",
  description: "AI 캐릭터와 대화하는 채팅 플랫폼",
  applicationName: "하비 AI",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "하비 AI",
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
      <body className="flex min-h-full flex-col">
        {/* Paint-time chat-room class — avoids header/chrome flash before hydration. */}
        <Script id="chat-room-active-boot" strategy="beforeInteractive">
          {`(function(){try{var p=location.pathname;if(/^\\/chat\\/\\d+/.test(p))document.documentElement.classList.add("chat-room-active");if(/^\\/character\\/\\d+/.test(p)&&/(?:^|[?&])embed=chat-intro(?:&|$)/.test(location.search))document.documentElement.classList.add("character-intro-embed-active");}catch(e){}})();`}
        </Script>
        <ChatRoomDocumentClass />
        <PwaInstallPrompt />
        <Header />
        <div className="app-shell mx-auto flex w-full max-w-7xl flex-1 items-start gap-6 px-4 pb-24 pt-4 md:pb-6">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>
      </body>
    </html>
  );
}
