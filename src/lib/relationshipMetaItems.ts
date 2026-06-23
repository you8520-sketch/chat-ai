export type PossessionListItem = {
  name: string;
  rawEntry: string;
};

export type GroupedPossessions = {
  person: string;
  items: PossessionListItem[];
};

function splitItemNames(itemPart: string): string[] {
  return itemPart
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "이름: a, b" / "이름 소지: a" / "A→B 선물: a" */
export function parsePossessionEntry(entry: string): { person: string; items: string[] } | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  const colonIdx = trimmed.search(/[:：]/);
  if (colonIdx <= 0) return null;

  const person = trimmed
    .slice(0, colonIdx)
    .trim()
    .replace(/\s+소지$/i, "");
  const itemPart = trimmed.slice(colonIdx + 1).trim();
  const items = splitItemNames(itemPart);
  if (!person || items.length === 0) return null;

  return { person, items };
}

export function groupPossessionsByPerson(entries: string[]): GroupedPossessions[] {
  const map = new Map<string, PossessionListItem[]>();

  for (const rawEntry of entries) {
    const parsed = parsePossessionEntry(rawEntry);
    if (!parsed) {
      const fallback = map.get(rawEntry) ?? [];
      fallback.push({ name: rawEntry, rawEntry });
      map.set(rawEntry, fallback);
      continue;
    }

    const list = map.get(parsed.person) ?? [];
    const seen = new Set(list.map((i) => i.name));
    for (const name of parsed.items) {
      if (seen.has(name)) continue;
      seen.add(name);
      list.push({ name, rawEntry });
    }
    map.set(parsed.person, list);
  }

  return [...map.entries()].map(([person, items]) => ({ person, items }));
}

export function formatGroupedPossessionsForPrompt(entries: string[]): string {
  return groupPossessionsByPerson(entries)
    .map(({ person, items }) => `${person}: ${items.map((i) => i.name).join(", ")}`)
    .join("\n");
}
