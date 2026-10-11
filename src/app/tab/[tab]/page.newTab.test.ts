import Module from "module";

let sessionToken = "";
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "next/headers") {
    return {
      cookies: async () => ({
        get: (name: string) =>
          name === "session" && sessionToken ? { value: sessionToken } : undefined,
      }),
    };
  }
  if (request === "next/link") return { __esModule: true, default: () => null };
  if (request === "next/navigation") {
    return { __esModule: true, notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({}) };
  }
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import React, { type ReactElement, type ReactNode } from "react";
import { after, before, describe, it } from "node:test";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

(globalThis as { React?: typeof React }).React = React;

type Card = { id: number; name: string; official: number; creator_site_managed?: boolean; creator_tier_level?: unknown };
const SITE_MANAGED_SQL = "SELECT site_managed FROM users WHERE id=?";

let getDb: typeof import("@/lib/db").getDb;
let CharacterCard: typeof import("@/components/CharacterCard").default;
let TabPage: typeof import("./page").default;
let decorateCharactersWithCreatorTiers: typeof import("@/lib/creatorTierBadges").decorateCharactersWithCreatorTiers;
let creatorId: number;

function insertCharacter(name: string, official: number, createdAt: string, extra: { visibility?: string; moderation?: string; nsfw?: number } = {}) {
  getDb()
    .prepare(
      `INSERT INTO characters
        (name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official, audience,
         emoji, hue, creator_id, creator_name, visibility, moderation_status, images, assets, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      name, "tag", "d", "hi", "s", "로맨스", "[]", extra.nsfw ?? 0, official, "all", "✨", 260,
      creatorId, "제작자", extra.visibility ?? "public", extra.moderation ?? "approved", "[]", "[]", createdAt
    );
}

function collectCards(node: ReactNode, out: Card[] = []): Card[] {
  if (Array.isArray(node)) {
    for (const child of node) collectCards(child, out);
  } else if (node && typeof node === "object" && "props" in node) {
    const el = node as ReactElement<{ c?: Card; children?: ReactNode }>;
    if (el.type === CharacterCard && el.props.c) out.push(el.props.c);
    collectCards(el.props.children, out);
  }
  return out;
}

async function renderTab(tab: string): Promise<Card[]> {
  const el = await TabPage({ params: Promise.resolve({ tab }), searchParams: Promise.resolve({}) });
  return collectCards(el);
}

function countSiteManagedLookups<T>(run: () => Promise<T>): Promise<{ count: number; result: T }> {
  const db = getDb();
  const originalPrepare = db.prepare.bind(db) as (sql: string) => unknown;
  let count = 0;
  (db as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
    if (sql === SITE_MANAGED_SQL) count += 1;
    return originalPrepare(sql);
  };
  return run()
    .then((result) => ({ count, result }))
    .finally(() => {
      (db as unknown as { prepare: (sql: string) => unknown }).prepare = originalPrepare;
    });
}

describe("/tab/new creator tier decoration", () => {
  before(async () => {
    installIsolatedTestDatabase();
    ({ getDb } = await import("@/lib/db"));
    CharacterCard = (await import("@/components/CharacterCard")).default;
    ({ decorateCharactersWithCreatorTiers } = await import("@/lib/creatorTierBadges"));
    TabPage = (await import("./page")).default;
    const info = getDb()
      .prepare("INSERT INTO users (email, nickname, pw_hash) VALUES ('tab-new-tier@example.com', 'tier', 'x')")
      .run();
    creatorId = Number(info.lastInsertRowid);
    insertCharacter("일반-오래됨", 0, "2026-01-01 00:00:00");
    insertCharacter("공식-최신", 1, "2026-03-01 00:00:00");
    insertCharacter("일반-중간", 0, "2026-02-01 00:00:00");
    insertCharacter("비공개", 0, "2026-04-01 00:00:00", { visibility: "private" });
    insertCharacter("검수대기", 0, "2026-04-02 00:00:00", { moderation: "pending" });
    insertCharacter("성인", 0, "2026-04-03 00:00:00", { nsfw: 1 });
  });
  after(() => {
    uninstallIsolatedTestDatabase();
    Module._load = originalLoad;
  });

  it("decorates creator tiers exactly once, like a single decorate call", async () => {
    const rows = getDb().prepare("SELECT * FROM characters WHERE name IN ('일반-오래됨','공식-최신','일반-중간')").all() as Card[];
    const baseline = await countSiteManagedLookups(async () =>
      decorateCharactersWithCreatorTiers(getDb(), rows as never)
    );
    assert.ok(baseline.count > 0);
    const page = await countSiteManagedLookups(() => renderTab("new"));
    assert.equal(page.count, baseline.count);
  });

  it("lists official and ordinary public characters newest first with creator values intact", async () => {
    const cards = await renderTab("new");
    assert.deepEqual(cards.map((c) => c.name), ["공식-최신", "일반-중간", "일반-오래됨"]);
    for (const c of cards) {
      assert.equal(c.creator_site_managed, false, c.name);
      assert.ok("creator_site_managed" in c);
    }
    assert.equal(cards.find((c) => c.name === "공식-최신")?.official, 1);
    assert.ok(!("creator_tier_level" in (cards.find((c) => c.name === "공식-최신") ?? {})));
    assert.ok("creator_tier_level" in (cards.find((c) => c.name === "일반-중간") ?? {}));
  });

  it("still decorates other tabs once", async () => {
    const genre = await renderTab("genre");
    assert.ok(genre.length >= 3);
    assert.ok(genre.every((c) => "creator_site_managed" in c));
    const official = await renderTab("official");
    assert.deepEqual(official.map((c) => c.name), ["공식-최신"]);
    assert.ok(official.every((c) => "creator_site_managed" in c));
    const base = await countSiteManagedLookups(async () =>
      decorateCharactersWithCreatorTiers(
        getDb(),
        getDb().prepare("SELECT * FROM characters WHERE ((official=1 OR (visibility='public' AND moderation_status='approved' AND creator_id IS NOT NULL))) AND nsfw=0 ORDER BY genre, likes DESC").all() as never
      )
    );
    const page = await countSiteManagedLookups(() => renderTab("genre"));
    assert.equal(page.count, base.count);
  });
});
