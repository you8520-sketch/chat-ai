import { NextResponse } from "next/server";
import { requireTrpgApi } from "@/lib/trpg/requireApi";
import { TRPG_FORK_FORBIDDEN_MESSAGE } from "@/lib/trpg/types";

function forbidden() {
  return NextResponse.json({ error: TRPG_FORK_FORBIDDEN_MESSAGE }, { status: 409 });
}

export async function GET() {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  return forbidden();
}

export async function POST() {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  return forbidden();
}

export async function PUT() {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  return forbidden();
}

export async function PATCH() {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  return forbidden();
}
