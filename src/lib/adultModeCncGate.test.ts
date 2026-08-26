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
import { afterEach, before, describe, it } from "node:test";
import {
  ADULT_CONTENT_POLICY_CNC_PERMISSION,
  buildAdultContentPolicyBlock,
} from "@/lib/advancedProseNsfwGuidelines";
import {
  resolveEffectiveConsentMode,
  resolveWireConsentMode,
} from "@/lib/adultSceneRouting";
import { resolveChatAdultHandoffEnabled } from "@/lib/chatAdultHandoff";
import { effectiveIsAdult } from "@/lib/adultVerification";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL as GEMINI } from "@/lib/chatModels";

const ALLOWED_WITH_CNC = ["standard", "cnc_opt_in"] as const;
const CNC_OPT_IN_INPUT =
  "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.";
const SAFEWORD_INPUT = "레드";
const OOC_HARD_STOP_INPUT = "OOC: 여기서 RP 끝. 더 이상 장면 진행하지 마.";
const CONTINUE_INPUT = "계속해.";

const envSnapshot = { ...process.env };

let buildContext: typeof BuildContextFn;

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const prev = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    process.env = prev;
  }
}

function persistedConsent(input: {
  previous: "standard" | "cnc_opt_in";
  currentInput: string;
  adultModeAuthorized: boolean;
  requested?: unknown;
}) {
  return resolveEffectiveConsentMode({
    requested: input.requested,
    previous: input.previous,
    currentInput: input.currentInput,
    allowedConsentModes: [...ALLOWED_WITH_CNC],
    adultModeAuthorized: input.adultModeAuthorized,
  });
}

function wireConsent(persisted: "standard" | "cnc_opt_in", adultModeAuthorized: boolean) {
  return resolveWireConsentMode({ persistedConsentMode: persisted, adultModeAuthorized });
}

describe("adult mode eligibility + CNC suspension gate", () => {
  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("A — closed beta skip active: users.is_adult=0, effectiveIsAdult=true → toggle visible", () => {
    withEnv(
      {
        SKIP_ADULT_VERIFICATION: "1",
        PORTONE_CHARGE_ENABLED: undefined,
        NEXT_PUBLIC_PAYMENTS_ENABLED: undefined,
      },
      () => {
        assert.equal(effectiveIsAdult(0), true);
      }
    );

    const chatPage = readFileSync(
      new URL("../app/chat/[id]/page.tsx", import.meta.url),
      "utf8"
    );
    assert.match(chatPage, /isAdult=\{effectiveIsAdult\(user\.is_adult\)\}/);

    const chatClient = readFileSync(
      new URL("../app/chat/[id]/ChatClient.tsx", import.meta.url),
      "utf8"
    );
    assert.match(chatClient, /\{isAdult \?\s*\(\s*<ChatRoomAdultModeToggle/);
  });

  it("B — beta user: Adult Mode enable accepted by settings/server", () => {
    withEnv({ SKIP_ADULT_VERIFICATION: "1" }, () => {
      assert.equal(effectiveIsAdult(0), true);
      assert.equal(
        resolveChatAdultHandoffEnabled({
          persisted: 0,
          requested: true,
          userAdultVerified: effectiveIsAdult(0),
        }),
        true
      );
    });

    const settings = readFileSync(
      new URL("../app/api/chat/settings/route.ts", import.meta.url),
      "utf8"
    );
    assert.match(settings, /effectiveIsAdult\(user\.is_adult\)/);
    assert.doesNotMatch(settings, /resetCncConsentStickinessInRouteState/);
  });

  it("C — verification skip disabled: users.is_adult=0 → hidden, rejected, CNC impossible", () => {
    withEnv(
      {
        SKIP_ADULT_VERIFICATION: "0",
        PORTONE_CHARGE_ENABLED: undefined,
        NEXT_PUBLIC_PAYMENTS_ENABLED: undefined,
      },
      () => {
        assert.equal(effectiveIsAdult(0), false);
        assert.equal(
          resolveChatAdultHandoffEnabled({
            persisted: 1,
            requested: true,
            userAdultVerified: effectiveIsAdult(0),
          }),
          false
        );
      }
    );

    const persisted = persistedConsent({
      previous: "standard",
      currentInput: CNC_OPT_IN_INPUT,
      adultModeAuthorized: false,
      requested: "cnc_opt_in",
    });
    assert.equal(persisted, "standard");
    assert.equal(wireConsent(persisted, false), "standard");
  });

  it("D — CNC active, Adult Mode OFF → wire standard, persisted CNC preserved", () => {
    const persisted = persistedConsent({
      previous: "cnc_opt_in",
      currentInput: CONTINUE_INPUT,
      adultModeAuthorized: false,
    });
    assert.equal(persisted, "cnc_opt_in");
    assert.equal(wireConsent(persisted, false), "standard");

    const wire = buildAdultContentPolicyBlock(wireConsent(persisted, false));
    assert.equal(wire.includes(ADULT_CONTENT_POLICY_CNC_PERMISSION), false);
  });

  it("E — Adult Mode OFF for multiple turns → CNC permission absent every turn", () => {
    let previous: "standard" | "cnc_opt_in" = "cnc_opt_in";
    for (const turn of [CONTINUE_INPUT, "다음.", "계속 이어가."]) {
      const persisted = persistedConsent({
        previous,
        currentInput: turn,
        adultModeAuthorized: false,
      });
      assert.equal(persisted, "cnc_opt_in");
      assert.equal(wireConsent(persisted, false), "standard");
      previous = persisted;
    }
  });

  it("F — Adult Mode ON again with preserved prior CNC → cnc_opt_in resumes on wire", () => {
    const persisted = persistedConsent({
      previous: "cnc_opt_in",
      currentInput: CONTINUE_INPUT,
      adultModeAuthorized: true,
    });
    assert.equal(persisted, "cnc_opt_in");
    assert.equal(wireConsent(persisted, true), "cnc_opt_in");

    const wire = buildAdultContentPolicyBlock(wireConsent(persisted, true));
    assert.equal(wire.includes(ADULT_CONTENT_POLICY_CNC_PERMISSION), true);
  });

  it("G — CNC active, safeword RED → CNC consent cleared to standard", () => {
    const persisted = persistedConsent({
      previous: "cnc_opt_in",
      currentInput: SAFEWORD_INPUT,
      adultModeAuthorized: true,
    });
    assert.equal(persisted, "standard");
    assert.equal(wireConsent(persisted, true), "standard");
  });

  it("H — after safeword: Adult Mode OFF → ON must NOT restore CNC", () => {
    const afterSafeword = persistedConsent({
      previous: "cnc_opt_in",
      currentInput: SAFEWORD_INPUT,
      adultModeAuthorized: true,
    });
    assert.equal(afterSafeword, "standard");

    const offTurn = persistedConsent({
      previous: afterSafeword,
      currentInput: CONTINUE_INPUT,
      adultModeAuthorized: false,
    });
    assert.equal(offTurn, "standard");

    const onAgain = persistedConsent({
      previous: offTurn,
      currentInput: CONTINUE_INPUT,
      adultModeAuthorized: true,
    });
    assert.equal(onAgain, "standard");
    assert.equal(wireConsent(onAgain, true), "standard");
  });

  it("I — OOC hard stop permanently clears CNC like safeword", () => {
    const persisted = persistedConsent({
      previous: "cnc_opt_in",
      currentInput: OOC_HARD_STOP_INPUT,
      adultModeAuthorized: true,
    });
    assert.equal(persisted, "standard");

    const resumed = persistedConsent({
      previous: persisted,
      currentInput: CONTINUE_INPUT,
      adultModeAuthorized: true,
    });
    assert.equal(resumed, "standard");
    assert.equal(wireConsent(resumed, true), "standard");
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

  it("Adult Mode OFF suspends persisted cnc_opt_in on production wire", () => {
    const persisted = persistedConsent({
      previous: "cnc_opt_in",
      currentInput: CONTINUE_INPUT,
      adultModeAuthorized: false,
    });
    const wireMode = wireConsent(persisted, false);
    const wire = wireForConsent(wireMode, CONTINUE_INPUT);
    assert.equal(wire.includes(ADULT_CONTENT_POLICY_CNC_PERMISSION), false);
  });

  it("Adult Mode ON restores CNC permission on production wire", () => {
    const persisted = persistedConsent({
      previous: "cnc_opt_in",
      currentInput: CONTINUE_INPUT,
      adultModeAuthorized: true,
    });
    const wireMode = wireConsent(persisted, true);
    assert.equal(wireMode, "cnc_opt_in");
    const wire = wireForConsent(wireMode, CONTINUE_INPUT);
    assert.equal(wire.includes(ADULT_CONTENT_POLICY_CNC_PERMISSION), true);
  });
});
