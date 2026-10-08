# Askesis marketing site

A static [Astro](https://astro.build) site that introduces Askesis and links to the web app. It
has no API, database or Clerk dependency.

The structure, motion and visual language follow the
[T3 Code marketing site](https://github.com/pingdotgg/t3code/tree/main/apps/marketing) (MIT):
a masked grid hero with drifting marks, a framed product screenshot, a two-row marquee, a bordered
grid, a two-column feature with an illustration, a two-tile pitch and a closing call to action.
Askesis-specific choices:

- Midnight + Volt tokens and the effort scale from `apps/web/src/theme/palette.ts`. Colour on
  sessions means effort; sports are told apart by the same Lucide icons the app uses
  (`src/lib/icons.ts`).
- The hero grid lights up in Volt around the pointer (`src/lib/homeMotion.ts`). All motion pauses
  off screen and respects reduced-motion preferences.
- Phones get a real phone screenshot of Today rather than a shrunken desktop.

## Commands

```bash
pnpm dev:marketing                               # http://localhost:4321, or MARKETING_PORT
pnpm --filter @askesis/marketing build           # static output in apps/marketing/dist
pnpm --filter @askesis/marketing typecheck       # astro check
pnpm --filter @askesis/marketing test            # motion gating
```

Set `SITE_URL` at build time once the site has a domain; canonical and social-card URLs are
absolute. Links to the app use `APP_URL` in `src/lib/site.ts`.

## Screenshots

`src/assets/app-plan.webp` (1440×900 at 2x) and `src/assets/app-today-phone.webp` (390×844 at
3x) are captures of the real app running the complete multisport example
(`pnpm example:seed`, see [local development](../../docs/operations/local-development.md)), in
the default dark Midnight + Volt theme. `src/assets/social-card.webp` is a 1200×630 at 2x capture
of this site's hero.

Before capturing, a few strings were replaced in the page for presentation only (the stored plan
is unchanged): the verification account's name and email, the plan title ("Hyrox build ·
8 weeks"), the plan goal and description, the calibration evidence note and the AMRAP workout
purpose, which describe the example as test data. Re-capture after visible app changes, using the
same viewport sizes, and keep the swaps limited to test-data wording.
