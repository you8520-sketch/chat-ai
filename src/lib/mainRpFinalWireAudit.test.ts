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
import { OOC_HTML_MODE_SYSTEM_DIRECTIVE } from "@/lib/oocHtmlRequest";
import { runMainRpFinalWireAudit, type WireCaseResult } from "@/lib/mainRpFinalWireAudit";
import { buildOpenRouterMessages } from "@/lib/openRouterAdult";

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
    const preFixFlatSha256 = {
      "ds-interactive-normal-rich":
        "ca412fccdcc8a7115021b6e7c46e983ccad2d1c374b28c0bbe26050ea1c98f4a",
      "ds-regen-normal":
        "311b58849a342accf443706b63b046b46cc1d78b83f90959370dddefdc99322b",
      "ds-adult-normal":
        "2c3cd7334845ae60211b442e621c69b23fd024623f8a5930ffb55dfc22f01f86",
      "g31-interactive-normal-rich":
        "6b5495a133574c36b6bce7ae02e0901584660ab95343ec632fafac9e2678dbf6",
      "opus-interactive-long-history":
        "6b5495a133574c36b6bce7ae02e0901584660ab95343ec632fafac9e2678dbf6",
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
      7761
    );
    assert.equal(normal.localEstimateTokens.cacheRules, 3535);
    assert.equal(normal.localEstimateTokens.cacheCharacter, 1702);
    assert.equal(normal.localEstimateTokens.dynamic, 1746);
    assert.equal(normal.localEstimateTokens.userTurn, 617);
    assert.equal(normal.localEstimateTokens.promptAuditTotal, 7697);

    assert.equal(
      limited.wire.systemBlocks[0]?.sha256,
      "628e4ed8f6a0a004b1d713a456c26841a65620fceb915ab1bc6166d2ce842b52"
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
        assert.equal(entry.wire.serviceTier, "flex", entry.id);
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
