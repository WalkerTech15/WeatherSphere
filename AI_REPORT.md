# AI_REPORT.md

**Task:** Expand the Units settings with pressure, precipitation, and visibility units.
**Model:** Claude Sonnet 5 — Reasoning: medium

## Objective and scope
Add three independent unit controls (pressure hPa/inHg, precipitation mm/in,
visibility km/mi) to the existing Units settings card, reusing the existing
unit architecture (`core/units.js`, `features/settings.js`). No new displays
invented, no changes to °C/°F, wind, weather providers, or unrelated design.

## Files changed
- `src/js/core/storage.js` — 3 new `KEYS` entries.
- `src/js/core/state.js` — 3 new state fields, each defaulting to its own
  metric unit (never tied to the legacy imperial flag).
- `src/js/core/units.js` — `convPressure`/`fmtPressure`/`pressureUnit`/`toInHg`
  (new); `convVisibility`/`fmtVisibility`/`visibilityUnit` (new, reuses
  `toMiles`); `convPrecip`/`precipUnit` rewired from `state.unitTemp` to the
  new `state.unitPrecip` (precipitation is no longer imperial/metric-linked
  to temperature — distance's own linkage is untouched, per the brief).
- `src/js/features/settings.js` — `setUnitPressure`/`setUnitPrecip`/
  `setUnitVisibility`; `updateSettingsUI()` extended for the 3 new chip groups.
- `src/js/main.js` — click bindings for the 3 new chip groups.
- `src/index.html` — 3 new `.uchip-group` blocks in the existing Units card
  (reuses `pressure`/`precipitation`/`visibility` translation keys, which
  already exist in all 4 languages — no new i18n keys needed).
- `src/js/ui/render-home.js` — Home's pressure/visibility metric cards now
  use `fmtPressure`/`pressureUnit`/`fmtVisibility`/`visibilityUnit`; the
  high/low/good/poor classification thresholds stay on the raw canonical
  value, unchanged.
- `src/js/features/map-legend.js` — the map's pressure legend now uses
  `convPressure`/`pressureUnit` instead of a hardcoded hPa passthrough.
- Tests: `src/js/core/units.test.js` (new coverage), `src/js/features/map-legend.test.js`
  (updated 2 tests whose old assertions encoded the since-removed "rain/pressure
  never change" behavior; added 2 new tests for the new capability), new
  `e2e/settings-units.spec.js` (15 tests).

## Completed checklist
All items ticked and verified. Two items deliberately NOT expanded, per the
brief's own stop condition ("if a metric is not displayed in a specific view,
do not invent a new display"):
- Forecast/Charts/Favorites/Comparison/Advisories have no existing
  precipitation-amount, pressure, or visibility display to convert — audited
  and confirmed (Forecast's "precipitation" chart and Comparison's
  "precipitation" row are both rain-probability %, unrelated to the new
  precipitation-amount unit).

## Conversion and persistence details
- Pressure: `hpa`/`inhg` state values; `1 inHg = 33.8639 hPa` (NIST figure;
  1013.25 hPa ⇒ 29.92 inHg, the standard reference value). hPa displays as a
  whole number, inHg always to 2 decimals.
- Precipitation: reuses the existing `toInPerHour` (`mm / 25.4`), now gated
  by `state.unitPrecip` instead of `state.unitTemp`.
- Visibility: reuses the existing `toMiles` (`km / 1.60934`); formatting
  mirrors `fmtDistance`'s existing "1 decimal under 10, whole number at/above
  10" rule.
- All three persist to `localStorage` (`ws_unit_p`/`ws_unit_pr`/`ws_unit_v`)
  and are independent of each other and of temperature/wind — verified by a
  dedicated unit test and e2e test.

## Exact test commands and results
- `npx vitest run` → 103 files, **2851 tests passed**
- `npx eslint . && npx stylelint "**/*.css"` → clean
- `npx prettier --check` → clean
- `npm run build` → clean, 366.83 kB / 116.13 kB gzip (no new dependency)
- `git diff --check` → clean (LF/CRLF notice only)
- Secret-pattern scan on the diff → clean
- `npx playwright test e2e/settings-units.spec.js` → **15/15**, stable across repeats
- `npx playwright test e2e/app.spec.js e2e/settings-clock.spec.js e2e/map-weather-overlay.spec.js e2e/responsive-quality.spec.js e2e/spanish.spec.js e2e/vietnamese.spec.js` → **307/307**
- Full suite (`--workers=1`, desktop+mobile, 1158 tests): **1156 passed, 2 failed**
  (44.0m). Both failures are pre-existing flakes unrelated to this task —
  confirmed by rerunning each in isolation (pass) and rerunning the full
  `app.spec.js` file under normal parallel load (169/169 pass):
  - `app.spec.js:632` "France, Japan and Canada flags ... not cropped or
    stretched" — the exact flag-sizing test stabilized in an earlier,
    separate task this session; not touched by this change and not
    reproducible outside the 44-minute single-worker run.
  - `google-places-photos.spec.js:410` "switching places mid-load never
    leaves the previous photo or credit" — an unrelated photo-loading race,
    outside this task's scope (no units code involved).
  No failure touches pressure, precipitation, visibility, or any file changed
  in this task.

## Responsive and accessibility results
Verified at 320/375/390/768/1024/1440px: all 3 new chip groups stay inside
the Units card, no page overflow. Each new control is a real `role="radio"`
inside a `role="radiogroup"`, keyboard-focusable and togglable with
Enter — same pattern as the existing temperature/wind controls, no new
interaction model introduced.

## Translation results
No new translation keys were needed — `pressure`/`precipitation`/`visibility`
already existed in English, French, Spanish and Vietnamese and are reused
verbatim for the three new `.ulabel`s. Verified directly in
`e2e/settings-units.spec.js`'s language-loop test, and indirectly by the
full 307-test Spanish/Vietnamese/French/English regression run (0 failures,
0 new English leaks).

## Known limitations or pre-existing failures
None found in this task's scope. Two pre-existing, load-dependent flakes
surfaced only under the 44-minute single-worker full-suite run (see above);
both pass in isolation and under normal parallel execution, and neither
touches units code. (There is also a separately known, unrelated
`photo-confidence.spec.js` CLS flake from an earlier phase — not touched or
reproduced here.)

## Direct commit verdict: **Yes**

## Suggested commit message
```
feat: add pressure precipitation and visibility units
```

## Confirmation
Nothing has been committed, pushed, or deployed. All changes remain local
and uncommitted.
