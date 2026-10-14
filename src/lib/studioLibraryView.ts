import type { CharacterVisibility, ModerationStatus } from "@/lib/characterVisibility";

/** 작품이 이 수 이상일 때만 개요·검색·필터 도구를 보여 준다. 적을 때는 목록만으로 충분하다. */
export const STUDIO_LIBRARY_TOOLS_MIN = 6;
export const STUDIO_LIBRARY_PAGE_SIZE = 24;

export type StudioKindFilter = "all" | "character" | "simulation";
export type StudioStatusFilter =
  | "all"
  | "public"
  | "link"
  | "private"
  | "pending"
  | "rejected"
  | "attention";

export type StudioLibraryFilter = {
  query: string;
  kind: StudioKindFilter;
  status: StudioStatusFilter;
};

export const EMPTY_STUDIO_FILTER: StudioLibraryFilter = { query: "", kind: "all", status: "all" };

export type FilterableWork = {
  name: string;
  content_kind?: string;
  visibility: CharacterVisibility;
  moderation_status: ModerationStatus;
};

export type StudioLibrarySummary = {
  total: number;
  character: number;
  simulation: number;
  public: number;
  link: number;
  private: number;
  pending: number;
  rejected: number;
};

export function studioWorkKind(work: Pick<FilterableWork, "content_kind">): "character" | "simulation" {
  return work.content_kind === "simulation" ? "simulation" : "character";
}

export function matchesLibraryQuery(name: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("ko-KR");
  if (!needle) return true;
  return name.toLocaleLowerCase("ko-KR").includes(needle);
}

function matchesStatus(work: FilterableWork, status: StudioStatusFilter): boolean {
  switch (status) {
    case "all":
      return true;
    case "public":
    case "link":
    case "private":
      return work.visibility === status;
    case "pending":
      return work.moderation_status === "pending";
    case "rejected":
      return work.moderation_status === "rejected";
    case "attention":
      return work.moderation_status === "pending" || work.moderation_status === "rejected";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function filterStudioWorks<T extends FilterableWork>(works: readonly T[], filter: StudioLibraryFilter): T[] {
  return works.filter(
    (work) =>
      matchesLibraryQuery(work.name, filter.query) &&
      (filter.kind === "all" || studioWorkKind(work) === filter.kind) &&
      matchesStatus(work, filter.status),
  );
}

export function summarizeStudioWorks(works: readonly FilterableWork[]): StudioLibrarySummary {
  const summary: StudioLibrarySummary = {
    total: works.length,
    character: 0,
    simulation: 0,
    public: 0,
    link: 0,
    private: 0,
    pending: 0,
    rejected: 0,
  };
  for (const work of works) {
    summary[studioWorkKind(work)] += 1;
    summary[work.visibility] += 1;
    if (work.moderation_status === "pending") summary.pending += 1;
    if (work.moderation_status === "rejected") summary.rejected += 1;
  }
  return summary;
}

export function isStudioFilterActive(filter: StudioLibraryFilter): boolean {
  return filter.query.trim() !== "" || filter.kind !== "all" || filter.status !== "all";
}
