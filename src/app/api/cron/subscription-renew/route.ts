import { NextResponse } from "next/server";
import { SUBSCRIPTION_BILLING_UNAVAILABLE_MESSAGE } from "@/lib/subscription";

/**
 * Recurring membership billing is not implemented.
 * Even with a valid CRON_SECRET, this endpoint must not mutate subscription state
 * until a verified recurring-payment provider owner exists.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }

  return NextResponse.json(
    { error: SUBSCRIPTION_BILLING_UNAVAILABLE_MESSAGE, renewed: 0 },
    { status: 503 }
  );
}
