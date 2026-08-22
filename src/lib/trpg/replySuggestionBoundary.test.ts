import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("TRPG reply suggestion client/server boundary", () => {
  it("keeps Client Components off the server reply module", () => {
    const client = read("src/app/trpg/[id]/TrpgRoomClient.tsx");
    const room = read("src/app/trpg/TrpgCampaignRoom.tsx");
    const prefs = read("src/lib/trpg/displayPrefs.ts");
    assert.match(client, /from ["']@\/lib\/trpg\/replySuggestionShared["']/);
    assert.doesNotMatch(client, /from ["']@\/lib\/trpg\/replySuggestions["']/);
    assert.match(room, /from ["']@\/lib\/trpg\/replySuggestionShared["']/);
    assert.doesNotMatch(room, /from ["']@\/lib\/trpg\/replySuggestions["']/);
    assert.match(prefs, /from ["']\.\/replySuggestionShared["']/);
    assert.doesNotMatch(prefs, /from ["']\.\/replySuggestions["']/);
  });

  it("keeps the shared DTO module free of server-only owners", () => {
    const shared = read("src/lib/trpg/replySuggestionShared.ts");
    assert.doesNotMatch(shared, /server-only/);
    assert.doesNotMatch(shared, /better-sqlite3/);
    assert.doesNotMatch(shared, /cheaperInferenceConfig/);
    assert.doesNotMatch(shared, /hostPersona/);
    assert.doesNotMatch(shared, /userPersonas/);
    assert.doesNotMatch(shared, /engineSheets/);
    assert.doesNotMatch(shared, /from ["']\.\/store["']/);
    assert.doesNotMatch(shared, /from ["']@\/lib\/db["']/);
    assert.doesNotMatch(shared, /from ["']\.\/replySuggestions["']/);
    assert.match(shared, /from ["']\.\/actionTypes["']/);
    assert.match(shared, /export function applyReplySuggestionClick/);
    assert.match(shared, /export function replyStanceLabelKo/);
    assert.match(shared, /TRPG_REPLY_STANCES/);
  });

  it("keeps provider/DB reply generation on the server module", () => {
    const server = read("src/lib/trpg/replySuggestions.ts");
    const api = read("src/app/api/trpg/campaigns/[id]/reply-suggestions/route.ts");
    assert.match(server, /import ["']server-only["']/);
    assert.match(server, /from ["']\.\/replySuggestionShared["']/);
    assert.match(server, /from ["']\.\/hostPersona["']/);
    assert.match(server, /from ["']\.\/store["']/);
    assert.match(server, /from ["']\.\/engineSheets["']/);
    assert.match(server, /cheaperInferenceConfig/);
    assert.match(server, /export async function requestTrpgReplySuggestions/);
    assert.match(api, /from ["']@\/lib\/trpg\/replySuggestions["']/);
    assert.doesNotMatch(api, /replySuggestionShared/);
  });
});
