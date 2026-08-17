"use client";

import { useEffect, useState } from "react";
import ToggleSwitch from "@/components/ToggleSwitch";

type PushState = "loading" | "unsupported" | "unconfigured" | "off" | "on" | "blocked";

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes.buffer;
}

function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  const classic = /iphone|ipad|ipod/i.test(ua);
  const ipadDesktopUa = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return classic || ipadDesktopUa;
}

function isIosBrowserMode(): boolean {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isIosDevice() && !standalone;
}

export default function PushNotificationManager() {
  const [state, setState] = useState<PushState>("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [prefBusy, setPrefBusy] = useState<"likes" | "comments" | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [pushNotifyLikes, setPushNotifyLikes] = useState(false);
  const [pushNotifyComments, setPushNotifyComments] = useState(false);

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
      const response = await fetch(`/api/push${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ""}`, {
        credentials: "same-origin",
      });
      if (response.status === 401) {
        if (!cancelled) {
          setState("off");
          setMessage("이 앱에서 다시 로그인해 주세요. 아이폰은 Safari와 홈 화면 앱의 로그인이 따로입니다.");
        }
        return;
      }
      if (!response.ok) {
        if (!cancelled) setState("off");
        return;
      }
      const data = (await response.json()) as {
        enabled: boolean;
        publicKey: string;
        subscribed: boolean;
        pushNotifyLikes?: boolean;
        pushNotifyComments?: boolean;
      };
      if (!data.enabled) {
        if (!cancelled) setState("unconfigured");
        return;
      }
      if (!cancelled) {
        setPublicKey(data.publicKey);
        setPushNotifyLikes(Boolean(data.pushNotifyLikes));
        setPushNotifyComments(Boolean(data.pushNotifyComments));
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
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (response.status === 401) {
        setMessage("이 앱에서 다시 로그인해 주세요. 아이폰은 Safari와 홈 화면 앱의 로그인이 따로입니다.");
        return;
      }
      if (!response.ok) throw new Error("구독 저장 실패");
      setState("on");
      setMessage("중요 알림이 켜졌습니다. 좋아요·댓글 푸시는 아래에서 따로 켤 수 있어요.");
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
          credentials: "same-origin",
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

  const saveSocialPref = async (kind: "likes" | "comments", next: boolean) => {
    setPrefBusy(kind);
    setMessage("");
    const previous = kind === "likes" ? pushNotifyLikes : pushNotifyComments;
    if (kind === "likes") setPushNotifyLikes(next);
    else setPushNotifyComments(next);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "likes" ? { pushNotifyLikes: next } : { pushNotifyComments: next }),
      });
      if (response.status === 401) {
        if (kind === "likes") setPushNotifyLikes(previous);
        else setPushNotifyComments(previous);
        setMessage("이 앱에서 다시 로그인해 주세요. 아이폰은 Safari와 홈 화면 앱의 로그인이 따로입니다.");
        return;
      }
      if (!response.ok) throw new Error("pref save failed");
      setMessage(next ? "해당 푸시 알림을 켰습니다." : "해당 푸시 알림을 껐습니다.");
    } catch {
      if (kind === "likes") setPushNotifyLikes(previous);
      else setPushNotifyComments(previous);
      setMessage("알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPrefBusy(null);
    }
  };

  const description =
    state === "on"
      ? "공지·이벤트, 포인트 지급·소멸, 제작 캐릭터 승인, 신고·문의 처리 결과는 기본으로 받습니다. 좋아요·댓글은 아래에서 따로 켜 주세요."
      : state === "blocked"
        ? "기기 설정에서 하비 AI의 알림 권한을 허용해 주세요."
        : state === "unconfigured"
          ? "푸시 알림이 서버에서 꺼져 있습니다. 배포 후 잠시 뒤 다시 열어 주세요."
          : state === "unsupported"
            ? "이 브라우저에서는 푸시 알림을 사용할 수 없습니다."
            : "중요한 처리 결과만 앱 알림으로 받을 수 있어요.";

  const socialDisabled =
    busy || prefBusy !== null || state === "loading" || state === "unsupported" || state === "unconfigured";

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
      <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
        <ToggleSwitch
          checked={pushNotifyLikes}
          onChange={(next) => void saveSocialPref("likes", next)}
          disabled={socialDisabled}
          label="좋아요 푸시"
          description="내 캐릭터에 하트가 달리면 푸시로 받습니다. 기본은 꺼져 있어요."
        />
        <ToggleSwitch
          checked={pushNotifyComments}
          onChange={(next) => void saveSocialPref("comments", next)}
          disabled={socialDisabled}
          label="댓글 푸시"
          description="내 프로필·캐릭터·게시글에 댓글이 달리면 푸시로 받습니다. 기본은 꺼져 있어요."
        />
        {state !== "on" && state !== "loading" && state !== "unconfigured" && state !== "unsupported" ? (
          <p className="text-[11px] text-zinc-500">좋아요·댓글 푸시를 받으려면 먼저 위의 앱 푸시 알림을 켜 주세요.</p>
        ) : null}
      </div>
      {message ? <p className="mt-3 text-xs text-violet-200">{message}</p> : null}
    </section>
  );
}
