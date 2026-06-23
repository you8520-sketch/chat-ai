import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  clampCreditPage,
  clampUsagePage,
  fetchFreeCreditLogsPage,
  fetchPaidCreditLogsPage,
  fetchUsageLogsPage,
  CHARGE_PAGE_SIZE,
  USAGE_PAGE_SIZE,
} from "@/lib/pointLogsQuery";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "usage";
  const pageParam = Number(url.searchParams.get("page") ?? "1");

  if (type === "paid" || type === "charge") {
    const page = clampCreditPage(pageParam);
    const result = fetchPaidCreditLogsPage(user.id, page);
    return NextResponse.json({
      logs: result.logs,
      page: result.page,
      pageSize: CHARGE_PAGE_SIZE,
      total: result.total,
      totalPages: result.totalPages,
    });
  }

  if (type === "free") {
    const page = clampCreditPage(pageParam);
    const result = fetchFreeCreditLogsPage(user.id, page);
    return NextResponse.json({
      logs: result.logs,
      page: result.page,
      pageSize: CHARGE_PAGE_SIZE,
      total: result.total,
      totalPages: result.totalPages,
    });
  }

  if (type !== "usage") {
    return NextResponse.json({ error: "type은 usage, paid, free 중 하나여야 합니다." }, { status: 400 });
  }

  const page = clampUsagePage(pageParam);
  const result = fetchUsageLogsPage(user.id, page);

  return NextResponse.json({
    logs: result.logs,
    page: result.page,
    pageSize: USAGE_PAGE_SIZE,
    total: result.total,
    totalPages: result.totalPages,
  });
}
