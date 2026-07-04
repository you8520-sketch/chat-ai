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

/**
 * 소지품이 될 수 없는 항목 — 가구·설비·실내 비품·착용 중인 제복류.
 * 이름 끝 단어 기준 매칭 (예: "간이 침대", "손거울"도 걸림).
 */
const NON_POSSESSION_ITEM_NAME_RE =
  /(?:침대|세면대|세면기|욕조|변기|의자|책상|탁자|테이블|소파|거울|창문|창틀|커튼|벽난로|선반|옷장|서랍장|서랍|샹들리에|조명|램프|스탠드|카펫|양탄자|제복|군복|근무복|교복|옷|의상|드레스|가운|예복|정장|셔츠|블라우스|바지|치마|코트|망토|구두|신발)\s*(?:\([^)]*\))?$/;

export function isNonPossessionItemName(name: string): boolean {
  return NON_POSSESSION_ITEM_NAME_RE.test(name.trim());
}

/** 소지품 줄에서 가구·설비 등 비소지품 항목 제거. 전부 걸러지면 빈 문자열 */
export function filterPossessionEntryItems(entry: string): string {
  const parsed = parsePossessionEntry(entry);
  if (!parsed) return entry;
  const kept = parsed.items.filter((name) => !isNonPossessionItemName(name));
  if (kept.length === 0) return "";
  if (kept.length === parsed.items.length) return entry;
  return `${parsed.person}: ${kept.join(", ")}`;
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
