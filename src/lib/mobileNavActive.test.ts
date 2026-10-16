import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMobileNavActive, type MobileNavItem } from "./mobileNavActive";

const studio: MobileNavItem = {
  href: "/studio",
  label: "제작",
  also: ["/create", "/my-characters"],
  alsoExact: ["/creator"],
};
const home: MobileNavItem = { href: "/", label: "홈" };

describe("isMobileNavActive", () => {
  it("keeps 제작 active across studio work screens and the creator dashboard root", () => {
    for (const path of ["/studio", "/studio/library", "/create", "/create/step", "/my-characters", "/creator"]) {
      assert.equal(isMobileNavActive(path, studio), true, path);
    }
  });

  it("does not claim public creator profiles or unrelated paths", () => {
    for (const path of ["/creator/12", "/creators", "/settings", "/", "/chats"]) {
      assert.equal(isMobileNavActive(path, studio), false, path);
    }
  });

  it("home is exact-only", () => {
    assert.equal(isMobileNavActive("/", home), true);
    assert.equal(isMobileNavActive("/tab/new", home), false);
  });
});
