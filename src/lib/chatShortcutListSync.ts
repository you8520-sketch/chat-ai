export type ShortcutListRow = {
  id: number;
  favorite: boolean;
  updatedAt?: string;
};

/**
 * Apply a list response without dropping local writes that finished after the
 * request started, and without restoring rows deleted locally during that wait.
 */
export function mergeShortcutList<T extends ShortcutListRow>(
  server: readonly T[],
  localWrites: ReadonlyMap<number, T>,
  localDeletes: ReadonlySet<number>
): T[] {
  const serverIds = new Set(server.map((row) => row.id));
  const fromServer = server
    .filter((row) => !localDeletes.has(row.id))
    .map((row) => localWrites.get(row.id) ?? row);
  const created = [...localWrites.values()].filter(
    (row) => !serverIds.has(row.id) && !localDeletes.has(row.id)
  );
  return [...created, ...fromServer].sort(compareShortcutRows);
}

export function compareShortcutRows(a: ShortcutListRow, b: ShortcutListRow): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  const byTime = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  if (byTime !== 0) return byTime;
  return b.id - a.id;
}
