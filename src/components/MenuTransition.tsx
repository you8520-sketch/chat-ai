"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  isPlainLeftClick,
  MENU_TRANSITION_ATTR,
  MENU_TRANSITION_TIMING,
  menuRevealDelayMs,
  resolveMenuClickTransition,
  type MenuTransitionSpec,
} from "@/lib/menuTransitionSpec";
import {
  CHARACTER_CARD_ATTR,
  CHARACTER_HERO_IMAGE_ATTR,
  CHARACTER_REVEAL_TIMING,
  HERO_ITEM_ATTR,
  REVEAL_FIT_ATTR,
  REVEAL_ITEM_ATTR,
  characterRevealDelayMs,
  computeRevealLayout,
  flipClipInset,
  flipTransform,
  parseCharacterProfilePath,
  parseRevealTags,
  revealSettleDelta,
  splitRevealName,
  type RevealRect,
} from "@/lib/characterReveal";
import CharacterRevealScene, { type CharacterScene } from "@/components/CharacterRevealScene";
import {
  CHAT_RESUME_ATTR,
  CHAT_RESUME_CHAT_ATTR,
  CHAT_RESUME_NAME_ATTR,
  CHAT_RESUME_THUMB_ATTR,
  CHAT_RESUME_TIMING,
  CHAT_ROOM_CHARACTER_ATTR,
  CHAT_ROOM_ID_ATTR,
  chatResumeInkRadius,
  chatResumeIris,
  chatResumePageLooksFailed,
  chatResumeRevealDelayMs,
  computeChatResumeLayout,
  decideChatBurstAction,
  isSameChatRoom,
  parseChatResumeHref,
  resolveChatArrival,
  resolveChatResumeTarget,
  type ChatRoomRef,
} from "@/lib/chatResumeTransition";
import ChatResumeScene, { type ChatResumeScene as ChatScene } from "@/components/ChatResumeScene";

/**
 * 공통 전환 lifecycle의 단일 owner (Phase C 메뉴 + Phase D-1 캐릭터 reveal + Phase D-2 채팅방 이어가기).
 *
 * - canonical navigation owner는 기존 `next/link` 그대로 (href·redirect·query 불변).
 * - 시각 렌더만 kind로 구분한다.
 *   - `menu`: 승인된 메뉴 영역(`data-menu-transition`) 클릭 → Phase C 그래픽 전환.
 *   - `character`: 캐릭터 카드(`data-character-card`)의 프로필 링크 클릭 → artwork reveal.
 *   - `chat`: 최근 활동의 캐릭터 채팅 행(`data-chat-resume`) 클릭 → 기존 채팅방 reveal.
 *     방은 characterId + chatId로 식별하고(query-only 이동 포함), 실제 방 마커가 도착해야 분할한다.
 *   콘텐츠 링크(태그·제작자)·TRPG 최근 활동·history traversal은 대상 아님.
 * - navigation을 지연시키지 않고, router를 직접 호출하지 않으며,
 *   오버레이는 항상 `pointer-events: none`이라 기능을 가로막지 않는다.
 */

type BurstBase = {
  id: number;
  dest: string;
  phase: "cover" | "reveal";
};
type MenuBurst = BurstBase & { kind: "menu"; spec: MenuTransitionSpec };
type CharacterBurst = BurstBase & { kind: "character"; scene: CharacterScene };
type ChatBurst = BurstBase & {
  kind: "chat";
  scene: ChatScene;
  origin: ChatRoomRef | null;
  /** 목적지 위치(pathname + search). */
  url: string;
  /** 이 burst가 밀어낸 이전 burst들의 목적지 — 먼저 도착해도 최종 방이 아니다. */
  superseded: string[];
  /** 클릭 당시 위치. 늦은 RSC 동안 그대로면 pending이다. */
  from: string;
};
type Burst = MenuBurst | CharacterBurst | ChatBurst;

function timingFor(kind: Burst["kind"]) {
  switch (kind) {
    case "menu":
      return MENU_TRANSITION_TIMING;
    case "character":
      return CHARACTER_REVEAL_TIMING;
    case "chat":
      return CHAT_RESUME_TIMING;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function revealDelayFor(kind: Burst["kind"], elapsedMs: number): number {
  switch (kind) {
    case "menu":
      return menuRevealDelayMs(elapsedMs);
    case "character":
      return characterRevealDelayMs(elapsedMs);
    case "chat":
      return chatResumeRevealDelayMs(elapsedMs);
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function intersect(a: RevealRect, b: DOMRect): RevealRect {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.right);
  const bottom = Math.min(a.top + a.height, b.bottom);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** 카드가 가로 스크롤/overflow 컨테이너와 뷰포트에 잘린 만큼만 보이는 영역. */
function visibleRect(el: Element, rect: RevealRect): RevealRect {
  let visible = intersect(rect, new DOMRect(0, 0, window.innerWidth, window.innerHeight));
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
      visible = intersect(visible, p.getBoundingClientRect());
    }
  }
  return visible;
}

/** 클릭한 카드에서 실제로 보이던 공개 이미지와 위치를 읽어 reveal scene을 만든다. 불가하면 null. */
function buildCharacterScene(card: Element, id: number): CharacterScene | null {
  const img = card.querySelector("img");
  if (!(img instanceof HTMLImageElement) || !img.complete || img.naturalWidth === 0) return null;
  const src = img.currentSrc || img.src;
  if (!src || src.includes("/media/private/")) return null;
  const r = img.getBoundingClientRect();
  const from: RevealRect = { left: r.left, top: r.top, width: r.width, height: r.height };
  if (from.width < 48 || from.height < 48) return null;
  const visible = visibleRect(img, from);
  if (visible.width < 24 || visible.height < 24) return null;

  const { lines, maxChars } = splitRevealName(card.getAttribute("data-character-name") ?? "");
  const layout = computeRevealLayout(window.innerWidth, window.innerHeight, lines.length, maxChars);
  const start = flipTransform(from, layout.frame);
  const viewport = document.documentElement;
  return {
    id,
    src,
    lines,
    genre: (card.getAttribute("data-character-genre") ?? "").trim(),
    tagline: (card.getAttribute("data-character-tagline") ?? "").trim(),
    tags: parseRevealTags(card.getAttribute("data-character-tags")),
    layout,
    card: {
      top: visible.top,
      left: visible.left,
      right: Math.max(0, viewport.clientWidth - (visible.left + visible.width)),
      bottom: Math.max(0, viewport.clientHeight - (visible.top + visible.height)),
    },
    start: { ...start, clip: flipClipInset(visible, from, layout.frame, start.scale) },
    hero: null,
    items: {},
  };
}

/** 도착한 프로필 hero 이미지 프레임 위치로 일러스트가 안착하도록 목표를 읽는다. */
function readHeroTarget(scene: CharacterScene): CharacterScene["hero"] {
  const el = document.querySelector(`[${CHARACTER_HERO_IMAGE_ATTR}="${scene.id}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 48 || r.height < 48) return null;
  const heroImg = el.querySelector("img");
  return {
    ...flipTransform({ left: r.left, top: r.top, width: r.width, height: r.height }, scene.layout.frame),
    src: heroImg instanceof HTMLImageElement ? heroImg.currentSrc || heroImg.src : "",
  };
}

/** 오버레이의 각 요소가 도착한 프로필 hero의 같은 요소 위치로 이동하도록 이동량을 읽는다. */
function readItemTargets(scene: CharacterScene): CharacterScene["items"] {
  const items: CharacterScene["items"] = {};
  const hero = document.querySelector(`[data-character-hero="${scene.id}"]`);
  const veil = document.querySelector(`[data-character-reveal="${scene.id}"]`);
  if (!hero || !veil) return items;
  for (const from of veil.querySelectorAll(`[${REVEAL_ITEM_ATTR}]`)) {
    const key = from.getAttribute(REVEAL_ITEM_ATTR);
    if (!key) continue;
    const to = hero.querySelector(`[${HERO_ITEM_ATTR}="${key}"]`);
    if (!to) continue;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    if (b.width < 8 || b.height < 8 || a.width < 1) continue;
    items[key] = revealSettleDelta(
      { left: a.left, top: a.top, width: a.width, height: a.height },
      { left: b.left, top: b.top, width: b.width, height: b.height },
      from.getAttribute(REVEAL_FIT_ATTR) === "width",
    );
  }
  return items;
}

/** 실제 채팅방(ChatClient 루트 마커)에 지금 열려 있는 방. 없으면 null. */
function readChatRoom(): ChatRoomRef | null {
  const el = document.querySelector(`[${CHAT_ROOM_ID_ATTR}]`);
  if (!el) return null;
  const characterId = Number(el.getAttribute(CHAT_ROOM_CHARACTER_ATTR));
  const chatId = Number(el.getAttribute(CHAT_ROOM_ID_ATTR));
  return Number.isSafeInteger(characterId) && characterId > 0 && Number.isSafeInteger(chatId) && chatId > 0
    ? { characterId, chatId }
    : null;
}

/** 지금 보고 있는 방: 마커가 우선이고, 아직 마운트 전이면 URL로 식별한다. */
function currentChatRoom(): ChatRoomRef | null {
  return readChatRoom() ?? parseChatResumeHref(window.location.pathname, window.location.search);
}

/** 클릭한 최근 활동 행에서 이미 보이던 공개 썸네일·이름만 읽어 scene을 만든다. 썸네일 원을 못 읽으면 null. */
function buildChatResumeScene(anchor: Element, room: ChatRoomRef): ChatScene | null {
  const thumb = anchor.querySelector(`[${CHAT_RESUME_THUMB_ATTR}]`);
  if (!(thumb instanceof HTMLElement)) return null;
  const rect = thumb.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const d = Math.min(rect.width, rect.height);
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (d < 16 || x < 0 || x > vw || y < 0 || y > vh) return null;

  const img = thumb.querySelector("img");
  const loaded = img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  const rawSrc = loaded ? img.currentSrc || img.src : "";
  const src = rawSrc && !rawSrc.includes("/media/private/") ? rawSrc : null;
  const background = getComputedStyle(thumb).backgroundColor;
  const fill = /^rgba?\([\d\s.,/]+\)$/.test(background) ? background : null;
  const glyph = Array.from((thumb.textContent ?? "").trim()).slice(0, 2).join("");

  const { lines, maxChars } = splitRevealName(anchor.getAttribute(CHAT_RESUME_NAME_ATTR) ?? "");
  const layout = computeChatResumeLayout(vw, vh, lines.length, maxChars);
  const origin: RevealRect = { left: x - d / 2, top: y - d / 2, width: d, height: d };
  return {
    room,
    src,
    fill,
    glyph,
    lines,
    layout,
    ink: { x, y, r0: d / 2, r1: chatResumeInkRadius(x, y, vw, vh) },
    iris: chatResumeIris(origin, layout.frame),
  };
}

let burstSeq = 0;

/** 루트 레이아웃에 상주하는 단일 전환 레이어. */
export default function MenuTransitionHost() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [burst, setBurst] = useState<Burst | null>(null);
  const burstRef = useRef<Burst | null>(null);
  const timers = useRef<number[]>([]);
  const lastLoc = useRef<{ path: string; key: string } | null>(null);
  const startedAt = useRef(0);

  function clearTimers() {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }

  function dropBurst(id: number) {
    clearTimers();
    if (burstRef.current && burstRef.current.id === id) {
      burstRef.current = null;
      setBurst(null);
    }
  }

  function beginReveal(id: number) {
    const cur = burstRef.current;
    if (!cur || cur.id !== id || cur.phase === "reveal") return;
    const arrived = cur.kind === "character" && window.location.pathname === cur.dest;
    const revealed: Burst =
      cur.kind === "character"
        ? {
            ...cur,
            phase: "reveal",
            scene: {
              ...cur.scene,
              hero: arrived ? readHeroTarget(cur.scene) : null,
              items: arrived ? readItemTargets(cur.scene) : {},
            },
          }
        : { ...cur, phase: "reveal" };
    burstRef.current = revealed;
    setBurst(revealed);
    timers.current.push(
      window.setTimeout(() => {
        if (burstRef.current && burstRef.current.id === id) {
          burstRef.current = null;
          setBurst(null);
        }
      }, timingFor(cur.kind).revealMs),
    );
  }

  function startBurst(next: Burst) {
    clearTimers();
    burstRef.current = next;
    startedAt.current = performance.now();
    setBurst(next);
    const timing = timingFor(next.kind);
    // 메뉴·캐릭터는 도착이 늦어도 holdMax에 분할한다. 채팅은 실제 방이 오기 전에
    // 분할하면 이전 화면이 드러나므로 holdMax로 열지 않는다.
    if (next.kind !== "chat") {
      timers.current.push(window.setTimeout(() => beginReveal(next.id), timing.holdMaxMs));
    }
    // 이동 실패 대비 failsafe. 채팅의 pending(늦은 RSC)은 여기로 걷지 않는다.
    timers.current.push(
      window.setTimeout(() => {
        const cur = burstRef.current;
        if (!cur || cur.id !== next.id) return;
        if (cur.kind === "chat") {
          syncChatBurst(cur.id);
          return;
        }
        burstRef.current = null;
        setBurst(null);
      }, timing.failsafeMs),
    );
  }

  function syncChatBurst(id: number) {
    const cur = burstRef.current;
    if (!cur || cur.id !== id || cur.kind !== "chat") return;
    const arrival = resolveChatArrival({
      dest: cur.scene.room,
      origin: cur.origin,
      room: readChatRoom(),
      pathname: window.location.pathname,
      url: `${window.location.pathname}${window.location.search}`,
      superseded: cur.superseded,
      from: cur.from,
    });
    const action = decideChatBurstAction(
      arrival,
      arrival === "pending" && chatResumePageLooksFailed(document),
    );
    switch (action) {
      case "drop":
        dropBurst(id);
        return;
      case "hold":
        return;
      case "reveal":
        if (cur.phase === "cover") {
          const delay = revealDelayFor("chat", performance.now() - startedAt.current);
          timers.current.push(window.setTimeout(() => beginReveal(id), delay));
        }
        return;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  }

  function scheduleMenuBurst(spec: MenuTransitionSpec, dest: string) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    burstSeq += 1;
    startBurst({ kind: "menu", id: burstSeq, spec, dest, phase: "cover" });
  }

  function scheduleCharacterBurst(scene: CharacterScene, dest: string) {
    burstSeq += 1;
    startBurst({ kind: "character", id: burstSeq, scene, dest, phase: "cover" });
  }

  function scheduleChatBurst(scene: ChatScene, dest: URL, origin: ChatRoomRef | null) {
    const running = burstRef.current;
    const superseded = running
      ? running.kind === "chat"
        ? [...running.superseded, running.url]
        : [running.dest]
      : [];
    burstSeq += 1;
    startBurst({
      kind: "chat",
      id: burstSeq,
      scene,
      dest: dest.pathname,
      url: `${dest.pathname}${dest.search}`,
      from: `${window.location.pathname}${window.location.search}`,
      origin,
      superseded,
      phase: "cover",
    });
  }

  // BEAT 1 — 승인된 영역(메뉴 / 캐릭터 카드 / 최근 채팅 행)의 클릭에 즉각 반응. navigation은 그대로 진행.
  useEffect(() => {
    function onClickCapture(e: MouseEvent) {
      if (!isPlainLeftClick(e)) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const dest = new URL(anchor.href, window.location.href);
      if (dest.origin !== window.location.origin) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // 최근 활동의 캐릭터 채팅 행(href가 정확히 /chat/:id?chat=:chatId)만. TRPG·성인 가림(/verify) 행은 마커가 없다.
      if (anchor.hasAttribute(CHAT_RESUME_ATTR)) {
        const room = resolveChatResumeTarget({
          markerCharacterId: anchor.getAttribute(CHAT_RESUME_ATTR),
          markerChatId: anchor.getAttribute(CHAT_RESUME_CHAT_ATTR),
          destPathname: dest.pathname,
          destSearch: dest.search,
        });
        if (reduced || !room) return;
        const current = currentChatRoom();
        if (isSameChatRoom(current, room)) return;
        const running = burstRef.current;
        if (running?.kind === "chat" && isSameChatRoom(running.scene.room, room)) return;
        const scene = buildChatResumeScene(anchor, room);
        if (!scene) return;
        anchor.classList.remove("cr-pick");
        void anchor.offsetWidth;
        anchor.classList.add("cr-pick");
        window.setTimeout(() => anchor.classList.remove("cr-pick"), 420);
        scheduleChatBurst(scene, dest, current);
        return;
      }

      // 캐릭터 카드의 프로필 링크(href가 정확히 /character/:id)만. 태그·제작자·login/verify redirect는 제외.
      const card = anchor.closest(`[${CHARACTER_CARD_ATTR}]`);
      if (card) {
        const id = Number(card.getAttribute(CHARACTER_CARD_ATTR));
        if (
          reduced ||
          !Number.isSafeInteger(id) ||
          parseCharacterProfilePath(dest.pathname) !== id ||
          dest.search ||
          dest.pathname === window.location.pathname
        ) {
          return;
        }
        const scene = buildCharacterScene(card, id);
        if (scene) scheduleCharacterBurst(scene, dest.pathname);
        return;
      }

      if (!anchor.closest(`[${MENU_TRANSITION_ATTR}]`)) return;
      const spec = resolveMenuClickTransition({
        inMenuRegion: true,
        destPathname: dest.pathname,
        currentPathname: window.location.pathname,
      });
      if (!spec) return;
      anchor.classList.remove("menu-flash");
      void anchor.offsetWidth;
      anchor.classList.add("menu-flash");
      window.setTimeout(() => anchor.classList.remove("menu-flash"), 350);
      scheduleMenuBurst(spec, dest.pathname);
    }
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, []);

  // BEAT 3 — 클릭으로 시작된 burst만 목적지 도착 시 reveal. 클릭 없는 경로 변경
  // (뒤로/앞으로 가기, 프로그래밍 이동, 콘텐츠 링크)은 veil을 만들지 않는다.
  // 캐릭터 burst는 자기 목적지 도착만 인정한다. 일반 콘텐츠·history로 프로필을
  // 벗어나면 오래된 scene을 즉시 내린다. 다른 /character/:id 중간 도착은
  // 빠른 연속 클릭이므로 유지한다.
  // 채팅 burst는 query-only 이동(?chat=)도 도착 신호로 보고, 실제 방 마커(characterId + chatId)가
  // 확인될 때만 reveal한다. 채팅방이 아닌 곳이나 다른 캐릭터의 방으로 가면 즉시 내린다.
  useEffect(() => {
    const key = `${pathname}?${search}`;
    const prev = lastLoc.current;
    lastLoc.current = { path: pathname, key };
    if (prev === null || prev.key === key) return;
    const cur = burstRef.current;
    if (!cur) return;
    if (cur.kind === "chat") {
      syncChatBurst(cur.id);
      return;
    }
    if (prev.path === pathname) return;
    if (cur.kind === "character" && pathname !== cur.dest) {
      if (parseCharacterProfilePath(pathname) === null) dropBurst(cur.id);
      return;
    }
    if (cur.phase === "reveal") return;
    const delay = revealDelayFor(cur.kind, performance.now() - startedAt.current);
    timers.current.push(window.setTimeout(() => beginReveal(cur.id), delay));
  }, [pathname, search]);

  // 채팅 전환: URL이 먼저 커밋되고 방 마커가 늦게 붙는 경우를 같은 owner 안에서 감지한다.
  useEffect(() => {
    if (!burst || burst.kind !== "chat") return;
    const id = burst.id;
    const mo = new MutationObserver(() => syncChatBurst(id));
    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [CHAT_ROOM_ID_ATTR, CHAT_ROOM_CHARACTER_ATTR],
    });
    syncChatBurst(id);
    return () => mo.disconnect();
  }, [burst?.id, burst?.kind]);

  useEffect(() => () => clearTimers(), []);

  if (!burst) return null;
  switch (burst.kind) {
    case "menu": {
      const { spec } = burst;
      return (
        <div
          key={burst.id}
          aria-hidden
          data-motif={spec.motif}
          data-phase={burst.phase}
          className="menu-veil"
          style={{ "--menu-accent": spec.accent, "--menu-chars": spec.en.length } as CSSProperties}
        >
          <div className="menu-ink" />
          <div className="menu-field" />
          <div className="menu-type">
            <div className="menu-slab">
              <span className="menu-en">{spec.en}</span>
              <span className="menu-ko">{spec.ko}</span>
            </div>
          </div>
        </div>
      );
    }
    case "character":
      return <CharacterRevealScene key={burst.id} scene={burst.scene} phase={burst.phase} />;
    case "chat":
      return <ChatResumeScene key={burst.id} scene={burst.scene} phase={burst.phase} />;
    default: {
      const _exhaustive: never = burst;
      return _exhaustive;
    }
  }
}
