"use client";

import { resolveChatAssetPresentation } from "@/lib/chatAssetPresentation";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";
import { useChatDesktopViewport } from "@/lib/useChatDesktopViewport";

/**
 * Background presentation visual parameter. Only rendered on the mobile breakpoint
 * (same `useChatDesktopViewport` owner as the presentation policy) and only while the
 * effective presentation is `background` (stored `left` on mobile).
 */
export default function ChatBackgroundOpacitySettings({
  displayPrefs,
  onDisplayPrefsChange,
}: {
  displayPrefs: ChatDisplayPrefs;
  onDisplayPrefsChange: (prefs: ChatDisplayPrefs) => void;
}) {
  const isDesktop = useChatDesktopViewport();
  if (resolveChatAssetPresentation(displayPrefs.assetDisplayMode, isDesktop) !== "background") {
    return null;
  }
  const percent = Math.round(displayPrefs.portraitBackgroundOpacity * 100);
  return (
    <section>
      <label className="block rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2.5">
        <span className="flex items-center justify-between gap-3 text-[11px] font-semibold text-zinc-300">
          <span>모바일 배경 투명도</span>
          <span className="tabular-nums text-violet-300">{percent}%</span>
        </span>
        <input
          type="range"
          aria-label="모바일 배경 이미지 투명도"
          min={0}
          max={100}
          step={1}
          value={percent}
          onChange={(e) =>
            onDisplayPrefsChange({
              ...displayPrefs,
              portraitBackgroundOpacity: Number(e.target.value) / 100,
            })
          }
          className="mt-2 w-full accent-violet-500"
        />
        <span className="mt-1 block text-[10px] text-zinc-600">
          배경 모드에서 이미지가 채팅 본문 뒤에 은은하게 깔립니다.
        </span>
      </label>
    </section>
  );
}
