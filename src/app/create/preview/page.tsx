import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { resolveViewerDisplayNameForUser } from "@/lib/viewerDisplayName";
import ProfilePreviewClient from "./ProfilePreviewClient";
export const dynamic = "force-dynamic";

export default async function CreateProfilePreviewPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/create/preview");
  if (!user.is_adult) redirect("/create");

  const viewerDisplayName = resolveViewerDisplayNameForUser(user);

  return <ProfilePreviewClient viewerDisplayName={viewerDisplayName} />;}
