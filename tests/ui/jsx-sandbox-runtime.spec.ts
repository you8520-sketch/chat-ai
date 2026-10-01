import { expect, test } from "@playwright/test";
import { compileJsxComponentSource } from "../../src/lib/jsxComponent/compile";

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
