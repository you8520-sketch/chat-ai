export type MemoryUsedCharsInput = {
  recent_summary: string;
  archive_summary: string;
};

export function calcUsedChars(row: MemoryUsedCharsInput): number {
  return (row.recent_summary?.length ?? 0) + (row.archive_summary?.length ?? 0);
}
