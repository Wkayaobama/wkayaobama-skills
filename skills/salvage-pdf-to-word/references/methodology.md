# Methodology — Why We Salvage Instead of Convert

A standard PDF→DOCX converter (pdf2docx, Acrobat export, mammoth-on-converted)
assumes the PDF carries semantic structure: tagged paragraphs, tables, list
items, headings. For a large class of real-world documents — medical forms,
legal templates, government questionnaires, anything printed-then-scanned-and-OCRed,
anything authored in InDesign / Word and shipped as flat PDF — that assumption
is wrong. The structure is **visual only**: spatial position, font size, color,
proximity. Hand a converter that document and you get a flat run of paragraphs
in scan order with the form layout obliterated.

Salvage flips the strategy: ignore tags, rebuild structure from positions.

## The Four Stages

### Stage 1 — Vector Parse

We use `pdfjs-dist` because it surfaces both the **text content stream**
(`getTextContent()` — every glyph's position, font, size) and the **operator
list** (`getOperatorList()` — every drawing op including rectangles). The
operator walker tracks the affine transform stack (`save`/`restore`/`transform`
ops), so rectangles emitted in a transformed graphics state still end up in
correct page coordinates.

The output is `raw.json` — a flat list of text items and rectangle paths,
all in **top-left coordinate space**. PDF natively uses bottom-left; we flip
y so the rest of the pipeline can think in screen coordinates (which is also
what humans think in when looking at a rendered slice).

We deliberately do *not* parse images, embedded fonts, or color in the text
stream at this stage. Color requires walking the op list with a per-run
state machine; if a future corpus needs colored-text classification, that's
the place to add it.

### Stage 2 — Visual Reference

Run `render_canvas.py` to produce a low-DPI PNG, then `slice_canvas.py` to
band-slice it. The slices serve one purpose: **a ground truth you can put
next to the IR while authoring patterns**. Without them you're flying blind —
the text-item positions look like numbers, not a document.

50 DPI is the default because it's small enough to render in seconds and big
enough to read field labels. For detail work bump to 150 DPI.

### Stage 3 — Cluster, Classify, Emit

Three sub-steps, each independently auditable:

1. **Cluster** — group text items into lines by y-tolerance (default 4 PDF
   points). Items inside the tolerance band become one line; items are sorted
   left-to-right within the line; the line's mode font size and mode font
   name are computed for later classification.
2. **Classify** — assign each line a `kind`. Order matters: banner-heading
   wins on font size; form/section/quotité headings win on regex; field
   labels win on vocabulary; procedure items win on a numeric-code regex;
   everything else is body. This ordering is what makes the rest of the
   pipeline simple.
3. **Group into blocks** — fold runs of classified lines into logical
   blocks (`form-question` ⇒ two-column table; `proc-list` ⇒ checkbox list
   with optional time badges; `banner` ⇒ centered page-break heading;
   `field-slot` ⇒ inline "label: ____" row; `paragraph` ⇒ free text).

The IR (`output.ir.json`) is written alongside the DOCX so a human can audit
exactly how every block was interpreted. When the output is wrong, the IR
tells you whether the mistake was in classification (line went into the wrong
bucket) or emission (right bucket, wrong DOCX shape).

### Stage 4 — Preview

`mammoth` converts the DOCX to HTML for a fast browser sanity check. The
HTML loses some Word-specific render fidelity (table column widths visible
in Word may collapse in mammoth's output; per-run highlight may render
differently) but it catches the 80% case: missing sections, wrong headings,
malformed lists, blocks in the wrong order. Always finish with a Word
open-and-eyeball before shipping.

## Design Choices Worth Knowing

- **Top-left coordinates everywhere.** Mixing PDF and screen y-axes is a
  bug magnet. We flip once, at parse time.
- **Mode font, not mean font.** A line of mixed-size text gets the most
  common size as its `fontSize` — robust against a single italic character.
- **Inline-label detection.** A field label followed by content on the
  *same physical line* (e.g. "Codage 12345") is detected by looking at
  the first item in the line, not by re-scanning the whole text.
- **No font color in classification.** PDF font color requires walking
  the op list. Defer until a corpus actually needs it.
- **CheckBox content control + visible `[ ]` fallback.** Word checkbox
  controls require a recent renderer; the trailing `[ ]` text guarantees
  the bullet is still visible in any reader.
- **One numbering ref per restart-at-1 list.** docx-js shares numbering
  state across paragraphs that share a ref. Different lists ⇒ different
  refs, or they continue each other's numbering.
- **`ShadingType.CLEAR`, never `SOLID`.** `SOLID` ignores the fill color
  in Word; `CLEAR` honors it. This is a docx-js trap — see
  `docx-emission-gotchas.md`.
