/**
 * Authored adventure canon: places, links, and data-driven events.
 * Stored in `scenario_plan_json.adventure` and copied into the campaign snapshot at start.
 * Pure and client-safe. NPCs, goal, endings, and threats stay with their existing owners.
 */

export const ADVENTURE_PLACE_ROLES = ["start", "hub", "site", "goal"] as const;
export type AdventurePlaceRole = (typeof ADVENTURE_PLACE_ROLES)[number];

export const ADVENTURE_EVENT_TRIGGERS = ["enter", "search", "careful_search"] as const;
export type AdventureEventTrigger = (typeof ADVENTURE_EVENT_TRIGGERS)[number];

/** Effects the server can apply. Anything else is rejected, never interpreted. Opening a way is link data (`opensBy`), not a kind. */
export const ADVENTURE_EVENT_KINDS = ["clue", "item", "hazard"] as const;
export type AdventureEventKind = (typeof ADVENTURE_EVENT_KINDS)[number];

export const ADVENTURE_LIMITS = {
  places: 12,
  links: 24,
  events: 16,
  requires: 4,
  keyChars: 32,
  nameChars: 30,
  summaryChars: 160,
  textChars: 200,
  itemChars: 40,
} as const;

export type AdventurePlace = {
  key: string;
  name: string;
  summary: string;
  role: AdventurePlaceRole;
};

/** Undirected. `hidden` links are invisible until `opensBy` fires; a visible link with `opensBy` is a locked way. */
export type AdventureLink = {
  from: string;
  to: string;
  hidden?: boolean;
  opensBy?: string;
};

/** `text` is secret until the event fires. */
export type AdventureEvent = {
  key: string;
  place: string;
  trigger: AdventureEventTrigger;
  kind: AdventureEventKind;
  text: string;
  item?: string;
  requires?: string[];
};

export type TrpgAdventure = {
  start: string;
  places: AdventurePlace[];
  links: AdventureLink[];
  events: AdventureEvent[];
};

const KEY_PATTERN = /^[a-z0-9_-]+$/;
const PUBLIC_ID_PATTERN = /^r\d+$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clip(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

function charCount(value: string): number {
  return Array.from(value).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nameKey(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

/**
 * Which places can be reached and which events can fire from the start, applying every
 * reachable event until nothing changes. A link that only opens after an event behind
 * that same link never opens, so self-blocking gates show up as unreachable here.
 */
export function adventureReachability(adventure: TrpgAdventure): { places: Set<string>; events: Set<string> } {
  const places = new Set<string>([adventure.start]);
  const events = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of adventure.links) {
      const open = link.opensBy ? events.has(link.opensBy) : !link.hidden;
      if (!open) continue;
      if (places.has(link.from) && !places.has(link.to)) {
        places.add(link.to);
        changed = true;
      } else if (places.has(link.to) && !places.has(link.from)) {
        places.add(link.from);
        changed = true;
      }
    }
    for (const event of adventure.events) {
      if (events.has(event.key) || !places.has(event.place)) continue;
      if (!(event.requires ?? []).every((key) => events.has(key))) continue;
      events.add(event.key);
      changed = true;
    }
  }
  return { places, events };
}

/** More than one place means a map; one place is a valid single-scene adventure without a map. */
export function adventureHasMap(adventure: TrpgAdventure | null | undefined): adventure is TrpgAdventure {
  return Boolean(adventure && adventure.places.length >= 2);
}

export function adventureStartPlace(adventure: TrpgAdventure): AdventurePlace | undefined {
  return adventure.places.find((place) => place.key === adventure.start);
}

/**
 * Shape checks and graph checks in one place. The lenient reader keeps an adventure only when
 * this finds nothing; the save and draft boundaries reject the same findings, so a broken
 * multi-place canon never turns into a silent "no map" success. An omitted optional field means
 * none; a provided one of the wrong type is an issue, never a default, because `requires`,
 * `hidden`, `opensBy`, and `trigger` decide what is visible, open, and fired.
 */
export function evaluateAdventure(raw: unknown): { adventure: TrpgAdventure | null; issues: string[] } {
  const issues: string[] = [];
  if (raw == null) return { adventure: null, issues };
  if (!isRecord(raw)) return { adventure: null, issues: ["장소 구성(adventure)은 객체여야 합니다."] };
  const rawPlaces = Array.isArray(raw.places) ? raw.places : null;
  const rawLinks = raw.links == null ? [] : Array.isArray(raw.links) ? raw.links : null;
  const rawEvents = raw.events == null ? [] : Array.isArray(raw.events) ? raw.events : null;
  if (!rawPlaces || rawPlaces.length === 0) issues.push("장소(places)가 없습니다.");
  if (!rawLinks) issues.push("연결(links)은 목록이어야 합니다.");
  if (!rawEvents) issues.push("사건(events)은 목록이어야 합니다.");
  if (!rawPlaces || !rawLinks || !rawEvents) return { adventure: null, issues };
  if (rawPlaces.length > ADVENTURE_LIMITS.places) issues.push(`장소는 최대 ${ADVENTURE_LIMITS.places}곳입니다.`);
  if (rawLinks.length > ADVENTURE_LIMITS.links) issues.push(`연결은 최대 ${ADVENTURE_LIMITS.links}개입니다.`);
  if (rawEvents.length > ADVENTURE_LIMITS.events) issues.push(`사건은 최대 ${ADVENTURE_LIMITS.events}개입니다.`);

  const places: AdventurePlace[] = [];
  const placeKeys = new Set<string>();
  const placeNames = new Set<string>();
  rawPlaces.forEach((item, index) => {
    const label = `장소 #${index + 1}`;
    if (!isRecord(item)) {
      issues.push(`${label}: 객체 형식이 아닙니다.`);
      return;
    }
    const key = text(item.key);
    const name = text(item.name);
    const role = text(item.role) || "site";
    if (!key || charCount(key) > ADVENTURE_LIMITS.keyChars || !KEY_PATTERN.test(key) || PUBLIC_ID_PATTERN.test(key)) {
      issues.push(`${label}: key "${key}"는 영문 소문자·숫자·_·- ${ADVENTURE_LIMITS.keyChars}자 이하여야 합니다.`);
      return;
    }
    if (placeKeys.has(key)) issues.push(`${label}: key "${key}"가 중복됩니다.`);
    if (!name || charCount(name) > ADVENTURE_LIMITS.nameChars) {
      issues.push(`${label} (${key}): 이름은 1~${ADVENTURE_LIMITS.nameChars}자여야 합니다.`);
    } else if (placeNames.has(nameKey(name))) {
      issues.push(`${label} (${key}): 이름 "${name}"이 다른 장소와 겹칩니다.`);
    }
    if (!(ADVENTURE_PLACE_ROLES as readonly string[]).includes(role)) {
      issues.push(`${label} (${key}): role은 ${ADVENTURE_PLACE_ROLES.join("/")} 중 하나여야 합니다.`);
    }
    placeKeys.add(key);
    if (name) placeNames.add(nameKey(name));
    places.push({
      key,
      name,
      summary: clip(text(item.summary), ADVENTURE_LIMITS.summaryChars),
      role: role as AdventurePlaceRole,
    });
  });

  const start = text(raw.start);
  if (!start) issues.push("시작 장소(start)가 없습니다.");
  else if (!placeKeys.has(start)) issues.push(`시작 장소 "${start}"가 장소 목록에 없습니다.`);

  const rawEventKeys = new Set(
    rawEvents.flatMap((item) => (isRecord(item) && text(item.key) ? [text(item.key)] : []))
  );

  const links: AdventureLink[] = [];
  const pairs = new Set<string>();
  rawLinks.forEach((item, index) => {
    const label = `연결 #${index + 1}`;
    if (!isRecord(item)) {
      issues.push(`${label}: 객체 형식이 아닙니다.`);
      return;
    }
    const from = text(item.from);
    const to = text(item.to);
    const opensBy = text(item.opensBy);
    const hidden = item.hidden === true;
    if (item.hidden != null && typeof item.hidden !== "boolean") issues.push(`${label}: hidden은 true/false여야 합니다.`);
    if (item.opensBy != null && typeof item.opensBy !== "string") issues.push(`${label}: opensBy는 사건 key 문자열이어야 합니다.`);
    if (!placeKeys.has(from) || !placeKeys.has(to)) {
      issues.push(`${label}: 없는 장소 "${placeKeys.has(from) ? to : from}"를 잇습니다.`);
      return;
    }
    if (from === to) {
      issues.push(`${label}: 같은 장소 "${from}"를 자기 자신과 잇습니다.`);
      return;
    }
    const pair = from < to ? `${from}|${to}` : `${to}|${from}`;
    if (pairs.has(pair)) issues.push(`${label}: ${from}–${to} 연결이 중복됩니다.`);
    pairs.add(pair);
    if (opensBy && !rawEventKeys.has(opensBy)) issues.push(`${label}: 없는 사건 "${opensBy}"로 열립니다.`);
    if (hidden && !opensBy) issues.push(`${label}: 숨은 연결은 여는 사건(opensBy)이 필요합니다.`);
    links.push({ from, to, ...(hidden ? { hidden: true } : {}), ...(opensBy ? { opensBy } : {}) });
  });

  const events: AdventureEvent[] = [];
  const eventKeys = new Set<string>();
  rawEvents.forEach((item, index) => {
    const label = `사건 #${index + 1}`;
    if (!isRecord(item)) {
      issues.push(`${label}: 객체 형식이 아닙니다.`);
      return;
    }
    const key = text(item.key);
    const place = text(item.place);
    const trigger = typeof item.trigger === "string" ? item.trigger.trim() || "search" : item.trigger == null ? "search" : String(item.trigger);
    const kind = text(item.kind);
    const body = clip(text(item.text), ADVENTURE_LIMITS.textChars);
    const itemName = text(item.item);
    const requiresWellFormed =
      item.requires == null ||
      (Array.isArray(item.requires) && item.requires.every((need) => typeof need === "string" && need.trim().length > 0));
    const requires = requiresWellFormed && Array.isArray(item.requires) ? item.requires.map(text) : [];
    if (!key || charCount(key) > ADVENTURE_LIMITS.keyChars || !KEY_PATTERN.test(key)) {
      issues.push(`${label}: key "${key}"는 영문 소문자·숫자·_·- ${ADVENTURE_LIMITS.keyChars}자 이하여야 합니다.`);
      return;
    }
    if (!requiresWellFormed) issues.push(`${label} (${key}): requires는 사건 key 목록이어야 합니다.`);
    if (eventKeys.has(key)) issues.push(`${label}: key "${key}"가 중복됩니다.`);
    eventKeys.add(key);
    if (!placeKeys.has(place)) issues.push(`${label} (${key}): 없는 장소 "${place}"에 있습니다.`);
    if (!(ADVENTURE_EVENT_TRIGGERS as readonly string[]).includes(trigger)) {
      issues.push(`${label} (${key}): trigger는 ${ADVENTURE_EVENT_TRIGGERS.join("/")} 중 하나여야 합니다.`);
    }
    if (!(ADVENTURE_EVENT_KINDS as readonly string[]).includes(kind)) {
      issues.push(`${label} (${key}): kind는 ${ADVENTURE_EVENT_KINDS.join("/")} 중 하나여야 합니다.`);
    }
    if (!body) issues.push(`${label} (${key}): 내용(text)이 없습니다.`);
    if (kind === "item" && (!itemName || charCount(itemName) > ADVENTURE_LIMITS.itemChars)) {
      issues.push(`${label} (${key}): 아이템 이름(item)은 1~${ADVENTURE_LIMITS.itemChars}자여야 합니다.`);
    }
    if (requires.length > ADVENTURE_LIMITS.requires) {
      issues.push(`${label} (${key}): 선행 사건은 최대 ${ADVENTURE_LIMITS.requires}개입니다.`);
    }
    for (const need of requires) {
      if (need === key) issues.push(`${label} (${key}): 자기 자신을 선행 사건으로 요구합니다.`);
      else if (!rawEventKeys.has(need)) issues.push(`${label} (${key}): 없는 선행 사건 "${need}"를 요구합니다.`);
    }
    if (trigger === "enter" && place && place === text(raw.start) && requires.length === 0) {
      issues.push(`${label} (${key}): 시작 장소의 enter 사건은 선행 사건 없이는 일어나지 않습니다. search로 바꾸세요.`);
    }
    events.push({
      key,
      place,
      trigger: trigger as AdventureEventTrigger,
      kind: kind as AdventureEventKind,
      text: body,
      ...(kind === "item" && itemName ? { item: itemName } : {}),
      ...(requires.length ? { requires } : {}),
    });
  });

  if (issues.length > 0) return { adventure: null, issues };
  const adventure: TrpgAdventure = { start, places, links, events };
  if (adventureHasMap(adventure)) {
    if (events.length === 0) issues.push("여러 장소가 있는데 조사할 사건이 하나도 없습니다.");
    if (events.length > 0 && !links.some((link) => link.opensBy) && !events.some((event) => event.requires?.length)) {
      issues.push("사건이 어떤 길이나 다음 사건으로도 이어지지 않습니다.");
    }
    const reach = adventureReachability(adventure);
    for (const place of places) {
      if (!reach.places.has(place.key)) issues.push(`장소 "${place.name}"(${place.key})에 도달할 수 없습니다.`);
    }
    for (const event of events) {
      if (!reach.events.has(event.key)) issues.push(`사건 "${event.key}"은 조건이 풀리지 않아 일어날 수 없습니다.`);
    }
  } else if (links.length > 0) {
    issues.push("장소가 한 곳인데 연결이 있습니다.");
  }
  return issues.length > 0 ? { adventure: null, issues } : { adventure, issues };
}

export function parseAdventure(raw: unknown): TrpgAdventure | null {
  return evaluateAdventure(raw).adventure;
}

/** Findings for the plan's explicit adventure; none when the plan has no adventure or is unreadable. */
function planAdventureIssues(rawPlan: unknown): string[] {
  let plan: unknown = rawPlan;
  if (typeof rawPlan === "string") {
    if (!rawPlan.trim()) return [];
    try {
      plan = JSON.parse(rawPlan);
    } catch {
      return [];
    }
  }
  if (!isRecord(plan) || plan.adventure == null) return [];
  return evaluateAdventure(plan.adventure).issues;
}

/** Save-boundary guard: an explicit adventure must be fully valid. The author sees every finding. */
export function assertAuthoredAdventureValid(rawPlan: unknown): void {
  const issues = planAdventureIssues(rawPlan);
  if (issues.length > 0) throw new Error(`장소 구성(adventure) 오류: ${issues.join(" ")}`);
}

/** The host may not be the author, so findings that name hidden places or events stay in `issues`. */
export const TRPG_ADVENTURE_CANON_START_MESSAGE =
  "이 모험의 장소 구성이 맞지 않아 시작할 수 없습니다. 제작자가 장소와 사건을 고친 뒤 다시 시작해 주세요.";

export class TrpgAdventureCanonError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(TRPG_ADVENTURE_CANON_START_MESSAGE);
    this.name = "TrpgAdventureCanonError";
    this.issues = issues;
  }
}

/** Start-boundary guard: an explicit adventure that cannot be played stops the start instead of becoming "no map". */
export function assertFrozenAdventureValid(rawPlan: unknown): void {
  const issues = planAdventureIssues(rawPlan);
  if (issues.length > 0) throw new TrpgAdventureCanonError(issues);
}
