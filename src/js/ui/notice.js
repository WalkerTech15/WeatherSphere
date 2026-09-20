/* One inline notice pattern for "something is degraded, here is what it means".
 *
 * It deliberately IS the advisory component (ui/render-advisory.js,
 * styles/views/home.css): same edge, icon tile, title and description, same
 * severity tokens. A second banner look would make the page read as two
 * competing alert systems. Tone maps onto the advisory severities that are
 * not alarming — `info` is the low (sky) tone, `warn` the moderate (amber) one.
 * There is intentionally no red tone: red is reserved for real weather hazards.
 *
 * Pure markup. The caller owns the live region the notice lands in (a region
 * that already exists in the page announces reliably; one inserted together
 * with its content often does not) and wires the optional action button.
 * Every string is escaped here, so callers pass plain text. */
import { esc } from "../core/dom.js";

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const ICONS = {
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
  warn: svg('<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>'),
  cloud: svg(
    '<path d="M3 15a4 4 0 0 1 4-4h1a5 5 0 0 1 9-1 4 4 0 0 1 1 8H7a4 4 0 0 1-4-3z"/><path d="m4 4 16 16"/>',
  ),
};

const TONE_CLASS = { info: "adv--low", warn: "adv--moderate" };

export function noticeHtml({ tone = "info", icon = tone, title, text, action, role } = {}) {
  const toneClass = TONE_CLASS[tone] || TONE_CLASS.info;
  const button = action
    ? `<button class="notice-action" type="button" data-notice-action="${esc(action.id)}">${esc(action.label)}</button>`
    : "";
  return `
    <div class="advisory is-primary ${toneClass} notice"${role ? ` role="${esc(role)}"` : ""}>
      <span class="adv-icon" aria-hidden="true">${ICONS[icon] || ICONS.info}</span>
      <div class="adv-body">
        <p class="adv-title">${esc(title)}</p>
        <p class="adv-desc">${esc(text)}</p>
        ${button}
      </div>
    </div>`;
}
