"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "hobby-ai-pwa-install-dismissed-at";
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone(): boolean {
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || iosNavigator.standalone === true;
}

function wasRecentlyDismissed(): boolean {
  const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY));
  return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_FOR_MS;
}

export default function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // The site remains usable if service-worker registration is unavailable.
      });
    }
    if ("clearAppBadge" in navigator) {
      (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge().catch(() => {});
    }

    if (isStandalone() || wasRecentlyDismissed()) return;

    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (!isMobile) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      setShowIosGuide(true);
      setVisible(true);
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setShowIosGuide(false);
      setVisible(true);
    };

    const handleInstalled = () => {
      setVisible(false);
      setInstallEvent(null);
      window.localStorage.removeItem(DISMISS_KEY);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    setVisible(false);
    if (outcome === "dismissed") {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[70] mx-auto max-w-sm rounded-2xl border border-violet-300/20 bg-[#131626]/95 p-4 text-zinc-100 shadow-2xl shadow-black/60 backdrop-blur-xl sm:hidden">
      <div className="flex items-start gap-3">
        <img
          src="/icons/icon-192.png"
          alt=""
          width={52}
          height={52}
          className="h-[52px] w-[52px] shrink-0 rounded-xl shadow-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="font-bold">하비 AI를 앱처럼 사용하세요</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            홈 화면에서 바로 열고, 브라우저 주소창 없이 더 넓게 사용할 수 있어요.
          </p>
        </div>
      </div>

      {showIosGuide ? (
        <div className="mt-3 rounded-xl bg-white/[0.06] px-3 py-2.5 text-xs leading-relaxed text-zinc-300">
          아래의 <strong className="text-white">공유</strong> 버튼을 누른 다음
          <strong className="text-violet-300"> 홈 화면에 추가</strong>를 선택하세요.
        </div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="min-h-10 rounded-xl px-4 text-sm font-semibold text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200"
        >
          나중에
        </button>
        {installEvent ? (
          <button
            type="button"
            onClick={install}
            className="min-h-10 rounded-xl bg-violet-600 px-5 text-sm font-bold text-white transition hover:bg-violet-500"
          >
            설치하기
          </button>
        ) : null}
      </div>
    </div>
  );
}
