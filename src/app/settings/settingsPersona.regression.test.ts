import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { canAccessAdultContent, shouldHideAdultListings } from "@/lib/adultVerification";
import { AI_LEARNING_LIMIT } from "@/lib/characterFormLimits";
import {
  UNSAVED_DRAFT_CONFIRM_MESSAGE,
  isPersonaDraftDirty,
  isTitledDraftDirty,
} from "@/lib/personaDraftDirty";
import { USER_NOTE_FOCUS_MAX } from "@/lib/persona";
import { ADMIN_LINK_GROUPS, adminLinkLabel, safetyFilterView } from "@/lib/settingsView";
import type { PublicPersonaListItem } from "@/lib/userPersonasClient";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const settingsSource = read("./SettingsClient.tsx");
const settingsPage = read("./page.tsx");
const personaSource = read("../persona/PersonaClient.tsx");

describe("E4-3G settings: permissions and values stay intact", () => {
  it("keeps the admin link set and the review-count badge", () => {
    const hrefs = ADMIN_LINK_GROUPS.flatMap((group) => group.links.map((link) => link.href));
    assert.equal(hrefs.length, 13);
    assert.equal(new Set(hrefs).size, 13);
    assert.ok(hrefs.every((href) => href.startsWith("/admin/")));
    const review = ADMIN_LINK_GROUPS.flatMap((group) => group.links).find((link) => link.reviewBadge);
    assert.equal(review?.href, "/admin/comment-reports");
    assert.equal(adminLinkLabel(review!, 3), "신고 댓글 관리 (3)");
    assert.equal(adminLinkLabel(review!, 0), "신고 댓글 관리");
    assert.equal(adminLinkLabel({ label: "공지사항 관리" }, 5), "공지사항 관리");
  });

  it("renders admin links only behind the server-provided admin flag", () => {
    assert.match(settingsSource, /\{user\.isAdmin && \(/);
    assert.match(settingsPage, /isAdminUser\(\{ \.\.\.user, is_admin: adminRow\?\.is_admin \?\? 0 \}\)/);
    assert.doesNotMatch(settingsSource, /href="\/admin\//);
  });

  it("keeps the stored meaning of the safety filter: nsfw_on 0 means filter ON", () => {
    const on = safetyFilterView({ nsfwOn: false, isAdult: true, canDisableSafetyFilter: true });
    assert.equal(on.filterOn, true);
    assert.equal(on.stateLabel, "켜짐");
    const off = safetyFilterView({ nsfwOn: true, isAdult: true, canDisableSafetyFilter: true });
    assert.equal(off.filterOn, false);
    assert.equal(off.stateLabel, "꺼짐");
    assert.match(settingsSource, /nsfw_on: nextSafetyOn \? 0 : 1/);
    assert.match(settingsSource, /if \(!user\.canDisableSafetyFilter\) return;/);
    assert.match(settingsSource, /disabled=\{!user\.canDisableSafetyFilter\}/);
  });

  it("locked note names the real policy and never promises unlock through adult verification", () => {
    const LOCKED = "현재는 관리자 베타 테스트 계정에서만 세이프티 필터를 끌 수 있어요.";
    for (const isAdult of [false, true]) {
      const locked = safetyFilterView({ nsfwOn: false, isAdult, canDisableSafetyFilter: false });
      assert.equal(locked.lockedNote, LOCKED);
      assert.doesNotMatch(locked.lockedNote ?? "", /성인인증/);
      assert.match(locked.help, /일반 회원은 끌 수 없습니다/);
      assert.equal(locked.filterOn, true);
    }
    const admin = safetyFilterView({ nsfwOn: false, isAdult: false, canDisableSafetyFilter: true });
    assert.match(admin.help, /관리자 베타 테스트 접근/);
    assert.equal(admin.lockedNote, null);
  });

  it("only the existing admin policy unlocks the filter; stored is_adult does not", () => {
    const regular = { email: "member@example.test", is_admin: 0, is_adult: 1 };
    assert.equal(canAccessAdultContent(regular), false);
    assert.equal(canAccessAdultContent({ ...regular, is_adult: 0 }), false);
    assert.equal(canAccessAdultContent({ ...regular, is_admin: 1 }), true);
    assert.equal(shouldHideAdultListings({ ...regular, nsfw_on: 1 }), true);
    assert.equal(shouldHideAdultListings({ ...regular, is_admin: 1, nsfw_on: 1 }), false);
    assert.equal(shouldHideAdultListings({ ...regular, is_admin: 1, nsfw_on: 0 }), true);
    assert.match(settingsPage, /canDisableSafetyFilter: canAccessAdultContent\(/);
  });

  it("admin toggle keeps the stored value mapping and regular accounts cannot toggle", () => {
    const view = (nsfwOn: boolean, canDisableSafetyFilter: boolean) =>
      safetyFilterView({ nsfwOn, isAdult: false, canDisableSafetyFilter });
    assert.equal(view(false, true).stateLabel, "켜짐");
    assert.equal(view(true, true).stateLabel, "꺼짐");
    assert.equal(view(true, false).filterOn, false);
    assert.match(settingsSource, /if \(!user\.canDisableSafetyFilter\) return;/);
    assert.match(settingsSource, /disabled=\{!user\.canDisableSafetyFilter\}/);
    assert.match(settingsSource, /nsfw_on: nextSafetyOn \? 0 : 1/);
    assert.match(settingsSource, /safety\.lockedNote \?/);
  });

  it("keeps the settings API contract and never adds a /profile route", () => {
    assert.match(settingsSource, /fetch\("\/api\/settings"/);
    assert.match(settingsSource, /method: "PATCH"/);
    assert.match(settingsSource, /\{ nickname \}/);
    assert.match(settingsSource, /\{ pref: value \}/);
    assert.doesNotMatch(settingsSource, /\/profile/);
  });

  it("keeps points display on the same paid/free source", () => {
    assert.match(settingsSource, /total=\{user\.points\}/);
    assert.match(settingsSource, /paid=\{user\.paidPoints\}/);
    assert.match(settingsSource, /free=\{user\.freePoints\}/);
    assert.match(settingsPage, /paidPoints: balance\.paid/);
    assert.match(settingsPage, /freePoints: balance\.free/);
  });
});

describe("E4-3G persona page: boundaries and persistence", () => {
  it("never reads secret source from the public persona list", () => {
    assert.doesNotMatch(personaSource, /\bp\.secret_description\b/);
    assert.doesNotMatch(personaSource, /personas\.map\([^)]*secret_description/);
    assert.match(personaSource, /secretSettings\.canEdit \?/);
    assert.match(personaSource, /resolveSecretDraftOnStartEdit\(editor\)/);
    assert.match(personaSource, /shouldHydrateSecretDraftFromEditor/);
  });

  it("keeps the secret field out of the payload unless the owner may edit and changed it", () => {
    assert.match(personaSource, /secretSettings\.canEdit && creating/);
    assert.match(personaSource, /draftSecretDescriptionLoaded &&\s+draftSecretDescriptionDirty/);
  });

  it("keeps persona, note and status-widget persistence on the existing API routes", () => {
    for (const route of [
      "/api/personas",
      "/api/personas/${editingId}",
      "/api/user-note-presets",
      "/api/status-widget-presets",
      "/api/status-widget-shares",
      "/api/personas/${personaId}/status-widget",
    ]) {
      assert.ok(personaSource.includes(route), `${route} still used`);
    }
    assert.match(personaSource, /readStoredFocus\(noteDraftContent\)/);
    assert.match(personaSource, /validateUserNoteFocusPreset\(focusContent, focusMaxChars\)/);
  });

  it("keeps the plan-limit source and the creator-editor limit separate", () => {
    assert.equal(AI_LEARNING_LIMIT, 12_000);
    assert.equal(USER_NOTE_FOCUS_MAX, 1_000);
    assert.doesNotMatch(personaSource, /AI_LEARNING_LIMIT/);
    assert.match(personaSource, /memoryCapability\?\.focusMaxChars/);
  });

  it("keeps the section anchors other screens deep-link to", () => {
    for (const id of ["personas", "user-note-presets", "status-widget-presets"]) {
      assert.match(personaSource, new RegExp(`id="${id}"`));
    }
  });

  it("does not delete the last persona", () => {
    assert.match(personaSource, /personas\.length <= 1/);
  });
});

describe("E4-3G unsaved draft guard", () => {
  const saved: PublicPersonaListItem = {
    id: 1,
    user_id: 1,
    name: "하루",
    memo: "메모",
    gender: "female",
    description: "설명",
    speech_examples: "",
    image_url: "",
    image_focus_x: 0.5,
    image_focus_y: 0.28,
    active_status_widget_preset_id: null,
    active_status_widget_json: "",
    created_at: "2026-01-01",
  };
  const clean = {
    name: "하루",
    memo: "메모",
    gender: "female",
    description: "설명",
    imageUrl: "",
    imageFocusX: 0.5,
    imageFocusY: 0.28,
    secretDescription: "",
    secretDirty: false,
  };

  it("treats an untouched edit form as clean", () => {
    assert.equal(isPersonaDraftDirty(clean, saved), false);
  });

  it("flags every editable persona field", () => {
    assert.equal(isPersonaDraftDirty({ ...clean, name: "하루2" }, saved), true);
    assert.equal(isPersonaDraftDirty({ ...clean, memo: "다른" }, saved), true);
    assert.equal(isPersonaDraftDirty({ ...clean, gender: "male" }, saved), true);
    assert.equal(isPersonaDraftDirty({ ...clean, description: "설명!" }, saved), true);
    assert.equal(isPersonaDraftDirty({ ...clean, imageUrl: "/uploads/a.webp" }, saved), true);
    assert.equal(isPersonaDraftDirty({ ...clean, imageFocusY: 0.9 }, saved), true);
    assert.equal(isPersonaDraftDirty({ ...clean, secretDirty: true }, saved), true);
  });

  it("flags the secret field only after the owner edited it, never by hydrated content", () => {
    assert.equal(isPersonaDraftDirty({ ...clean, secretDescription: "불러온 비밀" }, saved), false);
  });

  it("treats a blank create form as clean and a filled one as dirty", () => {
    const blank = { ...clean, name: "", memo: "", gender: "", description: "" };
    assert.equal(isPersonaDraftDirty(blank, null), false);
    assert.equal(isPersonaDraftDirty({ ...blank, name: "새" }, null), true);
    assert.equal(isPersonaDraftDirty({ ...blank, gender: "male" }, null), true);
  });

  it("compares note and status-widget drafts by title and content", () => {
    assert.equal(isTitledDraftDirty({ title: "a", content: "b" }, { title: "a", content: "b" }), false);
    assert.equal(isTitledDraftDirty({ title: "a", content: "c" }, { title: "a", content: "b" }), true);
    assert.equal(isTitledDraftDirty({ title: "", content: "" }, null), false);
    assert.equal(isTitledDraftDirty({ title: "x", content: "" }, null), true);
  });

  it("asks before discarding, and uses one message for every form", () => {
    assert.match(UNSAVED_DRAFT_CONFIRM_MESSAGE, /저장하지 않은 변경 사항/);
    assert.equal((personaSource.match(/UNSAVED_DRAFT_CONFIRM_MESSAGE/g) ?? []).length >= 8, true);
  });
});
