import { expect, test } from "@playwright/test";
import { compileJsxComponentSource } from "../../src/lib/jsxComponent/compile";
import { compileTrpgSheetJsx } from "../../src/lib/trpg/sheetJsxSource";
import { buildTrpgSheetSurface } from "../../src/lib/trpg/sheetSurface";

test("opaque JSX sandbox runs Teapot-style named component with direct hooks", async ({ page }) => {
  const compiled = compileJsxComponentSource(
    `function StatusBoard({ hp = 45 }) {
      const [open, setOpen] = useState(false);
      useEffect(() => {}, []);
      return (
        <button type="button" onClick={() => setOpen((v) => !v)}>
          {hp}:{open ? "open" : "closed"}
        </button>
      );
    }`,
    "StatusBoard"
  );
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;

  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const frame = document.createElement("iframe");
        frame.id = "jsx-runtime-e2e";
        frame.setAttribute("sandbox", "allow-scripts");
        Object.assign(frame.style, {
          position: "fixed",
          top: "0",
          left: "0",
          width: "320px",
          height: "180px",
          zIndex: "2147483647",
        });
        frame.addEventListener("load", () => resolve(), { once: true });
        frame.src = "/jsx-sandbox/frame.html";
        document.body.appendChild(frame);
      })
  );

  const iframe = page.locator("#jsx-runtime-e2e");
  await expect(iframe).toBeAttached();
  await page.evaluate((payload) => {
    const frame = document.querySelector("#jsx-runtime-e2e") as HTMLIFrameElement | null;
    frame?.contentWindow?.postMessage(
      {
        type: "hav-jsx-mount",
        compiled: payload,
        props: { hp: 45 },
        parentOrigin: window.location.origin,
      },
      "*"
    );
  }, compiled.compiled);

  const frame = page.frameLocator("#jsx-runtime-e2e");
  const button = frame.getByRole("button");
  await expect(button).toHaveText("45:closed");
  await button.click();
  await expect(button).toHaveText("45:open");

  // StatusWidget values update in-place across turns. The opaque iframe is
  // already loaded here, so a second mount message must update props without
  // depending on contentDocument access and without resetting local hook state.
  await page.evaluate((payload) => {
    const frame = document.querySelector("#jsx-runtime-e2e") as HTMLIFrameElement | null;
    frame?.contentWindow?.postMessage(
      {
        type: "hav-jsx-mount",
        compiled: payload,
        props: { hp: 46 },
        parentOrigin: window.location.origin,
      },
      "*"
    );
  }, compiled.compiled);
  await expect(button).toHaveText("46:open");
});

test("TRPG sheet runs in the shared sandbox: draft-only bridge, clamped height, render error", async ({ page }) => {
  const compiled = compileTrpgSheetJsx();
  expect(compiled).not.toBeNull();
  const self = buildTrpgSheetSurface(
    {
      participantId: 7,
      isSelf: true,
      html: "",
      sheet: {
        participantId: 7,
        name: "렌",
        playerName: "렌",
        level: 1,
        hp: 9,
        maxHp: 20,
        stats: { str: 9 },
        conditions: [],
        inventory: ["붕대"],
        location: "폐역",
        modifiersNote: "",
      },
    },
    {
      statDefs: [{ key: "str", label: "근력" }],
      ongoingEffects: [
        { participantId: 7, label: "중독", kind: "periodic_harm", severity: "약", remainingTicks: 2, recoveryHint: "" },
      ],
      mechanicsLines: [],
      interactive: true,
    }
  );
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const w = window as Window & { __sheetMessages?: unknown[] };
        w.__sheetMessages = [];
        window.addEventListener("message", (event) => {
          const data = event.data as { source?: string } | null;
          if (data && data.source === "hav-jsx-sandbox") w.__sheetMessages?.push(data);
        });
        const frame = document.createElement("iframe");
        frame.id = "trpg-sheet-e2e";
        frame.setAttribute("sandbox", "allow-scripts");
        Object.assign(frame.style, { position: "fixed", top: "0", left: "0", width: "360px", height: "400px", zIndex: "2147483647" });
        frame.addEventListener("load", () => resolve(), { once: true });
        frame.src = "/jsx-sandbox/frame.html";
        document.body.appendChild(frame);
      })
  );
  const mount = async (code: string, props: unknown) =>
    page.evaluate(
      ({ code, props }) => {
        const frame = document.querySelector("#trpg-sheet-e2e") as HTMLIFrameElement | null;
        frame?.contentWindow?.postMessage(
          { type: "hav-jsx-mount", compiled: code, props, parentOrigin: window.location.origin },
          "*"
        );
      },
      { code, props }
    );
  const messages = () =>
    page.evaluate(() => ((window as Window & { __sheetMessages?: unknown[] }).__sheetMessages ?? []) as { kind: string; payload: Record<string, unknown> }[]);

  await mount(compiled ?? "", JSON.parse(JSON.stringify(self)));
  const frame = page.frameLocator("#trpg-sheet-e2e");
  await expect(frame.getByText("HP 9/20")).toBeVisible();
  await expect.poll(async () => (await messages()).some((m) => m.kind === "height" && Number(m.payload.px) > 100)).toBe(true);

  const requestsBefore = requests.length;
  await frame.locator("[data-trpg-inventory-item='붕대']").click();
  await frame.locator("[data-trpg-condition-draft='중독']").click();
  await expect
    .poll(async () => (await messages()).filter((m) => m.kind === "setTrpgActionDraft").map((m) => m.payload))
    .toEqual([
      { actionType: "use_item", text: "붕대를 사용한다." },
      { actionType: self.effects[0]?.draft?.actionType, text: self.effects[0]?.draft?.body },
    ]);
  expect((await messages()).some((m) => m.kind === "setChatDraft" || m.kind === "sendToChat")).toBe(false);
  expect(requests.slice(requestsBefore)).toEqual([]);

  const party = { ...JSON.parse(JSON.stringify(self)), interactive: false };
  await mount(compiled ?? "", party);
  await expect(frame.locator("button")).toHaveCount(0);

  const thrower = compileJsxComponentSource(
    `function Broken() { throw new Error("sheet render failed"); }`,
    "Broken"
  );
  expect(thrower.ok).toBe(true);
  if (!thrower.ok) return;
  await mount(thrower.compiled, {});
  await expect.poll(async () => (await messages()).some((m) => m.kind === "error")).toBe(true);
});
