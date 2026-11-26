// GitHub stars: every star the repository gets on GitHub sends one more ship into the battle in the background
// (the star squadron). The number comes from GitHub's public API, without a login: asked at the start and then
// every two minutes while the page is visible. (GitHub allows 60 such requests an hour per visitor; the browser
// keeps the answer for a minute and then asks "changed?", and "unchanged" answers don't count.)

/** the repository whose stars count: owner/name on GitHub */
export const STAR_REPO = "Sieder2009/portfolio-weltraum";
export const STAR_REPO_URL = `https://github.com/${STAR_REPO}`;

const STORE = "weltraum.github-stars";
const EVERY = 2 * 60 * 1000;

/**
 * Calls `onCount(count, before)` with the number of stars: at once with the number from the last visit (then `before`
 * is the same), and again whenever GitHub reports a different one (`before`: the number until then, null on a first
 * visit).
 */
export function watchStars(onCount: (count: number, before: number | null) => void) {
  let known: number | null = null;
  try {
    const saved = localStorage.getItem(STORE);
    if (saved && /^\d+$/.test(saved)) known = Number(saved);
  } catch {
    /* storage blocked: start from nothing */
  }
  if (known !== null) onCount(known, known);

  let asking = false;
  const ask = async () => {
    if (asking || document.hidden) return;
    asking = true;
    try {
      const res = await fetch(`https://api.github.com/repos/${STAR_REPO}`, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) return;
      const count = Number((await res.json())?.stargazers_count);
      if (!Number.isInteger(count) || count < 0 || count === known) return;
      const before = known;
      known = count;
      try {
        localStorage.setItem(STORE, String(count));
      } catch {
        /* (only the next visit forgets it) */
      }
      onCount(count, before);
    } catch {
      /* offline, blocked or out of requests: the battle goes on with what it has */
    } finally {
      asking = false;
    }
  };
  void ask();
  window.setInterval(ask, EVERY);
  document.addEventListener("visibilitychange", () => void ask());
}
