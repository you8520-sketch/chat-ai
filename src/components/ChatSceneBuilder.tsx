"use client";

import { useState } from "react";

import ChatImageCastPicker from "@/components/ChatImageCastPicker";
import type { ChatImageCastIntentManifest, SelectableCastAsset } from "@/lib/chatImageCast";
import {
  applyUserPanelEdits,
  type ScenePanel,
  type ScenePanelCount,
  type ScenePlan,
} from "@/lib/chatImageScenePlan";

export type SceneOutputMode = "illustration" | "comic";
export type ScenePanelCountMode = "ai" | ScenePanelCount;

type ChatSceneBuilderProps = {
  sourcePreview: string;
  sourceLoading: boolean;
  plan: ScenePlan | null;
  planLoading: boolean;
  castManifest: ChatImageCastIntentManifest | null;
  selectableAssets: readonly SelectableCastAsset[];
  reservedReferenceUrls?: readonly string[];
  outputMode: SceneOutputMode;
  panelCountMode: ScenePanelCountMode;
  disabled?: boolean;
  onOutputModeChange: (mode: SceneOutputMode) => void;
  onPanelCountModeChange: (mode: ScenePanelCountMode) => void;
  onPlanChange: (plan: ScenePlan) => void;
  onCastChange: (manifest: ChatImageCastIntentManifest) => void;
  onRebuildPlan: () => void;
};

function speakerLabel(speaker: string): string {
  if (speaker === "persona") return "유저캐";
  if (speaker === "character") return "캐릭터";
  return "기타";
}

function PanelEditor({
  panel,
  disabled,
  onChange,
}: {
  panel: ScenePanel;
  disabled?: boolean;
  onChange: (patch: Partial<ScenePanel>) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2">
      <label className="block space-y-1">
        <span className="text-[10px] font-semibold text-zinc-500">상황</span>
        <textarea
          value={panel.situation}
          disabled={disabled}
          rows={2}
          onChange={(event) => onChange({ situation: event.target.value })}
          className="w-full resize-y rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[10px] font-semibold text-zinc-500">배경 override</span>
        <input
          value={panel.backgroundOverride ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ backgroundOverride: event.target.value })}
          className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[10px] font-semibold text-zinc-500">캐릭터 행동 / 표정</span>
        <input
          value={panel.characterAction ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ characterAction: event.target.value })}
          className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[10px] font-semibold text-zinc-500">유저캐 행동 / 표정</span>
        <input
          value={panel.personaAction ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ personaAction: event.target.value })}
          className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[10px] font-semibold text-zinc-500">대사</span>
        <textarea
          value={panel.dialogue
            .map((line) => `${speakerLabel(line.speaker)} · ${line.text}`)
            .join("\n")}
          disabled={disabled}
          rows={2}
          onChange={(event) => {
            const dialogue = event.target.value
              .split("\n")
              .map((row) => row.trim())
              .filter(Boolean)
              .map((row) => {
                const match = row.match(/^(유저캐|캐릭터|기타)\s*·\s*(.+)$/);
                const label = match?.[1];
                const speaker =
                  label === "유저캐"
                    ? "persona"
                    : label === "캐릭터"
                      ? "character"
                      : "other";
                return {
                  speaker: speaker as "persona" | "character" | "other",
                  text: match?.[2] ?? row,
                  provenance: "user_edit" as const,
                };
              });
            onChange({ dialogue });
          }}
          className="w-full resize-y rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
        />
      </label>
    </div>
  );
}

export default function ChatSceneBuilder({
  sourcePreview,
  sourceLoading,
  plan,
  planLoading,
  castManifest,
  selectableAssets,
  reservedReferenceUrls,
  outputMode,
  panelCountMode,
  disabled,
  onOutputModeChange,
  onPanelCountModeChange,
  onPlanChange,
  onCastChange,
  onRebuildPlan,
}: ChatSceneBuilderProps) {
  const [expandedPanel, setExpandedPanel] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      <section className="space-y-1">
        <h3 className="text-[11px] font-semibold text-zinc-400">장면 원본</h3>
        {sourceLoading ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
            선택 턴을 불러오는 중…
          </p>
        ) : (
          <p className="whitespace-pre-wrap rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-zinc-300">
            {sourcePreview || "채팅 메시지 아래 이미지 버튼을 누르면 그 턴이 장면 원본이 됩니다."}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold text-zinc-400">
            {outputMode === "illustration" ? "한 장 장면" : "컷 구성"}
          </h3>
          <button
            type="button"
            disabled={disabled || planLoading || !sourcePreview}
            onClick={onRebuildPlan}
            className="text-[11px] font-semibold text-violet-200 hover:text-white disabled:opacity-40"
          >
            AI 다시 구성
          </button>
        </div>
        {planLoading ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
            장면을 구성하는 중…
          </p>
        ) : null}
        {plan && outputMode === "illustration" ? (
          <div className="rounded-xl border border-violet-400/20 bg-violet-500/[0.06] px-3 py-2 text-xs leading-relaxed text-zinc-200">
            {plan.heroScene || plan.sceneBackground}
          </div>
        ) : null}
        {plan && outputMode === "comic"
          ? plan.panels.map((panel) => {
              const firstDialogue = panel.dialogue[0];
              return (
                <article
                  key={panel.index}
                  className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                >
                  <p className="text-[11px] font-semibold text-violet-200">{panel.index}컷</p>
                  <p className="text-xs leading-relaxed text-zinc-200">{panel.situation}</p>
                  {firstDialogue ? (
                    <p className="text-xs text-zinc-400">
                      {speakerLabel(firstDialogue.speaker)} · “{firstDialogue.text}”
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-500">대사 없음</p>
                  )}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      setExpandedPanel((current) =>
                        current === panel.index ? null : panel.index
                      )
                    }
                    className="text-[11px] font-semibold text-zinc-400 hover:text-white"
                  >
                    수정
                  </button>
                  {expandedPanel === panel.index ? (
                    <PanelEditor
                      panel={panel}
                      disabled={disabled}
                      onChange={(patch) => {
                        onPlanChange(applyUserPanelEdits(plan, panel.index, patch));
                      }}
                    />
                  ) : null}
                </article>
              );
            })
          : null}
      </section>

      {castManifest ? (
        <ChatImageCastPicker
          manifest={castManifest}
          selectableAssets={selectableAssets}
          reservedReferenceUrls={reservedReferenceUrls}
          disabled={disabled || planLoading}
          onChange={onCastChange}
        />
      ) : null}

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold text-zinc-400">형식</h3>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/25 p-1">
          {(
            [
              ["illustration", "한 장 일러스트"],
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
          <h3 className="text-[11px] font-semibold text-zinc-400">컷 수</h3>
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-black/25 p-1">
            {(
              [
                ["ai", "AI 추천"],
                [2, "2컷"],
                [3, "3컷"],
                [4, "4컷"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={String(id)}
                type="button"
                disabled={disabled || !plan}
                onClick={() => onPanelCountModeChange(id)}
                className={`rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
                  panelCountMode === id
                    ? "bg-violet-600 text-white"
                    : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
