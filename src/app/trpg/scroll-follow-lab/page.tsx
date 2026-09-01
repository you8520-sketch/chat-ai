import { notFound } from "next/navigation";
import TrpgScrollFollowLabClient from "./TrpgScrollFollowLabClient";

export const dynamic = "force-dynamic";

export default async function TrpgScrollFollowLabPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <TrpgScrollFollowLabClient />;
}
