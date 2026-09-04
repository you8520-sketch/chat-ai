"use client";

import {
  CHAT_STREAM_SPEED_PRESETS,
  normalizeStreamIntervalMs,
} from "@/lib/chatDisplayPrefs";

export default function ChatStreamSpeedSettings({
  streamIntervalMs,
  onStreamIntervalMsChange,
  title = "스트리밍 속도",
}: {
  streamIntervalMs: number;
  onStreamIntervalMsChange: (intervalMs: number) => void;
  title?: string;
}) {
  const selectedMs = normalizeStreamIntervalMs(streamIntervalMs);
  return (
    <section>
      <p className="mb-2 font-bold text-violet-300">{title}</p>
      <p className="mb-2 text-[10px] text-zinc-600">
        AI 답변이 화면에 나타나는 속도를 선택하세요. 기본 설정은 빠름입니다.
      </p>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={title}>
        {CHAT_STREAM_SPEED_PRESETS.map((preset) => {
          const selected = selectedMs === preset.intervalMs;
          return (
            <button
              key={preset.intervalMs}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onStreamIntervalMsChange(preset.intervalMs)}
              className={`rounded-lg border px-2 py-2.5 font-semibold transition ${
                selected
                  ? "border-violet-400/60 bg-violet-500/15 text-violet-200"
                  : "border-white/10 bg-[#1a1a1a] text-zinc-400 hover:border-white/20 hover:text-zinc-200"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
