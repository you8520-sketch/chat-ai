import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as React from "react";
import type { ReactElement, ReactNode } from "react";

import { moderationLabel, visibilityLabel } from "@/lib/characterVisibility";
import type { CharacterVisibility, ModerationStatus } from "@/lib/characterVisibility";
import { StudioWorkNotice, StudioWorkStatus } from "@/components/studio/StudioWorkMeta";

(globalThis as { React?: typeof React }).React = React;

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const card = read("./MyCharacterCard.tsx");
const actions = read("./MyCharacterCardActions.tsx");
const studio = read("./StudioClient.tsx");
const meta = read("./studio/StudioWorkMeta.tsx");

type AnyElement = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

function text(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const element = node as AnyElement;
  if (typeof element.type === "function") {
    return text((element.type as (props: unknown) => ReactNode)(element.props));
  }
  return text(element.props.children);
}

const VISIBILITIES: CharacterVisibility[] = ["public", "link", "private"];
const MODERATIONS: ModerationStatus[] = ["approved", "pending", "rejected"];

describe("studio work status chips", () => {
  it("separate work kind, visibility and moderation using the canonical labels", () => {
    for (const visibility of VISIBILITIES) {
      for (const moderation of MODERATIONS) {
        for (const isSimulation of [false, true]) {
          const rendered = text(StudioWorkStatus({ isSimulation, visibility, moderation }));
          assert.ok(rendered.includes(isSimulation ? "시뮬레이션" : "캐릭터"));
          assert.ok(rendered.includes(visibilityLabel(visibility)));
          assert.ok(rendered.includes(moderationLabel(moderation)));
        }
      }
    }
  });

  it("always names the moderation state, including the approved one that used to be implicit", () => {
    const rendered = text(StudioWorkStatus({ isSimulation: false, visibility: "public", moderation: "approved" }));
    assert.match(rendered, /검수 통과/);
  });
});

describe("studio work moderation notice", () => {
  it("is silent for approved works and explains pending works", () => {
    assert.equal(StudioWorkNotice({ moderation: "approved", note: "무시되는 메모" }), null);
    const pending = text(StudioWorkNotice({ moderation: "pending", note: "" }));
    assert.match(pending, /검수가 끝나기 전에는 다른 사람에게 보이지 않습니다/);
  });

  it("explains rejected works even when no reason was written", () => {
    const rendered = text(StudioWorkNotice({ moderation: "rejected", note: "   " }));
    assert.match(rendered, /반려되어 다른 사람에게 보이지 않습니다/);
    assert.doesNotMatch(rendered, /반려 사유/);
  });

  it("shows the whole rejection reason with an expand control instead of a 10px clamp", () => {
    assert.match(meta, /반려 사유/);
    assert.match(meta, /aria-expanded=\{expanded\}/);
    assert.doesNotMatch(meta, /text-\[10px\]/);
  });
});

describe("studio work card actions", () => {
  it("keeps the delete API, edit path and permanent-deletion notice", () => {
    assert.match(actions, /fetch\(`\/api\/characters\/\$\{characterId\}`, \{ method: "DELETE" \}\)/);
    assert.match(actions, /editHref \?\? `\/create\?edit=\$\{characterId\}`/);
    assert.match(actions, /대화 기록·좋아요·댓글 등 관련 데이터가 영구적으로 삭제되며 되돌릴 수 없습니다/);
    assert.match(actions, /if \(official !== 0\) return null/);
    assert.match(card, /editHref=\{editHref\}/);
    assert.match(studio, /editHref=\{`\/create\?edit=\$\{creation\.id\}`\}/);
  });

  it("blocks duplicate delete requests while one is in flight", () => {
    assert.match(actions, /const inFlight = useRef\(false\)/);
    assert.match(actions, /if \(inFlight\.current\) return;/);
    assert.match(actions, /confirmDisabled=\{deleting\}/);
    assert.match(actions, /if \(!deleting\) setConfirmOpen\(false\)/);
  });

  it("shows a delete failure inside the dialog instead of behind its backdrop", () => {
    assert.match(actions, /role="alert"/);
    assert.match(actions, /\{error \? \(/);
    assert.doesNotMatch(actions, /absolute left-2 right-2 top-10/);
  });

  it("uses 44px touch targets and no longer floats the buttons over the card image", () => {
    assert.match(actions, /size="sm"/);
    assert.doesNotMatch(actions, /absolute right-2 top-2/);
    assert.doesNotMatch(actions, /text-\[10px\]/);
    assert.match(read("./studio/StudioButton.tsx"), /sm: "min-h-11/);
  });

  it("renders the status block outside the shared CharacterCard so badges cannot cover its text", () => {
    assert.doesNotMatch(card, /absolute bottom-\[3\.5rem\]/);
    assert.match(card, /<CharacterCard c=\{c\} blurNsfw=\{blurNsfw\} loggedIn \/>/);
    assert.match(card, /<StudioWorkStatus/);
  });
});

describe("studio world management", () => {
  it("asks for confirmation before removing a library world and keeps the existing endpoints", () => {
    assert.match(studio, /<ConfirmDialog/);
    assert.match(studio, /title="라이브러리에서 제거"/);
    assert.match(studio, /\/api\/world-borrows\/\$\{world\.borrowId\}/);
    assert.match(studio, /\/api\/worlds\/\$\{world\.id\}`, \{ method: "DELETE" \}/);
    assert.match(studio, /removeInFlight/);
    assert.match(studio, /confirmDisabled=\{removeBusy\}/);
  });

  it("never offers new creation from a share-ended borrowed world", () => {
    assert.match(studio, /borrowUnavailable \? null : \(/);
    assert.match(studio, /원본 공유가 종료되어 캐릭터·시뮬레이션 신규 제작에 사용할 수 없습니다/);
  });

  it("keeps world context query params on both creation links", () => {
    assert.match(studio, /`\/create\?worldBorrowId=\$\{world\.borrowId\}`/);
    assert.match(studio, /`\/create\?worldId=\$\{world\.id\}`/);
    assert.match(studio, /`\/create\?kind=simulation&worldBorrowId=\$\{world\.borrowId\}`/);
    assert.match(studio, /`\/create\?kind=simulation&worldId=\$\{world\.id\}`/);
  });

  it("guards share creation against double submits and wraps long links", () => {
    assert.match(studio, /shareInFlight/);
    assert.match(studio, /break-all/);
    assert.match(studio, /\/api\/worlds\/\$\{world\.id\}\/share/);
  });
});

describe("studio lorebook list", () => {
  it("shows name, description, item count and edit link without truncating to one line", () => {
    assert.match(studio, /href=\{`\/lorebook\/\$\{lb\.id\}\/edit`\}/);
    assert.match(studio, /lb\.entryCount === 0 \? "항목 없음"/);
    assert.match(studio, /line-clamp-2/);
    assert.doesNotMatch(studio, /<p className="truncate font-semibold text-zinc-50">\{lb\.name\}/);
  });
});

describe("studio tab contract", () => {
  it("keeps the three canonical tabs and URL aliases", () => {
    for (const alias of ["worlds", "world", "lorebooks", "lorebook", "lore", "creations", "characters", "simulations"]) {
      assert.match(studio, new RegExp(`raw === "${alias}"`));
    }
  });
});

describe("E4-7 studio creator menu", () => {
  const page = read("../app/studio/page.tsx");
  const button = read("./studio/StudioButton.tsx");

  it("derives the own-profile id from the server-verified session user, not from the URL or client state", () => {
    assert.match(page, /const user = await getSessionUser\(\)/);
    assert.match(page, /creatorId=\{user\.id\}/);
    assert.doesNotMatch(page, /searchParams/);
  });

  it("links the dashboard and the own public profile as two distinct, labelled destinations", () => {
    assert.match(studio, /href="\/creator"[\s\S]{1,200}title="수익·CP·공지를 관리하는 나만의 대시보드"[\s\S]{1,40}크리에이터 대시보드/);
    assert.match(studio, /href=\{`\/creator\/\$\{creatorId\}`\}[\s\S]{1,200}title="다른 사용자에게 보이는 내 제작자 페이지"[\s\S]{1,40}내 공개 프로필/);
    assert.match(studio, /aria-label="제작자 메뉴"/);
    assert.match(button, /title=\{title\}/);
  });

  it("keeps the existing reverse links on the creator dashboard", () => {
    const creator = read("../app/creator/CreatorClient.tsx");
    assert.match(creator, /href=\{`\/creator\/\$\{creatorId\}`\}/);
    assert.match(creator, /href="\/studio"/);
  });
});
