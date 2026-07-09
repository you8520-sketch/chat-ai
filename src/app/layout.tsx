import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import ChatRoomDocumentClass from "@/components/ChatRoomDocumentClass";

export const metadata: Metadata = {
  title: "하비 AI - AI 캐릭터 채팅",
  description: "AI 캐릭터와 대화하는 채팅 플랫폼",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full">
      <body className="flex min-h-full flex-col">
        <ChatRoomDocumentClass />
        <Header />
        <div className="app-shell mx-auto flex w-full max-w-7xl flex-1 items-start gap-6 px-4 pb-20 pt-4 md:pb-4">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>
      </body>
    </html>
  );
}
