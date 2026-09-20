/* Location search: instant curated matches, then debounced (300ms) MapTiler
   global autocomplete with request cancellation, keyboard navigation, and a
   keyless Open-Meteo fallback if MapTiler is unavailable.

   Focusing the field with nothing typed opens a short menu of where you might
   want to go (recent searches, favourites, popular places — see
   search-suggestions.js), so the field doubles as a command menu. While a
   remote lookup is in flight, and if every lookup fails, a status line under
   the list says so and offers a retry, instead of the panel silently staying
   shut or showing stale rows. */
import { state } from "../core/state.js";
import { $, $$, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { findLocations, normalize, LOCATIONS } from "../data/locations.js";
import { maptilerGeocode, geocode } from "../services/geocoding-api.js";
import { locVisual } from "../services/photo-api.js";
import { locName, locRegion, locCountry, locKindLabel, flagsHtml } from "../core/location.js";
import { selectLocation } from "./location.js";
import { recentToLocation } from "./recent-locations.js";
import { buildSuggestions } from "./search-suggestions.js";
import { switchView } from "../ui/navigation.js";

let searchIndex = -1;
let searchResults = [];
let geoTimer = null;
let searchAbort = null; // cancels the in-flight geocoding request when the query changes

/* Merge curated hits (rich landmarks/facts) on top of remote MapTiler results,
   then collapse duplicates by name + country + region so a place that MapTiler
   returns several times (e.g. Tarbes as municipality + place + POI) shows once,
   while genuine same-name places in different regions (Paris FR/TX/ON) stay. */
function dedupKey(l) {
  return `${normalize(l.name.en)}|${l.cc}|${normalize(l.region.en || "")}`;
}
function mergeResults(curated, remote) {
  const seen = new Set();
  const out = [];
  for (const l of curated.concat(remote)) {
    const k = dedupKey(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out.slice(0, 8);
}

function openSearchPanel() {
  $("#searchPanel").hidden = false;
  $("#searchCombo").setAttribute("aria-expanded", "true");
}
function closeSearchPanel() {
  $("#searchPanel").hidden = true;
  $("#searchCombo").setAttribute("aria-expanded", "false");
  $("#searchInput").removeAttribute("aria-activedescendant");
  searchIndex = -1;
  setStatus("");
  announce("");
}

/* The status line under the list: "" clears it, "loading" is a lookup in
   flight, "error" is every lookup failed with nothing to show, "partial" is
   the online lookups failed but built-in places are still listed. */
function setStatus(kind) {
  const el = $("#searchStatus");
  if (!kind) {
    el.replaceChildren();
    return;
  }
  const text = document.createElement("span");
  if (kind === "loading") {
    const spinner = document.createElement("span");
    spinner.className = "map-panel-spinner";
    spinner.setAttribute("aria-hidden", "true");
    text.textContent = t("searchSearching");
    el.replaceChildren(spinner, text);
    return;
  }
  text.textContent = t(kind === "partial" ? "searchErrorPartial" : "searchError");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "notice-action search-retry";
  retry.textContent = t("searchRetry");
  el.replaceChildren(text, retry);
}

/* The listbox announces an option as it is arrowed to, but nothing says the
   list itself changed. A separate, visually hidden live region says how many
   suggestions there are (or that there are none). */
function announce(message) {
  const el = $("#searchAnnounce");
  if (el) el.textContent = message;
}

/* ── Small-phone search (≤520px, see components/forms.css) ──
   Reuses this exact #searchWrap/#searchInput/#searchResults — opening just
   repositions the same combobox as a full-width overlay instead of building
   a second, independent search UI. */
function isMobileSearchOpen() {
  return $("#searchWrap").classList.contains("is-mobile-open");
}
function openMobileSearch() {
  $("#searchWrap").classList.add("is-mobile-open");
  $("#mobileSearchBtn")?.setAttribute("aria-expanded", "true");
  $("#searchInput").focus();
}

/* Every action that means "start searching" goes through this function.
   On small phones the input is hidden until the mobile overlay opens, while
   larger layouts can focus the always-visible inline input directly. */
export function focusSearch() {
  if (window.matchMedia("(max-width: 520px)").matches) openMobileSearch();
  else $("#searchInput").focus();
}

export function closeMobileSearch({ focusTrigger = false } = {}) {
  closeSearchPanel(); /* always: the desktop dropdown can be open with no mobile overlay involved */
  const wasOpen = isMobileSearchOpen();
  if (wasOpen) {
    $("#searchWrap").classList.remove("is-mobile-open");
    $("#mobileSearchBtn")?.setAttribute("aria-expanded", "false");
  }
  /* only steal focus for a close this function actually performed — callers
     share this Escape path with the sidebar/language/theme menus, and the
     button being visible at this width doesn't mean IT was what was open */
  if (focusTrigger && wasOpen) $("#mobileSearchBtn")?.focus();
}

function optionHtml(loc, i) {
  return `
    <li role="option" id="sr-${i}" aria-selected="${i === searchIndex}">
      <button class="search-item" data-i="${i}" tabindex="-1">
        <span class="si-visual" aria-hidden="true">${locVisual(loc)}</span>
        <span>
          <span class="si-name">${esc(locName(loc))} ${loc.kind !== "country" ? flagsHtml(loc, "small") : ""}</span><br>
          <span class="si-sub">${
            loc.kind === "country"
              ? esc(locRegion(loc))
              : `${esc(locRegion(loc))}${locRegion(loc) ? ", " : ""}${esc(locCountry(loc))}${loc.landmark ? ` · ${esc(loc.landmark[state.lang] || loc.landmark.en)}` : ""}`
          }</span>
        </span>
        <span class="si-kind">${locKindLabel(loc)}</span>
      </button>
    </li>`;
}

function bindOptionClicks(ul) {
  $$(".search-item", ul).forEach((btn) => {
    btn.addEventListener("click", () => pickSearchResult(+btn.dataset.i));
  });
}

function renderSearchResults(list) {
  searchResults = list;
  searchIndex = -1;
  $("#searchInput").removeAttribute(
    "aria-activedescendant",
  ); /* it pointed into the list just replaced */
  const ul = $("#searchResults");
  if (!list.length) {
    ul.innerHTML = `<li class="search-empty" role="presentation">${t("searchNoResult")}</li>`;
    announce(t("searchNoResult"));
    openSearchPanel();
    return;
  }
  ul.innerHTML = list.map(optionHtml).join("");
  bindOptionClicks(ul);
  announce(t("searchCount").replace("{n}", list.length));
  openSearchPanel();
}

/* The "popular" list is its own short, mixed one — cities, a region and a
   country — rather than the Explore carousel's order, which opens with five
   US/Canadian places and never reaches a country. Curated data has no oceans
   or seas; those are found by typing (MapTiler) or by tapping the map. */
const POPULAR_IDS = ["paris", "tokyo", "newyork", "texas", "france"];

const SUGGESTION_LABELS = {
  recent: "searchRecent",
  favorites: "searchFavorites",
  popular: "searchPopular",
};

/* Nothing typed: offer somewhere to go. Recents are opt-in and stored in a
   minimal shape, so they are expanded back into full locations here; a stored
   entry that no longer expands is dropped rather than shown broken. */
function showSuggestions() {
  const sections = buildSuggestions({
    recents: state.saveRecents ? state.recents.map(recentToLocation).filter(Boolean) : [],
    favorites: state.favorites,
    popular: POPULAR_IDS.map((id) => LOCATIONS.find((loc) => loc.id === id)).filter(Boolean),
  });
  if (!sections.length) {
    closeSearchPanel();
    return;
  }
  searchResults = sections.flatMap((section) => section.items);
  searchIndex = -1;
  $("#searchInput").removeAttribute("aria-activedescendant");
  let n = 0;
  /* a group inside the listbox, so a screen reader hears "Recent, group"
     before the options it holds, and the options keep one running index for
     the arrow keys */
  $("#searchResults").innerHTML = sections
    .map(
      (section) => `
    <li role="presentation" class="search-group">
      <ul role="group" aria-labelledby="sg-${section.id}">
        <li role="presentation" class="search-group-label" id="sg-${section.id}">${t(SUGGESTION_LABELS[section.id])}</li>
        ${section.items.map((loc) => optionHtml(loc, n++)).join("")}
      </ul>
    </li>`,
    )
    .join("");
  bindOptionClicks($("#searchResults"));
  setStatus("");
  announce(t("searchCount").replace("{n}", searchResults.length));
  openSearchPanel();
}

function pickSearchResult(i) {
  const loc = searchResults[i];
  if (!loc) return;
  /* full place name in the input so the chosen result is unambiguous */
  $("#searchInput").value =
    loc.fullName || [locName(loc), locRegion(loc), locCountry(loc)].filter(Boolean).join(", ");
  closeMobileSearch();
  selectLocation(loc); /* fitBounds/flyTo + marker/popup + weather handled downstream */
  switchView("home");
}

/* Autocomplete: instant curated hits, then debounced (300 ms) MapTiler global
   search. Stale requests are aborted; results are guarded against out-of-order
   arrival by re-checking the input value before rendering. */
function onSearchInput() {
  const q = $("#searchInput").value.trim();
  clearTimeout(geoTimer);
  if (searchAbort) {
    searchAbort.abort();
    searchAbort = null;
  }
  if (!q) {
    /* cleared the field: back to the where-to-next menu rather than a shut panel */
    setStatus("");
    showSuggestions();
    return;
  }

  const curated = findLocations(q, state.lang);
  if (curated.length) renderSearchResults(curated);
  else {
    /* Whatever is on screen belongs to an earlier query — the empty-field
       suggestions, or the previous keystroke's results. Leaving it under a
       query it doesn't match is how a stray Enter picks the wrong place. */
    searchResults = [];
    $("#searchResults").replaceChildren();
    searchIndex = -1;
    $("#searchInput").removeAttribute("aria-activedescendant");
  }
  if (q.length < 2) {
    setStatus("");
    if (!curated.length) closeSearchPanel();
    return;
  }
  /* from the first real keystroke, not after the debounce: the panel says it is
     working instead of sitting shut until the network answers */
  openSearchPanel();
  setStatus("loading");

  geoTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    const signal = searchAbort.signal;
    const isCurrent = () => !signal.aborted && $("#searchInput").value.trim() === q;
    try {
      const remote = await maptilerGeocode(q, signal);
      if (!isCurrent()) return; /* stale */
      setStatus("");
      renderSearchResults(mergeResults(curated, remote)); /* empty list → "no result" */
    } catch (e) {
      if (e.name === "AbortError" || signal.aborted) return;
      /* MapTiler unreachable/misconfigured → keyless Open-Meteo fallback */
      try {
        const geo = await geocode(q);
        if (!isCurrent()) return;
        setStatus("");
        renderSearchResults(mergeResults(curated, geo));
      } catch {
        if (!isCurrent()) return;
        /* Both lookups failed. With built-in matches on screen they stay and
           the status explains the gap; with none, the panel says the search
           itself is unavailable — which is not the same as "no place matches". */
        if (curated.length) setStatus("partial");
        else {
          searchResults = [];
          $("#searchResults").replaceChildren();
          announce(t("searchError"));
          setStatus("error");
        }
      }
    } finally {
      searchAbort = null;
    }
  }, 300);
}

function onSearchKey(e) {
  const max = searchResults.length - 1;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    searchIndex = Math.min(max, searchIndex + 1);
    highlightSearch();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    searchIndex = Math.max(0, searchIndex - 1);
    highlightSearch();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (searchIndex >= 0) pickSearchResult(searchIndex);
    /* with nothing typed the menu is a menu, not an answer — Enter needs an
       arrowed-to row, so it can't select the first recent by accident */
    else if ($("#searchInput").value.trim() && searchResults.length) pickSearchResult(0);
  } else if (e.key === "Escape") {
    /* on mobile this moves focus to #mobileSearchBtn; on desktop that
       button is display:none and can't receive focus, so blur() below
       still runs and matches the previous desktop-only behaviour */
    closeMobileSearch({ focusTrigger: true });
    $("#searchInput").blur();
  }
}

function highlightSearch() {
  $$("#searchResults [role=option]").forEach((li, i) =>
    li.setAttribute("aria-selected", i === searchIndex),
  );
  const active = $(`#sr-${searchIndex} .search-item`);
  if (active) active.scrollIntoView({ block: "nearest" });
  $("#searchInput").setAttribute(
    "aria-activedescendant",
    searchIndex >= 0 ? `sr-${searchIndex}` : "",
  );
}

export function bindSearchEvents() {
  const input = $("#searchInput");
  input.addEventListener("input", onSearchInput);
  input.addEventListener("keydown", onSearchKey);
  input.addEventListener("focus", () => {
    if (input.value.trim()) onSearchInput();
    else showSuggestions();
  });
  /* one delegated listener: the status line is rewritten on every state */
  $("#searchStatus").addEventListener("click", (event) => {
    if (event.target.closest(".search-retry")) onSearchInput();
  });
  $("#favAddBtn").addEventListener("click", focusSearch);
  $("#mobileSearchBtn")?.addEventListener("click", () => {
    if (isMobileSearchOpen()) closeMobileSearch();
    else openMobileSearch();
  });
}
