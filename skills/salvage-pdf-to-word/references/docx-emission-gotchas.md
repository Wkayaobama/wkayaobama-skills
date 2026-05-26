# docx-js Emission Gotchas

The `docx` npm library is what the build script uses to produce the DOCX.
It's a thin shell over the OOXML grammar; you can write something that
*compiles* but renders wrong (or not at all) in Word. These are the traps
the salvage pipeline hit and the conventions that work.

---

## 1. Headings — Override the Style, Don't Inline

Setting `heading: HeadingLevel.HEADING_1` on a `Paragraph` works only if
the document defines a `Heading1` style. The default theme styles are
inconsistent across Word versions; you must override them yourself:

```js
new Document({
  styles: {
    paragraphStyles: [{
      id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal",
      quickFormat: true,
      run: { size: 28, bold: true, color: "1F4E79", font: "Arial" },
      paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 },
    }, {
      id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal",
      quickFormat: true,
      run: { size: 26, bold: true, color: "FFFFFF", font: "Arial" },
      paragraph: {
        spacing: { before: 300, after: 120 }, outlineLevel: 1,
        shading: { fill: "2E75B6", type: ShadingType.CLEAR, color: "auto" },
      },
    }]
  }
})
```

The IDs must be exactly `Heading1`, `Heading2`, etc. — capital H, no space.

---

## 2. Tables — Always Set `columnWidths` AND Per-Cell `width`

If you only set per-cell widths Word may still auto-fit. Set both:

```js
new Table({
  columnWidths: [2400, 6960],     // ← top-level
  rows: [
    new TableRow({ children: [
      new TableCell({ width: { size: 2400, type: WidthType.DXA }, ... }),
      new TableCell({ width: { size: 6960, type: WidthType.DXA }, ... }),
    ]}),
  ],
})
```

Widths are in DXA (twentieths of a point). 1 inch ≈ 1440 DXA. The two
cell widths should sum to the page's usable width.

---

## 3. Shading — `CLEAR`, Not `SOLID`

`ShadingType.SOLID` in Word ignores the `fill` color and renders the
default. Use `CLEAR`:

```js
shading: { fill: "F2F2F2", type: ShadingType.CLEAR, color: "auto" }
```

This counterintuitive naming is a recurring snag — `CLEAR` means
"no pattern, just the fill color", which is what you actually want.

---

## 4. Numbering — One Reference Per List That Restarts at 1

`docx-js` shares numbering state across paragraphs that share a `reference`.
If you want two lists that both start at "1.", you need two references:

```js
const numbering = {
  config: [
    { reference: "codage-opts-1", levels: [/* ... */] },
    { reference: "codage-opts-2", levels: [/* ... */] },
  ]
};
// Later:
new Paragraph({ numbering: { reference: "codage-opts-1", level: 0 }, ... })
```

The `build.js` script's `NumberingRefs.makeUnique(prefix)` helper hands out
fresh refs for exactly this reason.

---

## 5. Page Breaks — Inside a Paragraph, Not Between Them

There is no top-level "page break" element. Put it on the paragraph that
should *start* the new page:

```js
new Paragraph({
  pageBreakBefore: true,
  children: [new TextRun({ text: "Section 2" })],
})
```

Or insert a `PageBreak()` child run if you need a mid-paragraph break
(rare).

---

## 6. Per-Run Shading Is Not Supported

You can't shade a single run inside a paragraph. The closest equivalent
is `highlight`, which is what we use for time badges:

```js
new TextRun({
  text: " 30 min ", bold: true, color: "FFFFFF",
  highlight: "red",
})
```

Valid highlight values are the limited Word palette: `yellow`, `green`,
`cyan`, `magenta`, `blue`, `red`, `darkBlue`, `darkCyan`, `darkGreen`,
`darkMagenta`, `darkRed`, `darkYellow`, `darkGray`, `lightGray`, `black`,
`white`, `none`.

---

## 7. Checkboxes — Use `CheckBox`, Keep a Text Fallback

```js
new Paragraph({
  children: [
    new CheckBox({ checked: false, alias: "10234" }),
    new TextRun({ text: "  10234 – Description" }),
    new TextRun({ text: "   [ ]", color: "808080" }),  // visible fallback
  ],
})
```

The `CheckBox` is a Word content control. In older renderers or after a
DOCX→HTML conversion via mammoth the control may not show; the trailing
`[ ]` keeps the visual semantics legible everywhere.

The `alias` is the field's logical ID — useful for downstream automation
that needs to address the checkbox by name.

---

## 8. Header/Footer — One Per Section, Not Per Document

Headers and footers live on the section properties, not on the document:

```js
sections: [{
  properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
  headers: { default: new Header({ children: [/* ... */] }) },
  footers: { default: new Footer({ children: [/* ... */] }) },
  children: [/* document body */],
}]
```

`PageNumber.CURRENT` and `PageNumber.TOTAL_PAGES` are special children
that render at print time:

```js
new TextRun({ children: [PageNumber.CURRENT], color: "808080", size: 18 })
```

---

## 9. Font Sizes Are Half-Points

Word stores font sizes as half-points. `size: 22` = 11pt, `size: 28` = 14pt,
`size: 40` = 20pt. This applies to `Paragraph.run.size`, `TextRun.size`,
and the document default. Forget once and your text comes out tiny.

---

## 10. Color Strings — Hex Without `#`

Colors are 6-char uppercase hex strings without the leading `#`:
`"1F4E79"`, not `"#1F4E79"` or `"rgb(31,78,121)"`. The library will
silently accept malformed values and render nothing.
