import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import {
  ADULT_CONTENT_POLICY_CNC_PERMISSION,
  buildAdultContentPolicyBlock,
} from "@/lib/advancedProseNsfwGuidelines";
import {
  parseModelRouteState,
  resetCncConsentStickinessInRouteState,
  resolveEffectiveConsentMode,
  serializeModelRouteState,
} from "@/lib/adultSceneRouting";
import { resolveChatAdultHandoffEnabled } from "@/lib/chatAdultHandoff";
import { effectiveIsAdult } from "@/lib/adultVerification";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL as GEMINI } from "@/lib/chatModels";

const ALLOWED_WITH_CNC = ["standard", "cnc_opt_in"] as const;
const CNC_OPT_IN_INPUT =
  "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.";
const SAFEWORD_INPUT = "레드";
const CONTINUE_INPUT = "계속해.";

let buildContext: typeof BuildContextFn;

describe("adult mode visibility + CNC server gate", () => {
  it("A — unverified user: Adult Mode toggle not rendered", () => {
    const chatClient = readFileSync(
      new URL("../app/chat/[id]/ChatClient.tsx", import.meta.url),
      "utf8"
    );
    assert.match(chatClient, /\{isAdult \?\s*\(\s*<ChatRoomAdultModeToggle/);
    assert.doesNotMatch(
      chatClient,
      /<ChatRoomAdultModeToggle[\s\S]*?\/>\s*<\/label>/
    );
    assert.equal(
      (chatClient.match(/<ChatRoomAdultModeToggle/g) ?? []).length,
      1
    );
  });

  it("B — unverified forged adultMode=true → effective Adult Mode false", () => {
    assert.equal(effectiveIsAdult(0), false);
    assert.equal(
      resolveChatAdultHandoffEnabled({
        persisted: 1,
        requested: true,
        userAdultVerified: false,
      }),
      false
    );
  });

  it("C — unverified forged cnc_opt_in + explicit CNC + safeword → standard, no CNC wire", () => {
    const consent = resolveEffectiveConsentMode({
      requested: "cnc_opt_in",
      previous: "cnc_opt_in",
      currentInput: CNC_OPT_IN_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
      adultModeEnabled: false,
    });
    assert.equal(consent, "standard");
    const wire = buildAdultContentPolicyBlock(consent);
    assert.equal(wire.includes(ADULT_CONTENT_POLICY_CNC_PERMISSION), false);
  });

  it("D — verified adult: toggle component remains available when isAdult", () => {
    assert.equal(effectiveIsAdult(1), true);
    assert.equal(
      resolveChatAdultHandoffEnabled({
        persisted: 0,
        requested: true,
        userAdultVerified: true,
      }),
      true
    );
  });

  it("E — verified adult, Adult Mode OFF, explicit CNC + safeword → standard", () => {
    const consent = resolveEffectiveConsentMode({
      requested: "cnc_opt_in",
      previous: "standard",
      currentInput: CNC_OPT_IN_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
      adultModeEnabled: false,
    });
    assert.equal(consent, "standard");
  });

  it("F — verified adult, Adult Mode ON, no explicit CNC → standard", () => {
    const consent = resolveEffectiveConsentMode({
      requested: undefined,
      previous: "standard",
      currentInput: CONTINUE_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
      adultModeEnabled: true,
    });
    assert.equal(consent, "standard");
  });

  it("G — verified adult, Adult Mode ON, DB allows CNC, explicit CNC + safeword → cnc_opt_in", () => {
    const consent = resolveEffectiveConsentMode({
      requested: "cnc_opt_in",
      previous: "standard",
      currentInput: CNC_OPT_IN_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
      adultModeEnabled: true,
    });
    assert.equal(consent, "cnc_opt_in");
  });

  it("H — previous cnc_opt_in, Adult Mode OFF → standard (stickiness broken)", () => {
    const consent = resolveEffectiveConsentMode({
      requested: undefined,
      previous: "cnc_opt_in",
      currentInput: CONTINUE_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
      adultModeEnabled: false,
    });
    assert.equal(consent, "standard");
  });

  it("I — Adult Mode ON again without new explicit CNC opt-in → standard", () => {
    const resetJson = resetCncConsentStickinessInRouteState(
      serializeModelRouteState({
        activeRoute: "general",
        currentSceneMode: "explicit",
        adultRouteMinimumTurnsRemaining: 0,
        safeSceneStreak: 0,
        activeConsentMode: "cnc_opt_in",
        sexualContextActive: true,
      })
    );
    const previous = parseModelRouteState(resetJson).activeConsentMode;
    assert.equal(previous, "standard");

    const consent = resolveEffectiveConsentMode({
      requested: undefined,
      previous,
      currentInput: CONTINUE_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
      adultModeEnabled: true,
    });
    assert.equal(consent, "standard");
  });

  it("J — Adult Mode ON again with new explicit CNC + safeword → cnc_opt_in", () => {
    const consent = resolveEffectiveConsentMode({
      requested: undefined,
      previous: "standard",
      currentInput: CNC_OPT_IN_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
      adultModeEnabled: true,
    });
    assert.equal(consent, "cnc_opt_in");
  });

  it("K — safeword hard stop still resets to standard (#632 unchanged)", () => {
    const consent = resolveEffectiveConsentMode({
      requested: undefined,
      previous: "cnc_opt_in",
      currentInput: SAFEWORD_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
      adultModeEnabled: true,
    });
    assert.equal(consent, "standard");
  });
});

describe("adult mode CNC provider-wire assembly", () => {
  before(async () => {
    ({ buildContext } = await import("@/services/contextBuilder"));
  });

  function extractAdultPolicyWire(systemPrompt: string): string {
    const start = systemPrompt.indexOf("[ADULT CONTENT POLICY]");
    if (start < 0) return "";
    const end = systemPrompt.indexOf("[19+ INTIMACY]", start);
    return systemPrompt.slice(start, end >= 0 ? end : undefined).trim();
  }

  function wireForConsent(
    activeConsentMode: "standard" | "cnc_opt_in",
    currentInput: string
  ): string {
    const built = buildContext({
      charName: "Test",
      chunks: [],
      userNickname: "User",
      shortTermHistory: [{ role: "user", content: "안녕" }],
      currentUserMessage: currentInput,
      nsfw: true,
      activeConsentMode,
      provider: "openrouter",
      modelId: GEMINI,
    });
    return extractAdultPolicyWire(built.systemPrompt);
  }

  it("unverified effective path → CNC permission absent on wire", () => {
    const consent = resolveEffectiveConsentMode({
      requested: "cnc_opt_in",
      previous: "cnc_opt_in",
      currentInput: CNC_OPT_IN_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
      adultModeEnabled: false,
    });
    const wire = wireForConsent(consent, CNC_OPT_IN_INPUT);
    assert.equal(wire.includes(ADULT_CONTENT_POLICY_CNC_PERMISSION), false);
  });

  it("verified + Adult Mode OFF → CNC permission absent on wire", () => {
    const consent = resolveEffectiveConsentMode({
      requested: "cnc_opt_in",
      previous: "cnc_opt_in",
      currentInput: CNC_OPT_IN_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
      adultModeEnabled: false,
    });
    const wire = wireForConsent(consent, CNC_OPT_IN_INPUT);
    assert.equal(wire.includes(ADULT_CONTENT_POLICY_CNC_PERMISSION), false);
  });

  it("verified + Adult Mode ON + valid explicit CNC → CNC permission present on wire", () => {
    const consent = resolveEffectiveConsentMode({
      requested: "cnc_opt_in",
      previous: "standard",
      currentInput: CNC_OPT_IN_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
      adultModeEnabled: true,
    });
    assert.equal(consent, "cnc_opt_in");
    const wire = wireForConsent(consent, CNC_OPT_IN_INPUT);
    assert.equal(wire.includes(ADULT_CONTENT_POLICY_CNC_PERMISSION), true);
  });
});
