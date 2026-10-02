"use client";

import { useEffect, useRef, useState } from "react";
import {
  CARD_CAROUSEL_INTERVAL_MS,
  nextCarouselIndex,
  shouldRunCarousel,
} from "@/lib/characterCardCarousel";

type Props = {
  urls: string[];
  alt: string;
  hidden?: boolean;
  className?: string;
};

export default function CharacterCardCarousel({
  urls,
  alt,
  hidden = false,
  className = "h-full w-full object-cover object-top",
}: Props) {
  const [index, setIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const safeUrls = urls.filter((url) => url && !url.startsWith("/media/private/"));
  const current = safeUrls[Math.min(index, Math.max(safeUrls.length - 1, 0))] ?? "";

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const onVisibility = () => setDocumentVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { threshold: 0.2 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (
      !shouldRunCarousel({
        urlCount: safeUrls.length,
        reducedMotion,
        hovering,
        focused,
        visible,
        documentVisible,
      })
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setIndex((currentIndex) => nextCarouselIndex(currentIndex, safeUrls.length));
    }, CARD_CAROUSEL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [safeUrls.length, reducedMotion, hovering, focused, visible, documentVisible]);

  if (!current) return null;

  return (
    <div
      ref={rootRef}
      className="h-full w-full"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current}
        alt={alt}
        className={`${className} ${hidden ? "blur-md" : ""}`}
      />
    </div>
  );
}
