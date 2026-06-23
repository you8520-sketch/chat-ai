import { getDb } from "@/lib/db";
import {
  MEMORY_CAPACITY_DEFAULT,
  normalizeMemoryCapacity,
  resolveMemoryBudgetFromCapacity,
  type MemoryBudgetFromCapacity,
} from "./memory-capacity-shared";

export {
  MEMORY_CAPACITY_FIXED,
  ARCHIVE_CAPACITY_FIXED,
  MEMORY_CAPACITY_DEFAULT,
  normalizeMemoryCapacity,
  resolveMemoryBudgetFromCapacity,
  type MemoryBudgetFromCapacity,
} from "./memory-capacity-shared";

export function getChatMemoryCapacity(chatId: number): number {
  const row = getDb()
    .prepare("SELECT memory_capacity FROM chats WHERE id=?")
    .get(chatId) as { memory_capacity?: number } | undefined;
  return normalizeMemoryCapacity(row?.memory_capacity);
}
