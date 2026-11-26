// Points inside the letters of the hero heading, for the intro where the name gathers out of the stars.
// The letters are drawn into a canvas with the page's own font at the exact places the page shows them,
// so the particles end up where the real text then appears.

export interface NameSample {
  /** x, y pairs in CSS pixels of the viewport */
  points: Float32Array;
  rect: { left: number; top: number; width: number; height: number };
  /** a good particle size for this font size (CSS pixels) */
  dot: number;
}

export async function sampleHeading(title: HTMLElement): Promise<NameSample | null> {
  const letters = [...title.querySelectorAll<HTMLElement>(".split .c")];
  if (!letters.length) return null;
  const cs = getComputedStyle(letters[0]);
  const fontSize = parseFloat(cs.fontSize) || 48;
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  // (the letters as the page shows them: the heading is set in capitals by CSS)
  const shown = (s: string) => (cs.textTransform === "uppercase" ? s.toUpperCase() : cs.textTransform === "lowercase" ? s.toLowerCase() : s);
  try {
    await document.fonts.load(font, title.textContent ?? "");
  } catch {
    /* draws with what is there */
  }

  // Where each letter sits: its left edge and its baseline (a zero-size probe inside the letter).
  const glyphs = letters.map((el) => {
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    el.appendChild(probe);
    const box = el.getBoundingClientRect();
    const baseline = probe.getBoundingClientRect().top;
    probe.remove();
    return { ch: shown(el.textContent ?? ""), x: box.left, baseline };
  });
  const box = title.getBoundingClientRect();
  if (box.width < 4 || box.height < 4) return null;

  const pad = Math.ceil(fontSize * 0.3);
  const w = Math.ceil(box.width + pad * 2);
  const h = Math.ceil(box.height + pad * 2);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.font = font;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const g of glyphs) ctx.fillText(g.ch, g.x - box.left + pad, g.baseline - box.top + pad);
  const data = ctx.getImageData(0, 0, w, h).data;

  // A jittered grid: loose enough to look like stars, dense enough to read as letters (about a thousand points).
  const step = Math.min(3.6, Math.max(1.8, fontSize / 27));
  const out: number[] = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const jx = Math.min(w - 1, x + Math.random() * step);
      const jy = Math.min(h - 1, y + Math.random() * step);
      if (data[((jy | 0) * w + (jx | 0)) * 4 + 3] > 140) out.push(jx + box.left - pad, jy + box.top - pad);
    }
  }
  return {
    points: Float32Array.from(out),
    rect: { left: box.left, top: box.top, width: box.width, height: box.height },
    dot: step * 1.15,
  };
}
