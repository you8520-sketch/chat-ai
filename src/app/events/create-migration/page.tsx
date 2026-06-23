import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import CreateMigrationEventClient from "./CreateMigrationEventClient";

export const dynamic = "force-dynamic";

export default async function CreateMigrationEventPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/events/create-migration");

  return <CreateMigrationEventClient />;
}
