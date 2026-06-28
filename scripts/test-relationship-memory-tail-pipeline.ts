/**
 * Simulates 10-turn pipelines for relationship memory tail (no live LLM).
 * Usage: npx tsx scripts/test-relationship-memory-tail-pipeline.ts
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
require.cache[require.resolve("server-only")] = {
  exports: {},
  loaded: true,
  id: "server-only",
  filename: "server-only",
} as NodeModule;

async function main() {
  const { splitAndNormalizeRelationshipMemoryTail } = await import(
    "../src/lib/relationshipMemoryTail"
  );
  const { mergeMemoryMeta, normalizeMemoryMeta, parseMemoryMeta } = await import(
    "../src/lib/chatMemory"
  );
  const { isMainModelRelationshipSelfExtractModel } = await import(
    "../src/lib/relationshipMemoryTailPrompt"
  );
  const {
    OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    OPENROUTER_QWEN_37_MAX_MODEL,
    OPENROUTER_GEMINI_25_PRO_MODEL,
  } = await import("../src/lib/chatModels");

  const names = { charName: "백하율", userName: "렌" };
  let meta = parseMemoryMeta("{}");

  const turns = [
    { user: "오늘 밤산책 갈래?", assistant: "…같이 가시죠.", thoughts: ["백하율: 왜 이렇게 떨리지"] },
    { user: "무서워", assistant: "손을 잡았다.", thoughts: ["백하율: 숨기면 안 되는데"] },
    { user: "약속해", assistant: "…약속할게요.", promisesAdd: [{ text: "무사히 지내기" }] },
    { user: "고마워", assistant: "고개를 끄덕였다.", thoughts: [] },
    { user: "a", assistant: "b", thoughts: [] },
    { user: "c", assistant: "d", thoughts: [] },
    { user: "e", assistant: "f", thoughts: [] },
    { user: "g", assistant: "h", thoughts: [] },
    { user: "i", assistant: "j", thoughts: [] },
    { user: "k", assistant: "l", thoughts: [] },
  ];

  const models = [
    { id: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, label: "DeepSeek" },
    { id: OPENROUTER_QWEN_37_MAX_MODEL, label: "Qwen" },
    { id: OPENROUTER_GEMINI_25_PRO_MODEL, label: "Gemini 2.5" },
  ];

  console.log("=== Relationship memory tail pipeline simulation ===\n");

  for (const { id, label } of models) {
    const selfExtract = isMainModelRelationshipSelfExtractModel(id);
    console.log(`--- ${label} (${id}) self-extract=${selfExtract} ---`);
    meta = parseMemoryMeta("{}");
    let strippedOk = 0;
    let mergedOk = 0;

    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const tail = JSON.stringify({
        honorifics: [],
        items: [],
        thoughts: t.thoughts,
        promisesAdd: t.promisesAdd ?? [],
        promisesRemove: [],
      });
      const assistantWithTail = `${t.assistant}\n${tail}`;
      if (!selfExtract) {
        console.log(`  turn ${i + 1}: Flash path (no tail strip in sim)`);
        continue;
      }
      const split = splitAndNormalizeRelationshipMemoryTail(
        assistantWithTail,
        `${t.user}\n${t.assistant}`,
        names
      );
      if (split.parseOk && !split.prose.includes("{")) strippedOk++;
      if (split.parseOk) {
        meta = mergeMemoryMeta(normalizeMemoryMeta(meta, names), split.delta, names);
        mergedOk++;
      }
    }

    if (selfExtract) {
      console.log(`  stripped JSON from visible: ${strippedOk}/10`);
      console.log(`  merged deltas: ${mergedOk}/10`);
      console.log(`  final thoughts count: ${meta.thoughts.length}`);
      console.log(`  final promises count: ${meta.promises.length}`);
    }
    console.log("");
  }

  // Malformed fallback case
  const bad = splitAndNormalizeRelationshipMemoryTail(
    "RP 본문\n{broken",
    "user\nRP",
    names
  );
  console.log("Malformed tail parseOk:", bad.parseOk, "(expect false → Flash fallback in route)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
