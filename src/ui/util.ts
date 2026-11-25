const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const esc = (s: string | number) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export const pad2 = (n: number) => String(n).padStart(2, "0");

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
export const coarsePointer = window.matchMedia("(pointer: coarse)");

/**
 * Text split into per-letter masks for the reveal animation, grouped by word so lines only break between
 * words. Screen readers get the plain text.
 */
export function chars(text: string, start = 0) {
  let i = start;
  const words = text.split(" ").map((word) => {
    const letters = Array.from(word)
      .map((c) => `<span class="cm"><span class="c" style="--i:${i++}">${esc(c)}</span></span>`)
      .join("");
    return `<span class="w">${letters}</span>`;
  });
  return `<span class="sr-only">${esc(text)}</span><span class="split" aria-hidden="true">${words.join(" ")}</span>`;
}

/** Text that rolls up to a copy of itself on hover. */
export const roll = (text: string) => `<span class="roll"><span class="roll-i" data-t="${esc(text)}">${esc(text)}</span></span>`;

/** Fades in every [data-r] child of `root`, one after another. */
export function reveal(root: HTMLElement) {
  root.classList.remove("is-in");
  root.querySelectorAll<HTMLElement>("[data-r]").forEach((el, n) => el.style.setProperty("--d", String(Math.min(n, 12))));
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("is-in")));
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
export const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

let toastTimer = 0;
export function toast(message: string) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("is-on");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("is-on"), 2200);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** "https://github.com/Sieder2009/mc" → "github.com/Sieder2009/mc" */
export const prettyUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export const ICON = {
  arrowRight: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  arrowLeft: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H6M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  external: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16 8M9 8h7v7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  soundOn: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l5 4V6L7 10H4Z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  soundOff: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l5 4V6L7 10H4Z" fill="currentColor"/><path d="M16 10l4 4M20 10l-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 15V7a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  github: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>`,
  expand: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};
