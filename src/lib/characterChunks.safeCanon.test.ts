import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import type { buildCharacterChunksFromSafeRuntimeCanon as BuildSafeChunksFn } from "@/lib/characterChunks";
import type {
  buildPrivateSpeechControlBlock as BuildPrivateSpeechControlBlockFn,
  compileCreatorDescriptionTriggers as CompileCreatorDescriptionTriggersFn,
  compiledPublicCanonText as CompiledPublicCanonTextFn,
  parseCreatorDescriptionCompiled as ParseCreatorDescriptionCompiledFn,
  serializeCreatorDescriptionCompiled as SerializeCreatorDescriptionCompiledFn,
} from "@/lib/creatorDescriptionTriggerCompiler";

let buildCharacterChunksFromSafeRuntimeCanon: typeof BuildSafeChunksFn;
let buildPrivateSpeechControlBlock: typeof BuildPrivateSpeechControlBlockFn;
let compileCreatorDescriptionTriggers: typeof CompileCreatorDescriptionTriggersFn;
let compiledPublicCanonText: typeof CompiledPublicCanonTextFn;
let parseCreatorDescriptionCompiled: typeof ParseCreatorDescriptionCompiledFn;
let serializeCreatorDescriptionCompiled: typeof SerializeCreatorDescriptionCompiledFn;

before(async () => {
  ({ buildCharacterChunksFromSafeRuntimeCanon } = await import("@/lib/characterChunks"));
  ({
    buildPrivateSpeechControlBlock,
    compileCreatorDescriptionTriggers,
    compiledPublicCanonText,
    parseCreatorDescriptionCompiled,
    serializeCreatorDescriptionCompiled,
  } = await import("@/lib/creatorDescriptionTriggerCompiler"));
});

describe("safe creator canon chunks", () => {
  it("persists and parses compiled creator sections while preserving raw text separately", () => {
    const raw = [
      "북부 기사단 출신이다.",
      "평소에는 다나까체, 단둘이 있을 때는 해요체를 사용한다.",
      "D-DAY가 0이 되면 캐릭터가 사망한다.",
      "캐릭터는 이 사실을 모른다.",
    ].join(" ");
    const compiled = compileCreatorDescriptionTriggers({ description: raw });
    const parsed = parseCreatorDescriptionCompiled(
      serializeCreatorDescriptionCompiled(compiled)
    );

    assert.equal(raw.includes("D-DAY가 0이 되면"), true);
    assert.ok(parsed);
    assert.deepEqual(parsed!.public_canon, ["북부 기사단 출신이다."]);
    assert.equal(parsed!.speech_control.length, 1);
    assert.ok(parsed!.hidden_event_notes.length >= 1);
  });

  it("generates runtime chunks only from public_canon", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description: [
        "북부 기사단 출신이다.",
        "평소에는 다나까체, 단둘이 있을 때는 해요체를 사용한다.",
        "D-DAY가 0이 되면 캐릭터가 사망한다.",
      ].join(" "),
    });
    const chunks = buildCharacterChunksFromSafeRuntimeCanon(1, {
      name: "레온",
      gender: "male",
      safeRuntimeCanon: compiledPublicCanonText(compiled),
      exampleDialog: "",
    });
    const text = chunks.map((chunk) => chunk.content).join("\n");

    assert.match(text, /북부 기사단 출신/);
    assert.doesNotMatch(text, /해요체|다나까체|D-DAY|사망/);
  });

  it("builds speech_control only as private speech section", () => {
    const compiled = compileCreatorDescriptionTriggers({
      description: "평소에는 다나까체, 단둘이 있을 때는 해요체를 사용한다.",
    });
    const privateBlock = buildPrivateSpeechControlBlock(compiled);
    const publicCanon = compiledPublicCanonText(compiled);

    assert.equal(publicCanon, "");
    assert.match(privateBlock, /\[PRIVATE SPEECH CONTROL - NOT STORY CONTENT\]/);
    assert.match(privateBlock, /해요체|다나까체/);
  });
});
