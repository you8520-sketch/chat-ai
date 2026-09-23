export const ADMIN_OPS_STUCK_EXECUTION_MINUTES = 30;

export type AdminOpsIncidentSource = "scheduler" | "payout" | "point_refund";
export type AdminOpsIncidentSeverity = "critical" | "warning";

export type AdminOpsIncident = {
  id: string;
  source: AdminOpsIncidentSource;
  severity: AdminOpsIncidentSeverity;
  state: string;
  title: string;
  summary: string;
  sourceRef: string;
  occurredAt: string;
  ageMinutes: number | null;
  href: string | null;
};
