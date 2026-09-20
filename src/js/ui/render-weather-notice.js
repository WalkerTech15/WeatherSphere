/* "Showing demo weather" — the persistent counterpart of the one-minute toast.
 *
 * When live weather can't be loaded the app falls back to generated sample
 * data (services/weather-api.js demoWeather). Until now that was signalled by
 * a toast that vanishes in seconds and a small badge in the hero, so a visitor
 * could easily read invented numbers as a real forecast. This keeps a notice
 * on every view that shows those numbers for as long as they are on screen,
 * says plainly what it means, and offers the one useful action: try again.
 *
 * The retry goes out on the app bus rather than calling selectLocation
 * directly — features/location.js already imports this file (through
 * renderAllWeather), so importing it back would close a cycle. */
import { state } from "../core/state.js";
import { $$ } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { emit } from "../core/app-bus.js";
import { noticeHtml } from "./notice.js";

/* The regions are live regions. Rewriting them on every repaint (units,
   language and the "updated N min ago" tick all repaint) would re-announce an
   unchanged message each time, so nothing is written unless what would be
   shown has actually changed. */
let lastSignature = null;
let retrying = false;

const slots = () => $$(".wx-notice");

function paint(html) {
  slots().forEach((slot) => {
    slot.innerHTML = html;
  });
}

export function renderWeatherNotice() {
  /* A retry that has come back — recovered or failed again — always repaints:
     the button is sitting disabled on "Retrying…" and must be reset or removed. */
  if (retrying) {
    retrying = false;
    lastSignature = null;
  }
  const signature = state.isDemo ? `demo|${state.lang}` : "live";
  if (signature === lastSignature) return;
  lastSignature = signature;
  paint(
    state.isDemo
      ? noticeHtml({
          tone: "warn",
          icon: "cloud",
          title: t("wxNoticeTitle"),
          text: t("wxNoticeText"),
          action: { id: "retry-weather", label: t("wxNoticeRetry") },
        })
      : "",
  );
}

/* A brand-new selection starts its own load, so a notice about the PREVIOUS
   place's fallback must not hang over it. A retry is the exception: it is the
   same place, and the notice should stay put, showing that it is retrying. */
export function clearWeatherNotice() {
  if (retrying) return;
  lastSignature = null;
  paint("");
}

export function bindWeatherNotice() {
  slots().forEach((slot) => {
    slot.addEventListener("click", (event) => {
      if (!event.target.closest('[data-notice-action="retry-weather"]')) return;
      if (!state.loc) return;
      retrying = true;
      $$('[data-notice-action="retry-weather"]').forEach((button) => {
        button.disabled = true;
        button.textContent = t("wxNoticeRetrying");
      });
      emit("weather:retry");
    });
  });
}
