# AI_REPORT.md

**Task:** Fix responsive header overlap (search bar over Simple/Detailed toggle).
**Model:** Claude Sonnet 5.5 — Reasoning: low/medium

## Root cause
At ≥901px `.topnav-inner` is a 3-column grid whose outer tracks were
`minmax(280px, 1fr)`. The right group (display toggle + bell + theme + language)
is ~360–380px, so it overflowed its 280px track to the LEFT and sat on top of
the search bar (measured: toggle started up to 47px inside the search field
at 1280px, 7px at 1440px). The bell added in the notifications phase made the
group wider than the old 280px assumption.

## Fix (1 CSS line + comment)
- `src/styles/layout/topnav.css`: outer tracks `minmax(280px, 1fr)` →
  `minmax(auto, 1fr)`. Outer groups now never shrink below their content, so
  the search column is what gives way. Still centered when there is room.
  No fixed widths, no negative margins, no new classes.
- Below 901px nothing changed: the existing drawer layout already hides the
  navbar toggle (a copy lives in the sidebar) and the search uses the full row;
  ≤520px it becomes the full-width mobile search overlay.
- `e2e/responsive-quality.spec.js`: new regression test (901/960/1024/1100/
  1280/1440px × fr/en): search ends ≥8px before the toggle, no overflow.

## Verified
- Before/after measurement 901–1440px (en/fr/es/vi): no overlap after fix,
  gap between search and toggle ≥24px, no horizontal scroll. Search is 234px
  wide at 901px, 640px at 1440px.
- New tests FAIL without the fix and PASS with it (12/12).
- `playwright` responsive-quality + accessibility-quality + favorites-
  notifications (desktop): 80/80 passed.
- stylelint, prettier, eslint on touched files: clean.
- Screenshots at 901 and 1024px inspected: layout clean.
- Not run: full unit suite / full e2e suite / build (CSS-only change plus
  one test; no JS touched). Map-expanded header uses its own flex rules and
  was not changed.

## Direct commit verdict: **Yes**
Suggested message: `fix: stop search bar overlapping header controls on laptop widths`

Nothing committed, pushed, or deployed.
