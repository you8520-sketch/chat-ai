import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  compileJsxComponentDraft,
  findJsxTrpgSheetComponent,
  parseJsxComponentCatalog,
  parseJsxComponentManifestCatalog,
  parseJsxRuntimeComponentCatalog,
  removeJsxCatalogHead,
  resolveJsxCatalogDraft,
  serializeJsxComponentCatalog,
  validateJsxCallGuideCatalog,
} from "./catalog";
import { JSX_CALL_GUIDE_CATALOG_TOKEN_MAX } from "./limits";
import { resolveJsxComponentPromptBlock } from "./prompt";
import { analyzeJsxCapabilities } from "./capabilities";
import { jsxSurfacePolicyError, parseJsxComponentSurface, validateJsxSurfaceCatalog } from "./surface";
import { TRPG_SHEET_JSX_COMPONENT, TRPG_SHEET_JSX_SOURCE } from "../trpg/sheetJsxSource";

const CHAT_SOURCE = `export default function QuestCard(props) { return <div>{props.title}</div>; }`;
const SHEET_SOURCE = `export default function PartySheet(props) {
  return <button onClick={() => setTrpgActionDraft("free", props.name)}>{props.name} {props.hp}</button>;
}`;

function stored(rows: unknown[]): string {
  return JSON.stringify(rows);
}

const chatRow = {
  name: "QuestCard",
  source: CHAT_SOURCE,
  props: [{ name: "title", type: "string", required: true, description: "quest title" }],
  callGuide: "퀘스트가 나오면 사용",
};
const sheetRow = {
  name: "PartySheet",
  surface: "trpg_sheet",
  source: SHEET_SOURCE,
  props: [{ name: "sheetOnlyProp", type: "string", required: true, description: "sheet prop probe" }],
  callGuide: "sheet guide probe",
};

describe("JSX component surface owner", () => {
  it("A. legacy component with no surface parses as chat and keeps prompt/runtime unchanged", () => {
    const legacy = stored([chatRow]);
    assert.equal(parseJsxComponentSurface(undefined), "chat");
    assert.equal(parseJsxComponentSurface(""), "chat");
    assert.equal(parseJsxComponentSurface("bogus"), null);
    const runtime = parseJsxRuntimeComponentCatalog(legacy);
    assert.deepEqual(runtime.map((c) => c.name), ["QuestCard"]);
    assert.equal(runtime[0]!.surface, undefined);
    const manifest = parseJsxComponentManifestCatalog(legacy);
    assert.deepEqual(manifest, [
      { name: "QuestCard", props: chatRow.props, chatSend: false, callGuide: chatRow.callGuide },
    ]);
    // Legacy bytes round-trip with no surface key added.
    assert.equal(serializeJsxComponentCatalog(parseJsxComponentCatalog(legacy)), legacy);
    assert.equal(parseJsxRuntimeComponentCatalog(stored([{ ...chatRow, surface: "bogus" }])).length, 0);
  });

  it("B. surface=chat is in the ChatClient runtime catalog and the prompt manifest", () => {
    const raw = stored([{ ...chatRow, surface: "chat" }]);
    assert.deepEqual(parseJsxRuntimeComponentCatalog(raw).map((c) => c.name), ["QuestCard"]);
    const block = resolveJsxComponentPromptBlock(parseJsxComponentManifestCatalog(raw));
    assert.ok(block?.includes("QuestCard"));
    assert.equal(serializeJsxComponentCatalog(parseJsxComponentCatalog(raw)), stored([chatRow]));
  });

  it("C. surface=trpg_sheet is excluded from the ChatClient catalog and prompt manifest", () => {
    const raw = stored([chatRow, sheetRow]);
    assert.deepEqual(parseJsxRuntimeComponentCatalog(raw).map((c) => c.name), ["QuestCard"]);
    const block = resolveJsxComponentPromptBlock(parseJsxComponentManifestCatalog(raw)) ?? "";
    assert.doesNotMatch(block, /PartySheet|sheetOnlyProp|sheet prop probe|sheet guide probe/);
    assert.equal(resolveJsxComponentPromptBlock(parseJsxComponentManifestCatalog(stored([sheetRow]))), null);
    assert.equal(parseJsxRuntimeComponentCatalog(stored([sheetRow])).length, 0);
    assert.equal(findJsxTrpgSheetComponent(raw)?.name, "PartySheet");
    assert.equal(findJsxTrpgSheetComponent(stored([chatRow])), null);
    assert.match(serializeJsxComponentCatalog(parseJsxComponentCatalog(raw)), /"surface":"trpg_sheet"/);
  });

  it("D. one character can save one trpg_sheet beside its chat component", () => {
    const chat = compileJsxComponentDraft({ name: "QuestCard", source: CHAT_SOURCE, props: [] });
    assert.ok(chat.ok);
    const withSheet = resolveJsxCatalogDraft([chat.record], {
      surface: "trpg_sheet",
      name: "PartySheet",
      source: SHEET_SOURCE,
      props: [],
    });
    assert.equal(withSheet.error, "");
    assert.deepEqual(withSheet.catalog.map((c) => [c.name, c.surface ?? "chat"]), [
      ["QuestCard", "chat"],
      ["PartySheet", "trpg_sheet"],
    ]);
    assert.equal(validateJsxSurfaceCatalog(withSheet.catalog).ok, true);
    // Editing the chat slot leaves the sheet slot alone, and vice versa.
    const editedChat = resolveJsxCatalogDraft(withSheet.catalog, { name: "QuestCard", source: `${CHAT_SOURCE}\n`, props: [] });
    assert.deepEqual(editedChat.catalog.map((c) => c.name), ["QuestCard", "PartySheet"]);
    const sheetFirst = resolveJsxCatalogDraft([withSheet.catalog[1]!], { name: "QuestCard", source: CHAT_SOURCE, props: [] });
    assert.deepEqual(sheetFirst.catalog.map((c) => c.name), ["QuestCard", "PartySheet"]);
    assert.deepEqual(removeJsxCatalogHead(withSheet.catalog, "trpg_sheet").map((c) => c.name), ["QuestCard"]);
    assert.deepEqual(removeJsxCatalogHead([withSheet.catalog[1]!]).map((c) => c.name), ["PartySheet"]);
  });

  it("E. a second trpg_sheet in the same catalog is rejected at save/validation", () => {
    const parsed = parseJsxComponentCatalog(stored([sheetRow, { ...sheetRow, name: "OtherSheet" }]));
    assert.equal(parsed.length, 2);
    const result = validateJsxSurfaceCatalog(parsed);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /하나만/);
    assert.match(readFileSync("src/lib/characterFormSave.ts", "utf8"), /validateJsxSurfaceCatalog\(parsedJsxCatalog\)/);
  });

  it("F. trpg_sheet records drop the creator prop schema; TrpgSheetSurface is the props contract", () => {
    const compiled = compileJsxComponentDraft({
      surface: "trpg_sheet",
      name: "PartySheet",
      source: SHEET_SOURCE,
      props: [{ name: "x", type: "string", required: true }],
      callGuide: "ignored",
    });
    assert.ok(compiled.ok);
    assert.deepEqual(compiled.record.props, []);
    assert.equal(compiled.record.callGuide, undefined);
    assert.deepEqual(compiled.record.capabilities, ["trpg_action_draft"]);
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    assert.match(dock, /<JsxComponentSandbox\s+compiled=\{renderer\.compiled\}\s+props=\{props\}/);
    assert.match(dock, /JSON\.stringify\(surface\)/);
  });

  it("G. trpg_sheet callGuide never consumes the chat prompt/token budget", () => {
    const huge = "가".repeat(200);
    const sheets = Array.from({ length: 12 }, (_, i) => ({ surface: "trpg_sheet" as const, callGuide: `${huge}${i}` }));
    assert.equal(validateJsxCallGuideCatalog(sheets).ok, true);
    const chatOverBudget = Array.from({ length: 12 }, (_, i) => ({ callGuide: `${huge}${i}` }));
    assert.equal(validateJsxCallGuideCatalog(chatOverBudget).ok, false);
    assert.ok(JSX_CALL_GUIDE_CATALOG_TOKEN_MAX > 0);
  });

  it("surface capability policy is enforced at compile/save, not only at runtime", () => {
    assert.ok(analyzeJsxCapabilities(SHEET_SOURCE).includes("trpg_action_draft"));
    const chatDraft = compileJsxComponentDraft({ name: "QuestCard", source: SHEET_SOURCE, props: [] });
    assert.equal(chatDraft.ok, false);
    assert.match(chatDraft.ok ? "" : chatDraft.error, /setTrpgActionDraft/);
    const sendSheet = compileJsxComponentDraft({
      surface: "trpg_sheet",
      name: "PartySheet",
      source: `export default function PartySheet() { return <button onClick={() => sendToChat("x")}>x</button>; }`,
      props: [],
    });
    assert.equal(sendSheet.ok, false);
    assert.match(sendSheet.ok ? "" : sendSheet.error, /sendToChat/);
    assert.equal(
      compileJsxComponentDraft({
        surface: "trpg_sheet",
        name: "PartySheet",
        source: `export default function PartySheet() { fetch("/x"); return null; }`,
        props: [],
      }).ok,
      false
    );
    // Persisted violators are rejected on save and never served to a reader.
    const forged = parseJsxComponentCatalog(stored([{ ...chatRow, source: SHEET_SOURCE.replace("PartySheet", "QuestCard") }]));
    assert.equal(validateJsxSurfaceCatalog(forged).ok, false);
    assert.equal(parseJsxRuntimeComponentCatalog(stored([{ ...chatRow, source: SHEET_SOURCE }])).length, 0);
    assert.equal(parseJsxComponentManifestCatalog(stored([{ ...chatRow, source: SHEET_SOURCE }])).length, 0);
    assert.equal(
      findJsxTrpgSheetComponent(stored([{ ...sheetRow, source: `export default function PartySheet() { return <b onClick={() => sendToChat("x")}>x</b>; }` }])),
      null
    );
    assert.equal(jsxSurfacePolicyError("trpg_sheet", analyzeJsxCapabilities(TRPG_SHEET_JSX_SOURCE)), null);
    assert.equal(TRPG_SHEET_JSX_COMPONENT, "TrpgSheet");
  });

  it("creator editor exposes the surface choice and a fixed-data sheet editor without AI prop schema", () => {
    const editor = readFileSync("src/components/JsxComponentCatalogEditor.tsx", "utf8");
    assert.match(editor, /채팅 중 호출/);
    assert.match(editor, /TRPG 캐릭터 시트/);
    assert.match(editor, /buildJsxComponentManifestBlock\(selectJsxSurfaceComponents\(value, "chat"\)\)/);
    assert.doesNotMatch(editor, /value\[0\]/);
    const sheet = readFileSync("src/components/JsxTrpgSheetSlotEditor.tsx", "utf8");
    assert.match(sheet, /AI가 답변에서\s+호출하는 컴포넌트가 아니며/);
    assert.match(sheet, /sampleTrpgSheetSurface\(\)/);
    assert.match(sheet, /<JsxComponentSandbox compiled=\{preview\.compiled\} props=\{sample\}/);
    assert.doesNotMatch(sheet, /onTrpgActionDraft|chatSendEnabled|AI 호출 설명|Prop 직접 추가/);
  });
});
