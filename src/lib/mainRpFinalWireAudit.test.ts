/**
 * Locks the production Main RP final-wire shape.
 * No provider calls. Local token estimates are not provider usage.
 */
import Module from "module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { auditAssembledPrompt, PROMPT_DUPLICATE_SAVINGS_CLAIM } from "@/services/promptAudit";
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { COMMON_PROSE_BLOCK } from "@/lib/advancedProseNsfwGuidelines";
import { OOC_HTML_MODE_SYSTEM_DIRECTIVE } from "@/lib/oocHtmlRequest";
import {
  AUDIT_TRPG_SHEET_PROBE,
  COMMON_PROSE_EMOTION_CUE_CANDIDATE,
  liveCommonProseEmotionCueBaseline,
  runMainRpFinalWireAudit,
  type WireCaseResult,
} from "@/lib/mainRpFinalWireAudit";
import { buildOpenRouterMessages } from "@/lib/openRouterAdult";
import {
  ARGON_DIALOGUE_ACTION_INNER_PROHIBITION,
  SHARED_DIALOGUE_ACTION_INNER_PROHIBITION,
} from "@/lib/noGodmodding";

const report = runMainRpFinalWireAudit();

function caseById(id: string): WireCaseResult {
  const found = report.cases.find((entry) => entry.id === id);
  assert.ok(found, id);
  return found;
}

describe("Main RP final-wire audit", () => {
  it("covers every selectable Main RP model", () => {
    assert.deepEqual(
      report.selectableModels.map((model) => model.id),
      [...MAIN_RP_MODEL_IDS]
    );
    assert.equal(report.providerCountedTokens, null);
    for (const modelId of MAIN_RP_MODEL_IDS) {
      assert.ok(report.cases.some((entry) => entry.selectedModelId === modelId));
    }
  });

  it("keeps one length owner on the user turn and one common prose owner", () => {
    for (const entry of report.cases) {
      assert.equal(entry.anchors.lengthOwnerOnUserTurn, 1, entry.id);
      assert.equal(entry.anchors.lengthOwnerOnSystem, 0, entry.id);
      assert.equal(entry.anchors.commonProseInSystem, 1, entry.id);
      assert.equal(new Set(entry.sectionIds).size, entry.sectionIds.length, entry.id);
    }
  });

  it("switches the user-authoring owner with level and auto progression", () => {
    const limited = caseById("ds-interactive-limited-rich");
    const normal = caseById("ds-interactive-normal-rich");
    const allow = caseById("ds-interactive-allow-rich");
    const auto = caseById("ds-auto-normal");
    assert.equal(limited.anchors.collaborativeInteractiveTitle, 1);
    assert.equal(limited.anchors.userAuthoringTitle, 0);
    assert.equal(limited.anchors.coauthorPersistentLine, 0);
    assert.equal(limited.anchors.autoProgressionTitle, 0);
    assert.equal(normal.anchors.collaborativeInteractiveTitle, 0);
    assert.equal(normal.anchors.userAuthoringTitle, 3);
    assert.equal(normal.anchors.coauthorPersistentLine, 1);
    assert.equal(allow.anchors.userAuthoringTitle, 3);
    assert.equal(allow.anchors.coauthorPersistentLine, 1);
    assert.notEqual(
      allow.sections.find((section) => section.id === "no-godmodding")?.sha256,
      normal.sections.find((section) => section.id === "no-godmodding")?.sha256
    );
    assert.equal(auto.anchors.autoProgressionTitle, 1);
    assert.equal(auto.anchors.coauthorPersistentLine, 0);
    assert.equal(auto.anchors.collaborativeInteractiveTitle, 0);
    assert.equal(auto.wire.sceneDirectiveSection, true);
    assert.equal(normal.wire.sceneDirectiveSection, false);
  });

  it("keeps three cache blocks and the pre-fix flat system bytes", () => {
    const normal = caseById("ds-interactive-normal-rich");
    const limited = caseById("ds-interactive-limited-rich");
    const allow = caseById("ds-interactive-allow-rich");
    const auto = caseById("ds-auto-normal");
    const adult = caseById("ds-adult-normal");
    const regen = caseById("ds-regen-normal");
    // #1623 replaced one speech-metadata sentence in the contamination guard (+44).
    // That sentence is the only system-byte change since the 2026-10-02 pin.
    // Character blocks are unchanged. The Gemini 3.8 axis is not in system.
    const preFixFlatSha256 = {
      "ds-interactive-normal-rich":
        "7c922c46fb16c01464cc462493025a46ac480341bcc22dca37d6e90554176726",
      "ds-regen-normal":
        "29e6c4ee9883550690991f80418255f880829305f7bd6b4532f322393ec3bef8",
      "ds-adult-normal":
        "c8bd55bd955df15ad16f9b716c8c632879eaa91394942e0ba17b9b704d37856a",
      "g31-interactive-normal-rich":
        "ef050f76500db339a3797990748ffe0068bcb2df26fcc88747e886afd3831932",
      "opus-interactive-long-history":
        "ef050f76500db339a3797990748ffe0068bcb2df26fcc88747e886afd3831932",
    } as const;

    for (const entry of report.cases) {
      assert.deepEqual(
        entry.wire.systemBlocks.map((block) => block.cached),
        [true, true, false],
        entry.id
      );
      assert.equal(entry.wire.historyCacheBreakpoint, false, entry.id);
      assert.equal(entry.wire.systemBlocks[2]?.cached, false, entry.id);
    }

    for (const [id, flatSha] of Object.entries(preFixFlatSha256)) {
      assert.equal(caseById(id).wire.systemFlatSha256, flatSha, id);
    }

    assert.equal(normal.anchors.scenePacing, 1);
    assert.equal(normal.anchors.sceneFlow, 0);
    assert.equal(normal.wire.scenePacingInsideCachedCharacterBlock, true);
    assert.equal(
      normal.wire.systemBlocks.reduce((sum, block) => sum + block.chars, 0) + 4,
      7805
    );
    assert.equal(normal.localEstimateTokens.cacheRules, 3574);
    assert.equal(normal.localEstimateTokens.cacheCharacter, 1702);
    assert.equal(normal.localEstimateTokens.dynamic, 1746);
    assert.equal(normal.localEstimateTokens.userTurn, 617);
    assert.equal(normal.localEstimateTokens.promptAuditTotal, 7737);

    assert.equal(
      limited.wire.systemBlocks[0]?.sha256,
      "dccfea2dbb6a4024bf9f38428146602c1b5473297b950fa8cb0e46a88cd38741"
    );
    assert.equal(
      limited.wire.systemBlocks[1]?.sha256,
      "828b7691a83279d6a9496edabd6e5e543b1477e3a4314c3143c1234aabfe500d"
    );
    assert.equal(
      limited.wire.systemBlocks[2]?.sha256,
      "75956784b3a4c5195fa5ffcb36780def0905d70b34667ce8667995c3373d505a"
    );
    assert.equal(limited.wire.scenePacingInsideCachedCharacterBlock, true);
    assert.equal(limited.wire.sceneFlowInsideCachedCharacterBlock, false);
    assert.equal(allow.wire.scenePacingInsideCachedCharacterBlock, true);
    assert.equal(auto.wire.sceneFlowInsideCachedCharacterBlock, true);
    assert.equal(auto.anchors.scenePacing, 0);

    assert.equal(normal.wire.systemBlocks[0]?.sha256, adult.wire.systemBlocks[0]?.sha256);
    assert.equal(normal.wire.systemBlocks[0]?.sha256, regen.wire.systemBlocks[0]?.sha256);
    assert.equal(normal.wire.systemBlocks[2]?.sha256, adult.wire.systemBlocks[2]?.sha256);
    assert.notEqual(normal.wire.systemBlocks[1]?.sha256, adult.wire.systemBlocks[1]?.sha256);
    assert.notEqual(normal.wire.systemBlocks[2]?.sha256, regen.wire.systemBlocks[2]?.sha256);
    assert.equal(adult.localEstimateTokens.cacheRules, normal.localEstimateTokens.cacheRules);
    assert.equal(adult.localEstimateTokens.dynamic, normal.localEstimateTokens.dynamic);
    assert.notEqual(adult.localEstimateTokens.cacheCharacter, normal.localEstimateTokens.cacheCharacter);
  });

  it("keeps model adapters on their own wire shapes", () => {
    const gemini31Limited = caseById("g31-interactive-limited-rich");
    assert.equal(gemini31Limited.anchors.gemini31Agency, 1);
    assert.equal(gemini31Limited.anchors.collaborativeInteractiveTitle, 1);
    for (const entry of report.cases) {
      const deepseek = entry.selectedModelId === "deepseek-v4.1-flash";
      const expectsAgency = entry.id === "g31-interactive-limited-rich";
      assert.equal(entry.anchors.gemini31Agency, expectsAgency ? 1 : 0, entry.id);
      assert.equal(entry.anchors.deepseekWorldLoreXml >= 1, deepseek, entry.id);
      assert.equal(entry.wire.assistantPrefill, false, entry.id);
      assert.equal(entry.wire.productionOrderMatchesAssembleOnly, true, entry.id);
      assert.equal(entry.wire.roles[0], "system", entry.id);
      assert.equal(entry.wire.roles.at(-1), "user", entry.id);
      if (entry.transport === "openrouter") {
        assert.equal(entry.wire.providerOnly, "google-ai-studio", entry.id);
        assert.equal(
          entry.wire.serviceTier,
          entry.selectedModelId === "gemini-4-argon" ? "default" : "flex",
          entry.id
        );
        assert.equal(entry.wire.sessionIdPresent, true, entry.id);
        assert.ok(entry.wire.model.startsWith("google/"), entry.id);
        assert.equal(entry.wire.reasoningEffort, null, entry.id);
      } else {
        assert.equal(entry.wire.providerOnly, null, entry.id);
        assert.equal(entry.wire.sessionIdPresent, false, entry.id);
      }
    }
    assert.equal(caseById("ds-interactive-normal-rich").wire.reasoningEffort, "none");
    assert.equal(caseById("sol-interactive-normal-rich").wire.model, "gpt-6.1-sol");
    assert.equal(caseById("sol-interactive-normal-rich").wire.reasoningEffort, "low");
    const opus = caseById("opus-interactive-long-history");
    const opusAuto = caseById("opus-auto-normal");
    assert.equal(opus.wire.reasoningEffort, "low");
    assert.deepEqual(
      opus.wire.systemBlocks.map((block) => block.cached),
      [true, true, false]
    );
    assert.equal(opus.wire.historyCacheBreakpoint, false);
    assert.deepEqual(
      opusAuto.wire.systemBlocks.map((block) => block.cached),
      [true, true, false]
    );
    assert.equal(opusAuto.wire.historyCacheBreakpoint, false);
    assert.deepEqual(caseById("ds-interactive-normal-rich").wire.requestBodyKeys, [
      "messages",
      "model",
      "reasoning_effort",
      "stream",
      "stream_options",
      "temperature",
      "thinking",
      "top_p",
    ]);
    assert.deepEqual(opus.wire.requestBodyKeys, [
      "messages",
      "model",
      "output_config",
      "reasoning_effort",
      "stream",
      "stream_options",
      "temperature",
      "thinking",
    ]);
    assert.equal(caseById("g37-interactive-normal-rich").wire.temperaturePresent, true);
    assert.equal(caseById("g38-interactive-normal-rich").wire.temperaturePresent, false);
    const deepseekCanon = caseById("ds-interactive-limited-rich");
    const geminiCanon = caseById("g31-interactive-limited-rich");
    assert.equal(
      deepseekCanon.sections.find((section) => section.id === "character-core-identity")?.cacheBucket,
      "cacheCharacter"
    );
    assert.equal(
      geminiCanon.sections.find((section) => section.id === "character-core-identity")?.cacheBucket,
      "cacheRules"
    );
  });

  it("treats Gemini 3.7 and 3.8 as the same prompt shape with different wire model ids", () => {
    const flash37 = caseById("g37-interactive-normal-rich");
    const flash38 = caseById("g38-interactive-normal-rich");
    assert.deepEqual(flash37.sectionIds, flash38.sectionIds);
    assert.notEqual(flash37.wire.model, flash38.wire.model);
    assert.deepEqual(
      flash37.sections.map((section) => section.sha256),
      flash38.sections.map((section) => section.sha256)
    );
  });

  it("delivers the OOC HTML directive once on the uncached dynamic block", () => {
    const pairs = [
      ["g31-ooc-html", "g31-interactive-normal-rich"],
      ["ds-ooc-limited", "ds-interactive-limited-rich"],
      ["ds-ooc-allow", "ds-interactive-allow-rich"],
      ["ds-ooc-regen", "ds-regen-normal"],
    ] as const;
    for (const entry of report.cases) {
      if (entry.oocHtml) {
        assert.equal(entry.wire.oocHtmlReachedProviderSystem, true, entry.id);
        assert.equal(entry.anchors.oocHtmlDirective, 1, entry.id);
        assert.equal(entry.wire.oocHtmlDirectiveInCachedBlocks, false, entry.id);
        assert.equal(entry.wire.historyCacheBreakpoint, false, entry.id);
      } else {
        assert.equal(entry.wire.oocHtmlReachedProviderSystem, false, entry.id);
        assert.equal(entry.anchors.oocHtmlDirective, 0, entry.id);
      }
    }
    for (const [oocId, twinId] of pairs) {
      const ooc = caseById(oocId);
      const twin = caseById(twinId);
      assert.equal(ooc.wire.systemBlocks[0]?.sha256, twin.wire.systemBlocks[0]?.sha256, oocId);
      assert.equal(ooc.wire.systemBlocks[1]?.sha256, twin.wire.systemBlocks[1]?.sha256, oocId);
      assert.notEqual(ooc.wire.systemBlocks[2]?.sha256, twin.wire.systemBlocks[2]?.sha256, oocId);
      assert.equal(ooc.wire.systemBlocks[2]?.cached, false, oocId);
      assert.equal(
        ooc.wire.systemBlocks[2]?.chars,
        (twin.wire.systemBlocks[2]?.chars ?? 0) + 2 + OOC_HTML_MODE_SYSTEM_DIRECTIVE.length,
        oocId
      );
      assert.equal(ooc.wire.systemFlatSha256 === twin.wire.systemFlatSha256, false, oocId);
    }
    const widget = caseById("g31-status-widget");
    const plain = caseById("g31-interactive-normal-rich");
    assert.equal(widget.statusWidgetPatchChangedSplit, false);
    assert.equal(
      widget.sections.find((section) => section.id === "state-window-policy"),
      undefined
    );
    assert.deepEqual(
      widget.sections.map((section) => section.sha256),
      plain.sections.map((section) => section.sha256)
    );
  });

  it("places keyword and global lore on the user turn and JSX only when a catalog exists", () => {
    const rich = caseById("ds-interactive-normal-rich");
    const empty = caseById("ds-empty-memory");
    const jsx = caseById("ds-jsx");
    assert.equal(rich.anchors.keywordLoreOnUserTurn, 1);
    assert.equal(rich.anchors.globalLoreOnUserTurn, 1);
    assert.equal(rich.sectionIds.includes("keyword-lorebook"), false);
    assert.equal(empty.anchors.keywordLoreOnUserTurn, 0);
    assert.equal(empty.sectionIds.includes("current-memory"), false);
    assert.equal(jsx.anchors.jsxManifest, 1);
    assert.equal(jsx.sectionIds.includes("jsx-component-manifest"), true);
    assert.equal(rich.anchors.jsxManifest, 0);
    assert.doesNotMatch(jsx.jsxManifestText, /\/\/ when:/);
    const guided = caseById("ds-jsx-call-guide");
    const guide = "새 퀘스트가 등장하거나 주요 진행 상황이 변경되면 사용합니다.";
    assert.equal(guided.anchors.jsxManifest, 1);
    assert.equal(guided.jsxManifestText.split(guide).length - 1, 1);
    assert.equal(guided.jsxManifestText.split("[HAV JSX COMPONENTS]").length - 1, 1);
    assert.doesNotMatch(guided.jsxManifestText, /requestAnimationFrame|sendToChat|export default function/);
  });

  it("keeps a trpg_sheet component out of the final RP request and its token budget", () => {
    const jsx = caseById("ds-jsx");
    const withSheet = caseById("ds-jsx-trpg-sheet");
    assert.equal(withSheet.jsxManifestText, jsx.jsxManifestText);
    assert.doesNotMatch(withSheet.jsxManifestText, new RegExp(`${AUDIT_TRPG_SHEET_PROBE}|auditSheetProbeProp|audit sheet`));
    assert.equal(withSheet.wire.systemFlatSha256, jsx.wire.systemFlatSha256);
    assert.deepEqual(withSheet.wire.systemBlocks, jsx.wire.systemBlocks);
    assert.deepEqual(
      withSheet.sections.map((section) => [section.id, section.sha256]),
      jsx.sections.map((section) => [section.id, section.sha256])
    );
    assert.deepEqual(withSheet.localEstimateTokens, jsx.localEstimateTokens);
  });

  it("replaces only the Argon NORMAL coauthor inner sentence", () => {
    const section = (id: string) =>
      caseById(id).sections.find((row) => row.id === "no-godmodding");
    const sharedIds = [
      "ds-interactive-normal-rich",
      "g31-interactive-normal-rich",
      "g38-interactive-normal-rich",
      "sol-interactive-normal-rich",
      "opus-interactive-long-history",
    ] as const;
    const shared = section(sharedIds[0]);
    assert.ok(shared);
    for (const id of sharedIds) {
      assert.equal(section(id)?.sha256, shared.sha256, id);
      assert.equal(section(id)?.chars, shared.chars, id);
    }
    const argon = section("g4-interactive-normal-rich");
    assert.ok(argon);
    assert.notEqual(argon.sha256, shared.sha256);
    assert.equal(
      argon.chars,
      shared.chars +
        ARGON_DIALOGUE_ACTION_INNER_PROHIBITION.length -
        SHARED_DIALOGUE_ACTION_INNER_PROHIBITION.length
    );
    assert.equal(
      caseById("g4-interactive-normal-rich").anchors.userAuthoringTitle,
      caseById("g38-interactive-normal-rich").anchors.userAuthoringTitle
    );
    assert.equal(
      caseById("ds-auto-normal").sections.find((row) => row.id === "no-godmodding")?.sha256,
      caseById("opus-auto-normal").sections.find((row) => row.id === "no-godmodding")?.sha256
    );
  });

  it("keeps the live cue hashes and isolates the #1288 candidate to one character-block clause", () => {
    const baselineCue = liveCommonProseEmotionCueBaseline();
    assert.equal(COMMON_PROSE_BLOCK.includes(baselineCue), true);
    assert.equal(COMMON_PROSE_BLOCK.includes(COMMON_PROSE_EMOTION_CUE_CANDIDATE), false);
    const expectedDelta = COMMON_PROSE_EMOTION_CUE_CANDIDATE.length - baselineCue.length;
    for (const entry of report.cases) {
      assert.equal(entry.bodyCueCandidate.soleAllowedDiff, true, entry.id);
      assert.equal(entry.bodyCueCandidate.baselineCueCount, 1, entry.id);
      assert.equal(entry.bodyCueCandidate.candidateCueCount, 1, entry.id);
      assert.equal(entry.bodyCueCandidate.forwardMotionCount, 1, entry.id);
      assert.equal(entry.bodyCueCandidate.rulesShaEqual, true, entry.id);
      assert.equal(entry.bodyCueCandidate.dynamicShaEqual, true, entry.id);
      assert.equal(entry.bodyCueCandidate.characterShaChanged, true, entry.id);
      assert.equal(entry.bodyCueCandidate.characterCharDelta, expectedDelta, entry.id);
      assert.equal(entry.bodyCueCandidate.flatCharDelta, expectedDelta, entry.id);
      assert.equal(entry.bodyCueCandidate.cacheShapeEqual, true, entry.id);
      assert.equal(entry.bodyCueCandidate.requestKeysEqual, true, entry.id);
      assert.equal(entry.bodyCueCandidate.oocDirectiveEqual, true, entry.id);
      assert.notEqual(
        entry.wire.systemFlatSha256,
        entry.bodyCueCandidate.candidateFlatSha256,
        entry.id
      );
    }
    assert.equal(
      caseById("ds-interactive-normal-rich").wire.systemFlatSha256,
      "7c922c46fb16c01464cc462493025a46ac480341bcc22dca37d6e90554176726"
    );
    assert.equal(
      caseById("ds-interactive-normal-rich").bodyCueCandidate.candidateFlatSha256,
      "ae5002a7b6ba7ac043058df836542684eddb2a9fe5d1b354ae62c5572beb0cc0"
    );
    assert.equal(
      caseById("ds-interactive-normal-rich").bodyCueCandidate.candidateCharacterSha256,
      "a289c043507d1b63a0a3870d997e6dbb27267325a2668e2f400897d115415a17"
    );
  });

  it("appends the OOC HTML directive once when the request has no system split", () => {
    const history = [{ role: "user" as const, content: "앉아 있어." }];
    const plain = buildOpenRouterMessages("규칙", history);
    const once = buildOpenRouterMessages("규칙", history, { oocHtmlMode: true });
    const twice = buildOpenRouterMessages(
      `${"규칙".trim()}\n\n${OOC_HTML_MODE_SYSTEM_DIRECTIVE}`,
      history,
      { oocHtmlMode: true }
    );
    assert.equal(typeof plain[0]?.content, "string");
    assert.equal(String(plain[0]?.content).includes(OOC_HTML_MODE_SYSTEM_DIRECTIVE), false);
    assert.equal(once[0]?.content, `규칙\n\n${OOC_HTML_MODE_SYSTEM_DIRECTIVE}`);
    assert.equal(twice[0]?.content, once[0]?.content);
    assert.equal(
      String(once[0]?.content).split(OOC_HTML_MODE_SYSTEM_DIRECTIVE).length - 1,
      1
    );
  });

  it("labels promptAudit duplicate waste as a heuristic upper bound", () => {
    const audit = auditAssembledPrompt({
      systemSections: [
        {
          id: "a",
          label: "A",
          category: "systemRules",
          text: "조용한 장면도 요약 없이 대화와 내면과 분위기로 충분히 전개한다. ".repeat(4),
        },
        {
          id: "b",
          label: "B",
          category: "systemRules",
          text: "조용한 장면도 요약 없이 대화와 내면과 분위기로 충분히 전개한다. ".repeat(4),
        },
      ],
      systemPrompt: "x",
      history: [{ role: "user", content: "안녕" }],
    });
    assert.ok(audit.duplicates.length > 0);
    for (const hit of audit.duplicates) {
      assert.equal(hit.savingsClaim, PROMPT_DUPLICATE_SAVINGS_CLAIM);
      assert.ok(hit.estimatedWastedTokens > 0);
    }
  });
});
