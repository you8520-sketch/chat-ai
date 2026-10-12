const http = require("http");
function fetchFull(url, headers) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { ...headers, "accept-encoding": "identity" } }, (r) => {
      const chunks = [];
      let aborted = false;
      r.on("data", (c) => chunks.push(c));
      r.on("aborted", () => { aborted = true; });
      r.on("error", reject);
      r.on("end", () => {
        const body = Buffer.concat(chunks);
        const cl = r.headers["content-length"];
        if (aborted || (cl && Number(cl) !== body.length)) return reject(new Error("truncated"));
        resolve({ status: r.statusCode, headers: r.headers, body });
      });
    }).on("error", reject);
  });
}
async function installChunkGuard(page) {
  await page.route("**/_next/static/**", async (route) => {
    const req = route.request();
    for (let i = 0; i < 12; i++) {
      try {
        const r = await fetchFull(req.url(), { "user-agent": req.headers()["user-agent"] || "x" });
        const headers = { "content-type": r.headers["content-type"] || "application/javascript", "cache-control": "no-store" };
        return await route.fulfill({ status: r.status, headers, body: r.body });
      } catch (e) { await new Promise((s) => setTimeout(s, 300)); }
    }
    await route.abort();
  });
}
module.exports = { installChunkGuard };
