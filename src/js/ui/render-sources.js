/* The "Data sources" card on the About page, drawn from data/attributions.js
 * so the list of providers is written once. Same markup and classes as the
 * rows it replaced; the blurbs carry data-i18n, so the usual language switch
 * translates them. */
import { $, esc } from "../core/dom.js";
import { DATA_PROVIDERS } from "../data/attributions.js";

const EXTERNAL_ARROW = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>`;

export function sourceRowHtml(provider) {
  return `<div class="src-row" data-provider="${esc(provider.id)}">
    <span class="src-logo tone-${esc(provider.tone)}">${esc(provider.logo)}</span>
    <span class="src-body"><b>${esc(provider.name)}</b><span data-i18n="${esc(provider.blurb)}"></span></span>
    <a class="link-chip" href="${esc(provider.url)}" target="_blank" rel="noopener">${esc(provider.host)} ${EXTERNAL_ARROW}</a>
  </div>`;
}

export function dataSourcesHtml(providers = DATA_PROVIDERS) {
  return providers.map(sourceRowHtml).join("");
}

/* Called once at startup, before the static translations are applied. */
export function renderDataSources() {
  const list = $("#srcList");
  if (list) list.innerHTML = dataSourcesHtml();
}
