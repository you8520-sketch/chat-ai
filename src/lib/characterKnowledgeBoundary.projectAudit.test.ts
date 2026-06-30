import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK,
  buildStructuredCharacterCanonBlock,
} from "@/lib/characterKnowledgeBoundary";

const SRC_ROOT = path.join(process.cwd(), "src");

/** Production prompt builders must not emit merged [CORE IDENTITY]. */
const CORE_IDENTITY_INJECTION = /\[CORE IDENTITY\]/;

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walkTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function extractCharacterCanonBody(block: string): string {
  const m = block.match(/\[CHARACTER CANON — [^\]]+\]\n([\s\S]*?)(?=\n\[WORLD CANON|\n\[PLAYER CANON|\n\[SCENARIO META|$)/);
  return m?.[1]?.trim() ?? "";
}

describe("project audit — no [CORE IDENTITY] prompt injection", () => {
  it("src production files contain zero [CORE IDENTITY] injection markers", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC_ROOT)) {
      const text = fs.readFileSync(file, "utf8");
      if (!CORE_IDENTITY_INJECTION.test(text)) continue;
      if (file.includes("characterKnowledgeBoundary") && text.includes("doesNotMatch")) continue;
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (CORE_IDENTITY_INJECTION.test(line) && !line.includes("doesNotMatch") && !line.includes("deprecated")) {
          offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `Remove [CORE IDENTITY] from:\n${offenders.join("\n")}`
    );
  });

  it("boundary includes knowledge precedence (Scenario Meta lowest)", () => {
    assert.match(CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK, /\[KNOWLEDGE PRECEDENCE/i);
    assert.match(CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK, /SCENARIO META — lowest/i);
    assert.match(CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK, /WORLD CANON does not become CHARACTER knowledge/i);
  });

  it("Leon-like regression text never lands in CHARACTER CANON body", () => {
    const leonSnippet = `[Worldview]
Two failures already. Leon died. 렌 regressed two weeks back.
This is the third regression.

[Name]
Leon von Eckhart

[Personality]
Leon feels déjà vu around 렌.

[System Command: Time & Event Management]
Loop restart. Retaining all memories.`;

    const block = buildStructuredCharacterCanonBlock(leonSnippet, "Leon");
    const markers = [
      { name: "CHARACTER CANON", idx: block.indexOf("[CHARACTER CANON") },
      { name: "WORLD CANON", idx: block.indexOf("[WORLD CANON") },
      { name: "PLAYER CANON", idx: block.indexOf("[PLAYER CANON") },
      { name: "SCENARIO META", idx: block.indexOf("[SCENARIO META") },
    ];
    assert.ok(markers[0]!.idx >= 0 && markers[2]!.idx >= 0 && markers[3]!.idx >= 0);
    const present = markers.filter((m) => m.idx >= 0);
    for (let i = 0; i < present.length - 1; i++) {
      assert.ok(present[i]!.idx < present[i + 1]!.idx, `${present[i]!.name} before ${present[i + 1]!.name}`);
    }

    const characterBody = extractCharacterCanonBody(block);
    assert.doesNotMatch(characterBody, /third regression/i);
    assert.doesNotMatch(characterBody, /two failures/i);
    assert.doesNotMatch(characterBody, /regressed/i);
    assert.match(characterBody, /d[ée]j[àa]\s*vu/i);
    assert.match(block, /third regression/i);
    assert.ok(block.indexOf("third regression") > block.indexOf("[PLAYER CANON"));
  });
});

describe("knowledge boundary behavioral spec (prompt contract)", () => {
  it("test1 regression — PLAYER CANON holds loop facts, CHARACTER allows déjà vu only", () => {
    const block = buildStructuredCharacterCanonBlock(
      `[Personality]\nLeon feels déjà vu but cannot place why.\n\n[Worldview]\nThird regression. Two past lives.`,
      "Leon"
    );
    assert.match(block, /\[PLAYER CANON — Leon DOES NOT KNOW\]/);
    assert.doesNotMatch(extractCharacterCanonBody(block), /Third regression/i);
  });

  it("test2 future — scenario/player meta separated from character canon", () => {
    const block = buildStructuredCharacterCanonBlock(
      `[System Command]\nPrince dies tomorrow at D-1.\n\n[Personality]\nLoyal guard.`,
      "Leon"
    );
    assert.match(block, /\[SCENARIO META/);
    assert.doesNotMatch(extractCharacterCanonBody(block), /dies tomorrow/i);
  });
});
