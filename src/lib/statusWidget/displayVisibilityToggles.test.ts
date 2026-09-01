import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import {
  displayModeFromVisibilityToggles,
  displayVisibilityFromMode,
} from "./displayVisibilityToggles";
import {
  orderedWidgetsForRender,
  resolveStatusWidgetTurn,
  statusWidgetModeForDefinitions,
} from "./resolve";
import { serializeStatusWidget } from "./serialize";
import type { StatusWidgetDisplayMode } from "./types";

const creatorJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
const personaJson = serializeStatusWidget({
  ...DEFAULT_STATUS_WIDGET,
  name: "내 상태창",
  fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
});

describe("status widget canonical engine and display-only UI", () => {
  it("round-trips all four display-only visibility choices", () => {
    const modes: StatusWidgetDisplayMode[] = ["creator", "user", "both", "hidden"];
    for (const mode of modes) {
      const visibility = displayVisibilityFromMode(mode);
      assert.equal(
        displayModeFromVisibilityToggles(
          visibility.creatorVisible,
          visibility.userVisible
        ),
        mode
      );
    }
  });

  it("derives engine mode only from available canonical definitions", () => {
    assert.equal(statusWidgetModeForDefinitions({}), "off");
    assert.equal(
      statusWidgetModeForDefinitions({ characterWidgetJson: creatorJson }),
      "character_only"
    );
    assert.equal(
      statusWidgetModeForDefinitions({ personaWidgetJson: personaJson }),
      "user_only"
    );
    assert.equal(
      statusWidgetModeForDefinitions({
        characterWidgetJson: creatorJson,
        personaWidgetJson: personaJson,
      }),
      "both"
    );
    assert.equal(
      statusWidgetModeForDefinitions({
        characterWidgetJson: creatorJson,
        personaWidgetJson: personaJson,
        characterAllowUserOverride: false,
      }),
      "character_only"
    );
  });

  it("keeps both sources active while hidden and renders neither", () => {
    const mode = statusWidgetModeForDefinitions({
      characterWidgetJson: creatorJson,
      personaWidgetJson: personaJson,
    });
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: personaJson,
      chatMode: mode,
      displayMode: "hidden",
    });
    assert.equal(resolved.needsCharacterValues, true);
    assert.equal(resolved.needsUserValues, true);
    assert.deepEqual(
      orderedWidgetsForRender(resolved, {
        character: { time: "1" },
        user: { my_note: "x" },
      }),
      []
    );
  });

  it("chat settings exposes exactly two display toggles and autosaves only display", () => {
    const source = readFileSync(
      new URL("../../components/StatusWidgetChatSettings.tsx", import.meta.url),
      "utf8"
    );
    assert.equal((source.match(/<StatusDisplayToggle/g) ?? []).length, 2);
    assert.match(source, /label="제작자 상태창"/);
    assert.match(source, /label="내 상태창"/);
    assert.match(source, /statusWidgetDisplayMode: next/);
    assert.match(source, /disabled=\{!chatId \|\| saving/);
    assert.match(source, /setDisplayMode\(previous\)/);
    assert.doesNotMatch(source, /statusWidgetMode:/);
    assert.doesNotMatch(source, /userStatusWidgetJson/);
    assert.doesNotMatch(source, /불러오기|별도 저장|추적/);
  });

  it("runtime owners do not access legacy per-chat engine columns", () => {
    const files = [
      "../../app/api/chat/route.ts",
      "../../app/api/chat/settings/route.ts",
      "../../app/api/user/chat-prefs/route.ts",
      "../../app/chat/[id]/page.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.doesNotMatch(source, /status_widget_mode|user_status_widget_json/, file);
    }
  });

  it("keeps the suggestion preference only at the input-area toggle", () => {
    const settings = readFileSync(
      new URL("../../components/ChatSettingsPanel.tsx", import.meta.url),
      "utf8"
    );
    const chat = readFileSync(
      new URL("../../app/chat/[id]/ChatClient.tsx", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(settings, /추천 메시지/);
    assert.equal((chat.match(/aria-label="추천 메시지"/g) ?? []).length, 1);
  });
});
