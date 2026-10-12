import { readFileSync } from "node:fs";
import { buildTrpgGmProviderRequest } from "/workspace/src/lib/trpg/gmCall";
for (const [tag, saved] of [["call-01-A-scenario-r0",null],["call-02-B-world-r0","wire/call-02-B-world-r0-provider-request.json"],["call-03-C-after-completion-r2","wire/call-03-C-after-completion-r2-provider-request.json"],["call-04-C-after-completion-r3","wire/call-04-C-after-completion-r3-provider-request.json"]] as const) {
  const system = readFileSync(`/tmp/g1574/live/prompts/${tag}-system.txt`, "utf8");
  const user = readFileSync(`/tmp/g1574/live/prompts/${tag}-user.txt`, "utf8");
  const req = buildTrpgGmProviderRequest({ system, user });
  const body = JSON.stringify(req);
  const savedBody = saved ? readFileSync(`/tmp/g1574/live/${saved}`, "utf8") : null;
  console.log(tag, Buffer.byteLength(body), savedBody ? { savedBytes: Buffer.byteLength(savedBody), identical: savedBody === body } : "no saved body");
}
