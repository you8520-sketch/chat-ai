/**
 * Offline assembled-prompt audit after discarding the #432 SYSTEM length owner.
 * No API calls.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/gemini-37-flash-vanilla-length-restore-audit.ts
 */
import Module from "node:module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "../src/lib/chatModels";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import { buildContext } from "../src/services/contextBuilder";

const DOCS = "docs/audits/gemini-37-flash-length-system-owner";
const REJECTED_SYSTEM_TITLE = "[RESPONSE LENGTH — GEMINI 3.7 FLASH]";
const REJECTED_B =
  "현재 장면을 충분히 전개하여 한국어 공백 포함 약 3,200~4,000자 분량으로 완성한다. 짧게 마무리하거나 요약하지 않는다.";
const REJECTED_C = "약 3,200~4,000자 분량으로 완성한다";

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = hay.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return typeof (part as { text?: unknown }).text === "string"
            ? String((part as { text: string }).text)
            : "";
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

function assemble(modelId: string) {
  const built = buildContext({
    charName: "조태형",
    chunks: [],
    userNickname: "렌",
    shortTermHistory: [{ role: "assistant", content: "어? 신입이야?" }],
    currentUserMessage: "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
    nsfw: false,
    provider: "cheaperinference",
    modelId,
    targetResponseChars: 3200,
  });
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt ?? "",
    history: built.history,
    modelId,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: "조태형",
    },
  });
  const messages = assembled.requestBody.messages as Array<{
    role?: string;
    content?: unknown;
  }>;
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => flattenContent(m.content))
    .join("\n");
  const lastUser = flattenContent(
    [...messages].reverse().find((m) => m.role === "user")?.content
  );
  return {
    system,
    lastUser,
    systemChars: system.length,
    lastUserChars: lastUser.length,
    max_tokens: (assembled.requestBody as { max_tokens?: unknown }).max_tokens ?? null,
    reasoning_effort:
      (assembled.requestBody as { reasoning_effort?: unknown }).reasoning_effort ?? null,
    temperature: (assembled.requestBody as { temperature?: unknown }).temperature ?? null,
  };
}

function audit(label: string, assembled: ReturnType<typeof assemble>) {
  const ownerIdx = assembled.lastUser.lastIndexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
  return {
    label,
    system_model_specific_length_prompt: countOccurrences(
      assembled.system,
      REJECTED_SYSTEM_TITLE
    ),
    rejected_b_sentence: countOccurrences(assembled.system, REJECTED_B) +
      countOccurrences(assembled.lastUser, REJECTED_B),
    rejected_c_sentence: countOccurrences(assembled.system, REJECTED_C) +
      countOccurrences(assembled.lastUser, REJECTED_C),
    generic_user_tail_length_owner: countOccurrences(
      assembled.lastUser,
      USER_TAIL_LENGTH_OWNER_SENTENCE
    ),
    user_tail_is_absolute_end: assembled.lastUser.trimEnd().endsWith(
      USER_TAIL_LENGTH_OWNER_SENTENCE
    ),
    layout_before_length:
      assembled.lastUser.indexOf("지문과") >= 0 &&
      assembled.lastUser.indexOf("지문과") < ownerIdx,
    system_has_user_tail_sentence: countOccurrences(
      assembled.system,
      USER_TAIL_LENGTH_OWNER_SENTENCE
    ),
    system_chars: assembled.systemChars,
    last_user_chars: assembled.lastUserChars,
    max_tokens: assembled.max_tokens,
    reasoning_effort: assembled.reasoning_effort,
    temperature: assembled.temperature,
  };
}

const gemini37 = assemble(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
const deepseek = assemble(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
const geminiAudit = audit("gemini-3.7-flash", gemini37);
const deepseekAudit = audit("deepseek-v4-pro", deepseek);

const geminiTail = gemini37.lastUser.slice(
  gemini37.lastUser.lastIndexOf(USER_TAIL_LENGTH_OWNER_SENTENCE)
);
const deepseekTail = deepseek.lastUser.slice(
  deepseek.lastUser.lastIndexOf(USER_TAIL_LENGTH_OWNER_SENTENCE)
);

const report = {
  SOURCE_API_CALLS: 0,
  GEMINI37_LENGTH_OWNER_COUNT: geminiAudit.generic_user_tail_length_owner,
  location: geminiAudit.user_tail_is_absolute_end ? "user_tail" : "unknown",
  gemini37: geminiAudit,
  deepseek_control: deepseekAudit,
  user_tail_sentence_identical: geminiTail === deepseekTail,
  user_tail_sentence: USER_TAIL_LENGTH_OWNER_SENTENCE,
  VANILLA_RESTORE_PASS:
    geminiAudit.system_model_specific_length_prompt === 0 &&
    geminiAudit.rejected_b_sentence === 0 &&
    geminiAudit.rejected_c_sentence === 0 &&
    geminiAudit.generic_user_tail_length_owner === 1 &&
    geminiAudit.user_tail_is_absolute_end &&
    geminiAudit.layout_before_length &&
    geminiAudit.system_has_user_tail_sentence === 0 &&
    geminiTail === deepseekTail,
};

mkdirSync(DOCS, { recursive: true });
writeFileSync(
  join(DOCS, "VANILLA_RESTORE_ASSEMBLED_AUDIT.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report, null, 2));
if (!report.VANILLA_RESTORE_PASS) process.exitCode = 2;
