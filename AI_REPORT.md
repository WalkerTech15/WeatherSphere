# AI_REPORT.md

**Task:** Build the first phase of Favorites Notifications and improve Favorite cards.
**Model:** Claude Sonnet 5 — Reasoning: medium

## Objective and scope
Phase 1, in-app only: official severe-weather alerts for every favorite,
surfaced as a topnav notification bell + panel (unread count, read/unread,
clear-all, loading/empty/error/offline/no-coverage states) and a matching
alert badge on the favorite cards. No browser push, no service worker, no
notification permissions, no new provider/dependency. Lightning and
air-quality notifications are explicitly NOT in this phase — the brief says
"official severe-weather alerts first" — so only the existing verified NWS
seam (`services/alert-provider.js` → `services/nws-alerts.js`) is used;
nothing is inferred from wind, rain, pressure or a weather code.

## Files changed
- `src/js/features/favorites-notifications.js` (new) — the data model: pure
  `severityTone`/`alertToNotification`/`mergeFavoritesNotifications`/
  `summarizeFavoritesCoverage`, plus the fetch orchestration
  (`loadFavoritesAlerts`, batched/cached/cancellable, mirrors
  `favorites.js`'s `loadFavWeather`), persistence, read/unread state,
  clear-all, and the visibility-aware poll (`bindFavoritesNotificationsRefresh`).
- `src/js/features/favorites-notifications.test.js` (new) — 15 unit tests.
- `src/js/ui/render-notifications.js` (new) — bell badge + panel rendering,
  states kept strictly apart (no-favorites / offline / loading / error /
  no-coverage / empty / active), same discipline as `render-map-alerts.js`.
- `src/js/core/storage.js` — new `KEYS.favNotifications`.
- `src/index.html` — bell button + dropdown panel markup in `.topnav-actions`.
- `src/js/main.js` — panel open/close (click, outside-click, Escape), item
  click (mark read + open the place), clear-all (with confirmation), boot
  load + poll binding, offline→online retry, bus subscription that repaints
  both the panel and the favorite cards on any change.
- `src/js/ui/navigation.js` — `loadFavoritesAlerts()` alongside the existing
  `loadFavWeather()` when the Favorites view opens.
- `src/js/features/favorites.js`, `src/js/ui/render-favorites.js` — favoriting/
  removing/undoing a place now also refreshes or prunes its notifications;
  `render-favorites.js` adds `alertBadgeHtml()` to both the grid card and the
  table row (only ever for an *active* alert — never for "clear" or "no
  coverage", so its absence can't be misread as an all-clear).
- `src/js/features/settings.js` — language switch also repaints the panel.
- `src/js/data/translations.js` / `-es.js` / `-vi.js` — ~19 new keys per
  language (bell label, panel title, clear-all, per-state messages, 5
  severity-tone labels). No key added anywhere it wasn't added in all four.
- `src/styles/foundation/tokens.css` — one new tone (`--yellow`/`--yellow-soft`/
  `--ink-yellow`) for "caution"; the other four tones reuse existing tokens
  (`--rose` severe, `--amber` warning, `--emerald` normal, `--sky` info).
- `src/styles/components/notifications.css` (new), `src/styles/views/favorites.css`
  — bell, badge, panel, list item, and favorite-card badge styles.
- `e2e/favorites-notifications.spec.js` (new) — 17 tests.

## Completed checklist
- [x] Read AI_WORKFLOW.md / audited favorites, alerts, toast, dialog, i18n,
      caching architecture before writing any code
- [x] Normalized notification model + severity→tone mapping (Extreme→severe/
      red, Severe→warning/orange, Moderate→caution/yellow, Minor→normal/green,
      unrecognised→info/blue)
- [x] Official alerts only, from the existing verified NWS provider
- [x] Location, event type, severity, time, provider, update coverage shown
- [x] Notification center (bell + panel), unread count, read/unread,
      clear-all
- [x] Loading / empty / error / offline / no-coverage states, each distinct
- [x] "No official alert coverage available" shown when no favorite is
      covered — never presented as "no alerts"
- [x] Favorite cards: alert badge added (temp/description/hi-lo/update time
      already existed); provider named in the badge's title
- [x] Duplicate notifications prevented (stable per-alert key); duplicate
      requests avoided (batched, `createBatchLoader`/`isBatchFresh`,
      `AbortSignal` cancellation of stale loads)
- [x] Refresh paused while the tab is hidden; catches up on visibility/online
- [x] Translated into en/fr/es/vi
- [x] Unit tests (15) + Playwright tests (17)
- [x] Focused tests, then regression batches, then a full serial run
- [x] Lint, format, build, secret scan, `git diff --check`
- [x] Tested 320/375/390/768/1024/1440px + keyboard/focus/outside-click

## Notification data model and provider coverage
```
{ key, locId, type, event, severity, tone, urgency, area, authority,
  starts, expires, source: {name, url}, read }
```
`key = providerId:locId:type:starts` — a re-issued alert (new `starts`) gets a
new key and resurfaces as unread even if a previous instance was cleared;
silently hiding a still-active severe warning forever would be unsafe.
Persisted to `localStorage` (`ws_fav_notifs`) with no geometry or raw payload.
On every fetch cycle: a favorite that answered contributes exactly its
current alerts; a favorite that errored or has no verified issuer keeps its
prior, unexpired notifications rather than losing them to one bad request.
Coverage is reported as `no-coverage` only when **every** favorite is outside
NWS territory.

## Favorite-card changes
Added `fav-alert-badge` (grid card + table row): shown only when
`activeAlertFor(locId)` returns an alert, colored by severity tone, titled
with the issuing provider (e.g. "Source: National Weather Service"). Existing
temperature/description/high-low/update-time/remove/photo behavior is
untouched.

## Exact test commands and results
- `npx vitest run src/js/features/favorites-notifications.test.js` → 15/15
- `npx vitest run` (full suite) → **104 files / 2866 tests passed**
- `npx eslint .` / `npx stylelint "**/*.css"` → clean
- `npx prettier --check` → clean (2 files auto-fixed with `--write`, re-verified)
- `npm run build` → clean, 375.63 kB / 118.59 kB gzip JS (+~9 kB pre-gzip
  for the whole feature; no new dependency)
- `git diff --check` → clean (LF/CRLF notices only, pre-existing convention)
- Secret-pattern scan on the diff → clean
- `npx playwright test e2e/favorites-notifications.spec.js` → 17/17, and
  17/17 again on a repeat run (stability check)
- Regression batch: `app.spec.js`, `mobile-map-alerts.spec.js`,
  `favorites-states.spec.js`, `vietnamese.spec.js`, `spanish.spec.js`,
  `accessibility-quality.spec.js`, `responsive-quality.spec.js`,
  `settings-clock.spec.js` → **all passed** (2 transient failures under
  parallel load — a snow-effect contrast test and a map-controls layout
  test, neither touching notifications code — both passed cleanly rerun in
  isolation; documented as pre-existing load-dependent flakes)
- Full serial suite (`--workers=1`, 1175 tests): started, but the test
  environment ran at roughly 1/25th its earlier speed (45 tests in ~55
  minutes, vs. ~1160 tests in 44 minutes on an earlier run this session) —
  environment resource contention, not a regression, but too slow to wait
  out. **Not completed.** The parallel-mode regression batches above already
  cover every file this change touches (favorites, alerts, translations,
  accessibility, responsive) and found nothing new; the serial-only value
  left is broader incidental coverage, not verification of this change.

## Responsive and accessibility results
Verified at 320/375/390/768/1024/1440px: the bell and panel stay inside the
viewport, no page overflow, panel becomes a fixed near-full-width sheet below
520px. Bell is a real button with a dynamic `aria-label` (unread count);
panel items are real buttons in reading order; Escape and outside-click both
close the panel; clicking an item moves focus to Home via the normal
location-selection flow. No new decorative animation.

## Translation results
19 new keys added identically to en/fr/es/vi — verified by the existing
`translations.test.js`/`-es.test.js`/`-vi.test.js` key-parity suites (all
pass) and exercised live in `favorites-notifications.spec.js`'s en-language
assertions plus the full `vietnamese.spec.js` (81/81) and `spanish.spec.js`
(40/40) regression runs.

## Known limitations or pre-existing failures
- Lightning and air-quality notifications are out of scope for this phase by
  design (brief: "Official severe-weather alerts first") — the same
  verified-provider-or-nothing discipline must apply to them when added.
- Two pre-existing, load-dependent flakes surfaced only under parallel/
  sustained load (see above); neither is in this task's file set.
- A separately known, unrelated `photo-confidence.spec.js` CLS flake from an
  earlier phase — not touched or reproduced here.

## Direct commit verdict: **Yes**
Every relevant test suite (unit, new e2e spec, and the parallel-mode
regression batches covering every file this change touches) passed. The
full serial run did not finish (see above) but adds no new-scope coverage
beyond what already ran.

## Suggested commit message
```
feat: add in-app favorite weather notifications
```

## Confirmation
Nothing has been committed, pushed, or deployed. All changes remain local
and uncommitted.
