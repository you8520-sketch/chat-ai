import { notFound } from "next/navigation";
import { isScrollFollowLabHarnessEnabled } from "@/lib/trpg/scrollFollowLabAccess";
import { compileLabPartySheets } from "@/lib/trpg/partySheetLabFixture";
import { compileTrpgSheetJsx } from "@/lib/trpg/sheetJsxSource";
import TrpgScrollFollowLabClient from "./TrpgScrollFollowLabClient";

export const dynamic = "force-dynamic";

export default async function TrpgScrollFollowLabPage() {
  if (process.env.NODE_ENV === "production" && !isScrollFollowLabHarnessEnabled()) {
    notFound();
  }
  return (
    <TrpgScrollFollowLabClient sheetJsxCompiled={compileTrpgSheetJsx()} partySheetsCompiled={compileLabPartySheets()} />
  );
}
