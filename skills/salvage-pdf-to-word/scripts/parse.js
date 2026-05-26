// Stage 1: vector parse with pdfjs-dist.
// Walks the operator list, tracks transforms, emits raw.json with
// text items + rectangle graphics ops in top-left coordinate space
// (origin top-left, y increases downward).
//
// Usage:
//   node src/stage1-parse.js <input.pdf> <output-dir>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// pdfjs-dist v5 — legacy build is required in Node (no DOMMatrix)
const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { getDocument, OPS } = pdfjsLib;

// Build reverse-lookup of op name → code, for diagnostics
const OP_NAME = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));

// 3x3 affine matrix helpers (column-major in PDF: [a b c d e f] →
// | a c e |
// | b d f |
// | 0 0 1 |)
const ident = () => [1, 0, 0, 1, 0, 0];
function mul(m1, m2) {
  // m1 * m2 (PDF cm convention: new = current_then_op)
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}
function applyXY(m, x, y) {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

function rectCornersTransformed(m, x, y, w, h) {
  const corners = [
    applyXY(m, x, y),
    applyXY(m, x + w, y),
    applyXY(m, x + w, y + h),
    applyXY(m, x, y + h),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

function rgb(comps) {
  if (!comps || comps.length < 3) return null;
  const [r, g, b] = comps;
  const to8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `#${to8(r).toString(16).padStart(2, "0")}${to8(g).toString(16).padStart(2, "0")}${to8(b).toString(16).padStart(2, "0")}`;
}

async function parse(pdfPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  console.log(`loaded pdf: ${pdf.numPages} page(s)`);

  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.0 });
  const canvasWidth = viewport.width;
  const canvasHeight = viewport.height;
  console.log(`canvas: ${canvasWidth} x ${canvasHeight} pt`);

  // Convert PDF y (origin bottom-left) to image y (origin top-left)
  const flipY = (y) => canvasHeight - y;

  // ---- Text items ----
  const textContent = await page.getTextContent({
    includeMarkedContent: false,
    disableNormalization: false,
  });
  const textItems = textContent.items.map((item, i) => {
    const t = item.transform;
    const x = t[4];
    const yPdf = t[5];
    const w = item.width;
    const h = item.height;
    return {
      id: `t${i}`,
      str: item.str,
      x: x,
      y: flipY(yPdf + h),
      w,
      h,
      fontName: item.fontName,
      fontSize: Math.hypot(t[2], t[3]) || h,
      // pdfjs doesn't surface text color in getTextContent — we'd need
      // to walk the op list to capture per-run color. Defer to a v2 pass.
      color: null,
      hasEOL: !!item.hasEOL,
    };
  });
  console.log(`text items: ${textItems.length}`);

  // ---- Graphics ops ----
  const opList = await page.getOperatorList();
  const stack = [];
  let cur = ident();
  let curFill = null;
  let curStroke = null;

  // Pending path bboxes (in path-local coords) waiting for a paint op.
  // Each entry: { x0, y0, x1, y1, tm }
  let pendingPaths = [];

  const graphicsOps = [];
  let opIdx = 0;

  const flushPath = (mode) => {
    for (const p of pendingPaths) {
      // Transform the four corners of the path-local bbox into page space.
      const bbox = rectCornersTransformed(
        p.tm,
        p.x0,
        p.y0,
        p.x1 - p.x0,
        p.y1 - p.y0,
      );
      const yTop = flipY(bbox.y1);
      const yBot = flipY(bbox.y0);
      graphicsOps.push({
        id: `g${graphicsOps.length}`,
        op: "path",
        x: bbox.x0,
        y: yTop,
        w: bbox.x1 - bbox.x0,
        h: yBot - yTop,
        stroke: mode === "stroke" || mode === "fillStroke" ? curStroke : null,
        fill: mode === "fill" || mode === "fillStroke" ? curFill : null,
        opIdx,
      });
    }
    pendingPaths = [];
  };

  const fns = opList.fnArray;
  const args = opList.argsArray;
  for (opIdx = 0; opIdx < fns.length; opIdx++) {
    const fn = fns[opIdx];
    const a = args[opIdx];

    switch (fn) {
      case OPS.save:
        stack.push({ tm: cur.slice(), fill: curFill, stroke: curStroke });
        break;
      case OPS.restore: {
        const s = stack.pop();
        if (s) {
          cur = s.tm;
          curFill = s.fill;
          curStroke = s.stroke;
        }
        break;
      }
      case OPS.transform:
        // a = [a, b, c, d, e, f]
        cur = mul(cur, a);
        break;
      case OPS.setFillRGBColor:
        curFill = rgb(a);
        break;
      case OPS.setStrokeRGBColor:
        curStroke = rgb(a);
        break;
      case OPS.rectangle: {
        // Rare in this corpus, but handle it: append a path with this bbox.
        const [rx, ry, rw, rh] = a;
        pendingPaths.push({
          x0: rx, y0: ry, x1: rx + rw, y1: ry + rh, tm: cur.slice(),
        });
        break;
      }
      case OPS.constructPath: {
        // a = [subOps (Uint8Array), subArgs (Float32Array), minMax (Float32Array)]
        const minMax = a[2];
        if (minMax && minMax.length >= 4) {
          pendingPaths.push({
            x0: minMax[0],
            y0: minMax[1],
            x1: minMax[2],
            y1: minMax[3],
            tm: cur.slice(),
          });
        }
        break;
      }
      case OPS.fill:
      case OPS.eoFill:
        flushPath("fill");
        break;
      case OPS.stroke:
        flushPath("stroke");
        break;
      case OPS.fillStroke:
      case OPS.eoFillStroke:
        flushPath("fillStroke");
        break;
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        flushPath("fillStroke");
        break;
      case OPS.closeStroke:
        flushPath("stroke");
        break;
      case OPS.endPath:
        // discard pending rects (clipping/no-paint path)
        pendingRects = [];
        break;
      default:
        break;
    }
  }
  console.log(`graphics ops (rects): ${graphicsOps.length}`);

  // ---- Persist ----
  const raw = {
    source: path.basename(pdfPath),
    canvas: { width: canvasWidth, height: canvasHeight },
    coordSpace: "top-left",
    textItems,
    graphicsOps,
    images: [], // populated by a separate step (pdfimages -all)
  };
  const outPath = path.join(outDir, "raw.json");
  fs.writeFileSync(outPath, JSON.stringify(raw, null, 0));
  console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB)`);

  // Side-band: a tiny stats file for quick inspection
  const stats = {
    canvas: raw.canvas,
    textItemCount: textItems.length,
    graphicsOpCount: graphicsOps.length,
    sampleTextItems: textItems.slice(0, 5),
    sampleGraphicsOps: graphicsOps.slice(0, 5),
    fontsSeen: [...new Set(textItems.map((t) => t.fontName))].slice(0, 30),
    rectSizeHistogram: histogramRectSizes(graphicsOps),
  };
  fs.writeFileSync(path.join(outDir, "raw.stats.json"), JSON.stringify(stats, null, 2));
  console.log(`wrote raw.stats.json`);
}

function histogramRectSizes(ops) {
  const buckets = { tiny: 0, small: 0, mid: 0, large: 0, huge: 0 };
  for (const o of ops) {
    const m = Math.max(o.w, o.h);
    if (m < 4) buckets.tiny++;
    else if (m < 16) buckets.small++;
    else if (m < 100) buckets.mid++;
    else if (m < 800) buckets.large++;
    else buckets.huge++;
  }
  return buckets;
}

const [, , pdfArg, outArg] = process.argv;
if (!pdfArg || !outArg) {
  console.error("usage: node src/stage1-parse.js <input.pdf> <output-dir>");
  process.exit(2);
}
await parse(pdfArg, outArg);
