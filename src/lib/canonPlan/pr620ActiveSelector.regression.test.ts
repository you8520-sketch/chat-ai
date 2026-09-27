import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import { selectActiveCanonChunks } from "@/lib/canonPlan/activeSelector";
import { FIXTURES } from "../../../data/canon-core-audit/d2-fixtures";
import { ENOCH_FIXTURES } from "../../../data/canon-core-audit/d2-enoch-fixtures";

const CAPSULE = path.join(
  process.cwd(),
  "docs/audits/real-production-mid-chat-style-handoff-benchmark"
);

function readCapsule(rel: string): string {
  return fs.readFileSync(path.join(CAPSULE, rel), "utf8");
}

function loadPr620Plan() {
  const dump = readCapsule("requests/T1-prompt_dump.txt");
  const m = dump.match(/### \[character-core-identity\][^\n]*\n([\s\S]*?)(?=\n### \[|$)/);
  assert.ok(m?.[1], "character-core-identity section");
  const body = m[1].trim();
  const charOnly = body
    .split(/\n\[WORLD CANON/)[0]
    .replace(/^\[CHARACTER CANON —[^\n]+\n/, "");
  const compiled = compileCanonPlanV1({
    creatorRawDescription: charOnly,
    now: "2026-09-27T12:00:00.000Z",
  });
  assert.equal(compiled.ok, true, compiled.error);
  return compiled.plan!;
}

function forbiddenLeak(title: string, text: string): boolean {
  return /(?:조아연|조아인|서진화|예시\s*대|트라우마|수감|가족관계)/i.test(title) ||
    /(?:조아연|조아인|누나)/i.test(text.slice(0, 160));
}

describe("PR620 active selector — false-positive regression (0 provider calls)", () => {
  const plan = loadPr620Plan();
  const opening = readCapsule("raw/OPENING_ASSISTANT_VISIBLE.txt").trimEnd();
  const t1User = readCapsule("raw/T1-USER_RAW.txt").trimEnd();
  const t1Assistant = readCapsule("raw/T1-ASSISTANT_PERSISTED_VISIBLE.txt").trimEnd();
  const t2User = readCapsule("raw/T2-USER_RAW.txt").trimEnd();

  const snapshotA = {
    shortTermHistory: [
      { role: "user" as const, content: "[채팅 시작]" },
      { role: "assistant" as const, content: opening },
    ],
    currentUserMessage: t1User,
  };

  const snapshotB = {
    shortTermHistory: [
      { role: "user" as const, content: "[채팅 시작]" },
      { role: "assistant" as const, content: opening },
      { role: "user" as const, content: t1User },
      { role: "assistant" as const, content: t1Assistant },
    ],
    currentUserMessage: t2User,
  };

  function select(snap: typeof snapshotA) {
    const recentTurns = snap.shortTermHistory
      .slice(-4)
      .map((m) => ({ role: m.role, content: m.content }));
    return selectActiveCanonChunks({
      plan,
      userMessage: snap.currentUserMessage,
      recentContext: recentTurns.map((m) => m.content).join("\n"),
      recentTurns,
    });
  }

  it("Snapshot A — no unrelated NPC/family/trauma ACTIVE", () => {
    const sel = select(snapshotA);
    for (const c of sel.activeChunks) {
      assert.equal(forbiddenLeak(c.sectionTitle, c.text), false, c.sectionTitle);
    }
  });

  it("Snapshot B — no assistant-history / open-question dormant activation", () => {
    const sel = select(snapshotB);
    assert.notEqual(sel.recentContextGateReason, "OPEN_QUESTION");
    assert.equal(
      sel.reasons.some((r) => r.recentBridgeOnly && r.currentScore === 0),
      false,
      "generic open question must not activate dormant chunks from assistant history"
    );
    for (const c of sel.activeChunks) {
      assert.equal(forbiddenLeak(c.sectionTitle, c.text), false, c.sectionTitle + " " + c.text.slice(0, 40));
    }
  });
});

describe("PR620 active selector — positive recall (0 provider calls)", () => {
  const plan = loadPr620Plan();

  function selectMsg(msg: string) {
    return selectActiveCanonChunks({
      plan,
      userMessage: msg,
      recentContext: "",
      recentTurns: [],
    });
  }

  it("family/NPC question selects the matching profile via dynamic anchors", () => {
    const sel = selectMsg("누나한테 연락 왔어?");
    assert.ok(sel.activeChunks.some((c) => /조아연|누나/.test(c.sectionTitle + c.text)));
  });

  it("prison/backstory cue selects history chunks", () => {
    const sel = selectMsg("수감 때 입었던 전자 초커 기억해?");
    assert.ok(sel.selectedCount > 0);
    assert.ok(sel.activeChunks.some((c) => /수감|초커|폭주/.test(c.text + c.sectionTitle)));
  });

  it("rampage cue selects rampage-related chunks", () => {
    const sel = selectMsg("폭주 직전이면 어떻게 대응해?");
    assert.ok(sel.activeChunks.some((c) => c.text.includes("폭주") || c.sectionTitle.includes("폭주")));
  });

  it("named entity cue selects that profile", () => {
    const sel = selectMsg("조아인 에테르 능력이 뭐였지?");
    assert.ok(sel.activeChunks.some((c) => c.sectionTitle.includes("조아인")));
  });

  it("ability cue selects ability-related chunks", () => {
    const sel = selectMsg("음압 센티넬 능력 발동 조건 알려줘");
    assert.ok(sel.activeChunks.some((c) => /능력|음압|가이딩/.test(c.text)));
  });
});

describe("cross-world ACTIVE (existing fixtures, 0 provider calls)", () => {
  it("fantasy — named NPC/faction recall, quiet scene stays dormant", () => {
    const fx = FIXTURES.find((f) => f.id === "fantasy-quiet")!;
    const plan = compileCanonPlanV1({
      creatorRawDescription: fx.creatorRawDescription,
      now: "2026-09-27T12:00:00.000Z",
    }).plan!;
    const quiet = selectActiveCanonChunks({
      plan,
      userMessage: fx.currentUserMessage,
      recentContext: fx.history.map((m) => m.content).join("\n"),
      recentTurns: fx.history,
    });
    assert.equal(quiet.activeChunks.some((c) => /에일린|유골상회|창백 역변/.test(c.text)), false);

    const named = selectActiveCanonChunks({
      plan,
      userMessage: "은빛 손 단장 에일린 얘기 해줘.",
      recentContext: "",
      recentTurns: [],
    });
    assert.ok(named.activeChunks.some((c) => /에일린/.test(c.sectionTitle + c.text)));

    const backstory = selectActiveCanonChunks({
      plan,
      userMessage: "창백 역변 때 무슨 일이 있었어?",
      recentContext: "",
      recentTurns: [],
    });
    assert.ok(backstory.activeChunks.some((c) => /역변/.test(c.sectionTitle + c.text)));
  });

  it("enoch — ability/world recall vs quiet domestic", () => {
    const fx = ENOCH_FIXTURES[0];
    const plan = compileCanonPlanV1({
      creatorRawDescription: fx.creatorRawDescription,
      now: "2026-09-27T12:00:00.000Z",
    }).plan!;
    const quiet = selectActiveCanonChunks({
      plan,
      userMessage: "그냥 둘이서 아무것도 안 하고 있어도 될 것 같아.",
      recentContext: "오늘 하루 수고했어.",
      recentTurns: [
        { role: "user", content: "오늘 하루 수고했어." },
        { role: "assistant", content: "마더가 또 속삭였다. 브레인 포드 얘기를 하지 마." },
      ],
    });
    assert.equal(quiet.activeChunks.some((c) => /마더|브레인 포드/.test(c.text)), false);

    const world = selectActiveCanonChunks({
      plan,
      userMessage: "브레인 포드가 숙주를 어떻게 만들지?",
      recentContext: "",
      recentTurns: [],
    });
    assert.ok(world.activeChunks.some((c) => /브레인\s*포드/.test(c.sectionTitle + c.text)));
  });

  it("anaphora: assistant-only mention + thin question does not activate", () => {
    const fx = FIXTURES.find((f) => f.id === "fantasy-quiet")!;
    const plan = compileCanonPlanV1({
      creatorRawDescription: fx.creatorRawDescription,
      now: "2026-09-27T12:00:00.000Z",
    }).plan!;
    const sel = selectActiveCanonChunks({
      plan,
      userMessage: "그 사람 누구야?",
      recentContext: "단장 에일린은 봉인을 목숨과 맞바꿨다.",
      recentTurns: [
        { role: "assistant", content: "단장 에일린은 봉인을 목숨과 맞바꿨다." },
      ],
    });
    assert.equal(sel.activeChunks.some((c) => c.text.includes("에일린")), false);
  });

  it("anaphora: recent USER mention + thin follow-up may activate", () => {
    const fx = FIXTURES.find((f) => f.id === "fantasy-quiet")!;
    const plan = compileCanonPlanV1({
      creatorRawDescription: fx.creatorRawDescription,
      now: "2026-09-27T12:00:00.000Z",
    }).plan!;
    const sel = selectActiveCanonChunks({
      plan,
      userMessage: "그 사람 누구야?",
      recentContext: "에일린이 누군지 궁금해.",
      recentTurns: [{ role: "user", content: "에일린이 누군지 궁금해." }],
    });
    assert.ok(sel.activeChunks.some((c) => c.text.includes("에일린")));
    assert.equal(sel.recentContextGateReason, "RECENT_USER");
  });
});
