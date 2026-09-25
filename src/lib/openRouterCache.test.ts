import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HISTORY_CACHE_TAIL_EXCLUDE_MESSAGES,
  buildOpenRouterCachedSystemContent,
  buildOpenRouterDynamicLoreUserPrefix,
  hasMutableSystemSuffixAfterCachedPrefix,
  resolveHistoryCacheBreakpointIndex,
} from "@/lib/openRouterCache";

describe("resolveHistoryCacheBreakpointIndex", () => {
  it("places breakpoint HISTORY_CACHE_TAIL_EXCLUDE before last user", () => {
    const messages = [
      { role: "system" },
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
    ];
    assert.equal(
      resolveHistoryCacheBreakpointIndex(messages),
      5 - HISTORY_CACHE_TAIL_EXCLUDE_MESSAGES
    );
  });

  it("returns null when history too short", () => {
    assert.equal(
      resolveHistoryCacheBreakpointIndex([{ role: "system" }, { role: "user" }]),
      null
    );
  });

  it("skips history breakpoint when cached system prefix has a mutable uncached suffix", () => {
    const messages = [
      {
        role: "system",
        content: buildOpenRouterCachedSystemContent({
          systemRulesBlock: "rules",
          characterSettingsBlock: "character",
          dynamicBlock: "volatile memory/state",
        }),
      },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "current" },
    ];
    assert.equal(hasMutableSystemSuffixAfterCachedPrefix(messages), true);
    assert.equal(resolveHistoryCacheBreakpointIndex(messages), null);
  });

  it("keeps history breakpoint when the system prefix is fully cached", () => {
    const messages = [
      {
        role: "system",
        content: buildOpenRouterCachedSystemContent({
          systemRulesBlock: "rules",
          characterSettingsBlock: "character",
          dynamicBlock: "",
        }),
      },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "current" },
    ];
    assert.equal(hasMutableSystemSuffixAfterCachedPrefix(messages), false);
    assert.equal(
      resolveHistoryCacheBreakpointIndex(messages),
      5 - HISTORY_CACHE_TAIL_EXCLUDE_MESSAGES
    );
  });
});

describe("buildOpenRouterCachedSystemContent", () => {
  it("tags only rules and character blocks, not dynamic", () => {
    const blocks = buildOpenRouterCachedSystemContent({
      systemRulesBlock: "rules",
      characterSettingsBlock: "character",
      dynamicBlock: "volatile",
    });
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]?.cache_control?.type, "ephemeral");
    assert.equal(blocks[1]?.cache_control?.type, "ephemeral");
    assert.equal(blocks[2]?.cache_control, undefined);
  });
});

describe("buildOpenRouterDynamicLoreUserPrefix", () => {
  it("joins non-empty lore parts", () => {
    assert.equal(
      buildOpenRouterDynamicLoreUserPrefix(["[LORE A]", "", "[LORE B]"]),
      "[LORE A]\n\n[LORE B]"
    );
  });
});
