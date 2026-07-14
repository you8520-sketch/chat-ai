import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildQuoteCardFooterLeft,
  canShareQuoteCardPng,
  prepareQuoteCardSaveFallbackWindow,
  saveQuoteCardPngWithFallback,
  shareQuoteCardPng,
} from "@/lib/quoteCardImage";

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

function installDomStubs(opts: { iosSafari?: boolean; openReturns?: { location: { href: string }; close: () => void } | null } = {}) {
  let clicked = 0;
  let opened = 0;
  let revoked = 0;
  const anchor = {
    href: "",
    download: "",
    rel: "",
    click() { clicked++; },
    remove() {},
  };
  const win = {
    open() {
      opened++;
      return opts.openReturns === undefined ? { location: { href: "" }, close() {} } : opts.openReturns;
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
  return { anchor, get clicked() { return clicked; }, get opened() { return opened; }, get revoked() { return revoked; } };
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
    const tab = { location: { href: "" }, close() {} };
    const stubs = installDomStubs({ iosSafari: true, openReturns: tab });
    const prepared = prepareQuoteCardSaveFallbackWindow();
    assert.equal(prepared, tab);
    const result = saveQuoteCardPngWithFallback(new Blob(["x"], { type: "image/png" }), "quote.png", prepared);
    assert.equal(result, "opened");
    assert.equal(tab.location.href, "blob:test");
    assert.equal(stubs.clicked, 1);
    assert.equal(stubs.opened, 1);
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
