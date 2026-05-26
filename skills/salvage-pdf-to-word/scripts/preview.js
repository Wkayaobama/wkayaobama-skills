// Convert DOCX to a self-contained HTML preview using mammoth.
// Usage: node src/docx-to-html.js <input.docx> <output.html>

import fs from "node:fs";
import mammoth from "mammoth";

const [, , inArg, outArg] = process.argv;
if (!inArg || !outArg) {
  console.error("usage: node src/docx-to-html.js <input.docx> <output.html>");
  process.exit(2);
}

const result = await mammoth.convertToHtml(
  { path: inArg },
  {
    styleMap: [
      "p[style-name='Heading 1'] => h1.form-heading:fresh",
      "p[style-name='Heading 2'] => h2.proc-section:fresh",
    ],
    includeDefaultStyleMap: true,
  },
);

const css = `
<style>
  body { font-family: Arial, sans-serif; max-width: 1100px; margin: 24px auto; padding: 0 16px; color: #222; }
  h1.form-heading { color: #1F4E79; border-bottom: 2px solid #1F4E79; padding-bottom: 4px; margin-top: 32px; }
  h2.proc-section { background: #2E75B6; color: white; padding: 8px 12px; border-radius: 4px; margin-top: 28px; }
  table { border-collapse: collapse; margin: 8px 0 16px; width: 100%; }
  td { border: 1px solid #BFBFBF; padding: 6px 10px; vertical-align: top; }
  td:first-child { background: #F2F2F2; font-weight: bold; width: 18%; }
  td:nth-child(2) { width: 82%; }
  ol, ul { margin: 4px 0 4px 24px; }
  /* Highlight time badges */
  span[style*="background"], .mark { padding: 1px 6px; border-radius: 6px; font-size: 0.85em; }
</style>
`;

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>formmed5 — restored</title>
${css}
</head>
<body>
<header style="color:#888; font-style:italic; margin-bottom:24px;">formmed5 — restauré (preview)</header>
${result.value}
</body>
</html>`;

fs.writeFileSync(outArg, html);
console.log(`wrote ${outArg} (${(html.length / 1024).toFixed(1)} KB)`);
if (result.messages.length) {
  console.log(`mammoth messages (${result.messages.length}):`);
  for (const m of result.messages.slice(0, 8)) console.log(`  ${m.type}: ${m.message}`);
}
