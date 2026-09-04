import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_EMOTICON_API_OUTPUT_SIZE,
  CHAT_EMOTICON_OUTPUT_HEIGHT,
  CHAT_EMOTICON_OUTPUT_WIDTH,
  CHAT_EMOTICON_SCENE_POOL,
  CHAT_EMOTICON_QUALITY,
  buildChatEmoticonPrompt,
  resolveChatEmoticonPrice,
  selectRandomChatEmoticonScenes,
} from "./chatEmoticonGeneration";

describe("chatEmoticonGeneration", () => {
  it("uses a medium-quality square request and saves an exact 1024x1024 result", () => {
    assert.equal(CHAT_EMOTICON_API_OUTPUT_SIZE, "1024x1024");
    assert.equal(CHAT_EMOTICON_OUTPUT_WIDTH, 1024);
    assert.equal(CHAT_EMOTICON_OUTPUT_HEIGHT, 1024);
    assert.equal(CHAT_EMOTICON_QUALITY, "medium");
  });

  it("keeps a broad random emoticon scene candidate pool", () => {
    assert.ok(CHAT_EMOTICON_SCENE_POOL.length >= 45);
    for (const subject of ["character", "persona", "duo"] as const) {
      assert.ok(
        CHAT_EMOTICON_SCENE_POOL.filter((scene) => scene.subject === subject).length >= 15
      );
    }
  });

  it("selects nine unique random phrases with three solo/duo scenes per subject", () => {
    let seed = 17;
    const scenes = selectRandomChatEmoticonScenes(() => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    });
    assert.equal(scenes.length, 9);
    assert.equal(new Set(scenes.map((scene) => scene.text)).size, 9);
    assert.equal(scenes.filter((scene) => scene.subject === "character").length, 3);
    assert.equal(scenes.filter((scene) => scene.subject === "persona").length, 3);
    assert.equal(scenes.filter((scene) => scene.subject === "duo").length, 3);
  });

  it("keeps the selected random phrases and matching acting instructions explicit", () => {
    const scenes = selectRandomChatEmoticonScenes(() => 0.25);
    const prompt = buildChatEmoticonPrompt({
      characterName: "권태현",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      scenes,
    });
    for (const scene of scenes) {
      assert.match(prompt, new RegExp(scene.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(prompt, new RegExp(scene.action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(prompt, /exactly nine equal panels/i);
    assert.match(prompt, /IDENTITY OWNERSHIP IS STRICT/);
    assert.match(prompt, /GENDER LOCK/);
    assert.match(prompt, /confirmed MALE/);
    assert.equal(resolveChatEmoticonPrice(), 180);
  });
});
