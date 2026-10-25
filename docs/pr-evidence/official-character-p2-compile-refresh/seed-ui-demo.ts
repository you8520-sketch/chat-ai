/**
 * Local UI demo only — seeds characters #50/#51 for admin compile-refresh screenshots.
 * Does not touch production. Run: OFFICIAL_IN_PLACE_APPLY_ENABLED=1 ./node_modules/.bin/tsx docs/pr-evidence/official-character-p2-compile-refresh/seed-ui-demo.ts
 */
import { hashPassword } from "@/lib/auth";
import { buildCompiledCreatorDescriptionForSave } from "@/lib/characterFormSave";
import { loadCharacterChunksReadOnly } from "@/lib/characterChunks";
import { serializeCharacterChunks } from "@/utils/characterParser";
import { getDb } from "@/lib/db";
import { serializeCreatorDescriptionCompiled } from "@/lib/creatorDescriptionTriggerCompiler";
import { buildOfficialCharacterFormBody, computeTextLockHash } from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { WOLFGANG_IN_PLACE_TARGET } from "@/lib/officialSupply/inPlaceWolfgang";
import { OfficialSupplyStore } from "@/lib/officialSupply/store";
import { composeExampleDialog, parseSpeechCreatorFromBody } from "@/lib/speechCreatorFields";
import { koreanChunksTranslationFingerprint } from "@/lib/promptTranslation";

const ADMIN_EMAIL = "p2-ui-admin@test.local";
const ADMIN_PW = "p2-ui-demo-pass";

function staleCompiled(id: number, compiled: ReturnType<typeof buildCompiledCreatorDescriptionForSave>) {
  const stale = structuredClone(compiled.compiledDescription);
  const behavior =
    "성격·행동: 평소에는 웃는 얼굴과 가벼운 농담으로 상대의 경계를 낮추고, 말보다 손버릇·시선·퇴로부터 본다.";
  if (id === 50) {
    stale.public_canon = stale.public_canon.map((line) =>
      line === behavior ? "손버릇·시선·퇴로부터 본다." : line
    );
    stale.speech_control.push(behavior.slice(0, behavior.indexOf(" 손버릇")));
  } else {
    const index = stale.public_canon.findIndex((line) => /(?:주요|필요|해마다)\s/.test(line));
    if (index >= 0) {
      const line = stale.public_canon[index]!;
      const end = /(?:주요|필요|해마다)\s/.exec(line)!;
      const cut = end.index + end[0].trimEnd().length;
      stale.public_canon.splice(index, 1, line.slice(0, cut), line.slice(cut).trimStart());
    }
  }
  return stale;
}

function seedCharacter(id: number, draftKey: string) {
  const db = getDb();
  const isWolfgang = id === 51;
  const source = loadCompiledOfficialCharacterSource(draftKey);
  const body = buildOfficialCharacterFormBody({
    draft: source.draft,
    appearanceBlock: source.appearanceBlock,
    assets: [],
  });
  const compiled = buildCompiledCreatorDescriptionForSave({
    description: String(body.description),
    world: String(body.world),
    systemPrompt: String(body.system_prompt),
    statusWidgetJson: "",
    statusWidgetTriggers: [],
  });
  const stale = staleCompiled(id, compiled);
  const adminId = db.prepare("SELECT id FROM users WHERE email=?").get(ADMIN_EMAIL) as { id: number };
  db.prepare("DELETE FROM character_lorebook_attachments WHERE character_id=?").run(id);
  db.prepare("DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE character_id=?)").run(id);
  db.prepare("DELETE FROM chat_memories WHERE character_id=?").run(id);
  db.prepare("DELETE FROM chats WHERE character_id=?").run(id);
  db.prepare("DELETE FROM official_supply_characters WHERE staged_character_id=?").run(id);
  db.prepare("DELETE FROM characters WHERE id=?").run(id);

  const worldId = Number(
    db.prepare("INSERT INTO worlds (creator_id,name,content) VALUES (?,?,?)").run(
      adminId.id,
      "P2 UI demo world",
      body.world
    ).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO characters
      (id,name,tagline,description,greeting,system_prompt,world,world_id,example_dialog,creator_comment,
       creator_id,creator_name,official,visibility,moderation_status,nsfw,gender,assets,images,
       creator_raw_description,creator_compiled_description_json,creator_canon_plan_json,appearance_raw,appearance_compiled,speech_profile)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    source.draft.name,
    body.tagline,
    body.description,
    body.greeting,
    body.system_prompt,
    body.world,
    worldId,
    composeExampleDialog(parseSpeechCreatorFromBody(body)),
    body.creator_comment,
    adminId.id,
    isWolfgang ? "로맨스 공식계정" : "운영 공식",
    isWolfgang ? 0 : 1,
    isWolfgang ? "private" : "public",
    "approved",
    body.nsfw ? 1 : 0,
    body.gender,
    JSON.stringify(Array.from({ length: 14 }, (_, i) => ({ url: `/u/p2-ui-${id}-${i}.webp`, tag: `slot${i}`, approved: true }))),
    JSON.stringify([`/u/p2-ui-${id}-0.webp`]),
    compiled.creatorRawDescription,
    serializeCreatorDescriptionCompiled(stale),
    '{"approved_plan":"preserve"}',
    source.appearanceBlock,
    '{"locked_appearance":"preserve"}',
    '{"creator_speech_traits":"preserve"}'
  );

  const supplyDraftKey = isWolfgang ? WOLFGANG_IN_PLACE_TARGET.supplyDraftKey : draftKey;
  const textLock = isWolfgang ? WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash : computeTextLockHash(source.draft);
  if (isWolfgang) {
    db.prepare(
      `INSERT INTO official_supply_characters
        (draft_key,batch_key,world_key,style_key,stage,draft_json,text_lock_hash,appearance_json,appearance_lock_hash,asset_plan_json,is_style_proof,staging_claim,staged_character_id)
       VALUES (?,'approved',?,'romance_fantasy_v4','staged_private',?,?,?,?, '{"slots":[]}',1,?,?)`
    ).run(
      supplyDraftKey,
      source.worldKey,
      JSON.stringify(source.draft),
      textLock,
      JSON.stringify(source.appearanceLock ?? {}),
      WOLFGANG_IN_PLACE_TARGET.appearanceLockHash,
      `claim-${supplyDraftKey}`,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO official_supply_characters
        (draft_key,batch_key,world_key,style_key,stage,draft_json,text_lock_hash,staged_character_id)
       VALUES (?,'approved',?,'approved','published',?,?,?)`
    ).run(supplyDraftKey, source.worldKey, JSON.stringify(source.draft), textLock, id);
  }

  const korean = loadCharacterChunksReadOnly(
    db.prepare("SELECT * FROM characters WHERE id=?").get(id) as Parameters<typeof loadCharacterChunksReadOnly>[0]
  );
  const english = korean.filter((c) => c.category !== "speech").map((c) => ({ ...c, content: "Old cached translation." }));
  db.prepare("UPDATE characters SET setting_chunks=?,setting_chunks_en=?,prompt_translation_hash=? WHERE id=?").run(
    serializeCharacterChunks(korean),
    JSON.stringify(english),
    koreanChunksTranslationFingerprint(korean),
    id
  );
}

function main() {
  new OfficialSupplyStore(getDb());
  const db = getDb();
  const pw = hashPassword(ADMIN_PW);
  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(ADMIN_EMAIL) as { id: number } | undefined;
  if (existing) {
    db.prepare("UPDATE users SET pw_hash=?, is_admin=1, is_adult=1, nickname=? WHERE id=?").run(pw, "P2 UI Admin", existing.id);
  } else {
    db.prepare(
      "INSERT INTO users (email,nickname,pw_hash,is_adult,is_admin) VALUES (?,?,?,1,1)"
    ).run(ADMIN_EMAIL, "P2 UI Admin", pw);
  }
  seedCharacter(50, "pilot-rf-03");
  seedCharacter(51, "pilot-rf-02");
  console.log(JSON.stringify({ ok: true, adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PW, characterIds: [50, 51] }));
}

main();
