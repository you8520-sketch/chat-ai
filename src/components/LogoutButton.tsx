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
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready.catch(() => null);
          const subscription = await registration?.pushManager.getSubscription().catch(() => null);
          if (subscription) {
            await fetch("/api/push", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ endpoint: subscription.endpoint }),
            }).catch(() => null);
            await subscription.unsubscribe().catch(() => false);
          }
        }
        await fetch("/api/auth/logout", { method: "POST" });
        router.refresh();
      }}
      className={className ?? "text-gray-500 hover:text-white"}
    >
      로그아웃
    </button>
  );
}
