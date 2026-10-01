import { build } from "esbuild";
import path from "node:path";

async function main() {
  const entry = path.join(process.cwd(), "src/lib/jsxComponent/sandboxRuntime.ts");
  const outfile = path.join(process.cwd(), "public/jsx-sandbox/runtime.js");

  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });

  console.log(`jsx sandbox runtime -> ${outfile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
