/**
 * BUGFIX investigation — Gemini 3.1 Pro single-call 2×2 bisect.
 *
 * Isolates Sep-17 USER_TAIL_LENGTH_OWNER_SENTENCE vs NARRATIVE_DENSITY_BLOCK
 * (commit bbb8cad1) as under-length contributors.
 *
 * Invariants:
 * - Exactly ONE provider call per sample (no continuation / retry / recovery)
 * - Gemini 3.1 Pro only, reasoning_effort=low, temperature=0.95, max_tokens omitted
 * - Production path (buildContext → assemblePrimaryRpRequest → CI adapt)
 * - Only USER_TAIL and/or NARRATIVE_DENSITY owner texts may differ across arms
 * - Production source files are NOT mutated
 *
 *   BISECT_RUNS=5 BISECT_FIXTURES=quiet_intimacy \
 *     node --conditions=react-server --import tsx scripts/gemini31-sep17-length-density-bisect.ts
 *
 *   BISECT_ARMS=A,B BISECT_DRY_RUN=1 …  # offline prompt hashes only
 */
import "./lib/server-only-mock";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  exitIfBenchmarkCheaperInferenceApiKeyMissing,
  sanitizeBenchmarkCredentialText,
} from "./lib/benchmarkCheaperInferenceCredential";
import {
  PROSE_DIET_CHAR_NAME,
  PROSE_DIET_CHARACTER_SYSTEM_PROMPT,
  PROSE_DIET_EXAMPLE_DIALOG,
  PROSE_DIET_FIXTURES,
  PROSE_DIET_PERSONA_NAME,
  PROSE_DIET_WORLD,
  type ProseDietFixture,
  type ProseDietFixtureId,
} from "./lib/proseDietFixtures";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

/** Pre-bbb8cad1 USER_TAIL (generative causal expansion). */
export const OLD_USER_TAIL_LENGTH_OWNER_SENTENCE =
  "이번 응답은 한국어 3,200자 이상을 기본 목표로 하나의 충분히 전개된 장면으로 작성한다. 장면에 필요한 내용이 있으면 더 길게 이어간다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.";

/** Pre-bbb8cad1 NARRATIVE_DENSITY (broad positive expansion materials). */
export const OLD_NARRATIVE_DENSITY_BLOCK = `[NARRATIVE DENSITY]
TARGET/FLOOR는 대화·내면·기억·연상·판단·관계·분위기·결과로 채운다.
모든 중간 동작을 기록하지 않는다 — 생략은 짧게 쓰라는 뜻이 아니다.
미세 행동·반복 해설로 분량을 채우지 않는다.`;

type ArmId = "A" | "B" | "C" | "D";

const OUT_ROOT =
  process.env.BISECT_OUT_DIR?.trim() ||
  "/opt/cursor/artifacts/gemini31-sep17-length-density-bisect";
const DOCS_MIRROR = path.join(
  process.cwd(),
  "docs/audits/gemini31-sep17-length-density-bisect",
);
const RUNS = Math.max(1, Number(process.env.BISECT_RUNS ?? "5") || 5);
const DRY_RUN = process.env.BISECT_DRY_RUN === "1";
const ARM_FILTER = (process.env.BISECT_ARMS ?? "A,B,C,D")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean) as ArmId[];
const FIXTURE_FILTER = (process.env.BISECT_FIXTURES ?? "quiet_intimacy")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean) as ProseDietFixtureId[];

function write(rel: string, content: string | object) {
  for (const root of [OUT_ROOT, DOCS_MIRROR]) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
      "utf8",
    );
  }
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function flatContent(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) =>
        p && typeof p === "object" && "text" in p
          ? String((p as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  return "";
}

function mutateStringMessages(
  messages: Array<{ role: string; content: unknown }>,
  mutate: (role: string, text: string) => string,
): void {
  for (const m of messages) {
    if (typeof m.content === "string") {
      m.content = mutate(m.role, m.content);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content as Array<Record<string, unknown>>) {
        if (typeof part.text === "string") {
          part.text = mutate(m.role, part.text);
        }
      }
    }
  }
}

/** Occurrence tallies — not quality scores. Heuristic flags for human review. */
function countQualityOccurrences(text: string, userInput: string) {
  const dialogueBlocks = [
    ...text.matchAll(/(?:^|\n)"([^"\n]{2,})"/g),
  ].map((m) => m[1] ?? "");
  const userQuoted = [...userInput.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
  const inventedUserishDialogue = dialogueBlocks.filter((d) => {
    if (userQuoted.some((u) => d.includes(u) || u.includes(d))) return false;
    // Heuristic: second-person address / user-name speech attributed as speech
    return /(?:렌|당신|너)/.test(d) && /(?:요|죠|야|어|다)\s*$/.test(d);
  }).length;

  const majorChoice = (
    text.match(
      /렌(?:은|이|가)?\s*(?:고개를 끄덕|동의|거절|결정|선택|따라가|떠나)/g,
    ) ?? []
  ).length;
  const majorAction = (
    text.match(
      /렌(?:은|이|가)?\s*(?:손을 잡|끌어안|키스|입맞춤|달아나|뛰|문을 열)/g,
    ) ?? []
  ).length;

  const emotionWords = text.match(
    /(?:설렘|긴장|안도|그리움|외로움|따뜻함|두근거림|미안함|고마움)/g,
  );
  const emotionCounts = new Map<string, number>();
  for (const w of emotionWords ?? []) {
    emotionCounts.set(w, (emotionCounts.get(w) ?? 0) + 1);
  }
  const repeatedEmotion = [...emotionCounts.values()].filter((n) => n >= 3).length;

  const microActionFiller = (
    text.match(
      /(?:손가락을 (?:살짝 |한 번 )?(?:움직|쓸|만지)|숨을 (?:짧게 |한 번 )?(?:들이|내쉬)|입술을 (?:살짝 )?(?:깨물|다물)|시선을 (?:살짝 |한 번 )?(?:돌리|내리))/g,
    ) ?? []
  ).length;

  const memoryPadding = (
    text.match(
      /(?:그때|예전에|3년 전|기억(?:이|이 났|났다|났다)|회상|떠올렸)/g,
    ) ?? []
  ).length;

  const unnecessaryNpc = (
    text.match(
      /(?:갑자기|그때 마침).{0,20}(?:누군가|사람|직원|경보|전화)/g,
    ) ?? []
  ).length;

  const abstractExplanation = (
    text.match(
      /(?:라는 뜻이었다|라는 의미였다|그런 의미에서|요약하면|결국 .+이었다)/g,
    ) ?? []
  ).length;

  const aiProgression = (
    text.match(
      /백하율(?:은|이|가).{0,40}(?:말했|답했|손|시선|걸음|다가|물러|물었)/g,
    ) ?? []
  ).length;

  return {
    user_new_dialogue_invented_heuristic: inventedUserishDialogue,
    user_major_choice_invented: majorChoice,
    user_major_action_invented: majorAction,
    ai_npc_meaningful_progression: aiProgression,
    repeated_emotion_clusters: repeatedEmotion,
    micro_action_filler: microActionFiller,
    backstory_memory_padding: memoryPadding,
    unnecessary_npc_event: unnecessaryNpc,
    abstract_explanation: abstractExplanation,
  };
}

async function streamOnce(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  error: string | null;
  status: number;
  latencyMs: number;
}> {
  const started = Date.now();
  const out = {
    text: "",
    finish: null as string | null,
    usage: null as Record<string, unknown> | null,
    error: null as string | null,
    status: 0,
    latencyMs: 0,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12 * 60 * 1000),
    });
    out.status = res.status;
    if (!res.ok || !res.body) {
      out.error = sanitizeBenchmarkCredentialText(
        (await res.text()).slice(0, 1500),
      );
      out.latencyMs = Date.now() - started;
      return out;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const handle = (line: string) => {
      const t = line.trim();
      if (!t.startsWith("data:")) return;
      const data = t.slice(5).trim();
      if (!data || data === "[DONE]") return;
      try {
        const ev = JSON.parse(data) as Record<string, unknown>;
        const choice = (
          ev.choices as Array<Record<string, unknown>> | undefined
        )?.[0];
        const delta = (choice?.delta ?? {}) as Record<string, unknown>;
        if (typeof delta.content === "string") out.text += delta.content;
        if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
          out.finish = choice.finish_reason;
        }
        if (ev.usage && typeof ev.usage === "object") {
          out.usage = ev.usage as Record<string, unknown>;
        }
      } catch {
        /* partial */
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      lines.forEach(handle);
    }
    buf += dec.decode();
    if (buf.trim()) handle(buf);
  } catch (e) {
    out.error = sanitizeBenchmarkCredentialText(String(e)).slice(0, 1500);
  }
  out.latencyMs = Date.now() - started;
  return out;
}

async function main() {
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import(
    "../src/lib/responseLength"
  );
  const { NARRATIVE_DENSITY_BLOCK } = await import(
    "../src/lib/sceneExpansionPolicy"
  );
  const { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    adaptCheaperInferenceChatBody,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } = await import(
    "../src/lib/sceneDirective"
  );
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import(
    "../src/lib/chatMemory"
  );
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );
  const { INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION } = await import(
    "../src/lib/currentTurnUserAuthoringDelegation"
  );
  const { openRouterUsdCostFromRates } = await import(
    "../src/lib/openRouterModelPricing"
  );
  const { COLLABORATIVE_INTERACTIVE_OWNER_BLOCK } = await import(
    "../src/lib/noGodmodding"
  );
  const { COMMON_PROSE_BLOCK } = await import(
    "../src/lib/advancedProseNsfwGuidelines"
  );

  const MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
  const CURRENT_USER_TAIL = USER_TAIL_LENGTH_OWNER_SENTENCE;
  const CURRENT_DENSITY = NARRATIVE_DENSITY_BLOCK;

  const armSpec: Record<
    ArmId,
    { userTail: "current" | "old"; density: "current" | "old"; label: string }
  > = {
    A: {
      userTail: "current",
      density: "current",
      label: "CURRENT — current USER_TAIL + current NARRATIVE_DENSITY",
    },
    B: {
      userTail: "old",
      density: "current",
      label: "OLD LENGTH ONLY — pre-Sep17 USER_TAIL + current NARRATIVE_DENSITY",
    },
    C: {
      userTail: "current",
      density: "old",
      label: "OLD DENSITY ONLY — current USER_TAIL + pre-Sep17 NARRATIVE_DENSITY",
    },
    D: {
      userTail: "old",
      density: "old",
      label: "OLD LENGTH + OLD DENSITY — pre-Sep17 both",
    },
  };

  const longTermMemory =
    "3년 전 실종 사건 이후 서로를 더 자주 확인한다. 최근 도심 골목에서 이상한 그림자를 목격했다.";

  const assembleArm = (arm: ArmId, fx: ProseDietFixture) => {
    const narrativePov = resolveNarrativePov({
      mode: "third_person",
      contentKind: "character",
      mainCharacterName: PROSE_DIET_CHAR_NAME,
    });
    const directive = buildSceneDirective({
      mode: "interactive",
      recentMessages: fx.shortTermHistory,
      currentUserMessage: fx.currentUserMessage,
      memoryText: longTermMemory,
      relationshipMemoryText: "",
      lorebookText: "",
      triggeredEventText: "",
      chatId: 910017,
      currentTurn: 3,
      progressionHistory: [],
      contentKind: "character",
      primaryCharacterName: PROSE_DIET_CHAR_NAME,
    });
    const built = buildContext({
      charName: PROSE_DIET_CHAR_NAME,
      personaDisplayName: PROSE_DIET_PERSONA_NAME,
      userNickname: PROSE_DIET_PERSONA_NAME,
      chunks: parseCharacterSetting({
        characterId: "sep17-bisect-1",
        characterName: PROSE_DIET_CHAR_NAME,
        gender: "male",
        systemPrompt: PROSE_DIET_CHARACTER_SYSTEM_PROMPT,
        world: PROSE_DIET_WORLD,
        exampleDialog: PROSE_DIET_EXAMPLE_DIALOG,
        statusWindowPrompt: "",
      }),
      userPersona: formatSelectedPersonaForPrompt(
        PROSE_DIET_PERSONA_NAME,
        "other",
        "20대 대학원생. 호기심 많고 직설적이지만 상대를 존중한다.",
      ),
      userNote: formatUserNoteForPrompt(
        "렌과 오래 알고 지낸 친구. 3년 전 실종 사건 이후 더 자주 연락한다.",
      ),
      longTermMemory,
      memoryMeta: formatMemoryMetaForPrompt(
        parseMemoryMeta(
          JSON.stringify({
            affection: 65,
            trust: 58,
            relationshipLabel: "오래된 지인",
          }),
        ),
      ),
      shortTermHistory: fx.shortTermHistory,
      currentUserMessage: fx.currentUserMessage,
      nsfw: false,
      gender: "male",
      userPersonaGender: "other",
      currentTurnAuthoringDelegation: INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
      novelModeEnabled: false,
      targetResponseChars: 3200,
      completedTurns: 3,
      genres: ["현대/일상"],
      provider: "openrouter",
      modelId: MODEL,
      contentKind: "character",
      narrativePov,
      sceneDirectiveBlock: renderSceneDirectiveForPrompt(directive),
      scenePacingPromptOwner: "legacy_v1",
    });

    const wire = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history,
      modelId: MODEL,
      targetResponseChars: 3200,
      messageOpts: {
        transportProvider: "cheaperinference",
        charName: PROSE_DIET_CHAR_NAME,
        personaName: PROSE_DIET_PERSONA_NAME,
        sceneServerControls: {
          mode: "interactive",
          contentKind: "character",
          party: false,
          primaryCharacterName: PROSE_DIET_CHAR_NAME,
          currentUserMessage: fx.currentUserMessage,
          recentMessages: fx.shortTermHistory,
          memoryText: longTermMemory,
          adultModeEnabled: false,
          chatId: 910017,
          currentTurn: 3,
          progressionHistory: [],
          canonicalSceneDirective: directive,
          skipMotionCue: false,
        },
      },
    });

    const body = adaptCheaperInferenceChatBody(
      structuredClone(wire.requestBody as Record<string, unknown>),
    );
    body.stream = true;
    body.stream_options = { include_usage: true };
    // Benchmark invariant: omit max_tokens; keep production temperature/effort.
    delete body.max_tokens;

    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const spec = armSpec[arm];
    const desiredTail =
      spec.userTail === "current"
        ? CURRENT_USER_TAIL
        : OLD_USER_TAIL_LENGTH_OWNER_SENTENCE;
    const desiredDensity =
      spec.density === "current" ? CURRENT_DENSITY : OLD_NARRATIVE_DENSITY_BLOCK;

    let userTailSwapCount = 0;
    let densityPresentBefore = false;
    let densitySwapCount = 0;

    mutateStringMessages(messages, (role, text) => {
      let next = text;
      if (role === "user" && next.includes(CURRENT_USER_TAIL)) {
        if (desiredTail !== CURRENT_USER_TAIL) {
          next = next.split(CURRENT_USER_TAIL).join(desiredTail);
          userTailSwapCount += 1;
        }
      } else if (role === "user" && next.includes(OLD_USER_TAIL_LENGTH_OWNER_SENTENCE)) {
        if (desiredTail !== OLD_USER_TAIL_LENGTH_OWNER_SENTENCE) {
          next = next
            .split(OLD_USER_TAIL_LENGTH_OWNER_SENTENCE)
            .join(desiredTail);
          userTailSwapCount += 1;
        }
      }
      if (next.includes(CURRENT_DENSITY) || next.includes(OLD_NARRATIVE_DENSITY_BLOCK)) {
        densityPresentBefore = true;
        if (next.includes(CURRENT_DENSITY) && desiredDensity !== CURRENT_DENSITY) {
          next = next.split(CURRENT_DENSITY).join(desiredDensity);
          densitySwapCount += 1;
        } else if (
          next.includes(OLD_NARRATIVE_DENSITY_BLOCK) &&
          desiredDensity !== OLD_NARRATIVE_DENSITY_BLOCK
        ) {
          next = next.split(OLD_NARRATIVE_DENSITY_BLOCK).join(desiredDensity);
          densitySwapCount += 1;
        }
      }
      return next;
    });

    const system = flatContent(messages.find((m) => m.role === "system")?.content);
    const lastUser = flatContent(
      [...messages].reverse().find((m) => m.role === "user")?.content,
    );
    const promptBound = JSON.stringify(messages);
    const promptHash = sha256(promptBound);

    const userTailVariant: "current" | "old" | "missing" = lastUser.includes(
      CURRENT_USER_TAIL,
    )
      ? "current"
      : lastUser.includes(OLD_USER_TAIL_LENGTH_OWNER_SENTENCE)
        ? "old"
        : "missing";
    const densityVariant: "current" | "old" | "absent" = promptBound.includes(
      CURRENT_DENSITY,
    )
      ? "current"
      : promptBound.includes(OLD_NARRATIVE_DENSITY_BLOCK)
        ? "old"
        : "absent";

    const userTailOwnerCount =
      (lastUser.split(CURRENT_USER_TAIL).length - 1) +
      (lastUser.split(OLD_USER_TAIL_LENGTH_OWNER_SENTENCE).length - 1);

    return {
      body,
      system,
      lastUser,
      promptHash,
      userTailVariant,
      densityVariant,
      userTailSwapCount,
      densityPresentBefore,
      densitySwapCount,
      userTailOwnerCount,
      densityLiveInjected: densityVariant !== "absent",
      agencyOwnerPresent: system.includes(
        COLLABORATIVE_INTERACTIVE_OWNER_BLOCK.slice(0, 40),
      ),
      commonProsePresent: system.includes(COMMON_PROSE_BLOCK.slice(0, 40)),
      temperature: body.temperature ?? null,
      reasoning_effort: body.reasoning_effort ?? null,
      max_tokens: body.max_tokens ?? null,
      model: body.model ?? null,
    };
  };

  const fixtures = PROSE_DIET_FIXTURES.filter((f) =>
    FIXTURE_FILTER.includes(f.id),
  );
  if (!fixtures.length) throw new Error("No fixtures matched BISECT_FIXTURES");

  const ownerMap = {
    EXACT_MAIN_CONFIRMED_BY_GPT: "45d79ca86fc7083fb4f590671a88d666ba6cc2c5",
    LOCAL_HEAD: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
    numeric_visible_target: {
      owner: "USER_TAIL_LENGTH_OWNER_SENTENCE (한국어 3,200자 이상)",
      constants: "UNIFIED_TIER_AIM_CHARS=3200 in responseLengthConstants.ts",
    },
    USER_TAIL_LENGTH_OWNER: {
      file: "src/lib/responseLength.ts",
      current: CURRENT_USER_TAIL,
      old_pre_sep17: OLD_USER_TAIL_LENGTH_OWNER_SENTENCE,
      injection: "user-turn absolute tail via appendCompactTerminalLengthToUserTurn",
    },
    NARRATIVE_DENSITY: {
      file: "src/lib/sceneExpansionPolicy.ts",
      current: CURRENT_DENSITY,
      old_pre_sep17: OLD_NARRATIVE_DENSITY_BLOCK,
      injection:
        "NOT live-injected on Main RP — buildLengthInstruction() returns empty",
    },
    COMMON_PROSE: {
      file: "src/lib/advancedProseNsfwGuidelines.ts",
      note: "style owner; unchanged across arms",
    },
    current_turn_user_agency: {
      file: "src/lib/noGodmodding.ts COLLABORATIVE_INTERACTIVE_OWNER_BLOCK",
      overlapping_b_clause:
        "[B]의 새로운 직접 대사, 중요한 선택·동의·거절, 관계·목표·소속·정체성을 바꾸는 결정은 대신 확정하지 않는다.",
      length_duplicate:
        "USER_TAIL '[B]의 새 직접 대사·중요 선택·중대 행동을 분량 채우기용으로 만들지 않는다' = DUPLICATE OWNERSHIP inside LENGTH",
    },
    NO_GODMODDING: "buildNoGodmoddingBlock → collaborative interactive on standard",
    gemini31_agency_supplement: "src/lib/gemini31UserAgencyAdapter.ts (body/intent boundary)",
    scene_pacing: "Arm V SCENE PACING via assemblePrimaryRpRequest sceneServerControls",
    dialogue_owner: "COMMON PROSE + OUTPUT LAYOUT + optional [이번 응답 대화] budget",
  };
  write("OWNER_MAP.json", ownerMap);

  const promptIndex: Record<string, unknown>[] = [];
  for (const fx of fixtures) {
    for (const arm of ARM_FILTER) {
      const a = assembleArm(arm, fx);
      write(`${fx.id}/${arm}/wire-system.txt`, a.system);
      write(`${fx.id}/${arm}/wire-last-user.txt`, a.lastUser);
      write(`${fx.id}/${arm}/prompt-meta.json`, {
        arm,
        fixtureId: fx.id,
        label: armSpec[arm].label,
        promptHash: a.promptHash,
        userTailVariant: a.userTailVariant,
        densityVariant: a.densityVariant,
        densityLiveInjected: a.densityLiveInjected,
        densityPresentBefore: a.densityPresentBefore,
        userTailSwapCount: a.userTailSwapCount,
        densitySwapCount: a.densitySwapCount,
        userTailOwnerCount: a.userTailOwnerCount,
        agencyOwnerPresent: a.agencyOwnerPresent,
        commonProsePresent: a.commonProsePresent,
        temperature: a.temperature,
        reasoning_effort: a.reasoning_effort,
        max_tokens: a.max_tokens,
        model: a.model,
      });
      promptIndex.push({
        arm,
        fixtureId: fx.id,
        promptHash: a.promptHash,
        userTailVariant: a.userTailVariant,
        densityVariant: a.densityVariant,
        densityLiveInjected: a.densityLiveInjected,
        userTailOwnerCount: a.userTailOwnerCount,
        temperature: a.temperature,
        reasoning_effort: a.reasoning_effort,
        max_tokens: a.max_tokens,
      });
      console.log(
        `[prompt] ${fx.id}/${arm} hash=${a.promptHash.slice(0, 12)} tail=${a.userTailVariant} density=${a.densityVariant} temp=${a.temperature} effort=${a.reasoning_effort} max_tokens=${a.max_tokens}`,
      );
    }
  }
  write("PROMPT_HASH_INDEX.json", promptIndex);

  if (DRY_RUN) {
    console.log("BISECT_DRY_RUN=1 — prompt hashes only; provider calls=0");
    console.log("provider calls=0");
    return;
  }

  const apiKey = exitIfBenchmarkCheaperInferenceApiKeyMissing(
    "SEP17_BISECT_NOT_RUN",
  );

  const results: Record<string, unknown>[] = [];
  let providerCalls = 0;

  for (const fx of fixtures) {
    for (const arm of ARM_FILTER) {
      for (let run = 1; run <= RUNS; run++) {
        const a = assembleArm(arm, fx);
        // Hard invariant checks before call
        if (a.userTailOwnerCount !== 1) {
          throw new Error(
            `${arm} run${run}: USER_TAIL owner count=${a.userTailOwnerCount} (want 1)`,
          );
        }
        if (a.reasoning_effort !== "low") {
          throw new Error(`${arm}: reasoning_effort=${a.reasoning_effort}`);
        }
        if (a.temperature !== 0.95) {
          throw new Error(`${arm}: temperature=${a.temperature}`);
        }
        if (a.max_tokens != null) {
          throw new Error(`${arm}: max_tokens present (${a.max_tokens})`);
        }
        if (a.userTailVariant !== armSpec[arm].userTail) {
          throw new Error(
            `${arm}: expected userTail=${armSpec[arm].userTail} got ${a.userTailVariant}`,
          );
        }
        // Density: may be absent on production wire for all arms
        if (
          a.densityLiveInjected &&
          a.densityVariant !== armSpec[arm].density
        ) {
          throw new Error(
            `${arm}: expected density=${armSpec[arm].density} got ${a.densityVariant}`,
          );
        }

        console.log(`[live] ${fx.id}/${arm}/run${run} …`);
        const cap = await streamOnce(
          CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
          buildCheaperInferenceHeaders(apiKey),
          a.body,
        );
        providerCalls += 1; // exactly one call — no retry

        const completionTokens =
          typeof cap.usage?.completion_tokens === "number"
            ? cap.usage.completion_tokens
            : null;
        const reasoningTokens = (() => {
          const d = cap.usage?.completion_tokens_details as
            | { reasoning_tokens?: unknown }
            | undefined;
          return typeof d?.reasoning_tokens === "number"
            ? d.reasoning_tokens
            : null;
        })();
        const promptTokens =
          typeof cap.usage?.prompt_tokens === "number"
            ? cap.usage.prompt_tokens
            : null;
        const visibleChars = visibleAssistantDisplayCharCount(cap.text);
        const reasoningShare =
          completionTokens && completionTokens > 0 && reasoningTokens != null
            ? reasoningTokens / completionTokens
            : null;
        const cost = openRouterUsdCostFromRates({
          modelId: MODEL,
          promptTokens: promptTokens ?? 0,
          outputTokens: completionTokens ?? 0,
        });
        const occurrences = countQualityOccurrences(
          cap.text,
          fx.currentUserMessage,
        );

        const row = {
          arm,
          fixtureId: fx.id,
          run,
          label: armSpec[arm].label,
          promptHash: a.promptHash,
          userTailVariant: a.userTailVariant,
          densityVariant: a.densityVariant,
          densityLiveInjected: a.densityLiveInjected,
          provider_calls: 1,
          visibleChars,
          rawChars: cap.text.length,
          completionTokens,
          reasoningTokens,
          reasoning_completion_share: reasoningShare,
          promptTokens,
          finish_reason: cap.finish,
          latencyMs: cap.latencyMs,
          costUsd: cost.usdCost,
          status: cap.status,
          error: cap.error,
          occurrences,
          temperature: a.temperature,
          reasoning_effort: a.reasoning_effort,
          max_tokens: a.max_tokens,
        };

        const dir = `${fx.id}/${arm}/run${run}`;
        write(`${dir}/raw.txt`, cap.text);
        write(`${dir}/meta.json`, { ...row, usage: cap.usage });
        results.push(row);
        console.log(
          `  visible=${visibleChars} finish=${cap.finish} completion=${completionTokens} reasoning=${reasoningTokens} share=${reasoningShare?.toFixed(3) ?? "n/a"} err=${cap.error ? "YES" : "no"}`,
        );
      }
    }
  }

  write("RESULTS.json", results);
  write("SUMMARY_PROVIDER_CALLS.json", {
    provider_calls_total: providerCalls,
    per_sample_invariant: 1,
    note: "No continuation / retry / recovery calls were issued",
  });

  // Distribution summary
  const byArm: Record<string, number[]> = {};
  for (const r of results) {
    const arm = String(r.arm);
    const v = Number(r.visibleChars);
    if (!byArm[arm]) byArm[arm] = [];
    if (!Number.isNaN(v)) byArm[arm].push(v);
  }
  const dist = Object.fromEntries(
    Object.entries(byArm).map(([arm, vals]) => {
      const sorted = [...vals].sort((a, b) => a - b);
      const mean = vals.reduce((s, x) => s + x, 0) / (vals.length || 1);
      const median =
        sorted.length === 0
          ? null
          : sorted.length % 2
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
      return {
        arm,
        n: vals.length,
        min: sorted[0] ?? null,
        p25: sorted[Math.floor((sorted.length - 1) * 0.25)] ?? null,
        median,
        mean: Math.round(mean),
        p75: sorted[Math.floor((sorted.length - 1) * 0.75)] ?? null,
        max: sorted[sorted.length - 1] ?? null,
        values: vals,
      };
    }),
  );
  write("DISTRIBUTION.json", dist);
  console.log("DISTRIBUTION", JSON.stringify(dist, null, 2));
  console.log(`provider calls=${providerCalls}`);
  console.log(`wrote ${OUT_ROOT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
