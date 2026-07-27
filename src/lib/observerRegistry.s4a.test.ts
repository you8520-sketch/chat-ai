import Module from "module";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  closeActiveChatScene,
  ensureActiveChatScene,
  getActiveChatScene,
  listChatScenes,
} from "@/lib/chatScenes";
import { getDb } from "@/lib/db";
import { bootstrapChatObservers } from "@/lib/observerBootstrap";
import {
  ensureMainCharacterObserver,
  getChatObserver,
  listChatObservers,
  registerNpcObserver,
  renameChatObserver,
  retireChatObserver,
} from "@/lib/observerIdentity";
import { ensureObserverSchema } from "@/lib/observerSchema";
import { mainCharacterObserverId } from "@/lib/observerTypes";
import { compileAndApplyPersonaSecrets } from "@/lib/personaSecretCompiler";
import {
  getCharacterSecretKnowledge,
  upsertCharacterSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import { listExistingPersonaSecrets } from "@/lib/personaSecretCompilerApply";
import {
  canObserveAuditorily,
  canObserveVisually,
  getScenePresence,
  isPresenceWitnessEligible,
  listScenePresence,
} from "@/lib/scenePresence";
import {
  applyScenePresenceActions,
  parseScenePresenceActions,
} from "@/lib/scenePresenceActions";
import { runInvestigationDiscoveryForTurn } from "@/lib/investigationDiscovery";
import { upsertInvestigationTarget } from "@/lib/investigationTargets";
import { extractAndPersistSceneEvidence } from "@/lib/sceneEvidence";
import { runVisualDiscoveryForTurn } from "@/lib/visualDiscovery";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const ENV_KEYS = ["PERSONA_SECRET_BOUNDARY_ENABLED"] as const;
function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}
function restoreEnv(s: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k];
  }
}

function ids() {
  const n = Math.floor(Math.random() * 10000);
  return {
    chatId: 970000 + n,
    characterId: 17,
    personaId: 980000 + n,
  };
}

describe("PR-S4A observer identity & scene membership", () => {
  let env: Record<string, string | undefined>;
  beforeEach(() => {
    env = saveEnv();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    ensureObserverSchema(getDb());
  });
  afterEach(() => restoreEnv(env));

  describe("observer identity", () => {
    it("bootstraps main character with stable String(characterId)", () => {
      const { chatId, characterId } = ids();
      const r = bootstrapChatObservers({
        chatId,
        characterId,
        displayName: "로코",
        turnNumber: 1,
      });
      assert.equal(r.observerId, mainCharacterObserverId(characterId));
      const obs = getChatObserver({
        chatId,
        observerType: "CHARACTER",
        observerId: r.observerId,
      });
      assert.ok(obs);
      assert.equal(obs!.canonical_source_type, "MAIN_CHARACTER");
      assert.equal(obs!.display_name, "로코");
      assert.equal(obs!.is_active, 1);
    });

    it("retry bootstrap → duplicate observers 0", () => {
      const { chatId, characterId } = ids();
      bootstrapChatObservers({ chatId, characterId, turnNumber: 1 });
      const second = bootstrapChatObservers({ chatId, characterId, turnNumber: 2 });
      assert.equal(second.observerInserted, false);
      assert.equal(second.sceneCreated, false);
      assert.equal(second.presenceInserted, false);
      assert.equal(listChatObservers(chatId).length, 1);
      assert.equal(listChatScenes(chatId).filter((s) => s.status === "ACTIVE").length, 1);
    });

    it("registers two same-named NPCs with distinct UUIDs", () => {
      const { chatId } = ids();
      const a = registerNpcObserver({
        chatId,
        displayName: "경비병",
        canonicalSourceType: "CREATOR_NPC",
      });
      const b = registerNpcObserver({
        chatId,
        displayName: "경비병",
        canonicalSourceType: "CREATOR_NPC",
      });
      assert.notEqual(a.observer_id, b.observer_id);
      assert.equal(a.display_name, "경비병");
      assert.equal(b.display_name, "경비병");
    });

    it("rename keeps observer_id; retire soft-deactivates", () => {
      const { chatId } = ids();
      const npc = registerNpcObserver({
        chatId,
        displayName: "의사",
        canonicalSourceType: "SERVER_NPC",
        createdTurn: 1,
      });
      const renamed = renameChatObserver({
        chatId,
        observerType: "NPC",
        observerId: npc.observer_id,
        displayName: "원장",
      });
      assert.equal(renamed!.observer_id, npc.observer_id);
      assert.equal(renamed!.display_name, "원장");
      const retired = retireChatObserver({
        chatId,
        observerType: "NPC",
        observerId: npc.observer_id,
        retiredTurn: 5,
      });
      assert.equal(retired!.is_active, 0);
      assert.equal(retired!.retired_turn, 5);
      assert.equal(retired!.observer_id, npc.observer_id);
    });

    it("cross-chat observer isolation", () => {
      const a = ids();
      const b = ids();
      bootstrapChatObservers({
        chatId: a.chatId,
        characterId: a.characterId,
      });
      assert.equal(listChatObservers(b.chatId).length, 0);
    });
  });

  describe("scene identity", () => {
    it("allows only one active scene; close then create new", () => {
      const { chatId } = ids();
      const s1 = ensureActiveChatScene({ chatId, startedTurn: 1, locationKey: "clinic" });
      const s1b = ensureActiveChatScene({ chatId, startedTurn: 2 });
      assert.equal(s1.scene.id, s1b.scene.id);
      assert.equal(s1b.created, false);
      closeActiveChatScene({ chatId, endedTurn: 3 });
      const s2 = ensureActiveChatScene({
        chatId,
        startedTurn: 4,
        locationKey: "alley",
      });
      assert.notEqual(s2.scene.id, s1.scene.id);
      assert.equal(s2.scene.location_key, "alley");
      assert.equal(listChatScenes(chatId).length, 2);
      // Prior scene participants are NOT auto-copied
      assert.equal(listScenePresence(s2.scene.id).length, 0);
    });

    it("bootstrap does not propagate presence into a freshly opened scene after close", () => {
      const { chatId, characterId } = ids();
      bootstrapChatObservers({ chatId, characterId, turnNumber: 1 });
      const first = getActiveChatScene(chatId)!;
      assert.ok(listScenePresence(first.id).length >= 1);
      closeActiveChatScene({ chatId, endedTurn: 2 });
      const next = ensureActiveChatScene({ chatId, startedTurn: 3 });
      assert.equal(listScenePresence(next.scene.id).length, 0);
    });
  });

  describe("presence & capabilities", () => {
    it("PRESENT/AWARE/NORMAL is witness-eligible; UNKNOWN/ABSENT/UNCONSCIOUS/BLIND/DEAF are not", () => {
      const { chatId, characterId } = ids();
      const boot = bootstrapChatObservers({ chatId, characterId, turnNumber: 1 });
      const present = getScenePresence({
        sceneId: boot.sceneId,
        observerType: "CHARACTER",
        observerId: boot.observerId,
      })!;
      assert.equal(isPresenceWitnessEligible(present), true);
      assert.equal(canObserveVisually(present), true);
      assert.equal(canObserveAuditorily(present), true);

      applyScenePresenceActions({
        chatId,
        turnNumber: 2,
        actions: [
          {
            action: "SET_AWARENESS",
            observerType: "CHARACTER",
            observerId: boot.observerId,
            awarenessState: "UNCONSCIOUS",
            sourceType: "SERVER_SCENE_EVENT",
          },
        ],
      });
      const uncon = getScenePresence({
        sceneId: boot.sceneId,
        observerType: "CHARACTER",
        observerId: boot.observerId,
      })!;
      assert.equal(isPresenceWitnessEligible(uncon), false);

      applyScenePresenceActions({
        chatId,
        turnNumber: 3,
        actions: [
          {
            action: "SET_AWARENESS",
            observerType: "CHARACTER",
            observerId: boot.observerId,
            awarenessState: "AWARE",
            sourceType: "SERVER_SCENE_EVENT",
          },
          {
            action: "SET_VISUAL_CAPABILITY",
            observerType: "CHARACTER",
            observerId: boot.observerId,
            visualCapability: "BLIND",
            sourceType: "SERVER_SCENE_EVENT",
          },
          {
            action: "SET_AUDITORY_CAPABILITY",
            observerType: "CHARACTER",
            observerId: boot.observerId,
            auditoryCapability: "DEAF",
            sourceType: "SERVER_SCENE_EVENT",
          },
        ],
      });
      const sensory = getScenePresence({
        sceneId: boot.sceneId,
        observerType: "CHARACTER",
        observerId: boot.observerId,
      })!;
      assert.equal(canObserveVisually(sensory), false);
      assert.equal(canObserveAuditorily(sensory), false);

      applyScenePresenceActions({
        chatId,
        turnNumber: 4,
        actions: [
          {
            action: "LEAVE_SCENE",
            observerType: "CHARACTER",
            observerId: boot.observerId,
            sourceType: "USER_EXPLICIT_PARTY_ACTION",
          },
        ],
      });
      const left = getScenePresence({
        sceneId: boot.sceneId,
        observerType: "CHARACTER",
        observerId: boot.observerId,
      })!;
      assert.equal(left.presence_state, "ABSENT");
      assert.equal(isPresenceWitnessEligible(left), false);
    });

    it("ENTER_SCENE for registered NPC", () => {
      const { chatId, characterId } = ids();
      bootstrapChatObservers({ chatId, characterId });
      const npcId = randomUUID();
      const r = applyScenePresenceActions({
        chatId,
        turnNumber: 2,
        actions: [
          {
            action: "ENTER_SCENE",
            observerType: "NPC",
            observerId: npcId,
            displayName: "경비병",
            sourceType: "CREATOR_STRUCTURED_CAST",
          },
        ],
      });
      assert.equal(r.applied, 1);
      const scene = getActiveChatScene(chatId)!;
      const p = getScenePresence({
        sceneId: scene.id,
        observerType: "NPC",
        observerId: npcId,
      });
      assert.equal(p?.presence_state, "PRESENT");
      assert.equal(p?.awareness_state, "AWARE");
    });
  });

  describe("authority gates", () => {
    it("rejects assistant-origin and free-text cast style payloads", () => {
      const parsed = parseScenePresenceActions([
        {
          action: "ENTER_SCENE",
          observerType: "NPC",
          observerId: "경비병",
          displayName: "경비병",
          sourceType: "ASSISTANT_PROSE",
        },
        {
          action: "ENTER_SCENE",
          observerType: "NPC",
          observerId: "npc-1",
          sourceType: "MAIN_CHARACTER_BOOTSTRAP",
        },
        {
          action: "ENTER_SCENE",
          observerType: "NPC",
          observerId: "이름그대로",
          displayName: "이름그대로",
          sourceType: "CREATOR_STRUCTURED_CAST",
          secret_description: "leak",
        },
      ]);
      assert.equal(parsed.length, 0);
    });

    it("rejects unregistered observer presence mutation", () => {
      const { chatId, characterId } = ids();
      bootstrapChatObservers({ chatId, characterId });
      // Apply-layer gate (public parser already drops NPC + USER_EXPLICIT).
      const r = applyScenePresenceActions({
        chatId,
        turnNumber: 1,
        actions: [
          {
            action: "ENTER_SCENE",
            observerType: "NPC",
            observerId: "ghost-npc",
            sourceType: "SERVER_SCENE_EVENT",
          },
        ],
      });
      assert.equal(r.applied, 0);
      assert.equal(r.rejected, 1);
    });

    it("does not auto-register free-text simulation_cast names", () => {
      const { chatId, characterId } = ids();
      bootstrapChatObservers({ chatId, characterId });
      // Simulate what must NOT happen: parsing cast string into observers.
      const cast = "[서윤]\n[도윤]\n경비병";
      void cast;
      assert.equal(listChatObservers(chatId).length, 1);
      assert.equal(
        listChatObservers(chatId).every((o) => o.observer_type === "CHARACTER"),
        true
      );
    });
  });

  describe("knowledge migration / regression", () => {
    it("preserves existing CHARACTER knowledge after bootstrap", () => {
      const { chatId, characterId, personaId } = ids();
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 거액의 빚이 있다.",
      });
      const secret = listExistingPersonaSecrets(personaId).find((s) =>
        /빚/.test(s.canonical_secret_text)
      )!;
      upsertCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: secret.id,
        characterId,
        knowledgeState: "CONFIRMED",
        confidence: 100,
        factSnapshot: secret.confirmed_fact_text,
        firstSuspectedTurn: 1,
        confirmedTurn: 1,
        lastEvidenceEventId: "evt-s4a-preserve",
      });
      bootstrapChatObservers({ chatId, characterId, turnNumber: 2 });
      const k = getCharacterSecretKnowledge({
        chatId,
        personaId,
        secretId: secret.id,
        characterId,
      });
      assert.equal(k?.knowledge_state, "CONFIRMED");
      assert.equal(
        getChatObserver({
          chatId,
          observerType: "CHARACTER",
          observerId: mainCharacterObserverId(characterId),
        })?.observer_id,
        String(characterId)
      );
    });

    it("1:1 visual discovery still works after observer bootstrap", () => {
      const { chatId, characterId, personaId } = ids();
      bootstrapChatObservers({ chatId, characterId });
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌의 등에 실험체 시절 생긴 017 문신이 있다.",
      });
      extractAndPersistSceneEvidence({
        chatId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 101,
        userMessage: "렌은 젖은 셔츠를 벗어 의자에 걸고 로코에게 등을 보였다.",
        publicPersonaId: personaId,
      });
      const result = runVisualDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 101,
      });
      assert.ok(result.changedCount >= 1);
    });

    it("1:1 investigation discovery still works after observer bootstrap", () => {
      const { chatId, characterId, personaId } = ids();
      bootstrapChatObservers({ chatId, characterId });
      compileAndApplyPersonaSecrets({
        personaId,
        source: "렌은 거액의 빚이 있다.",
      });
      upsertInvestigationTarget({
        ownerScope: "CHAT",
        ownerId: String(chatId),
        targetType: "FINANCIAL_RECORD",
        targetKey: "financial_record",
        payload: {
          resultType: "DEBT_RECORD_CONFIRMED",
          resultState: "VERIFIED",
          resultTags: ["debtor_identity_match"],
          observableFacts: ["ok"],
          requiredAccess: { allowedActions: ["CHECK_FINANCIAL_RECORDS"] },
        },
      });
      const inv = runInvestigationDiscoveryForTurn({
        chatId,
        personaId,
        characterId,
        turnNumber: 1,
        sourceMessageId: 201,
        explicitActions: [
          {
            actionType: "CHECK_FINANCIAL_RECORDS",
            targetKey: "financial_record",
          },
        ],
      });
      assert.ok(inv.changedCount >= 1);
    });
  });

  describe("module hygiene", () => {
    it("S4A core modules do not import Muse/NovelText/Truth Guard", () => {
      const dir = path.join(process.cwd(), "src", "lib");
      const files = readdirSync(dir).filter((f) =>
        /^(observer|chatScenes|scenePresence)/.test(f)
      );
      assert.ok(files.length >= 4);
      const forbidden = /from\s+["']@\/lib\/(muse|novelText|truthGuard)/i;
      for (const f of files) {
        const src = readFileSync(path.join(dir, f), "utf8");
        assert.equal(forbidden.test(src), false, f);
      }
    });

    it("ensureMainCharacterObserver is idempotent with ensure path", () => {
      const { chatId, characterId } = ids();
      const a = ensureMainCharacterObserver({ chatId, characterId, displayName: "A" });
      const b = ensureMainCharacterObserver({ chatId, characterId, displayName: "B" });
      assert.equal(a.inserted, true);
      assert.equal(b.inserted, false);
      assert.equal(b.row.display_name, "B");
    });
  });
});
