import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { extractAppearanceRawFromSetting } from "./appearanceCompiler";
import { effectiveIsAdult } from "./adultVerification";
import {
  resolveEffectiveAdultRp,
  resolveRoomAdultModeEnabled,
} from "./chatAdultHandoff";
import { getCharacterRepresentativeImageUrl, parseAssets } from "./characterAssets";
import {
  resolveSelectableCharacterImages,
  selectCharacterImageUrl,
} from "./chatCharacterImageSelection";
import { buildChatComicGenerationPlan } from "./chatComicGeneration";
import {
  projectComicSafeStructureForTier2,
  renderTier2ComicGlobalClothingFooter,
  renderTier2PanelClothingContract,
  resolveTier2PanelClothingCoverage,
} from "./chatComicSafeStructure";
import { buildStrictComicFallbackPrompt } from "./chatImageStrictSafetyFallbackPrompt";
import {
  resolveCharacterSavedAppearance,
  resolvePersonaSavedAppearance,
  resolveRequestAppearanceModes,
} from "./chatImageVisualIdentity";
import {
  resolveScenePresentationVisibility,
  type SceneDialogue,
  type ScenePlan,
} from "./chatImageScenePlan";
import { hashPromptForDiagnostic } from "./openAiImageFailureDiagnostic";
import { parseContentKind } from "./simulationMode";
import { personaImageBaseUrl, sanitizePersonaImageUrl } from "./userPersonasClient";

const DB = "/tmp/prod-db/app.db";
const GOLDEN = {
  N1B: { hash: "6878050b4f020eb6", chars: 5977, file: "/opt/cursor/artifacts/n1-safe-affection-ladder/n1b-rebuild-1.txt" },
  N1C1: { hash: "02d0b757557a978b", chars: 5946, file: "/opt/cursor/artifacts/n1c-dialogue-ladder/n1c1-rebuild-1.txt" },
  N1C2: { hash: "bc29dd51f22dc9d9", chars: 5884, file: "/opt/cursor/artifacts/n1c-dialogue-ladder/n1c2-rebuild-1.txt" },
} as const;

function loadRealFailIdentity(db: Database.Database) {
  const job = db
    .prepare(`SELECT user_id, chat_id, character_id, persona_id FROM chat_image_generation_jobs WHERE id=113`)
    .get() as { user_id: number; chat_id: number; character_id: number; persona_id: number };
  const character = db.prepare(`SELECT * FROM characters WHERE id=?`).get(job.character_id) as any;
  const persona = db
    .prepare(`SELECT * FROM user_personas WHERE id=? AND user_id=?`)
    .get(job.persona_id, job.user_id) as any;
  const chat = db
    .prepare(`SELECT COALESCE(adult_handoff_enabled,0) AS adult_handoff_enabled FROM chats WHERE id=?`)
    .get(job.chat_id) as { adult_handoff_enabled: number };
  const user = db.prepare(`SELECT is_adult FROM users WHERE id=?`).get(job.user_id) as { is_adult: number };
  const adultGrounded = resolveEffectiveAdultRp({
    userAdultVerified: effectiveIsAdult(user.is_adult),
    roomAdultModeEnabled: resolveRoomAdultModeEnabled({
      persisted: chat.adult_handoff_enabled,
      userAdultVerified: effectiveIsAdult(user.is_adult),
    }),
  });
  const contentKind = parseContentKind(character.content_kind);
  const assistantMessages = (
    db
      .prepare(
        `SELECT m.content FROM messages m JOIN chats c ON c.id=m.chat_id WHERE c.user_id=? AND c.character_id=? AND m.role='assistant' ORDER BY m.id ASC`
      )
      .all(job.user_id, character.id) as Array<{ content: string }>
  ).map((r) => r.content);
  const characterImages = resolveSelectableCharacterImages({
    assets: parseAssets(character.assets),
    representativeUrl: getCharacterRepresentativeImageUrl(character.assets, character.images),
    isCharacterCreator: character.creator_id === job.user_id,
    assistantMessages,
    contentKind,
    poolMode: "main_character",
  });
  const characterImageUrl = selectCharacterImageUrl(characterImages, undefined) ?? "";
  const personaImageUrl = personaImageBaseUrl(sanitizePersonaImageUrl(persona.image_url));
  const genders = { characterGender: character.gender, personaGender: persona.gender };
  const charSaved = resolveCharacterSavedAppearance({
    appearanceRaw: character.appearance_raw ?? "",
    appearanceSection: extractAppearanceRawFromSetting(character.system_prompt ?? ""),
    appearanceCompiled: character.appearance_compiled ?? "",
  });
  const personaSaved = resolvePersonaSavedAppearance(persona.description);
  const appearanceModes = resolveRequestAppearanceModes({
    characterImages,
    selectedCharacterImageUrl: characterImageUrl,
    characterSavedAppearance: charSaved,
    personaSavedAppearance: personaSaved,
  });
  return {
    character,
    persona,
    adultGrounded,
    contentKind,
    characterImageUrl,
    personaImageUrl,
    genders,
    charSaved,
    personaSaved,
    appearanceModes,
  };
}

function buildTier2Prompt(
  identity: ReturnType<typeof loadRealFailIdentity>,
  scenePlan: ScenePlan,
  turnText: string
): string {
  const identityPack = buildChatComicGenerationPlan({
    characterName: identity.character.name,
    characterGender: identity.genders.characterGender,
    characterImageUrl: identity.characterImageUrl,
    characterSavedAppearance: identity.charSaved,
    characterAppearanceMode: identity.appearanceModes.characterAppearanceMode,
    personaName: identity.persona.name,
    personaGender: identity.genders.personaGender,
    personaImageUrl: identity.personaImageUrl,
    personaSavedAppearance: identity.personaSaved,
    personaAppearanceMode: identity.appearanceModes.personaAppearanceMode,
    mood: "comic",
    plan: scenePlan,
    castManifest: null,
    contentKind: identity.contentKind,
    compositionMode: "full_provider_rendered",
    adultGrounded: identity.adultGrounded,
    providerTextAdultEligible: identity.adultGrounded,
    fullSourceDirectText: turnText,
  });
  const visibility = resolveScenePresentationVisibility({
    contentKind: identity.contentKind,
    castManifest: null,
  });
  const safeStructure = projectComicSafeStructureForTier2(scenePlan, visibility, {
    adultGrounded: identity.adultGrounded,
  });
  return buildStrictComicFallbackPrompt({
    panelCount: 4,
    mood: "comic",
    characterName: identity.character.name,
    characterGender: identity.genders.characterGender,
    personaName: identity.persona.name,
    personaGender: identity.genders.personaGender,
    subjects: identityPack.subjects,
    contentKind: identity.contentKind,
    safeStructure,
    compositionMode: "full_provider_rendered",
  });
}

function n1aBase(): { scenePlan: ScenePlan; turnText: string } {
  const scenePlan: ScenePlan = {
    sceneBackground: "사적인 침실",
    atmosphere: "부드럽고 따뜻한 분위기, 은은한 조명, 따뜻한 표정과 은은한 홍조",
    events: [],
    castMentions: [],
    heroEventIds: [],
    heroScene: "침실 침대 옆에 함께 있는 두 성인",
    panels: [
      { index: 1, sourceEventIds: [], situation: "침실 침대 옆에 나란히 앉아 있다", dialogue: [] },
      { index: 2, sourceEventIds: [], situation: "침대에 기대어 편안히 쉬고 있다", dialogue: [] },
      { index: 3, sourceEventIds: [], situation: "침실에서 따뜻한 표정으로 가까이 앉아 있다", dialogue: [] },
      { index: 4, sourceEventIds: [], situation: "부드러운 이불과 함께 차분히 휴식한다", dialogue: [] },
    ],
    recommendedPanelCount: 4,
  };
  const turnText =
    "사적인 침실에서 두 성인이 침대 옆에 나란히 앉아 있다. 둘 다 옷을 충분히 입고 있으며, 따뜻하고 부드러운 분위기 속에서 가까이 앉아 있다. 은은한 조명과 부드러운 이불이 보이며, 따뜻한 표정과 은은한 홍조가 있다.";
  return { scenePlan, turnText };
}

function n1bInput() {
  const n1a = n1aBase();
  return {
    scenePlan: {
      ...n1a.scenePlan,
      panels: n1a.scenePlan.panels.map((p) =>
        p.index === 3
          ? { ...p, situation: "침실에서 따뜻한 표정으로 가까이 앉아 뺨에 짧게 키스한다" }
          : { ...p }
      ),
    },
    turnText: n1a.turnText + " 한쪽이 다른 쪽 뺨에 짧게 키스한다.",
  };
}

const N1C1_DIALOGUE: SceneDialogue = {
  speaker: "character",
  text: "좋아해.",
  provenance: "source",
};

function n1c1Input() {
  const n1b = n1bInput();
  return {
    scenePlan: {
      ...n1b.scenePlan,
      panels: n1b.scenePlan.panels.map((p) =>
        p.index === 1 ? { ...p, dialogue: [N1C1_DIALOGUE] } : { ...p }
      ),
    },
    turnText: n1b.turnText,
  };
}

function n1c2Input() {
  const n1c1 = n1c1Input();
  return {
    scenePlan: {
      ...n1c1.scenePlan,
      panels: n1c1.scenePlan.panels.map((p) => {
        if (p.index === 2) return { ...p, dialogue: [{ speaker: "persona" as const, text: "나도.", provenance: "source" as const }] };
        if (p.index === 4) return { ...p, dialogue: [{ speaker: "persona" as const, text: "…고마워.", provenance: "source" as const }] };
        return { ...p };
      }),
    },
    turnText: n1c1.turnText,
  };
}

function n2aInput() {
  const n1c2 = n1c2Input();
  return {
    scenePlan: {
      ...n1c2.scenePlan,
      panels: n1c2.scenePlan.panels.map((p) =>
        p.index === 1
          ? { ...p, clothingCoverage: "adult_male_character_shirtless_upper_torso" as const }
          : { ...p }
      ),
    },
    turnText: n1c2.turnText,
  };
}

function panelLine(prompt: string, panel: number): string {
  const re = new RegExp(
    `Panel ${panel}[\\s\\S]*?(?=\\nPanel ${panel + 1} |\\nExactly two recurring|$)`,
    "u"
  );
  return (prompt.match(re)?.[0] ?? "").trim();
}

describe("chatComicClothingCoverage canonical owner", () => {
  it("renders modest default contract unchanged", () => {
    assert.equal(renderTier2PanelClothingContract("modest_covered"), "modest covered clothing");
  });

  it("gates shirtless coverage on adultGrounded", () => {
    const panel = {
      index: 1,
      sourceEventIds: [],
      situation: "x",
      dialogue: [],
      clothingCoverage: "adult_male_character_shirtless_upper_torso" as const,
    };
    assert.equal(resolveTier2PanelClothingCoverage(panel, false), "modest_covered");
    assert.equal(
      resolveTier2PanelClothingCoverage(panel, true),
      "adult_male_character_shirtless_upper_torso"
    );
  });

  it("uses non-contradictory global footer when any panel is shirtless", () => {
    const structure = projectComicSafeStructureForTier2(n2aInput().scenePlan, undefined, {
      adultGrounded: true,
    });
    const footer = renderTier2ComicGlobalClothingFooter(structure);
    assert.doesNotMatch(footer, /Modest clothing throughout/iu);
    assert.match(footer, /Follow each panel's clothing contract above/iu);
  });
});

describe("chatComicClothingCoverage ladder golden parity", () => {
  it("preserves N1B/N1C1/N1C2 certified prompt bytes", () => {
    const db = new Database(DB, { readonly: true });
    const identity = loadRealFailIdentity(db);
    const cases = [
      { name: "N1B", input: n1bInput(), golden: GOLDEN.N1B },
      { name: "N1C1", input: n1c1Input(), golden: GOLDEN.N1C1 },
      { name: "N1C2", input: n1c2Input(), golden: GOLDEN.N1C2 },
    ] as const;
    for (const c of cases) {
      const prompt = buildTier2Prompt(identity, c.input.scenePlan, c.input.turnText);
      const hash = hashPromptForDiagnostic(prompt)!;
      const certified = readFileSync(c.golden.file, "utf8");
      assert.equal(hash, c.golden.hash, `${c.name} hash drift`);
      assert.equal(prompt.length, c.golden.chars, `${c.name} char drift`);
      assert.equal(prompt, certified, `${c.name} byte drift`);
    }
  });
});

describe("chatComicClothingCoverage N2A post-fix contract", () => {
  it("resolves shirtless without modest-clothing contradiction on panel 1", () => {
    const db = new Database(DB, { readonly: true });
    const identity = loadRealFailIdentity(db);
    const n1c2 = n1c2Input();
    const n2a = n2aInput();
    const n1c2Prompt = buildTier2Prompt(identity, n1c2.scenePlan, n1c2.turnText);
    const n2aPrompt = buildTier2Prompt(identity, n2a.scenePlan, n2a.turnText);

    const p1 = panelLine(n2aPrompt, 1);
    assert.match(p1, /bare upper torso framed from shoulders upward/iu);
    assert.doesNotMatch(p1, /modest covered clothing/iu);
    assert.match(p1, /Speech bubble: "좋아해\."/u);

    assert.equal(panelLine(n1c2Prompt, 2), panelLine(n2aPrompt, 2));
    assert.equal(panelLine(n1c2Prompt, 3), panelLine(n2aPrompt, 3));
    assert.equal(panelLine(n1c2Prompt, 4), panelLine(n2aPrompt, 4));

    assert.doesNotMatch(n2aPrompt, /Modest clothing throughout/iu);
    assert.doesNotMatch(n2aPrompt, /성관계|성기|노골/u);

    const n2aHash = hashPromptForDiagnostic(n2aPrompt)!;
    assert.notEqual(n2aHash, "b0b8b26a95dfe6ab");
    assert.notEqual(n2aPrompt, n1c2Prompt);
  });

  it("does not shirtless other panels or persona when only panel 1 requests it", () => {
    const db = new Database(DB, { readonly: true });
    const identity = loadRealFailIdentity(db);
    const prompt = buildTier2Prompt(identity, n2aInput().scenePlan, n2aInput().turnText);
    for (const panel of [2, 3, 4]) {
      const line = panelLine(prompt, panel);
      assert.match(line, /modest covered clothing/iu);
      assert.doesNotMatch(line, /bare upper torso/iu);
    }
  });
});
