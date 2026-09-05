import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import {
  COMIC_REFERENCE_ISOLATION_MODES,
  COMIC_NEUTRAL_TEMPLATE_CONTROL_URL,
  COMIC_NEUTRAL_IDENTITY_CONTROL_URL,
  buildComicProviderReferences,
  buildNeutralComicProviderScenePlan,
  buildNeutralComicSafeStructure,
  formatComicReferenceSetForAdmin,
  isolateComicProviderReferences,
  prepareComicProviderReferenceInput,
  resolveComicDiagnosticOverrides,
  type ComicReferenceIsolationMode,
} from "./chatComicReferenceIsolation";
import { buildChatComicGenerationPlan, buildChatComicImagePrompt } from "./chatComicGeneration";
import { buildStrictComicFallbackPrompt } from "./chatImageStrictSafetyFallbackPrompt";
import { CHAT_COMIC_TEMPLATE_ID, CHAT_COMIC_TEMPLATE_PREVIEW_URL, resolveChatComicOutputSize } from "./chatComicGenerationConstants";
import { hashPromptForDiagnostic } from "./openAiImageFailureDiagnostic";
import { callOpenAiImageEditWithSafetyFallback, OpenAiImageGenerationError } from "./openAiImageSafetyFallback";
import { formatComicGenerationAdminFailureDiagnostic } from "./chatComicTier2SafetyAudit";
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
const neutralSlots: Record<ComicReferenceIsolationMode, number[]> = {
  normal: [], neutral_template: [1], neutral_character: [2],
  neutral_persona: [3], neutral_identity_refs: [2, 3], all_neutral: [1, 2, 3],
};

test("REF-CONTROL-1..6 / PROMPT-BIND primary + Tier-2: compare actual multipart requests across all modes", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "offline-reference-test";
  type RequestSnapshot = { fields: Record<string, string>; images: Buffer[]; names: string[] };
  let captured: RequestSnapshot[] = [];
  let baseline: RequestSnapshot[] | undefined;
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
      [COMIC_NEUTRAL_TEMPLATE_CONTROL_URL, readFileSync(`public${COMIC_NEUTRAL_TEMPLATE_CONTROL_URL}`)],
      [COMIC_NEUTRAL_IDENTITY_CONTROL_URL, readFileSync(`public${COMIC_NEUTRAL_IDENTITY_CONTROL_URL}`)],
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
    for (const mode of COMIC_REFERENCE_ISOLATION_MODES) {
      captured = [];
      const pack = buildChatComicGenerationPlan(packOptions);
      const before = structuredClone(pack);
      const refs = buildComicProviderReferences({ referenceUrls: pack.referenceUrls, subjects: pack.subjects });
      const originalRefs = structuredClone(refs);
      const selected = isolateComicProviderReferences(refs, mode);
      const input = await prepareComicProviderReferenceInput({
        primaryPrompt: pack.prompt,
        strictFallbackPrompt: buildStrictComicFallbackPrompt({
          panelCount: 2, characterName: "Character", characterGender: "male",
          personaName: "Persona", personaGender: "male", subjects: pack.subjects,
          safeStructure: buildNeutralComicSafeStructure([1, 2]),
        }),
        references: selected,
        normalizeReference: async (url) => { assert.ok(normalized.has(url)); return normalized.get(url)!; },
      });
      assert.deepEqual(refs, originalRefs);
      assert.deepEqual(pack, before);
      assert.deepEqual(selected.map(({ index, role }) => ({ index, role })), [
        { index: 1, role: "template" }, { index: 2, role: "chat_character" }, { index: 3, role: "user_persona" },
      ]);
      for (const ref of selected) {
        if (!neutralSlots[mode].includes(ref.index)) assert.deepEqual(ref, refs[ref.index - 1]);
      }
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
      baseline ??= structuredClone(captured).map((request) => ({ ...request, images: request.images.map((bytes) => Buffer.from(bytes)) }));
      for (const [attemptIndex, request] of captured.entries()) {
        const control = baseline[attemptIndex];
        assert.deepEqual(request.fields, control.fields, `${mode}: only reference content may change`);
        assert.equal(hashPromptForDiagnostic(request.fields.prompt), hashPromptForDiagnostic(control.fields.prompt));
        assert.match(request.fields.prompt, /Reference image 1 is LAYOUT AND FINISH ONLY/);
        assert.match(request.fields.prompt, /Image 2/);
        assert.match(request.fields.prompt, /Image 3/);
        assert.deepEqual(request.names, ["reference-1.webp", "reference-2.webp", "reference-3.webp"]);
        assert.equal(request.images.length, 3);
        for (const [slot, bytes] of request.images.entries()) {
          const shouldChange = neutralSlots[mode].includes(slot + 1);
          assert.equal(bytes.equals(control.images[slot]), !shouldChange, `${mode}: slot ${slot + 1}`);
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
      assert.ok(json.includes(formatComicReferenceSetForAdmin(selected).referenceSetSignature));
      for (const source of [...inputBytes.keys(), input.primaryPrompt, input.strictFallbackPrompt]) assert.ok(!json.includes(source));
      for (const ref of input.references) assert.ok(!json.includes(ref.dataUrl.split(",")[1]));
      assert.doesNotMatch(json, /sourceUrl|dataUrl|subjectId|base64|\[Object\]|PRIVATE_PROMPT_ECHO|private\.example|U0VDUkVUX0JZVEVT/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("REF-CONTROL-7: neutral assets are geometry only and non-human, and decode through Sharp", async () => {
  const template = readFileSync(`public${COMIC_NEUTRAL_TEMPLATE_CONTROL_URL}`, "utf8");
  const identity = readFileSync(`public${COMIC_NEUTRAL_IDENTITY_CONTROL_URL}`, "utf8");
  for (const svg of [template, identity]) {
    const tags = [...svg.matchAll(/<\/?([\w:-]+)/g)].map((match) => match[1]);
    assert.ok(tags.every((tag) => ["svg", "g", "rect"].includes(tag)));
    assert.doesNotMatch(svg, /<(?:text|image|script)|href|data:|base64/i);
    assert.ok((await sharp(Buffer.from(svg)).webp().toBuffer()).length > 0);
  }
  assert.equal((template.match(/<rect/g) ?? []).length, 5);
  assert.equal((identity.match(/<rect/g) ?? []).length, 1);
  const pixels = await sharp(Buffer.from(identity)).raw().toBuffer({ resolveWithObject: true });
  const first = pixels.data.subarray(0, pixels.info.channels);
  for (let offset = 0; offset < pixels.data.length; offset += pixels.info.channels) {
    assert.deepEqual(pixels.data.subarray(offset, offset + pixels.info.channels), first);
  }
});

test("REF-CONTROL-8 / ACCESS: every diagnostic mode is admin-only, removal modes and combined axes reject", () => {
  assert.deepEqual(resolveComicDiagnosticOverrides({ canSeeCost: false }), { referenceMode: "normal", visualContextMode: "normal" });
  for (const mode of COMIC_REFERENCE_ISOLATION_MODES.filter((value) => value !== "normal")) {
    assert.throws(() => resolveComicDiagnosticOverrides({ canSeeCost: false, referenceMode: mode }), /FORBIDDEN/);
    assert.throws(() => resolveComicDiagnosticOverrides({ canSeeCost: true, referenceMode: mode, visualContextMode: "neutral_visual_context" }), /AXES_MUST_BE_ISOLATED/);
    assert.equal(resolveComicDiagnosticOverrides({ canSeeCost: true, referenceMode: mode }).referenceMode, mode);
  }
  assert.throws(() => resolveComicDiagnosticOverrides({ canSeeCost: false, visualContextMode: "neutral_visual_context" }), /FORBIDDEN/);
  for (const mode of ["without_template", "without_character", "without_persona", "template_only", "identity_refs_only", [], {}, 1]) {
    assert.throws(() => resolveComicDiagnosticOverrides({ canSeeCost: true, referenceMode: mode }), /INVALID/);
  }
});

test("neutral_visual_context immutability: original overlay/persistence plan and cast/reference binding survive", () => {
  const original = { ...structuredClone(plan), sceneBackground: "private bedroom", atmosphere: "PRIVATE_TEXT",
    heroScene: "PRIVATE_TEXT", panels: plan.panels.map((panel) => ({ ...panel, situation: "PRIVATE_TEXT" })) };
  const before = structuredClone(original);
  const projected = buildNeutralComicProviderScenePlan(original);
  const realPack = buildChatComicGenerationPlan({ ...packOptions, plan: original });
  const neutralPack = buildChatComicGenerationPlan({ ...packOptions, plan: projected });
  assert.deepEqual(original, before);
  assert.deepEqual(realPack.subjects, neutralPack.subjects);
  assert.deepEqual(realPack.referenceUrls, neutralPack.referenceUrls);
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_TEXT|private bedroom/);
  assert.notEqual(realPack.prompt, neutralPack.prompt);
});

test("route binds tested provider input after access gate and preserves the provider-output final owner", () => {
  const route = readFileSync("src/app/api/chat/comic-generation/route.ts", "utf8");
  assert.ok(route.indexOf("resolveComicDiagnosticOverrides({") < route.indexOf("const context = resolveGenerationContext({"));
  assert.match(route, /canSeeCost,\s+referenceMode: body\.comicReferenceIsolationMode/);
  assert.match(route, /prepareComicProviderReferenceInput\(\{\s+primaryPrompt: prompt,\s+strictFallbackPrompt,\s+references: providerReferences,\s+normalizeReference: imageSourceToDataUrl/);
  assert.match(route, /prompt: providerInput\.primaryPrompt,\s+strictFallbackPrompt: providerInput\.strictFallbackPrompt,\s+references: providerInput\.references/);
  assert.match(route, /references: opts\.references\.map\(\(reference\) => reference\.dataUrl\)/);
  assert.match(route, /console\.error\("\[chat-comic-generation\] failed", JSON\.stringify\(/);
  assert.match(route, /referenceIsolationMode: diagnosticOverrides\.referenceMode/);
  assert.match(route, /assembleComicFinalImage\(\{ providerBuffer: generated\.buffer \}\)/);
  assert.doesNotMatch(route, /renderComicTextOverlay\(/);
  assert.doesNotMatch(route, /renderComicBlankBalloonHybrid\(/);
  assert.match(
    route,
    /diagnosticMode\.mode === "normal" \|\| diagnosticMode\.mode === "blank_balloon_hybrid"\s*\n\s+\? \{ plan: scenePlan \}/
  );
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
