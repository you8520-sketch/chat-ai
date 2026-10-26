/**
 * Offline P5 reapproval measurements on current main owners.
 * Does not write production data, Text Lock pins, or paid provider calls.
 *
 * NODE_TEST_CONTEXT=1 ./node_modules/.bin/tsx --conditions=react-server \
 *   docs/official-supply/reviews/text-audit-p5/build-package.ts
 */
import fs from "node:fs";
import path from "node:path";

import { createCharacterFromForm, type SessionUser } from "@/lib/characterFormSave";
import { loadCharacterChunksForPromptReadOnly, type CharacterSettingRow } from "@/lib/characterChunks";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";
import {
  buildPrivateSpeechControlBlock,
  parseCreatorDescriptionCompiled,
} from "@/lib/creatorDescriptionTriggerCompiler";
import { getDb } from "@/lib/db";
import {
  compileOfficialDraftFromBible,
  evaluateRelationBibleContract,
  validateCharacterBible,
  type OfficialCharacterBible,
} from "@/lib/officialSupply/bible";
import {
  buildOfficialCharacterFormBody,
  composeOfficialSystemPrompt,
  computeTextLockHash,
  evaluateOfficialStagedSaveLength,
} from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { wolfgangApprovedPersistedSourcePath } from "@/lib/officialSupply/inPlaceWolfgang";
import { collectWorldProperTerms, evaluatePublicHook } from "@/lib/officialSupply/marketFit";
import { ensureOfficialSharedWorldLibraryRow } from "@/lib/officialSupply/officialSharedWorld";
import {
  evaluateOfficialCreatorComment,
  evaluateOfficialPublicDescription,
} from "@/lib/officialSupply/publicProfileText";
import { createSiteManagedStudioAccount } from "@/lib/siteManagedAccounts";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { buildContext } from "@/services/contextBuilder";

const OUT = path.join(process.cwd(), "docs/official-supply/reviews/text-audit-p5");
const PILOT = path.join(process.cwd(), "src/lib/officialSupply/pilot");

type PilotFile = {
  slot: number;
  draftKey: string;
  bible: OfficialCharacterBible;
  brief: {
    audience: "all" | "female" | "male";
    archetype: string;
    relationshipTrope: string;
    occupation: string;
    rpHook: string;
  };
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function currentPilotPath(draftKey: string): { path: string; kind: "persisted_approved_source" | "repo_pilot" } {
  if (draftKey === "pilot-rf-02") {
    const persisted = wolfgangApprovedPersistedSourcePath();
    if (fs.existsSync(persisted)) return { path: persisted, kind: "persisted_approved_source" };
  }
  return { path: path.join(PILOT, "characters", `${draftKey}.json`), kind: "repo_pilot" };
}

function count(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while (true) {
    const at = haystack.indexOf(needle, i);
    if (at < 0) return n;
    n += 1;
    i = at + needle.length;
  }
}

async function wireFor(draftKey: string, draft: ReturnType<typeof compileOfficialDraftFromBible>, appearanceBlock: string, label: string) {
  const studio = createSiteManagedStudioAccount({
    nickname: `p5-${label}`,
    email: `p5-${label}@site-managed.invalid`,
  });
  const world = readJson<{ bible: Parameters<typeof ensureOfficialSharedWorldLibraryRow>[0]["bible"] }>(
    path.join(PILOT, "world-bible.json")
  ).bible;
  const shared = ensureOfficialSharedWorldLibraryRow({ db: getDb(), creatorId: studio.id, bible: world });
  const body = buildOfficialCharacterFormBody({
    draft,
    appearanceBlock,
    assets: [{ url: `/uploads/${label}.webp`, tag: "대표", width: 1024, height: 1536, viewerBlur: false }],
    worldId: shared.worldId,
  });
  const owner: SessionUser = { id: studio.id, nickname: studio.nickname, email: studio.email, is_adult: 1 };
  const created = await createCharacterFromForm(owner, body);
  if (!created.ok) throw new Error(`${label} save failed: ${created.error}`);
  const row = getDb().prepare("SELECT * FROM characters WHERE id=?").get(created.id) as CharacterSettingRow & {
    tagline: string;
    description: string;
    greeting: string;
    creator_comment: string | null;
    speech_personality: string | null;
    speech_traits: string | null;
    system_prompt: string;
    world: string;
    example_dialog: string | null;
    creator_compiled_description_json: string;
  };
  const { chunks } = loadCharacterChunksForPromptReadOnly(row, "기록관", "기록관");
  const privateSpeechControlBlock = buildPrivateSpeechControlBlock(
    parseCreatorDescriptionCompiled(row.creator_compiled_description_json)
  );
  const built = buildContext({
    charName: draft.name,
    chunks,
    userNickname: "기록관",
    speechPersonality: row.speech_personality ?? "",
    speechTraits: row.speech_traits ?? "",
    systemPrompt: row.system_prompt,
    world: row.world,
    exampleDialog: row.example_dialog ?? "",
    privateSpeechControlBlock,
    shortTermHistory: [],
    currentUserMessage: "상황을 알려 줘.",
    nsfw: false,
    gender: draft.gender,
    provider: "cheaperinference",
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    completedTurns: 0,
  });
  return {
    draftKey,
    systemPrompt: built.systemPrompt,
    public: {
      tagline: row.tagline,
      description: row.description,
      greeting: row.greeting,
      creatorComment: row.creator_comment,
    },
    greetingInSystemPrompt: built.systemPrompt.includes(row.greeting.slice(0, 40)),
    taglineInSystemPrompt: built.systemPrompt.includes(row.tagline),
    commentInSystemPrompt: row.creator_comment ? built.systemPrompt.includes(row.creator_comment.slice(0, 40)) : false,
    systemPromptChars: built.systemPrompt.length,
    systemPromptUtf8Bytes: Buffer.byteLength(built.systemPrompt, "utf8"),
  };
}

async function main() {
  installIsolatedTestDatabase();
  const manifest = readJson<{ worldKey: string; styleKey: string }>(path.join(PILOT, "manifest.json"));
  const worldFile = readJson<{ bible: Parameters<typeof compileOfficialDraftFromBible>[1]["worldBible"] }>(
    path.join(PILOT, "world-bible.json")
  );
  const terms = collectWorldProperTerms(worldFile.bible);
  const results: Record<string, unknown> = {};

  for (const draftKey of ["pilot-rf-03", "pilot-rf-02"] as const) {
    const currentFile = currentPilotPath(draftKey);
    const currentWrapped = readJson<PilotFile>(currentFile.path);
    const candidateBible = readJson<OfficialCharacterBible>(
      path.join(OUT, "candidates", `${draftKey}.candidate.bible.json`)
    );
    const currentSource = loadCompiledOfficialCharacterSource(draftKey);
    const candidateDraft = compileOfficialDraftFromBible(candidateBible, {
      draftKey,
      worldKey: manifest.worldKey,
      styleKey: manifest.styleKey,
      genres: ["로맨스 판타지"],
      audience: currentWrapped.brief.audience,
      worldName: worldFile.bible.name,
      worldBible: worldFile.bible,
      hook: {
        archetype: currentWrapped.brief.archetype,
        relationshipTrope: currentWrapped.brief.relationshipTrope,
        occupation: currentWrapped.brief.occupation,
        rpHook: currentWrapped.brief.rpHook,
      },
    });
    const appearanceBlock = currentSource.appearanceBlock;
    const bibleQa = validateCharacterBible(candidateBible, { adultExpected: candidateBible.nsfw });
    const relationQa = evaluateRelationBibleContract(candidateBible);
    const publicQa = evaluateOfficialPublicDescription(candidateDraft.description, candidateDraft.name);
    const comment = candidateDraft.creatorComment ?? "";
    const commentQa = evaluateOfficialCreatorComment(comment, candidateDraft.description);
    const lengthQa = evaluateOfficialStagedSaveLength(candidateDraft, appearanceBlock);
    const hookQa = evaluatePublicHook(
      {
        tagline: candidateBible.publicProfile.tagline,
        description: candidateBible.publicProfile.description,
        worldTerms: terms,
      },
      { maxTaglineWorldTerms: 2 }
    );
    const currentHook = evaluatePublicHook(
      {
        tagline: currentWrapped.bible.publicProfile.tagline,
        description: currentWrapped.bible.publicProfile.description,
        worldTerms: terms,
      },
      { maxTaglineWorldTerms: 2 }
    );

    const beforeWire = await wireFor(draftKey, currentSource.draft, appearanceBlock, `${draftKey}-before`);
    const afterWire = await wireFor(draftKey, candidateDraft, appearanceBlock, `${draftKey}-after`);
    const wireDir = path.join(OUT, "wire");
    fs.mkdirSync(wireDir, { recursive: true });
    fs.writeFileSync(path.join(wireDir, `${draftKey}.before.system.txt`), beforeWire.systemPrompt);
    fs.writeFileSync(path.join(wireDir, `${draftKey}.after.system.txt`), afterWire.systemPrompt);

    const phrases = ["장갑 잠금쇠", "병력 명단", "투자", "더 낮고 공손", "당신"];
    const phraseCounts = Object.fromEntries(
      phrases.map((phrase) => [
        phrase,
        { before: count(beforeWire.systemPrompt, phrase), after: count(afterWire.systemPrompt, phrase) },
      ])
    );

    results[draftKey] = {
      beforeSource: currentFile,
      textLock: {
        before: computeTextLockHash(currentSource.draft),
        after: computeTextLockHash(candidateDraft),
      },
      lengths: {
        greeting: [currentSource.draft.greeting.length, candidateDraft.greeting.length],
        tagline: [currentSource.draft.tagline.length, candidateDraft.tagline.length],
        creatorComment: [(currentSource.draft.creatorComment ?? "").length, comment.length],
        relationshipsAndDrives: [
          currentSource.draft.sections.relationshipsAndDrives.length,
          candidateDraft.sections.relationshipsAndDrives.length,
        ],
        speechExamples: [currentSource.draft.speech.examples.length, candidateDraft.speech.examples.length],
        description: [currentSource.draft.description.length, candidateDraft.description.length],
        systemPromptStored: [
          currentSource.systemPrompt.length,
          composeOfficialSystemPrompt(candidateDraft, appearanceBlock).length,
        ],
      },
      gates: {
        validateCharacterBible: bibleQa.errors.map((e) => e.code),
        relationContract: relationQa.errors.map((e) => e.code),
        publicDescription: publicQa.errors.map((e) => e.code),
        creatorComment: commentQa.errors.map((e) => e.code),
        stagedSaveLengthOk: lengthQa.ok,
        stagedSaveLengthErrors: lengthQa.errors.map((e) => e.code),
        publicHookWarnings: { before: currentHook.warnings.map((w) => w.code), after: hookQa.warnings.map((w) => w.code) },
      },
      publicPage: { before: beforeWire.public, after: afterWire.public },
      wire: {
        beforeChars: beforeWire.systemPromptChars,
        afterChars: afterWire.systemPromptChars,
        beforeUtf8: beforeWire.systemPromptUtf8Bytes,
        afterUtf8: afterWire.systemPromptUtf8Bytes,
        greetingInSystemPrompt: { before: beforeWire.greetingInSystemPrompt, after: afterWire.greetingInSystemPrompt },
        taglineInSystemPrompt: { before: beforeWire.taglineInSystemPrompt, after: afterWire.taglineInSystemPrompt },
        commentInSystemPrompt: { before: beforeWire.commentInSystemPrompt, after: afterWire.commentInSystemPrompt },
        phraseCounts,
        tokenizer: "not_run",
      },
      taglines: { before: currentSource.draft.tagline, after: candidateDraft.tagline },
      greetingsEqualExceptKnown: currentSource.draft.greeting === candidateDraft.greeting,
    };
    fs.writeFileSync(path.join(OUT, "wire", `${draftKey}.before.public.json`), JSON.stringify(beforeWire.public, null, 2));
    fs.writeFileSync(path.join(OUT, "wire", `${draftKey}.after.public.json`), JSON.stringify(afterWire.public, null, 2));
  }

  fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
