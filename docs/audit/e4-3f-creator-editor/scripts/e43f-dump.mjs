import { launch, openCreate, draftSnapshot } from "/workspace/scripts/e43f-lib.mjs";
const b = await launch();
const { page } = await openCreate(b, process.env.BASE, { width: 390, draft: draftSnapshot() });
console.log(await page.evaluate(() => [...document.querySelectorAll("form input, form textarea, form select")].map(e => `${e.tagName}|${e.type}|id=${e.id}|name=${e.name}|req=${e.required}|ph=${(e.placeholder||"").slice(0,25)}|len=${(e.value||"").length}`).join("\n")));
console.log(await page.evaluate(() => [...document.querySelectorAll("form button")].filter(b=>!b.closest('[aria-hidden=true]')).map(e => `${(e.getAttribute("aria-label")||e.textContent).trim().slice(0,30)}|${Math.round(e.getBoundingClientRect().height)}`).join("\n")));
await b.close();
