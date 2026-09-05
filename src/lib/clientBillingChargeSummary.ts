import type { Usage } from "@/lib/chatUsage";
import {
  isInFlightGenerationStatus,
  isTerminalGenerationStatus,
} from "@/lib/streamingPersistenceShared";

/** Whether the client should show stored charge-evidence UI instead of usage receipt. */
export function shouldAttachClientBillingChargeSummary(
  usage: Usage | null | undefined,
  generationStatus: string | null | undefined
): boolean {
  if (usage?.billingWaived) return false;
  if (usage?.cost != null && usage.cost > 0) return false;
  if (isInFlightGenerationStatus(generationStatus)) return true;
  return isTerminalGenerationStatus(generationStatus);
}
