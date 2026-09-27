/**
 * Main RP prose diet — production-wire live capture for before/after comparison.
 *
 * Assembly mirrors the chat route default (legacy_v1 scene pacing, interactive,
 * third-person POV): buildContext → assemblePrimaryRpRequest(sceneServerControls).
 * Raw outputs go to /opt/cursor/artifacts only; nothing here is committed output.
 *
 * Requires CHEAPER_INFERENCE_BENCHMARK_API_KEY (never the production key).
 *
 *   LABEL=before npx tsx scripts/prose-diet-live-compare.ts
 *   LABEL=after-ds-off DEEPSEEK_STYLE_REMINDER=off MODELS=deepseek-v4-pro-0813 npx tsx ...
 *
 * DEEPSEEK_STYLE_REMINDER=off is a diagnostic strip applied in this script only.
 */
import "./lib/server-only-mock";
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
} from "./lib/proseDietFixtures";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const LABEL = process.env.LABEL?.trim() || "run";
const OUT_ROOT = path.join("/opt/cursor/artifacts/prose-diet", LABEL);
const STRIP_DS_REMINDER = process.env.DEEPSEEK_STYLE_REMINDER === "off";
const REPEAT = Math.max(1, Number(process.env.REPEAT ?? 1) || 1);

function listFilter(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function write(rel: string, content: string | object) {
  const p = path.join(OUT_ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8",
  );
}

type Capture = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  error: string | null;
  status: number;
};

async function streamOnce(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Capture> {
  const out: Capture = {
    text: "",
    finish: null,
    usage: null,
    error: null,
    status: 0,
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
        if (typeof choice?.finish_reason === "string" && choice.finish_reason)
          out.finish = choice.finish_reason;
        if (ev.usage && typeof ev.usage === "object")
          out.usage = ev.usage as Record<string, unknown>;
      } catch {
        // partial frame
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
  return out;
}

async function main() {
  const apiKey =
    exitIfBenchmarkCheaperInferenceApiKeyMissing("PROSE_DIET_NOT_RUN");

  const { MAIN_RP_USER_SELECTABLE_OPTIONS, isDeepSeekMainRpFamilyModel } =
    await import("../src/lib/chatModels");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } =
    await import("../src/lib/openRouterAdult");
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } =
    await import("../src/lib/sceneDirective");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { parseCharacterSetting } =
    await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } =
    await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } =
    await import("../src/lib/chatMemory");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { visibleAssistantDisplayCharCount } =
    await import("../src/lib/chatDisplayLength");
  const { DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY } =
    await import("../src/lib/deepseekPromptStructure");

  const modelFilter = listFilter(process.env.MODELS);
  const fixtureFilter = listFilter(process.env.FIXTURES);
  const models = MAIN_RP_USER_SELECTABLE_OPTIONS.filter(
    (m) => !modelFilter.length || modelFilter.includes(m.id),
  );
  const fixtures = PROSE_DIET_FIXTURES.filter(
    (f) => !fixtureFilter.length || fixtureFilter.includes(f.id),
  );

  const longTermMemory =
    "3년 전 실종 사건 이후 서로를 더 자주 확인한다. 최근 도심 골목에서 이상한 그림자를 목격했다.";

  const assemble = (modelId: string, fx: ProseDietFixture) => {
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
      chatId: 1,
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
        characterId: "prose-diet-1",
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
      userImpersonation: false,
      novelModeEnabled: false,
      targetResponseChars: 3200,
      completedTurns: 3,
      genres: ["현대/일상"],
      provider: "openrouter",
      modelId,
      contentKind: "character",
      narrativePov,
      sceneDirectiveBlock: renderSceneDirectiveForPrompt(directive),
      scenePacingPromptOwner: "legacy_v1",
    });
    const wire = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history,
      modelId,
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
          chatId: 1,
          currentTurn: 3,
          progressionHistory: [],
          canonicalSceneDirective: directive,
          skipMotionCue: false,
        },
      },
    });
    const body = {
      ...(wire.requestBody as Record<string, unknown>),
      stream: true,
      stream_options: { include_usage: true },
    };
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const flat = (c: unknown) =>
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c
              .map((p) =>
                p && typeof p === "object" && "text" in p
                  ? String((p as { text: unknown }).text)
                  : "",
              )
              .join("")
          : "";
    let strippedReminder = false;
    if (STRIP_DS_REMINDER && isDeepSeekMainRpFamilyModel(modelId)) {
      for (const m of messages) {
        if (m.role !== "user") continue;
        const replace = (s: string) =>
          s
            .replace(`${DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY}\n\n`, "")
            .replace(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY, "");
        if (
          typeof m.content === "string" &&
          m.content.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY)
        ) {
          m.content = replace(m.content);
          strippedReminder = true;
        } else if (Array.isArray(m.content)) {
          for (const part of m.content as Array<Record<string, unknown>>) {
            if (
              typeof part.text === "string" &&
              part.text.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY)
            ) {
              part.text = replace(part.text);
              strippedReminder = true;
            }
          }
        }
      }
    }
    const system = flat(messages.find((m) => m.role === "system")?.content);
    const lastUser = flat(
      [...messages].reverse().find((m) => m.role === "user")?.content,
    );
    return { body, system, lastUser, strippedReminder };
  };

  const index: Record<string, unknown>[] = [];
  for (const model of models) {
    for (const fx of fixtures) {
      for (let rep = 1; rep <= REPEAT; rep++) {
        const dir =
          REPEAT > 1 ? `${fx.id}/${model.id}/r${rep}` : `${fx.id}/${model.id}`;
        const a = assemble(model.id, fx);
        write(`${dir}/wire-system.txt`, a.system);
        write(`${dir}/wire-last-user.txt`, a.lastUser);
        console.log(`[${LABEL}] ${model.id} / ${fx.id} / r${rep}`);
        let cap = await streamOnce(
          CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
          buildCheaperInferenceHeaders(apiKey),
          a.body,
        );
        if (!cap.text.trim() && !cap.error) {
          console.log("  empty stream — retry once");
          cap = await streamOnce(
            CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
            buildCheaperInferenceHeaders(apiKey),
            a.body,
          );
        }
        const row = {
          label: LABEL,
          modelId: model.id,
          fixtureId: fx.id,
          rep,
          status: cap.status,
          finish: cap.finish,
          error: cap.error,
          visibleChars: visibleAssistantDisplayCharCount(cap.text),
          rawChars: cap.text.length,
          providerPromptTokens:
            typeof cap.usage?.prompt_tokens === "number"
              ? cap.usage.prompt_tokens
              : null,
          completionTokens:
            typeof cap.usage?.completion_tokens === "number"
              ? cap.usage.completion_tokens
              : null,
          wireSystemTokensEst: estimateTokens(a.system),
          wireLastUserTokensEst: estimateTokens(a.lastUser),
          deepSeekReminderStripped: a.strippedReminder,
        };
        write(`${dir}/raw.txt`, cap.text);
        write(`${dir}/meta.json`, { ...row, usage: cap.usage });
        index.push(row);
        console.log(
          `  visible=${row.visibleChars} finish=${row.finish} prompt=${row.providerPromptTokens} err=${row.error ? "YES" : "no"}`,
        );
      }
    }
  }
  write("INDEX.json", index);
  console.log(`wrote ${OUT_ROOT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
