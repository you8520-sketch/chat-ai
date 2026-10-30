import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const studioPage = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const myCharactersPage = readFileSync(new URL("../my-characters/page.tsx", import.meta.url), "utf8");

describe("studio work status admin gate", () => {
  it("uses isAdminUser for card chips, not raw is_admin", () => {
    assert.match(studioPage, /ownerIsAdmin=\{isAdminUser\(user\)\}/);
    assert.doesNotMatch(studioPage, /ownerIsAdmin=\{Boolean\(user\.is_admin\)\}/);
    assert.match(myCharactersPage, /ownerIsAdmin=\{isAdminUser\(user\)\}/);
    assert.doesNotMatch(myCharactersPage, /ownerIsAdmin=\{Boolean\(user\.is_admin\)\}/);
  });
});
