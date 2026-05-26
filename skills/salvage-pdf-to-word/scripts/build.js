// salvage-pdf-to-word :: Stage 3 — raw.json + config.json → output.docx
//
// Reads pdfjs-extracted text items (from parse.js), clusters into lines and
// blocks using the patterns named in config.json, classifies each line, then
// emits a structurally-faithful DOCX via docx-js. Also writes output.ir.json
// alongside the .docx so a human can audit the intermediate representation.
//
// Usage:
//   node build.js <raw.json> <config.json> <output.docx>

import fs from "node:fs";
import path from "node:path";

import {
  AlignmentType,
  BorderStyle,
  CheckBox,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

// ───────────────────────────── config loading

const [, , rawArg, configArg, outArg] = process.argv;
if (!rawArg || !configArg || !outArg) {
  console.error("usage: node build.js <raw.json> <config.json> <output.docx>");
  process.exit(2);
}

const cfg = JSON.parse(fs.readFileSync(configArg, "utf-8"));

// Compile patterns once.
const LABELS = new Set(cfg.labels ?? []);
const RE = {};
for (const [k, v] of Object.entries(cfg.regex ?? {})) {
  // All patterns are case-insensitive except FORM_HEADING_RE which intentionally
  // matched the original AA/BB literally. The config author can decide by
  // baking flags into the pattern with a leading "(?i)" prefix; we strip that
  // and apply the i flag ourselves so the regex itself stays portable across
  // engines.
  let pattern = v;
  let flags = "";
  if (pattern.startsWith("(?i)")) {
    pattern = pattern.slice(4);
    flags = "i";
  }
  RE[k] = new RegExp(pattern, flags);
}

const TH = {
  bannerFontSize: cfg.thresholds?.bannerFontSize ?? 30,
  lineYTolerance: cfg.thresholds?.lineYTolerance ?? 4,
};

const STYLE = {
  fontDefault: cfg.style?.fonts?.default ?? "Arial",
  fontSize: cfg.style?.fonts?.defaultSize ?? 22, // half-points (22 = 11pt)
  colors: {
    heading: cfg.style?.colors?.heading ?? "1F4E79",
    sectionBar: cfg.style?.colors?.sectionBar ?? "2E75B6",
    badge: cfg.style?.colors?.badge ?? "C00000",
    fieldSlotShade: cfg.style?.colors?.fieldSlotShade ?? "FFF2CC",
    tempsTotalShade: cfg.style?.colors?.tempsTotalShade ?? "FFF2CC",
    cellHeader: cfg.style?.colors?.cellHeader ?? "F2F2F2",
    rule: cfg.style?.colors?.rule ?? "BFBFBF",
  },
  cols: {
    labelW: cfg.style?.tableColumns?.labelW ?? 2400,
    contentW: cfg.style?.tableColumns?.contentW ?? 6960,
  },
  pageMargin: cfg.style?.pageMargin ?? { top: 1080, right: 1080, bottom: 1080, left: 1080 },
};

const BADGE = cfg.badgeHighlights ?? {};

const META = {
  title: cfg.meta?.title ?? "salvaged document",
  creator: cfg.meta?.creator ?? "salvage-pdf-to-word",
  headerText: cfg.meta?.headerText ?? "",
};

// Labels that should receive a tinted content cell (e.g. "Votre sélection").
// Authored as a list of labels in cfg.shadedLabels (case-insensitive substrings).
const SHADED_LABELS = (cfg.shadedLabels ?? []).map((s) => s.toLowerCase());

// Field-label that signals "this is the procedure list — skip the inline label
// row because the heading above already establishes the list".
const PROC_LABEL = cfg.procListLabel ?? null;

// ───────────────────────────── line clustering

function clusterLines(items, yTol) {
  const real = items.filter((it) => it.str && it.str.trim().length > 0);
  real.sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  let cur = null;
  for (const it of real) {
    if (!cur || Math.abs(it.y - cur.y) > yTol) {
      cur = { y: it.y, yMin: it.y, yMax: it.y + it.h, items: [] };
      lines.push(cur);
    }
    cur.items.push(it);
    cur.yMin = Math.min(cur.yMin, it.y);
    cur.yMax = Math.max(cur.yMax, it.y + it.h);
  }
  for (const ln of lines) ln.items.sort((a, b) => a.x - b.x);
  for (const ln of lines) {
    ln.text = ln.items.map((i) => i.str.replace(/\n/g, " ").trim())
      .filter((s) => s.length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    ln.xMin = Math.min(...ln.items.map((i) => i.x));
    ln.xMax = Math.max(...ln.items.map((i) => i.x + i.w));
    ln.fontSize = mode(ln.items.map((i) => Math.round(i.fontSize * 10) / 10));
    ln.font = mode(ln.items.map((i) => i.fontName));
  }
  return lines;
}

function mode(arr) {
  const c = new Map();
  for (const v of arr) c.set(v, (c.get(v) ?? 0) + 1);
  let best = arr[0];
  let bestN = 0;
  for (const [v, n] of c) if (n > bestN) { best = v; bestN = n; }
  return best;
}

// ───────────────────────────── classification

function classifyLine(line) {
  const t = line.text;
  if (!t) return { kind: "empty" };

  if (line.fontSize >= TH.bannerFontSize) {
    return { kind: "banner-heading", text: t };
  }

  // Drop leading non-letter/digit garbage (variation selectors etc.) so the
  // pattern matchers see a clean prefix.
  const tNorm = t.replace(/^[^\p{L}\p{N}]+/u, "").trim();

  if (RE.formHeading && RE.formHeading.test(tNorm)) {
    return { kind: "form-heading", text: tNorm };
  }
  if (RE.procSection && RE.procSection.test(tNorm)) {
    return { kind: "proc-section", text: tNorm };
  }
  if (RE.procQuotite && RE.procQuotite.test(tNorm)) {
    return { kind: "proc-section", text: tNorm };
  }
  if (LABELS.has(t.replace(/\s+$/, ""))) {
    return { kind: "field-label", label: t.trim() };
  }
  // Label + inline content on the same physical line.
  if (line.items.length >= 2) {
    const first = line.items[0].str.trim();
    if (LABELS.has(first)) {
      const inlineContent = line.items.slice(1)
        .map((i) => i.str.replace(/\n/g, " ").trim())
        .filter((s) => s.length > 0)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return { kind: "field-label", label: first, inlineContent };
    }
  }
  if (RE.tempsTotal && RE.tempsTotal.test(t)) {
    return { kind: "temps-total" };
  }

  // Procedure-item: e.g. "10234 - Description"
  if (RE.procItem) {
    const m = t.match(RE.procItem);
    if (m) {
      let badge = null;
      let desc = m[2];
      if (RE.timeBadge) {
        const badgeItem = line.items.find((it) => RE.timeBadge.test(it.str.trim()));
        if (badgeItem) {
          badge = badgeItem.str.trim();
          desc = desc.replace(new RegExp(`\\s*${escapeRegex(badge)}\\s*$`), "").trim();
        }
      }
      return { kind: "proc-item", code: m[1], desc, badge, raw: m[0] };
    }
  }

  return { kind: "body", text: t };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ───────────────────────────── block grouping

function groupBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    const cls = ln._class;

    if (cls.kind === "empty") { i++; continue; }

    if (cls.kind === "banner-heading") {
      blocks.push({ kind: "banner", text: cls.text });
      i++;
      continue;
    }

    if (cls.kind === "form-heading") {
      const block = { kind: "form-question", heading: cls.text, rows: [] };
      i++;
      let curLabel = null;
      let curContent = [];
      const flush = () => {
        if (curLabel) block.rows.push({ label: curLabel, contentLines: curContent });
        curLabel = null;
        curContent = [];
      };
      while (i < lines.length) {
        const nx = lines[i];
        const nc = nx._class;
        if (nc.kind === "form-heading" || nc.kind === "proc-section" || nc.kind === "banner-heading") break;
        if (nc.kind === "field-label") {
          flush();
          curLabel = nc.label;
          if (nc.inlineContent) curContent.push({ text: nc.inlineContent });
          i++;
          continue;
        }
        if (nc.kind === "empty") { i++; continue; }
        if (curLabel) curContent.push(nx);
        else block.preamble = (block.preamble ?? []).concat(nx);
        i++;
      }
      flush();
      blocks.push(block);
      continue;
    }

    if (cls.kind === "proc-section") {
      const block = { kind: "proc-list", heading: cls.text, items: [], tempsTotal: false };
      i++;
      while (i < lines.length) {
        const nx = lines[i];
        const nc = nx._class;
        if (nc.kind === "form-heading" || nc.kind === "proc-section" || nc.kind === "banner-heading") break;
        if (nc.kind === "field-label" && PROC_LABEL && nc.label === PROC_LABEL) { i++; continue; }
        if (nc.kind === "proc-item") {
          block.items.push({ code: nc.code, desc: nc.desc, badge: nc.badge });
          i++;
          continue;
        }
        if (nc.kind === "temps-total") { block.tempsTotal = true; i++; continue; }
        if (nc.kind === "empty") { i++; continue; }
        block.notes = (block.notes ?? []).concat(nx);
        i++;
      }
      blocks.push(block);
      continue;
    }

    if (cls.kind === "proc-item") {
      blocks.push({
        kind: "proc-list",
        heading: null,
        items: [{ code: cls.code, desc: cls.desc, badge: cls.badge }],
      });
      i++;
      continue;
    }
    if (cls.kind === "temps-total") {
      blocks.push({ kind: "field-slot", label: "Temps total" });
      i++;
      continue;
    }
    if (cls.kind === "field-label") {
      blocks.push({ kind: "field-slot", label: cls.label });
      i++;
      continue;
    }
    blocks.push({ kind: "paragraph", text: cls.text ?? ln.text });
    i++;
  }
  return blocks;
}

// ───────────────────────────── DOCX emit

function tableBorders() {
  return {
    top:    { style: BorderStyle.SINGLE, size: 4, color: STYLE.colors.rule },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: STYLE.colors.rule },
    left:   { style: BorderStyle.SINGLE, size: 4, color: STYLE.colors.rule },
    right:  { style: BorderStyle.SINGLE, size: 4, color: STYLE.colors.rule },
  };
}

function isShadedLabel(label) {
  const l = label.toLowerCase();
  return SHADED_LABELS.some((s) => l.includes(s));
}

function emitFormQuestion(block, numberingRefs) {
  const out = [];
  out.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 120 },
    children: [new TextRun({ text: block.heading })],
  }));

  if (block.preamble) {
    for (const ln of block.preamble) {
      out.push(new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: ln.text })],
      }));
    }
  }

  if (block.rows.length) {
    const rows = block.rows.map((row) => {
      const labelCell = new TableCell({
        borders: tableBorders(),
        width: { size: STYLE.cols.labelW, type: WidthType.DXA },
        shading: { fill: STYLE.colors.cellHeader, type: ShadingType.CLEAR, color: "auto" },
        verticalAlign: VerticalAlign.TOP,
        children: [new Paragraph({
          spacing: { before: 40, after: 40 },
          children: [new TextRun({ text: row.label, bold: true, size: 22 })],
        })],
      });

      const contentParas = row.contentLines.length
        ? buildContentParagraphs(row.contentLines, row.label, numberingRefs)
        : [new Paragraph({ children: [new TextRun({ text: "" })] })];

      const contentCell = new TableCell({
        borders: tableBorders(),
        width: { size: STYLE.cols.contentW, type: WidthType.DXA },
        shading: isShadedLabel(row.label)
          ? { fill: STYLE.colors.fieldSlotShade, type: ShadingType.CLEAR, color: "auto" }
          : undefined,
        verticalAlign: VerticalAlign.TOP,
        children: contentParas,
      });

      return new TableRow({ children: [labelCell, contentCell] });
    });

    out.push(new Table({
      columnWidths: [STYLE.cols.labelW, STYLE.cols.contentW],
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      rows,
    }));
    out.push(new Paragraph({
      spacing: { before: 120 },
      children: [new TextRun({ text: "" })],
    }));
  }

  return out;
}

function buildContentParagraphs(lines, label, numberingRefs) {
  const paras = [];

  // Heuristic: if the config marks a label as "options-list-host" and the
  // content starts with that prompt followed by enumerated "N. text" items,
  // render as a true numbered list rather than free paragraphs.
  const optionListHosts = (cfg.optionListHosts ?? []).map((s) => s.toLowerCase());
  const isHost = optionListHosts.some((s) => label.toLowerCase().includes(s));
  if (isHost) {
    const allText = lines.map((l) => l.text).join(" ").trim();
    const prefix = cfg.optionListPrefix ?? "Options disponibles:";
    const opts = [...allText.matchAll(/(\d+)\.\s+([^0-9]+?)(?=\s*\d+\.\s+|$)/g)];
    if (allText.startsWith(prefix) && opts.length >= 2) {
      paras.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: prefix.replace(":", " :"), italics: true, color: "595959" })],
      }));
      const ref = numberingRefs.makeUnique("opts");
      for (const m of opts) {
        paras.push(new Paragraph({
          numbering: { reference: ref, level: 0 },
          children: [new TextRun({ text: m[2].trim() })],
        }));
      }
      return paras;
    }
  }

  for (const ln of lines) {
    paras.push(new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: ln.text })],
    }));
  }
  return paras;
}

function emitProcList(block) {
  const out = [];
  if (block.heading) {
    out.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 360, after: 120 },
      shading: { fill: STYLE.colors.sectionBar, type: ShadingType.CLEAR, color: "auto" },
      children: [new TextRun({ text: block.heading, color: "FFFFFF", bold: true })],
    }));
  }
  if (block.items.length === 0) return out;

  for (const it of block.items) {
    const runs = [
      new CheckBox({ checked: false, alias: it.code }),
      new TextRun({ text: "  " }),
      new TextRun({ text: `${it.code} – ${it.desc}` }),
    ];
    if (it.badge) {
      runs.push(new TextRun({ text: "    " }));
      runs.push(new TextRun({
        text: ` ${it.badge} `,
        bold: true,
        color: "FFFFFF",
        highlight: badgeHighlight(it.badge),
      }));
    }
    runs.push(new TextRun({ text: "   [ ]", color: "808080" }));
    out.push(new Paragraph({
      spacing: { after: 40 },
      indent: { left: 360 },
      children: runs,
    }));
  }

  if (block.tempsTotal) out.push(emitTempsTotal());
  return out;
}

function badgeHighlight(badge) {
  const t = badge.toLowerCase();
  // Try exact match first, then any key that appears as a substring of the badge.
  if (BADGE[t]) return BADGE[t];
  for (const [key, color] of Object.entries(BADGE)) {
    if (t.includes(key)) return color;
  }
  return "lightGray";
}

function emitTempsTotal() {
  return new Table({
    columnWidths: [STYLE.cols.labelW, STYLE.cols.contentW],
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    rows: [new TableRow({
      children: [
        new TableCell({
          borders: tableBorders(),
          width: { size: STYLE.cols.labelW, type: WidthType.DXA },
          shading: { fill: STYLE.colors.tempsTotalShade, type: ShadingType.CLEAR, color: "auto" },
          children: [new Paragraph({
            children: [new TextRun({ text: "Temps total", bold: true, size: 22 })],
          })],
        }),
        new TableCell({
          borders: tableBorders(),
          width: { size: STYLE.cols.contentW, type: WidthType.DXA },
          shading: { fill: STYLE.colors.tempsTotalShade, type: ShadingType.CLEAR, color: "auto" },
          children: [new Paragraph({
            children: [new TextRun({ text: "_____________________________", color: "808080" })],
          })],
        }),
      ],
    })],
  });
}

function emitFieldSlot(block) {
  return [new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [
      new TextRun({ text: `${block.label}: `, bold: true }),
      new TextRun({ text: "_____________________________", color: "808080" }),
    ],
  })];
}

function emitBanner(block) {
  return [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 480, after: 240 },
    pageBreakBefore: true,
    children: [new TextRun({
      text: block.text,
      bold: true,
      size: 40,
      color: STYLE.colors.heading,
    })],
  })];
}

function emitParagraph(block) {
  return [new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: block.text })],
  })];
}

// ───────────────────────────── numbering refs

class NumberingRefs {
  constructor() { this.uniqueCounter = 0; this.configs = []; }
  makeUnique(prefix) {
    const ref = `${prefix}-${++this.uniqueCounter}`;
    this.configs.push({
      reference: ref,
      levels: [{
        level: 0,
        format: LevelFormat.DECIMAL,
        text: "%1.",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    });
    return ref;
  }
  toConfig() { return { config: this.configs }; }
}

// ───────────────────────────── document

function buildDocument(blocks) {
  const numberingRefs = new NumberingRefs();
  const children = [];
  for (const block of blocks) {
    if (block.kind === "form-question") children.push(...emitFormQuestion(block, numberingRefs));
    else if (block.kind === "proc-list") children.push(...emitProcList(block));
    else if (block.kind === "field-slot") children.push(...emitFieldSlot(block));
    else if (block.kind === "banner") children.push(...emitBanner(block));
    else if (block.kind === "paragraph") children.push(...emitParagraph(block));
  }

  return new Document({
    creator: META.creator,
    title: META.title,
    styles: {
      default: {
        document: { run: { font: STYLE.fontDefault, size: STYLE.fontSize } },
      },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 28, bold: true, color: STYLE.colors.heading, font: STYLE.fontDefault },
          paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 },
        },
        {
          id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 26, bold: true, color: "FFFFFF", font: STYLE.fontDefault },
          paragraph: {
            spacing: { before: 300, after: 120 }, outlineLevel: 1,
            shading: { fill: STYLE.colors.sectionBar, type: ShadingType.CLEAR, color: "auto" },
          },
        },
      ],
    },
    numbering: numberingRefs.toConfig(),
    sections: [{
      properties: { page: { margin: STYLE.pageMargin } },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: META.headerText, color: "808080", italics: true, size: 18 })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Page ", color: "808080", size: 18 }),
              new TextRun({ children: [PageNumber.CURRENT], color: "808080", size: 18 }),
              new TextRun({ text: " / ", color: "808080", size: 18 }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], color: "808080", size: 18 }),
            ],
          })],
        }),
      },
      children,
    }],
  });
}

// ───────────────────────────── main

const raw = JSON.parse(fs.readFileSync(rawArg, "utf-8"));
console.log(`loaded raw.json: ${raw.textItems.length} text items, canvas ${raw.canvas.width}x${raw.canvas.height}`);

const lines = clusterLines(raw.textItems, TH.lineYTolerance);
console.log(`clustered into ${lines.length} lines`);

for (const ln of lines) ln._class = classifyLine(ln);

const counts = {};
for (const ln of lines) counts[ln._class.kind] = (counts[ln._class.kind] ?? 0) + 1;
console.log("line classes:", counts);

const blocks = groupBlocks(lines);
const blockCounts = {};
for (const b of blocks) blockCounts[b.kind] = (blockCounts[b.kind] ?? 0) + 1;
console.log("blocks:", blockCounts);

const doc = buildDocument(blocks);
const buf = await Packer.toBuffer(doc);
fs.mkdirSync(path.dirname(outArg), { recursive: true });
fs.writeFileSync(outArg, buf);
console.log(`wrote ${outArg} (${(buf.length / 1024).toFixed(1)} KB)`);

const irPath = outArg.replace(/\.docx$/, ".ir.json");
fs.writeFileSync(irPath, JSON.stringify({ blocks }, null, 2));
console.log(`wrote ${irPath}`);
