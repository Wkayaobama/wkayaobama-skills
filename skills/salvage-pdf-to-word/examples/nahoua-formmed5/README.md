# Example — nahoua / formmed5

The canonical worked example for `salvage-pdf-to-word`. Salvages a French
medical-form PDF (`formmed5.pdf`) into a structured DOCX.

## What this corpus looks like

- **Banner headings** at ~40pt mark major sections (e.g. "Section BB — Données de base").
- **Form headings** like `AA12.` / `BB3a.` open a question block, followed by labeled rows.
- **Field labels** drawn from a fixed French vocabulary: `Objectif`, `Définition`,
  `Procédure(s)`, `Codage`, `Votre sélection`.
- **Procedure sections** introduced by `Section N-M :` or `Nème Quotité (a-b)`
  contain numeric-coded procedure items: `10234 - Description` with optional
  time/priority badges (`30 min`, `variable`, `jaune`, `rouge`, `vert`).
- **`Temps total`** trails a procedure list as a fillable total-time row.

## How it was authored

1. Ran `parse.js` on `formmed5.pdf` to produce `raw.json` + `raw.stats.json`.
2. Font histogram showed body at ~11pt and a single banner cluster at ~40pt — so
   `bannerFontSize: 30` cleanly separates them.
3. Rendered a 50-DPI canvas and sliced into 6 bands to use as visual ground truth.
4. The French label vocabulary was derived by scanning text items for short
   Title-Case strings appearing >5× and confirming each is a "name of the next
   field" in the slices.
5. The `AA/BB`, `Section N-M`, `Quotité`, and `NNNN -` regex patterns came from
   reading the slices and counting the recurring orthography.
6. `Codage` cells frequently host "Options disponibles: 1. foo  2. bar"
   enumerations — hence `optionListHosts: ["codage"]` and
   `optionListPrefix: "Options disponibles:"`.

## Running it

Assuming `${CLAUDE__ROOT}` is set and the scripts have their npm deps installed:

```bash
SKILL="${CLAUDE__ROOT}/skills/salvage-pdf-to-word"
WORK="$(mktemp -d)"

node "$SKILL/scripts/parse.js"   formmed5.pdf "$WORK"
python "$SKILL/scripts/render_canvas.py" formmed5.pdf "$WORK/canvas.png" 50
python "$SKILL/scripts/slice_canvas.py"  "$WORK/canvas.png" "$WORK/slices" 6
node "$SKILL/scripts/build.js"   "$WORK/raw.json" "$SKILL/examples/nahoua-formmed5/config.json" "$WORK/output.docx"
node "$SKILL/scripts/preview.js" "$WORK/output.docx" "$WORK/preview.html"

# Inspect:
#   $WORK/slices/*.png         ← visual ground truth
#   $WORK/output.ir.json       ← classified blocks
#   $WORK/output.docx          ← final result
#   $WORK/preview.html         ← browser-friendly preview
```
