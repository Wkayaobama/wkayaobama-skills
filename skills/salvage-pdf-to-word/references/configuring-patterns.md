# Configuring Patterns — Authoring config.json for a New Corpus

`build.js` is corpus-agnostic. Every corpus-specific thing — vocabulary,
heading regex, badge colors, table widths, header text — lives in a JSON
config the script reads at runtime. This file is the authoring guide.

---

## Top-Level Schema

```jsonc
{
  "labels": [...],                  // vocabulary that marks a "field-label" line
  "regex": { ... },                 // named regex patterns
  "thresholds": { ... },            // numeric cutoffs
  "style": { ... },                 // colors, fonts, table widths, margins
  "badgeHighlights": { ... },       // badge text → Word highlight color
  "shadedLabels": [...],            // labels whose content cell gets tinted
  "procListLabel": "...",           // label that signals "this IS the proc list" (skip the label row)
  "optionListHosts": [...],         // labels whose content may be a "1. foo  2. bar" enumerated list
  "optionListPrefix": "...",        // the literal prefix that prompts an option list (e.g. "Options disponibles:")
  "meta": { ... }                   // title, creator, header text
}
```

---

## `labels` — Field Vocabulary

A list of literal strings that, when they appear as a complete line (or as
the first item of a line followed by inline content), mark the line as a
field label.

Example (French medical form):

```json
"labels": ["Objectif", "Définition", "Procédure", "Procédures", "Codage", "Votre sélection"]
```

How to pick yours: open `raw.stats.json` (printed by `parse.js`), look at
the `sampleTextItems`, and identify the recurring "this is the name of the
next field" tokens. They're usually short (one or two words), Title Case,
and appear far more often than would be coincidence.

---

## `regex` — Pattern Slots

The classifier consults these by name. Missing entries are skipped (no error).

| Key | What it matches | Becomes |
|---|---|---|
| `formHeading`  | Top-of-form-block heading (e.g. `AA12.`, `BB3a.`) | `form-heading` (opens a `form-question` block) |
| `procSection`  | Procedure section title (e.g. `Section 4-2:`) | `proc-section` (opens a `proc-list` block) |
| `procQuotite`  | A quotité-style sub-section (e.g. `2ème Quotité (10-20)`) | `proc-section` |
| `procItem`     | Procedure item with code + description (e.g. `10234 - Foo bar`) | `proc-item` — must have two capture groups: (code, desc) |
| `timeBadge`    | Trailing badge on a proc item (e.g. `30 min`, `jaune`, `variable`) | annotates the proc-item with a badge |
| `tempsTotal`   | "total time" trailer (e.g. `Temps total`) | `temps-total` (adds a footer row to the proc list) |

### Case-insensitive flag

Prefix the pattern with `(?i)` and the loader will strip it and apply the
`i` flag. Example:

```json
"procSection": "(?i)^section\\s+\\d+-\\d+\\s*:"
```

### Patterns that *must* have specific capture groups

- `procItem` — group 1 = code, group 2 = description. Both required.

---

## `thresholds`

| Key | Default | Meaning |
|---|---|---|
| `bannerFontSize` | 30 | Lines with font size ≥ this become `banner-heading` (centered, page-break-before). Inspect `raw.stats.json` font histogram to pick a value above your body font and below your true banners. |
| `lineYTolerance` | 4 | Items within this many PDF points of each other on the y-axis join the same line. If clustering merges lines that should be separate, lower this. If it splits lines that should be one, raise it. |

---

## `style`

```json
"style": {
  "fonts":        { "default": "Arial", "defaultSize": 22 },
  "colors": {
    "heading":         "1F4E79",
    "sectionBar":      "2E75B6",
    "badge":           "C00000",
    "fieldSlotShade":  "FFF2CC",
    "tempsTotalShade": "FFF2CC",
    "cellHeader":      "F2F2F2",
    "rule":            "BFBFBF"
  },
  "tableColumns": { "labelW": 2400, "contentW": 6960 },
  "pageMargin":  { "top": 1080, "right": 1080, "bottom": 1080, "left": 1080 }
}
```

Notes:

- Font sizes are in **half-points** (Word convention): 22 = 11pt, 28 = 14pt.
- Colors are 6-char hex, **no leading `#`**.
- `tableColumns.labelW + tableColumns.contentW` should add up to roughly the
  usable page width in DXA (1 inch ≈ 1440 DXA). With 1-inch margins on A4 you
  have ≈9360 DXA total.
- `pageMargin` is in DXA. 1080 = 0.75".

---

## `badgeHighlights`

Maps badge text (lowercase) to Word highlight colors. Looked up first by
exact match, then by substring containment.

```json
"badgeHighlights": {
  "min":      "red",
  "variable": "darkYellow",
  "jaune":    "yellow",
  "rouge":    "red",
  "vert":     "green"
}
```

Valid Word highlight values: `yellow`, `green`, `cyan`, `magenta`, `blue`,
`red`, `darkBlue`, `darkCyan`, `darkGreen`, `darkMagenta`, `darkRed`,
`darkYellow`, `darkGray`, `lightGray`, `black`, `white`, `none`.

Per-run **shading** is not supported in Word; we use highlight instead.

---

## `shadedLabels`

Labels whose content cell should get a tinted background (using
`style.colors.fieldSlotShade`). Case-insensitive substring match.

```json
"shadedLabels": ["votre sélection"]
```

This is for "user-fillable" rows where you want a visual cue.

---

## `procListLabel`

Some corpora put the literal word "Procédures" as a field label *inside*
a proc-section block. Since the section heading already establishes that
the following items are procedures, the label row is redundant. Naming
the label here tells the grouper to skip it.

```json
"procListLabel": "Procédures"
```

---

## `optionListHosts` + `optionListPrefix`

When a `Codage` (or equivalent) field's content begins with a literal
prefix like `Options disponibles:` and contains an enumerated list
(`1. foo  2. bar  3. baz`), the emitter renders it as a true numbered
list instead of a free paragraph.

```json
"optionListHosts": ["codage"],
"optionListPrefix": "Options disponibles:"
```

If neither key is present, the optional-list detection is skipped.

---

## `meta`

```json
"meta": {
  "title":      "formmed5 — restored",
  "creator":    "salvage-pdf-to-word",
  "headerText": "formmed5 — restauré"
}
```

- `title` and `creator` go into the DOCX file properties.
- `headerText` is rendered top-right on every page in light italics.

---

## Authoring Loop

1. Run Stage 1 (parse). Open `raw.stats.json` and look at:
   - Font histogram → pick `bannerFontSize`.
   - Sample text items → pick `labels` candidates.
2. Run Stage 2 (render + slice). Pin a slice next to your editor.
3. Start with the nahoua config as a base. Strip what doesn't apply.
4. Run Stage 3 with your config. Open `output.ir.json` and compare against
   the slice. For every wrong block, ask:
   - **Wrong classification?** Adjust `labels` / `regex` / `thresholds`.
   - **Right classification, wrong shape?** Adjust `style` or report a bug.
5. Run Stage 4 (preview). Open in browser; eyeball.
6. Open the DOCX in Word. Final sanity check.
