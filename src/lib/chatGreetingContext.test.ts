import { describe, expect, it } from "vitest";

import { extractGreetingFromMessageRows, OPENING_TURN_USER } from "./chatGreetingContext";
import { messagesToTurns } from "./hybridMemory";

describe("chatGreetingContext", () => {
  it("extracts greeting assistant row", () => {
    const greeting = extractGreetingFromMessageRows([
      { role: "assistant", model: "greeting", content: "*훈련장.* 안녕." },
      { role: "user", content: "왔어" },
    ]);
    expect(greeting).toBe("*훈련장.* 안녕.");
  });

  it("greeting becomes turn 0 in messagesToTurns", () => {
    const turns = messagesToTurns([
      { role: "assistant", model: "greeting", content: "*훈련장.* 안녕." },
      { role: "user", content: "왔어" },
      { role: "assistant", content: "응.", model: "test" },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.user).toBe(OPENING_TURN_USER);
    expect(turns[0]?.assistant).toBe("*훈련장.* 안녕.");
    expect(turns[1]?.user).toBe("왔어");
  });
});
