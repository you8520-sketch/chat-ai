import Database from "better-sqlite3";
const db = new Database("/tmp/e43b-data/app.db");
const id = JSON.parse(await (await import("fs")).promises.readFile("/tmp/e43b-fixtures.json","utf8")).campaignId;
db.prepare("UPDATE trpg_campaigns SET status='ACTION_INPUT' WHERE id=?").run(id);
try { db.prepare("UPDATE trpg_campaign_state SET phase='ACTION_INPUT', round_number=1 WHERE campaign_id=?").run(id); } catch (e) { console.log("state:", String(e).slice(0,100)); }
console.log(db.prepare("SELECT status FROM trpg_campaigns WHERE id=?").get(id));
