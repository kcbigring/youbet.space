import { chromium } from "@playwright/test";
import { fileURLToPath } from "url";
import path from "path";

/// Renders the mark and its variants at working sizes so a choice can be made
/// by looking rather than by description. Not shipped — a design aid.

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../design/marks.png");
const A = "#4ade80", D = "#1c7a4d";

const variants = [
  {
    name: "A — Converge",
    note: "The original weight. Goes spindly by 16px.",
    svg: `<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="13">
      <path d="M26 24 L50 53" stroke="${A}"/><path d="M74 24 L50 53" stroke="${D}"/>
      <path d="M50 53 L50 79" stroke="${A}"/></g>`,
  },
  {
    name: "B — Heavier",
    note: "Shipped. Same idea, enough weight to survive a favicon.",
    svg: `<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="18">
      <path d="M27 26 L50 52" stroke="${A}"/><path d="M73 26 L50 52" stroke="${D}"/>
      <path d="M50 52 L50 78" stroke="${A}"/></g>`,
  },
  {
    name: "C — Two sides",
    note: "Concept failed: the gap closes at any usable stroke weight.",
    svg: `<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="15">
      <path d="M25 24 L44 47" stroke="${A}"/><path d="M75 24 L56 47" stroke="${D}"/>
      <path d="M50 57 L50 79" stroke="${A}"/></g>`,
  },
  {
    name: "D — Settled",
    note: "Concept failed: the node is gone by 24px.",
    svg: `<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="13">
      <path d="M26 22 L50 50" stroke="${A}"/><path d="M74 22 L50 50" stroke="${D}"/>
      <path d="M50 62 L50 80" stroke="${A}"/>
      <circle cx="50" cy="55" r="8" fill="${A}"/></g>`,
  },
];

const card = (v) => `
  <div class="card">
    <div class="big"><svg viewBox="0 0 100 100" width="150" height="150">${v.svg}</svg></div>
    <div class="row">
      ${[64, 40, 24, 16].map((s) => `<svg viewBox="0 0 100 100" width="${s}" height="${s}">${v.svg}</svg>`).join("")}
    </div>
    <div class="lock">
      <svg viewBox="0 0 100 100" width="26" height="26">${v.svg}</svg>
      <span>youbet<i>.space</i></span>
    </div>
    <h3>${v.name}</h3><p>${v.note}</p>
  </div>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;box-sizing:border-box}
  body{width:1500px;background:#0b0d12;color:#eef1f7;font-family:Archivo,system-ui,sans-serif;padding:52px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:22px}
  .card{background:#151922;border:1px solid #262d3d;border-radius:16px;padding:26px}
  .big{display:grid;place-items:center;height:170px}
  .row{display:flex;align-items:center;justify-content:center;gap:20px;height:80px;
       border-top:1px solid #262d3d;border-bottom:1px solid #262d3d}
  .lock{display:flex;align-items:center;gap:10px;padding:20px 0 6px}
  .lock span{font-size:21px;font-weight:700;letter-spacing:-0.03em}
  .lock i{color:#4ade80;font-style:normal}
  h3{font-size:17px;font-weight:700;letter-spacing:-0.02em;margin-top:10px}
  p{font-size:14px;color:#8b94a8;line-height:1.5;margin-top:5px}
  .head{font-size:15px;color:#8b94a8;margin-bottom:22px;letter-spacing:0.04em;text-transform:uppercase;font-weight:600}
</style></head><body>
  <div class="head">youbet — mark, shown at 150 / 64 / 40 / 24 / 16px</div>
  <div class="grid">${variants.map(card).join("")}</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 700 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
console.log(`Wrote ${OUT}`);
