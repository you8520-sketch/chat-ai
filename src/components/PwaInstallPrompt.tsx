"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "hobby-ai-pwa-install-dismissed-v4";
const ICON_VERSION = "door-v2";
const ICON_VERSION_KEY = "hobby-ai-installed-icon-version";
const ICON_MIGRATION_SEEN_KEY = "hobby-ai-icon-migration-seen-door-v2";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone(): boolean {
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || iosNavigator.standalone === true;
}

function wasDismissed(): boolean {
  return window.localStorage.getItem(DISMISS_KEY) === "1";
}

async function hasRelatedInstalledPwa(): Promise<boolean> {
  const relatedAppsNavigator = navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<Array<{ platform?: string }>>;
  };
  if (!relatedAppsNavigator.getInstalledRelatedApps) return false;

  try {
    const apps = await relatedAppsNavigator.getInstalledRelatedApps();
    return apps.some((app) => app.platform === "webapp");
  } catch {
    return false;
  }
}

export default function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);
  const [showIconMigration, setShowIconMigration] = useState(false);
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

    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (!isMobile) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const launchedWithCurrentIcon =
      new URLSearchParams(window.location.search).get("pwa_icon") === ICON_VERSION;
    if (launchedWithCurrentIcon) {
      window.localStorage.setItem(ICON_VERSION_KEY, ICON_VERSION);
      window.localStorage.removeItem(ICON_MIGRATION_SEEN_KEY);
    }
    const hasCurrentIcon =
      launchedWithCurrentIcon || window.localStorage.getItem(ICON_VERSION_KEY) === ICON_VERSION;

    if (isStandalone()) {
      const migrationSeen = window.localStorage.getItem(ICON_MIGRATION_SEEN_KEY) === "1";
      if (!hasCurrentIcon && !migrationSeen) {
        setShowIconMigration(true);
        setShowIosGuide(isIos);
        setShowAndroidGuide(!isIos);
        setVisible(true);
      }
      return;
    }

    let disposed = false;
    let androidFallback: number | null = null;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setShowIosGuide(false);
      setShowAndroidGuide(false);
      setVisible(true);
    };

    const handleInstalled = () => {
      window.localStorage.setItem(ICON_VERSION_KEY, ICON_VERSION);
      window.localStorage.removeItem(ICON_MIGRATION_SEEN_KEY);
      setVisible(false);
      setInstallEvent(null);
      window.localStorage.setItem(DISMISS_KEY, "1");
    };

    const initializeBrowserPrompt = async () => {
      if (wasDismissed() || (await hasRelatedInstalledPwa()) || disposed) return;

      if (isIos) {
        setShowIosGuide(true);
        setVisible(true);
      } else {
        // Some Android browsers withhold beforeinstallprompt. Show one manual
        // guide per browser profile, never a daily recurring prompt.
        androidFallback = window.setTimeout(() => {
          setShowAndroidGuide(true);
          setVisible(true);
        }, 1_200);
      }

      window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.addEventListener("appinstalled", handleInstalled);
    };

    void initializeBrowserPrompt();

    return () => {
      disposed = true;
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      if (androidFallback !== null) window.clearTimeout(androidFallback);
    };
  }, []);

  const dismiss = () => {
    if (showIconMigration) {
      window.localStorage.setItem(ICON_MIGRATION_SEEN_KEY, "1");
      setVisible(false);
      return;
    }
    window.localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    setVisible(false);
    if (outcome === "dismissed") {
      window.localStorage.setItem(DISMISS_KEY, "1");
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[70] mx-auto max-w-sm rounded-2xl border border-violet-300/20 bg-[#131626]/95 p-4 text-zinc-100 shadow-2xl shadow-black/60 backdrop-blur-xl sm:hidden">
      <div className="flex items-start gap-3">
        <img
          src="/icons/icon-door-v2-192.png"
          alt=""
          width={52}
          height={52}
          className="h-[52px] w-[52px] shrink-0 rounded-xl shadow-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            {showIconMigration ? "하비 AI 앱 아이콘이 새로 바뀌었어요" : "하비 AI를 앱처럼 사용하세요"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {showIconMigration
              ? "새 문 아이콘을 받으려면 기존 홈 화면 아이콘을 삭제한 뒤 다시 설치해주세요."
              : "홈 화면에서 바로 열고, 브라우저 주소창 없이 더 넓게 사용할 수 있어요."}
          </p>
        </div>
      </div>

      {showIosGuide ? (
        <div className="mt-3 rounded-xl bg-white/[0.06] px-3 py-2.5 text-xs leading-relaxed text-zinc-300">
          {showIconMigration ? "기존 아이콘을 삭제한 뒤 Safari에서 하비 AI를 다시 열고 " : null}
          아래의 <strong className="text-white">공유</strong> 버튼을 누른 다음
          <strong className="text-violet-300"> 홈 화면에 추가</strong>를 선택하세요.
        </div>
      ) : null}

      {showAndroidGuide ? (
        <div className="mt-3 rounded-xl bg-white/[0.06] px-3 py-2.5 text-xs leading-relaxed text-zinc-300">
          기존 아이콘이나 브라우저 배지가 붙은 아이콘을 먼저 홈 화면에서 삭제하세요. 그다음
          브라우저 오른쪽 위 <strong className="text-white">메뉴(⋮)</strong>에서
          <strong className="text-violet-300"> 앱 설치</strong> 또는
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
