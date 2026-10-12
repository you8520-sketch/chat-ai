"use client";

import { useEffect } from "react";

import { computeKeyboardInset } from "@/lib/keyboardInset";

/**
 * Publishes the on-screen keyboard height as `--keyboard-inset` and toggles
 * `data-keyboard-open` on <html>, so fixed bottom chrome (mobile bottom nav,
 * studio save bar) can step aside instead of being covered.
 */
export default function VirtualKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const apply = () => {
      const inset = computeKeyboardInset({
        layoutHeight: window.innerHeight,
        viewportHeight: viewport.height,
        viewportOffsetTop: viewport.offsetTop,
        scale: viewport.scale,
      });
      root.style.setProperty("--keyboard-inset", `${inset}px`);
      if (inset > 0) root.setAttribute("data-keyboard-open", "");
      else root.removeAttribute("data-keyboard-open");
    };
    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      root.style.removeProperty("--keyboard-inset");
      root.removeAttribute("data-keyboard-open");
    };
  }, []);

  return null;
}
