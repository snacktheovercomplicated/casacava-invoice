/**
 * Turning an invoice into a PDF.
 *
 * The page is laid out as ordinary HTML, the browser draws it, and the drawing
 * is placed into a PDF. That is deliberate: the browser is the one thing that
 * definitely shapes and joins Arabic correctly, including inside the Android
 * WebView. Drawing the text into the PDF glyph by glyph would mean carrying an
 * Arabic shaping engine and being responsible for every ligature, which is
 * exactly where this kind of thing goes quietly wrong.
 *
 * The cost is that the text in the PDF is a picture rather than selectable
 * text. For a customer copy of an Egyptian invoice that costs nothing: the tax
 * authority receives structured data in phase 2, not this file.
 *
 * The font is embedded (see assets.ts) rather than taken from the system, so
 * the same glyphs are used on a phone, a laptop and a browser.
 */
import * as html2canvasModule from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * html2canvas 1.4.1 predates ES modules and ships a CommonJS default export,
 * which Deno and Vite disagree about how to unwrap. Resolving it once here
 * keeps the interop in one place instead of at every call site.
 */
type Html2Canvas = (
  element: HTMLElement,
  options?: Record<string, unknown>,
) => Promise<HTMLCanvasElement>;

const html2canvas =
  ((html2canvasModule as unknown as { default?: Html2Canvas }).default ??
    (html2canvasModule as unknown as Html2Canvas)) as Html2Canvas;
import type { Invoice, InvoiceLine, Lang, Settings } from "../api/types.ts";
import {
  CONTINUATION_CSS,
  PAPER_CSS,
  renderContinuationHtml,
  renderPaperHtml,
} from "./paper.ts";

/** A4 with a 12mm margin, in millimetres. */
const PAGE = { width: 210, height: 297, margin: 12 };
/** Rendering width in CSS pixels. Matches the proportions of the old layout. */
const PAPER_WIDTH_PX = 720;

/** Height reserved at the top of every page after the first, in millimetres. */
const CONTINUATION_MM = 9;

/**
 * If the last page would be emptier than this, the whole document is shrunk
 * very slightly to fit on one page fewer — a near-empty final page carrying
 * one line of notes looks like a mistake.
 */
const NEARLY_EMPTY = 0.25;

/** The most the document may be shrunk to save a page. Beyond this it shows. */
const MAX_SHRINK = 1.08;
/** 3x gives text that stays crisp when the PDF is printed or zoomed. */
const SCALE = 3;

/**
 * A drawing is held in memory as four bytes per pixel while the PDF is built.
 * At 3x a one-page invoice is about 7 megapixels, which is nothing; a very
 * long one could be far more, and an Android phone will simply fail rather
 * than warn. Above this many megapixels the drawing is taken at a lower
 * magnification: a slightly softer PDF is better than no PDF.
 */
const MAX_MEGAPIXELS = 24;

function scaleFor(paper: HTMLElement): number {
  const rect = paper.getBoundingClientRect();
  for (const scale of [SCALE, 2, 1.5, 1]) {
    const megapixels = (rect.width * scale * rect.height * scale) / 1_000_000;
    if (megapixels <= MAX_MEGAPIXELS) return scale;
  }
  return 1;
}

export interface PdfInput {
  invoice: Invoice;
  lines: InvoiceLine[];
  settings: Partial<Settings>;
  language?: Lang;
}

function mountPaper(input: PdfInput): { stage: HTMLElement; paper: HTMLElement } {
  const lang = input.language ?? input.invoice.document_language;

  const stage = document.createElement("div");
  // Off to the side rather than hidden: html2canvas can only draw something
  // the browser has actually laid out.
  stage.setAttribute(
    "style",
    "position:fixed; top:0; inset-inline-start:-20000px; width:" +
      PAPER_WIDTH_PX + "px; background:#fff; z-index:-1;",
  );

  const style = document.createElement("style");
  style.textContent = PAPER_CSS;

  const paper = document.createElement("div");
  paper.className = "paper";
  paper.dir = lang === "ar" ? "rtl" : "ltr";
  paper.lang = lang;
  paper.style.width = `${PAPER_WIDTH_PX}px`;
  paper.innerHTML = renderPaperHtml(input);

  stage.append(style, paper);
  document.body.appendChild(stage);
  return { stage, paper };
}

/**
 * The font must be in place before the drawing is taken. If it is not, Arabic
 * falls back to whatever the device happens to have, and the letters may not
 * join — the exact failure this whole approach exists to avoid.
 */
async function waitForPaper(paper: HTMLElement): Promise<void> {
  if (document.fonts) {
    await Promise.all([
      document.fonts.load('400 13px "CasaCava Arabic"'),
      document.fonts.load('700 13px "CasaCava Arabic"'),
    ]);
    await document.fonts.ready;
  }
  await Promise.all(
    [...paper.querySelectorAll("img")].map((image) =>
      image.complete ? Promise.resolve() : new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      })
    ),
  );
  // One frame, so layout has definitely settled before the drawing is taken.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

/**
 * Where a page is allowed to end: the bottom of a table row, of a totals line,
 * or of a text block. Cutting anywhere else would slice through a row, and
 * cutting without these would let the totals fall off the bottom of a long
 * invoice, which is the thing most worth getting right.
 */
export interface PdfReport {
  pageCount: number;
  /** True when the document was shrunk slightly to save a nearly empty page. */
  shrunk: boolean;
  /** How full the last page is, 0 to 1. A tiny value means a wasted page. */
  lastPageFill: number;
  /** Where each page ended, in drawing pixels. */
  cuts: number[];
  /** Blocks that must never be split across a page. */
  blocks: Array<{ name: string; top: number; bottom: number }>;
  canvasHeight: number;
  scale: number;
}

/** Blocks a page break must never fall inside. */
function atomicBlocks(
  paper: HTMLElement,
): Array<{ name: string; top: number; bottom: number }> {
  const top = paper.getBoundingClientRect().top;
  return [".p-totals", ".p-words"].flatMap((selector) =>
    [...paper.querySelectorAll(selector)].map((element) => {
      const rect = element.getBoundingClientRect();
      return { name: selector, top: rect.top - top, bottom: rect.bottom - top };
    })
  );
}

function breakPointsCss(paper: HTMLElement): number[] {
  const top = paper.getBoundingClientRect().top;
  // The totals block and the amount in words are listed whole, not row by
  // row: a page may end before them or after them, never through the middle
  // of them. Splitting the totals across two pages is exactly the thing that
  // makes a long invoice look like it lost its total.
  return [...paper.querySelectorAll(
    ".p-items tbody tr, .p-totals, .p-words, .p-notes, .p-terms, .p-stamp",
  )].map((element) => element.getBoundingClientRect().bottom - top);
}

export async function generateInvoicePdf(input: PdfInput): Promise<Blob> {
  return (await renderInvoicePdf(input)).blob;
}

/**
 * The same thing, but it also reports where the pages were cut. The automated
 * check uses this to prove that a long invoice never has its totals sliced in
 * half by a page break.
 */
export async function renderInvoicePdf(
  input: PdfInput,
): Promise<{ blob: Blob; report: PdfReport }> {
  const { stage, paper } = mountPaper(input);
  try {
    await waitForPaper(paper);
    const breaksCss = breakPointsCss(paper);
    const paperHeightCss = paper.getBoundingClientRect().height;
    const scale = scaleFor(paper);
    const blocksCss = atomicBlocks(paper);

    const canvas = await html2canvas(paper, {
      scale,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
      windowWidth: PAPER_WIDTH_PX,
      scrollX: 0,
      scrollY: 0,
    });
    if (!canvas.width || !canvas.height) throw new Error("the page came out empty");

    // Map the break positions onto the drawing using the ratio the drawing
    // actually came out at, rather than assuming it is exactly SCALE. A small
    // rounding difference here is what slices a block in half.
    const drawnRatio = canvas.height / paperHeightCss;
    const breaks = breaksCss.map((value) => Math.ceil(value * drawnRatio));

    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const printWidth = PAGE.width - 2 * PAGE.margin;
    const printHeight = PAGE.height - 2 * PAGE.margin;

    /**
     * Work out where each page starts and ends, for a given magnification.
     * Pages after the first are shorter, because they carry the continuation
     * header. Returned as [start, end] pairs in drawing pixels.
     */
    const sliceInto = (pixelsPerMm: number): Array<[number, number]> => {
      const slices: Array<[number, number]> = [];
      let y = 0;
      while (y < canvas.height && slices.length < 200) {
        const usableMm = slices.length === 0 ? printHeight : printHeight - CONTINUATION_MM;
        const pageHeightPx = Math.floor(usableMm * pixelsPerMm);
        if (pageHeightPx < 1) break;

        let height = Math.min(pageHeightPx, canvas.height - y);
        if (y + height < canvas.height) {
          const limit = y + height;
          let cut = 0;
          for (const point of breaks) {
            if (point > y + pageHeightPx * 0.25 && point <= limit && point > cut) cut = point;
          }
          if (cut) height = Math.round(cut - y);
        }
        if (height < 1) break;
        slices.push([y, y + height]);
        y += height;
      }
      return slices;
    };

    const naturalPixelsPerMm = canvas.width / printWidth;
    let pixelsPerMm = naturalPixelsPerMm;
    let slices = sliceInto(pixelsPerMm);

    // A nearly empty last page: try shrinking a little to be rid of it.
    if (slices.length >= 2) {
      const [start, end] = slices[slices.length - 1];
      const capacity = (printHeight - CONTINUATION_MM) * pixelsPerMm;
      if ((end - start) / capacity < NEARLY_EMPTY) {
        for (const factor of [1.02, 1.04, 1.06, MAX_SHRINK]) {
          const tighter = sliceInto(naturalPixelsPerMm * factor);
          if (tighter.length < slices.length) {
            pixelsPerMm = naturalPixelsPerMm * factor;
            slices = tighter;
            break;
          }
        }
      }
    }

    const drawnWidth = canvas.width / pixelsPerMm;
    const leftMargin = PAGE.margin + (printWidth - drawnWidth) / 2;
    const cuts: number[] = [];

    for (const [index, [start, end]] of slices.entries()) {
      if (index > 0) doc.addPage();

      let top = PAGE.margin;
      if (index > 0) {
        // Page two onwards names the document and says where it sits in the set.
        const strip = await drawContinuation(
          input,
          index + 1,
          slices.length,
          drawnWidth,
        );
        if (strip) {
          doc.addImage(strip.dataUrl, "PNG", leftMargin, top, drawnWidth, strip.heightMm);
          top += strip.heightMm;
        }
      }

      const height = end - start;
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = height;
      const context = slice.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, slice.width, slice.height);
      context.drawImage(canvas, 0, start, canvas.width, height, 0, 0, canvas.width, height);

      doc.addImage(
        slice.toDataURL("image/jpeg", 0.9),
        "JPEG",
        leftMargin,
        top,
        drawnWidth,
        height / pixelsPerMm,
      );
      cuts.push(end);
    }

    const pageNumber = slices.length;

    return {
      blob: doc.output("blob"),
      report: {
        pageCount: pageNumber,
        shrunk: pixelsPerMm > naturalPixelsPerMm,
        lastPageFill: (() => {
          const [start, end] = slices[slices.length - 1];
          const usableMm = slices.length === 1 ? printHeight : printHeight - CONTINUATION_MM;
          return (end - start) / (usableMm * pixelsPerMm);
        })(),
        cuts,
        blocks: blocksCss.map((block) => ({
          name: block.name,
          top: block.top * drawnRatio,
          bottom: block.bottom * drawnRatio,
        })),
        canvasHeight: canvas.height,
        scale,
      },
    };
  } finally {
    stage.remove();
  }
}

/**
 * A small window into the PDF machinery, attached once this module is loaded
 * (which happens the first time someone presses PDF).
 *
 * It exists so the automated check in tools/ui_check.ts can measure the real
 * thing — that Arabic letters join in the embedded font, that numbers keep
 * their order inside Arabic text, that the brand colour is what it should be —
 * rather than trusting that they do. It is also the quickest way to look at a
 * rendering problem from a browser console.
 */
(globalThis as Record<string, unknown>).__casacavaPdf = {
  renderPaperHtml,
  renderContinuationHtml,
  PAPER_CSS,
  CONTINUATION_CSS,
  renderInvoicePdf,
};

/** A filename a person can find again: the invoice number, or the draft id. */
export function pdfFilename(invoice: Invoice): string {
  const base = invoice.invoice_number ?? `draft-${invoice.id.slice(0, 8)}`;
  return `${base.replace(/[^\w.-]+/g, "_")}.pdf`;
}

/**
 * Hand the file to the person. In a browser this is a download; inside the
 * Android build the host app takes it, because a WebView cannot write to
 * Downloads by itself.
 */
export async function saveInvoicePdf(input: PdfInput): Promise<void> {
  const { blob } = await renderInvoicePdf(input);
  const name = pdfFilename(input.invoice);

  const bridge = (globalThis as unknown as {
    AndroidBridge?: { saveFile(name: string, type: string, base64: string): string };
  }).AndroidBridge;

  if (bridge?.saveFile) {
    const buffer = await blob.arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    bridge.saveFile(name, "application/pdf", btoa(binary));
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Draw the strip that sits at the top of pages two and beyond.
 *
 * It is drawn by the browser like the rest of the document, rather than
 * written into the PDF as text, for the same reason: it contains Arabic, and
 * the browser is what joins Arabic correctly.
 */
async function drawContinuation(
  input: PdfInput,
  pageNumber: number,
  pageCount: number,
  widthMm: number,
): Promise<{ dataUrl: string; heightMm: number } | null> {
  const lang = input.language ?? input.invoice.document_language;

  const stage = document.createElement("div");
  stage.setAttribute(
    "style",
    "position:fixed; top:0; inset-inline-start:-20000px; width:" +
      PAPER_WIDTH_PX + "px; background:#fff; z-index:-1;",
  );
  const style = document.createElement("style");
  style.textContent = PAPER_CSS + CONTINUATION_CSS;
  const strip = document.createElement("div");
  strip.dir = lang === "ar" ? "rtl" : "ltr";
  strip.lang = lang;
  strip.style.width = `${PAPER_WIDTH_PX}px`;
  strip.innerHTML = renderContinuationHtml({ ...input, pageNumber, pageCount });
  stage.append(style, strip);
  document.body.appendChild(stage);

  try {
    await waitForPaper(strip);
    const canvas = await html2canvas(strip, {
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
      windowWidth: PAPER_WIDTH_PX,
      scrollX: 0,
      scrollY: 0,
    });
    if (!canvas.width || !canvas.height) return null;
    return {
      dataUrl: canvas.toDataURL("image/png"),
      heightMm: (canvas.height / canvas.width) * widthMm,
    };
  } finally {
    stage.remove();
  }
}
