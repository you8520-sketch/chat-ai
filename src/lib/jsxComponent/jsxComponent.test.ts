import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyzeJsxCapabilities } from "./capabilities.ts";
import {
  compileJsxComponentDraft,
  parseJsxComponentCatalog,
  parseJsxComponentManifestCatalog,
  parseJsxRuntimeComponentCatalog,
  resolveJsxCatalogDraft,
  serializeJsxComponentCatalog,
  validateJsxCallGuideCatalog,
} from "./catalog.ts";
import { compileJsxComponentSource } from "./compile.ts";
import { decideJsxHostBridgeAction } from "./hostBridge.ts";
import { extractJsxInvocations, isIncompleteJsxInvocation, resolveJsxInvocationProps } from "./invocation.ts";
import {
  JSX_BRIDGE_MAX_TEXT,
  JSX_CALL_GUIDE_CATALOG_TOKEN_MAX,
  JSX_CALL_GUIDE_MAX_CHARS,
  JSX_PROP_MAX,
} from "./limits.ts";
import { buildJsxComponentManifestBlock } from "./manifest.ts";
import {
  buildPitWallFixtureRecord,
  PIT_WALL_FIXTURE_PROPS,
  PIT_WALL_FIXTURE_SOURCE,
} from "./pitWallFixture.ts";
import { resolveJsxComponentPromptBlock } from "./prompt.ts";

describe("compileJsxComponentSource", () => {
  it("compiles a function component and rejects network/eval", () => {
    const ok = compileJsxComponentSource(
      `export default function Board(props) { return <div>{props.hp}</div>; }`
    );
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.match(ok.compiled, /function Board/);
      assert.equal(ok.chatSend, false);
    }
    const networked = compileJsxComponentSource(
      `export default function Board() { fetch("/api/chat"); return <div />; }`
    );
    assert.equal(networked.ok, false);
    const evaled = compileJsxComponentSource(
      `export default function Board() { eval("1"); return <div />; }`
    );
    assert.equal(evaled.ok, false);
    const dynamicImport = compileJsxComponentSource(
      `export default function Board() { import("/client.js"); return <div />; }`
    );
    assert.equal(dynamicImport.ok, false);
    const functionCtor = compileJsxComponentSource(
      `export default function Board() { Function("return 1")(); return <div />; }`
    );
    assert.equal(functionCtor.ok, false);
    const storage = compileJsxComponentSource(
      `export default function Board() { localStorage.setItem("x", "1"); return <div />; }`
    );
    assert.equal(storage.ok, false);
    const navigation = compileJsxComponentSource(
      `export default function Board() { window.location.href = "https://example.com"; return <div />; }`
    );
    assert.equal(navigation.ok, false);
    const anchorNavigation = compileJsxComponentSource(
      `export default function Board() { return <a href="https://example.com">go</a>; }`
    );
    assert.equal(anchorNavigation.ok, false);

    const guideStyle = compileJsxComponentSource(
      `function StatusBoard({ hp = 0 }) {
        const [open, setOpen] = useState(false);
        useEffect(() => {}, []);
        return <button type="button" onClick={() => setOpen(!open)}>{hp}:{String(open)}</button>;
      }`,
      "StatusBoard"
    );
    assert.equal(guideStyle.ok, true, "Teapot guide-style named component must compile without export default");
    if (guideStyle.ok) {
      assert.match(guideStyle.compiled, /typeof StatusBoard === "function"/);
    }
  });
});

describe("analyzeJsxCapabilities", () => {
  it("flags chat_send from sendToChat and local/canvas/animation hooks", () => {
    const caps = analyzeJsxCapabilities(PIT_WALL_FIXTURE_SOURCE);
    assert.ok(caps.includes("local_state"));
    assert.ok(caps.includes("animation"));
    assert.ok(caps.includes("canvas"));
    assert.ok(caps.includes("chat_send"));
    assert.ok(!caps.includes("external_network"));
  });
});

describe("PitWall fixture", () => {
  it("compiles with 20+ props and chat action capability", () => {
    assert.ok(PIT_WALL_FIXTURE_PROPS.length >= 20);
    const record = buildPitWallFixtureRecord();
    assert.equal(record.name, "PitWallFixture");
    assert.equal(record.chatSend, true);
    assert.ok(record.capabilities.includes("chat_send"));
    assert.ok(record.source.includes("useState"));
    assert.ok(record.source.includes("useRef"));
    assert.ok(record.source.includes("useEffect"));
    assert.ok(record.source.includes("requestAnimationFrame"));
    assert.ok(record.source.includes("sendToChat"));
    assert.ok(record.source.includes("setChatDraft"));
  });
});

describe("jsx host bridge policy", () => {
  it("never returns a provider send; sendToChat becomes host confirm/draft", () => {
    const first = decideJsxHostBridgeAction({
      kind: "sendToChat",
      text: "[PIT WALL] Box for S tires",
      chatSendEnabled: true,
      now: 1_000,
      rate: { lastAcceptedAt: 0, burst: 0 },
    });
    assert.equal(first.decision.action, "requestChatSend");
    if (first.decision.action === "requestChatSend") {
      assert.match(first.decision.text, /PIT WALL/);
    }
    const draft = decideJsxHostBridgeAction({
      kind: "setChatDraft",
      text: "hold",
      chatSendEnabled: true,
      now: 2_000,
      rate: { lastAcceptedAt: 0, burst: 0 },
    });
    assert.equal(draft.decision.action, "setChatDraft");
    const ungestured = decideJsxHostBridgeAction({
      kind: "sendToChat",
      text: "from useEffect",
      chatSendEnabled: false,
      now: 3_000,
      rate: { lastAcceptedAt: 0, burst: 0 },
    });
    assert.equal(ungestured.decision.action, "setChatDraft");
    const empty = decideJsxHostBridgeAction({
      kind: "sendToChat",
      text: "   ",
      chatSendEnabled: true,
      now: 4_000,
      rate: { lastAcceptedAt: 0, burst: 0 },
    });
    assert.equal(empty.decision.action, "ignore");
    const oversized = decideJsxHostBridgeAction({
      kind: "setChatDraft",
      text: "가".repeat(JSX_BRIDGE_MAX_TEXT + 40),
      chatSendEnabled: true,
      now: 5_000,
      rate: { lastAcceptedAt: 0, burst: 0 },
    });
    assert.equal(oversized.decision.action, "setChatDraft");
    if (oversized.decision.action === "setChatDraft") {
      assert.equal(oversized.decision.text.length <= JSX_BRIDGE_MAX_TEXT, true);
    }
    let rate = { lastAcceptedAt: 0, burst: 0 };
    let ignored = 0;
    for (let i = 0; i < 30; i++) {
      const next = decideJsxHostBridgeAction({
        kind: "sendToChat",
        text: `click ${i}`,
        chatSendEnabled: true,
        now: 10_000 + i,
        rate,
      });
      rate = next.rate;
      if (next.decision.action === "ignore") ignored += 1;
    }
    assert.ok(ignored > 0);
    assert.ok(!JSON.stringify(first).includes("sendNow"));
  });
});

describe("jsx catalog + manifest", () => {
  it("stores compiled catalog and never puts source in the AI block", () => {
    const record = buildPitWallFixtureRecord();
    const json = serializeJsxComponentCatalog([record]);
    assert.doesNotMatch(json, /"compiled"/);
    assert.doesNotMatch(json, /"capabilities"/);
    assert.doesNotMatch(json, /"chatSend"/);
    const parsed = parseJsxComponentCatalog(json);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.name, "PitWallFixture");
    const runtimeCatalog = parseJsxRuntimeComponentCatalog(json);
    assert.equal(runtimeCatalog.length, 1);
    assert.equal("source" in (runtimeCatalog[0] ?? {}), false);
    assert.ok(runtimeCatalog[0]?.compiled);

    const forged = parseJsxComponentCatalog(
      JSON.stringify([
        {
          name: "SafeBoard",
          source: "function SafeBoard() { return <div>safe</div>; }",
          compiled: "return function Forged(){ fetch('/api/chat'); }",
          capabilities: ["external_network", "chat_send"],
          chatSend: true,
          props: [],
        },
      ])
    );
    assert.equal(forged.length, 1);
    assert.equal(forged[0]?.chatSend, false);
    assert.ok(!forged[0]?.capabilities.includes("external_network"));
    assert.doesNotMatch(forged[0]?.compiled ?? "", /Forged/);

    const block = resolveJsxComponentPromptBlock(parsed);
    assert.ok(block);
    assert.match(block!, /PitWallFixture\(/);
    assert.match(block!, /tyreWearPct/);
    assert.doesNotMatch(block!, /requestAnimationFrame/);
    assert.doesNotMatch(block!, /sendToChat/);
    assert.doesNotMatch(block!, /export default function/);
    assert.doesNotMatch(block!, /Do not emit JSX source, HTML, or style/);
    assert.match(block!, /HTML visual-card output remains governed by its separate HTML policy/);
    assert.ok(PIT_WALL_FIXTURE_PROPS.length <= JSX_PROP_MAX);
  });
});

describe("jsx invocation props", () => {
  const defs = [
    { name: "hp", type: "number" as const, required: true },
    { name: "active", type: "boolean" as const, required: false },
    { name: "label", type: "string" as const, required: false },
  ];

  it("normalizes declared props, drops unknown props, and rejects missing/wrong values", () => {
    const ok = resolveJsxInvocationProps(defs, {
      hp: "45",
      active: "true",
      label: 7,
      invented: "ignored",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.deepEqual(ok.props, { hp: 45, active: true, label: "7" });
      assert.equal("invented" in ok.props, false);
    }

    const missing = resolveJsxInvocationProps(defs, { active: true });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.match(missing.error, /hp/);

    const wrong = resolveJsxInvocationProps(defs, { hp: "not-a-number" });
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.match(wrong.error, /number prop/);
  });
});

describe("jsx invocation", () => {
  it("parses PascalCase self-closing tags and incomplete tails", () => {
    const found = extractJsxInvocations(
      `RP 본문\n<PitWallFixture tyreWearPct={38} driver="Dante" pitWindowOpen={true} />`
    );
    assert.equal(found.length, 1);
    assert.equal(found[0]?.name, "PitWallFixture");
    assert.equal(found[0]?.props.tyreWearPct, 38);
    assert.equal(found[0]?.props.driver, "Dante");
    assert.equal(found[0]?.props.pitWindowOpen, true);
    assert.equal(isIncompleteJsxInvocation("<PitWallFixture tyreWearPct={38}"), true);
    assert.equal(isIncompleteJsxInvocation("<PitWallFixture tyreWearPct={38} />"), false);
  });
});

describe("jsx call guide", () => {
  const source = `export default function QuestCard(props) { return <div>{props.title}</div>; }`;
  const guide = "새 퀘스트가 등장하거나 주요 진행 상황이 변경되면 사용합니다. 일반 대화에서는 사용하지 않습니다.";

  it("saves and reloads the call guide without putting it in the source", () => {
    const compiled = compileJsxComponentDraft({
      name: "QuestCard",
      source,
      props: [{ name: "title", type: "string", required: true, description: "카드 제목" }],
      callGuide: guide,
    });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    assert.equal(compiled.record.callGuide, guide);
    assert.equal(compiled.record.source.includes(guide), false);
    const json = serializeJsxComponentCatalog([compiled.record]);
    const reloaded = parseJsxComponentCatalog(json);
    assert.equal(reloaded[0]?.callGuide, guide);
    assert.equal(reloaded[0]?.source, source.trim());
    const missing = parseJsxComponentCatalog(json.replace(/,"callGuide":"[^"]*"/, ""));
    assert.equal(missing[0]?.callGuide ?? "", "");
  });

  it("includes the call guide once in the manifest and omits it when empty", () => {
    const compiled = compileJsxComponentDraft({
      name: "QuestCard",
      source,
      props: [{ name: "title", type: "string", required: true, description: "카드 제목" }],
      callGuide: guide,
    });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const block = resolveJsxComponentPromptBlock(
      parseJsxComponentManifestCatalog(serializeJsxComponentCatalog([compiled.record]))
    );
    assert.ok(block);
    assert.equal(block!.split(guide).length - 1, 1);
    assert.equal(block!.split("[HAV JSX COMPONENTS]").length - 1, 1);
    assert.match(block!, /title: string {2}\/\/ 카드 제목/);
    assert.match(block!, /\/\/ when: /);
    assert.ok(block!.indexOf(`// when: ${guide}`) < block!.indexOf("QuestCard("));
    assert.doesNotMatch(block!, /export default function|props\.title/);

    const empty = compileJsxComponentDraft({
      name: "QuestCard",
      source,
      props: [{ name: "title", type: "string", required: true, description: "카드 제목" }],
      callGuide: "   ",
    });
    assert.equal(empty.ok, true);
    if (!empty.ok) return;
    const emptyBlock = resolveJsxComponentPromptBlock(
      parseJsxComponentManifestCatalog(serializeJsxComponentCatalog([empty.record]))
    );
    assert.ok(emptyBlock);
    assert.doesNotMatch(emptyBlock!, /\/\/ when:/);
    assert.match(emptyBlock!, /\[HAV JSX COMPONENTS\]/);
    assert.match(emptyBlock!, /카드 제목/);
  });

  it("rejects an over-long guide without slicing the stored text or the saved catalog", () => {
    const long = "가".repeat(JSX_CALL_GUIDE_MAX_CHARS + 1);
    const savedCompile = compileJsxComponentDraft({
      name: "QuestCard",
      source,
      props: [],
      callGuide: guide,
    });
    assert.equal(savedCompile.ok, true);
    if (!savedCompile.ok) return;
    const rejected = resolveJsxCatalogDraft([savedCompile.record], {
      name: "QuestCard",
      source,
      props: [],
      callGuide: long,
    });
    assert.equal(rejected.catalog.length, 1);
    assert.equal(rejected.catalog[0], savedCompile.record);
    assert.match(rejected.error, /200자/);
    const stored = JSON.stringify([
      { name: "QuestCard", source, props: [], callGuide: long },
    ]);
    const parsed = parseJsxComponentCatalog(stored);
    assert.equal(parsed[0]?.callGuide, long);
    const block = buildJsxComponentManifestBlock(
      parseJsxComponentManifestCatalog(stored)
    );
    assert.equal(block.split(long).length - 1, 1);
    assert.equal(validateJsxCallGuideCatalog(parsed).ok, false);
  });

  it("keeps a written guide across example apply and preserves other slots", () => {
    const tail = compileJsxComponentDraft({
      name: "Extra",
      source: `export default function Extra(props) { return <i>{props.title}</i>; }`,
      props: [{ name: "title", type: "string", required: true }],
      callGuide: "다른 슬롯 설명",
    });
    const head = compileJsxComponentDraft({ name: "QuestCard", source, props: [] });
    assert.equal(tail.ok && head.ok, true);
    if (!tail.ok || !head.ok) return;
    const applied = resolveJsxCatalogDraft([head.record, tail.record], {
      name: "QuestCard",
      source,
      props: [{ name: "title", type: "string", required: false }],
      callGuide: guide,
    });
    assert.equal(applied.error, "");
    assert.equal(applied.catalog[0]?.callGuide, guide);
    assert.equal(applied.catalog[1]?.name, "Extra");
    assert.equal(applied.catalog[1]?.callGuide, "다른 슬롯 설명");
    assert.equal(head.record.callGuide ?? "", "");

    const broken = resolveJsxCatalogDraft(applied.catalog, {
      name: "QuestCard",
      source: "function QuestCard(",
      props: [],
      callGuide: "컴파일 실패 중 설명",
    });
    assert.equal(broken.catalog, applied.catalog);
    assert.equal(broken.catalog[0]?.callGuide, guide);
    assert.equal(broken.catalog[1]?.callGuide, "다른 슬롯 설명");
  });

  it("caps the catalog call-guide token sum at 600 without a second prompt header", () => {
    assert.equal(JSX_CALL_GUIDE_CATALOG_TOKEN_MAX, 600);
    const full = "가".repeat(JSX_CALL_GUIDE_MAX_CHARS);
    const records = ["QuestCard", "ChoiceCard", "ProfileCard", "StatusCard"].map((name) => {
      const compiled = compileJsxComponentDraft({
        name,
        source: `export default function ${name}(props) { return <div>{props.title}</div>; }`,
        props: [],
        callGuide: full,
      });
      assert.equal(compiled.ok, true, name);
      if (!compiled.ok) throw new Error(name);
      return compiled.record;
    });
    assert.equal(validateJsxCallGuideCatalog(records.slice(0, 3)).ok, true);
    assert.equal(validateJsxCallGuideCatalog(records).ok, false);
    const blocked = resolveJsxCatalogDraft(records, {
      name: "QuestCard",
      source: records[0]!.source,
      props: [],
      callGuide: full,
    });
    assert.equal(blocked.catalog, records);
    assert.equal(blocked.catalog[1]?.name, "ChoiceCard");
    assert.match(blocked.error, /600/);
    const prompt = readFileSync("src/lib/jsxComponent/prompt.ts", "utf8");
    assert.doesNotMatch(prompt, /callGuide|호출 설명/);
    assert.match(readFileSync("src/lib/characterFormSave.ts", "utf8"), /validateJsxCallGuideCatalog/);
    assert.match(readFileSync("src/services/contextBuilder.ts", "utf8"), /resolveJsxComponentPromptBlock/);
  });
});

describe("sandbox iframe contract", () => {
  it("uses opaque allow-scripts without same-origin and does not eval on host", () => {
    const frame = readFileSync("public/jsx-sandbox/frame.html", "utf8");
    const sandbox = readFileSync("src/components/JsxComponentSandbox.tsx", "utf8");
    const runtime = readFileSync("src/lib/jsxComponent/sandboxRuntime.ts", "utf8");
    const client = readFileSync("src/app/chat/[id]/ChatClient.tsx", "utf8");
    assert.match(sandbox, /sandbox="allow-scripts"/);
    assert.doesNotMatch(sandbox, /allow-same-origin/);
    assert.match(frame, /script-src 'self' 'unsafe-eval'/);
    assert.match(runtime, /event\.source !== parent/);
    assert.match(runtime, /event\.origin !== window\.location\.origin/);
    assert.match(runtime, /"useState"/);
    assert.match(runtime, /React\.useState/);
    assert.match(client, /JsxHostBridgeProvider/);
    assert.match(client, /requestChatSend: \(text\) => \{/);
    assert.doesNotMatch(client, /requestChatSend:[\s\S]{0,220}send\(/);
    assert.match(client, /아래 전송을 누르면 기존 채팅 경로로 전달됩니다/);
  });
});
