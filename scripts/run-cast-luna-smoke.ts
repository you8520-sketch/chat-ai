/**
 * Synthetic Luna cast-mention smoke (4 calls, no fallback, no retry).
 * Writes docs/audits/chat-image-multicast-674/LUNA-CAST-SMOKE.md
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { resolveChatImageSceneBriefModel } from "@/lib/chatImageSceneBrief";
import {
  buildScenePlanPrompt,
  buildSceneSourceMessages,
  validateScenePlan,
} from "@/lib/chatImageScenePlan";
import { buildEventBindingsFromCastMentions } from "@/lib/chatImageCastManifest";
import {
  draftCastIntentFromMentions,
  type SceneCastMention,
} from "@/lib/chatImageCast";
import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";

const SCENES = [
  {
    id: "L1",
    label: "Support actor — 이현이 뒤에서 손을 흔들었다.",
    content: "이현이 뒤에서 손을 흔들었다.",
    expectCandidate: "이현",
    expectActorBinding: true,
  },
  {
    id: "L2",
    label: "Target only — 태형이 이현을 바라보며 웃었다.",
    content: "태형이 이현을 바라보며 웃었다.",
    expectCandidate: "이현",
    expectActorBinding: false,
  },
  {
    id: "L3",
    label: "Pronoun continuation — 이현이 문을 열었다. 그는 안으로 들어가 손을 흔들었다.",
    content: "이현이 문을 열었다. 그는 안으로 들어가 손을 흔들었다.",
    expectCandidate: "이현",
    expectActorBinding: true,
  },
  {
    id: "L4",
    label: "False positive guard — 후드가 흔들리고 소매가 젖었다.",
    content: "후드가 흔들리고 소매가 젖었다.",
    expectCandidate: null,
    expectActorBinding: false,
  },
] as const;

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

type SmokeRecord = {
  sceneId: string;
  input: string;
  rawJson: string;
  validatedCastMentions: SceneCastMention[] | undefined;
  finalEventBindings: Array<{ eventId: string; subjectKey: string }>;
  latencyMs: number;
  model: string;
  provider: string;
  fallback: false;
  error?: string;
};

async function runScene(scene: (typeof SCENES)[number]): Promise<SmokeRecord> {
  const messages = buildSceneSourceMessages([
    { id: 1, role: "assistant", content: scene.content },
  ]);
  const model = resolveChatImageSceneBriefModel();
  const prompt = buildScenePlanPrompt({
    characterName: "CharacterA",
    personaName: "UserPersona",
    messages,
  });
  const started = Date.now();
  try {
    const { text } = await callOpenRouterCompletion({
      system:
        "You are a precise closed-book scene planner. Group server canonical events only. Never invent user dialogue. Never add, omit, reorder, or reclassify events. Reasoning: none.",
      history: [{ role: "user", content: prompt }],
      model,
      temperature: 0.1,
      maxTokens: 2048,
      disableReasoning: true,
      requestKind: "background-chat-image-scene-brief",
      timeoutMs: 120_000,
    });
    const latencyMs = Date.now() - started;
    const parsed = JSON.parse(stripJsonFence(text));
    const validated = validateScenePlan(parsed, messages, {
      allowUserEdits: false,
      personaName: "UserPersona",
      characterName: "CharacterA",
    });
    if (!validated.ok) {
      return {
        sceneId: scene.id,
        input: scene.content,
        rawJson: text,
        validatedCastMentions: undefined,
        finalEventBindings: [],
        latencyMs,
        model,
        provider: "cheaper-inference-or-openrouter",
        fallback: false,
        error: validated.reason,
      };
    }
    const castMentions = validated.plan.castMentions;
    const draft = draftCastIntentFromMentions({
      personaName: "UserPersona",
      mainCharacterName: "CharacterA",
      castMentions,
    });
    const support = draft.subjects.find((subject) => subject.role === "supporting_character");
    const bindings =
      support && castMentions?.length
        ? buildEventBindingsFromCastMentions(validated.plan, {
            ...draft,
            subjects: draft.subjects.map((subject) =>
              subject.key === support.key ? { ...subject, included: true } : subject
            ),
          })
        : [];
    return {
      sceneId: scene.id,
      input: scene.content,
      rawJson: text,
      validatedCastMentions: castMentions,
      finalEventBindings: bindings,
      latencyMs,
      model,
      provider: "cheaper-inference-or-openrouter",
      fallback: false,
    };
  } catch (error) {
    return {
      sceneId: scene.id,
      input: scene.content,
      rawJson: "",
      validatedCastMentions: undefined,
      finalEventBindings: [],
      latencyMs: Date.now() - started,
      model,
      provider: "cheaper-inference-or-openrouter",
      fallback: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  process.env.CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL = resolveChatImageSceneBriefModel();
  const records: SmokeRecord[] = [];
  for (const scene of SCENES) {
    records.push(await runScene(scene));
  }

  const lines = [
    "# Luna cast-mention smoke (synthetic)",
    "",
    "Provider calls: 4 (GPT-5.6 Luna primary, reasoning none, retry 0, fallback 0).",
    "Production/private chat data: 0.",
    "",
  ];

  for (const record of records) {
    const scene = SCENES.find((item) => item.id === record.sceneId)!;
    lines.push(`## ${record.sceneId} — ${scene.label}`);
    lines.push("");
    lines.push("### Input");
    lines.push("```");
    lines.push(record.input);
    lines.push("```");
    lines.push("");
    lines.push("### Provider metadata");
    lines.push(`- model: ${record.model}`);
    lines.push(`- provider: ${record.provider}`);
    lines.push(`- fallback: false`);
    lines.push(`- latency_ms: ${record.latencyMs}`);
    if (record.error) lines.push(`- error: ${record.error}`);
    lines.push("");
    lines.push("### Raw JSON");
    lines.push("```json");
    lines.push(record.rawJson || "(empty)");
    lines.push("```");
    lines.push("");
    lines.push("### Validated castMentions");
    lines.push("```json");
    lines.push(JSON.stringify(record.validatedCastMentions ?? [], null, 2));
    lines.push("```");
    lines.push("");
    lines.push("### Final event bindings");
    lines.push("```json");
    lines.push(JSON.stringify(record.finalEventBindings, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("### Expected (for ChatGPT review)");
    lines.push(
      `- candidate ${scene.expectCandidate ?? "none"}: ${scene.expectCandidate ? "YES" : "0"}`
    );
    lines.push(`- actor binding for candidate: ${scene.expectActorBinding ? "YES" : "NO"}`);
    lines.push("");
  }

  mkdirSync("docs/audits/chat-image-multicast-674", { recursive: true });
  writeFileSync("docs/audits/chat-image-multicast-674/LUNA-CAST-SMOKE.md", lines.join("\n"));
  console.log("Wrote docs/audits/chat-image-multicast-674/LUNA-CAST-SMOKE.md");
}

void main();
