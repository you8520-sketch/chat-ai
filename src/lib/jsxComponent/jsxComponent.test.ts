import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyzeJsxCapabilities } from "./capabilities.ts";
import { parseJsxComponentCatalog, serializeJsxComponentCatalog } from "./catalog.ts";
import { compileJsxComponentSource } from "./compile.ts";
import { decideJsxHostBridgeAction } from "./hostBridge.ts";
import { extractJsxInvocations, isIncompleteJsxInvocation } from "./invocation.ts";
import { JSX_BRIDGE_MAX_TEXT, JSX_PROP_MAX } from "./limits.ts";
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
    const parsed = parseJsxComponentCatalog(json);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.name, "PitWallFixture");
    const block = resolveJsxComponentPromptBlock(parsed);
    assert.ok(block);
    assert.match(block!, /PitWallFixture\(/);
    assert.match(block!, /tyreWearPct/);
    assert.doesNotMatch(block!, /requestAnimationFrame/);
    assert.doesNotMatch(block!, /sendToChat/);
    assert.doesNotMatch(block!, /export default function/);
    assert.ok(PIT_WALL_FIXTURE_PROPS.length <= JSX_PROP_MAX);
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
