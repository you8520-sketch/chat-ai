"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import TrpgCampaignRoom from "../TrpgCampaignRoom";
import type { TrpgActionType } from "@/lib/trpg/actionTypes";
import { TRPG_REPLY_SUGGESTION_USER_ERROR, type TrpgReplySuggestion } from "@/lib/trpg/replySuggestionShared";
import {
  ACTION_EXAMPLE_LAB_SUGGESTIONS,
  buildScrollFollowLabSnapshot,
  parseActionExamplesLabMode,
  parseScrollFollowLabScenario,
  scrollFollowLabPresentationSeed,
  scrollFollowLabSeenLogKeys,
} from "@/lib/trpg/scrollFollowLabFixture";
import { createTrpgPartySheetComponentLoader } from "@/lib/trpg/partySheetComponentClient";

const noop = () => {};
const ACTION_EXAMPLE_ASYNC_MS = 400;

export default function TrpgScrollFollowLabClient({
  sheetJsxCompiled,
  partySheetsCompiled,
}: {
  sheetJsxCompiled: string | null;
  partySheetsCompiled: Record<number, string>;
}) {
  const searchParams = useSearchParams();
  const scenario = useMemo(
    () => parseScrollFollowLabScenario(searchParams.get("scenario")),
    [searchParams]
  );
  const examplesMode = useMemo(
    () => parseActionExamplesLabMode(searchParams.get("examples")),
    [searchParams]
  );
  const autoOn = searchParams.get("autoon") === "1";
  const freezePresentationAdvance = scenario !== "handoff";
  const partySheets = scenario === "party-sheets";
  const actionExamples = scenario === "action-examples";
  const snap = useMemo(
    () => buildScrollFollowLabSnapshot({ roundNumber: 2, partySheets, actionInput: actionExamples }),
    [scenario, partySheets, actionExamples]
  );
  const loadPartySheetComponent = useMemo(
    () =>
      partySheets
        ? createTrpgPartySheetComponentLoader(async (participantId) => partySheetsCompiled[participantId] ?? null)
        : null,
    [partySheets, partySheetsCompiled]
  );

  useEffect(() => {
    document.documentElement.classList.add("scroll-follow-lab-active");
    return () => document.documentElement.classList.remove("scroll-follow-lab-active");
  }, []);

  const [actionType, setActionType] = useState<TrpgActionType>("investigate");
  const [actionBody, setActionBody] = useState("");
  const [selectedStat, setSelectedStat] = useState<string | null>(null);
  const [partyBody, setPartyBody] = useState("");
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(
    () => autoOn && actionExamples
  );
  const [suggestions, setSuggestions] = useState<TrpgReplySuggestion[]>(() =>
    autoOn && actionExamples && examplesMode === "cached" ? ACTION_EXAMPLE_LAB_SUGGESTIONS : []
  );
  const [suggestionsBusy, setSuggestionsBusy] = useState(
    () => autoOn && actionExamples && examplesMode === "async"
  );
  const [suggestionsError, setSuggestionsError] = useState(() =>
    autoOn && actionExamples && examplesMode === "error" ? TRPG_REPLY_SUGGESTION_USER_ERROR : ""
  );
  const exampleRequestRef = useRef(0);

  function applyActionExamples() {
    if (!actionExamples) return;
    if (examplesMode === "cached") {
      setSuggestions(ACTION_EXAMPLE_LAB_SUGGESTIONS);
      setSuggestionsBusy(false);
      setSuggestionsError("");
      return;
    }
    if (examplesMode === "error") {
      setSuggestions([]);
      setSuggestionsBusy(false);
      setSuggestionsError(TRPG_REPLY_SUGGESTION_USER_ERROR);
      return;
    }
    setSuggestions([]);
    setSuggestionsError("");
    setSuggestionsBusy(true);
    const requestId = ++exampleRequestRef.current;
    window.setTimeout(() => {
      if (requestId !== exampleRequestRef.current) return;
      setSuggestions(ACTION_EXAMPLE_LAB_SUGGESTIONS);
      setSuggestionsBusy(false);
    }, ACTION_EXAMPLE_ASYNC_MS);
  }

  useEffect(() => {
    if (!autoOn || !actionExamples || examplesMode !== "async") return;
    const timer = window.setTimeout(() => {
      setSuggestions(ACTION_EXAMPLE_LAB_SUGGESTIONS);
      setSuggestionsBusy(false);
    }, ACTION_EXAMPLE_ASYNC_MS);
    return () => window.clearTimeout(timer);
  }, [actionExamples, autoOn, examplesMode]);

  function toggleSuggestions() {
    if (!actionExamples) return;
    const nextOn = !suggestionsEnabled;
    setSuggestionsEnabled(nextOn);
    if (!nextOn) {
      exampleRequestRef.current += 1;
      setSuggestions([]);
      setSuggestionsBusy(false);
      setSuggestionsError("");
      return;
    }
    applyActionExamples();
  }

  function retrySuggestions() {
    if (!actionExamples) return;
    applyActionExamples();
  }

  return (
    <div className="relative min-h-[120dvh] bg-[#07080c] text-zinc-100" data-trpg-scroll-follow-lab="true">
      <div className="pointer-events-none fixed left-3 top-20 z-[80] rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-xs text-zinc-300">
        <p className="font-semibold text-zinc-100">TRPG scroll-follow lab</p>
        <p data-trpg-scroll-follow-lab-scenario={scenario}>scenario={scenario}</p>
        {actionExamples ? (
          <>
            <p data-trpg-action-examples-mode={examplesMode}>examples={examplesMode}</p>
            <p data-trpg-action-examples-enabled={suggestionsEnabled ? "true" : "false"}>
              enabled={suggestionsEnabled ? "on" : "off"}
            </p>
          </>
        ) : (
          <p>Deterministic bot prose · no provider calls</p>
        )}
      </div>
      <TrpgCampaignRoom
        key={scenario === "handoff" ? "handoff-lifetime" : scenario}
        snap={snap}
        sheetJsxCompiled={sheetJsxCompiled}
        loadPartySheetComponent={loadPartySheetComponent}
        starting={false}
        generating={false}
        busy={false}
        error=""
        actionType={actionType}
        actionBody={actionBody}
        selectedStat={selectedStat}
        onSelectedStatChange={setSelectedStat}
        partyBody={partyBody}
        suggestions={suggestions}
        suggestionsBusy={suggestionsBusy}
        suggestionsError={suggestionsError}
        suggestionsEnabled={suggestionsEnabled}
        onActionTypeChange={setActionType}
        onActionBodyChange={setActionBody}
        onInputOriginChange={noop}
        onPartyBodyChange={setPartyBody}
        onToggleSuggestions={actionExamples ? toggleSuggestions : noop}
        onRetrySuggestions={actionExamples ? retrySuggestions : noop}
        onPickSuggestion={noop}
        onSendAction={noop}
        onSendParty={noop}
        onRetryBots={noop}
        onRetryGm={noop}
        onReroll={noop}
        onTitleSaved={noop}
        labPresentationSeed={scrollFollowLabPresentationSeed(scenario)}
        labSeenLogKeysSeed={scrollFollowLabSeenLogKeys(2, scenario)}
        labStreamIntervalMs={40}
        labFreezePresentationAdvance={freezePresentationAdvance}
      />
      <div
        aria-hidden
        data-trpg-scroll-follow-lab-trailing-space="true"
        className="pointer-events-none h-[120vh] w-full shrink-0"
      />
    </div>
  );
}
