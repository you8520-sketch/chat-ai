"use client";

import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import TrpgCampaignRoom from "../TrpgCampaignRoom";
import type { TrpgActionType } from "@/lib/trpg/actionTypes";
import {
  buildScrollFollowLabSnapshot,
  scrollFollowLabPresentationSeed,
  scrollFollowLabSeenLogKeys,
  type ScrollFollowLabScenario,
} from "@/lib/trpg/scrollFollowLabFixture";
import { saveTrpgStreamIntervalMs } from "@/lib/trpg/displayPrefs";

const noop = () => {};

function parseScenario(raw: string | null): ScrollFollowLabScenario {
  if (raw === "bot2" || raw === "round2-bot1") return raw;
  return "bot1";
}

export default function TrpgScrollFollowLabClient() {
  const searchParams = useSearchParams();
  const scenario = useMemo(
    () => parseScenario(searchParams.get("scenario")),
    [searchParams]
  );
  const snap = useMemo(() => buildScrollFollowLabSnapshot({ roundNumber: 2 }), []);

  useEffect(() => {
    saveTrpgStreamIntervalMs(40);
    document.documentElement.classList.add("scroll-follow-lab-active");
    return () => document.documentElement.classList.remove("scroll-follow-lab-active");
  }, []);

  const [actionType, setActionType] = useState<TrpgActionType>("investigate");
  const [actionBody, setActionBody] = useState("");
  const [partyBody, setPartyBody] = useState("");

  return (
    <div className="relative min-h-[120dvh] bg-[#07080c] text-zinc-100" data-trpg-scroll-follow-lab="true">
      <div className="pointer-events-none fixed left-3 top-20 z-[80] rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-xs text-zinc-300">
        <p className="font-semibold text-zinc-100">TRPG scroll-follow lab</p>
        <p data-trpg-scroll-follow-lab-scenario={scenario}>scenario={scenario}</p>
        <p>Deterministic bot prose · no provider calls</p>
      </div>
      <TrpgCampaignRoom
        key={scenario}
        snap={snap}
        starting={false}
        generating={false}
        busy={false}
        error=""
        actionType={actionType}
        actionBody={actionBody}
        partyBody={partyBody}
        suggestions={[]}
        suggestionsBusy={false}
        suggestionsError=""
        suggestionsEnabled={false}
        onActionTypeChange={setActionType}
        onActionBodyChange={setActionBody}
        onPartyBodyChange={setPartyBody}
        onToggleSuggestions={noop}
        onRetrySuggestions={noop}
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
        labFreezePresentationAdvance={scenario !== "bot2"}
      />
    </div>
  );
}
