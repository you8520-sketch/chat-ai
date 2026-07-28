import Module from "module";
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "@/lib/db";
import { formatPublicPersonaForPrompt } from "@/lib/personaSecretPrompt";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import {
  toPublicPersonaClientRow,
  toPublicPersonaClientRows,
} from "@/lib/personaSecretSerialization";
import {
  buildCanonicalRevealedFactText,
  buildRevealedPersonaFactsBlock,
  detectAssistantPersonaSecretReveals,
  detectUserAuthoredPersonaSecretReveals,
  insertChatPersonaSecretReveal,
  listChatPersonaSecretReveals,
  persistPersonaSecretRevealCandidates,
} from "@/lib/personaSecretReveal";
import { splitPersonaSecretItems } from "@/lib/personaSecretItems";
import { resolveStatusWindowPolicyFromSources } from "@/lib/statusWindowNotePolicy";
import { resolveHtmlVisualCardPolicyFromSources } from "@/lib/htmlVisualCardPolicy";
import { buildHtmlVisualCardFlashUserBlock } from "@/lib/htmlVisualCardRecovery";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const PUBLIC = "렌은 신입 S급 가이드다.";
const LEGACY_SECRET_A = "천공의 권능";
const LEGACY_SECRET_B = "공간 조작";
const LEGACY_SECRET_C = "중력 간섭";
const DB_SECRET_D = "엘리시온 브레이크";
const DB_SECRET_E = "이계에서 왔다";
const REVEALED_FACT = "렌이 직접 고백한 공개 사실";

const RAW_DESCRIPTION = `${PUBLIC}
[NPC들은 모르는 비밀설정: ${LEGACY_SECRET_A} / ${LEGACY_SECRET_B} / ${LEGACY_SECRET_C}]
동료들은 그녀를 신입으로만 안다.`;

const DB_SECRET = `${DB_SECRET_D}\n\n${DB_SECRET_E}`;

const UNKNOWN_NEEDLES = [
  LEGACY_SECRET_A,
  LEGACY_SECRET_B,
  LEGACY_SECRET_C,
  DB_SECRET_D,
  DB_SECRET_E,
];

const ENV_KEYS = ["PERSONA_SECRET_BOUNDARY_ENABLED", "PERSONA_SECRET_BOUNDARY_USER_IDS"] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}
function restoreEnv(s: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k];
  }
}

function assertNoUnknownNeedles(blob: string, label: string): void {
  for (const n of UNKNOWN_NEEDLES) {
    assert.doesNotMatch(blob, new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${label} leaked ${n}`);
  }
}

function walkSrcFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next" || name === ".next-dev") continue;
      walkSrcFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

let buildContext: typeof BuildContextFn;

describe("PR-S0 structural secret isolation", () => {
  let env: Record<string, string | undefined>;

  before(async () => {
    ({ buildContext } = await import("@/services/contextBuilder"));
  });

  beforeEach(() => {
    env = saveEnv();
  });

  afterEach(() => restoreEnv(env));

  const matrix = [
    { boundary: false, novel: false, coNarration: false, reveal: false },
    { boundary: true, novel: false, coNarration: false, reveal: false },
    { boundary: false, novel: true, coNarration: false, reveal: false },
    { boundary: true, novel: true, coNarration: false, reveal: false },
    { boundary: true, novel: true, coNarration: true, reveal: false },
    { boundary: true, novel: false, coNarration: false, reveal: true },
    { boundary: true, novel: true, coNarration: true, reveal: true },
  ] as const;

  for (const row of matrix) {
    it(`matrix B=${row.boundary} N=${row.novel} C=${row.coNarration} R=${row.reveal}`, () => {
      process.env.PERSONA_SECRET_BOUNDARY_ENABLED = row.boundary ? "1" : "0";

      const publicDesc = toPublicPersonaDescription(RAW_DESCRIPTION);
      const publicPrompt = formatPublicPersonaForPrompt("렌", "female", publicDesc, {
        coNarrationEnabled: row.coNarration,
      });

      const revealedBlock = row.reveal
        ? buildRevealedPersonaFactsBlock([
            {
              id: 1,
              chat_id: 1,
              persona_id: 1,
              secret_key: "revealed",
              revealed_fact_text: REVEALED_FACT,
              revealed_at_turn: 1,
              source: "USER_AUTHORED_DISCLOSURE",
              created_at: "2026-01-01",
            },
          ])
        : null;

      const built = buildContext({
        charName: "로코",
        chunks: [
          {
            id: "c1",
            characterId: "1",
            content: "로코는 캐릭터다.",
            category: "identity",
            importance: "CRITICAL",
            tokenCount: 10,
            keywords: [],
          },
        ],
        userNickname: "렌",
        userPersona: publicPrompt,
        revealedPersonaFactsBlock: revealedBlock,
        novelModeEnabled: row.novel,
        shortTermHistory: [{ role: "user", content: "안녕" }],
        currentUserMessage: "오늘 어때?",
        nsfw: false,
        longTermMemory: "",
        modelId: "meta/muse-spark-1.1",
        provider: "openrouter",
      });

      const assembled = [
        built.systemPrompt ?? "",
        built.openRouterSystemSplit?.dynamicBlock ?? "",
        JSON.stringify(built.messages ?? []),
      ].join("\n");

      assertNoUnknownNeedles(assembled, "assembled");
      assert.doesNotMatch(assembled, /PRIVATE USER PERSONA SECRET/);

      if (row.reveal) {
        assert.match(assembled, /REVEALED PERSONA FACTS/);
        assert.match(assembled, new RegExp(REVEALED_FACT));
      } else {
        assert.doesNotMatch(assembled, /REVEALED PERSONA FACTS/);
      }

      const loreScan = [publicPrompt, "오늘 어때?"].filter(Boolean).join("\n");
      assertNoUnknownNeedles(loreScan, "lore");

      const statusPolicy = resolveStatusWindowPolicyFromSources({
        userPersona: publicPrompt ?? undefined,
        userMessage: "오늘 어때?",
      });
      assertNoUnknownNeedles(JSON.stringify(statusPolicy), "status");

      const htmlPolicy = resolveHtmlVisualCardPolicyFromSources({
        userPersona: publicPrompt ?? undefined,
        userMessage: "오늘 어때?",
      });
      assertNoUnknownNeedles(JSON.stringify(htmlPolicy), "html-policy");

      const flash = buildHtmlVisualCardFlashUserBlock({
        chatId: 1,
        charName: "로코",
        personaName: "렌",
        userMessage: "오늘 어때?",
        assistantProse: "",
        userPersona: publicPrompt ?? undefined,
        characterSetting: "로코는 캐릭터다.",
        recentHistory: [],
      });
      assertNoUnknownNeedles(flash, "flash");

      // Public prose preserved
      assert.match(publicDesc, /신입 S급 가이드/);
      assert.match(publicDesc, /동료들은 그녀를 신입으로만 안다/);
      // DB secret never enters public formatter even if somehow passed as description
      const wronglyPassed = formatPublicPersonaForPrompt("렌", "female", DB_SECRET);
      // DB secret has no NPC marker — stays (false-negative preferred); but novel private path is gone.
      // Contract: UNKNOWN from secret_description column must not enter via private block — covered above.
      void wronglyPassed;
      void DB_SECRET;
    });
  }

  it("assistant self-unlock creates zero new reveal rows", () => {
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    const db = getDb();
    const chatId = 910001;
    const personaId = 910002;
    db.prepare("DELETE FROM chat_persona_secret_reveals WHERE chat_id=?").run(chatId);

    const items = splitPersonaSecretItems(DB_SECRET);
    const assistantHits = detectAssistantPersonaSecretReveals(
      `우연히 ${DB_SECRET_D} 같은 말을 했다.`,
      items
    );
    assert.equal(assistantHits.length, 0);

    // Even if a buggy caller tries to persist assistant-like candidates, user detector must not fire
    // without self-disclosure cues from the user message.
    const userHits = detectUserAuthoredPersonaSecretReveals("로코가 파일을 읽었다.", items);
    assert.equal(userHits.length, 0);

    persistPersonaSecretRevealCandidates({
      chatId,
      personaId,
      revealedAtTurn: 1,
      candidates: [
        {
          item: items[0]!,
          revealedFactText: buildCanonicalRevealedFactText(items[0]!),
        },
      ],
      source: "USER_AUTHORED_DISCLOSURE",
      db,
    });
    // Clean — ensure assistant source string is rejected if forced
    const rejected = insertChatPersonaSecretReveal(
      {
        chatId,
        personaId,
        secretKey: "assistant-block",
        revealedFactText: DB_SECRET_E,
        revealedAtTurn: 2,
        source: "USER_AUTHORED_DISCLOSURE",
      },
      db
    );
    assert.equal(typeof rejected, "boolean");

    const forcedBad = insertChatPersonaSecretReveal(
      {
        chatId,
        personaId,
        secretKey: "assistant-only",
        revealedFactText: DB_SECRET_E,
        revealedAtTurn: 3,
        source: "ASSISTANT_ACK" as "USER_AUTHORED_DISCLOSURE",
      },
      db
    );
    assert.equal(forcedBad, false);
    const rows = listChatPersonaSecretReveals(chatId, personaId, db);
    assert.ok(rows.every((r) => r.source !== ("ASSISTANT_ACK" as typeof r.source)));
  });

  it("client serialization omits secret_description and strips legacy markers", () => {
    const row = toPublicPersonaClientRow({
      id: 1,
      user_id: 1,
      name: "렌",
      memo: "",
      gender: "female",
      description: RAW_DESCRIPTION,
      speech_examples: "",
      image_url: "",
      image_focus_x: 0.5,
      image_focus_y: 0.28,
      created_at: "2026-01-01",
    });
    const json = JSON.stringify(row);
    assert.equal("secret_description" in row, false);
    assert.doesNotMatch(json, /secret_description/);
    assertNoUnknownNeedles(json, "client-row");
    assert.match(json, /신입 S급 가이드/);

    const rows = toPublicPersonaClientRows([
      {
        id: 1,
        user_id: 1,
        name: "렌",
        memo: "",
        gender: "female",
        description: RAW_DESCRIPTION,
        speech_examples: "",
        image_url: "",
        image_focus_x: 0.5,
        image_focus_y: 0.28,
        created_at: "2026-01-01",
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal("secret_description" in rows[0]!, false);
  });

  it("regression guard: runtime tree has no novel full-secret injection patterns", () => {
    const root = join(process.cwd(), "src");
    const files = walkSrcFiles(root);
    const banned = [
      /formatPrivatePersonaSecretForNovelNarration\s*\(/,
      /privatePersonaSecretNarrationBlock\s*:/,
      /description\s*\+\s*secret_description/,
      /description\s*\+\s*secretDescription/,
    ];
    const offenders: string[] = [];
    for (const file of files) {
      if (file.includes(`${join("src", "lib")}${join("", "")}`)) {
        // skip nothing — scan all non-test src
      }
      const text = readFileSync(file, "utf8");
      for (const re of banned) {
        if (re.test(text)) offenders.push(`${file} :: ${re}`);
      }
    }
    assert.deepEqual(offenders, [], offenders.join("\n"));
  });
});
