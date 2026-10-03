import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("safety filter boundary owners", () => {
  it("session no longer promotes skip or admin into stored is_adult", () => {
    const auth = read("./auth.ts");
    assert.doesNotMatch(auth, /effectiveIsAdult/);
    assert.doesNotMatch(auth, /is_adult: 1/);
    assert.match(auth, /return (row|publicRow);/);
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

  it("listings, detail, and chat reuse the admin-only access owner", () => {
    const owner = read("./adultVerification.ts");
    const home = read("../app/page.tsx");
    const search = read("../app/search/page.tsx");
    const ranking = read("../app/tab/[tab]/page.tsx");
    const character = read("../app/character/[id]/page.tsx");
    const chatPage = read("../app/chat/[id]/page.tsx");
    const chat = read("../app/api/chat/route.ts");
    const settings = read("../app/api/settings/route.ts");
    const verifyPage = read("../app/verify/page.tsx");
    const homeSections = read("./homeSections.ts");
    assert.match(owner, /Existing admin privilege only/);
    assert.doesNotMatch(owner, /if \(effectiveIsAdult\(user\.is_adult\)\) return true;/);
    assert.match(home, /shouldHideAdultListings\(user\)/);
    assert.match(search, /shouldHideAdultListings\(user\)/);
    assert.match(ranking, /shouldHideAdultListings\(user\)/);
    assert.match(homeSections, /if \(blurNsfw\) conds.push\(`\$\{colPrefix\}nsfw=0`\)/);
    assert.match(search, /if \(blurNsfw\) conds.push\("nsfw=0"\)/);
    assert.match(character, /canAccessAdultContent\(user\)/);
    assert.match(chatPage, /canAccessAdultContent\(user\)/);
    assert.match(chat, /canAccessAdultContent\(user\)/);
    assert.match(settings, /canAccessAdultContent\(user\)/);
    assert.match(verifyPage, /canAccessAdultContent\(user\)/);
    assert.doesNotMatch(verifyPage, /effectiveIsAdult/);
    assert.doesNotMatch(character, /effectiveIsAdult|user\.is_adult/);
    assert.doesNotMatch(chatPage, /effectiveIsAdult|user\.is_adult/);
    assert.doesNotMatch(chat, /effectiveIsAdult|user\.is_adult/);
    assert.doesNotMatch(settings, /effectiveIsAdult|user\.is_adult/);
  });

  it("authoring keeps canUseCreatorTools so stored is_adult still opens studio, not listings", () => {
    const owner = read("./adultVerification.ts");
    const studio = read("../app/studio/page.tsx");
    const create = read("../app/create/page.tsx");
    const formSave = read("./characterFormSave.ts");
    const upload = read("../app/api/upload/route.ts");
    assert.match(owner, /export function canUseCreatorTools/);
    assert.match(studio, /canUseCreatorTools\(user\)/);
    assert.match(create, /canUseCreatorTools\(user\)/);
    assert.match(formSave, /canUseCreatorTools\(user\)/);
    assert.match(upload, /canUseCreatorTools\(user\)/);
    assert.doesNotMatch(studio, /if \(!canAccessAdultContent\(user\)\)/);
    assert.doesNotMatch(formSave, /if \(!canAccessAdultContent\(user\)\)/);
  });

  it("public /uploads GET is unauthenticated and must not be described as secret", () => {
    const serve = read("../app/uploads/[filename]/route.ts");
    const store = read("./uploadStorage.ts");
    const upload = read("../app/api/upload/route.ts");
    const card = read("../components/CharacterCard.tsx");
    const carousel = read("../components/CharacterCardCarousel.tsx");
    assert.doesNotMatch(serve, /getSessionUser|canAccessAdultContent|isAdminUser/);
    assert.match(serve, /Cache-Control": "public/);
    assert.match(store, /access: "public"/);
    assert.match(upload, /canUseCreatorTools\(user\)/);
    assert.match(card, /CharacterCardCarousel/);
    assert.match(carousel, /hidden \? "blur-md"/);
    assert.match(carousel, /src=\{current\}/);
  });
});
