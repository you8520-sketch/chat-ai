import { describe, expect, it } from "vitest";

import {
  extractGreetingFromMessageRows,
  prependOpeningSceneToHistory,
  OPENING_SCENE_USER_ANCHOR,
} from "./chatGreetingContext";

describe("chatGreetingContext", () => {
  it("extracts greeting assistant row", () => {
    const greeting = extractGreetingFromMessageRows([
      { role: "assistant", model: "greeting", content: "*훈련장.* 안녕." },
      { role: "user", content: "왔어" },
    ]);
    expect(greeting).toBe("*훈련장.* 안녕.");
  });

  it("prepends opening pair before user turns", () => {
    const history = prependOpeningSceneToHistory("*훈련장.*", [
      { role: "user", content: "왔어" },
    ]);
    expect(history).toHaveLength(3);
    expect(history[0]?.content).toBe(OPENING_SCENE_USER_ANCHOR);
    expect(history[1]?.content).toBe("*훈련장.*");
    expect(history[2]?.content).toBe("왔어");
  });
});
