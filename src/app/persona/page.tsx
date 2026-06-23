import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";import PersonaClient from "./PersonaClient";
import { ensureDefaultPersona } from "@/lib/userPersonas";
import { listUserNotePresets } from "@/lib/userNotePresets";
import { listStatusWidgetPresets } from "@/lib/statusWidgetPresets";

export const dynamic = "force-dynamic";

export default async function PersonaPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const personas = ensureDefaultPersona(user.id, user.nickname);
  const notePresets = listUserNotePresets(user.id);
  const statusWidgetPresets = listStatusWidgetPresets(user.id);

  return (
    <PersonaClient
      initialPersonas={personas}
      initialNotePresets={notePresets}
      initialStatusWidgetPresets={statusWidgetPresets}
      nickname={user.nickname}
    />
  );
}
