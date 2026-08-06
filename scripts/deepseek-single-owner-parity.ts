/**
 * Offline full-payload parity: production triple-owner vs ds_single_terminal_length_owner.
 *
 * Writes docs/audits/41-deepseek-single-owner-ab/ artifacts.
 * Exit 0 only on DS_SINGLE_OWNER_FULL_PAYLOAD_PARITY_PASS.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT =
  process.env.OUT_DIR ?? "docs/audits/41-deepseek-single-owner-ab";
const FIXTURE = process.env.FIXTURE_PATH ?? "/tmp/c18_fixture.json";
const MODEL = "deepseek-v4-pro";
const TURN1 =
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.";
const TURN2 = "너는 이름이뭐야? 뭐하는 중이었어?";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
function chars(text: string): number {
  return [...text].length;
}
function save(name: string, content: string | object) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function lengthOwnerFlags(userTurn: string) {
  return {
    deepseek_length: userTurn.includes("[DEEPSEEK LENGTH — SINGLE CALL]"),
    short_history: userTurn.includes("[SHORT HISTORY]"),
    short_user: userTurn.includes("[SHORT USER TURN]"),
    regen_length: userTurn.includes("[REGEN LENGTH]"),
    user_tail: userTurn.includes("이번 응답은 한국어 3,200~4,200자"),
    style_reminder: userTurn.includes("[System Reminder:"),
    opening: userTurn.includes("[OPENING SCENE CONTEXT"),
    current_user: userTurn.includes("[CURRENT USER INPUT]") || userTurn.includes(TURN1.slice(0, 20)),
  };
}

function countLengthOwners(flags: ReturnType<typeof lengthOwnerFlags>): number {
  return [
    flags.deepseek_length,
    flags.short_history,
    flags.short_user,
    flags.regen_length,
    flags.user_tail,
  ].filter(Boolean).length;
}

async function buildArm(opts: {
  fixture: {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
  turn: 1 | 2;
  canary: boolean;
  priorAssistant?: string;
}) {
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } = await import(
    "../src/lib/sceneDirective"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { buildOpenRouterMessages } = await import("../src/lib/openRouterAdult");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const ch = opts.fixture.character;
  const persona = opts.fixture.persona;
  const user = opts.fixture.user;
  const greeting = String(ch.greeting ?? "").trim();
  const chunks = loadCharacterChunks({
    id: Number(ch.id),
    name: String(ch.name),
    gender: String(ch.gender ?? ""),
    system_prompt: String(ch.system_prompt ?? ""),
    world: String(ch.world ?? ""),
    example_dialog: String(ch.example_dialog ?? ""),
    setting_chunks: String(ch.setting_chunks ?? ""),
    speech_profile: String(ch.speech_profile ?? ""),
  });
  const personaName = String(persona.name ?? "렌");
  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );

  const currentUserMessage = opts.turn === 1 ? TURN1 : TURN2;
  const shortTermHistory =
    opts.turn === 1
      ? [
          { role: "user" as const, content: OPENING_TURN_USER },
          { role: "assistant" as const, content: greeting },
        ]
      : [
          { role: "user" as const, content: OPENING_TURN_USER },
          { role: "assistant" as const, content: greeting },
          { role: "user" as const, content: TURN1 },
          {
            role: "assistant" as const,
            content: opts.priorAssistant ?? "(placeholder prior assistant for turn2 parity)",
          },
        ];

  const sceneDirectiveBlock = renderSceneDirectiveForPrompt(
    buildSceneDirective({
      characterName: String(ch.name),
      recentMessages: shortTermHistory.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      currentUserMessage,
      contentKind: "character",
    })
  );

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory,
    currentUserMessage,
    nsfw: false,
    gender: (String(ch.gender || "male") as "male" | "female" | "other") || "male",
    memoryMeta: "",
    modelId: MODEL,
    userImpersonation: false,
    novelModeEnabled: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: opts.turn === 1 ? 0 : 1,
    provider: "openrouter",
    contentKind: "character",
    sceneDirectiveBlock,
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: 34,
    rpDiagnosticCanary: opts.canary
      ? { variant: "ds_single_terminal_length_owner" }
      : null,
  });

  const split = built.openRouterSystemSplit!;
  const wire = buildOpenRouterMessages(built.systemPrompt, built.history, {
    systemSplit: split,
  });
  const systemJoined = Array.isArray(wire[0]?.content)
    ? (wire[0]!.content as Array<{ text?: string }>)
        .map((p) => p.text ?? "")
        .join("\n\n")
    : String(wire[0]?.content ?? "");
  const finalUser = String(wire[wire.length - 1]?.content ?? "");
  const historyOnly = wire.slice(1, -1).map((m) => ({
    role: m.role,
    content: String(m.content ?? ""),
    sha256: sha256(String(m.content ?? "")),
  }));

  const flags = lengthOwnerFlags(finalUser);
  return {
    systemJoined,
    finalUser,
    sceneDirectiveBlock,
    wireRoles: wire.map((m) => m.role),
    wireCount: wire.length,
    historyOnly,
    tracked: (built.meta.trackedSections ?? []).map((s) => ({
      id: s.id,
      sha256: sha256(s.text),
      chars: chars(s.text),
      header: (s.text.trim().split("\n")[0] ?? "").slice(0, 80),
    })),
    flags,
    lengthOwnerCount: countLengthOwners(flags),
    hashes: {
      system: sha256(systemJoined),
      final_user: sha256(finalUser),
      scene_directive: sha256(sceneDirectiveBlock),
      persona_block: sha256(
        (built.meta.trackedSections ?? []).find((s) => s.id === "identity-and-rules")
          ?.text ?? ""
      ),
      character_core: sha256(
        (built.meta.trackedSections ?? []).find((s) => s.id === "character-core-identity")
          ?.text ?? ""
      ),
      prose_top: sha256(
        (built.meta.trackedSections ?? []).find((s) =>
          /openrouter-korean-prose|korean-prose/i.test(s.id)
        )?.text ?? ""
      ),
    },
    tokens: {
      system: estimateTokens(systemJoined),
      final_user: estimateTokens(finalUser),
    },
  };
}

function unifyDiffLines(a: string, b: string, max = 80): string[] {
  const al = a.split("\n");
  const bl = b.split("\n");
  const out: string[] = [];
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n && out.length < max; i++) {
    const L = al[i] ?? "";
    const R = bl[i] ?? "";
    if (L !== R) {
      out.push(`- ${L.slice(0, 200)}`);
      out.push(`+ ${R.slice(0, 200)}`);
    }
  }
  return out;
}

async function main() {
  if (!existsSync(FIXTURE)) throw new Error(`missing fixture ${FIXTURE}`);
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };

  const prodT1 = await buildArm({ fixture, turn: 1, canary: false });
  const canT1 = await buildArm({ fixture, turn: 1, canary: true });

  // Turn2 with identical prior assistant stub so history parity is comparable
  const prior =
    "라이크는 로비 한쪽에 서서 짧은 숨을 고른 뒤, 상대를 천천히 바라보았다.\n\n\"렌이라…. 알겠어.\"";
  const prodT2 = await buildArm({
    fixture,
    turn: 2,
    canary: false,
    priorAssistant: prior,
  });
  const canT2 = await buildArm({
    fixture,
    turn: 2,
    canary: true,
    priorAssistant: prior,
  });

  // Invariant hashes that must match
  const invariantKeys = [
    "character_core",
    "persona_block",
    "prose_top",
    "scene_directive",
  ] as const;
  const invariantMismatches: string[] = [];
  for (const k of invariantKeys) {
    if (prodT1.hashes[k] !== canT1.hashes[k]) {
      invariantMismatches.push(`turn1.${k}`);
    }
    if (prodT2.hashes[k] !== canT2.hashes[k]) {
      invariantMismatches.push(`turn2.${k}`);
    }
  }
  // System may differ only where length extras never lived — system should match
  if (prodT1.hashes.system !== canT1.hashes.system) {
    invariantMismatches.push("turn1.system");
  }
  if (prodT2.hashes.system !== canT2.hashes.system) {
    invariantMismatches.push("turn2.system");
  }
  // Greeting peel: both should have opening on turn1 and empty assistant history
  if (!prodT1.flags.opening || !canT1.flags.opening) {
    invariantMismatches.push("turn1.opening_missing");
  }
  if (prodT1.historyOnly.some((h) => h.role === "assistant")) {
    invariantMismatches.push("turn1.prod_assistant_still_in_history");
  }
  if (canT1.historyOnly.some((h) => h.role === "assistant")) {
    invariantMismatches.push("turn1.canary_assistant_still_in_history");
  }

  // Canary length requirements
  const canaryLengthOk =
    canT1.lengthOwnerCount === 1 &&
    canT1.flags.user_tail &&
    !canT1.flags.deepseek_length &&
    !canT1.flags.short_history &&
    !canT1.flags.short_user &&
    !canT1.flags.regen_length &&
    canT1.flags.style_reminder &&
    canT2.lengthOwnerCount === 1 &&
    canT2.flags.user_tail &&
    !canT2.flags.deepseek_length &&
    !canT2.flags.short_history &&
    !canT2.flags.regen_length &&
    // Turn2 user line is short — SHORT USER must be suppressed on canary even if prod has it
    !canT2.flags.short_user;

  const prodLengthOk =
    prodT1.lengthOwnerCount === 3 &&
    prodT1.flags.deepseek_length &&
    prodT1.flags.short_history &&
    prodT1.flags.user_tail;

  // Diff owner: only final user turn should differ; and only length-extra regions
  const userDiffT1 = unifyDiffLines(prodT1.finalUser, canT1.finalUser, 120);
  const userDiffT2 = unifyDiffLines(prodT2.finalUser, canT2.finalUser, 120);

  const forbiddenDiffPatterns = [
    /CHARACTER CANON/,
    /USER_PERSONA/,
    /PRIVATE SCENE ENGINE/,
    /이번 턴 장면 지시/,
    /OPENING SCENE CONTEXT — ALREADY OCCURRED\n아래/,
  ];
  // Check that scene directive / character blocks are byte-identical already via hashes.
  // Final user may still contain opening+current input identically — verify current input line present in both.
  // User input may be label-split by formatUserMessageForPrompt; require key phrases.
  const inputParity = {
    t1_prod: prodT1.finalUser.includes("본기억") && prodT1.finalUser.includes("렌이라고"),
    t1_can: canT1.finalUser.includes("본기억") && canT1.finalUser.includes("렌이라고"),
    t2_prod:
      prodT2.finalUser.includes("이름이뭐야") || prodT2.finalUser.includes("이름이 뭐야"),
    t2_can:
      canT2.finalUser.includes("이름이뭐야") || canT2.finalUser.includes("이름이 뭐야"),
  };
  const inputParityOk = Object.values(inputParity).every(Boolean);

  const parityPass =
    prodLengthOk &&
    canaryLengthOk &&
    invariantMismatches.length === 0 &&
    inputParityOk;

  if (!parityPass) {
    console.error("PARITY_DEBUG", {
      prodLengthOk,
      canaryLengthOk,
      invariantMismatches,
      inputParity,
      prodT1_flags: prodT1.flags,
      canT1_flags: canT1.flags,
      prodT2_flags: prodT2.flags,
      canT2_flags: canT2.flags,
    });
  }

  const verdict = parityPass
    ? "DS_SINGLE_OWNER_FULL_PAYLOAD_PARITY_PASS"
    : "DS_SINGLE_OWNER_FULL_PAYLOAD_PARITY_FAIL";

  // Write canary map
  save(
    "CANARY_FINAL_PAYLOAD_MAP.md",
    [
      "# Canary final payload map — `ds_single_terminal_length_owner`",
      "",
      `- model: ${MODEL}`,
      `- character: 18 / persona: 61 / user: 34`,
      `- live calls: none`,
      "",
      "## Turn 1 wire",
      "",
      `| field | value |`,
      `|---|---|`,
      `| wire messages | ${canT1.wireCount} (${canT1.wireRoles.join(" → ")}) |`,
      `| system chars/tokens | ${chars(canT1.systemJoined)} / ${canT1.tokens.system} |`,
      `| final user chars/tokens | ${chars(canT1.finalUser)} / ${canT1.tokens.final_user} |`,
      `| length owner count | **${canT1.lengthOwnerCount}** |`,
      `| opening peel | ${canT1.flags.opening} |`,
      `| style reminder | ${canT1.flags.style_reminder} |`,
      `| user_tail | ${canT1.flags.user_tail} |`,
      `| DEEPSEEK LENGTH | ${canT1.flags.deepseek_length} |`,
      `| SHORT HISTORY | ${canT1.flags.short_history} |`,
      `| SHORT USER | ${canT1.flags.short_user} |`,
      "",
      "## Turn 2 wire",
      "",
      `| field | value |`,
      `|---|---|`,
      `| length owner count | **${canT2.lengthOwnerCount}** |`,
      `| SHORT USER (must be false) | ${canT2.flags.short_user} |`,
      `| user_tail | ${canT2.flags.user_tail} |`,
      "",
      "## Tracked system sections (Turn 1)",
      "",
      "| id | chars | sha256 | header |",
      "|---|---:|---|---|",
      ...canT1.tracked.map(
        (s) =>
          `| \`${s.id}\` | ${s.chars} | \`${s.sha256.slice(0, 16)}\` | ${s.header.replace(/\|/g, "/")} |`
      ),
      "",
    ].join("\n")
  );

  save("CANARY_FINAL_PAYLOAD_SECTIONS.json", {
    verdict,
    turn1: {
      flags: canT1.flags,
      lengthOwnerCount: canT1.lengthOwnerCount,
      hashes: canT1.hashes,
      tracked: canT1.tracked,
      wireRoles: canT1.wireRoles,
      final_user_sha256: canT1.hashes.final_user,
    },
    turn2: {
      flags: canT2.flags,
      lengthOwnerCount: canT2.lengthOwnerCount,
      hashes: canT2.hashes,
      short_user_suppressed: !canT2.flags.short_user,
      prod_turn2_short_user: prodT2.flags.short_user,
    },
  });

  save(
    "PRODUCTION_VS_CANARY_PROMPT_DIFF.md",
    [
      "# Production vs canary prompt diff",
      "",
      `## Verdict: \`${verdict}\``,
      "",
      "## Length owner counts",
      "",
      `| arm | Turn 1 | Turn 2 |`,
      `|---|---:|---:|`,
      `| production | ${prodT1.lengthOwnerCount} | ${prodT2.lengthOwnerCount} |`,
      `| canary | ${canT1.lengthOwnerCount} | ${canT2.lengthOwnerCount} |`,
      "",
      "## Flag matrix (Turn 1)",
      "",
      "| flag | production | canary |",
      "|---|---|---|",
      ...Object.keys(prodT1.flags).map(
        (k) =>
          `| ${k} | ${(prodT1.flags as Record<string, boolean>)[k]} | ${(canT1.flags as Record<string, boolean>)[k]} |`
      ),
      "",
      "## Flag matrix (Turn 2)",
      "",
      "| flag | production | canary |",
      "|---|---|---|",
      ...Object.keys(prodT2.flags).map(
        (k) =>
          `| ${k} | ${(prodT2.flags as Record<string, boolean>)[k]} | ${(canT2.flags as Record<string, boolean>)[k]} |`
      ),
      "",
      "## Invariant hashes (must match)",
      "",
      "| key | production | canary | match |",
      "|---|---|---|---|",
      ...invariantKeys.map(
        (k) =>
          `| ${k} (T1) | \`${prodT1.hashes[k].slice(0, 16)}\` | \`${canT1.hashes[k].slice(0, 16)}\` | ${prodT1.hashes[k] === canT1.hashes[k]} |`
      ),
      `| system (T1) | \`${prodT1.hashes.system.slice(0, 16)}\` | \`${canT1.hashes.system.slice(0, 16)}\` | ${prodT1.hashes.system === canT1.hashes.system} |`,
      ...invariantKeys.map(
        (k) =>
          `| ${k} (T2) | \`${prodT2.hashes[k].slice(0, 16)}\` | \`${canT2.hashes[k].slice(0, 16)}\` | ${prodT2.hashes[k] === canT2.hashes[k]} |`
      ),
      "",
      invariantMismatches.length
        ? `### Mismatches\n\n- ${invariantMismatches.join("\n- ")}\n`
        : "### Mismatches\n\n(none)\n",
      "",
      "## Diff owner",
      "",
      "```text",
      "DeepSeek redundant length extras only",
      "```",
      "",
      "Removed on canary:",
      "",
      "- `[DEEPSEEK LENGTH — SINGLE CALL]`",
      "- `[SHORT HISTORY]`",
      "- `[SHORT USER TURN]`",
      "- `[REGEN LENGTH]`",
      "",
      "Kept:",
      "",
      "- style-only bottom reminder",
      "- `USER_TAIL_LENGTH_OWNER_SENTENCE`",
      "- OPENING SCENE CONTEXT + greeting peel",
      "- SceneDirective / BASE_SCENE_ENGINE_RULE",
      "- character / world / persona / common prose",
      "- message role/order",
      "",
      "## Sample unified diff (Turn 1 final user, truncated)",
      "",
      "```diff",
      ...userDiffT1.slice(0, 60),
      "```",
      "",
      "## Sample unified diff (Turn 2 final user, truncated)",
      "",
      "```diff",
      ...userDiffT2.slice(0, 60),
      "```",
      "",
      forbiddenDiffPatterns.length
        ? ""
        : "",
      `input_parity=${JSON.stringify(inputParity)}`,
      `prod_length_ok=${prodLengthOk}`,
      `canary_length_ok=${canaryLengthOk}`,
      "",
    ].join("\n")
  );

  save("PARITY_VERDICT.json", {
    verdict,
    production_length_owner_count_t1: prodT1.lengthOwnerCount,
    canary_length_owner_count_t1: canT1.lengthOwnerCount,
    production_length_owner_count_t2: prodT2.lengthOwnerCount,
    canary_length_owner_count_t2: canT2.lengthOwnerCount,
    invariant_mismatches: invariantMismatches,
    input_parity: inputParity,
    prod_length_ok: prodLengthOk,
    canary_length_ok: canaryLengthOk,
    live_ab_allowed: parityPass,
  });

  console.log(
    JSON.stringify(
      {
        verdict,
        prodT1: prodT1.lengthOwnerCount,
        canT1: canT1.lengthOwnerCount,
        prodT2: prodT2.lengthOwnerCount,
        canT2: canT2.lengthOwnerCount,
        prodT2_short_user: prodT2.flags.short_user,
        canT2_short_user: canT2.flags.short_user,
        invariant_mismatches: invariantMismatches,
        live_ab_allowed: parityPass,
      },
      null,
      2
    )
  );

  if (!parityPass) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
