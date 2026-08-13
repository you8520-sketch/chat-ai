import type { TrpgPublicParticipant } from "./snapshot";

/** Why 「캠페인 시작」 stays off. Null means the host can start (saving the open form first). */
export function trpgStartBlockedReason(opts: {
  participants: TrpgPublicParticipant[];
  viewerParticipantId: number | null;
  editingId: number | null;
  remaining: number;
}): string | null {
  if (opts.remaining < 0) {
    return "능력치 합계가 넘었습니다. 다른 값을 낮추면 시작할 수 있습니다.";
  }
  for (const p of opts.participants) {
    switch (p.kind) {
      case "human": {
        const isSelf = p.id === opts.viewerParticipantId;
        if (isSelf) {
          const willSaveSelf = opts.editingId === p.id;
          if (!p.hasSheet && !willSaveSelf) {
            return "내 시트를 먼저 저장하세요.";
          }
          break;
        }
        if (!p.hasSheet) {
          return `${p.displayName} 님이 아직 시트를 저장하지 않았습니다.`;
        }
        break;
      }
      case "ai_character": {
        if (!p.hasSheet) {
          return `${p.displayName} 시트가 없습니다.`;
        }
        break;
      }
      default: {
        const _exhaustive: never = p.kind;
        return _exhaustive;
      }
    }
  }
  return null;
}
