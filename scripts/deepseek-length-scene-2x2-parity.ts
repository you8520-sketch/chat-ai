/**
 * Offline 2×2 payload parity (Audit 42):
 *   A production triple + Scene ON
 *   B single owner + Scene ON
 *   C triple + Scene OFF  (ds_triple_owner_scene_off)
 *   D single + Scene OFF  (ds_single_owner_scene_off)
 *
 * Required:
 *   A vs C: only progression-owner / SceneDirective block differs
 *   B vs D: only progression-owner / SceneDirective block differs
 * Exit 0 only on DS_LENGTH_X_SCENE_2X2_OFFLINE_PASS.
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
  process.env.OUT_DIR ?? "docs/audits/42-deepseek-length-scene-2x2";
const FIXTURE = process.env.FIXTURE_PATH ?? "/tmp/c18_fixture.json";
const MODEL = "deepseek-v4-pro";
const TURN1 =
  "난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.";
const TURN2 = "너는 이름이뭐야? 뭐하는 중이었어?";

type ArmKey = "A" | "B" | "C" | "D";

const ARM_CFG: Record<
  ArmKey,
  {
    label: string;
    canaryVariant: string | null;
    expectedLengthOwners: number;
    sceneOn: boolean;
  }
> = {
  A: {
    label: "TRIPLE_OWNER_SCENE_ON",
    canaryVariant: null,
    expectedLengthOwners: 3,
    sceneOn: true,
  },
  B: {
    label: "SINGLE_OWNER_SCENE_ON",
    canaryVariant: "ds_single_terminal_length_owner",
    expectedLengthOwners: 1,
    sceneOn: true,
  },
  C: {
    label: "TRIPLE_OWNER_SCENE_OFF",
    canaryVariant: "ds_triple_owner_scene_off",
    expectedLengthOwners: 3,
    sceneOn: false,
  },
  D: {
    label: "SINGLE_OWNER_SCENE_OFF",
    canaryVariant: "ds_single_owner_scene_off",
    expectedLengthOwners: 1,
    sceneOn: false,
  },
};

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
    scene_engine: userTurn.includes("[PRIVATE SCENE ENGINE RULE]"),
    scene_turn: userTurn.includes("[이번 턴 장면 지시"),
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
  arm: ArmKey;
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

  const cfg = ARM_CFG[opts.arm];
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
    rpDiagnosticCanary: cfg.canaryVariant
      ? { variant: cfg.canaryVariant as "ds_triple_owner_scene_off" }
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

  const tracked = (built.meta.trackedSections ?? []).map((s) => ({
    id: s.id,
    sha256: sha256(s.text),
    chars: chars(s.text),
    header: (s.text.trim().split("\n")[0] ?? "").slice(0, 80),
  }));
  const sceneSection = tracked.find((s) => s.id === "scene-directive");
  const flags = lengthOwnerFlags(finalUser);
  const sceneInSystem =
    systemJoined.includes("[PRIVATE SCENE ENGINE RULE]") ||
    systemJoined.includes("[이번 턴 장면 지시");

  return {
    arm: opts.arm,
    label: cfg.label,
    systemJoined,
    finalUser,
    sceneDirectiveBlock,
    wireRoles: wire.map((m) => m.role),
    wireCount: wire.length,
    historyOnly,
    tracked,
    sceneSectionPresent: Boolean(sceneSection),
    sceneInSystem,
    flags,
    lengthOwnerCount: countLengthOwners(flags),
    hashes: {
      system: sha256(systemJoined),
      final_user: sha256(finalUser),
      scene_directive_input: sha256(sceneDirectiveBlock),
      persona_block: sha256(
        (built.meta.trackedSections ?? []).find(
          (s) => s.id === "identity-and-rules"
        )?.text ?? ""
      ),
      character_core: sha256(
        (built.meta.trackedSections ?? []).find(
          (s) => s.id === "character-core-identity"
        )?.text ?? ""
      ),
      prose_top: sha256(
        (built.meta.trackedSections ?? []).find((s) =>
          /openrouter-korean-prose|korean-prose/i.test(s.id)
        )?.text ?? ""
      ),
      scene_section: sceneSection?.sha256 ?? null,
    },
    tokens: {
      system: estimateTokens(systemJoined),
      final_user: estimateTokens(finalUser),
    },
  };
}

/** Strip the private scene engine / turn directive block from a joined system string. */
function stripSceneOwnerBlock(system: string): string {
  // Section is typically joined with surrounding content via \n\n from openRouter split.
  const patterns = [
    /\n*\[PRIVATE SCENE ENGINE RULE\][\s\S]*?(?=\n\[|\n\n\[|$)/,
    /\n*\[이번 턴 장면 지시[^\]]*\][\s\S]*?(?=\n\[|\n\n\[|$)/,
  ];
  let out = system;
  for (const re of patterns) {
    out = out.replace(re, "");
  }
  // Collapse accidental triple newlines from removal
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function unifyDiffLines(a: string, b: string, max = 60): string[] {
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

function comparePair(opts: {
  left: Awaited<ReturnType<typeof buildArm>>;
  right: Awaited<ReturnType<typeof buildArm>>;
  pair: "A_vs_C" | "B_vs_D";
  turn: 1 | 2;
}): {
  ok: boolean;
  reasons: string[];
  nonSceneTrackedMismatches: string[];
  userMatch: boolean;
  systemWithoutSceneMatch: boolean;
} {
  const reasons: string[] = [];
  const { left, right } = opts;

  // Canonical length-owner counts are Turn-1 screening counts (A/C=3, B/D=1).
  // Turn 2 may add SHORT USER on the triple stack (→ 4); pairs must still match each other.
  if (opts.turn === 1) {
    if (left.lengthOwnerCount !== ARM_CFG[left.arm].expectedLengthOwners) {
      reasons.push(
        `${left.arm}_length_count_${left.lengthOwnerCount}_expected_${ARM_CFG[left.arm].expectedLengthOwners}`
      );
    }
    if (right.lengthOwnerCount !== ARM_CFG[right.arm].expectedLengthOwners) {
      reasons.push(
        `${right.arm}_length_count_${right.lengthOwnerCount}_expected_${ARM_CFG[right.arm].expectedLengthOwners}`
      );
    }
  } else if (left.lengthOwnerCount !== right.lengthOwnerCount) {
    reasons.push(
      `${opts.pair}_t2_length_count_mismatch_${left.lengthOwnerCount}_vs_${right.lengthOwnerCount}`
    );
  }
  // Single-owner arms must stay at 1 on every turn.
  if (ARM_CFG[left.arm].expectedLengthOwners === 1 && left.lengthOwnerCount !== 1) {
    reasons.push(`${left.arm}_single_owner_drift_${left.lengthOwnerCount}`);
  }
  if (ARM_CFG[right.arm].expectedLengthOwners === 1 && right.lengthOwnerCount !== 1) {
    reasons.push(`${right.arm}_single_owner_drift_${right.lengthOwnerCount}`);
  }
  if (left.sceneInSystem !== true || left.sceneSectionPresent !== true) {
    reasons.push(`${left.arm}_scene_expected_ON`);
  }
  if (right.sceneInSystem !== false || right.sceneSectionPresent !== false) {
    reasons.push(`${right.arm}_scene_expected_OFF`);
  }

  const userMatch = left.finalUser === right.finalUser;
  if (!userMatch) reasons.push(`${opts.pair}_final_user_mismatch`);

  // History roles/order must match
  if (left.wireRoles.join(",") !== right.wireRoles.join(",")) {
    reasons.push(`${opts.pair}_wire_roles_mismatch`);
  }
  if (left.historyOnly.length !== right.historyOnly.length) {
    reasons.push(`${opts.pair}_history_len_mismatch`);
  } else {
    for (let i = 0; i < left.historyOnly.length; i++) {
      if (left.historyOnly[i]!.sha256 !== right.historyOnly[i]!.sha256) {
        reasons.push(`${opts.pair}_history_${i}_content_mismatch`);
      }
    }
  }

  // All tracked sections except scene-directive must match
  const leftById = new Map(left.tracked.map((s) => [s.id, s]));
  const rightById = new Map(right.tracked.map((s) => [s.id, s]));
  const ids = new Set([...leftById.keys(), ...rightById.keys()]);
  const nonSceneTrackedMismatches: string[] = [];
  for (const id of ids) {
    if (id === "scene-directive") continue;
    const L = leftById.get(id);
    const R = rightById.get(id);
    if (!L || !R) {
      nonSceneTrackedMismatches.push(`missing:${id}:L=${!!L}:R=${!!R}`);
      continue;
    }
    if (L.sha256 !== R.sha256) nonSceneTrackedMismatches.push(id);
  }
  if (nonSceneTrackedMismatches.length) {
    reasons.push(
      `${opts.pair}_non_scene_tracked_mismatch:${nonSceneTrackedMismatches.join(",")}`
    );
  }

  // After stripping scene owner from left system, systems should match right
  const leftStripped = stripSceneOwnerBlock(left.systemJoined);
  const rightNorm = right.systemJoined.replace(/\n{3,}/g, "\n\n").trim();
  const systemWithoutSceneMatch = leftStripped === rightNorm;
  if (!systemWithoutSceneMatch) {
    // Fallback: if strip is imperfect, require hash equality of non-scene tracked + user match
    // already checked; still flag for visibility
    reasons.push(`${opts.pair}_system_without_scene_mismatch`);
  }

  // Invariant content hashes
  for (const k of ["character_core", "persona_block", "prose_top"] as const) {
    if (left.hashes[k] !== right.hashes[k]) {
      reasons.push(`${opts.pair}_${k}_mismatch`);
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    nonSceneTrackedMismatches,
    userMatch,
    systemWithoutSceneMatch,
  };
}

async function main() {
  if (!existsSync(FIXTURE)) throw new Error(`missing fixture ${FIXTURE}`);
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };

  const prior =
    "라이크는 로비 한쪽에 서서 짧은 숨을 고른 뒤, 상대를 천천히 바라보았다.\n\n\"렌이라…. 알겠어.\"";

  const armsT1: Record<ArmKey, Awaited<ReturnType<typeof buildArm>>> = {
    A: await buildArm({ fixture, turn: 1, arm: "A" }),
    B: await buildArm({ fixture, turn: 1, arm: "B" }),
    C: await buildArm({ fixture, turn: 1, arm: "C" }),
    D: await buildArm({ fixture, turn: 1, arm: "D" }),
  };
  const armsT2: Record<ArmKey, Awaited<ReturnType<typeof buildArm>>> = {
    A: await buildArm({ fixture, turn: 2, arm: "A", priorAssistant: prior }),
    B: await buildArm({ fixture, turn: 2, arm: "B", priorAssistant: prior }),
    C: await buildArm({ fixture, turn: 2, arm: "C", priorAssistant: prior }),
    D: await buildArm({ fixture, turn: 2, arm: "D", priorAssistant: prior }),
  };

  const pairChecks = {
    A_vs_C_t1: comparePair({
      left: armsT1.A,
      right: armsT1.C,
      pair: "A_vs_C",
      turn: 1,
    }),
    A_vs_C_t2: comparePair({
      left: armsT2.A,
      right: armsT2.C,
      pair: "A_vs_C",
      turn: 2,
    }),
    B_vs_D_t1: comparePair({
      left: armsT1.B,
      right: armsT1.D,
      pair: "B_vs_D",
      turn: 1,
    }),
    B_vs_D_t2: comparePair({
      left: armsT2.B,
      right: armsT2.D,
      pair: "B_vs_D",
      turn: 2,
    }),
  };

  const lengthMatrix = {
    A_t1: armsT1.A.lengthOwnerCount,
    A_t2: armsT2.A.lengthOwnerCount,
    B_t1: armsT1.B.lengthOwnerCount,
    B_t2: armsT2.B.lengthOwnerCount,
    C_t1: armsT1.C.lengthOwnerCount,
    C_t2: armsT2.C.lengthOwnerCount,
    D_t1: armsT1.D.lengthOwnerCount,
    D_t2: armsT2.D.lengthOwnerCount,
  };

  const sceneMatrix = {
    A: armsT1.A.sceneInSystem,
    B: armsT1.B.sceneInSystem,
    C: armsT1.C.sceneInSystem,
    D: armsT1.D.sceneInSystem,
  };

  // B vs A length isolation still holds (sanity)
  const bLengthOk =
    armsT1.B.lengthOwnerCount === 1 &&
    armsT1.B.flags.user_tail &&
    !armsT1.B.flags.deepseek_length &&
    !armsT1.B.flags.short_history &&
    armsT1.B.flags.style_reminder;
  const aLengthOk =
    armsT1.A.lengthOwnerCount === 3 &&
    armsT1.A.flags.deepseek_length &&
    armsT1.A.flags.short_history &&
    armsT1.A.flags.user_tail;

  const allPairOk = Object.values(pairChecks).every((p) => p.ok);
  const lengthOk =
    lengthMatrix.A_t1 === 3 &&
    lengthMatrix.C_t1 === 3 &&
    lengthMatrix.B_t1 === 1 &&
    lengthMatrix.D_t1 === 1 &&
    aLengthOk &&
    bLengthOk &&
    // Turn2: A/C may add SHORT USER (4); B/D stay at 1
    lengthMatrix.A_t2 === lengthMatrix.C_t2 &&
    lengthMatrix.B_t2 === 1 &&
    lengthMatrix.D_t2 === 1 &&
    !armsT2.D.flags.short_user;

  const sceneOk =
    sceneMatrix.A === true &&
    sceneMatrix.B === true &&
    sceneMatrix.C === false &&
    sceneMatrix.D === false;

  const pass = allPairOk && lengthOk && sceneOk;
  const verdict = pass
    ? "DS_LENGTH_X_SCENE_2X2_OFFLINE_PASS"
    : "DS_LENGTH_X_SCENE_2X2_OFFLINE_FAIL";

  if (!pass) {
    console.error("PARITY_DEBUG", {
      lengthMatrix,
      sceneMatrix,
      pairChecks: Object.fromEntries(
        Object.entries(pairChecks).map(([k, v]) => [k, { ok: v.ok, reasons: v.reasons }])
      ),
      A_t1_flags: armsT1.A.flags,
      C_t1_flags: armsT1.C.flags,
      B_t1_flags: armsT1.B.flags,
      D_t1_flags: armsT1.D.flags,
      A_vs_C_sys_diff: unifyDiffLines(
        stripSceneOwnerBlock(armsT1.A.systemJoined),
        armsT1.C.systemJoined.replace(/\n{3,}/g, "\n\n").trim(),
        40
      ),
      B_vs_D_sys_diff: unifyDiffLines(
        stripSceneOwnerBlock(armsT1.B.systemJoined),
        armsT1.D.systemJoined.replace(/\n{3,}/g, "\n\n").trim(),
        40
      ),
      A_vs_C_user_diff: unifyDiffLines(armsT1.A.finalUser, armsT1.C.finalUser, 40),
    });
  }

  const promptHashes = {
    verdict,
    generated_at: new Date().toISOString(),
    model: MODEL,
    character_id: 18,
    persona_id: 61,
    user_id: 34,
    arms: Object.fromEntries(
      (["A", "B", "C", "D"] as ArmKey[]).map((arm) => [
        arm,
        {
          label: ARM_CFG[arm].label,
          canary: ARM_CFG[arm].canaryVariant,
          turn1: {
            lengthOwnerCount: armsT1[arm].lengthOwnerCount,
            sceneOn: armsT1[arm].sceneInSystem,
            flags: armsT1[arm].flags,
            hashes: armsT1[arm].hashes,
            wireRoles: armsT1[arm].wireRoles,
          },
          turn2: {
            lengthOwnerCount: armsT2[arm].lengthOwnerCount,
            sceneOn: armsT2[arm].sceneInSystem,
            flags: armsT2[arm].flags,
            hashes: armsT2[arm].hashes,
          },
        },
      ])
    ),
    pair_checks: pairChecks,
  };

  save("PROMPT_HASHES.json", promptHashes);

  save(
    "PROMPT_DIFF_MATRIX.md",
    [
      "# Prompt diff matrix — Length × Scene 2×2",
      "",
      `## Offline verdict: \`${verdict}\``,
      "",
      "## Arm matrix",
      "",
      "| Arm | Length owners (T1) | SceneDirective | Canary |",
      "|---|---:|---|---|",
      `| A | ${armsT1.A.lengthOwnerCount} | ON | (none / production) |`,
      `| B | ${armsT1.B.lengthOwnerCount} | ON | \`ds_single_terminal_length_owner\` |`,
      `| C | ${armsT1.C.lengthOwnerCount} | OFF | \`ds_triple_owner_scene_off\` |`,
      `| D | ${armsT1.D.lengthOwnerCount} | OFF | \`ds_single_owner_scene_off\` |`,
      "",
      "## Required pair isolation",
      "",
      "| Pair | Turn | OK | User match | System−scene match | Non-scene tracked mismatches |",
      "|---|---|---|---|---|---|",
      ...(["A_vs_C_t1", "A_vs_C_t2", "B_vs_D_t1", "B_vs_D_t2"] as const).map(
        (k) => {
          const p = pairChecks[k];
          return `| ${k} | — | ${p.ok} | ${p.userMatch} | ${p.systemWithoutSceneMatch} | ${p.nonSceneTrackedMismatches.join(", ") || "(none)"} |`;
        }
      ),
      "",
      "## Failure reasons (if any)",
      "",
      "```json",
      JSON.stringify(
        Object.fromEntries(
          Object.entries(pairChecks).map(([k, v]) => [k, v.reasons])
        ),
        null,
        2
      ),
      "```",
      "",
      "## Flag matrix Turn 1",
      "",
      "| flag | A | B | C | D |",
      "|---|---|---|---|---|",
      ...Object.keys(armsT1.A.flags).map(
        (k) =>
          `| ${k} | ${(armsT1.A.flags as Record<string, boolean>)[k]} | ${(armsT1.B.flags as Record<string, boolean>)[k]} | ${(armsT1.C.flags as Record<string, boolean>)[k]} | ${(armsT1.D.flags as Record<string, boolean>)[k]} |`
      ),
      "",
      "## Notes",
      "",
      "- A/C retain production triple length stack (DEEPSEEK LENGTH + SHORT HISTORY + USER_TAIL).",
      "- B/D retain single terminal length owner (USER_TAIL only) + DeepSeek style-only reminder.",
      "- C/D remove BASE_SCENE_ENGINE_RULE + `[이번 턴 장면 지시]` only — no replacement progression text.",
      "",
    ].join("\n")
  );

  save("PARITY_VERDICT.json", {
    verdict,
    lengthMatrix,
    sceneMatrix,
    pairChecks: Object.fromEntries(
      Object.entries(pairChecks).map(([k, v]) => [
        k,
        {
          ok: v.ok,
          reasons: v.reasons,
          userMatch: v.userMatch,
          systemWithoutSceneMatch: v.systemWithoutSceneMatch,
        },
      ])
    ),
  });

  console.log(JSON.stringify({ verdict, lengthMatrix, sceneMatrix, pass }, null, 2));
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
