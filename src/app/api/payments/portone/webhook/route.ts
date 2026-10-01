import { NextResponse } from "next/server";
import { handlePortoneWebhookEvent } from "@/lib/portoneWebhook";

/**
 * Public PortOne V2 webhook.
 * Wake signal only — local identity gate before any provider GET.
 */
export async function POST(req: Request) {
  const bodyText = await req.text();
  const result = await handlePortoneWebhookEvent(bodyText);
  return NextResponse.json(result.body, { status: result.httpStatus });
}
