"use client";

import ChatImageCastPicker from "@/components/ChatImageCastPicker";
import type { ChatImageCastIntentManifest, SelectableCastAsset } from "@/lib/chatImageCast";
import type { ContentKind } from "@/lib/simulationMode";
import type { ClientVisibleVisualSubject } from "@/lib/visualSubjects";
import type { ScenePlan } from "@/lib/chatImageScenePlan";

export type SceneOutputMode = "illustration" | "comic";

type ChatSceneBuilderProps = {
  sourceLoading: boolean;
  plan: ScenePlan | null;
  planLoading: boolean;
  castManifest: ChatImageCastIntentManifest | null;
  selectableAssets: readonly SelectableCastAsset[];
  visualSubjects?: readonly ClientVisibleVisualSubject[];
  reservedReferenceUrls?: readonly string[];
  contentKind?: ContentKind;
  outputMode: SceneOutputMode;
  disabled?: boolean;
  onOutputModeChange: (mode: SceneOutputMode) => void;
  onCastChange: (manifest: ChatImageCastIntentManifest) => void;
};

export default function ChatSceneBuilder({
  sourceLoading,
  plan,
  planLoading,
  castManifest,
  selectableAssets,
  visualSubjects,
  reservedReferenceUrls,
  contentKind = "character",
  outputMode,
  disabled,
  onOutputModeChange,
  onCastChange,
}: ChatSceneBuilderProps) {
  const loading = sourceLoading || planLoading;

  return (
    <div className="space-y-3">
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold text-zinc-400">형식</h3>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/25 p-1">
          {(
            [
              ["illustration", "일러스트"],
              ["comic", "컷만화"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onOutputModeChange(id)}
              className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
                outputMode === id
                  ? "bg-violet-600 text-white"
                  : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {outputMode === "comic" ? (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold text-zinc-400">컷만화</h3>
          <div className="space-y-1">
            <p className="text-xs leading-relaxed text-zinc-400">
              AI가 대화에서 중요한 장면을 골라 자연스러운 컷만화로 구성합니다.
            </p>
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        {loading ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
            선택한 턴을 불러오는 중…
          </p>
        ) : null}

        {plan && outputMode === "comic" ? (
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="space-y-1">
              <h3 className="text-[11px] font-semibold text-zinc-400">컷만화 생성</h3>
              <p className="text-xs leading-relaxed text-zinc-400">
                전체 턴에서 중요한 장면을 골라 4컷 만화를 자동으로 구성합니다.
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {castManifest ? (
        <ChatImageCastPicker
          manifest={castManifest}
          selectableAssets={selectableAssets}
          visualSubjects={visualSubjects}
          reservedReferenceUrls={reservedReferenceUrls}
          contentKind={contentKind}
          disabled={disabled}
          onChange={onCastChange}
        />
      ) : null}
    </div>
  );
}
