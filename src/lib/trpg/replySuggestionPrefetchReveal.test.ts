import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  adaptTrpgReplySuggestionChatBody,
  TRPG_REPLY_SUGGESTION_MAX_TOKENS,
  TRPG_REPLY_SUGGESTION_PRIMARY_PROVIDER,
  TRPG_REPLY_SUGGESTION_BACKUP_PROVIDER,
} from "./replySuggestions";
import { shouldAutoRequestTrpgActionSuggestions } from "./displayPrefs";
import { shouldShowTrpgReplySuggestions } from "./followLatest";
import { CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } from "@/lib/chatModels";
import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";

describe("TRPG reply suggestion prefetch vs reveal", () => {
  it("A. Luna primary uses reasoning-off semantics without DeepSeek thinking.disabled", () => {
    const lunaBody = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      messages: [{ role: "user", content: "scene" }],
      stream: false,
      temperature: 0.7,
      max_tokens: TRPG_REPLY_SUGGESTION_MAX_TOKENS,
      response_format: { type: "json_object" },
    });
    assert.deepEqual(lunaBody.reasoning, { effort: "none" });
    assert.equal(lunaBody.reasoning_effort, "none");
    assert.notDeepEqual(lunaBody.thinking, { type: "disabled" });
    assert.equal("thinking" in lunaBody, false);

    const deepSeekAdapter = adaptTrpgReplySuggestionChatBody({
      model: "deepseek-v4-flash-0731",
      messages: [{ role: "user", content: "scene" }],
      reasoning_effort: "high",
    });
    assert.deepEqual(deepSeekAdapter.thinking, { type: "disabled" });
    assert.equal(deepSeekAdapter.reasoning_effort, "none");
  });

  it("B. auto-request does not wait for GM reveal completion", () => {
    assert.equal(
      shouldAutoRequestTrpgActionSuggestions({
        enabled: true,
        phase: "ACTION_INPUT",
        hasDraft: true,
        locked: false,
        requestedRound: null,
        roundNumber: 3,
      }),
      true
    );
    const client = fs.readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.doesNotMatch(client, /gmRevealComplete/);
    assert.doesNotMatch(client, /shouldShowTrpgReplySuggestions/);
    assert.match(client, /shouldAutoRequestTrpgActionSuggestions/);
  });

  it("C. display gate hides suggestions until reveal completes, independent of stream interval", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /shouldShowTrpgReplySuggestions/);
    assert.match(room, /gmRevealComplete/);
    assert.doesNotMatch(room, /shouldAutoRequestTrpgActionSuggestions/);

    for (const interval of [0, 35, 50, 65]) {
      assert.equal(
        shouldShowTrpgReplySuggestions({
          suggestionsEnabled: true,
          freshGmRound: 2,
          gmRevealComplete: false,
          hasSuggestions: true,
          hasSuggestionsError: false,
        }),
        false,
        `interval ${interval} must not affect display gate`
      );
      assert.equal(
        shouldAutoRequestTrpgActionSuggestions({
          enabled: true,
          phase: "ACTION_INPUT",
          hasDraft: true,
          locked: false,
          requestedRound: null,
          roundNumber: 2,
        }),
        true,
        `interval ${interval} must not affect auto-request`
      );
    }
  });

  it("D. ready before reveal — suggestions become visible once reveal completes", () => {
    assert.equal(
      shouldShowTrpgReplySuggestions({
        suggestionsEnabled: true,
        freshGmRound: 2,
        gmRevealComplete: false,
        hasSuggestions: true,
        hasSuggestionsError: false,
      }),
      false
    );
    assert.equal(
      shouldShowTrpgReplySuggestions({
        suggestionsEnabled: true,
        freshGmRound: 2,
        gmRevealComplete: true,
        hasSuggestions: true,
        hasSuggestionsError: false,
      }),
      true
    );
  });

  it("K. provider priority — CheaperInference Luna primary, OpenRouter DeepSeek backup", () => {
    assert.equal(TRPG_REPLY_SUGGESTION_PRIMARY_PROVIDER, "cheaperinference");
    assert.equal(TRPG_REPLY_SUGGESTION_BACKUP_PROVIDER, "openrouter");
    const source = fs.readFileSync("src/lib/trpg/replySuggestions.ts", "utf8");
    assert.match(source, /TRPG_REPLY_SUGGESTION_PRIMARY_PROVIDER = "cheaperinference"/);
    assert.match(source, /TRPG_REPLY_SUGGESTION_BACKUP_PROVIDER = "openrouter"/);
  });

  it("no duplicate auto-request effect was added", () => {
    const client = fs.readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    const autoRequestMatches = client.match(/shouldAutoRequestTrpgActionSuggestions/g) ?? [];
    assert.ok(autoRequestMatches.length >= 2);
    assert.ok(autoRequestMatches.length <= 4);
    assert.doesNotMatch(client, /prefetchSuggestions/);
  });
});
