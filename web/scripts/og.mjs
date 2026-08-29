import { chromium } from "@playwright/test";
import { fileURLToPath } from "url";
import path from "path";

/// Renders the social card to public/og.png. Invites travel as links, so this
/// image is the first thing most people ever see of the product.
/// Regenerate with: npm run og

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/og.png");

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; background: #0b0d12; color: #eef1f7;
    font-family: Archivo, system-ui, sans-serif;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 72px 80px;
  }
  .lockup { display: flex; align-items: center; gap: 18px; }
  .word { font-size: 34px; font-weight: 700; letter-spacing: -0.03em; }
  .word span { color: #4ade80; }
  h1 {
    font-size: 92px; font-weight: 700; line-height: 0.98;
    letter-spacing: -0.04em; max-width: 15ch;
  }
  /* letter-spacing in em computes against the parent's font-size and inherits
     as an absolute length, so the h1's -0.04em arrived here as -3.7px and ate
     the word spaces. Set it explicitly for this size. */
  h1 span {
    display: block; color: #4ade80; font-size: 0.44em;
    margin-top: 0.24em; letter-spacing: -0.015em;
  }
  .foot { display: flex; gap: 34px; color: #8b94a8; font-size: 24px; font-weight: 600; }
  .foot b { color: #eef1f7; font-weight: 700; }
</style></head>
<body>
  <div class="lockup">
    <svg width="46" height="46" viewBox="0 0 100 100">
      <g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="13">
        <path d="M26 24 L50 53" stroke="#4ade80"/>
        <path d="M74 24 L50 53" stroke="#1c7a4d"/>
        <path d="M50 53 L50 79" stroke="#4ade80"/>
      </g>
    </svg>
    <div class="word">youbet<span>.space</span></div>
  </div>

  <h1>Private wagers between friends.<span>A handshake that holds.</span></h1>

  <div class="foot">
    <div><b>$25</b> each</div>
    <div><b>Escrowed</b> up front</div>
    <div><b>Settled</b> automatically</div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.waitForTimeout(600); // let the webfont settle before capturing
await page.screenshot({ path: OUT });
await browser.close();
console.log(`Wrote ${OUT}`);
