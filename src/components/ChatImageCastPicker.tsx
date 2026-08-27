"use client";

import {
  CHAT_IMAGE_CAST_FOUR_PLUS_WARNING,
  applyUserCastEdits,
  castNeedsFourPlusWarning,
  type ChatImageCastCompositionGoal,
  type ChatImageCastImportance,
  type ChatImageCastIntentManifest,
  type ChatImageCastVisibility,
  type SelectableCastAsset,
} from "@/lib/chatImageCast";

const GOALS: Array<{ id: ChatImageCastCompositionGoal; label: string }> = [
  { id: "auto", label: "AI 추천" },
  { id: "duo_focus", label: "2인 중심" },
  { id: "trio_group", label: "3인 단체샷" },
  { id: "ensemble_scene", label: "앙상블" },
];

const IMPORTANCE: Array<{ id: ChatImageCastImportance; label: string }> = [
  { id: "primary", label: "핵심" },
  { id: "secondary", label: "조연" },
  { id: "background", label: "배경" },
];

const VISIBILITY: Array<{ id: ChatImageCastVisibility; label: string }> = [
  { id: "required_visible", label: "필수 노출" },
  { id: "preferred_visible", label: "가능하면 노출" },
  { id: "background_ok", label: "후경 가능" },
];

type ChatImageCastPickerProps = {
  manifest: ChatImageCastIntentManifest;
  selectableAssets: readonly SelectableCastAsset[];
  disabled?: boolean;
  onChange: (manifest: ChatImageCastIntentManifest) => void;
};

export default function ChatImageCastPicker({
  manifest,
  selectableAssets,
  disabled,
  onChange,
}: ChatImageCastPickerProps) {
  return (
    <section className="space-y-3">
      <div className="space-y-2">
        <h3 className="text-[11px] font-semibold text-zinc-400">출연 인물</h3>
        <div className="space-y-2">
          {manifest.subjects.map((subject) => {
            const selectedAsset = subject.requestedReferenceAssetUrl;
            return (
              <article
                key={subject.key}
                className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <label className="flex items-center gap-2 text-xs text-zinc-200">
                  <input
                    type="checkbox"
                    checked={subject.included}
                    disabled={disabled || subject.role !== "supporting_character"}
                    onChange={(event) =>
                      onChange(
                        applyUserCastEdits(manifest, subject.key, {
                          included: event.target.checked,
                        })
                      )
                    }
                  />
                  <span className="font-semibold">{subject.name}</span>
                  <span className="text-[10px] text-zinc-500">
                    {subject.role === "persona"
                      ? "페르소나"
                      : subject.role === "main_character"
                        ? "메인 캐릭터"
                        : "조연"}
                  </span>
                </label>
                {subject.included ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10px] font-semibold text-zinc-500">중요도</span>
                      <select
                        value={subject.importance}
                        disabled={disabled || subject.role !== "supporting_character"}
                        onChange={(event) =>
                          onChange(
                            applyUserCastEdits(manifest, subject.key, {
                              importance: event.target.value as ChatImageCastImportance,
                            })
                          )
                        }
                        className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-[11px] text-zinc-200"
                      >
                        {IMPORTANCE.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-semibold text-zinc-500">노출</span>
                      <select
                        value={subject.visibility}
                        disabled={disabled}
                        onChange={(event) =>
                          onChange(
                            applyUserCastEdits(manifest, subject.key, {
                              visibility: event.target.value as ChatImageCastVisibility,
                            })
                          )
                        }
                        className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-[11px] text-zinc-200"
                      >
                        {VISIBILITY.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                {subject.role === "supporting_character" && subject.included ? (
                  <div className="space-y-1">
                    <span className="text-[10px] font-semibold text-zinc-500">참고 에셋</span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          onChange(
                            applyUserCastEdits(manifest, subject.key, {
                              requestedReferenceAssetUrl: "",
                            })
                          )
                        }
                        className={`rounded-lg border px-2 py-1 text-[10px] ${
                          !selectedAsset
                            ? "border-violet-400 bg-violet-500/20 text-violet-100"
                            : "border-white/10 text-zinc-400"
                        }`}
                      >
                        없음
                      </button>
                      {selectableAssets.map((asset) => (
                        <button
                          key={asset.url}
                          type="button"
                          disabled={disabled}
                          title={asset.tag}
                          onClick={() =>
                            onChange(
                              applyUserCastEdits(manifest, subject.key, {
                                requestedReferenceAssetUrl: asset.url,
                              })
                            )
                          }
                          className={`overflow-hidden rounded-lg border ${
                            selectedAsset === asset.url
                              ? "border-violet-400 ring-1 ring-violet-400/40"
                              : "border-white/10"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={asset.url}
                            alt={asset.tag}
                            className="h-12 w-12 object-cover"
                          />
                          <span className="block max-w-[72px] truncate px-1 py-0.5 text-[9px] text-zinc-400">
                            {asset.tag}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-[11px] font-semibold text-zinc-400">구도</h3>
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-black/25 p-1">
          {GOALS.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...manifest, compositionGoal: item.id })}
              className={`rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
                manifest.compositionGoal === item.id
                  ? "bg-violet-600 text-white"
                  : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {castNeedsFourPlusWarning(manifest) ? (
        <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
          {CHAT_IMAGE_CAST_FOUR_PLUS_WARNING}
        </p>
      ) : null}
    </section>
  );
}
