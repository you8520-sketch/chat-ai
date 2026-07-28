import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import PersonaClient from "./PersonaClient";
import { getPersonaSecretSettingsCapability } from "@/lib/personaSecretCapabilities";
import { ensureDefaultPublicPersona } from "@/lib/userPersonas";
import { listUserNotePresets } from "@/lib/userNotePresets";
import { listStatusWidgetPresets } from "@/lib/statusWidgetPresets";

export const dynamic = "force-dynamic";

export default async function PersonaPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const personas = ensureDefaultPublicPersona(user.id, user.nickname);
  const notePresets = listUserNotePresets(user.id);
  const statusWidgetPresets = listStatusWidgetPresets(user.id);
  const initialSecretSettings = getPersonaSecretSettingsCapability(user.id);

  return (
    <PersonaClient
      initialPersonas={personas}
      initialNotePresets={notePresets}
      initialStatusWidgetPresets={statusWidgetPresets}
      initialSecretSettings={initialSecretSettings}
      nickname={user.nickname}
    />
  );
}
