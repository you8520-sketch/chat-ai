import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import {
  buildComicProviderReferences,
  formatComicReferenceSetForAdmin,
  prepareComicProviderReferenceInput,
} from "./chatComicReferenceIsolation";
import { buildChatComicGenerationPlan, buildChatComicImagePrompt } from "./chatComicGeneration";
import { buildStrictComicFallbackPrompt } from "./chatImageStrictSafetyFallbackPrompt";
import { CHAT_COMIC_TEMPLATE_ID, CHAT_COMIC_TEMPLATE_PREVIEW_URL, resolveChatComicOutputSize } from "./chatComicGenerationConstants";
import { hashPromptForDiagnostic } from "./openAiImageFailureDiagnostic";
import { callOpenAiImageEditWithSafetyFallback, OpenAiImageGenerationError } from "./openAiImageSafetyFallback";
import { formatComicGenerationAdminFailureDiagnostic } from "./chatComicTier2SafetyAudit";
import { projectComicSafeStructureForTier2 } from "./chatComicSafeStructure";
import type { ScenePlan } from "./chatImageScenePlan";

const plan: ScenePlan = {
  sceneBackground: "ordinary indoor room", atmosphere: "calm",
  events: [], heroEventIds: [], heroScene: "two adults talking",
  recommendedPanelCount: 2,
  panels: [1, 2].map((index) => ({
    index, sourceEventIds: [], situation: "two adults talking", dialogue: [],
  })),
};
const packOptions = {
  characterName: "Character", characterGender: "male", characterImageUrl: "/character.webp",
  characterSavedAppearance: "", characterAppearanceMode: "image_only" as const,
  personaName: "Persona", personaGender: "male", personaImageUrl: "/persona.webp",
  personaSavedAppearance: "", personaAppearanceMode: "image_only" as const,
  plan,
};

test("REF-BIND / PROMPT-BIND primary + Tier-2: actual multipart request preserves template and identity slots", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "offline-reference-test";
  type RequestSnapshot = { fields: Record<string, string>; images: Buffer[]; names: string[] };
  let captured: RequestSnapshot[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = init?.body;
    assert.ok(body instanceof FormData);
    const fields: Record<string, string> = {};
    const images: Buffer[] = [];
    const names: string[] = [];
    for (const [key, value] of body.entries()) {
      if (typeof value === "string") fields[key] = value;
      else {
        assert.equal(key, "image[]");
        assert.equal(value.type, "image/webp");
        images.push(Buffer.from(await value.arrayBuffer()));
        names.push(value.name);
      }
    }
    captured.push({ fields, images, names });
    return new Response(JSON.stringify({ error: {
      message: "rejected by the safety system safety_violations=[sexual] PRIVATE_PROMPT_ECHO https://private.example/reference.png data:image/webp;base64,U0VDUkVUX0JZVEVT",
      code: "moderation_blocked", moderation_stage: "input",
    } }), { status: 400, headers: { "x-request-id": `req-${captured.length}` } });
  };
  try {
    const inputBytes = new Map<string, Buffer>([
      [CHAT_COMIC_TEMPLATE_PREVIEW_URL, readFileSync(`public${CHAT_COMIC_TEMPLATE_PREVIEW_URL}`)],
      ["/character.webp", await sharp({ create: { width: 32, height: 32, channels: 3, background: "#336699" } }).webp().toBuffer()],
      ["/persona.webp", await sharp({ create: { width: 32, height: 32, channels: 3, background: "#993366" } }).webp().toBuffer()],
    ]);
    // Match the unchanged route's Sharp normalization, using local fixtures only.
    const normalized = new Map<string, string>();
    for (const [url, bytes] of inputBytes) {
      const webp = await sharp(bytes, { failOn: "none", animated: false }).rotate()
        .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 86, effort: 4 }).toBuffer();
      normalized.set(url, `data:image/webp;base64,${webp.toString("base64")}`);
    }
    captured = [];
    const pack = buildChatComicGenerationPlan(packOptions);
    const before = structuredClone(pack);
    const refs = buildComicProviderReferences({ referenceUrls: pack.referenceUrls, subjects: pack.subjects });
    const originalRefs = structuredClone(refs);
    const input = await prepareComicProviderReferenceInput({
      primaryPrompt: pack.prompt,
      strictFallbackPrompt: buildStrictComicFallbackPrompt({
        panelCount: 2, characterName: "Character", characterGender: "male",
        personaName: "Persona", personaGender: "male", subjects: pack.subjects,
        safeStructure: projectComicSafeStructureForTier2(plan, { personaVisible: true }),
      }),
      references: refs,
      normalizeReference: async (url) => { assert.ok(normalized.has(url)); return normalized.get(url)!; },
    });
    assert.deepEqual(refs, originalRefs);
    assert.deepEqual(pack, before);
    assert.deepEqual(refs.map(({ index, role }) => ({ index, role })), [
      { index: 1, role: "template" }, { index: 2, role: "chat_character" }, { index: 3, role: "user_persona" },
    ]);
    assert.ok(refs.every((ref) => ref.content === "real"));
    let failure: OpenAiImageGenerationError | undefined;
    try {
      await callOpenAiImageEditWithSafetyFallback({
        ...input, references: input.references.map((ref) => ref.dataUrl),
        model: "gpt-image-2", size: resolveChatComicOutputSize(2), quality: "medium",
        outputCompression: 84, templateId: CHAT_COMIC_TEMPLATE_ID, mode: "comic",
      });
      assert.fail("two rejections must remain a failure");
    } catch (error) {
      assert.ok(error instanceof OpenAiImageGenerationError);
      failure = error;
    }
    assert.equal(captured.length, 2, "MAX_PROVIDER_ATTEMPTS = 2");
    for (const [attemptIndex, request] of captured.entries()) {
      assert.match(request.fields.prompt, /Reference image 1 is LAYOUT AND FINISH ONLY/);
      assert.match(request.fields.prompt, /Image 2/);
      assert.match(request.fields.prompt, /Image 3/);
      assert.deepEqual(request.names, ["reference-1.webp", "reference-2.webp", "reference-3.webp"]);
      assert.equal(request.images.length, 3);
      for (const [slot, bytes] of request.images.entries()) {
        assert.deepEqual(bytes, captured[0].images[slot], "fallback reuses identical selected bytes");
      }
      assert.equal(failure!.providerAttempts[attemptIndex].promptHash, hashPromptForDiagnostic(request.fields.prompt));
    }
    const diagnostic = formatComicGenerationAdminFailureDiagnostic({
      providerAttempts: failure!.providerAttempts, imageFailureDiagnostic: failure!.diagnostic,
      providerReferences: input.references,
    });
    const attempts = diagnostic.providerAttemptDiagnostic as Record<string, unknown>;
    assert.equal(attempts.safetyFallbackInvoked, true);
    assert.equal(attempts.safetyFallbackUsed, false);
    const json = JSON.stringify(diagnostic);
    assert.match(json, /"attempt":1/);
    assert.match(json, /"attempt":2/);
    assert.match(json, /req-1/);
    assert.match(json, /req-2/);
    assert.match(json, /"usageReturned":false/);
    assert.match(json, /"moderationStage":"input"/);
    assert.ok(json.includes(formatComicReferenceSetForAdmin(refs).referenceSetSignature));
    for (const source of [...inputBytes.keys(), input.primaryPrompt, input.strictFallbackPrompt]) assert.ok(!json.includes(source));
    for (const ref of input.references) assert.ok(!json.includes(ref.dataUrl.split(",")[1]));
    assert.doesNotMatch(json, /sourceUrl|dataUrl|subjectId|base64|\[Object\]|PRIVATE_PROMPT_ECHO|private\.example|U0VDUkVUX0JZVEVT/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("route binds tested provider input after access gate and preserves the provider-output final owner", () => {
  const route = readFileSync("src/app/api/chat/comic-generation/route.ts", "utf8");
  assert.match(route, /prepareComicProviderReferenceInput\(\{\s+primaryPrompt: prompt,\s+strictFallbackPrompt,\s+references: providerReferences,\s+normalizeReference: imageSourceToDataUrl/);
  assert.match(route, /prompt: providerInput\.primaryPrompt,\s+strictFallbackPrompt: providerInput\.strictFallbackPrompt,\s+references: providerInput\.references/);
  assert.match(route, /references: opts\.references\.map\(\(reference\) => reference\.dataUrl\)/);
  assert.match(route, /console\.error\("\[chat-comic-generation\] failed", JSON\.stringify\(/);
  assert.match(route, /assembleComicFinalImage\(\{ providerBuffer: generated\.buffer \}\)/);
  assert.doesNotMatch(route, /renderComicTextOverlay\(/);
  assert.doesNotMatch(route, /renderComicBlankBalloonHybrid\(/);
  assert.match(route, /plan: scenePlan/);
  assert.doesNotMatch(route, /serverTextOnlyOverlay/);
});

test("PREFLIGHT-1 normal full-provider route no longer calls the overlay preflight gate", () => {
  const route = readFileSync("src/app/api/chat/comic-generation/route.ts", "utf8");
  assert.doesNotMatch(route, /validateComicOverlayPreflight/);
  assert.doesNotMatch(route, /OVERLAY_PREFLIGHT_USER_MESSAGE/);
  assert.doesNotMatch(route, /parseChatComicOutputDimensions/);
});

test("PREFLIGHT-2 a dialogue-dense plan that fails old overlay geometry still builds a full-provider prompt", () => {
  const plan = {
    sceneBackground: "",
    events: [],
    heroEventIds: [],
    heroScene: "",
    recommendedPanelCount: 2 as const,
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "",
        dialogue: Array.from({ length: 6 }, (_, i) => ({
          speaker: "character" as const,
          text: `대사 ${i + 1} 입니다.`,
          provenance: "user_edit" as const,
        })),
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "",
        dialogue: [],
      },
    ],
  };
  const prompt = buildChatComicImagePrompt({
    characterName: "A",
    characterGender: "female",
    personaName: "B",
    personaGender: "male",
    plan,
  });
  // Old overlay preflight capped user_edit lines per panel at 4; the
  // full-provider path must not gate on that geometry.
  assert.match(prompt, /RENDER THE COMPLETE MANHWA PAGE WITH READABLE KOREAN TEXT/);
  for (let i = 1; i <= 6; i += 1) {
    assert.ok(prompt.includes(`대사 ${i} 입니다.`), `dialogue ${i} present in full-provider prompt`);
  }
});
