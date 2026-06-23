import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const db = new Database(path.join(root, "data", "app.db"), { readonly: true });

const session = db
  .prepare(
    "SELECT token FROM sessions WHERE user_id=4 AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1"
  )
  .get();
if (!session) {
  console.error("No session for user 4");
  process.exit(1);
}

const urls = [
  "http://127.0.0.1:3000/character/14",
  "http://127.0.0.1:3000/chat/14?chat=23",
  "http://127.0.0.1:3000/chat/14?chat=22",
  "http://127.0.0.1:3000/chat/14?chat=13",
];

for (const url of urls) {
  try {
    const res = await fetch(url, {
      headers: { Cookie: `session=${session.token}` },
      redirect: "manual",
    });
    const text = await res.text();
    const hasError =
      text.includes("Application error") ||
      text.includes("Internal Server Error") ||
      text.includes("Unhandled Runtime Error");
    console.log(
      url,
      "->",
      res.status,
      res.headers.get("location") ?? "",
      "len",
      text.length,
      hasError ? "ERROR_PAGE" : "OK"
    );
  } catch (e) {
    console.log(url, "-> FAIL", e.message);
  }
}
