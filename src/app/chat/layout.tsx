/** 채팅 — main 패딩을 줄여 본문 가로 폭 확보. 모바일 채팅방은 풀블리드 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1 max-md:min-h-[100dvh] md:-mr-3 lg:-mr-4">{children}</div>
  );
}
