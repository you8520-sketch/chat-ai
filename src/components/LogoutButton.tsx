"use client";

import { useRouter } from "next/navigation";

type Props = {
  className?: string;
};

export default function LogoutButton({ className }: Props) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.refresh();
      }}
      className={className ?? "text-gray-500 hover:text-white"}
    >
      로그아웃
    </button>
  );
}
