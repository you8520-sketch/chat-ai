/** Client-safe types/labels — no DB imports */

export type CreateMigrationApplicationStatus = "pending" | "approved" | "rejected";

export function applicationStatusLabel(status: CreateMigrationApplicationStatus): string {
  switch (status) {
    case "pending":
      return "검토 중";
    case "approved":
      return "지급 완료";
    case "rejected":
      return "반려";
    default:
      return status;
  }
}
