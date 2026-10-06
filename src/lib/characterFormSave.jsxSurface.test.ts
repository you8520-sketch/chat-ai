import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import type { parseCharacterFormBody as ParseCharacterFormBodyFn } from "@/lib/characterFormSave";

let parseCharacterFormBody: typeof ParseCharacterFormBodyFn;

const user = { id: 1, nickname: "creator", is_adult: 1 as const };

function body(jsx: unknown[]) {
  const speech = "x".repeat(500);
  const promptBlock = "y".repeat(600);
  return {
    content_kind: "character",
    name: "테스트",
    tagline: "한 줄 소개",
    description: "공개 소개",
    greeting: "안녕",
    system_prompt: promptBlock,
    world: promptBlock,
    speech_personality: speech,
    speech_traits: speech,
    speech_examples: speech,
    speech_forbidden: "",
    genres: ["로맨스"],
    gender: "male",
    nsfw: false,
    participant_min_age: 28,
    assets: [{ url: "/uploads/test.png", tag: "neutral", representativeRank: 1 }],
    jsx_components_json: JSON.stringify(jsx),
  };
}

const chat = { name: "QuestCard", source: "export default function QuestCard() { return <p>q</p>; }", props: [] };
const sheet = (name: string, source = `export default function ${name}(props) { return <button onClick={() => setTrpgActionDraft("free", "x")}>{props.name}</button>; }`) => ({
  name,
  surface: "trpg_sheet",
  source,
  props: [],
});

before(async () => {
  ({ parseCharacterFormBody } = await import("@/lib/characterFormSave"));
});

describe("character save owns JSX surface validation", () => {
  it("D. saves one chat component plus one trpg_sheet, persisting the surface", () => {
    const parsed = parseCharacterFormBody(body([chat, sheet("PartySheet")]), user);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const saved = JSON.parse(parsed.data.jsxComponentsJson) as Array<Record<string, unknown>>;
    assert.deepEqual(saved.map((row) => [row.name, row.surface]), [
      ["QuestCard", undefined],
      ["PartySheet", "trpg_sheet"],
    ]);
  });

  it("E. rejects a second trpg_sheet instead of silently picking one", () => {
    const parsed = parseCharacterFormBody(body([sheet("SheetA"), sheet("SheetB")]), user);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, /하나만/);
  });

  it("rejects surface/capability mismatches with a creator-facing error", () => {
    const chatDraft = parseCharacterFormBody(
      body([{ ...chat, source: `export default function QuestCard() { return <b onClick={() => setTrpgActionDraft("free", "x")}>x</b>; }` }]),
      user
    );
    assert.equal(chatDraft.ok, false);
    if (!chatDraft.ok) assert.match(chatDraft.error, /QuestCard: .*setTrpgActionDraft/);
    const sheetSend = parseCharacterFormBody(
      body([sheet("PartySheet", `export default function PartySheet() { return <b onClick={() => sendToChat("x")}>x</b>; }`)]),
      user
    );
    assert.equal(sheetSend.ok, false);
    if (!sheetSend.ok) assert.match(sheetSend.error, /PartySheet: .*sendToChat/);
  });
});
