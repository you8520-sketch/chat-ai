/**
 * Isolated export of #51 compile preview JSON for UI evidence (not production DB).
 */
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { buildCompiledCreatorDescriptionForSave } from "@/lib/characterFormSave";
import { loadCharacterChunksReadOnly } from "@/lib/characterChunks";
import { serializeCreatorDescriptionCompiled } from "@/lib/creatorDescriptionTriggerCompiler";
import { buildOfficialCharacterFormBody, computeTextLockHash } from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  OFFICIAL_IN_PLACE_APPLY_ENV,
  recompileOfficialCharacterInPlace,
} from "@/lib/officialSupply/inPlaceSync";
import { WOLFGANG_IN_PLACE_TARGET } from "@/lib/officialSupply/inPlaceWolfgang";
import { OfficialSupplyStore } from "@/lib/officialSupply/store";
import { composeExampleDialog, parseSpeechCreatorFromBody } from "@/lib/speechCreatorFields";
import { koreanChunksTranslationFingerprint } from "@/lib/promptTranslation";
import { serializeCharacterChunks } from "@/utils/characterParser";

const admin = { id: 95001, nickname: "운영", is_adult: 1, is_admin: 1 };

function seed51() {
  const db = getDb();
  new OfficialSupplyStore(db);
  db.exec(`DELETE FROM characters; DELETE FROM users WHERE id=95001;`);
  db.prepare("INSERT INTO users (id,email,nickname,pw_hash,is_adult,is_admin) VALUES (?,'p2@test.local','운영','x',1,1)").run(admin.id);
  const source = loadCompiledOfficialCharacterSource("pilot-rf-02");
  const body = buildOfficialCharacterFormBody({ draft: source.draft, appearanceBlock: source.appearanceBlock, assets: [] });
  const compiled = buildCompiledCreatorDescriptionForSave({
    description: String(body.description),
    world: String(body.world),
    systemPrompt: String(body.system_prompt),
    statusWidgetJson: "",
    statusWidgetTriggers: [],
  });
  const stale = structuredClone(compiled.compiledDescription);
  const index = stale.public_canon.findIndex((line) => /(?:주요|필요|해마다)\s/.test(line));
  if (index >= 0) {
    const line = stale.public_canon[index]!;
    const end = /(?:주요|필요|해마다)\s/.exec(line)!;
    const cut = end.index + end[0].trimEnd().length;
    stale.public_canon.splice(index, 1, line.slice(0, cut), line.slice(cut).trimStart());
  }
  const worldId = Number(db.prepare("INSERT INTO worlds (creator_id,name,content) VALUES (?,?,?)").run(admin.id, "공유", body.world).lastInsertRowid);
  db.prepare(
    `INSERT INTO characters (id,name,tagline,description,greeting,system_prompt,world,world_id,example_dialog,creator_comment,
      creator_id,creator_name,official,visibility,moderation_status,nsfw,gender,assets,images,
      creator_raw_description,creator_compiled_description_json,creator_canon_plan_json,appearance_raw,appearance_compiled,speech_profile)
     VALUES (51,?,?,?,?,?,?,?,?,?,?,0,'private','approved',?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    source.draft.name, body.tagline, body.description, body.greeting, body.system_prompt, body.world, worldId,
    composeExampleDialog(parseSpeechCreatorFromBody(body)), body.creator_comment, admin.id, "로맨스 공식계정",
    body.nsfw ? 1 : 0, body.gender,
    JSON.stringify(Array.from({ length: 14 }, (_, i) => ({ url: `/u/p2-51-${i}.webp`, tag: `slot${i}`, approved: true }))),
    JSON.stringify(["/u/p2-51-0.webp"]), compiled.creatorRawDescription, serializeCreatorDescriptionCompiled(stale),
    "{}", source.appearanceBlock, "{}", "{}"
  );
  db.prepare(
    `INSERT INTO official_supply_characters
      (draft_key,batch_key,world_key,style_key,stage,draft_json,text_lock_hash,appearance_json,appearance_lock_hash,asset_plan_json,is_style_proof,staging_claim,staged_character_id)
     VALUES (?,'approved',?,'romance_fantasy_v4','staged_private',?,?,?,?, '{"slots":[]}',1,'claim',51)`
  ).run(
    WOLFGANG_IN_PLACE_TARGET.supplyDraftKey,
    source.worldKey,
    JSON.stringify(source.draft),
    WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash,
    JSON.stringify(source.appearanceLock ?? {}),
    WOLFGANG_IN_PLACE_TARGET.appearanceLockHash
  );
  const row = db.prepare("SELECT * FROM characters WHERE id=51").get() as Parameters<typeof loadCharacterChunksReadOnly>[0];
  const korean = loadCharacterChunksReadOnly(row);
  db.prepare("UPDATE characters SET setting_chunks=?,setting_chunks_en=?,prompt_translation_hash=? WHERE id=51").run(
    serializeCharacterChunks(korean),
    JSON.stringify(korean.filter((c) => c.category !== "speech").map((c) => ({ ...c, content: "Old cached translation." }))),
    koreanChunksTranslationFingerprint(korean)
  );
}

async function main() {
  process.env[OFFICIAL_IN_PLACE_APPLY_ENV] = "1";
  installIsolatedTestDatabase();
  try {
    seed51();
    const preview = await recompileOfficialCharacterInPlace({ admin, characterId: 51, mode: "dry_run" });
    const failApply = await recompileOfficialCharacterInPlace({ admin, characterId: 51, mode: "apply" }).catch((e: { code?: string; message?: string }) => ({
      error: e.code ?? e.message,
    }));
    const outDir = path.join(process.cwd(), "docs/pr-evidence/official-character-p2-compile-refresh/ui");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "api-preview-51.json"), JSON.stringify(preview, null, 2));
    fs.writeFileSync(path.join(outDir, "api-apply-without-preflight.json"), JSON.stringify(failApply, null, 2));
    console.log(JSON.stringify({ ok: true, changedFields: preview.changedFields }));
  } finally {
    uninstallIsolatedTestDatabase();
  }
}

void main();
