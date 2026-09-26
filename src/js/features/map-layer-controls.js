/* The layer switcher above the map: the radio group's keyboard behaviour and
   the edge fades of its scrolling rows. */
import { $, $$ } from "../core/dom.js";
import { computeFadeVisibility } from "../core/carousel-fade.js";
import { setMapLayer } from "./map-layers.js";

/* Edge-fade visibility for the ≤820px horizontally-scrolling layer rows —
   same computeFadeVisibility() the forecast day-carousel uses, so there's
   one shared implementation of "is there more content past this edge?"
   rather than a second one reinvented here. Each row (Satellite…Clouds,
   Pressure…Alerts) scrolls independently, so each gets its own fade pair.
   On desktop neither row overflows, so this is a harmless no-op (every
   fade stays hidden). */
export function updateMapLayerFades() {
  $$(".map-layer-row").forEach((row) => {
    const { left, right } = computeFadeVisibility({
      scrollLeft: row.scrollLeft,
      scrollWidth: row.scrollWidth,
      clientWidth: row.clientWidth,
    });
    row.querySelector(".map-layer-fade-left")?.classList.toggle("is-visible", left);
    row.querySelector(".map-layer-fade-right")?.classList.toggle("is-visible", right);
  });
}

export function bindMapLayerControls() {
  const layers = $$(".map-layer");
  layers.forEach((button) =>
    button.addEventListener("click", () => setMapLayer(button.dataset.mapLayer)),
  );
  /* The switcher is a role="radiogroup" of role="radio" buttons, which tells
     assistive tech to expect the radio pattern: ONE Tab stop for the group,
     arrow keys to move between layers and select as they go. Every layer
     used to be its own Tab stop and the arrows did nothing — the one radio
     group in the app that didn't match the forecast timeline beside it
     (ui/render-map-weather.js's bindTimeline()). Disabled layers are skipped. */
  const usable = () => layers.filter((button) => !button.disabled);
  const checked = usable().find((b) => b.getAttribute("aria-checked") === "true") || usable()[0];
  usable().forEach((button) => (button.tabIndex = button === checked ? 0 : -1));
  $(".map-layer-switcher")?.addEventListener("keydown", (event) => {
    const options = usable();
    const index = options.indexOf(document.activeElement);
    if (index === -1) return;
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % options.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    if (next === null) return;
    event.preventDefault();
    options.forEach((button) => (button.tabIndex = -1));
    options[next].tabIndex = 0;
    options[next].focus();
    setMapLayer(options[next].dataset.mapLayer);
  });
  $$(".map-layer-row").forEach((row) =>
    row.addEventListener("scroll", updateMapLayerFades, { passive: true }),
  );
  updateMapLayerFades();
}
