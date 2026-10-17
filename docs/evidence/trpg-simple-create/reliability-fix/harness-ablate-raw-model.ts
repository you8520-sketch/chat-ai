import { buildTrpgScenarioDraftRequestBody } from "/workspace/src/lib/trpg/scenarioDraftCall";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, buildCheaperInferenceHeaders, resolveCheaperInferenceApiKey } from "/workspace/src/lib/cheaperInferenceConfig";
import { buildSandboxDirectorSystemPrompt, buildSandboxDirectorUserPrompt, buildScenarioDraftSystemPrompt, buildScenarioDraftUserPrompt, parseScenarioDraftJson, extractJsonObject } from "/workspace/src/lib/trpg/scenarioDraft";
import { emptyTrpgScenarioPlan } from "/workspace/src/lib/trpg/scenarioPlan";

const N = Number(process.env.N ?? 8);
const variants = (process.env.VARIANTS ?? "B0").split(",");
const cases = (process.env.CASES ?? "desc,world").split(",");
const CONC = Number(process.env.CONC ?? 4);
import { parseTrpgScenarioPlan } from "/workspace/src/lib/trpg/scenarioPlan";
const existing: any = { title: "", summary: "", content: "", secretContent: "", startLocation: "", startInventory: [], npcs: [], plan: process.env.SKELETON ? emptyTrpgScenarioPlan() : parseTrpgScenarioPlan(JSON.parse(JSON.stringify(emptyTrpgScenarioPlan()))), touchedFields: [] };
const WORLD = { worldName: "[검증] 안개 항구 세계관", worldSummary: "안개가 짙은 항구 도시 하르바", worldContent: "하르바는 매일 밤 안개가 도시를 삼키는 항구 도시다. 등대지기 조합과 밀수 길드가 항구의 밤을 나눠 갖고 있으며, 안개 속에서 사라진 배들의 소문이 돈다. 마법은 드물고 해적 선단과 세관이 충돌한다." };
function userFor(c: string) {
  if (c === "sandbox") return buildSandboxDirectorUserPrompt(WORLD);
  if (c === "sel1" || c === "all") {
    const filled: any = { ...existing, title: "안개 속 사라진 등대", summary: "등대가 꺼진 밤 배가 사라진다.", plan: { ...emptyTrpgScenarioPlan(), startingSituation: "등대가 꺼진 항구에 배 한 척이 돌아오지 않는다.", centralConflict: "조합과 길드가 서로를 의심한다." } };
    return buildScenarioDraftUserPrompt({ ...WORLD, worldSelected: true, mode: c === "all" ? "regenerate_all" : "regenerate_selected", existing: filled, selectedFields: c === "sel1" ? ["goal"] : [], lockedFields: [] } as any);
  }
  const base: any = { mode: "fill_empty", existing: { ...existing, content: c === "desc" ? "비 오는 밤, 폐역에 도착한 유령 기차에서 사라진 승객들의 비밀을 추적하는 미스터리 모험" : "" }, selectedFields: [], lockedFields: [] };
  if (c === "world") Object.assign(base, { worldName: "[검증] 안개 항구 세계관", worldSummary: "안개가 짙은 항구 도시 하르바", worldContent: "하르바는 매일 밤 안개가 도시를 삼키는 항구 도시다. 등대지기 조합과 밀수 길드가 항구의 밤을 나눠 갖고 있으며, 안개 속에서 사라진 배들의 소문이 돈다. 마법은 드물고 해적 선단과 세관이 충돌한다.", worldSelected: true });
  else Object.assign(base, { worldName: "", worldSummary: "", worldContent: "", worldSelected: false });
  return buildScenarioDraftUserPrompt(base);
}
const EXAMPLE = `Example of the required JSON shape (values are placeholders; write real Korean content):
{"title":"...","summary":"...","startingSituation":"...","centralConflict":"...","goal":"...","secret":"...","endingConditions":["..."],"majorEvents":["..."],"clues":["..."],"startLocation":"...","startInventory":["..."],"difficulty":"normal","climax":"..."}`;
function build(v: string, c: string) {
  let system = c === "sandbox" ? buildSandboxDirectorSystemPrompt() : buildScenarioDraftSystemPrompt();
  const user = userFor(c);
  const body: any = buildTrpgScenarioDraftRequestBody({ system, user, maxTokens: 6000, temperature: 0.3 });
  if (v.includes("X")) { // example skeleton appended to system prompt
    body.messages[0].content = `${system}\n\n${EXAMPLE}`;
  }
  if (v.includes("P")) body.messages[0].content = String(body.messages[0].content).replace("- Include at least one natural climax condition.", "- Include a natural climax and at least one endingConditions item (an observable state in which the story can end). Never leave endingConditions empty when it is requested.");
  if (v.includes("R")) delete body.response_format; // no json_object mode
  if (v.includes("T")) body.temperature = 0.6;
  return body;
}
let cls0 = "";
function classify(text: string): string {
  const o = extractJsonObject(text);
  if (!o) return "parsefail";
  const keys = Object.keys(o);
  if (keys.length === 0) return "empty";
  if (keys.length === 1 && /fill_or_replace_fields/.test(keys[0]!)) return "wrapper";
  const pd = parseScenarioDraftJson(text);
  const p: any = pd.plan;
  if (cls0 === "sel1") return pd.plan.goal ? "ok" : `partial(${keys.length})`;
  if (cls0 === "sandbox") return pd.plan.startingSituation && pd.plan.centralConflict && pd.plan.goal && (pd.plan.endingConditions?.length ?? 0) > 0 ? "ok" : `partial(${keys.length})`;
  if (process.env.SHOWEND) console.log("ENDING_RAW", JSON.stringify((o as any).endingConditions)?.slice(0, 120));
  const have = { title: !!pd.title, start: !!p.startingSituation, goal: !!p.goal, end: (p.endingConditions?.length ?? 0) > 0 };
  return have.title && have.start && have.goal && have.end ? "ok" : `partial(${keys.length}):${Object.entries(have).filter(([, x]) => x).map(([k]) => k).join("+")}`;
}
async function one(v: string, c: string) {
  const t0 = Date.now();
  cls0 = c;
  const body = build(v, c);
  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, { method: "POST", headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()), body: JSON.stringify(body) });
    const data: any = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    return { cls: res.ok ? classify(text) : `http${res.status}`, inTok: data.usage?.prompt_tokens ?? 0, outTok: data.usage?.completion_tokens ?? 0, ms: Date.now() - t0, finish: data.choices?.[0]?.finish_reason, text };
  } catch (e: any) { return { cls: "error:" + String(e.message).slice(0, 60), inTok: 0, outTok: 0, ms: Date.now() - t0, finish: "", text: "" }; }
}
(async () => {
  if (process.env.SHOWBODY) { const b = build(variants[0]!, cases[0]!); const { messages, ...rest } = b; console.log("BODY", JSON.stringify(rest)); return; }
  let ti = 0, to = 0, calls = 0;
  for (const v of variants) for (const c of cases) {
    const res: any[] = [];
    const queue = Array.from({ length: N }, (_, i) => i);
    await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) { queue.shift(); res.push(await one(v, c)); } }));
    const counts: Record<string, number> = {};
    res.forEach((r) => (counts[r.cls] = (counts[r.cls] ?? 0) + 1));
    const inTok = res.reduce((a, r) => a + r.inTok, 0), outTok = res.reduce((a, r) => a + r.outTok, 0);
    ti += inTok; to += outTok; calls += res.length;
    console.log(`RESULT ${v} ${c} n=${N}`, JSON.stringify(counts), `in=${inTok} out=${outTok} avgMs=${Math.round(res.reduce((a, r) => a + r.ms, 0) / res.length)}`);
    if (process.env.DUMP) require("fs").writeFileSync(`/tmp/a-e2e/rc/dump2-${v}-${c}.json`, JSON.stringify(res, null, 1));
  }
  console.log("TOTAL", calls, ti, to);
})();
