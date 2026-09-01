"use client";

import { useState } from "react";

import ChatImageCastPicker from "@/components/ChatImageCastPicker";
import type { ChatImageCastIntentManifest, SelectableCastAsset } from "@/lib/chatImageCast";
import type { ContentKind } from "@/lib/simulationMode";
import type { ClientVisibleVisualSubject } from "@/lib/visualSubjects";
import {
  applyUserIllustrationEdits,
  applyUserPanelEdits,
  type ScenePanel,
  type ScenePanelCount,
  type ScenePlan,
} from "@/lib/chatImageScenePlan";

export type SceneOutputMode = "illustration" | "comic";

type ChatSceneBuilderProps = {
  sourcePreview: string;
  sourceLoading: boolean;
  plan: ScenePlan | null;
  planLoading: boolean;
  aiSuggestedPlan: ScenePlan | null;
  aiSuggestionLoading: boolean;
  aiSuggestionError: string;
  hasAiSuggestionSession: boolean;
  castManifest: ChatImageCastIntentManifest | null;
  selectableAssets: readonly SelectableCastAsset[];
  visualSubjects?: readonly ClientVisibleVisualSubject[];
  reservedReferenceUrls?: readonly string[];
  contentKind?: ContentKind;
  outputMode: SceneOutputMode;
  panelCount: ScenePanelCount;
  disabled?: boolean;
  onOutputModeChange: (mode: SceneOutputMode) => void;
  onPanelCountChange: (count: ScenePanelCount) => void;
  onPlanChange: (plan: ScenePlan) => void;
  onCastChange: (manifest: ChatImageCastIntentManifest) => void;
  onRequestAiSuggestion: () => void;
  onApplyAiSuggestion: () => void;
  onCancelAiSuggestion: () => void;
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
  contentKind = "character",
}: {
  panel: ScenePanel;
  disabled?: boolean;
  onChange: (patch: Partial<ScenePanel>) => void;
  contentKind?: ContentKind;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2">
      <label className="block space-y-1">
        <span className="text-[10px] font-semibold text-zinc-500">장면</span>
        <textarea
          value={panel.situation}
          disabled={disabled}
          rows={2}
          onChange={(event) => onChange({ situation: event.target.value })}
          className="w-full resize-y rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
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

function IllustrationEditor({
  plan,
  disabled,
  onChange,
}: {
  plan: ScenePlan;
  disabled?: boolean;
  onChange: (plan: ScenePlan) => void;
}) {
  return (
    <label className="block space-y-1 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <span className="text-[10px] font-semibold text-zinc-500">장면 설명</span>
      <textarea
        value={plan.heroScene}
        disabled={disabled}
        rows={3}
        onChange={(event) =>
          onChange(applyUserIllustrationEdits(plan, { heroScene: event.target.value }))
        }
        className="w-full resize-y rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
      />
    </label>
  );
}

export default function ChatSceneBuilder({
  sourceLoading,
  plan,
  planLoading,
  aiSuggestedPlan,
  aiSuggestionLoading,
  aiSuggestionError,
  hasAiSuggestionSession,
  castManifest,
  selectableAssets,
  visualSubjects,
  reservedReferenceUrls,
  contentKind = "character",
  outputMode,
  panelCount,
  disabled,
  onOutputModeChange,
  onPanelCountChange,
  onPlanChange,
  onCastChange,
  onRequestAiSuggestion,
  onApplyAiSuggestion,
  onCancelAiSuggestion,
}: ChatSceneBuilderProps) {
  const [sceneEditOpen, setSceneEditOpen] = useState(false);
  const [showAiPreview, setShowAiPreview] = useState(false);
  const loading = sourceLoading || planLoading;

  return (
    <div className="space-y-3">
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
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-black/25 p-1">
            {([2, 3, 4] as const).map((count) => (
              <button
                key={count}
                type="button"
                disabled={disabled || !plan}
                onClick={() => onPanelCountChange(count)}
                className={`rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
                  panelCount === count
                    ? "bg-violet-600 text-white"
                    : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                }`}
              >
                {count}컷
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        {loading ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
            선택 턴 장면을 정리하는 중…
          </p>
        ) : null}
        {aiSuggestionLoading ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
            AI 장면 제안을 불러오는 중…
          </p>
        ) : null}
        {aiSuggestionError ? (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-200">
            {aiSuggestionError}
          </p>
        ) : null}

        {plan && !sceneEditOpen ? (
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <h3 className="text-[11px] font-semibold text-zinc-400">
              {outputMode === "illustration" ? "장면 미리보기" : "컷 미리보기"}
            </h3>
            {outputMode === "illustration" ? (
              <p className="text-xs leading-relaxed text-zinc-200">
                {plan.heroScene || "장면을 정리했습니다."}
              </p>
            ) : (
              <div className="space-y-2">
                {plan.panels.map((panel) => {
                  const firstDialogue = panel.dialogue[0];
                  return (
                    <div key={panel.index} className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="text-[11px] font-semibold text-violet-200">{panel.index}컷</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-200">{panel.situation}</p>
                      {firstDialogue ? (
                        <p className="mt-1 text-xs text-zinc-400">
                          {speakerLabel(firstDialogue.speaker)} · “{firstDialogue.text}”
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-zinc-500">대사 없음</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() => setSceneEditOpen(true)}
              className="text-[11px] font-semibold text-violet-200 hover:text-white disabled:opacity-40"
            >
              장면 수정
            </button>
          </div>
        ) : null}

        {plan && sceneEditOpen ? (
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold text-zinc-400">장면 수정</h3>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setSceneEditOpen(false)}
                className="text-[11px] font-semibold text-zinc-400 hover:text-white"
              >
                닫기
              </button>
            </div>
            {outputMode === "illustration" ? (
              <IllustrationEditor plan={plan} disabled={disabled} onChange={onPlanChange} />
            ) : (
              plan.panels.map((panel) => (
                <div key={panel.index} className="space-y-1">
                  <p className="text-[11px] font-semibold text-violet-200">{panel.index}컷</p>
                  <PanelEditor
                    panel={panel}
                    disabled={disabled}
                    contentKind={contentKind}
                    onChange={(patch) => {
                      onPlanChange(applyUserPanelEdits(plan, panel.index, patch));
                    }}
                  />
                </div>
              ))
            )}
            <button
              type="button"
              disabled={disabled || aiSuggestionLoading || planLoading || !plan}
              onClick={onRequestAiSuggestion}
              className="text-[11px] font-semibold text-violet-200 hover:text-white disabled:opacity-40"
            >
              {hasAiSuggestionSession ? "✨ AI 장면 다시 제안" : "✨ AI 장면 제안 (선택)"}
            </button>
          </div>
        ) : null}
      </section>

      {aiSuggestedPlan ? (
        <section className="space-y-2 rounded-xl border border-violet-400/25 bg-violet-500/[0.06] p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold text-violet-200">AI 제안</h3>
            <button
              type="button"
              className="text-[10px] font-semibold text-violet-100 hover:text-white"
              onClick={() => setShowAiPreview((current) => !current)}
            >
              {showAiPreview ? "미리보기 닫기" : "미리보기"}
            </button>
          </div>
          {showAiPreview ? (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-200">
              {aiSuggestedPlan.heroScene || aiSuggestedPlan.sceneBackground}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={onApplyAiSuggestion}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
            >
              제안 적용
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setShowAiPreview(false);
                onCancelAiSuggestion();
              }}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-white/[0.06] disabled:opacity-40"
            >
              취소
            </button>
          </div>
        </section>
      ) : null}

      {castManifest ? (
        <ChatImageCastPicker
          manifest={castManifest}
          selectableAssets={selectableAssets}
          visualSubjects={visualSubjects}
          reservedReferenceUrls={reservedReferenceUrls}
          contentKind={contentKind}
          disabled={disabled || aiSuggestionLoading}
          onChange={onCastChange}
        />
      ) : null}
    </div>
  );
}
