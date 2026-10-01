import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { decideJsxHostBridgeAction } from "@/lib/jsxComponent/hostBridge";
import { buildWidgetExtractSystem } from "./extractNormalize";
import { buildStatusWidgetPromptBlock, collectWidgetJsonKeys } from "./prompt";
import { statusWidgetPreviewSandboxProps } from "./previewRuntime";
import { resolveStatusWidgetTurn } from "./resolve";
import { serializeStatusWidget } from "./serialize";
import type { StatusWidget } from "./types";

const MARKER = "LUNA_JSX_NOT_IN_PROMPT_9f3a";

describe("status widget preview runtime", () => {
  it("preview sendToChat cannot auto-send", () => {
    const sandbox = statusWidgetPreviewSandboxProps("compiled", { 시간: "09:00" });
    assert.equal(sandbox.chatSendEnabled, false);
    assert.equal(sandbox.bridge, null);
    const result = decideJsxHostBridgeAction({
      kind: "sendToChat",
      text: "자동 전송",
      chatSendEnabled: sandbox.chatSendEnabled,
      now: 10_000,
      rate: { lastAcceptedAt: 0, burst: 0 },
    });
    assert.notEqual(result.decision.action, "requestChatSend");
    assert.equal(result.decision.action, "setChatDraft");
  });

  it("gallery JSX sandbox cannot call the network or read the HAV session", () => {
    const frame = readFileSync(new URL("../../../public/jsx-sandbox/frame.html", import.meta.url), "utf8");
    const sandbox = readFileSync(
      new URL("../../components/JsxComponentSandbox.tsx", import.meta.url),
      "utf8"
    );
    assert.match(frame, /connect-src 'none'/);
    assert.match(frame, /background:\s*#0a0a0c/);
    assert.match(frame, /color-scheme:\s*dark/);
    assert.doesNotMatch(frame, /background:\s*transparent/);
    assert.match(sandbox, /sandbox="allow-scripts"/);
    assert.doesNotMatch(sandbox, /allow-same-origin/);
  });

  it("keeps Luna extraction on fields and leaves JSX source out of the prompt", () => {
    const widget: StatusWidget = {
      version: 1,
      name: "jsx",
      htmlTemplate: "",
      jsxSource: `export default function Board(props) { return <div>${MARKER}{props["시간"]}</div>; }`,
      fields: [{ id: "시간", label: "시간", instruction: "현재 장면의 시각을 짧게 작성한다." }],
      placement: "bottom",
    };
    const json = serializeStatusWidget(widget);
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: json,
      chatMode: "character_only",
    });
    assert.equal(resolved.needsCharacterValues, true);
    assert.equal(resolved.characterWidget?.fields[0]?.id, "시간");
    const block = buildStatusWidgetPromptBlock(resolved);
    const system = buildWidgetExtractSystem(
      resolved.characterWidget!,
      collectWidgetJsonKeys(resolved.characterWidget!),
      "character"
    );
    assert.match(block, /시간/);
    assert.match(system, /시간/);
    assert.doesNotMatch(block, new RegExp(MARKER));
    assert.doesNotMatch(system, new RegExp(MARKER));
    assert.doesNotMatch(block, /export default function/);
  });
});
