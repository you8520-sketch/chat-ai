import type { StatusWidget } from "@/lib/statusWidget/types";

export type StatusWidgetShareVisibility = "unlisted" | "public";

export type StatusWidgetShareSort = "popular" | "newest";

export type PublicStatusWidgetShareCard = {
  id: number;
  shareSlug: string;
  title: string;
  authorNickname: string;
  authorUserId: number;
  createdAt: string;
  uniqueImportCount: number;
  renderer: "html" | "jsx";
  widget: StatusWidget;
};

export function parseStatusWidgetShareVisibility(
  raw: unknown
): StatusWidgetShareVisibility | null {
  if (raw === "unlisted" || raw === "public") return raw;
  return null;
}

export function resolveIncomingStatusWidgetShareVisibility(
  raw: unknown
): StatusWidgetShareVisibility | null {
  if (raw == null || raw === "") return "unlisted";
  return parseStatusWidgetShareVisibility(raw);
}

export function parseStatusWidgetShareSort(raw: unknown): StatusWidgetShareSort {
  return raw === "newest" ? "newest" : "popular";
}

export function readStatusWidgetShareVisibility(raw: unknown): StatusWidgetShareVisibility {
  return raw === "public" ? "public" : "unlisted";
}

export function formatStatusWidgetShareDate(createdAt: string): string {
  const day = createdAt.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return createdAt.trim();
  return day.replaceAll("-", ".");
}
