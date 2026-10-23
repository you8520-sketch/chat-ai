/**
 * Re-runs the canonical Shared Initial call for chosen scenario turns with the
 * replay's inputs and prints the raw episodic section next to the parsed one,
 * to tell an extraction miss (model returned no fact) from a parse/validation drop.
 * Usage: DATA_DIR=<copy of a snapshot> B7_TURNS=11,12 B7_SAMPLES=2 node --conditions=react-server --import tsx diag-shared-initial.mts
 */
import { BACKGROUND_OPENROUTER_MODEL } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { formatSelectedPersonaIdentityForBackground } from "@/lib/userPersonas";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import { runPostTurnRelationshipOnlyInitial } from "@/lib/postTurnSharedInitial/run";

import { TURNS } from "./scenario.mts";

const db = getDb();
const chat = db.prepare("SELECT * FROM chats WHERE id=1").get() as { selected_persona_id: number; character_id: number };
const ch = db.prepare("SELECT name FROM characters WHERE id=?").get(chat.character_id) as { name: string };
const persona = db.prepare("SELECT * FROM user_personas WHERE id=?").get(chat.selected_persona_id) as {
  name: string;
  gender: string | null;
  description: string;
  speech_examples: string | null;
};
const turns = (process.env.B7_TURNS ?? "11,12").split(",").map(Number);
const samples = Number(process.env.B7_SAMPLES ?? 2);

for (const turn of turns) {
  const spec = TURNS[turn - 1]!;
  for (let i = 1; i <= samples; i++) {
    const shared = await runPostTurnRelationshipOnlyInitial({
      charName: ch.name,
      personaName: persona.name.trim(),
      userMessage: spec.user,
      assistantProse: spec.assistant,
      primaryModelId: BACKGROUND_OPENROUTER_MODEL,
      includeSuggestions: false,
      includeRelationship: true,
      includeEpisodic: true,
      userPersona: formatSelectedPersonaIdentityForBackground(persona.name.trim(), (persona.gender ?? "other") as never),
      personaDescription: toPublicPersonaDescription(persona.description ?? ""),
      personaSpeechExamples: persona.speech_examples ?? null,
      activePromises: [],
    });
    let rawEpisodic: unknown = null;
    try {
      rawEpisodic = (JSON.parse(shared.text) as { episodic?: unknown }).episodic ?? null;
    } catch {
      rawEpisodic = `unparseable: ${shared.text.slice(0, 400)}`;
    }
    console.log(
      JSON.stringify(
        { turn, sample: i, transportOk: shared.transportOk, raw_episodic: rawEpisodic, parsed_episodic: shared.parsed?.episodic ?? null },
        null,
        1
      )
    );
  }
}
