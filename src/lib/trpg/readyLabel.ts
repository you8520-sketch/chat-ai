import type { TrpgReadyState } from "./snapshot";

export function trpgReadyLabel(ready: TrpgReadyState): string {
  switch (ready) {
    case "writing":
      return "작성 중";
    case "submitted":
      return "제출";
    case "bot_pending":
      return "봇 대기";
    case "host_fill":
      return "방장 입력";
    case "incapacitated":
      return "행동 불가";
    case "spectating":
      return "관전";
    case "disconnected":
      return "연결 끊김";
    default: {
      const _exhaustive: never = ready;
      return _exhaustive;
    }
  }
}
