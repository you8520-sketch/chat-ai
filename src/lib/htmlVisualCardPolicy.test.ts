import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeChatVisualCardHtml } from "@/lib/chatHtmlSanitize";
import {
  buildHtmlVisualCardPolicyBlock,
  enforceHtmlStatusWindowFieldLabels,
  resolveHtmlFlashPlacement,
  resolveHtmlVisualCardPolicyFromSources,
  stripHtmlStatusWindowTitleBanner,
  stripPromotedHtmlVisualCardContent,
  isOocCreativeHtmlRichEnough,
  OOC_DETAILED_MIN_PLAIN_CHARS,
  resolveOocMinPlainChars,
  oocRequestsDetailedContent,
  isPreservableOocHtmlInner,
  isGenericHtmlStatusWindowInner,
  ensureOocHtmlSectionSpacing,
  buildOocCategoryCardReferenceTemplate,
  oocFlashHtmlMustBeRejected,
  oocHtmlHasAdequateSectionSpacing,
  oocRequestsAnonymousInbox,
  userRequestsBroadRpContext,
  userRequestsConversationHistoryReference,
  userRequestsLongTermMemoryReference,
  combineFlashLongTermMemoryBody,
  parseOocBracketCategories,
  parseOocMinQaCount,
  visiblePlainFromHtmlInner,
  isDefaultRpStatusWindowFieldSetInner,
  isPlaceholderOnlyStatusWindowInner,
  buildHtmlStatusWindowCardFromFields,
  userMessageRequestsHtmlVisualCard,
  userRequestsHtmlOutput,
  userRequestsPlainOrMarkdownOutput,
} from "@/lib/htmlVisualCardPolicy";

describe("userRequestsPlainOrMarkdownOutput", () => {
  it("detects plain status window without HTML", () => {
    assert.equal(
      userRequestsPlainOrMarkdownOutput("다음 상태창을 본문하단에 출력"),
      true
    );
  });

  it("detects explicit markdown status OOC", () => {
    assert.equal(
      userRequestsPlainOrMarkdownOutput("(OOC: 상태창 마크다운으로 보여줘)"),
      true
    );
  });

  it("returns false when HTML is requested", () => {
    assert.equal(
      userRequestsPlainOrMarkdownOutput("HTML로 상태창 표기"),
      false
    );
  });
});

describe("userRequestsHtmlOutput", () => {
  it("does not treat HTML-less output phrasing as HTML request", () => {
    assert.equal(userRequestsHtmlOutput("HTML 없이 상태창 출력"), false);
    assert.equal(userRequestsHtmlOutput("without HTML status output"), false);
  });

  it("detects explicit HTML output request", () => {
    assert.equal(userRequestsHtmlOutput("HTML을 사용해서 상태창 표기"), true);
  });
});

describe("resolveHtmlVisualCardPolicyFromSources", () => {
  it("enables from user note HTML output request", () => {
    const r = resolveHtmlVisualCardPolicyFromSources({
      userNote: "ooc: 맛집 TOP5를 HTML 카드로 출력해줘",
    });
    assert.equal(r.enabled, true);
    assert.equal(r.standing, true);
    assert.equal(r.policyBlock, "");
  });

  it("enables from status window HTML output request in note", () => {
    const note = `ooc:다음상태창을 본문하단에 HTML을 사용하여 표기할것

💡 NPC의 속마음 한 줄
📝 현재 상황을 짧게 요약
🔍 하고 싶은 것 1,  2, 3
✅ NPC의 낙서 한 줄(카오모지, 이모지 사용)|`;
    const r = resolveHtmlVisualCardPolicyFromSources({ userNote: note });
    assert.equal(r.enabled, true);
    assert.equal(r.standing, true);
    assert.equal(r.policyBlock, "");
    assert.deepEqual(r.statusFieldLabels, [
      "NPC의 속마음 한 줄",
      "현재 상황을 짧게 요약",
      "하고 싶은 것 1,  2, 3",
      "NPC의 낙서 한 줄(카오모지, 이모지 사용)",
    ]);
  });

  it("extracts plain-text status field labels without emoji when HTML standing is set", () => {
    const note = `ooc:다음상태창을 본문하단에 HTML을 사용하여 표기할것

NPC의 속마음 한 줄
현재 상황을 짧게 요약
하고 싶은 것 1,  2,  3
NPC의 낙서 한 줄(카오모지, 이모지 사용)
NPC 이름은 철수.`;
    const r = resolveHtmlVisualCardPolicyFromSources({ userNote: note });
    assert.equal(r.enabled, true);
    assert.equal(r.standing, true);
    assert.deepEqual(r.statusFieldLabels, [
      "NPC의 속마음 한 줄",
      "현재 상황을 짧게 요약",
      "하고 싶은 것 1,  2,  3",
      "NPC의 낙서 한 줄(카오모지, 이모지 사용)",
    ]);
    assert.doesNotMatch(r.statusFieldLabels.join("\n"), /철수/);
  });

  it("does not enable from card or scenario keywords without HTML", () => {
    assert.equal(
      resolveHtmlVisualCardPolicyFromSources({
        userMessage: "맛집 TOP5 카드로 보여줘",
      }).enabled,
      false
    );
    assert.equal(
      resolveHtmlVisualCardPolicyFromSources({
        userNote: "ooc: 카드형 템플릿으로 인라인 style 출력",
      }).enabled,
      false
    );
  });

  it("enables when HTML is explicitly requested for arbitrary content", () => {
    const r = resolveHtmlVisualCardPolicyFromSources({
      userMessage: "HTML을 사용해서 맛집 TOP5를 띄워줘",
    });
    assert.equal(r.enabled, true);
    assert.equal(r.standing, false);
    assert.equal(r.policyBlock, "");
  });

  it("does not enable from incidental HTML mention without output intent", () => {
    assert.equal(
      resolveHtmlVisualCardPolicyFromSources({
        characterSetting: "This world forbids raw HTML injection in chat logs.",
      }).enabled,
      false
    );
  });

  it("enables messenger and alert turn triggers without legacy policy block", () => {
    const messenger = resolveHtmlVisualCardPolicyFromSources({
      userMessage: "HTML을 사용해서 카톡 내역을 출력해줘",
    });
    assert.equal(messenger.enabled, true);
    assert.equal(messenger.policyBlock, "");

    const alert = resolveHtmlVisualCardPolicyFromSources({
      userMessage: "HTML을 사용해서 경고창을 표기해줘",
    });
    assert.equal(alert.enabled, true);
    assert.equal(alert.policyBlock, "");
  });

  it("does not enable from messenger keyword without HTML", () => {
    const r = resolveHtmlVisualCardPolicyFromSources({
      userMessage: "카톡 내역 보여줘",
    });
    assert.equal(r.enabled, false);
  });

  it("enables from alert keyword with HTML in note", () => {
    const r = resolveHtmlVisualCardPolicyFromSources({
      userNote: "ooc: HTML로 시스템 경고창 출력",
    });
    assert.equal(r.enabled, true);
    assert.equal(r.standing, true);
  });

  it("does not enable from alert keyword without HTML", () => {
    const r = resolveHtmlVisualCardPolicyFromSources({
      userMessage: "시스템 경고창 띄워줘",
    });
    assert.equal(r.enabled, false);
  });

  it("enables from messenger keyword with HTML in note", () => {
    const r = resolveHtmlVisualCardPolicyFromSources({
      userNote: "ooc: 카톡 대화 내역을 HTML로 보여줘",
    });
    assert.equal(r.enabled, true);
    assert.equal(r.standing, true);
  });

  it("enables from chat message turn trigger", () => {
    const r = resolveHtmlVisualCardPolicyFromSources({
      userMessage: "(OOC: 스마트폰 화면 HTML로 보여줘)",
    });
    assert.equal(r.enabled, true);
    assert.equal(r.standing, false);
  });

  it("enables from character setting HTML request", () => {
    const r = resolveHtmlVisualCardPolicyFromSources({
      characterSetting: "When user asks for battle report, output as ```html visual card.",
    });
    assert.equal(r.enabled, true);
    assert.equal(r.standing, true);
  });

  it("extracts status field labels from pipe-table template rows", () => {
    const note = `ooc:다음상태창을 본문하단에 HTML을 사용하여 표기할것
|:---:|:---
|상태창||🕒00:00|🏠00|
|💡 NPC의 속마음 한 줄|
|📝 현재 상황을 짧게 요약|
|🔍 하고 싶은 것 1,  2, 3|`;
    const r = resolveHtmlVisualCardPolicyFromSources({ userNote: note });
    assert.deepEqual(r.statusFieldLabels, [
      "NPC의 속마음 한 줄",
      "현재 상황을 짧게 요약",
      "하고 싶은 것 1,  2, 3",
    ]);
  });

  it("enforceHtmlStatusWindowFieldLabels strips undeclared Flash fields", () => {
    const wrongHtml = `\`\`\`html
<div><p style="font-weight:700">HP</p><p>100/100</p>
<p style="font-weight:700">MP</p><p>50/50</p></div>
\`\`\``;
    const labels = ["NPC의 속마음 한 줄", "현재 상황을 짧게 요약"];
    const enforced = enforceHtmlStatusWindowFieldLabels(wrongHtml, labels);
    assert.ok(enforced);
    assert.match(enforced!, /NPC의 속마음 한 줄/);
    assert.match(enforced!, /현재 상황을 짧게 요약/);
    assert.doesNotMatch(enforced!, /\bHP\b/);
    assert.doesNotMatch(enforced!, /\bMP\b/);
  });

  it("preserveFlashStatusWindowLayout strips centered 상태창 banner", () => {
    const labels = ["NPC의 속마음 한 줄", "현재 상황을 짧게 요약"];
    const customHtml = `\`\`\`html
<div style="padding:16px;border-radius:12px;background:#f3f4f6">
<p style="text-align:center;font-weight:700">상태창</p>
<section style="margin-bottom:12px"><h4 style="font-weight:600;color:#374151">NPC의 속마음 한 줄</h4><p style="color:#111">조용히 숨을 고른다.</p></section>
<section><h4 style="font-weight:600;color:#374151">현재 상황을 짧게 요약</h4><p style="color:#111">늦은 밤, 창가 자리.</p></section>
</div>
\`\`\``;
    const enforced = enforceHtmlStatusWindowFieldLabels(customHtml, labels);
    assert.ok(enforced);
    assert.doesNotMatch(enforced!, />\s*상태창\s*</);
    assert.match(enforced!, /NPC의 속마음 한 줄/);
  });

  it("preserveFlashStatusWindowLayout keeps Flash custom design when labels match", () => {
    const labels = ["NPC의 속마음 한 줄", "현재 상황을 짧게 요약"];
    const customHtml = `\`\`\`html
<div style="padding:16px;border-radius:12px;background:#f3f4f6">
<section style="margin-bottom:12px"><h4 style="font-weight:600;color:#374151">NPC의 속마음 한 줄</h4><p style="color:#111">조용히 숨을 고른다.</p></section>
<section><h4 style="font-weight:600;color:#374151">현재 상황을 짧게 요약</h4><p style="color:#111">늦은 밤, 창가 자리.</p></section>
</div>
\`\`\``;
    const enforced = enforceHtmlStatusWindowFieldLabels(customHtml, labels);
    assert.ok(enforced);
    assert.match(enforced!, /#f3f4f6|border-radius:12px/);
    assert.doesNotMatch(enforced!, /border-left:3px solid #4a90e2/);
    assert.doesNotMatch(enforced!, /text-align:center[^>]*>\s*상태창/i);
  });

  it("keeps HTML status field labels when HTML standing wins over markdown flag", () => {
    const note = `ooc:다음상태창을 본문하단에 HTML을 사용하여 표기할것
|:---:|:---
|상태창||🕒00:00|🏠00|
|💡 NPC의 속마음 한 줄|`;
    const r = resolveHtmlVisualCardPolicyFromSources({
      userNote: note,
      markdownStatusWindowActive: true,
    });
    assert.equal(r.enabled, true);
    assert.equal(r.standing, true);
    assert.deepEqual(r.statusFieldLabels, ["NPC의 속마음 한 줄"]);
  });

  it("keeps HTML messenger standing when markdown pipe-table is active", () => {
    const note = `ooc: 매 턴 본문 상단에 HTML로 카톡 내역 출력
|:---:|:---
|상태창||🕒00:00|`;
    const r = resolveHtmlVisualCardPolicyFromSources({
      userNote: note,
      markdownStatusWindowActive: true,
    });
    assert.equal(r.enabled, true);
    assert.equal(r.standing, true);
    assert.deepEqual(r.statusFieldLabels, []);
  });

  it("turn-trigger HTML works alongside markdown status window flag", () => {
    const r = resolveHtmlVisualCardPolicyFromSources({
      userNote: `|a|b|\n|:---:|:---:|\n|1|2|`,
      userMessage: "HTML을 사용해서 카톡 내역을 출력해줘",
      markdownStatusWindowActive: true,
    });
    assert.equal(r.enabled, true);
    assert.equal(r.standing, false);
  });

  it("plain every-turn user note suppresses character HTML status field labels", () => {
    const plainNote = `다음 상태창을 본문하단에 출력

NPC의 속마음 한 줄
현재 상황을 짧게 요약
하고 싶은 것 1,  2, 3
nPC의 낙서 한 줄(카오모지, 이모지 사용)`;
    const characterSetting = `ooc: 상태창을 HTML로 본문 하단에 표기

💡 NPC의 속마음 한 줄
📝 현재 상황을 짧게 요약`;
    const r = resolveHtmlVisualCardPolicyFromSources({
      userNote: plainNote,
      characterSetting,
      markdownStatusWindowActive: true,
    });
    assert.equal(r.enabled, false);
    assert.deepEqual(r.statusFieldLabels, []);
  });

  it("disables HTML Flash when chat requests markdown status without HTML", () => {
    const r = resolveHtmlVisualCardPolicyFromSources({
      characterSetting: "ooc: HTML로 상태창 표기",
      userMessage: "(OOC: 상태창 마크다운으로 보여줘)",
    });
    assert.equal(r.enabled, false);
  });

  it("allows HTML Flash turn trigger when chat explicitly requests HTML", () => {
    const plainNote = `다음 상태창을 본문하단에 출력
NPC의 속마음 한 줄`;
    const r = resolveHtmlVisualCardPolicyFromSources({
      userNote: plainNote,
      markdownStatusWindowActive: true,
      userMessage: "HTML을 사용해서 카톡 내역을 출력해줘",
    });
    assert.equal(r.enabled, true);
    assert.equal(r.standing, false);
    assert.deepEqual(r.statusFieldLabels, []);
  });

  it("respects HTML output deny", () => {
    const r = resolveHtmlVisualCardPolicyFromSources({
      userNote: "HTML 출력 금지",
      userMessage: "HTML 카드로 프로필 보여줘",
    });
    assert.equal(r.enabled, false);
  });

  it("buildHtmlVisualCardPolicyBlock is deprecated empty stub", () => {
    const fields = ["NPC의 속마음 한 줄", "현재 상황을 짧게 요약"];
    assert.equal(buildHtmlVisualCardPolicyBlock({ standing: true, statusFieldLabels: fields }), "");
  });

  it("strips promoted status field lines when standing", () => {
    const note = `ooc: HTML 상태창 표기
💡 NPC의 속마음 한 줄
NPC 이름은 철수.`;
    const policy = resolveHtmlVisualCardPolicyFromSources({ userNote: note });
    const stripped = stripPromotedHtmlVisualCardContent(note, policy.statusFieldLabels);
    assert.match(stripped, /NPC 이름은 철수/);
    assert.doesNotMatch(stripped, /속마음/);
  });
});

describe("resolveHtmlFlashPlacement", () => {
  it("standing policy → bottom", () => {
    const policy = resolveHtmlVisualCardPolicyFromSources({
      userNote: "ooc:다음상태창을 본문하단에 HTML을 사용하여 표기할것",
    });
    assert.equal(policy.standing, true);
    assert.equal(resolveHtmlFlashPlacement(policy, {}), "bottom");
  });

  it("turn-trigger HTML defaults to top", () => {
    const policy = resolveHtmlVisualCardPolicyFromSources({
      userMessage: "HTML을 사용해서 맛집 TOP5를 띄워줘",
    });
    assert.equal(policy.standing, false);
    assert.equal(resolveHtmlFlashPlacement(policy, { userMessage: "HTML을 사용해서 맛집 TOP5를 띄워줘" }), "top");
  });

  it("explicit bottom hint → bottom even for turn trigger", () => {
    const policy = resolveHtmlVisualCardPolicyFromSources({
      userMessage: "HTML을 사용해서 맛집 TOP5를 띄워줘",
    });
    assert.equal(
      resolveHtmlFlashPlacement(policy, { userMessage: "HTML로 맛집 TOP5 본문 하단에 출력" }),
      "bottom"
    );
  });

  it("standing policy respects explicit top in note", () => {
    const policy = resolveHtmlVisualCardPolicyFromSources({
      userNote: "ooc: 매 턴 본문 상단에 HTML로 상태창 표기",
    });
    assert.equal(policy.standing, true);
    assert.equal(
      resolveHtmlFlashPlacement(policy, {
        userNote: "ooc: 매 턴 본문 상단에 HTML로 상태창 표기",
      }),
      "top"
    );
  });
});

describe("userMessageRequestsHtmlVisualCard", () => {
  it("detects explicit html fence request", () => {
    assert.equal(userMessageRequestsHtmlVisualCard("```html로 전투 리포트 출력"), true);
  });

  it("detects HTML usage phrase with output verb", () => {
    assert.equal(userMessageRequestsHtmlVisualCard("HTML을 사용해서 맛집 TOP5를 띄워줘"), true);
    assert.equal(userMessageRequestsHtmlVisualCard("HTML로 전투 리포트 출력해줘"), true);
  });

  it("ignores normal RP", () => {
    assert.equal(userMessageRequestsHtmlVisualCard("계속 이야기해줘"), false);
  });
});

describe("stripPromotedHtmlVisualCardContent", () => {
  it("removes html fence blocks and directive lines", () => {
    const note = `[SYSTEM: HTML VISUAL CARD MODE]
\`\`\`html
<div>template</div>
\`\`\`
NPC 이름은 철수.`;
    const stripped = stripPromotedHtmlVisualCardContent(note);
    assert.match(stripped, /NPC 이름은 철수/);
    assert.doesNotMatch(stripped, /HTML VISUAL CARD/);
    assert.doesNotMatch(stripped, /```html/);
  });
});

describe("stripHtmlStatusWindowTitleBanner", () => {
  it("removes centered p/h banner but keeps real field labels", () => {
    const inner = `<div><p style="text-align:center">상태창</p><h4>NPC 속마음</h4><p>내용</p></div>`;
    const stripped = stripHtmlStatusWindowTitleBanner(inner);
    assert.doesNotMatch(stripped, />\s*상태창\s*</);
    assert.match(stripped, /NPC 속마음/);
  });

  it("does not remove OOC UI titles that are not exactly 상태창", () => {
    const inner = `<div><h2 style="text-align:center">익명 메시지함</h2><p>질문 1</p></div>`;
    const stripped = stripHtmlStatusWindowTitleBanner(inner);
    assert.match(stripped, /익명 메시지함/);
  });

  it("preserves partial OOC inbox HTML without balanced divs", () => {
    const inboxOoc = "OOC: 익명 메시지함 HTML. 질문과 답변을 각각 5개 이상";
    const qaBlock =
      "<section><p>익명 질문 " +
      "팬덤 논쟁 ".repeat(15) +
      "</p><p>답변 " +
      "코믹 상세 ".repeat(15) +
      "</p></section>";
    const inner = `<section style="padding:12px"><h2>익명 메시지함</h2>${qaBlock.repeat(6)}</section>`;
    assert.equal(isPreservableOocHtmlInner(inner, inboxOoc), true);
    assert.equal(isGenericHtmlStatusWindowInner(inner), false);
    assert.equal(oocFlashHtmlMustBeRejected(inner), false);
  });

  it("rejects default RP status placeholder triple (section layout)", () => {
    const inner = buildHtmlStatusWindowCardFromFields([
      { label: "현재 상황", content: "—" },
      { label: "속마음", content: "—" },
      { label: "다음 행동", content: "—" },
    ]);
    assert.equal(isDefaultRpStatusWindowFieldSetInner(inner), true);
    assert.equal(isPlaceholderOnlyStatusWindowInner(inner), true);
    assert.equal(isGenericHtmlStatusWindowInner(inner), true);
    assert.equal(oocFlashHtmlMustBeRejected(inner), true);
    assert.equal(isPreservableOocHtmlInner(inner), false);
  });

  it("rejects inbox header-only HTML without message body", () => {
    const inboxOoc = `OOC: 익명 메시지함 HTML. 질문과 답변을 각각 5개 이상`;
    const headerOnly = `<div style="padding:12px"><h2>@공식계정</h2><p>안녕하세요, 공식 계정입니다. 익명 메시지 환영!</p></div>`;
    assert.equal(isOocCreativeHtmlRichEnough(headerOnly, inboxOoc), false);
    assert.equal(isPreservableOocHtmlInner(headerOnly, inboxOoc), false);
  });

  it("accepts rich anonymous inbox HTML with multiple messages", () => {
    const inboxOoc = `OOC: 익명 메시지함. 질문과 답변을 각각 5개 이상`;
    const rich =
      `<div><header>@계정</header><p>bio</p>` +
      `<section><p>Q1 익명 질문 내용 ${"팬덤".repeat(20)}</p><p>A1 답변 ${"코믹".repeat(20)}</p></section>`.repeat(5) +
      `</div>`;
    assert.equal(parseOocMinQaCount(inboxOoc), 5);
    assert.equal(oocRequestsAnonymousInbox(inboxOoc), true);
    assert.equal(isOocCreativeHtmlRichEnough(rich, inboxOoc), true);
  });

  it("parseOocBracketCategories extracts 추구미 five categories", () => {
    const ooc =
      "OOC: 대화 잠시 중지. 항목은[외형 · 키워드 · 모에화(동물, 과일 등)· 기타 상징(계절, 오브제 등) · 대외적 이미지(별명, 평판 등)]로 5개";
    const cats = parseOocBracketCategories(ooc);
    assert.equal(cats.length, 5);
    assert.deepEqual(cats, ["외형", "키워드", "모에화", "기타 상징", "대외적 이미지"]);
  });

  it("ensureOocHtmlSectionSpacing splits run-on category card into spaced blocks", () => {
    const ooc =
      "OOC: 추구미. 항목은[외형 · 키워드 · 모에화 · 기타 상징 · 대외적 이미지]로 작성";
    const crammed = `<div style="padding:12px;color:#222">외형: 은발 롱헤어, 키워드: 츤데레, 모에화: 고양이, 기타 상징: 겨울, 대외적 이미지: 빙공주</div>`;
    assert.equal(oocHtmlHasAdequateSectionSpacing(crammed, parseOocBracketCategories(ooc)), false);
    const spaced = ensureOocHtmlSectionSpacing(crammed, ooc);
    assert.match(spaced, /<section\b/);
    assert.match(spaced, /외형/);
    assert.match(spaced, /키워드/);
    assert.match(spaced, /모에화/);
    assert.ok((spaced.match(/<section\b/gi) ?? []).length >= 3);
  });

  it("detailed category OOC requires 1500 visible plain chars", () => {
    const ooc =
      "OOC: 추구미를 자세히. 항목은[외형 · 키워드 · 모에화 · 기타 상징 · 대외적 이미지]로 작성";
    assert.equal(resolveOocMinPlainChars(ooc), OOC_DETAILED_MIN_PLAIN_CHARS);
    const stub = `<div>${"키워드 요약 한 줄입니다. ".repeat(65)}</div>`;
    assert.ok(stub.length > 800);
    assert.ok(stub.length < OOC_DETAILED_MIN_PLAIN_CHARS);
    assert.equal(isOocCreativeHtmlRichEnough(stub, ooc), false);
  });

  it("userRequestsConversationHistoryReference detects history cues", () => {
    assert.equal(
      userRequestsConversationHistoryReference("지금까지의 대화 내용을 참고해서 HTML"),
      true
    );
    assert.equal(userRequestsConversationHistoryReference("안녕"), false);
  });

  it("userRequestsLongTermMemoryReference detects memory cues", () => {
    assert.equal(
      userRequestsLongTermMemoryReference("최근대화와 장기기억을 참고해서 HTML"),
      true
    );
    assert.equal(userRequestsLongTermMemoryReference("안녕"), false);
  });

  it("userRequestsBroadRpContext detects 추구미-style grounding without full dump intent", () => {
    const ooc =
      "캐릭터 설정/성격/말투/세계관/관계성/유저노트/누적대화 등을 참조하여 자세히 작성";
    assert.equal(userRequestsBroadRpContext(ooc), true);
    assert.equal(userRequestsBroadRpContext("HTML 카드만 출력"), false);
  });

  it("combineFlashLongTermMemoryBody dedupes archive already in memory block", () => {
    const archive = "과거 아카이브 사건 요약";
    const block = `[현재기억]\n요약 본문\n\n${archive}`;
    assert.equal(combineFlashLongTermMemoryBody(block, archive), block);
    assert.equal(
      (combineFlashLongTermMemoryBody(block, archive).match(/\[과거 기억\]/g) ?? []).length,
      0
    );
  });

  it("combineFlashLongTermMemoryBody appends distinct archive once", () => {
    const result = combineFlashLongTermMemoryBody("[현재기억]\nrecent summary", "old archive text");
    assert.match(result, /\[과거 기억\]\nold archive text/);
    assert.equal((result.match(/\[과거 기억\]/g) ?? []).length, 1);
  });

  it("buildOocCategoryCardReferenceTemplate renders pretty section card", () => {
    const html = buildOocCategoryCardReferenceTemplate(["외형", "키워드"], { title: "추구미" });
    assert.match(html, /추구미/);
    assert.match(html, /border-radius:16px/);
    assert.match(html, /<section\b/);
  });
});

describe("sanitizeChatVisualCardHtml", () => {
  it("allows div/p/h3 inline card template tags", () => {
    const html = `<div style="max-width:450px;padding:20px;"><h3>Title</h3><p>Body</p></div>`;
    const safe = sanitizeChatVisualCardHtml(html);
    assert.match(safe, /<div/);
    assert.match(safe, /<h3/);
    assert.match(safe, /<p/);
    assert.doesNotMatch(safe, /script/i);
  });

  it("strips script tags", () => {
    const safe = sanitizeChatVisualCardHtml(`<div><script>alert(1)</script></div>`);
    assert.doesNotMatch(safe, /script/i);
  });
});
