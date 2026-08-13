"use client";

import { useEffect, useState } from "react";

type PushState = "loading" | "unsupported" | "unconfigured" | "off" | "on" | "blocked";

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes.buffer;
}

function isIosBrowserMode(): boolean {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export default function PushNotificationManager() {
  const [state, setState] = useState<PushState>("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [publicKey, setPublicKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("blocked");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.getSubscription();
      const endpoint = subscription?.endpoint ?? "";
      const response = await fetch(`/api/push${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ""}`);
      if (!response.ok) {
        if (!cancelled) setState("off");
        return;
      }
      const data = (await response.json()) as { enabled: boolean; publicKey: string; subscribed: boolean };
      if (!data.enabled) {
        if (!cancelled) setState("unconfigured");
        return;
      }
      if (!cancelled) {
        setPublicKey(data.publicKey);
        setState(subscription && data.subscribed ? "on" : "off");
      }
    };
    void load().catch(() => {
      if (!cancelled) setState("unsupported");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setBusy(true);
    setMessage("");
    try {
      if (isIosBrowserMode()) {
        setMessage("아이폰에서는 먼저 Safari의 공유 메뉴에서 홈 화면에 추가한 뒤 앱 아이콘으로 열어 주세요.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        setMessage("알림 권한이 허용되지 않았습니다.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(publicKey),
        }));
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error("구독 저장 실패");
      setState("on");
      setMessage("중요 알림이 켜졌습니다.");
    } catch {
      setMessage("알림을 켜지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState("off");
      setMessage("푸시 알림이 꺼졌습니다.");
    } catch {
      setMessage("알림을 끄지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const description =
    state === "on"
      ? "공지·이벤트, 포인트 지급·소멸, 제작 캐릭터 승인, 신고·문의 처리 결과만 알려드려요."
      : state === "blocked"
        ? "기기 설정에서 하비 AI의 알림 권한을 허용해 주세요."
        : state === "unconfigured"
          ? "푸시 알림 서버 설정을 준비하고 있습니다."
          : state === "unsupported"
            ? "이 브라우저에서는 푸시 알림을 사용할 수 없습니다."
            : "중요한 처리 결과만 앱 알림으로 받을 수 있어요.";

  return (
    <section className="mt-4 rounded-xl border border-white/10 bg-[#131626] p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-zinc-100">앱 푸시 알림</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{description}</p>
        </div>
        <button
          type="button"
          onClick={state === "on" ? disable : enable}
          disabled={busy || state === "loading" || state === "unsupported" || state === "unconfigured" || state === "blocked"}
          aria-pressed={state === "on"}
          className={`relative h-7 w-[52px] shrink-0 rounded-full transition-colors disabled:opacity-40 ${state === "on" ? "bg-violet-500" : "bg-zinc-700"}`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${state === "on" ? "left-[26px]" : "left-0.5"}`}
          />
        </button>
      </div>
      {message ? <p className="mt-3 text-xs text-violet-200">{message}</p> : null}
    </section>
  );
}
