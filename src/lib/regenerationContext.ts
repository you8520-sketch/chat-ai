export type RegenerationMessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
};

export type RegenerationContextBoundary = {
  targetAssistant: RegenerationMessageRow;
  parentUser: RegenerationMessageRow;
  historyRows: RegenerationMessageRow[];
};

export function resolveRegenerationContextBoundary(
  rows: RegenerationMessageRow[],
  targetAssistantId?: number | null
): RegenerationContextBoundary | null {
  const targetIndex =
    targetAssistantId != null
      ? rows.findIndex(
          (row) =>
            row.id === targetAssistantId &&
            row.role === "assistant" &&
            row.model !== "greeting"
        )
      : (() => {
          for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i]!;
            if (row.role === "assistant" && row.model !== "greeting") return i;
          }
          return -1;
        })();

  if (targetIndex < 0) return null;
  const targetAssistant = rows[targetIndex]!;

  let parentIndex = -1;
  for (let i = targetIndex - 1; i >= 0; i--) {
    if (rows[i]!.role === "user") {
      parentIndex = i;
      break;
    }
  }
  if (parentIndex < 0) return null;

  return {
    targetAssistant,
    parentUser: rows[parentIndex]!,
    historyRows: rows.slice(0, parentIndex),
  };
}
