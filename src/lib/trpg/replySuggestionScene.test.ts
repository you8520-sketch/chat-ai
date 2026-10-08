import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { clipTrpgChars } from "./clip";
import { ensureTrpgTables } from "./schema";
import {
  buildReplySuggestionPublicContext,
  executeTrpgReplySuggestionProviderRound,
  requestTrpgReplySuggestions,
  resetTrpgReplySuggestionCooldownForTests,
  TRPG_REPLY_SCENE_MAX_CHARS,
  TRPG_REPLY_SUGGESTION_MODEL,
} from "./replySuggestions";
import { REPLY_SUGGESTION_SCENE_FIXTURES, type ReplySuggestionSceneFixture } from "./replySuggestionSceneFixtures";

const SCENE_HEADER = "[CURRENT PUBLIC SCENE]\n";

const validJson = JSON.stringify({
  suggestions: [
    { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
    { stance: "neutral", actionType: "investigate", text: "경첩부터 살핀다." },
    { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
  ],
});

function fixtureContext(fixture: ReplySuggestionSceneFixture) {
  return buildReplySuggestionPublicContext({
    scene: fixture.narration,
    persona: fixture.persona,
    recentActions: fixture.recentActions,
    self: fixture.self,
    party: fixture.party,
  });
}

function sceneSection(user: string): string {
  const start = user.indexOf(SCENE_HEADER);
  assert.ok(start >= 0, "user prompt must carry the scene section");
  const from = start + SCENE_HEADER.length;
  const end = user.indexOf("\n\n[PLAYER PERSONA]", from);
  assert.ok(end > from, "scene section must be followed by the persona section");
  return user.slice(from, end);
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmText(narration: string): string {
  return buildTrpgGmStructuredWireText(narration, {
    players: [],
    location: "폐역",
    next_round_context: "정해야 한다",
    campaign_finished: false,
  });
}

async function campaignWithRounds(db: Database.Database, narrations: readonly string[]) {
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
    hostPersona: {
      personaId: 9,
      name: "렌",
      description: "차갑고 짧게 말한다.",
      gender: "other",
      speechExamples: "됐어. 내가 볼게.",
    },
  });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  let next = 0;
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 12,
    gmCall: async () => ({ text: gmText(narrations[Math.min(next++, narrations.length - 1)]!) }),
  };
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  for (let i = 1; i < narrations.length; i += 1) {
    submitTrpgAction(db, { campaignId, userId: 1, body: `라운드 ${i} 행동`, inputOrigin: "manual" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
  }
  return campaignId;
}

const LONG_FIXTURES = REPLY_SUGGESTION_SCENE_FIXTURES.filter((fixture) => flat(fixture.narration).length > TRPG_REPLY_SCENE_MAX_CHARS);

describe("TRPG reply suggestion scene selection (#1435)", () => {
  beforeEach(() => {
    resetTrpgReplySuggestionCooldownForTests();
  });

  it("covers production-length GM scenes (3,200+ and 5,000+ chars) plus a short scene", () => {
    const lengths = new Map(REPLY_SUGGESTION_SCENE_FIXTURES.map((fixture) => [fixture.id, flat(fixture.narration).length]));
    assert.ok((lengths.get("negotiation-demand") ?? 0) >= 3200);
    assert.ok((lengths.get("wounded-ally-and-enemy") ?? 0) >= 5000);
    assert.ok((lengths.get("new-clue") ?? 0) >= 3200);
    assert.ok((lengths.get("no-hostile") ?? 0) >= 3200);
    assert.ok((lengths.get("resolved-ambush-aftermath") ?? 0) >= 3200);
    assert.ok((lengths.get("short-scene") ?? 0) < TRPG_REPLY_SCENE_MAX_CHARS);
    assert.equal(REPLY_SUGGESTION_SCENE_FIXTURES.length >= 5, true);
  });

  for (const fixture of LONG_FIXTURES) {
    describe(fixture.id, () => {
      it("keeps the final GM aside and the closing pressure inside the scene budget", () => {
        const section = sceneSection(fixtureContext(fixture).user);
        assert.ok(Array.from(section).length <= TRPG_REPLY_SCENE_MAX_CHARS, `scene section is ${Array.from(section).length} chars`);
        assert.ok(section.includes(fixture.probes.aside), "last GM aside must reach the model");
        for (const probe of fixture.probes.closing) {
          assert.ok(section.includes(probe), `closing pressure "${probe}" must reach the model`);
        }
        assert.match(section, /GM: [^]*$/, "scene must end with the GM aside");
        assert.ok(section.endsWith(flat(fixture.narration).slice(-20)), "scene must end where the GM narration ends");
      });

      it("does not present the resolved opening event as the current scene", () => {
        const section = sceneSection(fixtureContext(fixture).user);
        for (const probe of fixture.probes.resolvedEarly) {
          assert.ok(!section.includes(probe), `resolved opening "${probe}" must not displace the latest situation`);
        }
      });

      it("starts the retained tail on a sentence boundary and marks the omission", () => {
        const section = sceneSection(fixtureContext(fixture).user);
        assert.ok(section.startsWith("…"), "omitted opening must be marked");
        const body = section.slice(1).trimStart();
        const source = flat(fixture.narration);
        const at = source.indexOf(body.slice(0, 40));
        assert.ok(at > 0, "retained scene must be a verbatim slice of the GM narration");
        assert.match(source.slice(Math.max(0, at - 2), at), /[.!?"”』」…]\s?$|\s$/, "tail must not begin mid-sentence");
      });
    });
  }

  it("snaps forward to a sentence when the raw cut was already on a word boundary", () => {
    const aside = "지금 역무원이 요구한 조건에 답할지 결정해야 한다.";
    const narrative =
      "불길을 끈 이야기는 오래전에 마무리됐다. " +
      "사람들은 여전히 걸음을 옮기며 오래된 선로에 관한 이야기를 나누고 있었다. ".repeat(60) +
      "철문 너머의 수상한 소리에 대한 확인을 미루고 있던 일행은 새로운 방법을 궁리했다. ".repeat(2) +
      "마침내 역무원이 나타나 중요한 결정을 요구했다. ";
    const normalized = clipTrpgChars(narrative, Number.POSITIVE_INFINITY);
    const bodyBudget = TRPG_REPLY_SCENE_MAX_CHARS - Array.from(`\nGM: ${aside}`).length - 1;
    const cut = Array.from(normalized).length - bodyBudget;
    assert.ok(cut > 0);
    assert.equal(Array.from(normalized)[cut - 1], " ", "counterexample: the cut is at a word boundary");
    const { user } = buildReplySuggestionPublicContext({
      scene: `${narrative}\n\nGM: ${aside}`,
      persona: null,
      recentActions: [],
      self: null,
      party: [],
    });
    const section = sceneSection(user);
    assert.ok(section.startsWith("…사람들은"), "must start at the next sentence, not mid-sentence");
    assert.ok(section.endsWith(`GM: ${aside}`));
    assert.ok(Array.from(section).length <= TRPG_REPLY_SCENE_MAX_CHARS);
  });

  it("keeps a short scene whole and unmarked", () => {
    const fixture = REPLY_SUGGESTION_SCENE_FIXTURES.find((item) => item.id === "short-scene")!;
    const section = sceneSection(fixtureContext(fixture).user);
    assert.equal(section, clipTrpgChars(fixture.narration, TRPG_REPLY_SCENE_MAX_CHARS));
    for (const probe of [...fixture.probes.resolvedEarly, ...fixture.probes.closing, fixture.probes.aside]) {
      assert.ok(section.includes(probe));
    }
  });

  it("keeps the newest paragraphs when a long scene has no GM aside", () => {
    const fixture = REPLY_SUGGESTION_SCENE_FIXTURES.find((item) => item.id === "negotiation-demand")!;
    const withoutAside = fixture.narration.slice(0, fixture.narration.lastIndexOf("\n\nGM:"));
    const section = sceneSection(
      buildReplySuggestionPublicContext({ scene: withoutAside, persona: null, recentActions: [], self: null, party: [] }).user
    );
    assert.ok(Array.from(section).length <= TRPG_REPLY_SCENE_MAX_CHARS);
    assert.ok(section.includes("삼 분이야"));
    assert.ok(!section.includes(fixture.probes.resolvedEarly[0]!));
  });

  it("bounds an oversized GM aside without dropping the scene's closing lines", () => {
    const fixture = REPLY_SUGGESTION_SCENE_FIXTURES.find((item) => item.id === "negotiation-demand")!;
    const hugeAside = `${fixture.probes.aside} ${"그리고 다음 선택이 남았다. ".repeat(200)}`;
    const body = fixture.narration.slice(0, fixture.narration.lastIndexOf("\n\nGM:"));
    const section = sceneSection(
      buildReplySuggestionPublicContext({
        scene: `${body}\n\nGM: ${hugeAside}`,
        persona: null,
        recentActions: [],
        self: null,
        party: [],
      }).user
    );
    assert.ok(Array.from(section).length <= TRPG_REPLY_SCENE_MAX_CHARS);
    assert.ok(section.includes(fixture.probes.aside));
    assert.ok(section.includes("삼 분이야"), "scene body closing line must survive an oversized aside");
  });

  it("falls back to the first-turn line only when there is no scene", () => {
    const { user } = buildReplySuggestionPublicContext({ scene: "  ", persona: null, recentActions: [], self: null, party: [] });
    assert.equal(sceneSection(user), "첫 행동 차례다.");
  });

  it("sends the same long-scene messages to the primary and the backup provider", async () => {
    const fixture = REPLY_SUGGESTION_SCENE_FIXTURES.find((item) => item.id === "wounded-ally-and-enemy")!;
    const prompt = fixtureContext(fixture);
    const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
    const previousOr = process.env.OPENROUTER_API_KEY;
    const previousFetch = globalThis.fetch;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
    process.env.OPENROUTER_API_KEY = "test-or";
    const sent: Array<{ url: string; messages: Array<{ role: string; content: string }> }> = [];
    globalThis.fetch = (async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      sent.push({ url: String(input), messages: body.messages });
      if (String(input).includes("cheaperinference")) return new Response("unavailable", { status: 503 });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: validJson }, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 6 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    try {
      await executeTrpgReplySuggestionProviderRound({ ...prompt, logicalRequestId: "scene-identity" });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousCi == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
      if (previousOr == null) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOr;
    }
    assert.equal(sent.length, 2);
    assert.ok(sent[0]!.url.includes("cheaperinference"));
    assert.ok(sent[1]!.url.includes("openrouter"));
    assert.deepEqual(sent[0]!.messages, sent[1]!.messages);
    assert.equal(sent[0]!.messages.at(-1)!.content, prompt.user);
    assert.ok(sent[0]!.messages.at(-1)!.content.includes(fixture.probes.aside));
  });

  it("does not let the system prompt's format sample compete with the live scene", () => {
    const { system } = fixtureContext(REPLY_SUGGESTION_SCENE_FIXTURES[0]!);
    assert.match(system, /format sample|format-only|형식 예시/i);
    assert.match(system, /CURRENT PUBLIC SCENE/);
  });

  it("sends the newest round's GM situation to the model, not an earlier long round", async () => {
    const db = memoryDb();
    const [negotiation, wounded] = [
      REPLY_SUGGESTION_SCENE_FIXTURES.find((item) => item.id === "negotiation-demand")!,
      REPLY_SUGGESTION_SCENE_FIXTURES.find((item) => item.id === "wounded-ally-and-enemy")!,
    ];
    const campaignId = await campaignWithRounds(db, ["폐역에 찬 바람이 돈다.", negotiation.narration, wounded.narration]);
    const captured: string[] = [];
    const result = await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async ({ user }) => {
        captured.push(user);
        return { text: validJson, model: TRPG_REPLY_SUGGESTION_MODEL };
      },
    });
    assert.equal(result.suggestions.length, 3);
    const section = sceneSection(captured[0] ?? "");
    assert.ok(section.includes(wounded.probes.aside));
    assert.ok(section.includes("도적 두목의 세 번째 손가락이 접히려"));
    assert.ok(!section.includes("오영감"), "an earlier round must not leak into the newest scene");
    assert.ok(!section.includes(wounded.probes.resolvedEarly[0]!));
    db.close();
  });

  it("uses the new round's scene after a cached earlier round (cache is per round)", async () => {
    const db = memoryDb();
    const negotiation = REPLY_SUGGESTION_SCENE_FIXTURES.find((item) => item.id === "negotiation-demand")!;
    const clue = REPLY_SUGGESTION_SCENE_FIXTURES.find((item) => item.id === "new-clue")!;
    const campaignId = await campaignWithRounds(db, ["폐역에 찬 바람이 돈다.", negotiation.narration]);
    const firstPrompts: string[] = [];
    await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async ({ user }) => {
        firstPrompts.push(user);
        return { text: validJson, model: TRPG_REPLY_SUGGESTION_MODEL };
      },
    });
    assert.ok(sceneSection(firstPrompts[0] ?? "").includes("삼 분이야"));

    const deps: TrpgEngineDeps = { skipBilling: true, rollD20: () => 12, gmCall: async () => ({ text: gmText(clue.narration) }) };
    submitTrpgAction(db, { campaignId, userId: 1, body: "코일을 쥔다", inputOrigin: "manual" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const secondPrompts: string[] = [];
    await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async ({ user }) => {
        secondPrompts.push(user);
        return { text: validJson, model: TRPG_REPLY_SUGGESTION_MODEL };
      },
    });
    assert.equal(secondPrompts.length, 1, "new round must request fresh suggestions");
    const section = sceneSection(secondPrompts[0] ?? "");
    assert.ok(section.includes("북쪽 급수탑, 자정 전에"));
    assert.ok(!section.includes("오영감"));
    db.close();
  });

  it("keeps private text out of the long-scene prompt (only public narration, persona, own actions)", async () => {
    const db = memoryDb();
    const wounded = REPLY_SUGGESTION_SCENE_FIXTURES.find((item) => item.id === "wounded-ally-and-enemy")!;
    const campaignId = await campaignWithRounds(db, ["폐역에 찬 바람이 돈다.", wounded.narration]);
    db.prepare(`UPDATE trpg_campaigns SET gm_secret=? WHERE id=?`).run("SECRET_GM_CANARY", campaignId);
    const captured: string[] = [];
    await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async ({ system, user }) => {
        captured.push(`${system}\n${user}`);
        return { text: validJson, model: TRPG_REPLY_SUGGESTION_MODEL };
      },
    });
    assert.doesNotMatch(captured[0] ?? "", /SECRET_GM_CANARY/);
    db.close();
  });
});
