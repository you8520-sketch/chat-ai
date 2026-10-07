"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import JsxComponentSandbox, { type JsxSandboxStatus } from "@/components/JsxComponentSandbox";
import type { JsxTrpgActionDraftRequest, JsxTrpgSelectedStatRequest } from "@/lib/jsxComponent/hostBridge";
import { JSX_SANDBOX_AUTO_HEIGHT_MIN_PX } from "@/lib/jsxComponent/limits";
import {
  TRPG_VISIBLE_ACTION_TYPES,
  actionTypeLabelKo,
  isTrpgVisibleActionType,
  type TrpgActionType,
} from "@/lib/trpg/actionTypes";
import {
  RECOVERY_DISCOVERY_HINT,
  SAFE_REST_COOLDOWN_HINT,
  SAFE_REST_ONGOING_NOTICE,
  contextualFirstAidDraft,
  contextualSafeRestDraft,
  contextualStatusTreatDraft,
  showContextualFirstAid,
  showContextualStatusTreat,
} from "@/lib/trpg/actionComposer";
import {
  commandDockModeLabel,
  initialTrpgCommandDockView,
  isTreatableOngoingKind,
  openTrpgCommandDockMode,
  reconcileTrpgCommandDockLifecycle,
  selectPartySheetParticipantId,
  selectTrpgCommandDockMode,
  trpgCommandDockLifecycleKey,
  trpgCommandDockOcclusion,
  type TrpgActionDraftFill,
  type TrpgCommandDockMode,
  type TrpgCommandDockOcclusion,
} from "@/lib/trpg/commandDock";
import { partyDetailedSheetCards, viewerSelfSheetCard } from "@/lib/trpg/partySheetPresentation";
import { statModifier } from "@/lib/trpg/stats";
import { replyStanceLabelKo, type TrpgInputOrigin, type TrpgReplySuggestion } from "@/lib/trpg/replySuggestionShared";
import {
  compactConditions,
  hpBarClass,
  hpPercent,
  inventoryCount,
  inventoryStackLabel,
  mergeDisplayConditions,
  selfHudAriaLabel,
} from "@/lib/trpg/sheetHud";
import {
  acceptTrpgSheetActionDraft,
  buildTrpgSheetSurface,
  pickTrpgSheetRenderer,
  type TrpgSheetRenderer,
  type TrpgSheetSurface,
} from "@/lib/trpg/sheetSurface";
import {
  trpgPartySheetComponentParticipantId,
  type TrpgPartySheetComponentLoader,
} from "@/lib/trpg/partySheetComponentClient";
import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";
import type { TrpgSheetSnapshot } from "@/lib/trpg/types";
import { TRPG_ACTION_MAX_CHARS } from "@/lib/trpg/types";
import TrpgUserChatPanel from "./TrpgUserChatPanel";

function HpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  return (
    <div
      className="h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={Math.max(maxHp, 1)}
      aria-valuenow={hp}
      aria-label={`HP ${hp}/${maxHp}`}
    >
      <div className={`h-full rounded-full ${hpBarClass(hp, maxHp)}`} style={{ width: `${hpPercent(hp, maxHp)}%` }} />
    </div>
  );
}

function NativeSheetBody({
  surface,
  onFillAction,
  onSelectStat,
}: {
  surface: TrpgSheetSurface;
  onFillAction: ((draft: TrpgActionDraftFill) => void) | null;
  onSelectStat: ((key: string) => void) | null;
}) {
  return (
    <div className="space-y-3 text-sm text-zinc-200" data-trpg-sheet-native={surface.participantId}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-violet-100">{surface.name}</p>
          <p className="text-xs text-zinc-500">Lv {surface.level}</p>
        </div>
        <p className="text-xs tabular-nums text-zinc-300">
          HP {surface.hp}/{surface.maxHp}
        </p>
      </div>
      <HpBar hp={surface.hp} maxHp={surface.maxHp} />
      {surface.place ? (
        <p className="text-xs text-zinc-400">
          <span className="text-zinc-500">위치 </span>
          {surface.place}
        </p>
      ) : null}
      <div>
        <p className="text-xs text-zinc-500">능력치</p>
        <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
          {surface.stats.map((stat) => {
            const label = (
              <>
                {stat.label} {stat.value}
                <span className="text-zinc-500"> ({stat.modifier >= 0 ? `+${stat.modifier}` : String(stat.modifier)})</span>
              </>
            );
            if (!onSelectStat) {
              return (
                <li key={stat.key} className="tabular-nums text-zinc-300" data-trpg-stat={stat.key}>
                  {label}
                </li>
              );
            }
            return (
              <li key={stat.key}>
                <button
                  type="button"
                  data-trpg-stat={stat.key}
                  onClick={() => onSelectStat(stat.key)}
                  className="inline-flex min-h-11 w-full items-center rounded-lg px-1 text-left text-sm tabular-nums text-zinc-300"
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {surface.modifiersNote ? (
        <p className="text-xs text-zinc-400">
          <span className="text-zinc-500">보정 </span>
          {surface.modifiersNote}
        </p>
      ) : null}
      {surface.mechanics.length > 0 ? (
        <div data-trpg-mechanics-lines>
          <p className="text-xs text-zinc-500">판정 결과</p>
          <ul className="mt-1 space-y-0.5 text-xs tabular-nums text-zinc-300">
            {surface.mechanics.map((line, index) => (
              <li key={`${index}:${line}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <p className="text-xs text-zinc-500">상태</p>
        {surface.conditions.length === 0 && surface.effects.length === 0 ? (
          <p className="mt-1 text-xs text-zinc-500">없음</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {surface.conditions.map((item) => (
              <li
                key={`n:${item}`}
                className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-1 text-[11px] font-medium text-amber-100"
              >
                {item}
              </li>
            ))}
            {surface.effects.map((effect) => {
              const draft = surface.interactive && onFillAction ? effect.draft : null;
              if (!draft) {
                return (
                  <li
                    key={`e:${effect.key}`}
                    title={effect.hint}
                    className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-1 text-[11px] font-medium text-amber-100"
                  >
                    {effect.badge}
                  </li>
                );
              }
              return (
                <li key={`e:${effect.key}`}>
                  <button
                    type="button"
                    title={effect.hint}
                    data-trpg-condition-draft={effect.label}
                    onClick={() => onFillAction?.(draft)}
                    className="inline-flex min-h-11 items-center rounded-full border border-sky-400/30 bg-sky-500/10 px-3 text-xs font-semibold text-sky-100"
                  >
                    {effect.badge}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div>
        <p className="text-xs text-zinc-500">소지품</p>
        {surface.inventory.length === 0 ? (
          <p className="mt-1 text-xs text-zinc-500">없음</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {surface.inventory.map((item) => {
              const draft = surface.interactive && onFillAction ? item.draft : null;
              return draft ? (
                <li key={item.key}>
                  <button
                    type="button"
                    data-trpg-inventory-item={item.name}
                    data-trpg-inventory-quantity={item.quantity}
                    onClick={() => onFillAction?.(draft)}
                    className="inline-flex min-h-11 max-w-full items-center rounded-full border border-white/10 bg-white/5 px-3 text-xs text-zinc-100"
                  >
                    <span className="truncate">{inventoryStackLabel(item)}</span>
                  </button>
                </li>
              ) : (
                <li
                  key={item.key}
                  data-trpg-inventory-quantity={item.quantity}
                  className="inline-flex min-h-11 max-w-full items-center rounded-full border border-white/10 bg-white/5 px-3 text-xs text-zinc-200"
                >
                  <span className="truncate">{inventoryStackLabel(item)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * One visible renderer per sheet, chosen by pickTrpgSheetRenderer. Only the
 * viewer's own sheet gets a draft handler; party sheets get none, whatever the
 * `interactive` prop says, so creator code there cannot reach host state.
 */
function SheetSurfaceView({
  surface,
  renderer,
  onJsxFailed,
  onFillAction,
  onSelectStat,
}: {
  surface: TrpgSheetSurface;
  renderer: TrpgSheetRenderer;
  onJsxFailed: (compiled: string) => void;
  onFillAction: ((draft: TrpgActionDraftFill) => void) | null;
  onSelectStat: ((key: string) => void) | null;
}) {
  const propsKey = JSON.stringify(surface);
  const props = useMemo(() => JSON.parse(propsKey) as Record<string, unknown>, [propsKey]);
  const compiled = renderer.kind === "jsx" ? renderer.compiled : null;
  const onTrpgActionDraft = useCallback(
    (request: JsxTrpgActionDraftRequest) => {
      const draft = acceptTrpgSheetActionDraft(request);
      if (draft) onFillAction?.(draft);
    },
    [onFillAction]
  );
  const onTrpgSelectedStat = useCallback(
    (request: JsxTrpgSelectedStatRequest) => {
      if (!onSelectStat) return;
      if (!surface.stats.some((stat) => stat.key === request.statKey)) return;
      onSelectStat(request.statKey);
    },
    [onSelectStat, surface.stats]
  );
  const onStatus = useCallback(
    (status: JsxSandboxStatus) => {
      if (status === "error" && compiled) onJsxFailed(compiled);
    },
    [compiled, onJsxFailed]
  );
  switch (renderer.kind) {
    case "jsx":
      return (
        <div data-trpg-sheet-renderer={renderer.source}>
          <JsxComponentSandbox
            compiled={renderer.compiled}
            props={props}
            title={onFillAction ? "내 시트" : "파티원 시트"}
            heightPx={JSX_SANDBOX_AUTO_HEIGHT_MIN_PX}
            autoHeight
            onStatus={onStatus}
            onTrpgActionDraft={onFillAction ? onTrpgActionDraft : null}
            onTrpgSelectedStat={onFillAction ? onTrpgSelectedStat : null}
          />
        </div>
      );
    case "native":
      return (
        <NativeSheetBody
          surface={surface}
          onFillAction={onFillAction}
          onSelectStat={onFillAction ? onSelectStat : null}
        />
      );
    default: {
      const _exhaustive: never = renderer;
      return _exhaustive;
    }
  }
}

function ActionMode({
  snap,
  selfSheet,
  actionType,
  actionBody,
  selectedStat,
  suggestions,
  suggestionsBusy,
  suggestionsError,
  suggestionsEnabled,
  showReplySuggestions,
  actionInputVisible,
  busy,
  onActionTypeChange,
  onActionBodyChange,
  onSelectedStatChange,
  onToggleSuggestions,
  onRetrySuggestions,
  onPickSuggestion,
  onSendAction,
}: {
  snap: TrpgCampaignSnapshot;
  selfSheet: TrpgSheetSnapshot | null;
  actionType: TrpgActionType;
  actionBody: string;
  selectedStat: string | null;
  suggestions: TrpgReplySuggestion[];
  suggestionsBusy: boolean;
  suggestionsError: string;
  suggestionsEnabled: boolean;
  showReplySuggestions: boolean;
  actionInputVisible: boolean;
  busy: boolean;
  onActionTypeChange: (value: TrpgActionType) => void;
  onActionBodyChange: (value: string) => void;
  onSelectedStatChange: (value: string | null) => void;
  onToggleSuggestions: () => void;
  onRetrySuggestions: () => void;
  onPickSuggestion: (suggestion: TrpgReplySuggestion) => void;
  onSendAction: () => void;
}) {
  const viewerId = snap.viewerParticipantId;
  const effectLabels = (snap.ongoingEffects ?? [])
    .filter((effect) => effect.participantId === viewerId)
    .map((effect) => effect.label);
  const treatable = (snap.ongoingEffects ?? []).some(
    (effect) => effect.participantId === viewerId && isTreatableOngoingKind(effect.kind)
  );
  const hp = selfSheet?.hp ?? 0;
  const maxHp = selfSheet?.maxHp ?? 0;
  const firstAid = selfSheet ? showContextualFirstAid({ hp, maxHp, treatableOngoing: treatable }) : false;
  const firstAidDraft = selfSheet
    ? contextualFirstAidDraft({ hp, maxHp, effectLabels })
    : null;
  const statusTreat = showContextualStatusTreat({ treatableOngoing: treatable });
  const statusTreatDraft = contextualStatusTreatDraft(effectLabels);
  const rest = snap.safeRest;
  const showRest = Boolean(rest?.available && hp < maxHp);
  const showHint = snap.showRecoveryHint === true;
  const explicitStat = snap.statDefs.some((def) => def.key === selectedStat) ? selectedStat : null;

  return (
    <div data-trpg-next-action>
      <p className="mb-3 text-sm text-zinc-400">
        세계 안에서 무엇을 할지 적으세요. 유저끼리 대화는 「유저 채팅」입니다.
      </p>
      {!isTrpgVisibleActionType(actionType) ? (
        <p className="mb-2 text-xs text-zinc-400">선택한 유형: {actionTypeLabelKo(actionType)}</p>
      ) : null}
      <div className="mb-3" data-trpg-stat-selector>
        <p className="mb-1.5 text-xs text-zinc-500">판정 능력치</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            data-trpg-stat-choice="auto"
            aria-pressed={explicitStat == null}
            onClick={() => onSelectedStatChange(null)}
            className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold ${
              explicitStat == null
                ? "bg-violet-600 text-white"
                : "border border-white/10 bg-white/5 text-zinc-300"
            }`}
          >
            자동
          </button>
          {snap.statDefs.map((def) => {
            const value = selfSheet?.stats[def.key];
            const mod = typeof value === "number" ? statModifier(value) : null;
            const selected = explicitStat === def.key;
            const caption =
              typeof value === "number" && mod != null
                ? `${def.label} ${value} (${mod >= 0 ? `+${mod}` : String(mod)})`
                : def.label;
            return (
              <button
                key={def.key}
                type="button"
                data-trpg-stat-choice={def.key}
                aria-pressed={selected}
                onClick={() => onSelectedStatChange(def.key)}
                className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold ${
                  selected ? "bg-violet-600 text-white" : "border border-white/10 bg-white/5 text-zinc-300"
                }`}
              >
                {caption}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TRPG_VISIBLE_ACTION_TYPES.map((kind) => (
          <button
            key={kind}
            type="button"
            data-trpg-action-chip={kind}
            onClick={() => onActionTypeChange(kind)}
            className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold ${
              actionType === kind
                ? "bg-violet-600 text-white"
                : "border border-white/10 bg-white/5 text-zinc-300"
            }`}
          >
            {actionTypeLabelKo(kind)}
          </button>
        ))}
      </div>
      {showHint ? <p className="mb-2 text-[10px] leading-4 text-zinc-500">{RECOVERY_DISCOVERY_HINT}</p> : null}
      {showHint && rest?.blockedReason === "cooldown" ? (
        <p className="mb-2 text-[10px] leading-4 text-zinc-500">{SAFE_REST_COOLDOWN_HINT}</p>
      ) : null}
      {firstAid || statusTreat || showRest ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {firstAid && firstAidDraft ? (
            <button
              type="button"
              data-contextual="first-aid"
              onClick={() => {
                onActionTypeChange(firstAidDraft.actionType);
                onActionBodyChange(firstAidDraft.body);
              }}
              className="inline-flex min-h-11 items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-100"
            >
              🩹 응급처치
            </button>
          ) : null}
          {statusTreat ? (
            <button
              type="button"
              data-contextual="status-treat"
              onClick={() => {
                onActionTypeChange(statusTreatDraft.actionType);
                onActionBodyChange(statusTreatDraft.body);
              }}
              className="inline-flex min-h-11 items-center rounded-full border border-sky-400/30 bg-sky-500/10 px-3 text-xs font-semibold text-sky-100"
            >
              💊 상태 치료
            </button>
          ) : null}
          {showRest && rest ? (
            <button
              type="button"
              data-contextual="safe-rest"
              onClick={() => {
                const draft = contextualSafeRestDraft();
                onActionTypeChange(draft.actionType);
                onActionBodyChange(draft.body);
              }}
              className="inline-flex min-h-11 items-center rounded-full border border-amber-400/30 bg-amber-500/10 px-3 text-xs font-semibold text-amber-100"
              title={treatable ? SAFE_REST_ONGOING_NOTICE : undefined}
            >
              {`🏕 안전한 휴식 · HP +${rest.healAmount}`}
            </button>
          ) : null}
        </div>
      ) : null}
      {showRest && treatable ? (
        <p className="mb-2 text-[10px] leading-4 text-zinc-500">{SAFE_REST_ONGOING_NOTICE}</p>
      ) : null}
      <textarea
        value={actionBody}
        onChange={(event) => onActionBodyChange(event.target.value)}
        maxLength={TRPG_ACTION_MAX_CHARS}
        rows={4}
        placeholder="무엇을 하는가"
        className="w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-base text-zinc-100 outline-none focus:border-violet-400/40"
      />
      {!actionInputVisible ? (
        <p className="mt-2 text-xs text-zinc-500">장면이 끝나면 행동을 제출할 수 있습니다.</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={suggestionsEnabled}
          aria-label="행동 예시"
          disabled={busy}
          onClick={onToggleSuggestions}
          className={`inline-flex min-h-11 items-center rounded-xl border px-3 text-sm font-semibold disabled:opacity-50 ${
            suggestionsEnabled
              ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
              : "border-white/10 bg-white/5 text-zinc-400"
          }`}
        >
          {suggestionsEnabled ? (suggestionsBusy ? "예시 만드는 중…" : "행동 예시 켜짐") : "행동 예시 꺼짐"}
        </button>
        <button
          type="button"
          disabled={busy || !actionInputVisible || !actionBody.trim()}
          onClick={onSendAction}
          className="inline-flex min-h-11 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          행동 제출
        </button>
      </div>
      {showReplySuggestions ? (
        <div>
          {suggestionsError ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-sm text-rose-200">{suggestionsError}</p>
              <button
                type="button"
                disabled={busy || suggestionsBusy}
                onClick={onRetrySuggestions}
                className="inline-flex min-h-11 items-center rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 text-xs font-semibold text-rose-100 disabled:opacity-50"
              >
                다시 시도
              </button>
            </div>
          ) : null}
          {suggestions.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {suggestions.map((item) => (
                <li key={`${item.stance}:${item.actionType}:${item.text}`}>
                  <button
                    type="button"
                    data-trpg-reply-stance={item.stance}
                    onClick={() => onPickSuggestion(item)}
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-violet-200">{replyStanceLabelKo(item.stance)}</span>
                      <span className="text-[10px] font-medium text-zinc-500">{actionTypeLabelKo(item.actionType)}</span>
                    </span>
                    {item.stage ? <p className="mt-1 text-sm text-zinc-300">{item.stage}</p> : null}
                    {item.speech ? (
                      <p className={`${item.stage ? "mt-0.5" : "mt-1"} text-sm text-zinc-100`}>「{item.speech}」</p>
                    ) : null}
                    {!item.stage && !item.speech ? <p className="mt-1 text-sm text-zinc-200">{item.text}</p> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function TrpgCommandDock({
  snap,
  actionType,
  actionBody,
  selectedStat,
  partyBody,
  suggestions,
  suggestionsBusy,
  suggestionsError,
  suggestionsEnabled,
  showReplySuggestions,
  actionInputVisible,
  presentationBusy,
  busy,
  onActionTypeChange,
  onActionBodyChange,
  onSelectedStatChange,
  onInputOriginChange,
  onPartyBodyChange,
  onToggleSuggestions,
  onRetrySuggestions,
  onPickSuggestion,
  onSendAction,
  onSendParty,
  onOcclusionChange,
  sheetJsxCompiled = null,
  loadPartySheetComponent = null,
}: {
  snap: TrpgCampaignSnapshot;
  actionType: TrpgActionType;
  actionBody: string;
  selectedStat: string | null;
  partyBody: string;
  suggestions: TrpgReplySuggestion[];
  suggestionsBusy: boolean;
  suggestionsError: string;
  suggestionsEnabled: boolean;
  showReplySuggestions: boolean;
  actionInputVisible: boolean;
  presentationBusy: boolean;
  busy: boolean;
  onActionTypeChange: (value: TrpgActionType) => void;
  onActionBodyChange: (value: string) => void;
  onSelectedStatChange: (value: string | null) => void;
  onInputOriginChange: (value: TrpgInputOrigin) => void;
  onPartyBodyChange: (value: string) => void;
  onToggleSuggestions: () => void;
  onRetrySuggestions: () => void;
  onPickSuggestion: (suggestion: TrpgReplySuggestion) => void;
  onSendAction: () => void;
  onSendParty: () => void;
  onOcclusionChange: (occlusion: TrpgCommandDockOcclusion) => void;
  /** Site-owned sheet compiled by the server through the shared JSX compiler; null → native. */
  sheetJsxCompiled?: string | null;
  /** Creator `trpg_sheet` lookup for AI party members; null → site sheet only. */
  loadPartySheetComponent?: TrpgPartySheetComponentLoader | null;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [view, setView] = useState(() =>
    initialTrpgCommandDockView({
      actionInput: actionInputVisible,
      presentationBusy,
    })
  );
  const lifecycleKeyRef = useRef<string | null>(null);
  const selfCard = viewerSelfSheetCard(snap.sheets, snap.viewerParticipantId);
  const selfSheet = selfCard?.sheet ?? null;
  const partyCards = partyDetailedSheetCards(snap.sheets, snap.viewerParticipantId);
  const [partyParticipantId, setPartyParticipantId] = useState<number | null>(null);
  const selectedPartyId = selectPartySheetParticipantId(partyCards, partyParticipantId);
  const selectedParty = partyCards.find((card) => card.participantId === selectedPartyId) ?? null;
  const [failedSheetJsx, setFailedSheetJsx] = useState<ReadonlySet<string>>(() => new Set());
  const onSheetJsxFailed = useCallback(
    (compiled: string) =>
      setFailedSheetJsx((current) => (current.has(compiled) ? current : new Set(current).add(compiled))),
    []
  );
  const [creatorSheets, setCreatorSheets] = useState<Readonly<Record<number, string | null>>>({});
  const creatorSheetParticipantId = loadPartySheetComponent
    ? trpgPartySheetComponentParticipantId(snap.participants, selectedPartyId)
    : null;
  const creatorSheetPending =
    creatorSheetParticipantId != null && !(creatorSheetParticipantId in creatorSheets);
  useEffect(() => {
    if (!loadPartySheetComponent || creatorSheetParticipantId == null) return;
    let cancelled = false;
    void loadPartySheetComponent(creatorSheetParticipantId).then((compiled) => {
      if (cancelled) return;
      setCreatorSheets((current) =>
        creatorSheetParticipantId in current ? current : { ...current, [creatorSheetParticipantId]: compiled }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [creatorSheetParticipantId, loadPartySheetComponent]);
  const selfRenderer = pickTrpgSheetRenderer([{ source: "site", compiled: sheetJsxCompiled }], failedSheetJsx);
  const partyRenderer = pickTrpgSheetRenderer(
    [
      {
        source: "creator",
        compiled: creatorSheetParticipantId != null ? creatorSheets[creatorSheetParticipantId] : null,
      },
      { source: "site", compiled: sheetJsxCompiled },
    ],
    failedSheetJsx
  );

  useEffect(() => {
    const key = trpgCommandDockLifecycleKey({ presentationBusy, actionInput: actionInputVisible });
    const changed = lifecycleKeyRef.current !== null && lifecycleKeyRef.current !== key;
    lifecycleKeyRef.current = key;
    if (!changed) return;
    setView((current) =>
      reconcileTrpgCommandDockLifecycle(current, {
        presentationBusy,
        actionInput: actionInputVisible,
        lifecycleChanged: true,
      })
    );
  }, [actionInputVisible, presentationBusy]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const apply = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardInset(Math.round(inset));
    };
    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
    };
  }, []);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const publish = () => {
      onOcclusionChange(trpgCommandDockOcclusion(el.offsetHeight, keyboardInset));
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, [keyboardInset, onOcclusionChange, view.expanded, view.mode]);

  useEffect(() => {
    if (!view.expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select")) return;
      setView((current) => ({ ...current, expanded: false, explicitHold: null }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.expanded]);

  function chooseMode(mode: TrpgCommandDockMode) {
    setView((current) => selectTrpgCommandDockMode(current, mode, presentationBusy));
  }

  function fillAction(draft: TrpgActionDraftFill) {
    onActionTypeChange(draft.actionType);
    onActionBodyChange(draft.body);
    onInputOriginChange("manual");
    setView((current) => openTrpgCommandDockMode(current, "action", presentationBusy));
  }

  function selectStat(key: string) {
    onSelectedStatChange(key);
    setView((current) => openTrpgCommandDockMode(current, "action", presentationBusy));
  }

  const selfSurface = selfCard
    ? buildTrpgSheetSurface(selfCard, {
        statDefs: snap.statDefs,
        ongoingEffects: snap.ongoingEffects,
        mechanicsLines: snap.mechanicsLines,
        interactive: true,
      })
    : null;
  const partySurface = selectedParty
    ? buildTrpgSheetSurface(selectedParty, {
        statDefs: snap.statDefs,
        ongoingEffects: snap.ongoingEffects,
        mechanicsLines: snap.mechanicsLines,
        interactive: false,
      })
    : null;
  const compactCondition = compactConditions(
    mergeDisplayConditions(
      selfSurface?.conditions ?? [],
      (selfSurface?.effects ?? []).map((effect) => effect.label)
    ),
    1
  )[0];
  const itemCount = selfSheet ? inventoryCount(selfSheet.inventory) : 0;
  const selfLines = selfSurface?.mechanics ?? [];
  const label = selfSheet ? selfHudAriaLabel(selfSheet) : "명령 독";

  return (
    <section
      ref={rootRef}
      aria-label={label}
      data-trpg-command-dock
      data-trpg-command-dock-mode={view.mode}
      data-trpg-command-dock-expanded={view.expanded ? "true" : "false"}
      className="sticky z-30 mt-3 border-t border-white/10 bg-[#101010]/95 px-3 pt-2 backdrop-blur-md"
      style={{
        bottom: keyboardInset,
        paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="max-w-[40vw] truncate text-sm font-semibold text-violet-200 sm:max-w-[12rem]">
          {selfSheet?.name || "내 캐릭터"}
        </p>
        {selfSheet ? (
          <div className="flex min-w-[9rem] flex-1 items-center gap-2 sm:max-w-xs sm:flex-none">
            <p className="shrink-0 text-xs tabular-nums text-zinc-300">
              HP {selfSheet.hp}/{selfSheet.maxHp}
            </p>
            <HpBar hp={selfSheet.hp} maxHp={selfSheet.maxHp} />
          </div>
        ) : null}
        {selfSheet?.location.trim() ? (
          <p className="max-w-[10rem] truncate text-xs text-zinc-400">{selfSheet.location.trim()}</p>
        ) : null}
        <p className="truncate text-xs text-amber-100">{compactCondition || "상태 없음"}</p>
        <p
          className="text-xs text-zinc-400"
          aria-label={`소지품 ${itemCount}개`}
          title={`현재 소지품 ${itemCount}개`}
          data-trpg-inventory-count={itemCount}
        >
          소지품 {itemCount}
        </p>
        {selfLines[0] ? (
          <p className="truncate text-xs tabular-nums text-zinc-400" data-trpg-mechanics-summary>
            {selfLines[0]}
            {selfLines[1] ? ` · ${selfLines[1]}` : ""}
          </p>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5" role="tablist" aria-label="플레이 명령">
        {(["action", "self", "party", "ooc"] as const).map((mode) => {
          const selected = view.expanded && view.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              role="tab"
              id={`${panelId}-${mode}`}
              aria-selected={selected}
              aria-controls={panelId}
              data-trpg-command-dock-tab={mode}
              onClick={() => chooseMode(mode)}
              className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-2 text-xs font-semibold ${
                selected
                  ? "border-violet-400/50 bg-violet-500/20 text-violet-50"
                  : "border-white/10 bg-white/[0.03] text-zinc-200"
              }`}
            >
              {commandDockModeLabel(mode)}
            </button>
          );
        })}
      </div>
      {view.expanded ? (
        <div
          id={panelId}
          role="tabpanel"
          aria-labelledby={`${panelId}-${view.mode}`}
          className="mt-3 max-h-[min(42dvh,24rem)] overflow-y-auto overscroll-contain border-t border-white/5 pt-3"
        >
          {(() => {
            switch (view.mode) {
              case "action":
                return (
                  <ActionMode
                    snap={snap}
                    selfSheet={selfSheet}
                    actionType={actionType}
                    actionBody={actionBody}
                    selectedStat={selectedStat}
                    suggestions={suggestions}
                    suggestionsBusy={suggestionsBusy}
                    suggestionsError={suggestionsError}
                    suggestionsEnabled={suggestionsEnabled}
                    showReplySuggestions={showReplySuggestions}
                    actionInputVisible={actionInputVisible}
                    busy={busy}
                    onActionTypeChange={onActionTypeChange}
                    onActionBodyChange={onActionBodyChange}
                    onSelectedStatChange={onSelectedStatChange}
                    onToggleSuggestions={onToggleSuggestions}
                    onRetrySuggestions={onRetrySuggestions}
                    onPickSuggestion={onPickSuggestion}
                    onSendAction={onSendAction}
                  />
                );
              case "self":
                return selfSurface ? (
                  <SheetSurfaceView
                    surface={selfSurface}
                    renderer={selfRenderer}
                    onJsxFailed={onSheetJsxFailed}
                    onFillAction={fillAction}
                    onSelectStat={selectStat}
                  />
                ) : (
                  <p className="text-sm text-zinc-500">내 시트가 없습니다.</p>
                );
              case "party":
                return partyCards.length === 0 ? (
                  <p className="text-sm text-zinc-400">다른 파티원이 없습니다.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="파티원">
                      {partyCards.map((card) => {
                        const participant = snap.participants.find((row) => row.id === card.participantId);
                        const selected = card.participantId === selectedPartyId;
                        return (
                          <button
                            key={card.participantId}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            data-trpg-party-tab={card.participantId}
                            onClick={() => setPartyParticipantId(card.participantId)}
                            className={`inline-flex min-h-11 max-w-[11rem] items-center rounded-full border px-3 text-xs font-semibold ${
                              selected
                                ? "border-violet-400/50 bg-violet-500/20 text-violet-50"
                                : "border-white/10 bg-white/5 text-zinc-200"
                            }`}
                          >
                            <span className="truncate">
                              {card.sheet.name}
                              {participant?.kind === "ai_character" ? " · AI" : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {partySurface ? (
                      <div data-trpg-party-sheet={partySurface.participantId}>
                        {creatorSheetPending ? (
                          <p className="text-xs text-zinc-500" data-trpg-party-sheet-loading>
                            시트를 불러오는 중…
                          </p>
                        ) : (
                          <SheetSurfaceView
                            key={`${partySurface.participantId}:${partyRenderer.kind === "jsx" ? partyRenderer.source : "native"}`}
                            surface={partySurface}
                            renderer={partyRenderer}
                            onJsxFailed={onSheetJsxFailed}
                            onFillAction={null}
                            onSelectStat={null}
                          />
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              case "ooc":
                return (
                  <div className="h-[min(38dvh,20rem)] min-h-48">
                    <TrpgUserChatPanel
                      snap={snap}
                      partyBody={partyBody}
                      onPartyBodyChange={onPartyBodyChange}
                      onSendParty={onSendParty}
                      busy={busy}
                    />
                  </div>
                );
              default: {
                const _exhaustive: never = view.mode;
                return _exhaustive;
              }
            }
          })()}
        </div>
      ) : null}
    </section>
  );
}
