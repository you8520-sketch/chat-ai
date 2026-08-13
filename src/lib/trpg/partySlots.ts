import { TRPG_MAX_BOTS, TRPG_MAX_SLOTS } from "./types";
import type { TrpgPublicParticipant } from "./snapshot";

export type TrpgCompanionSlotView =
  | { kind: "empty"; index: number }
  | { kind: "ai"; index: number; participant: TrpgPublicParticipant }
  | { kind: "human"; index: number; participant: TrpgPublicParticipant };

export function companionParticipants(participants: readonly TrpgPublicParticipant[]): TrpgPublicParticipant[] {
  const host =
    participants.find((p) => p.slotIndex === 0) ?? participants.find((p) => p.kind === "human") ?? null;
  return participants
    .filter((p) => p.id !== host?.id)
    .slice()
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

export function companionSlotViews(
  participants: readonly TrpgPublicParticipant[],
  maxSlots = TRPG_MAX_SLOTS
): TrpgCompanionSlotView[] {
  const companions = companionParticipants(participants);
  const count = Math.max(0, maxSlots - 1);
  const slots: TrpgCompanionSlotView[] = [];
  for (let index = 0; index < count; index += 1) {
    const participant = companions[index];
    if (!participant) {
      slots.push({ kind: "empty", index });
      continue;
    }
    if (participant.kind === "ai_character") {
      slots.push({ kind: "ai", index, participant });
      continue;
    }
    slots.push({ kind: "human", index, participant });
  }
  return slots;
}

export function remainingAiCompanionSlots(
  participants: readonly { kind: string }[],
  maxSlots = TRPG_MAX_SLOTS
): number {
  const bots = participants.filter((p) => p.kind === "ai_character").length;
  const open = maxSlots - participants.length;
  return Math.max(0, Math.min(TRPG_MAX_BOTS - bots, open));
}
