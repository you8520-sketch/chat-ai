"use client";

import {
  CHAT_FONT_OPTIONS,
  CHAT_FONT_SIZE_PRESETS,
  CHAT_PARAGRAPH_SPACING_PRESETS,
  DEFAULT_CHAT_DISPLAY_PREFS,
  ensureChatDisplayWebFontsLoaded,
  fontSizePresetFromIndex,
  fontSizePresetIndex,
  fontSizePresetLabel,
  paragraphSpacingPresetFromIndex,
  paragraphSpacingPresetIndex,
  paragraphSpacingPresetLabel,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";

export default function ChatDisplayReadabilitySettings({
  displayPrefs,
  onDisplayPrefsChange,
}: {
  displayPrefs: ChatDisplayPrefs;
  onDisplayPrefsChange: (prefs: ChatDisplayPrefs) => void;
}) {
  return (
    <div className="space-y-5 text-xs">
      <section>
        <p className="mb-2 font-bold text-violet-300">글자 크기</p>
        <p className="mb-2 text-[10px] text-zinc-600">
          화면 크기에 맞춘 기본값 위에서 조절 · 변경 즉시 반영 (이 기기)
        </p>
        <label className="block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>크기</span>
            <span>{fontSizePresetLabel(displayPrefs.fontSizePreset)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={CHAT_FONT_SIZE_PRESETS.length - 1}
            step={1}
            value={fontSizePresetIndex(displayPrefs.fontSizePreset)}
            onChange={(e) =>
              onDisplayPrefsChange({
                ...displayPrefs,
                fontSizePreset: fontSizePresetFromIndex(Number(e.target.value)),
              })
            }
            className="w-full accent-violet-500"
          />
          <span className="mt-1 flex justify-between text-[10px] text-zinc-600">
            {CHAT_FONT_SIZE_PRESETS.map((p) => (
              <span key={p.id}>{p.label}</span>
            ))}
          </span>
        </label>
      </section>

      <section>
        <p className="mb-2 font-bold text-violet-300">글꼴</p>
        <p className="mb-2 text-[10px] text-zinc-600">
          텍스트 이미지 저장에 쓰는 명조체(노토·나눔·고운바탕·송명) 포함
        </p>
        <select
          value={displayPrefs.fontFamily}
          onChange={(e) => {
            void ensureChatDisplayWebFontsLoaded();
            onDisplayPrefsChange({ ...displayPrefs, fontFamily: e.target.value });
          }}
          className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2 text-zinc-200 outline-none focus:border-violet-500/50"
        >
          {CHAT_FONT_OPTIONS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </section>

      <section>
        <p className="mb-2 font-bold text-violet-300">문단 간격</p>
        <p className="mb-2 text-[10px] text-zinc-600">문단 사이 여백 · 변경 즉시 반영 (이 기기)</p>
        <label className="block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>간격</span>
            <span>{paragraphSpacingPresetLabel(displayPrefs.paragraphSpacingPreset)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={CHAT_PARAGRAPH_SPACING_PRESETS.length - 1}
            step={1}
            value={paragraphSpacingPresetIndex(displayPrefs.paragraphSpacingPreset)}
            onChange={(e) =>
              onDisplayPrefsChange({
                ...displayPrefs,
                paragraphSpacingPreset: paragraphSpacingPresetFromIndex(Number(e.target.value)),
              })
            }
            className="w-full accent-violet-500"
          />
          <span className="mt-1 flex justify-between text-[10px] text-zinc-600">
            {CHAT_PARAGRAPH_SPACING_PRESETS.map((p) => (
              <span key={p.id}>{p.label}</span>
            ))}
          </span>
        </label>
      </section>

      <section>
        <p className="mb-2 font-bold text-violet-300">글자 색 · 캐릭터</p>
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2">
            <span className="text-zinc-400">지문</span>
            <input
              type="color"
              value={displayPrefs.narrationColor}
              onChange={(e) => onDisplayPrefsChange({ ...displayPrefs, narrationColor: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent"
            />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2">
            <span className="text-zinc-400">대사</span>
            <input
              type="color"
              value={displayPrefs.dialogueColor}
              onChange={(e) => onDisplayPrefsChange({ ...displayPrefs, dialogueColor: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent"
            />
          </label>
        </div>
      </section>

      <section>
        <p className="mb-2 font-bold text-violet-300">글자 색 · 유저</p>
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2">
            <span className="text-zinc-400">지문</span>
            <input
              type="color"
              value={displayPrefs.userNarrationColor}
              onChange={(e) =>
                onDisplayPrefsChange({ ...displayPrefs, userNarrationColor: e.target.value })
              }
              className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent"
            />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-2">
            <span className="text-zinc-400">대사</span>
            <input
              type="color"
              value={displayPrefs.userDialogueColor}
              onChange={(e) =>
                onDisplayPrefsChange({ ...displayPrefs, userDialogueColor: e.target.value })
              }
              className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent"
            />
          </label>
        </div>
      </section>

      <button
        type="button"
        onClick={() => onDisplayPrefsChange({ ...DEFAULT_CHAT_DISPLAY_PREFS })}
        className="w-full rounded-lg border border-white/10 py-2 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
      >
        표시 설정 초기화
      </button>
    </div>
  );
}
