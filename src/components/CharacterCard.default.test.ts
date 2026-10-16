import Module from "module";
import type { ReactElement, ReactNode } from "react";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "next/link") return { __esModule: true, default: "a" };
  if (request === "@/components/CharacterCardCarousel") {
    return { __esModule: true, default: ({ urls, hidden, fallback }: { urls: string[]; hidden: boolean; fallback?: ReactNode }) =>
        `[carousel ${urls.join(",")} hidden=${hidden} fallback=${expand(fallback)}]`,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import React from "react";
import { describe, it } from "node:test";
import type { CharacterRow } from "@/components/CharacterCard";

(globalThis as { React?: typeof React }).React = React;

function row(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 7,
    name: "강이현",
    tagline: "아포칼립스의 루트 브로커",
    genre: "아포칼립스",
    tags: JSON.stringify(["아포칼립스", "생존"]),
    nsfw: 0,
    official: 0,
    emoji: "🌙",
    hue: 260,
    creator_name: "하브 스튜디오",
    creator_id: 3,
    likes: 0,
    total_turns: 0,
    chats_count: 0,
    created_at: "2026-01-01",
    images: JSON.stringify(["/uploads/a.png"]),
    assets: JSON.stringify([{ url: "/uploads/a.png", tag: "대표" }]),
    ...over,
  } as CharacterRow;
}

function expand(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(expand).join("");
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === "function") {
    return expand((el.type as (props: Record<string, unknown>) => ReactNode)(el.props));
  }
  const { children, ...attrs } = el.props;
  const attrText = Object.entries(attrs)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
  return `<${String(el.type)}${attrText}>${expand(children as ReactNode)}</${String(el.type)}>`;
}

async function render(c: CharacterRow, props: { blurNsfw?: boolean; variant?: "default" | "index"; loggedIn?: boolean } = {}) {
  const { default: CharacterCard } = await import("@/components/CharacterCard");
  return expand(
    React.createElement(CharacterCard, { c, blurNsfw: props.blurNsfw ?? false, loggedIn: props.loggedIn, variant: props.variant }),
  );
}

describe("default CharacterCard", () => {
  it("shows genre, name, creator, tagline and tags and keeps the D-1 reveal markers", async () => {
    const html = await render(row({ official: 1 }), { loggedIn: true });
    for (const text of ["아포칼립스", "강이현", "하브 스튜디오", "아포칼립스의 루트 브로커", "#생존", "공식"]) {
      assert.ok(html.includes(text), text);
    }
    assert.match(html, /data-character-card/);
    assert.ok(html.includes("[carousel /uploads/a.png hidden=false fallback=<span"));
    assert.match(html, /data-character-name="강이현"/);
    assert.match(html, /href="\/character\/7"/);
    assert.match(html, /href="\/search\?q=%EC%83%9D%EC%A1%B4"/);
  });

  it("falls back to the emoji and a placeholder tagline without an image or tagline", async () => {
    const html = await render(row({ images: "[]", assets: "[]", tagline: "" }));
    assert.ok(html.includes("🌙"));
    assert.ok(html.includes("한 줄 소개 없음"));
  });

  it("hands the emoji to the carousel as the all-images-failed fallback, blurred for gated cards", async () => {
    const open = await render(row({ emoji: "🦊" }), { loggedIn: true });
    assert.ok(open.includes("fallback=<span") && open.includes("🦊"));
    const gated = await render(row({ emoji: "🦊", nsfw: 1 }), { blurNsfw: true, loggedIn: true });
    assert.match(gated, /fallback=<span className="[^"]*blur-md[^"]*">🦊/);
    const home = await render(row({ emoji: "🦊" }), { variant: "index", loggedIn: true });
    assert.ok(home.includes("fallback=<span") && home.includes("🦊"));
  });

  it("keeps adult cards gated: blurred overlay, no tagline leak, login-gated link", async () => {
    const html = await render(row({ nsfw: 1, tagline: "성인 전용 비밀 소개" }), { blurNsfw: true, loggedIn: true });
    assert.ok(html.includes("성인인증 필요"));
    assert.ok(html.includes("성인인증 후 확인할 수 있습니다."));
    assert.ok(!html.includes("성인 전용 비밀 소개"));
    assert.ok(html.includes('href="/verify?redirect=%2Fcharacter%2F7"'));
    assert.ok(!html.includes("data-character-card"));
    assert.ok(html.includes("hidden=true"));
  });

  it("keeps creator, genre and tag meta readable on both card families", async () => {
    for (const variant of ["default", "index"] as const) {
      const html = await render(row(), { variant, loggedIn: true });
      const minCreator = variant === "default" ? /text-\[12\.5px\]/ : /text-\[11px\]/;
      assert.match(html, new RegExp(`<a[^>]*href="/creator/3"[^>]*${minCreator.source}`), `${variant} creator link size`);
      assert.doesNotMatch(html, /<span className="text-(zinc-[56]00|emerald-600\/80)">by<\/span>/, variant);
    }
    const index = await render(row(), { variant: "index", loggedIn: true });
    assert.doesNotMatch(index, /text-\[1[01]px\][^"]*text-zinc-[56]00/);
    for (const tier of ["sprout", "standard", "pro"] as const) {
      const html = await render(row({ creator_tier_level: tier }), { loggedIn: true });
      assert.doesNotMatch(html, /className="text-(zinc-[56]00|emerald-600\/80)">by/, tier);
    }
  });

  it("does not leak the default chrome into the home index variant", async () => {
    const html = await render(row(), { variant: "index" });
    assert.match(html, /home-card--index/);
    assert.ok(!html.includes("rounded-[1.15rem]"));
  });

  it("gives the default card links 24px+ targets, visible focus and no clipped tags", async () => {
    const html = await render(row({ tags: JSON.stringify(["하나", "둘", "셋", "넷", "다섯"]) }), { loggedIn: true });
    const link = (href: string) => html.match(new RegExp(`<a[^>]*href="${href}"[^>]*>`))?.[0] ?? "";
    for (const tag of ["하나", "둘", "셋", "넷"]) {
      const a = link(`/search\\?q=${encodeURIComponent(tag)}`);
      assert.match(a, /\bh-6\b/, `${tag} tag is 24px tall`);
      assert.match(a, /focus-visible:ring-2/, `${tag} tag shows a focus ring`);
    }
    assert.ok(!html.includes("%EB%8B%A4%EC%84%AF"), "only four tags render");
    assert.match(link("/creator/3"), /py-1[^"]*focus-visible:ring-2|focus-visible:ring-2[^"]*py-1/, "creator link has padding and a focus ring");
    const tagsWrap = html.match(/<div className="[^"]*overflow-x-auto[^"]*">/)?.[0] ?? "";
    assert.ok(tagsWrap, "tags are a scrollable single row");
    assert.doesNotMatch(tagsWrap, /overflow-hidden|max-h-|flex-wrap/);
    assert.match(html, /<h3 className="[^"]*break-keep/);
    assert.match(html, /<p className="[^"]*text-\[13px\]/);
    assert.doesNotMatch(html, /<p className="[^"]*break-keep[^"]*text-\[13px\]/);
    assert.match(html, /<a [^>]*href="\/creator\/3"[^>]*class(Name)?="[^"]*truncate[^"]*py-1/);
  });

  it("keeps adult and status badges apart on the default card and leaves home badges alone", async () => {
    const c = row({ nsfw: 1, official: 1, content_kind: "simulation" });
    const html = await render(c, { loggedIn: true, blurNsfw: false });
    assert.match(html, /max-w-\[calc\(100%-5rem\)\]/);
    assert.match(html, /text-\[10\.5px\][^"]*text-violet-100/);
    const home = await render(c, { variant: "index", loggedIn: true, blurNsfw: false });
    assert.ok(!home.includes("max-w-[calc(100%-5rem)]"));
    assert.match(home, /text-\[9px\]/);
  });
});
