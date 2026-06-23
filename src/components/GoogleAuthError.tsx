"use client";

import { useSearchParams } from "next/navigation";

const MESSAGES: Record<string, string> = {
  google_not_configured:
    "구글 OAuth가 설정되지 않았습니다. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET와 Google Console 리디렉션 URI를 확인하세요.",
  google_failed: "구글 로그인에 실패했습니다. 다시 시도해주세요.",
};

export default function GoogleAuthError() {
  const params = useSearchParams();
  const err = params.get("error");
  if (!err) return null;
  return (
    <p className="mt-3 rounded-xl bg-rose-600/10 p-3 text-xs text-rose-300">
      {MESSAGES[err] ?? "구글 로그인에 실패했습니다. 다시 시도해주세요."}
    </p>
  );
}
