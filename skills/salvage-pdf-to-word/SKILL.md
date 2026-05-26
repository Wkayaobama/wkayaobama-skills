---
name: salvage-pdf-to-word
description: >
  Salvage a structurally-unreliable PDF (no tags, irregular layout, form-heavy,
  scanned-from-print, or anything where pdf2docx / Acrobat export / mammoth-of-a-bad-docx
  has already produced garbage) into a faithfully-structured DOCX by rebuilding
  structure from raw vector operators and a per-corpus pattern config — not by
  trusting the PDF's tags. Use whenever a user wants a PDF turned into Word AND
  the source is messy, untagged, form-like, or has defeated a one-shot converter.
  Trigger on: "convert this PDF to Word", "extract this form into a docx", "the
  PDF→docx is mangled / broken / lost the structure", "rebuild this PDF as a
  proper Word doc", "the headings/checkboxes/tables didn't survive", or any
  PDF→DOCX request where layout fidelity matters (medical/legal/government forms,
  procedure lists, multi-column questionnaires, coded subsections, fillable boxes).
  Don't reach for this skill for a clean, tagged PDF that an off-the-shelf tool
  handles — reach for it the moment the source is unstructured or a converter has
  already failed.
---

# Salvage PDF → Word

Rebuild a structurally-unreliable PDF into a faithful DOCX. The skill assumes
the PDF has either no semantic tags, broken tags, or a layout that a one-shot
converter can't reason about (forms, checkbox lists, coded subsections, time
badges, banner headings). It does NOT rely on the PDF's own structure metadata.

The work is split into four stages, each with a small bundled script. Pattern
recognition is **parametric** — you supply a per-corpus `config.json` that names
the labels, regexes, and visual cues for your document family. The same skill
works on a French medical form, an English questionnaire, or a contract template;
only the config changes.

---

## When to Use

Use this skill when ALL of these are true:

- The source is a PDF (single- or multi-page).
- The user wants a DOCX (or DOCX-then-HTML preview) as output.
- Structure matters: headings, checkbox lists, two-column form rows, fields with labels, time/priority badges, coded subsections, etc.
- Off-the-shelf converters either lose structure, mangle order, or flatten everything to paragraphs.

Do NOT use this skill when the PDF is already well-tagged and `pdf2docx` or
Acrobat export gives an acceptable result. Try the cheap path first.

---

## The Four Stages

```
PDF ─► (1) parse.js ─► raw.json (text items + rect ops, top-left coords)
       (2) render_canvas.py + slice_canvas.py ─► PNG bands for visual reference
       (3) build.js + config.json ─► output.docx + output.ir.json (IR for review)
       (4) preview.js ─► preview.html  (mammoth-based sanity check)
```

### Stage 1 — Vector Parse (`scripts/parse.js`)

Walks the pdfjs-dist operator list, tracks the affine transform stack, and
emits every text item and rectangle path in **top-left coordinate space**
(origin top-left, y increases downward — the natural space for clustering
and DOCX emission). Output: `raw.json` + a small `raw.stats.json` for
quick inspection (font histogram, rect-size histogram, sample items).

```bash
node ${CLAUDE__ROOT}/skills/salvage-pdf-to-word/scripts/parse.js <input.pdf> <out-dir>
```

### Stage 2 — Visual Reference (`scripts/render_canvas.py` + `scripts/slice_canvas.py`)

Render the PDF to a low-DPI PNG, then band-slice it into N vertical strips.
This is the *ground truth* you compare your IR against during pattern
authoring. Without it you're guessing.

```bash
python ${CLAUDE__ROOT}/skills/salvage-pdf-to-word/scripts/render_canvas.py <input.pdf> <out.png> [dpi=50]
python ${CLAUDE__ROOT}/skills/salvage-pdf-to-word/scripts/slice_canvas.py <out.png> <slices-dir> [n=6]
```

### Stage 3 — Cluster, Classify, Emit (`scripts/build.js`)

The heart of the salvage. Given `raw.json` and a `config.json`:

1. **Line clustering** — group text items by y-tolerance (default 4pt), sort items left-to-right within each line.
2. **Line classification** — assign each line a `kind` using the config's vocabulary, regexes, and font-size thresholds (e.g. `banner-heading`, `form-heading`, `proc-section`, `field-label`, `proc-item`, `time-badge`, `body`).
3. **Block grouping** — fold runs of classified lines into logical blocks (`form-question` ⇒ two-column table; `proc-list` ⇒ checkbox list with optional time badges; `banner` ⇒ centered page-break heading; etc.).
4. **DOCX emission** — render each block via `docx-js` using the config's style (fonts, colors, table widths, badge highlights). Also writes `output.ir.json` so a human can audit the intermediate representation.

```bash
node ${CLAUDE__ROOT}/skills/salvage-pdf-to-word/scripts/build.js <raw.json> <config.json> <output.docx>
```

### Stage 4 — Preview (`scripts/preview.js`)

Convert the DOCX to HTML via `mammoth` for a quick browser-friendly sanity
check. This is the fastest feedback loop while you iterate on the config.

```bash
node ${CLAUDE__ROOT}/skills/salvage-pdf-to-word/scripts/preview.js <output.docx> <preview.html>
```

---

## Parametric Config — What You Author Per Corpus

Every corpus (medical form, contract, questionnaire…) needs its own
`config.json`. The schema:

```jsonc
{
  "labels": ["Objectif", "Définition", "Procédure", "Codage", "Votre sélection"],
  "regex": {
    "formHeading":   "^(AA|BB)\\d+[a-z]?\\.\\s+",
    "procSection":   "^Section\\s+\\d+-\\d+\\s*:",
    "procQuotite":   "^\\d+(?:ère|ème|e)?\\s*Quotité\\s*\\(\\d+-\\d+\\)",
    "procItem":      "^(\\d{4,5})\\s*-\\s*(.+?)$",
    "timeBadge":     "^(?:\\d+\\s*min|variable|jaune|rouge|vert)\\s*$",
    "tempsTotal":    "^Temps\\s+total"
  },
  "thresholds": {
    "bannerFontSize": 30,
    "lineYTolerance": 4
  },
  "style": {
    "fonts":        { "default": "Arial", "defaultSize": 22 },
    "colors":      { "heading": "1F4E79", "sectionBar": "2E75B6", "fieldSlotShade": "FFF2CC" },
    "tableColumns": { "labelW": 2400, "contentW": 6960 },
    "pageMargin":  { "top": 1080, "right": 1080, "bottom": 1080, "left": 1080 }
  },
  "badgeHighlights": {
    "min": "red", "variable": "darkYellow",
    "jaune": "yellow", "rouge": "red", "vert": "green"
  },
  "meta": {
    "title":   "formmed5 — restored",
    "creator": "salvage-pdf-to-word",
    "headerText": "formmed5 — restauré"
  }
}
```

Full schema and authoring guidance: see `references/configuring-patterns.md`.

A worked example: `examples/nahoua-formmed5/config.json` (French medical form
with `Objectif`/`Définition`/`Procédure`/`Codage`/`Votre sélection` vocabulary
and `AA/BB` form-heading + `NNNN -` procedure-item patterns).

---

## Suggested Workflow on a New Corpus

1. **Run Stage 1** to produce `raw.json` + `raw.stats.json`. Inspect the stats —
   font histogram tells you what banner font size to set; rect histogram tells
   you whether there are real form-field boxes worth detecting.
2. **Run Stage 2** to get visual ground truth. Open a slice next to the IR
   you'll produce later.
3. **Start with the nahoua config as a template.** Strip the regexes and labels
   that don't apply. Add ones that do.
4. **Iterate Stage 3 → Stage 4** until the preview matches the slices. The IR
   (`output.ir.json`) is your debugging artifact — it lists every block and
   what it became.
5. **Open `output.docx` in Word** for the final check. HTML preview catches
   most issues but not Word-specific render quirks (table column widths,
   checkbox content controls, numbering restarts).

---

## Setup — Node Dependencies

The scripts depend on `pdfjs-dist`, `docx`, `mammoth`, and (optionally) `sharp`.
Either install them in your working project or `cd` into the skill's `scripts/`
dir and run:

```bash
cd ${CLAUDE__ROOT}/skills/salvage-pdf-to-word/scripts
npm install
```

Python: `pypdfium2` + `Pillow` (`pip install pypdfium2 Pillow`).

---

## References

- **`references/methodology.md`** — why we parse vector ops instead of trusting tags, and the design choices behind each stage.
- **`references/configuring-patterns.md`** — full `config.json` schema, how to derive regex patterns from a new corpus, and the visual-feedback loop.
- **`references/docx-emission-gotchas.md`** — the `docx-js` traps we hit and the conventions that work (table `columnWidths`, `ShadingType.CLEAR` not `SOLID`, unique numbering refs per restart-at-1 list, `PageBreak` inside `Paragraph`, per-run highlight not shading).

---

## Anti-Patterns

- **Don't trust the PDF's own structure tags.** Even when present they're often wrong on this class of document. The salvage approach is to rebuild from positions.
- **Don't make `build.js` smarter to fit one corpus.** Add a regex or label to that corpus's `config.json` instead. The script should stay corpus-agnostic.
- **Don't skip Stage 2.** Visual slices are the only honest comparison target.
- **Don't iterate without looking at the IR.** `output.ir.json` tells you exactly how each line was classified — guessing at the cause of a wrong output is wasted time.
- **Don't ship a config without comments-by-example.** Every corpus config should sit next to a short README that names what kind of document it salvages.
