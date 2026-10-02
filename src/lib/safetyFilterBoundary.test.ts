import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("safety filter boundary owners", () => {
  it("session no longer promotes skip or admin into stored is_adult", () => {
    const auth = read("./auth.ts");
    assert.doesNotMatch(auth, /effectiveIsAdult/);
    assert.doesNotMatch(auth, /is_adult: 1/);
    assert.match(auth, /return row;/);
  });

  it("beta skip no longer grants effective verification", () => {
    const owner = read("./adultVerification.ts");
    assert.match(owner, /export function effectiveIsAdult/);
    assert.match(owner, /return !!isAdult;/);
    assert.doesNotMatch(owner, /if \(isAdultVerificationSkipped\(\)\) return true;/);
    assert.match(owner, /export function canAccessAdultContent/);
    assert.match(owner, /isAdminUser/);
  });

  it("mock verify does not write is_adult outside demo", () => {
    const verify = read("../app/api/verify/route.ts");
    assert.match(verify, /providerPending/);
    assert.match(verify, /본인확인 제공업체가 아직 연동되지 않았습니다/);
    assert.doesNotMatch(verify, /UPDATE users SET is_adult = 1, real_name/);
  });

  it("listings and chat reuse the same access owner", () => {
    const home = read("../app/page.tsx");
    const search = read("../app/search/page.tsx");
    const ranking = read("../app/tab/[tab]/page.tsx");
    const chat = read("../app/api/chat/route.ts");
    const settings = read("../app/api/settings/route.ts");
    assert.match(home, /shouldHideAdultListings\(user\)/);
    assert.match(search, /shouldHideAdultListings\(user\)/);
    assert.match(ranking, /shouldHideAdultListings\(user\)/);
    assert.match(chat, /canAccessAdultContent\(user\)/);
    assert.match(settings, /canAccessAdultContent\(user\)/);
  });
});
