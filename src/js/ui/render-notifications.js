/* The notification center: bell button + dropdown panel, fed by
 * features/favorites-notifications.js. Every word here is either the issuing
 * authority's own, or one of the fixed states below — the same discipline
 * ui/render-map-alerts.js already uses for the map's Alerts layer, applied
 * across every favorite instead of just the selected place. */
import { $, esc } from "../core/dom.js";
import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { fmtDateTime } from "../core/datetime.js";
import { flagsHtml, locName } from "../core/location.js";
import {
  notifications,
  notifStatus,
  coverage,
  unreadCount,
  sortedNotifications,
} from "../features/favorites-notifications.js";

const TONE_LABEL_KEY = {
  severe: "notifToneSevere",
  warning: "notifToneWarning",
  caution: "notifToneCaution",
  normal: "notifToneNormal",
  info: "notifToneInfo",
};

/* Which fixed state the panel is in right now. Kept strictly apart, the same
   way alerts-state.js keeps "unsupported"/"error"/"clear" apart: a favorite
   with no verified issuer must never look the same as one that was checked
   and found clear. */
function panelState() {
  if (!state.favorites.length) return "no-favorites";
  if (notifStatus === "offline") return "offline";
  if (notifStatus === "loading" && !notifications.length && coverage === null) return "loading";
  if (notifStatus === "error" && !notifications.length) return "error";
  if (coverage === "no-coverage" && !notifications.length) return "no-coverage";
  return notifications.length ? "active" : "empty";
}

const STATUS_KEY = {
  "no-favorites": "notifNoFavorites",
  offline: "notifOffline",
  loading: "notifLoading",
  error: "notifError",
  "no-coverage": "notifNoCoverage",
  empty: "notifEmpty",
};

function statusHtml(stateName) {
  return `<p class="notif-status" data-state="${stateName}">${esc(t(STATUS_KEY[stateName]))}</p>`;
}

function itemHtml(n) {
  const loc = state.favorites.find((f) => f.id === n.locId);
  return `
    <li class="notif-item" data-tone="${esc(n.tone)}">
      <button type="button" class="notif-item-btn" data-notif-open="${esc(n.key)}">
        <span class="notif-dot" data-tone="${esc(n.tone)}" aria-hidden="true"></span>
        <span class="notif-body">
          <span class="notif-event">
            ${esc(n.event)}
            ${n.read ? "" : `<span class="notif-unread" aria-hidden="true"></span>`}
          </span>
          <span class="notif-place">${loc ? flagsHtml(loc, "small") : ""}${esc(loc ? locName(loc) : n.locId)}</span>
          <span class="notif-meta">${esc(n.area)} · ${esc(t(TONE_LABEL_KEY[n.tone]))}</span>
          <span class="notif-time">${esc(t("notifSince"))} ${esc(fmtDateTime(n.starts))}</span>
          <span class="notif-source">${esc(t("mapAlertsSource").replace("{name}", n.source.name))}</span>
        </span>
      </button>
    </li>`;
}

/** One short sentence for the panel's live region — same contract as
    alertsAnnouncement() in ui/render-map-alerts.js. */
export function notificationsAnnouncement() {
  const s = panelState();
  if (s === "active") {
    return `${t("notifBellLabel")}: ${sortedNotifications()
      .map((n) => n.event)
      .join(", ")}`;
  }
  return t(STATUS_KEY[s] || "notifEmpty");
}

export function renderNotifications() {
  const btn = $("#notifBtn");
  const badge = $("#notifBadge");
  const body = $("#notifPanelBody");
  const clearBtn = $("#notifClearAll");
  const markReadBtn = $("#notifMarkRead");
  if (!btn || !badge || !body) return;

  const count = unreadCount();
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? "99+" : String(count);
  btn.setAttribute(
    "aria-label",
    count ? t("notifBtnUnread").replace("{n}", count) : t("notifBtnLabel"),
  );

  const s = panelState();
  clearBtn.hidden = notifications.length === 0;
  markReadBtn.hidden = count === 0;
  body.innerHTML =
    s === "active"
      ? `<ul class="notif-list">${sortedNotifications().map(itemHtml).join("")}</ul>`
      : statusHtml(s);
}
