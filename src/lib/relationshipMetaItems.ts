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

export type PossessionTransferNames = { charName: string; userName: string };

function resolvePossessionPersonLabel(person: string, names?: PossessionTransferNames): string {
  const t = person.trim();
  if (!names) return t;
  if (t === "캐릭터") return names.charName;
  if (t === "유저") return names.userName;
  return t;
}

function possessionPersonMatches(
  entryPerson: string,
  target: string,
  names?: PossessionTransferNames
): boolean {
  if (entryPerson.trim() === target.trim()) return true;
  if (!names) return false;
  return (
    resolvePossessionPersonLabel(entryPerson, names) ===
    resolvePossessionPersonLabel(target, names)
  );
}

/** delta의 A→B 전달 항목 — 보낸 사람 prev 줄에서 해당 물건 제거 */
export function expandPossessionTransferRemovals(
  prevEntries: string[],
  deltaEntries: string[],
  names?: PossessionTransferNames
): { itemsRemove: string[]; itemsRevise: string[] } {
  const itemsRemove: string[] = [];
  const itemsRevise: string[] = [];

  for (const deltaEntry of deltaEntries) {
    const parsed = parsePossessionEntry(deltaEntry.trim());
    if (!parsed?.person.includes("→")) continue;

    const arrowParts = parsed.person.split("→").map((s) => s.trim());
    if (arrowParts.length !== 2) continue;
    const [fromPerson, toPerson] = arrowParts;
    if (!fromPerson || !toPerson || fromPerson === toPerson) continue;

    const transferred = new Set(parsed.items.map((i) => i.trim()).filter(Boolean));
    if (transferred.size === 0) continue;

    for (const raw of prevEntries) {
      const prev = parsePossessionEntry(raw.trim());
      if (!prev) continue;
      if (!possessionPersonMatches(prev.person, fromPerson, names)) continue;

      const remaining = prev.items.filter((i) => !transferred.has(i.trim()));
      const removedAny = prev.items.some((i) => transferred.has(i.trim()));
      if (!removedAny) continue;

      itemsRemove.push(raw);
      if (remaining.length > 0) {
        itemsRevise.push(`${prev.person}: ${remaining.join(", ")}`);
      }
    }
  }

  return {
    itemsRemove: [...new Set(itemsRemove)],
    itemsRevise: [...new Set(itemsRevise)],
  };
}
