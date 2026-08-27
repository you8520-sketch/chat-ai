"use client";

import {
  CHAT_IMAGE_CAST_FOUR_PLUS_WARNING,
  CHAT_IMAGE_CAST_MAX_SELECTED,
  applyUserCastEdits,
  castCandidateSourceLabel,
  castNeedsFourPlusWarning,
  isCastReferenceUrlTaken,
  isCastSelectionAtMax,
  selectedCastIntentSubjects,
  type ChatImageCastImportance,
  type ChatImageCastIntentManifest,
  type ChatImageCastVisibility,
  type SelectableCastAsset,
} from "@/lib/chatImageCast";
import type { ContentKind } from "@/lib/simulationMode";

const IMPORTANCE: Array<{ id: ChatImageCastImportance; label: string }> = [
  { id: "primary", label: "핵심" },
  { id: "secondary", label: "조연" },
  { id: "background", label: "배경" },
];

const SIMULATION_IMPORTANCE: Array<{ id: ChatImageCastImportance; label: string }> = [
  { id: "primary", label: "핵심" },
  { id: "secondary", label: "일반" },
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
  reservedReferenceUrls?: readonly string[];
  contentKind?: ContentKind;
  disabled?: boolean;
  onChange: (manifest: ChatImageCastIntentManifest) => void;
};

function roleLabel(role: string, contentKind: ContentKind): string {
  if (role === "persona") return "내 페르소나";
  if (role === "main_character") return "메인 캐릭터";
  return contentKind === "simulation" ? "인물" : "조연";
}

export default function ChatImageCastPicker({
  manifest,
  selectableAssets,
  reservedReferenceUrls = [],
  contentKind = "character",
  disabled,
  onChange,
}: ChatImageCastPickerProps) {
  const selectedCount = selectedCastIntentSubjects(manifest).length;
  const atMax = isCastSelectionAtMax(manifest);
  const isSimulation = contentKind === "simulation";
  const importanceOptions = isSimulation ? SIMULATION_IMPORTANCE : IMPORTANCE;

  return (
    <section className="space-y-3">
      <div className="space-y-2">
        <h3 className="text-[11px] font-semibold text-zinc-400">
          출연 인물 · {selectedCount}/{CHAT_IMAGE_CAST_MAX_SELECTED}
        </h3>
        {selectedCount === 0 ? (
          <p className="text-[11px] text-amber-200">최소 1명을 선택해 주세요.</p>
        ) : null}
        {atMax ? (
          <p className="text-[11px] text-zinc-500">최대 4명까지 선택할 수 있어요.</p>
        ) : null}
        <div className="space-y-2">
          {manifest.subjects.map((subject) => {
            const selectedAsset = subject.requestedReferenceAssetUrl;
            const canToggleIncluded =
              subject.role === "supporting_character" ||
              (isSimulation && subject.role === "persona");
            const includeBlocked =
              !subject.included && atMax && canToggleIncluded;
            return (
              <article
                key={subject.key}
                className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <label className="flex items-center gap-2 text-xs text-zinc-200">
                  <input
                    type="checkbox"
                    checked={subject.included}
                    disabled={disabled || !canToggleIncluded || includeBlocked}
                    onChange={(event) =>
                      onChange(
                        applyUserCastEdits(
                          manifest,
                          subject.key,
                          { included: event.target.checked },
                          contentKind
                        )
                      )
                    }
                  />
                  <span className="font-semibold">{subject.name}</span>
                  <span className="text-[10px] text-zinc-500">
                    {roleLabel(subject.role, contentKind)}
                    {subject.candidateSources?.length
                      ? ` · ${castCandidateSourceLabel(subject.candidateSources)}`
                      : ""}
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
                            applyUserCastEdits(
                              manifest,
                              subject.key,
                              { importance: event.target.value as ChatImageCastImportance },
                              contentKind
                            )
                          )
                        }
                        className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-[11px] text-zinc-200"
                      >
                        {importanceOptions.map((item) => (
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
                        disabled={disabled || subject.role !== "supporting_character"}
                        onChange={(event) =>
                          onChange(
                            applyUserCastEdits(
                              manifest,
                              subject.key,
                              { visibility: event.target.value as ChatImageCastVisibility },
                              contentKind
                            )
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
                            applyUserCastEdits(
                              manifest,
                              subject.key,
                              { requestedReferenceAssetUrl: "" },
                              contentKind
                            )
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
                      {selectableAssets.map((asset) => {
                        const taken = isCastReferenceUrlTaken(
                          manifest,
                          subject.key,
                          asset.url,
                          reservedReferenceUrls
                        );
                        return (
                          <button
                            key={asset.url}
                            type="button"
                            disabled={disabled || (taken && selectedAsset !== asset.url)}
                            title={
                              taken && selectedAsset !== asset.url
                                ? `${asset.tag} · 다른 인물이 이미 사용 중`
                                : asset.tag
                            }
                            onClick={() =>
                              onChange(
                                applyUserCastEdits(
                                  manifest,
                                  subject.key,
                                  { requestedReferenceAssetUrl: asset.url },
                                  contentKind
                                )
                              )
                            }
                            className={`overflow-hidden rounded-lg border ${
                              selectedAsset === asset.url
                                ? "border-violet-400 ring-1 ring-violet-400/40"
                                : taken
                                  ? "border-white/5 opacity-40"
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
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
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
