"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CARD_CAROUSEL_INTERVAL_MS,
  nextCarouselIndex,
  shouldRunCarousel,
  usableCarouselUrls,
} from "@/lib/characterCardCarousel";

type Props = {
  urls: string[];
  alt: string;
  hidden?: boolean;
  className?: string;
  /** 모든 공개 이미지가 로딩에 실패했을 때 카드 안에서 대신 보여줄 내용. */
  fallback?: ReactNode;
};

export default function CharacterCardCarousel({
  urls,
  alt,
  hidden = false,
  className = "h-full w-full object-cover object-top",
  fallback = null,
}: Props) {
  const [index, setIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const publicUrls = urls.filter((url) => url && !url.startsWith("/media/private/"));
  const safeUrls = usableCarouselUrls(publicUrls, failed);
  const current = safeUrls[Math.min(index, Math.max(safeUrls.length - 1, 0))] ?? "";

  const markFailed = useCallback((url: string) => {
    setFailed((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  }, []);

  // 하이드레이션 전에 이미 실패한 이미지는 onError가 유실되므로 마운트 후에도 확인한다.
  useEffect(() => {
    const img = imgRef.current;
    if (current && img && img.complete && img.naturalWidth === 0) markFailed(current);
  }, [current, markFailed]);

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

  if (!current) return <>{fallback}</>;

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
        ref={imgRef}
        src={current}
        onError={() => markFailed(current)}
        alt={alt}
        className={`${className} ${hidden ? "blur-md" : ""}`}
      />
    </div>
  );
}
