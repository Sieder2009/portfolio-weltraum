import "@fontsource-variable/tektur/wdth.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "lenis/dist/lenis.css";
import "./styles/main.css";
import { App } from "./ui/app";
import { setLoaderFailed } from "./ui/components";

// Should the start go wrong, the loading screen says so (and offers to reload) instead of spinning forever.
const fail = (err: unknown) => {
  console.error("Die Seite konnte nicht gestartet werden.", err);
  setLoaderFailed(document.getElementById("loader"));
};

try {
  new App().start().catch(fail);
} catch (err) {
  fail(err);
}
