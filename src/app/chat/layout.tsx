/** 채팅 — main 패딩을 줄여 본문 가로 폭 확보 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 flex-1 md:-mr-3 lg:-mr-4">{children}</div>;
}
