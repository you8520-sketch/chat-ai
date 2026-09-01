import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { extractStatusWidgetValuesForTurn } from "./extract";
import { buildStatusWidgetPromptBlock, collectWidgetJsonKeys } from "./prompt";
import {
  orderedWidgetsForRender,
  resolveEffectiveStatusWidgetMode,
  resolveStatusWidgetTurn,
  statusWidgetHasCreatorSource,
  statusWidgetHasUserSource,
  resolveStatusWidgetEngineStatusKeys,
} from "./resolve";
import { engineModeForDisplay, serializeStatusWidget } from "./serialize";
import { resolveStatusWidgetReservedChars } from "./contextBudget";
import { ROLLING_SUMMARY_INTERVAL, RAW_HISTORY_COMPLETE_EXCHANGES } from "@/lib/memory/memory-constants";
import { EPISODIC_EXTRACT_MAX_PER_SUMMARY_BATCH } from "@/lib/memory/memory-episodic-extract";

const creatorJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
const userJson = serializeStatusWidget({
  ...DEFAULT_STATUS_WIDGET,
  name: "내 커스텀",
  fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
});

const ENGINES = ["off", "character_only", "user_only", "both"] as const;
const DISPLAYS = ["creator", "user", "both", "hidden"] as const;

describe("status widget true 4-state owner", () => {
  it("table: fail-closed effective mode never auto-activates an unrequested source", () => {
    for (const requested of ENGINES) {
      for (const hasCreator of [true, false]) {
        for (const hasUser of [true, false]) {
          const effective = resolveEffectiveStatusWidgetMode({
            requestedMode: requested,
            hasCreatorWidget: hasCreator,
            hasAllowedUserWidget: hasUser,
          });
          if (requested === "off") assert.equal(effective, "off");
          if (requested === "character_only") {
            assert.equal(effective, hasCreator ? "character_only" : "off");
            assert.notEqual(effective, "user_only");
            assert.notEqual(effective, "both");
          }
          if (requested === "user_only") {
            assert.equal(effective, hasUser ? "user_only" : "off");
            assert.notEqual(effective, "character_only");
            assert.notEqual(effective, "both");
          }
        }
      }
    }
  });

  it("creator exists + off → inactive, no extract", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      chatMode: "off",
    });
    assert.equal(resolved.active, false);
    assert.equal(resolved.needsCharacterValues, false);
    assert.equal(resolved.needsUserValues, false);
    assert.equal(buildStatusWidgetPromptBlock(resolved), "");
    assert.equal(orderedWidgetsForRender(resolved, { character: { time: "1" } }).length, 0);
  });

  it("allowed user + user_only → creator extract off, user extract on", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "user_only",
    });
    assert.equal(resolved.needsCharacterValues, false);
    assert.equal(resolved.needsUserValues, true);
    assert.equal(resolved.mode, "user_only");
  });

  it("both + hidden → both extraction, render none", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    assert.equal(resolved.needsCharacterValues, true);
    assert.equal(resolved.needsUserValues, true);
    assert.equal(resolved.active, true);
    assert.deepEqual(orderedWidgetsForRender(resolved, { character: { time: "1" }, user: { my_note: "x" } }), []);
  });

  it("user_only + user unavailable → effective off, never creator fallback", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      chatMode: "user_only",
      characterAllowUserOverride: true,
    });
    assert.equal(resolved.mode, "off");
    assert.equal(resolved.needsCharacterValues, false);
    assert.equal(resolved.active, false);
  });

  it("character_only + creator unavailable → effective off", () => {
    const resolved = resolveStatusWidgetTurn({
      userWidgetJson: userJson,
      chatMode: "character_only",
    });
    assert.equal(resolved.mode, "off");
    assert.equal(resolved.needsUserValues, false);
  });

  it("allow_user_override=false does not force creator on", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "off",
      characterAllowUserOverride: false,
    });
    assert.equal(resolved.mode, "off");
    assert.equal(resolved.userWidget, null);
  });

  it("engine=user_only + display=both renders user only", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "user_only",
      displayMode: "both",
    });
    const items = orderedWidgetsForRender(resolved, { character: { time: "1" }, user: { my_note: "x" } });
    assert.deepEqual(items.map((i) => i.source), ["user"]);
  });

  it("engine=character_only + display=user renders none", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "character_only",
      displayMode: "user",
    });
    assert.equal(resolved.needsCharacterValues, true);
    assert.equal(orderedWidgetsForRender(resolved, { character: { time: "1" } }).length, 0);
  });

  it("display matrix never changes needs* flags", () => {
    for (const display of DISPLAYS) {
      const resolved = resolveStatusWidgetTurn({
        characterWidgetJson: creatorJson,
        userWidgetJson: userJson,
        chatMode: "both",
        displayMode: display,
      });
      assert.equal(resolved.needsCharacterValues, true);
      assert.equal(resolved.needsUserValues, true);
      assert.equal(resolved.mode, "both");
    }
  });

  it("engineModeForDisplay is compatibility-only and not used by resolve", () => {
    const compat = engineModeForDisplay("hidden", true, true);
    const runtime = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "off",
      displayMode: "hidden",
    });
    assert.equal(compat, "character_only");
    assert.equal(runtime.mode, "off");
    const settingsSrc = readFileSync(new URL("../../app/api/chat/settings/route.ts", import.meta.url), "utf8");
    assert.doesNotMatch(settingsSrc, /engineModeForDisplay\(/);
    const resolveSrc = readFileSync(new URL("./resolve.ts", import.meta.url), "utf8");
    assert.doesNotMatch(resolveSrc, /engineModeForDisplay\(/);
  });

  it("creator trigger status keys exclude user widget fields", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
    });
    const keys = resolveStatusWidgetEngineStatusKeys(resolved);
    assert.ok(keys.includes("시간"));
    assert.ok(!keys.includes("my_note"));
  });

  it("user_only → creator trigger keys empty", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "user_only",
    });
    assert.equal(resolveStatusWidgetEngineStatusKeys(resolved).length, 0);
  });

  it("chat route does not persist status extracted_facts (PR #666)", () => {
    const route = readFileSync(new URL("../../app/api/chat/route.ts", import.meta.url), "utf8");
    assert.doesNotMatch(route, /reconcileEpisodicMemoryFactsForGeneration/);
    assert.doesNotMatch(route, /persistEpisodicMemoryFactsBestEffort/);
    assert.doesNotMatch(route, /engineModeForDisplay\(/);
    assert.match(route, /needsCharacterValues: statusWidgetTurn\.needsCharacterValues/);
    assert.match(route, /statusWidgetTurn\.needsCharacterValues &&/);
    assert.match(route, /requested_status_mode/);
    assert.match(route, /effective_status_mode/);
    assert.match(route, /status_extract_call_count/);
    assert.match(route, /status_trigger_evaluated/);
    assert.equal(ROLLING_SUMMARY_INTERVAL, 5);
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
    assert.equal(EPISODIC_EXTRACT_MAX_PER_SUMMARY_BATCH, 1);
  });

  it("full availability × override × engine × display matrix", () => {
    for (const hasCreator of [true, false]) {
      for (const hasUserWidget of [true, false]) {
        for (const allowOverride of [true, false]) {
          for (const engine of ENGINES) {
            for (const display of DISPLAYS) {
              const resolved = resolveStatusWidgetTurn({
                characterWidgetJson: hasCreator ? creatorJson : null,
                userWidgetJson: hasUserWidget ? userJson : null,
                chatMode: engine,
                displayMode: display,
                characterAllowUserOverride: allowOverride,
              });
              const allowedUser = allowOverride && hasUserWidget;
              const expectedMode = resolveEffectiveStatusWidgetMode({
                requestedMode: engine,
                hasCreatorWidget: hasCreator,
                hasAllowedUserWidget: allowedUser,
              });
              assert.equal(resolved.requestedMode, engine);
              assert.equal(resolved.mode, expectedMode);
              assert.equal(
                resolved.needsCharacterValues,
                hasCreator && statusWidgetHasCreatorSource(expectedMode)
              );
              assert.equal(
                resolved.needsUserValues,
                allowedUser && statusWidgetHasUserSource(expectedMode)
              );
              if (engine === "user_only" && !allowedUser) {
                assert.equal(resolved.mode, "off");
                assert.equal(resolved.needsCharacterValues, false);
              }
              const rendered = orderedWidgetsForRender(resolved, {
                character: { time: "1" },
                user: { my_note: "x" },
              });
              if (display === "hidden" || expectedMode === "off") {
                assert.equal(rendered.length, 0);
              }
              for (const item of rendered) {
                if (item.source === "character") {
                  assert.equal(statusWidgetHasCreatorSource(expectedMode), true);
                  assert.ok(display === "creator" || display === "both");
                } else {
                  assert.equal(statusWidgetHasUserSource(expectedMode), true);
                  assert.ok(display === "user" || display === "both");
                }
              }
            }
          }
        }
      }
    }
  });

  it("off freezes extract/prompt/reserve; both uses one combined Luna call", async () => {
    const off = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "off",
      displayMode: "both",
    });
    assert.equal(resolveStatusWidgetReservedChars({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "off",
    }), 0);
    let offCalls = 0;
    const offExtract = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "카페에서 만났다.",
      resolved: off,
      caller: async () => {
        offCalls += 1;
        return { text: "{}" };
      },
    });
    assert.equal(offCalls, 0);
    assert.equal(offExtract.meta.actualCallCount, 0);
    assert.equal(buildStatusWidgetPromptBlock(off), "");

    const both = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    const characterValues: Record<string, string> = {};
    for (const key of collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET)) {
      characterValues[key] = `값-${key}`;
    }
    let bothCalls = 0;
    const kinds: string[] = [];
    const bothExtract = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "두 사람은 옥상 정원에서 이야기를 이었다.",
      resolved: both,
      caller: async (_s, _h, opts) => {
        bothCalls += 1;
        kinds.push(opts.requestKind);
        return {
          text: JSON.stringify({
            character_values: characterValues,
            user_values: { my_note: "짧은 메모" },
            extracted_facts: [],
          }),
          usage: {
            inputTokens: 40,
            outputTokens: 20,
            estimated: true,
            finishReason: "stop",
          },
        };
      },
    });
    assert.equal(bothCalls, 1);
    assert.equal(bothExtract.meta.actualCallCount, 1);
    assert.equal(bothExtract.meta.extractMode, "dual_combined");
    assert.deepEqual(kinds, ["background-status-widget-extract-combined"]);
  });
});
