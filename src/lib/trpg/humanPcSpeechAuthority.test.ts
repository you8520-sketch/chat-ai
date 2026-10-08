import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import {
  TRPG_GM_LABEL_HUMAN_ACTION,
  TRPG_GM_SYSTEM,
  buildTrpgGmUserBlock,
} from "./gmPrompt";
import { loadCampaign } from "./store";
import { ensureTrpgTables } from "./schema";

function section(system: string, header: string): string {
  const start = system.indexOf(header);
  assert.ok(start >= 0, `${header} must exist`);
  const next = system.indexOf("\n\n[", start + header.length);
  return system.slice(start, next < 0 ? undefined : next);
}

type SpeakerLine = { speaker: string; text: string };

function speakerLines(narration: string): SpeakerLine[] {
  const out: SpeakerLine[] = [];
  for (const line of narration.split("\n")) {
    const m = line.match(/^(\S+): "(.+)"$/);
    if (m) out.push({ speaker: m[1]!, text: m[2]! });
  }
  return out;
}

/** Test-only analysis of a recorded narration; not a runtime filter. */
function unsubmittedHumanSpeech(
  narration: string,
  humanBodies: Record<string, string>
): SpeakerLine[] {
  return speakerLines(narration).filter((line) => {
    const body = humanBodies[line.speaker];
    return body !== undefined && !body.includes(line.text);
  });
}

const BODY_HANGYEOL_B = `한결은 잔을 내려놓으며 말한다. "생선. 실종은 네가 주문한 적 없어." 갈대를 보며 덧붙인다. "따뜻한 걸로."`;
const BODY_MIR_B = `미르는 잔을 기울이며 말한다. "형, 안개가 술값을 대신 내주면 좋겠어. 갈대 아저씨, 오늘 메뉴는 실종인가요, 생선인가요?"`;
const BODY_HANGYEOL_C = `한결은 미르를 지나 경첩의 녹을 살피며 말한다. "울음이 약해진다. 경첩부터 본다."`;
const BODY_MIR_C = `미르는 빈 그물과 생선 껍질을 얼굴에 두르고 팔짝이며 말한다. "나는 부두의 공식 생선이다. 안쪽 아이를 보러 왔소."`;
const BODY_MIR_D = `미르는 형체 쪽을 보며 외친다. "야, 안개야. 줄 서. 형 예약석이다." 도망치지는 않고 그 자리에 선다.`;
const BODY_HANGYEOL_A = `한결은 등잔 심지를 손가락으로 누르며 낮게 말한다. "숨소리 좀 고르라고 해. 이 골목 월세가 아깝다." 다른 손은 주머니 안쪽을 쥐고 있다.`;

// Recorded #1461 outputs, reduced to speaker lines and the scope-expanding sentences.
const RECORDED = {
  B: {
    humans: { 한결: BODY_HANGYEOL_B, 미르: BODY_MIR_B },
    narration: [
      `한결: "생선. 실종은 네가 주문한 적 없어."`,
      `한결: "따뜻한 걸로."`,
      `미르: "형, 안개가 술값을 대신 내주면 좋겠어. 갈대 아저씨, 오늘 메뉴는 실종인가요, 생선인가요?"`,
      `갈대: "생선은 냄비에 있고, 실종은 골목에 널렸다."`,
      `미르: "말 한마디에 소금을 한 바가지씩 뿌려대네. 형, 이 동네 사람들은 인심 대신 독기를 씹어 삼키나 봐."`,
    ].join("\n"),
    unsubmitted: [
      `말 한마디에 소금을 한 바가지씩 뿌려대네. 형, 이 동네 사람들은 인심 대신 독기를 씹어 삼키나 봐.`,
    ],
    addedActions: ["뜨거운 국물을 숟가락으로 떠 입술을 축였다", "미르가 숟가락을 집어 들며"],
  },
  C: {
    humans: { 한결: BODY_HANGYEOL_C, 미르: BODY_MIR_C },
    narration: [
      `한결: "울음이 약해진다. 경첩부터 본다."`,
      `미르: "나는 부두의 공식 생선이다. 안쪽 아이를 보러 왔소."`,
    ].join("\n"),
    unsubmitted: [] as string[],
    addedActions: ["문짝 한쪽 귀퉁이가 안쪽으로 1인치쯤 덜컥 내려앉았다", "경첩 핀 하나는 이미 부러져"],
  },
  D: {
    humans: { 미르: BODY_MIR_D },
    narration: [
      `미르: "야, 안개야. 줄 서. 형 예약석이다."`,
      `미르: "말은 똑바로 하네. 칼 들이대던 솜씨치고는 발음이 꽤 정직한데. 형, 이 인간 그냥 털린 좀도둑 같은데 어쩔까? 놔두면 또 뒤통수 치려나?"`,
    ].join("\n"),
    unsubmitted: [
      `말은 똑바로 하네. 칼 들이대던 솜씨치고는 발음이 꽤 정직한데. 형, 이 인간 그냥 털린 좀도둑 같은데 어쩔까? 놔두면 또 뒤통수 치려나?`,
    ],
    addedActions: ["한결의 발끝이 먼저 그 칼등을 지그시 밟아 눌렀다", "칼은 이미 한결의 발밑에 제압당했고"],
  },
  A: {
    humans: { 한결: BODY_HANGYEOL_A },
    narration: `한결: "숨소리 좀 고르라고 해. 이 골목 월세가 아깝다."`,
    unsubmitted: [] as string[],
    addedActions: [] as string[],
  },
} as const;

describe("TRPG #1462 human PC speech and action authority", () => {
  describe("single speech-authority owner", () => {
    it("SPEECH FORMAT owns the speaker-line restriction, including the human PC rule", () => {
      const speech = section(TRPG_GM_SYSTEM, "[SPEECH FORMAT]");
      assert.match(speech, /Speaker lines are for NPCs, extras, world voices, and the GM closing aside/);
      assert.match(speech, /never write a new spoken line for a human PC/);
    });

    it("ROUND CRAFT no longer carries a second, detached speaker-line rule", () => {
      const craft = section(TRPG_GM_SYSTEM, "[ROUND CRAFT]");
      assert.doesNotMatch(craft, /Allowed speaker lines/);
      assert.equal((TRPG_GM_SYSTEM.match(/speaker lines/gi) ?? []).length, 1);
    });

    it("ROUND CRAFT scopes a CHECK/no_check verdict to the declared action only", () => {
      const craft = section(TRPG_GM_SYSTEM, "[ROUND CRAFT]");
      assert.match(craft, /covers only the action that player declared, never a follow-up step/);
      assert.match(craft, /sole authority for that human PC's voluntary action/);
    });

    it("regenerate prefix does not repeat a speech-format rule; persona header does not ask to perform lines", () => {
      const regen = buildTrpgGmUserBlock({
        worldBrief: "w",
        memoryBlock: "",
        opening: false,
        regenerate: true,
        playerPersonas: "[PLAYER PERSONA participantId=1 name=한결]\n[말투 예시]\n짧게 말한다",
        actions: [],
      });
      assert.doesNotMatch(regen, /이름: "대사"/);
      assert.match(regen, /\[REGENERATE — same locked actions and dice\./);
      assert.doesNotMatch(regen, /portray these human PCs/);
      assert.match(regen, /speech examples are not lines to perform/);
    });
  });

  describe("recorded #1461 outputs (analysis of fixtures, not model behavior)", () => {
    it("flags the unsubmitted human lines in B and D, and nothing in A/C controls", () => {
      for (const key of ["A", "B", "C", "D"] as const) {
        const rec = RECORDED[key];
        const found = unsubmittedHumanSpeech(rec.narration, rec.humans).map((l) => l.text);
        assert.deepEqual(found, [...rec.unsubmitted], `case ${key}`);
      }
    });

    it("recaps of submitted human lines are distinguished from invention", () => {
      const b = RECORDED.B;
      const all = speakerLines(b.narration).filter((l) => l.speaker in b.humans);
      assert.equal(all.length, 4);
      assert.equal(unsubmittedHumanSpeech(b.narration, b.humans).length, 1);
    });

    it("scope-expanding actions recorded for B/C/D are absent from the submitted canonical bodies", () => {
      for (const key of ["B", "C", "D"] as const) {
        const rec = RECORDED[key];
        const submitted = Object.values(rec.humans).join("\n");
        for (const phrase of rec.addedActions) {
          assert.ok(!submitted.includes(phrase), `${key}: ${phrase}`);
        }
      }
    });
  });

  describe("live assembly keeps authority inputs and runtime contract", () => {
    function memoryDb(): Database.Database {
      const db = new Database(":memory:");
      ensureTrpgTables(db);
      return db;
    }

    it("passes canonical human bodies verbatim, in resolution order, with one GM call per advance and regenerate", async () => {
      const prev = {
        referee: process.env.TRPG_MECHANICS_REFEREE_ENABLED,
        director: process.env.TRPG_SANDBOX_DIRECTOR_ENABLED,
      };
      process.env.TRPG_MECHANICS_REFEREE_ENABLED = "0";
      process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "0";
      try {
        const db = memoryDb();
        const gmCalls: Array<{ system: string; user: string }> = [];
        let rollIndex = 0;
        const deps: TrpgEngineDeps = {
          skipBilling: true,
          rollD20: () => [15, 16][rollIndex++] ?? 11,
          gmCall: async ({ system, user }) => {
            gmCalls.push({ system, user });
            return {
              text: buildTrpgGmStructuredWireText("장면이 이어진다.", {
                players: [],
                location: "문턱",
                next_round_context: "다음",
                campaign_finished: false,
              }),
            };
          },
        };
        const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "한결", viewerUserId: 1 });
        const camp = loadCampaign(db, campaignId)!;
        joinTrpgCampaign(db, { code: camp.invite_code!, userId: 2, nickname: "미르" });
        saveTrpgSheet(db, { campaignId, userId: 1, name: "한결", stats: EVEN_STATS });
        saveTrpgSheet(db, { campaignId, userId: 2, name: "미르", stats: EVEN_STATS });
        await startTrpgCampaign(db, { campaignId, userId: 1, deps });
        gmCalls.length = 0;
        submitTrpgAction(db, { campaignId, userId: 1, body: BODY_HANGYEOL_C });
        submitTrpgAction(db, { campaignId, userId: 2, body: BODY_MIR_C });

        await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
        assert.equal(gmCalls.length, 1);
        const [first] = gmCalls;
        assert.equal(first!.system, TRPG_GM_SYSTEM);
        for (const body of [BODY_HANGYEOL_C, BODY_MIR_C]) {
          const labelled = `${TRPG_GM_LABEL_HUMAN_ACTION}\n${body}`;
          assert.equal(first!.user.split(labelled).length - 1, 1);
        }
        assert.equal((first!.user.match(/\[CHECK /g) ?? []).length, 2);

        await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
        assert.equal(gmCalls.length, 2);
        const regen = gmCalls[1]!;
        assert.equal(regen.system, first!.system);
        assert.match(regen.user, /^\[REGENERATE — same locked actions and dice\./);
        assert.doesNotMatch(regen.user, /이름: "대사"/);
        const checks = (user: string) => user.match(/\[CHECK [^\]]*\]/g) ?? [];
        assert.deepEqual(checks(regen.user), checks(first!.user));
        assert.ok(rollIndex <= 2);
        db.close();
      } finally {
        if (prev.referee === undefined) delete process.env.TRPG_MECHANICS_REFEREE_ENABLED;
        else process.env.TRPG_MECHANICS_REFEREE_ENABLED = prev.referee;
        if (prev.director === undefined) delete process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
        else process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = prev.director;
      }
    });
  });
});
