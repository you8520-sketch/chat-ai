/**
 * Evidence-only DeepSeek 0813 length-arm + H5 reliability audit.
 * Not imported by production runtime. Does not change src/ behavior.
 *
 * ASSEMBLE_ONLY=1 — freeze prompts, no provider calls.
 * Otherwise exactly 6 DeepSeek calls (R/A × A/B/C). No retry. No continuation.
 */
import Module from "module";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { performance } from "perf_hooks";
import path from "path";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "../../src/services/contextBuilder";
import { formatUserPersonaForPrompt } from "../../src/lib/persona";
import { loadCharacterChunksForPromptReadOnly } from "../../src/lib/characterChunks";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  resolveSelectedAI,
} from "../../src/lib/chatModels";
import {
  SNPV2_DEEPSEEK_LENGTH_ARM_ENV,
  type DeepSeekLengthArm,
  buildDeepSeekLengthAdapterBlock,
  parseDeepSeekLengthArm,
  resolveDeepSeekLengthAdapterSection,
} from "../../src/lib/sharedNovelProseModelAdapters";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../../src/lib/responseLength";
import { UNIFIED_RESPONSE_LENGTH_TARGET } from "../../src/lib/responseLengthConstants";
import { estimateTokens } from "../../src/lib/tokenEstimate";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "../../src/lib/cheaperInferenceConfig";
import {
  buildOpenRouterRequestBody,
  resolveOpenRouterMaxTokens,
} from "../../src/lib/openRouterClient";
import { adaptCheaperInferenceChatBody } from "../../src/lib/cheaperInferenceConfig";
import { streamOpenRouterAdult } from "../../src/lib/openRouterAdult";
import type { ChatMsg } from "../../src/lib/ai";

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "data/ds0813-length-h5-reliability-audit");
const ASSEMBLE_ONLY = process.env.ASSEMBLE_ONLY === "1";
const USER_ID = 59;
const TARGET = UNIFIED_RESPONSE_LENGTH_TARGET;
const MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const ARMS: DeepSeekLengthArm[] = ["A", "B", "C"];

type FixtureKey = "R" | "A";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function setArm(arm: DeepSeekLengthArm) {
  process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV] = arm;
}

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(EVIDENCE, rel), "utf8")) as T;
}

function countHangul(text: string): number {
  return (text.match(/[\uAC00-\uD7A3]/g) ?? []).length;
}

function countParagraphs(text: string): number {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).length;
}

function countDialogue(text: string): number {
  return (text.match(/[「“"][^」”"]+[」”"]/g) ?? []).length;
}

function visibleCharsWithSpaces(text: string): number {
  return text.replace(/\r/g, "").length;
}

function visibleCharsNoSpaces(text: string): number {
  return text.replace(/\s+/g, "").length;
}

type CharacterRow = Record<string, unknown> & {
  id: number;
  name: string;
  gender?: string | null;
  nsfw?: number;
  system_prompt?: string;
  world?: string | null;
  example_dialog?: string | null;
  greeting?: string | null;
  setting_chunks?: string | null;
  setting_chunks_en?: string | null;
  speech_profile?: string | null;
  creator_compiled_description_json?: string | null;
  appearance_raw?: string | null;
  appearance_compiled?: string | null;
  content_kind?: string | null;
};

type Persona = { name: string; gender: string; description: string };
type UserInputs = Record<
  FixtureKey,
  {
    text: string;
    nsfw: boolean;
    is_adult_mode: boolean;
    adult_consent_mode: string | null;
  }
>;

function classifySection(id: string, label: string, text: string): string {
  if (id === "rule-deepseek-length-adapter") return "length_owner";
  if (id === "no-godmodding") return "agency_no_godmodding";
  if (id === "prose-style-xml-bundle" || id.includes("immersive") || id.includes("novel-prose"))
    return "prose_style";
  if (id === "rule-output-layout-recency") return "other_operational";
  if (id === "user-persona-reference-owner" || id === "identity-and-rules") return "persona";
  if (id.includes("adult") || id.includes("nsfw") || label.includes("19+")) return "adult_context";
  if (id.includes("persona")) return "persona";
  if (id.includes("user-note") || id.includes("usernote")) return "user_note";
  if (id.includes("memory") || id.includes("ltm")) return "long_term_memory";
  if (id.includes("speech") || id.includes("example-dialog")) return "speech_example";
  if (id.includes("world") || id.includes("lore")) return "world_lore";
  if (id.includes("character") || id.includes("canon") || id.includes("identity"))
    return "character_identity_canon";
  if (id.includes("scene") || id.includes("momentum")) return "scene_directives";
  if (id.includes("deepseek") || id.includes("xml")) return "deepseek_xml_extras";
  if (id.includes("core") || id.includes("openrouter-korean")) return "core_rules";
  if (text.includes(USER_TAIL_LENGTH_OWNER_SENTENCE)) return "length_owner";
  return "other_operational";
}

function flagsFor(text: string, userInput: string) {
  const t = text;
  const refusal =
    /죄송하지만|요청을 수행할 수 없|I cannot|I'm unable|cannot comply|정책상 거부/.test(t);
  const meta =
    /as an ai|language model|system prompt|I am an AI|인공지능으로서/i.test(t);
  const sysLeak =
    /USER_TAIL_LENGTH_OWNER|TARGET_LENGTH|MINIMUM_FLOOR|\[DEEPSEEK LENGTH|SNPV2_DEEPSEEK|NO GODMODDING|CHARACTER KNOWLEDGE BOUNDARY/.test(
      t
    );
  const sentences = t
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 24);
  const seen = new Map<string, number>();
  for (const s of sentences) seen.set(s, (seen.get(s) ?? 0) + 1);
  const exactDup = [...seen.values()].some((n) => n >= 2);

  const userDialogue =
    /도윤(?:이|은|가)?\s*[「“"].+?[」”"]/.test(t) ||
    /[「“"][^」”"]+[」”"][^.]*도윤/.test(t);
  const userIntentional =
    /도윤(?:이|은|가)?\s*(?:손을|몸을|고개를|입을|문을|옷을|키스를|다가와|말했다|답했다|물었다|선택)/.test(
      t
    );
  const userMajor =
    /도윤(?:이|은|가)?\s*(?:동의|거절|승낙|선택|결정)/.test(t);
  const userBackstory =
    /도윤(?:의)?\s*(?:어린 시절|과거|가족사|고향은|본명은)/.test(t);
  const newCanon =
    /갑자기.{0,12}(각성|각인|페어\s*확정|등급이\s*바뀌)/.test(t);
  const newNpc =
    /처음 보는\s+(?:남자|여자|요원|가이드|센티넬)|낯선\s+(?:남자|여자)가\s+다가/.test(
      t
    );
  const unrelated = /갑자기\s+(?:게이트가\s+열|폭발|사이렌|경보)/.test(t);

  return {
    REFUSAL_PRESENT: refusal,
    META_LEAK: meta,
    SYSTEM_PROMPT_LEAK: sysLeak,
    EXACT_SENTENCE_DUPLICATION: exactDup,
    NEW_USER_DIALOGUE_AUTHORED: userDialogue,
    NEW_USER_INTENTIONAL_ACTION_AUTHORED: userIntentional,
    USER_MAJOR_CHOICE_AUTHORED: userMajor,
    NEW_USER_BACKSTORY_INVENTED: userBackstory,
    NEW_CHARACTER_CANON_INVENTED: newCanon,
    NEW_EXTERNAL_NPC_INTRODUCED: newNpc,
    UNRELATED_EVENT_INTRODUCED: unrelated,
    OUTPUT_TRUNCATED: false,
    NOTE_INVOLUNTARY_USER_PHYSIOLOGY_NOT_AGENCY:
      "tremble / breathing / involuntary body / physiological arousal are not flagged as agency violations",
    USER_INPUT_ECHO_SPAN: userInput.slice(0, 40),
  };
}

function assembleOne(opts: {
  fixtureKey: FixtureKey;
  arm: DeepSeekLengthArm;
  character: CharacterRow;
  persona: Persona;
  userText: string;
  nsfw: boolean;
}) {
  setArm(opts.arm);
  const greeting = String(opts.character.greeting ?? "");
  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    opts.character as never,
    opts.persona.name,
    opts.persona.name
  );
  const userPersona = formatUserPersonaForPrompt(
    opts.persona.name,
    opts.persona.description,
    opts.persona.name
  );
  const resolved = resolveSelectedAI(MODEL);
  const built = buildContext({
    charName: String(opts.character.name),
    chunks,
    userNickname: opts.persona.name,
    userPersona,
    userNote: "",
    longTermMemory: "",
    archiveMemory: null,
    shortTermHistory: [{ role: "assistant", content: greeting }],
    currentUserMessage: opts.userText,
    nsfw: opts.nsfw,
    gender: (opts.character.gender as "male" | "female" | "other") ?? "other",
    userId: USER_ID,
    chatId: opts.fixtureKey === "R" ? 900017 : 900018,
    targetResponseChars: TARGET,
    modelId: resolved,
    provider: "openrouter",
    personaDisplayName: opts.persona.name,
    userPersonaGender: (opts.persona.gender as "male" | "female" | "other") ?? "male",
    useEnglishCharacterPrompt: usedEnglish,
    contentKind:
      opts.character.content_kind === "simulation" ? "simulation" : "character",
    userImpersonation: false,
    novelModeEnabled: false,
  });

  const system = built.systemPrompt ?? "";
  const history: ChatMsg[] = built.history ?? [
    { role: "assistant", content: greeting },
    { role: "user", content: opts.userText },
  ];
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const currentUser = lastUser?.content ?? opts.userText;
  const historyOnly = history
    .filter((m) => !(m.role === "user" && m.content === currentUser))
    .map((m) => m.content)
    .join("\n\n");

  const ownerCount = (
    currentUser.match(
      new RegExp(
        USER_TAIL_LENGTH_OWNER_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "g"
      )
    ) ?? []
  ).length;
  const ownerInSystem = (
    system.match(
      new RegExp(
        USER_TAIL_LENGTH_OWNER_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "g"
      )
    ) ?? []
  ).length;
  const terminalOk = currentUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE);
  const adapter = resolveDeepSeekLengthAdapterSection(resolved);
  const adapterInSystem = adapter ? system.includes(adapter) : false;
  const adapterCount = (system.match(/\[DEEPSEEK LENGTH ADAPTER/g) ?? []).length;

  const sections = (built.meta?.trackedSections ?? []).map((s) => {
    const semantic = classifySection(s.id, s.label, s.text);
    return {
      SECTION_ID: s.id,
      LABEL: s.label,
      SEMANTIC: semantic,
      CHARS: s.text.length,
      TOKENS: estimateTokens(s.text),
      DUPLICATE_OWNER_OF_SAME_CONCERN: false,
    };
  });
  const bySemantic = new Map<string, number>();
  for (const s of sections) bySemantic.set(s.SEMANTIC, (bySemantic.get(s.SEMANTIC) ?? 0) + 1);
  const ownerSemantics = new Set([
    "length_owner",
    "agency_no_godmodding",
    "prose_style",
  ]);
  for (const s of sections) {
    if (ownerSemantics.has(s.SEMANTIC) && (bySemantic.get(s.SEMANTIC) ?? 0) > 1) {
      s.DUPLICATE_OWNER_OF_SAME_CONCERN = true;
    }
  }

  const requestBody = adaptCheaperInferenceChatBody(
    buildOpenRouterRequestBody(
      resolved,
      [{ role: "system", content: system }, ...history],
      true,
      TARGET
    ) as Record<string, unknown>
  );

  return {
    fixtureKey: opts.fixtureKey,
    arm: opts.arm,
    resolvedArm: parseDeepSeekLengthArm(process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV]),
    usedEnglish,
    chunkCount: chunks.length,
    system,
    history,
    currentUser,
    SYSTEM_SHA: sha256(system),
    HISTORY_SHA: sha256(historyOnly),
    CURRENT_USER_SHA: sha256(currentUser),
    REQUEST_BODY_SHA: sha256(JSON.stringify(requestBody)),
    USER_TAIL_LENGTH_OWNER_COUNT: ownerCount,
    USER_TAIL_LENGTH_OWNER_IN_SYSTEM: ownerInSystem,
    USER_TAIL_LENGTH_OWNER_TERMINAL: terminalOk,
    ADAPTER_RESOLVED: adapter,
    ADAPTER_IN_SYSTEM: adapterInSystem,
    ADAPTER_SECTION_COUNT: adapterCount,
    SYSTEM_TOKENS: estimateTokens(system),
    HISTORY_TOKENS: estimateTokens(historyOnly),
    CURRENT_USER_TOKENS: estimateTokens(currentUser),
    TOTAL_ESTIMATED_INPUT: estimateTokens(
      `${system}\n${history.map((m) => m.content).join("\n")}`
    ),
    SYSTEM_CHARS: system.length,
    CURRENT_USER_CHARS: currentUser.length,
    sections,
    requestBody,
    maxTokens: resolveOpenRouterMaxTokens(TARGET, undefined, resolved),
    thinking: requestBody.thinking ?? null,
    reasoning_effort: requestBody.reasoning_effort ?? null,
    reasoning: requestBody.reasoning ?? null,
    promptAudit: built.meta?.promptAudit ?? null,
  };
}

async function callOnce(
  system: string,
  history: ChatMsg[]
): Promise<{
  text: string;
  usage: unknown;
  latencyMs: number;
  httpStatus: number | null;
  error: string | null;
}> {
  const t0 = performance.now();
  try {
    const stream = streamOpenRouterAdult(
      system,
      history,
      MODEL,
      TARGET,
      {
        transportProvider: "cheaperinference",
        allowOpenRouterUnderLengthRecovery: false,
        allowEmptyStreamFallback: false,
      },
      {
        requestKind: "ds0813-length-h5-reliability-audit",
        chargeTurnBudget: false,
      }
    );
    let text = "";
    let result = await stream.next();
    while (!result.done) {
      text += result.value;
      result = await stream.next();
    }
    return {
      text,
      usage: result.value,
      latencyMs: Math.round(performance.now() - t0),
      httpStatus: 200,
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const http = /(\b5\d\d\b)/.exec(msg)?.[1];
    return {
      text: "",
      usage: null,
      latencyMs: Math.round(performance.now() - t0),
      httpStatus: http ? Number(http) : null,
      error: msg.slice(0, 2000),
    };
  }
}

async function main() {
  mkdirSync(path.join(EVIDENCE, "assembled"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "raw"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "flags"), { recursive: true });

  const flood = loadJson<CharacterRow>("fixtures/character-17-flood.json");
  const like = loadJson<CharacterRow>("fixtures/character-18-like.json");
  const persona = loadJson<Persona>("fixtures/persona-doyun.json");
  const inputs = loadJson<UserInputs>("fixtures/user-inputs.json");

  const fixtures: Record<FixtureKey, { character: CharacterRow; nsfw: boolean; text: string }> = {
    R: { character: flood, nsfw: inputs.R.nsfw, text: inputs.R.text },
    A: { character: like, nsfw: inputs.A.nsfw, text: inputs.A.text },
  };

  const assembled: Record<string, ReturnType<typeof assembleOne>> = {};
  for (const fk of ["R", "A"] as FixtureKey[]) {
    for (const arm of ARMS) {
      const rec = assembleOne({
        fixtureKey: fk,
        arm,
        character: fixtures[fk].character,
        persona,
        userText: fixtures[fk].text,
        nsfw: fixtures[fk].nsfw,
      });
      assembled[`${fk}_${arm}`] = rec;
      writeFileSync(
        path.join(EVIDENCE, "assembled", `${fk}_${arm}.json`),
        JSON.stringify(
          {
            ...rec,
            system: rec.system,
            currentUser: rec.currentUser,
            history: rec.history,
            requestBody: {
              model: rec.requestBody.model,
              thinking: rec.requestBody.thinking,
              reasoning_effort: rec.requestBody.reasoning_effort,
              reasoning: rec.requestBody.reasoning,
              max_tokens: rec.requestBody.max_tokens,
              temperature: rec.requestBody.temperature,
            },
          },
          null,
          2
        ),
        "utf8"
      );
      writeFileSync(
        path.join(EVIDENCE, "assembled", `${fk}_${arm}.system.txt`),
        rec.system,
        "utf8"
      );
      writeFileSync(
        path.join(EVIDENCE, "assembled", `${fk}_${arm}.user.txt`),
        rec.currentUser,
        "utf8"
      );
    }
  }

  const ownerMap = {
    BASE_MAIN_SHA: "98f8111a6e81ad9551c3c9c5777032e40f7b4b3d",
    CURRENT_DS_LENGTH_ARM: "A",
    SNPV2_DEEPSEEK_LENGTH_ARM_DEFAULT: parseDeepSeekLengthArm(undefined),
    PRODUCTION_ADAPTER_SECTION: buildDeepSeekLengthAdapterBlock("A"),
    USER_TAIL_LENGTH_OWNER_SENTENCE,
    assembled: Object.fromEntries(
      Object.entries(assembled).map(([k, v]) => [
        k,
        {
          USER_TAIL_LENGTH_OWNER_COUNT: v.USER_TAIL_LENGTH_OWNER_COUNT,
          USER_TAIL_LENGTH_OWNER_IN_SYSTEM: v.USER_TAIL_LENGTH_OWNER_IN_SYSTEM,
          USER_TAIL_LENGTH_OWNER_TERMINAL: v.USER_TAIL_LENGTH_OWNER_TERMINAL,
          ADAPTER_SECTION_COUNT: v.ADAPTER_SECTION_COUNT,
          ADAPTER_IN_SYSTEM: v.ADAPTER_IN_SYSTEM,
          SYSTEM_SHA: v.SYSTEM_SHA,
          HISTORY_SHA: v.HISTORY_SHA,
          CURRENT_USER_SHA: v.CURRENT_USER_SHA,
          SYSTEM_TOKENS: v.SYSTEM_TOKENS,
          HISTORY_TOKENS: v.HISTORY_TOKENS,
          CURRENT_USER_TOKENS: v.CURRENT_USER_TOKENS,
          TOTAL_ESTIMATED_INPUT: v.TOTAL_ESTIMATED_INPUT,
          thinking: v.thinking,
          reasoning_effort: v.reasoning_effort,
          usedEnglish: v.usedEnglish,
          chunkCount: v.chunkCount,
        },
      ])
    ),
    WITHIN_FIXTURE_SHA_CONTRACT: {
      R_HISTORY_IDENTICAL:
        assembled.R_A.HISTORY_SHA === assembled.R_B.HISTORY_SHA &&
        assembled.R_B.HISTORY_SHA === assembled.R_C.HISTORY_SHA,
      A_HISTORY_IDENTICAL:
        assembled.A_A.HISTORY_SHA === assembled.A_B.HISTORY_SHA &&
        assembled.A_B.HISTORY_SHA === assembled.A_C.HISTORY_SHA,
      R_USER_IDENTICAL:
        assembled.R_A.CURRENT_USER_SHA === assembled.R_B.CURRENT_USER_SHA &&
        assembled.R_B.CURRENT_USER_SHA === assembled.R_C.CURRENT_USER_SHA,
      A_USER_IDENTICAL:
        assembled.A_A.CURRENT_USER_SHA === assembled.A_B.CURRENT_USER_SHA &&
        assembled.A_B.CURRENT_USER_SHA === assembled.A_C.CURRENT_USER_SHA,
      R_SYSTEM_A_NE_B: assembled.R_A.SYSTEM_SHA !== assembled.R_B.SYSTEM_SHA,
      R_SYSTEM_A_NE_C: assembled.R_A.SYSTEM_SHA !== assembled.R_C.SYSTEM_SHA,
      A_SYSTEM_A_NE_B: assembled.A_A.SYSTEM_SHA !== assembled.A_B.SYSTEM_SHA,
      A_SYSTEM_A_NE_C: assembled.A_A.SYSTEM_SHA !== assembled.A_C.SYSTEM_SHA,
    },
  };
  writeFileSync(
    path.join(EVIDENCE, "LENGTH_OWNER_MAP.json"),
    JSON.stringify(ownerMap, null, 2),
    "utf8"
  );

  const inventory = {
    estimate_method: "estimateTokens = ceil(chars * 0.9) — local, not provider",
    fixtures: Object.fromEntries(
      Object.entries(assembled).map(([k, v]) => [
        k,
        {
          SYSTEM_TOKENS: v.SYSTEM_TOKENS,
          HISTORY_TOKENS: v.HISTORY_TOKENS,
          CURRENT_USER_TOKENS: v.CURRENT_USER_TOKENS,
          TOTAL_ESTIMATED_INPUT: v.TOTAL_ESTIMATED_INPUT,
          sections: v.sections,
        },
      ])
    ),
  };
  writeFileSync(
    path.join(EVIDENCE, "PROMPT_TOKEN_INVENTORY.json"),
    JSON.stringify(inventory, null, 2),
    "utf8"
  );

  const sampleUser = assembled.R_A.currentUser;
  const sampleSystemA = assembled.R_A.system;
  const sampleSystemB = assembled.R_B.system;
  const duplicateOwners = {
    NOTE: "Large canon is not called bloat. Only same-concern owners.",
    DUPLICATE_LENGTH_OWNERS: {
      ARM_A: false,
      ARM_B: true,
      ARM_C: true,
      DETAIL:
        "ARM A: sole owner is USER_TAIL_LENGTH_OWNER_SENTENCE at the absolute end of the current user turn (count=1, not in system). ARM B/C add existing DeepSeek length adapter section on system; USER_TAIL is unchanged. That extra owner is the intended experiment variable, not a second copy of USER_TAIL.",
      USER_TAIL_IN_USER_TURN: sampleUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
      USER_TAIL_IN_SYSTEM_A: sampleSystemA.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
      ADAPTER_IN_SYSTEM_A: sampleSystemA.includes("[DEEPSEEK LENGTH ADAPTER"),
      ADAPTER_IN_SYSTEM_B: sampleSystemB.includes("[DEEPSEEK LENGTH ADAPTER — B]"),
      HISTORICAL_BLOCK_IN_PROMPT: sampleSystemA.includes("DEEPSEEK LENGTH — SINGLE CALL") ||
        sampleUser.includes("DEEPSEEK LENGTH — SINGLE CALL"),
    },
    DUPLICATE_AGENCY_OWNERS: {
      value: true,
      DETAIL:
        "System section no-godmodding plus the current-user collaborative-control paragraph both state [B] agency. character-core-identity is canon, not a second agency owner.",
    },
    DUPLICATE_STYLE_OWNERS: {
      value: true,
      DETAIL:
        "System prose-style-xml-bundle plus DeepSeek style-only user-turn reminder (DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY / prependDeepSeekStyleOnlyReminder). Layout recency is operational, not a third style owner.",
    },
  };
  writeFileSync(
    path.join(EVIDENCE, "DUPLICATE_OWNERS.json"),
    JSON.stringify(duplicateOwners, null, 2),
    "utf8"
  );

  console.log(JSON.stringify({ phase: "assembled", ownerMap }, null, 2));
  if (ASSEMBLE_ONLY) return;

  let providerCalls = 0;
  const results: Record<string, unknown>[] = [];
  for (const fk of ["R", "A"] as FixtureKey[]) {
    for (const arm of ARMS) {
      if (providerCalls >= 6) break;
      const rec = assembled[`${fk}_${arm}`];
      console.log(JSON.stringify({ phase: "calling", key: `${fk}_${arm}` }));
      const out = await callOnce(rec.system, rec.history);
      providerCalls += 1;
      const usage = (out.usage ?? {}) as Record<string, unknown>;
      const raw = out.text;
      const rawPath = path.join(EVIDENCE, "raw", `${fk}_${arm}.txt`);
      writeFileSync(rawPath, raw, "utf8");
      const finish =
        (usage.finishReason as string | undefined) ??
        (usage.finish_reason as string | undefined) ??
        null;
      const truncated = finish === "length" || finish === "max_tokens";
      const flags = {
        ...flagsFor(raw, fixtures[fk].text),
        OUTPUT_TRUNCATED: truncated,
      };
      writeFileSync(
        path.join(EVIDENCE, "flags", `${fk}_${arm}.json`),
        JSON.stringify(flags, null, 2),
        "utf8"
      );
      const row = {
        KEY: `${fk}_${arm}`,
        HTTP_STATUS: out.httpStatus,
        ERROR: out.error,
        LATENCY_MS: out.latencyMs,
        FINISH_REASON: finish,
        INPUT_TOKENS: usage.prompt_tokens ?? usage.input ?? usage.apiInputTokens ?? null,
        OUTPUT_TOKENS:
          usage.completion_tokens ?? usage.output ?? usage.apiContentOutputTokens ?? null,
        REASONING_TOKENS: usage.apiReasoningOutputTokens ?? usage.reasoning_tokens ?? null,
        PROVIDER_COST: usage.cost ?? usage.usage_cost_usd ?? null,
        VISIBLE_CHARS_WITH_SPACES: visibleCharsWithSpaces(raw),
        VISIBLE_CHARS_NO_SPACES: visibleCharsNoSpaces(raw),
        KOREAN_CHARS: countHangul(raw),
        PARAGRAPH_COUNT: countParagraphs(raw),
        DIALOGUE_LINE_COUNT: countDialogue(raw),
        RAW_SHA256: sha256(raw),
        SYSTEM_SHA: rec.SYSTEM_SHA,
        HISTORY_SHA: rec.HISTORY_SHA,
        CURRENT_USER_SHA: rec.CURRENT_USER_SHA,
        flags,
        usage,
      };
      results.push(row);
      writeFileSync(
        path.join(EVIDENCE, "raw", `${fk}_${arm}.meta.json`),
        JSON.stringify(row, null, 2),
        "utf8"
      );
      if (out.httpStatus && out.httpStatus >= 500) {
        console.log(JSON.stringify({ frozen_5xx: `${fk}_${arm}`, status: out.httpStatus }));
      }
    }
  }

  const byArm = (arm: DeepSeekLengthArm) => {
    const r = results.find((x) => x.KEY === `R_${arm}`) as { VISIBLE_CHARS_WITH_SPACES?: number } | undefined;
    const a = results.find((x) => x.KEY === `A_${arm}`) as { VISIBLE_CHARS_WITH_SPACES?: number } | undefined;
    const rc = r?.VISIBLE_CHARS_WITH_SPACES ?? 0;
    const ac = a?.VISIBLE_CHARS_WITH_SPACES ?? 0;
    return {
      R_CHARS: rc,
      A_CHARS: ac,
      GE_2700: Number(rc >= 2700) + Number(ac >= 2700),
      GE_3200: Number(rc >= 3200) + Number(ac >= 3200),
    };
  };
  const lengthReport = {
    ARM_A: byArm("A"),
    ARM_B: byArm("B"),
    ARM_C: byArm("C"),
    PROVIDER_CALLS: providerCalls,
    RETRIES: 0,
    CONTINUATION_CALLS: 0,
    QUALITY_SCORE_ASSIGNED: false,
    MODEL_WINNER_SELECTED: false,
  };
  writeFileSync(
    path.join(EVIDENCE, "LENGTH_REPORT.json"),
    JSON.stringify({ lengthReport, results }, null, 2),
    "utf8"
  );
  console.log(JSON.stringify({ phase: "done", lengthReport }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
