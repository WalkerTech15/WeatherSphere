# AI_REPORT.md

**Task:** Align the site with the Saint-Pierre Weather brand. Model: Claude Sonnet 5.5, medium.

## Files changed
- `src/index.html`, `translations.js` / `-es.js` / `-vi.js` (+ es/vi unit tests): every visible "WeatherSphere" → "Saint-Pierre Weather" (title, meta, aria-label, About, Help, Privacy, Settings, footer). Removed "premium" wording.
- Logo: 624 KB PNG → 41 KB WebP (`public/assets/saint-pierre-weather-logo.webp`, PNG removed; it was only used in index.html). New compact mark `saint-pierre-weather-mark.svg` (<1 KB), also used as favicon (one asset, no duplicates).
- CSS: `topnav.css`, `footer.css`, `responsive.css`, `map.css` (mark shown ≤640px and in the expanded map instead of the wordmark; dark theme puts the wordmark on a soft white plate so the navy lettering stays readable), `tokens.css` + `cards.css` (dark theme moved to a deeper navy: bg #0a1428, card #112240).
- Tests/comments: e2e specs updated for the new name; removed a dead `.logo-text em` contrast case; comments/package.json/README/sw.js/.htaccess renamed.
- Colours: the app was already logo-blue (primary) with amber for favorites/sun, so no broad recolour was made; only the navy dark theme changed. No new gradients or glow.

## Verified
- vitest 104 files / 2867 tests pass; eslint, stylelint, prettier clean; `npm run build` OK.
- Playwright (desktop) responsive-quality, accessibility-quality, spanish, vietnamese, favorites-notifications, app: 327 pass, 3 fail (below).
- Screenshots: light/dark at 1440 and 390px, About at 1024 dark; no horizontal overflow.
- Not run: mobile Playwright project, full suite, manual Tab test of the new mark.

## Failures
- Pre-existing (fail on clean HEAD too): es/vi "Lourdes … Unsplash credit" (photo label text changed in an earlier commit, unrelated).
- Flaky, passed on re-run: a11y "every Tab stop on Home (dark)".

## Remaining
- "WeatherSphere" remains only in `AI_WORKFLOW.md`, `docs/`, `perf-reports/`, and server comments/User-Agent strings in `api/` and `public/api/` (not visible to users; left untouched).
- The logo is transparent with navy text, so it needs the white plate in dark mode.

## Commit verdict: **Yes** (pre-existing es/vi failures documented).
Message: `style: align website with Saint-Pierre Weather branding`
Nothing committed, pushed, or deployed.
