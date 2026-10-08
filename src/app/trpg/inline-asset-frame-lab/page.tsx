import { notFound } from "next/navigation";
import { isScrollFollowLabHarnessEnabled } from "@/lib/trpg/scrollFollowLabAccess";
import TrpgInlineAssetFrameLabClient from "./TrpgInlineAssetFrameLabClient";

export const dynamic = "force-dynamic";

export default function TrpgInlineAssetFrameLabPage() {
  if (process.env.NODE_ENV === "production" && !isScrollFollowLabHarnessEnabled()) {
    notFound();
  }
  return <TrpgInlineAssetFrameLabClient />;
}
