import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildQuoteCardFooterLeft,
  canShareQuoteCardPng,
  clampQuoteCardBodyFontSize,
  copyQuoteCardPng,
  clampQuoteCardAvatarFocus,
  listQuoteCardDialogueEntries,
  parseQuoteCardBlocks,
  prepareQuoteCardSaveFallbackWindow,
  quoteCardDimensions,
  quoteCardFontById,
  quoteCardThemeById,
  resolveQuoteCardDialogueStyle,
  resolveQuoteCardHeight,
  resolveQuoteCardSpeakers,
  QUOTE_CARD_BODY_FONT_MAX,
  QUOTE_CARD_BODY_FONT_MIN,
  QUOTE_CARD_DEFAULT_BACKGROUND,
  QUOTE_CARD_DEFAULT_FOOTER_FONT_SIZE,
  QUOTE_CARD_FONTS,
  QUOTE_CARD_HEIGHT_MAX,
  QUOTE_CARD_HEIGHT_MIN,
  QUOTE_CARD_THEMES,
  QUOTE_CARD_WIDTH,
  saveQuoteCardPngWithFallback,
  shareQuoteCardPng,
  styleFromQuoteCardTheme,
} from "@/lib/quoteCardImage";

describe("quote card fonts and themes", () => {
  it("exposes system + 4 novel font options", () => {
    assert.equal(QUOTE_CARD_FONTS.length, 5);
    assert.ok(QUOTE_CARD_FONTS.some((f) => f.id === "noto-serif"));
    assert.ok(QUOTE_CARD_FONTS.some((f) => f.id === "nanum-myeongjo"));
    assert.ok(QUOTE_CARD_FONTS.some((f) => f.id === "gowun-batang"));
    assert.ok(QUOTE_CARD_FONTS.some((f) => f.id === "song-myung"));
    assert.match(quoteCardFontById("noto-serif").css, /Noto Serif KR/);
  });

  it("exposes white/black/blue themes with readable body colors", () => {
    assert.equal(QUOTE_CARD_THEMES.length, 3);
    assert.equal(quoteCardThemeById("black").background, "#0a0a0a");
    assert.equal(quoteCardThemeById("blue").background, "#0c1929");
    const black = styleFromQuoteCardTheme("black");
    assert.notEqual(black.bodyColor, black.background);
    assert.ok(black.bodyColor.startsWith("#"));
  });
});

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalURL = globalThis.URL;

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
  Object.defineProperty(globalThis, "URL", { value: originalURL, configurable: true });
});

function installDomStubs(opts: {
  iosSafari?: boolean;
  openReturns?: { location: { href: string }; closed?: boolean; close: () => void; document?: { open: () => void; write: (html: string) => void; close: () => void } } | null;
} = {}) {
  let clicked = 0;
  let opened = 0;
  let revoked = 0;
  let lastOpenFeatures: string | undefined;
  let writtenHtml = "";
  const anchor = {
    href: "",
    download: "",
    rel: "",
    click() { clicked++; },
    remove() {},
  };
  const win = {
    open(_url?: string, _name?: string, features?: string) {
      opened++;
      lastOpenFeatures = features;
      return opts.openReturns === undefined
        ? {
            location: { href: "" },
            closed: false,
            close() {},
            document: {
              open() {},
              write(html: string) { writtenHtml = html; },
              close() {},
            },
          }
        : opts.openReturns;
    },
    setTimeout(cb: () => void) {
      cb();
      return 1;
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    value: {
      userAgent: opts.iosSafari
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : "Mozilla/5.0 Chrome/120 Safari/537.36",
      platform: opts.iosSafari ? "iPhone" : "Linux x86_64",
      maxTouchPoints: opts.iosSafari ? 5 : 0,
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  Object.defineProperty(globalThis, "document", {
    value: { createElement: () => anchor, body: { appendChild() {} } },
    configurable: true,
  });
  Object.defineProperty(globalThis, "URL", {
    value: {
      createObjectURL: () => "blob:test",
      revokeObjectURL: () => { revoked++; },
    },
    configurable: true,
  });
  return {
    anchor,
    get clicked() { return clicked; },
    get opened() { return opened; },
    get revoked() { return revoked; },
    get lastOpenFeatures() { return lastOpenFeatures; },
    get writtenHtml() { return writtenHtml; },
  };
}

describe("buildQuoteCardFooterLeft", () => {
  it("joins character and creator with middle dot", () => {
    assert.equal(
      buildQuoteCardFooterLeft({ bodyText: "", characterName: "하비", creatorName: "Ray" }),
      "하비 · Ray"
    );
  });

  it("uses character only when creator missing", () => {
    assert.equal(
      buildQuoteCardFooterLeft({ bodyText: "", characterName: "하비", creatorName: "" }),
      "하비"
    );
  });
});

describe("parseQuoteCardBlocks", () => {
  it("splits narration and quoted dialogue", () => {
    const blocks = parseQuoteCardBlocks(
      '에녹은 손전등을 낮췄다.\n"소리 죽여."\n통로 끝에서 물방울이 떨어졌다.'
    );
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["narration", "dialogue", "narration"]
    );
    assert.equal(blocks[1]!.text, "소리 죽여.");
  });

  it("supports corner brackets", () => {
    const blocks = parseQuoteCardBlocks("「이쪽이다.」");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "dialogue");
    assert.equal(blocks[0]!.text, "이쪽이다.");
  });

  it("keeps plain text as narration", () => {
    const blocks = parseQuoteCardBlocks("그냥 지문만 있다.");
    assert.deepEqual(blocks, [{ type: "narration", text: "그냥 지문만 있다." }]);
  });

  it("parses speaker prefixes before quotes", () => {
    const blocks = parseQuoteCardBlocks('카이: "잠깐."\n라이크：「그래.」');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "dialogue");
    assert.equal(blocks[0]!.speaker, "카이");
    assert.equal(blocks[0]!.text, "잠깐.");
    assert.equal(blocks[1]!.speaker, "라이크");
    assert.equal(blocks[1]!.text, "그래.");
  });

  it("parses inline speaker before a quote", () => {
    const blocks = parseQuoteCardBlocks('그가 말했다. 에녹: "따라와."');
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["narration", "dialogue"]
    );
    assert.equal(blocks[0]!.text, "그가 말했다.");
    assert.equal(blocks[1]!.speaker, "에녹");
    assert.equal(blocks[1]!.text, "따라와.");
  });
});

describe("resolveQuoteCardSpeakers", () => {
  it("defaults a single unlabeled dialogue to the character name", () => {
    const resolved = resolveQuoteCardSpeakers(
      [{ type: "dialogue", text: "안녕" }],
      { defaultSpeaker: "라이크" }
    );
    assert.equal(resolved[0]!.speaker, "라이크");
  });

  it("defaults every unlabeled dialogue to the character name", () => {
    const resolved = resolveQuoteCardSpeakers(
      [
        { type: "dialogue", text: "첫 대사" },
        { type: "narration", text: "사이" },
        { type: "dialogue", text: "둘째 대사" },
        { type: "dialogue", text: "셋째 대사" },
      ],
      { defaultSpeaker: "라이크" }
    );
    assert.equal(resolved[0]!.speaker, "라이크");
    assert.equal(resolved[2]!.speaker, "라이크");
    assert.equal(resolved[3]!.speaker, "라이크");
  });

  it("keeps parsed speakers and applies overrides", () => {
    const resolved = resolveQuoteCardSpeakers(
      [
        { type: "dialogue", text: "a", speaker: "카이" },
        { type: "dialogue", text: "b" },
      ],
      { defaultSpeaker: "라이크", overrides: { 1: "유저" } }
    );
    assert.equal(resolved[0]!.speaker, "카이");
    assert.equal(resolved[1]!.speaker, "유저");
  });

  it("lists dialogue entries for the editor", () => {
    const entries = listQuoteCardDialogueEntries(
      '"하나"\n"둘"',
      { defaultSpeaker: "라이크" }
    );
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.speaker, "라이크");
    assert.equal(entries[1]!.speaker, "라이크");
  });
});

describe("clampQuoteCardAvatarFocus", () => {
  it("clamps focus into 0–1 and zoom into 1–2.5", () => {
    assert.deepEqual(clampQuoteCardAvatarFocus({ x: -1, y: 2, zoom: 9 }), {
      x: 0,
      y: 1,
      zoom: 2.5,
    });
    assert.deepEqual(clampQuoteCardAvatarFocus(null), {
      x: 0.5,
      y: 0.5,
      zoom: 1,
    });
  });
});

describe("quoteCardDimensions export size", () => {
  it("uses fixed 900px width with auto-height bounds", () => {
    assert.equal(QUOTE_CARD_WIDTH, 900);
    assert.equal(QUOTE_CARD_HEIGHT_MIN, 400);
    assert.equal(QUOTE_CARD_HEIGHT_MAX, 2000);
    assert.equal(QUOTE_CARD_BODY_FONT_MIN, 18);
    assert.equal(QUOTE_CARD_BODY_FONT_MAX, 50);
    assert.equal(quoteCardDimensions().width, 900);
    assert.equal(resolveQuoteCardHeight(100), 400);
    assert.equal(resolveQuoteCardHeight(900), 900);
    assert.equal(resolveQuoteCardHeight(3000), 2000);
    assert.equal(clampQuoteCardBodyFontSize(10), 18);
    assert.equal(clampQuoteCardBodyFontSize(60), 50);
  });
});

describe("resolveQuoteCardDialogueStyle", () => {
  it("prefers dialogueStyle over deprecated speechBubbles", () => {
    assert.equal(resolveQuoteCardDialogueStyle({ dialogueStyle: "accent" }), "accent");
    assert.equal(resolveQuoteCardDialogueStyle({ speechBubbles: false }), "off");
    assert.equal(resolveQuoteCardDialogueStyle({ speechBubbles: true }), "bubble");
    assert.equal(resolveQuoteCardDialogueStyle({}), "bubble");
  });
});

describe("quote card defaults", () => {
  it("uses a light card chrome", () => {
    assert.equal(QUOTE_CARD_DEFAULT_BACKGROUND, "#ffffff");
    assert.equal(QUOTE_CARD_DEFAULT_FOOTER_FONT_SIZE, 15);
  });
});

describe("copyQuoteCardPng", () => {
  it("writes png ClipboardItem when available", async () => {
    let wrote: ClipboardItem[] | null = null;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          write: async (items: ClipboardItem[]) => {
            wrote = items;
          },
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      value: class ClipboardItem {
        constructor(public items: Record<string, Blob>) {}
      },
      configurable: true,
    });
    const blob = new Blob(["x"], { type: "image/png" });
    assert.equal(await copyQuoteCardPng(blob), true);
    assert.ok(wrote && wrote.length === 1);
  });

  it("returns false when clipboard write is unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
    });
    const blob = new Blob(["x"], { type: "image/png" });
    assert.equal(await copyQuoteCardPng(blob), false);
  });
});

describe("quote card mobile save/share fallback", () => {
  it("uses Web Share API file sharing when available", async () => {
    let shared = 0;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        share: async () => { shared++; },
        canShare: () => true,
      },
      configurable: true,
    });
    const blob = new Blob(["x"], { type: "image/png" });
    assert.equal(canShareQuoteCardPng(blob), true);
    assert.equal(await shareQuoteCardPng(blob), true);
    assert.equal(shared, 1);
  });

  it("opens a pre-created tab for iOS Safari fallback", () => {
    let written = "";
    const tab = {
      location: { href: "" },
      closed: false,
      close() {},
      document: {
        open() {},
        write(html: string) { written = html; },
        close() {},
      },
    };
    const stubs = installDomStubs({ iosSafari: true, openReturns: tab });
    const prepared = prepareQuoteCardSaveFallbackWindow();
    assert.equal(prepared, tab);
    assert.equal(stubs.lastOpenFeatures, undefined);
    const result = saveQuoteCardPngWithFallback(new Blob(["x"], { type: "image/png" }), "quote.png", prepared);
    assert.equal(result, "opened");
    assert.match(written, /blob:test/);
    assert.match(written, /<img /);
    assert.equal(tab.location.href, "");
    assert.equal(stubs.clicked, 1);
    assert.equal(stubs.opened, 1);
  });

  it("does not pass noopener when preparing the iOS Safari fallback tab", () => {
    const stubs = installDomStubs({ iosSafari: true });
    prepareQuoteCardSaveFallbackWindow();
    assert.equal(stubs.lastOpenFeatures, undefined);
    assert.equal(stubs.opened, 1);
  });

  it("falls back to location.href when the tab document is unavailable", () => {
    const tab = { location: { href: "" }, closed: false, close() {} };
    installDomStubs({ iosSafari: true, openReturns: tab });
    const result = saveQuoteCardPngWithFallback(new Blob(["x"], { type: "image/png" }), "quote.png", tab);
    assert.equal(result, "opened");
    assert.equal(tab.location.href, "blob:test");
  });

  it("reports blocked when iOS Safari cannot open a fallback tab", () => {
    installDomStubs({ iosSafari: true, openReturns: null });
    const result = saveQuoteCardPngWithFallback(new Blob(["x"], { type: "image/png" }));
    assert.equal(result, "blocked");
  });

  it("keeps non-iOS browsers on the download path", () => {
    const stubs = installDomStubs({ iosSafari: false });
    const result = saveQuoteCardPngWithFallback(new Blob(["x"], { type: "image/png" }));
    assert.equal(result, "download");
    assert.equal(stubs.clicked, 1);
    assert.equal(stubs.opened, 0);
  });
});
