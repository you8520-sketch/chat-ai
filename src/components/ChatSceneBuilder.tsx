"use client";

import { useEffect, useState } from "react";

import ChatImageCastPicker from "@/components/ChatImageCastPicker";
import type { ChatImageCastIntentManifest, SelectableCastAsset } from "@/lib/chatImageCast";
import type { ContentKind } from "@/lib/simulationMode";
import type { ClientVisibleVisualSubject } from "@/lib/visualSubjects";
import {
  buildDialogueSpeakerOptions,
  dialogueSpeakerChoiceFromKey,
  dialogueSpeakerChoiceKey,
  resolveDialogueSpeakerDisplayLabel,
  resolveDialogueSpeakerOptionKey,
  type DialogueSpeakerChoice,
} from "@/lib/chatImageDialogueSpeakerEditor";
import {
  addPanelDialogueLine,
  applyUserPanelEdits,
  collectCanonicalSpeakerNames,
  movePanelDialogueLine,
  projectComicPanelCompactDialoguePreview,
  projectComicPanelCompactSituation,
  removePanelDialogueLine,
  resolveScenePresentationVisibility,
  updatePanelDialogueAtIndex,
  type SceneDialogueSpeaker,
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
  personaName: string;
  characterName: string;
  castSpeakerNames?: readonly string[];
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

function ComicPanelCompactDialoguePreview({
  panel,
  personaName,
  characterName,
  personaVisible,
}: {
  panel: ScenePanel;
  personaName: string;
  characterName: string;
  personaVisible: boolean;
}) {
  const preview = projectComicPanelCompactDialoguePreview(panel, { personaVisible });

  return (
    <div className="mt-2 space-y-1">
      <p className="text-[10px] font-semibold text-zinc-500">
        대사 {preview.previewLines.length}/{preview.totalVisible} 표시
      </p>
      {preview.totalVisible === 0 ? (
        <p className="text-xs text-zinc-500">대사 없음</p>
      ) : (
        <ul className="space-y-0.5">
          {preview.previewLines.map((line, index) => (
            <li
              key={`${panel.index}-dialogue-preview-${index}`}
              className="flex gap-1.5 text-xs leading-snug text-zinc-300"
            >
              <span className="shrink-0 font-semibold text-zinc-400">
                {resolveDialogueSpeakerDisplayLabel(
                  line.speaker,
                  personaName,
                  characterName,
                  line.speakerName
                )}
              </span>
              <span className="min-w-0 text-zinc-200">{line.text}</span>
            </li>
          ))}
          {preview.hiddenCount > 0 ? (
            <li className="text-[11px] font-semibold text-zinc-500">
              +{preview.hiddenCount}개 더 있음
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function ComicPanelStoryboardCard({
  panel,
  plan,
  personaName,
  characterName,
  castSpeakerNames,
  personaVisible,
  disabled,
  dialogueEditOpen,
  onToggleDialogueEdit,
  onPlanChange,
}: {
  panel: ScenePanel;
  plan: ScenePlan;
  personaName: string;
  characterName: string;
  castSpeakerNames?: readonly string[];
  personaVisible: boolean;
  disabled?: boolean;
  dialogueEditOpen: boolean;
  onToggleDialogueEdit: () => void;
  onPlanChange: (plan: ScenePlan) => void;
}) {
  const compactSituation = projectComicPanelCompactSituation(plan, panel, { personaVisible });

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold text-violet-200">{panel.index}컷</p>
      </div>
      {compactSituation ? (
        <p className="mt-1 text-xs leading-snug text-zinc-200">{compactSituation}</p>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">장면 없음</p>
      )}
      {dialogueEditOpen ? (
        <ComicPanelDialogueEditor
          panel={panel}
          plan={plan}
          personaName={personaName}
          characterName={characterName}
          castSpeakerNames={castSpeakerNames}
          personaVisible={personaVisible}
          disabled={disabled}
          onPlanChange={onPlanChange}
        />
      ) : (
        <ComicPanelCompactDialoguePreview
          panel={panel}
          personaName={personaName}
          characterName={characterName}
          personaVisible={personaVisible}
        />
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={onToggleDialogueEdit}
        className="mt-1.5 text-[11px] font-semibold text-violet-200 hover:text-white disabled:opacity-40"
      >
        {dialogueEditOpen ? "대사 미리보기로" : "대사 편집"}
      </button>
    </div>
  );
}

function PanelVisualEditor({
  panel,
  disabled,
  onChange,
}: {
  panel: ScenePanel;
  disabled?: boolean;
  onChange: (patch: Partial<ScenePanel>) => void;
}) {
  return (
    <label className="block space-y-1 rounded-lg border border-white/10 bg-black/20 p-2">
      <span className="text-[10px] font-semibold text-zinc-500">장면 설명</span>
      <textarea
        value={panel.situation}
        disabled={disabled}
        rows={2}
        onChange={(event) => onChange({ situation: event.target.value })}
        className="w-full resize-y rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
      />
    </label>
  );
}

function DialogueRowEditor({
  lineIndex,
  lineCount,
  speaker,
  speakerName,
  text,
  personaName,
  characterName,
  speakerChoices,
  disabled,
  onSpeakerChange,
  onTextChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  lineIndex: number;
  lineCount: number;
  speaker: SceneDialogueSpeaker;
  speakerName?: string;
  text: string;
  personaName: string;
  characterName: string;
  speakerChoices: DialogueSpeakerChoice[];
  disabled?: boolean;
  onSpeakerChange: (speaker: SceneDialogueSpeaker, speakerName?: string) => void;
  onTextChange: (text: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const selectedKey = resolveDialogueSpeakerOptionKey(
    { speaker, speakerName },
    personaName,
    characterName
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={selectedKey}
        disabled={disabled}
        onChange={(event) => {
          const choice = dialogueSpeakerChoiceFromKey(event.target.value, speakerChoices);
          if (!choice) return;
          onSpeakerChange(choice.value, choice.speakerName);
        }}
        className="min-w-[4.5rem] rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
      >
        {speakerChoices.map((choice) => (
          <option
            key={dialogueSpeakerChoiceKey(choice.value, choice.speakerName)}
            value={dialogueSpeakerChoiceKey(choice.value, choice.speakerName)}
          >
            {choice.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={text}
        disabled={disabled}
        placeholder="대사"
        onChange={(event) => onTextChange(event.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500/50"
      />
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          disabled={disabled || lineIndex === 0}
          onClick={onMoveUp}
          className="rounded border border-white/10 px-1.5 py-1 text-[10px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-30"
          aria-label="대사 위로"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={disabled || lineIndex >= lineCount - 1}
          onClick={onMoveDown}
          className="rounded border border-white/10 px-1.5 py-1 text-[10px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-30"
          aria-label="대사 아래로"
        >
          ↓
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          className="rounded border border-white/10 px-1.5 py-1 text-[10px] text-zinc-400 hover:bg-rose-500/20 hover:text-rose-200 disabled:opacity-30"
          aria-label="대사 삭제"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function ComicPanelDialogueEditor({
  panel,
  plan,
  personaName,
  characterName,
  castSpeakerNames,
  personaVisible,
  disabled,
  onPlanChange,
}: {
  panel: ScenePanel;
  plan: ScenePlan;
  personaName: string;
  characterName: string;
  castSpeakerNames?: readonly string[];
  personaVisible: boolean;
  disabled?: boolean;
  onPlanChange: (plan: ScenePlan) => void;
}) {
  const includeOther = panel.dialogue.some(
    (line) => line.speaker === "other" && !line.speakerName
  );
  const canonicalSpeakerNames = collectCanonicalSpeakerNames(plan);
  const choices = buildDialogueSpeakerOptions({
    personaName,
    characterName,
    castSpeakerNames,
    canonicalSpeakerNames,
    personaVisible,
    includeOther,
  });
  const defaultSpeaker = personaVisible ? "persona" : "character";

  const visibleDialogue = panel.dialogue.filter(
    (line) => personaVisible || line.speaker !== "persona"
  );

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-[10px] font-semibold text-zinc-500">대사</p>
      {visibleDialogue.length ? (
        visibleDialogue.map((line, visibleIndex) => {
          const lineIndex = panel.dialogue.indexOf(line);
          return (
            <DialogueRowEditor
              key={`${panel.index}-${lineIndex}-${visibleIndex}`}
              lineIndex={visibleIndex}
              lineCount={visibleDialogue.length}
              speaker={line.speaker}
              speakerName={line.speakerName}
              text={line.text}
              personaName={personaName}
              characterName={characterName}
              speakerChoices={choices}
              disabled={disabled}
              onSpeakerChange={(speaker, speakerName) => {
                onPlanChange(
                  updatePanelDialogueAtIndex(plan, panel.index, lineIndex, {
                    speaker,
                    speakerName,
                  })
                );
              }}
              onTextChange={(text) => {
                onPlanChange(
                  updatePanelDialogueAtIndex(plan, panel.index, lineIndex, { text })
                );
              }}
              onMoveUp={() => {
                onPlanChange(movePanelDialogueLine(plan, panel.index, lineIndex, "up"));
              }}
              onMoveDown={() => {
                onPlanChange(movePanelDialogueLine(plan, panel.index, lineIndex, "down"));
              }}
              onRemove={() => {
                onPlanChange(removePanelDialogueLine(plan, panel.index, lineIndex));
              }}
            />
          );
        })
      ) : (
        <p className="text-xs text-zinc-500">대사 없음</p>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          onPlanChange(addPanelDialogueLine(plan, panel.index, defaultSpeaker));
        }}
        className="text-[11px] font-semibold text-violet-200 hover:text-white disabled:opacity-40"
      >
        + 대사 추가
      </button>
    </div>
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
  personaName,
  characterName,
  castSpeakerNames,
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
  const [dialogueEditOpenPanels, setDialogueEditOpenPanels] = useState<Set<number>>(
    () => new Set()
  );
  const loading = sourceLoading || planLoading;
  const personaVisible = resolveScenePresentationVisibility({
    contentKind,
    castManifest,
  }).personaVisible;

  useEffect(() => {
    setDialogueEditOpenPanels((current) => {
      const validIndices = new Set(plan?.panels.map((panel) => panel.index) ?? []);
      const next = new Set<number>();
      for (const index of current) {
        if (validIndices.has(index)) next.add(index);
      }
      return next.size === current.size ? current : next;
    });
  }, [plan?.panels, panelCount]);

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
            AI 장면을 정리하는 중…
          </p>
        ) : null}
        {aiSuggestionError ? (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-200">
            {aiSuggestionError}
          </p>
        ) : null}

        {plan && outputMode === "comic" ? (
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <h3 className="text-[11px] font-semibold text-zinc-400">컷 미리보기</h3>
            <div className="space-y-2">
              {plan.panels.map((panel) => (
                <ComicPanelStoryboardCard
                  key={panel.index}
                  panel={panel}
                  plan={plan}
                  personaName={personaName}
                  characterName={characterName}
                  castSpeakerNames={castSpeakerNames}
                  personaVisible={personaVisible}
                  disabled={disabled}
                  dialogueEditOpen={dialogueEditOpenPanels.has(panel.index)}
                  onToggleDialogueEdit={() => {
                    setDialogueEditOpenPanels((current) => {
                      const next = new Set(current);
                      if (next.has(panel.index)) next.delete(panel.index);
                      else next.add(panel.index);
                      return next;
                    });
                  }}
                  onPlanChange={onPlanChange}
                />
              ))}
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setSceneEditOpen((current) => !current)}
              className="text-[11px] font-semibold text-violet-200 hover:text-white disabled:opacity-40"
            >
              {sceneEditOpen ? "장면 미리보기로" : "장면 자세히 수정"}
            </button>
            {sceneEditOpen ? (
              <div className="space-y-2 border-t border-white/10 pt-2">
                {plan.panels.map((panel) => (
                  <div key={`visual-${panel.index}`} className="space-y-1">
                    <p className="text-[11px] font-semibold text-violet-200">{panel.index}컷</p>
                    <PanelVisualEditor
                      panel={panel}
                      disabled={disabled}
                      onChange={(patch) => {
                        onPlanChange(applyUserPanelEdits(plan, panel.index, patch));
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              disabled={disabled || aiSuggestionLoading || planLoading || !plan}
              onClick={onRequestAiSuggestion}
              className="block text-[11px] font-semibold text-zinc-400 hover:text-violet-200 disabled:opacity-40"
            >
              {hasAiSuggestionSession ? "AI로 다시 정리" : "AI로 다시 정리 (선택)"}
            </button>
          </div>
        ) : null}
      </section>

      {aiSuggestedPlan ? (
        <section className="space-y-2 rounded-xl border border-violet-400/25 bg-violet-500/[0.06] p-3">
          <h3 className="text-[11px] font-semibold text-violet-200">AI 제안</h3>
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
              onClick={onCancelAiSuggestion}
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
