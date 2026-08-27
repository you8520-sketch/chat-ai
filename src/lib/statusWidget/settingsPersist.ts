import type Database from "better-sqlite3";
import { statusWidgetHasCreatorSource } from "./resolve";
import type { StatusWidgetSourceMode } from "./types";
import {
  STATUS_SOURCE_DISABLED_SUPERSEDE_REASON,
  supersedeUnconsumedStatusTriggerEvents,
} from "@/lib/statusWidgetTriggers";

export type PersistChatSettingsAtomicInput = {
  chatId: number;
  sets: string[];
  vals: unknown[];
  /** When mode write disables creator machine triggers, supersede in the same transaction. */
  prevEffectiveMode: StatusWidgetSourceMode;
  nextEffectiveMode: StatusWidgetSourceMode;
  writeMode: boolean;
  /** Test seam — throw to simulate supersede failure and assert rollback. */
  supersedeHook?: () => void;
};

function shouldSupersedeCreatorTriggersOnModeChange(
  prevMode: StatusWidgetSourceMode,
  nextMode: StatusWidgetSourceMode
): boolean {
  return (
    statusWidgetHasCreatorSource(prevMode) && !statusWidgetHasCreatorSource(nextMode)
  );
}

/**
 * Atomic owner: chat settings UPDATE + creator trigger supersession on mode disable.
 */
export function persistChatSettingsWithCreatorTriggerSupersede(
  db: Database.Database,
  input: PersistChatSettingsAtomicInput
): void {
  const supersedeOnCommit =
    input.writeMode &&
    shouldSupersedeCreatorTriggersOnModeChange(
      input.prevEffectiveMode,
      input.nextEffectiveMode
    );

  const run = () => {
    if (input.sets.length === 0) return;
    const vals = [...input.vals, input.chatId];
    db.prepare(`UPDATE chats SET ${input.sets.join(", ")} WHERE id=?`).run(...vals);
    if (supersedeOnCommit) {
      input.supersedeHook?.();
      supersedeUnconsumedStatusTriggerEvents(
        db,
        input.chatId,
        STATUS_SOURCE_DISABLED_SUPERSEDE_REASON
      );
    }
  };

  if (db.inTransaction) {
    run();
    return;
  }
  db.transaction(run).immediate();
}
