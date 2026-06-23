import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Dynamic import compiled ts via tsx would be better; inline critical logic
const db = new Database(path.join(root, "data", "app.db"), { readonly: true });

function parseMessageVariants(row) {
  let variants = [];
  if (row.alternates && row.alternates !== "[]") {
    try {
      variants = JSON.parse(row.alternates);
      if (!Array.isArray(variants)) variants = [];
    } catch {
      variants = [];
    }
  }
  if (variants.length === 0 && row.content.trim()) {
    variants = [
      {
        content: row.content,
        model: row.model ?? "",
        usage: row.usage ? JSON.parse(row.usage) : null,
        created_at: "",
      },
    ];
  }
  let activeVariant = row.active_variant ?? variants.length - 1;
  if (activeVariant < 0) activeVariant = 0;
  if (variants.length > 0 && activeVariant >= variants.length) {
    activeVariant = variants.length - 1;
  }
  return { variants, activeVariant };
}

for (const chatId of [13, 22, 23]) {
  try {
    const rawMessages = db
      .prepare(
        "SELECT id, role, content, model, usage, is_refunded, alternates, active_variant FROM messages WHERE chat_id=? ORDER BY id ASC"
      )
      .all(chatId);
    const messages = rawMessages.map((m) => {
      const { variants, activeVariant } = parseMessageVariants(m);
      const rowUsage = m.usage ? JSON.parse(m.usage) : null;
      const activeUsage = variants[activeVariant]?.usage ?? rowUsage;
      return {
        id: m.id,
        role: m.role,
        contentLen: m.content.length,
        variantCount: variants.length,
        usage: activeUsage,
      };
    });
    const payload = JSON.stringify(messages);
    console.log(`chat ${chatId}: OK, ${messages.length} msgs, payload ${payload.length} bytes`);
  } catch (e) {
    console.error(`chat ${chatId}: FAIL`, e.message);
  }
}
