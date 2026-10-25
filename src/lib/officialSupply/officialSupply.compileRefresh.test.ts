import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import * as inPlace from "./inPlaceSync";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { loadCompiledOfficialCharacterSource } from "./compiledOfficialSource";
import { WOLFGANG_IN_PLACE_TARGET } from "./inPlaceWolfgang";
import { buildOfficialCharacterFormBody, computeTextLockHash } from "./characterText";
import { OfficialSupplyStore } from "./store";
import { buildCompiledCreatorDescriptionForSave } from "@/lib/characterFormSave";
import {
  buildPrivateSpeechControlBlock, parseCreatorDescriptionCompiled, serializeCreatorDescriptionCompiled,
} from "@/lib/creatorDescriptionTriggerCompiler";
import {
  casPublishCharacterSettingChunks, loadCharacterChunksReadOnly,
  loadCharacterChunksForPromptReadOnly, type CharacterSettingRow,
} from "@/lib/characterChunks";
import { composeExampleDialog, parseSpeechCreatorFromBody } from "@/lib/speechCreatorFields";
import { koreanChunksTranslationFingerprint } from "@/lib/promptTranslation";
import { serializeCharacterChunks } from "@/utils/characterParser";
import { enqueueCharacterDerivedRefreshJob } from "@/lib/derivedCache/characterEnqueue";
import { processDerivedCacheJob } from "@/lib/derivedCache/worker";
import type { DerivedCacheJobRow } from "@/lib/derivedCache/jobs";
import { buildContext } from "@/services/contextBuilder";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { listCharacterStatusWidgetTriggers, saveCharacterStatusWidgetTriggers } from "@/lib/statusWidgetTriggers";

const admin = { id: 95001, nickname: "운영", is_adult: 1, is_admin: 1 };
const behavior = "성격·행동: 평소에는 웃는 얼굴과 가벼운 농담으로 상대의 경계를 낮추고, 말보다 손버릇·시선·퇴로부터 본다.";
const totalChanges = () => (getDb().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const row = (id: number) => getDb().prepare("SELECT * FROM characters WHERE id=?").get(id) as CharacterSettingRow & Record<string, any>;
const refresh = (id: number, mode: "dry_run" | "apply", preflightSnapshot?: inPlace.OfficialCompileRefreshSnapshot) => {
  assert.equal(typeof inPlace.recompileOfficialCharacterInPlace, "function", "compile-only refresh owner is missing");
  return inPlace.recompileOfficialCharacterInPlace({ admin, characterId: id, mode, preflightSnapshot });
};

function seed(id: number, draftKey: string) {
  const db = getDb();
  const source = loadCompiledOfficialCharacterSource(draftKey);
  if (id === 51) assert.equal(computeTextLockHash(source.draft), WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash);
  const body = buildOfficialCharacterFormBody({ draft: source.draft, appearanceBlock: source.appearanceBlock, assets: [] });
  const compiled = buildCompiledCreatorDescriptionForSave({
    description: String(body.description), world: String(body.world), systemPrompt: String(body.system_prompt),
    statusWidgetJson: "", statusWidgetTriggers: [],
  });
  const stale = structuredClone(compiled.compiledDescription);
  // A bounded stored-output fixture of the observed P1 faults, not another compiler.
  // The entire saved manuscript comes unchanged from the approved source owner.
  if (id === 50) {
    assert.ok(stale.public_canon.includes(behavior));
    stale.public_canon = stale.public_canon.map((line) => line === behavior ? "손버릇·시선·퇴로부터 본다." : line);
    stale.speech_control.push(behavior.slice(0, behavior.indexOf(" 손버릇")));
  } else {
    const index = stale.public_canon.findIndex((line) => /(?:주요|필요|해마다)\s/.test(line));
    assert.ok(index >= 0);
    const line = stale.public_canon[index]!;
    const end = /(?:주요|필요|해마다)\s/.exec(line)!;
    const cut = end.index + end[0].trimEnd().length;
    stale.public_canon.splice(index, 1, line.slice(0, cut), line.slice(cut).trimStart());
  }
  const worldId = Number(db.prepare("INSERT INTO worlds (creator_id,name,content) VALUES (?,?,?)").run(admin.id, "공유 세계", body.world).lastInsertRowid);
  const lorebookId = Number(db.prepare("INSERT INTO keyword_lorebooks (creator_id,name,entries_json) VALUES (?,?,?)").run(admin.id, "승인 로어북", "[]").lastInsertRowid);
  db.prepare(`INSERT INTO characters
    (id,name,tagline,description,greeting,system_prompt,world,world_id,example_dialog,creator_comment,
     creator_id,creator_name,official,visibility,moderation_status,nsfw,gender,assets,images,
     creator_raw_description,creator_compiled_description_json,creator_canon_plan_json,appearance_raw,appearance_compiled,speech_profile)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'public','approved',?,?,?,?,?,?,?,?,?,?)`).run(
    id, source.draft.name, body.tagline, body.description, body.greeting, body.system_prompt, body.world, worldId,
    composeExampleDialog(parseSpeechCreatorFromBody(body)), body.creator_comment,
    admin.id, "운영 공식", body.nsfw ? 1 : 0, body.gender,
    JSON.stringify(Array.from({ length: 14 }, (_, i) => ({ url: `/u/p2-${id}-${i}.webp`, tag: `slot${i}`, approved: true }))),
    JSON.stringify([`/u/p2-${id}-0.webp`]), compiled.creatorRawDescription,
    serializeCreatorDescriptionCompiled(stale), '{"approved_plan":"preserve"}', source.appearanceBlock,
    '{"locked_appearance":"preserve-even-if-not-current"}', '{"creator_speech_traits":"preserve exact saved speech"}'
  );
  db.prepare("INSERT INTO character_lorebook_attachments (character_id,lorebook_id,position) VALUES (?,?,0)").run(id, lorebookId);
  db.prepare(`INSERT INTO official_supply_characters
    (draft_key,batch_key,world_key,style_key,stage,draft_json,text_lock_hash,staged_character_id)
    VALUES (?,'approved',?,'approved','published',?,?,?)`).run(draftKey, source.worldKey, JSON.stringify(source.draft), computeTextLockHash(source.draft), id);
  const korean = loadCharacterChunksReadOnly(row(id));
  const english = korean.filter((c) => c.category !== "speech").map((c) => ({ ...c, content: "Old cached translation." }));
  db.prepare("UPDATE characters SET setting_chunks=?,setting_chunks_en=?,prompt_translation_hash=? WHERE id=?").run(
    serializeCharacterChunks(korean), JSON.stringify(english), koreanChunksTranslationFingerprint(korean), id
  );
  const chatId = Number(db.prepare("INSERT INTO chats (user_id,character_id,mode,memory_meta) VALUES (?,?,'safe',?)").run(admin.id,id,'{"relationship":"preserve"}').lastInsertRowid);
  db.prepare("INSERT INTO messages (chat_id,role,content,model) VALUES (?,'assistant','기존 대화 보존','test')").run(chatId);
  db.prepare("INSERT INTO chat_memories (chat_id,user_id,character_id,recent_summary) VALUES (?,?,?,'기존 기억 보존')").run(chatId,admin.id,id);
  return { source, body, compiled };
}

function immutableState() {
  const db = getDb();
  return Object.fromEntries([
    "characters", "official_supply_characters", "worlds", "keyword_lorebooks",
    "character_lorebook_attachments", "chats", "messages", "chat_memories", "status_widget_triggers",
  ].map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all().map((r: any) => {
    if (table !== "characters") return r;
    const { creator_compiled_description_json, setting_chunks, ...unchanged } = r;
    return unchanged;
  })]));
}

function wire(id: number) {
  const current = row(id);
  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(current, "기록관", "기록관");
  const privateBlock = buildPrivateSpeechControlBlock(parseCreatorDescriptionCompiled(current.creator_compiled_description_json));
  const built = buildContext({
    charName: current.name, chunks, userNickname: "기록관", shortTermHistory: [],
    systemPrompt: current.system_prompt, world: current.world ?? "", exampleDialog: current.example_dialog ?? "",
    currentUserMessage: "상황을 알려 줘.", privateSpeechControlBlock: privateBlock,
    nsfw: false, provider: "cheaperinference", modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, completedTurns: 0,
  });
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt, history: built.history, modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    messageOpts: { transportProvider: "cheaperinference", systemSplit: built.openRouterSystemSplit }, stream: true,
  });
  const text = assembled.messages.map((m) => typeof m.content === "string" ? m.content : m.content.map((b) => "text" in b ? b.text : "").join("\n")).join("\n");
  return { text: text.replace(/\s+/g, " "), privateBlock, usedEnglish };
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());
beforeEach(() => {
  const db = getDb();
  new OfficialSupplyStore(db);
  db.exec(`DELETE FROM character_lorebook_attachments; DELETE FROM keyword_lorebooks; DELETE FROM worlds;
    DELETE FROM official_supply_characters; DELETE FROM messages; DELETE FROM chat_memories;
    DELETE FROM chats; DELETE FROM characters; DELETE FROM derived_cache_jobs;
    DELETE FROM users WHERE id=95001;`);
  db.prepare("INSERT INTO users (id,email,nickname,pw_hash,is_adult,is_admin) VALUES (?,'p2@test.local','운영','x',1,1)").run(admin.id);
  process.env[inPlace.OFFICIAL_IN_PLACE_APPLY_ENV] = "1";
});
after(() => { delete process.env[inPlace.OFFICIAL_IN_PLACE_APPLY_ENV]; });

describe("official compile-only refresh", () => {
  for (const [id, key] of [[50, "pilot-rf-03"], [51, "pilot-rf-02"]] as const) {
    it(`#${id}: preserves approved stored text/locks/assets while refreshing canon through chunks to wire`, async (t) => {
      const { source, compiled } = seed(id, key);
      const unchanged = immutableState();
      const before = row(id);
      if (id === 50) assert.match(wire(id).privateBlock, /말보다/);
      t.diagnostic(`P2_BEFORE ${JSON.stringify({
        characterId: id, manuscriptHash: hash(before.system_prompt),
        compiledJsonHash: hash(before.creator_compiled_description_json),
        fullBehaviorInPublicCanon: id === 50 ? parseCreatorDescriptionCompiled(before.creator_compiled_description_json)!.public_canon.includes(behavior) : null,
        source: "stored-output fault fixture before refresh; not a production DB capture",
      })}`);
      const n = totalChanges();
      const preview = await refresh(id, "dry_run");
      assert.equal(totalChanges(), n, "preflight must be read-only");
      assert.notEqual(preview.beforeJsonHash, preview.afterJsonHash);
      assert.deepEqual(preview.changedFields, ["creator_compiled_description_json", "setting_chunks"]);
      assert.equal(preview.derived.englishBefore, "CURRENT");
      assert.equal(preview.derived.englishAfter, "STALE");
      if (id === 50) {
        assert.ok(preview.publicCanon.added.includes(behavior));
        assert.ok(preview.speechControl.removed.some((s) => s.includes("말보다")));
      }
      const applied = await refresh(id, "apply", preview.preflightSnapshot);
      assert.equal(applied.applied, true);
      assert.equal(row(id).creator_compiled_description_json, compiled.compiledDescriptionJson);
      assert.deepEqual(immutableState(), unchanged);
      assert.equal(JSON.parse(String(before.assets)).length, 14);
      const actualWire = wire(id);
      assert.equal(actualWire.usedEnglish, false, "old translation must not replace new canon");
      assert.doesNotMatch(actualWire.text, /Old cached translation/);
      if (id === 50) {
        assert.ok(actualWire.text.includes(behavior));
        assert.doesNotMatch(actualWire.privateBlock, /말보다|손버릇/);
      }
      for (const section of [source.draft.sections.worldAndSituation, source.draft.sections.currentSituation ?? "", source.draft.sections.characterCore]) {
        for (const sentence of section.split(/(?<=[.!?。！？])\s+|\n+/).filter((s) => s.trim())) {
          assert.ok(actualWire.text.includes(sentence.replace(/\s+/g, " ").trim()), `#${id} missing source sentence: ${sentence}`);
        }
      }
      for (const line of source.draft.speech.examples.split("\n").filter(Boolean)) {
        assert.ok(actualWire.text.includes(line.replace(/\s+/g, " ").trim()), `#${id} missing speech example: ${line}`);
      }
      assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM derived_cache_jobs").get().n, 0);
      const afterChanges = totalChanges();
      const retry = await refresh(id, "apply", preview.preflightSnapshot);
      assert.equal(retry.applied, false, "same approved preflight replay is an idempotent no-op");
      assert.deepEqual(retry.changedFields, []);
      assert.equal(totalChanges(), afterChanges);
      assert.equal(casPublishCharacterSettingChunks(id, {
        expectedExistingSettingChunks: before.setting_chunks,
        rebuiltChunks: loadCharacterChunksReadOnly(before), canonicalRow: before,
      }), false, "old derived publisher cannot overwrite refreshed canon");
      t.diagnostic(`P2_RECEIPT ${JSON.stringify({
        characterId: id, draftKey: key, textLockHash: computeTextLockHash(source.draft),
        storedManuscriptHash: hash(before.system_prompt),
        beforeJsonHash: preview.beforeJsonHash, afterJsonHash: preview.afterJsonHash,
        changedFields: preview.changedFields, derived: preview.derived,
        publicCanonAdded: preview.publicCanon.added.length, publicCanonRemoved: preview.publicCanon.removed.length,
        speechControlAdded: preview.speechControl.added.length, speechControlRemoved: preview.speechControl.removed.length,
        wireHash: hash(actualWire.text), preservedSourceAndLocks: true, imageSlots: 14,
        repeatedApplySqlChanges: totalChanges() - afterChanges, source: "isolated approved-source-equivalent fixture, not production DB",
      })}`);
    });
  }

  for (const column of ["description", "world", "system_prompt", "creator_raw_description", "gender", "example_dialog", "speech_profile", "creator_comment", "creator_compiled_description_json", "status_widget_json", "setting_chunks"]) {
    it(`rejects edits to ${column} after preflight`, async () => {
      seed(50, "pilot-rf-03");
      const preview = await refresh(50, "dry_run");
      getDb().prepare(`UPDATE characters SET ${column}=? WHERE id=50`).run(String(row(50)[column]) + " changed");
      const edited = row(50);
      await assert.rejects(() => refresh(50, "apply", preview.preflightSnapshot), (e: any) => e.code === "preflight_mismatch");
      assert.deepEqual(row(50), edited);
    });
  }

  it("rejects concurrent trigger or approved Text Lock edits without further writes", async () => {
    seed(50, "pilot-rf-03");
    const db = getDb();
    const first = await refresh(50, "dry_run");
    saveCharacterStatusWidgetTriggers(db, 50, [{
      trigger_id: "concurrent", status_key: "affection", operator: ">=", value: 50,
      fire_once: true, event_key: "concurrent_event", effect_text: "동시 편집",
      character_knowledge: "known", is_enabled: true,
    }]);
    const changed = totalChanges();
    await assert.rejects(() => refresh(50, "apply", first.preflightSnapshot), (e: any) => e.code === "preflight_mismatch");
    assert.equal(totalChanges(), changed);
    const second = await refresh(50, "dry_run");
    db.prepare("UPDATE official_supply_characters SET text_lock_hash='concurrently-edited' WHERE staged_character_id=50").run();
    const lockEdited = totalChanges();
    await assert.rejects(() => refresh(50, "apply", second.preflightSnapshot), (e: any) => e.code === "preflight_mismatch");
    assert.equal(totalChanges(), lockEdited);
  });

  it("freshly previews a current result as a no-op and ignores chat/like counter churn", async () => {
    seed(50, "pilot-rf-03");
    const preview = await refresh(50, "dry_run");
    getDb().prepare("UPDATE characters SET likes=likes+1,chats_count=chats_count+1 WHERE id=50").run();
    const preserved = immutableState();
    await refresh(50, "apply", preview.preflightSnapshot);
    assert.deepEqual(immutableState(), preserved);
    const changes = totalChanges();
    const current = await refresh(50, "dry_run");
    assert.equal(current.beforeJsonHash, current.afterJsonHash);
    assert.deepEqual(current.changedFields, []);
    assert.equal((await refresh(50, "apply", current.preflightSnapshot)).applied, false);
    assert.equal(totalChanges(), changes);
  });

  it("uses the current stored manuscript and preserves real speech/status/trigger/secret handling", async () => {
    seed(50, "pilot-rf-03");
    const db = getDb();
    const controls = "\n저장된 고유 문장은 언제나 보존한다.\n평소에는 존댓말을 쓴다.\nD-DAY는 항상 상태창 마지막에 표시한다.\nD-DAY가 0이 되면 약속된 사건이 발생한다.\n캐릭터는 이 사실을 모른다.";
    const widget = { version: 1, name: "상태창", placement: "bottom", fields: [{ id: "d_day", label: "D-DAY", instruction: "D-DAY를 표시한다." }, { id: "affection", label: "호감도", instruction: "호감도 표시" }], htmlTemplate: "{{d_day}}{{affection}}" };
    db.prepare("UPDATE characters SET system_prompt=system_prompt||?,status_widget_json=? WHERE id=50").run(controls, JSON.stringify(widget));
    saveCharacterStatusWidgetTriggers(db, 50, [{
      trigger_id: "manual_preserved", status_key: "affection", operator: ">=", value: 50,
      fire_once: true, event_key: "manual_event", effect_text: "저장된 수동 연출을 보존한다.",
      character_knowledge: "known", is_enabled: true,
    }]);
    const source = row(50);
    const expected = buildCompiledCreatorDescriptionForSave({
      description: source.description, world: source.world ?? "", systemPrompt: source.system_prompt,
      statusWidgetJson: source.status_widget_json, statusWidgetTriggers: listCharacterStatusWidgetTriggers(db, 50),
    });
    const unchanged = immutableState();
    const preview = await refresh(50, "dry_run");
    await refresh(50, "apply", preview.preflightSnapshot);
    assert.deepEqual(immutableState(), unchanged);
    assert.equal(row(50).creator_compiled_description_json, expected.compiledDescriptionJson);
    assert.ok(expected.compiledDescription.public_canon.includes("저장된 고유 문장은 언제나 보존한다."));
    assert.ok(expected.compiledDescription.speech_control.includes("평소에는 존댓말을 쓴다."));
    assert.equal(expected.compiledDescription.status_widget_instruction_candidates.length, 1);
    assert.equal(expected.compiledDescription.trigger_candidates.length, 1);
    assert.ok(expected.compiledDescription.hidden_event_notes.some((s) => s.includes("모른다")));
    assert.doesNotMatch(wire(50).text, /캐릭터는 이 사실을 모른다/);
  });

  it("rejects a comment edit even when the compiled result is already current", async () => {
    seed(50, "pilot-rf-03");
    const preview = await refresh(50, "dry_run");
    await refresh(50, "apply", preview.preflightSnapshot);
    getDb().prepare("UPDATE characters SET creator_comment=creator_comment||' changed' WHERE id=50").run();
    await assert.rejects(() => refresh(50, "apply", preview.preflightSnapshot), (e: any) => e.code === "preflight_mismatch");
  });

  it("rolls compiled JSON back if the chunk write fails in the same transaction", async () => {
    seed(50, "pilot-rf-03");
    const preview = await refresh(50, "dry_run");
    const before = row(50);
    getDb().exec("CREATE TRIGGER p2_chunk_failure BEFORE UPDATE OF setting_chunks ON characters BEGIN SELECT RAISE(ABORT,'p2 chunk failure'); END");
    try {
      await assert.rejects(() => refresh(50, "apply", preview.preflightSnapshot), /p2 chunk failure/);
      assert.deepEqual(row(50), before);
    } finally { getDb().exec("DROP TRIGGER p2_chunk_failure"); }
  });

  it("discards old derived jobs without appearance compilation or translation", async () => {
    seed(50, "pilot-rf-03");
    const db = getDb();
    enqueueCharacterDerivedRefreshJob(db, 50, { jobFlags: "force_appearance" });
    const oldJob = db.prepare("SELECT * FROM derived_cache_jobs WHERE entity_id=50").get() as DerivedCacheJobRow;
    const preview = await refresh(50, "dry_run");
    await refresh(50, "apply", preview.preflightSnapshot);
    const snapshot = row(50);
    await processDerivedCacheJob(db, oldJob);
    assert.deepEqual(row(50), snapshot);
    assert.notEqual(preview.derived.sourceFingerprintBefore, preview.derived.sourceFingerprintAfter);
  });

  it("retains existing administrator/apply gates", async () => {
    seed(50, "pilot-rf-03");
    await assert.rejects(() => inPlace.recompileOfficialCharacterInPlace({ admin: { ...admin, is_admin: 0 }, characterId: 50, mode: "dry_run" }), (e: any) => e.code === "admin_required");
    await assert.rejects(() => refresh(50, "apply"), (e: any) => e.code === "preflight_required");
    const preview = await refresh(50, "dry_run");
    delete process.env[inPlace.OFFICIAL_IN_PLACE_APPLY_ENV];
    await assert.rejects(() => refresh(50, "apply", preview.preflightSnapshot), (e: any) => e.code === "apply_disabled");
  });
});
