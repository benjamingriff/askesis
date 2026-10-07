# Askesis marketing site

A small, static Astro site with plain CSS, self-hosted DM Sans, and a labelled, illustrative
training-week preview based on synthetic development data. It lives independently of the authenticated
React app and makes no API calls. No database, Docker, or Clerk keys are needed to view this site.

## Local development

From the repository root, with Node 24 and pnpm 11.18.0:

```bash
pnpm install --frozen-lockfile
pnpm dev:marketing
```

Open <http://localhost:4321>. Ctrl+C stops the server. Set `MARKETING_PORT` to use a different port;
the server refuses to silently move to another port when the requested one is occupied.

If the checkout runs on another machine, `localhost` refers to that machine. Forward its marketing
port to the machine running your browser (replace `your-workspace-host` with your SSH host):

```bash
ssh -N -L 4321:127.0.0.1:4321 your-workspace-host
```

Then open <http://localhost:4321> in your browser. Forward the app's configured web port too if
you want to use its links; keep the browser origin consistent with the Clerk development setup.

The development “Open Askesis” links use `PUBLIC_APP_URL`, then the worktree's `LOCAL_WEB_URL`
from the ignored root `.env`, then <http://localhost:5173/plan>. To point at an existing application:

```bash
PUBLIC_APP_URL=http://localhost:5244/plan pnpm dev:marketing
```

The site works without running the app. To exercise the app links too, use the existing
[isolated application setup](../../docs/operations/local-development.md#agent-browser-verification-in-a-worktree):

```bash
pnpm dev:setup
pnpm dev:local
```

In another terminal, `pnpm --silent dev:login` generates a one-use verification login URL. Open it
in the same browser used for the site. This keeps the actual Clerk and API authorization in place.
The full app requires Docker for PostgreSQL; its web and API processes run directly with pnpm.

## Production build and preview

```bash
PUBLIC_APP_URL=https://your-app.example/plan \
PUBLIC_SITE_URL=https://your-site.example \
pnpm --filter @askesis/marketing build
pnpm preview:marketing
```

Open the URL printed by Astro preview. These variables are public build-time values. `PUBLIC_SITE_URL`
enables canonical and Open Graph URL tags. When `PUBLIC_APP_URL` is omitted in a production build,
the calls to action become “Explore the project” and link to the repository; a local development
address is never used as the production fallback. No product domain has been assumed.

## Deploying on Vercel

Import this repository into a separate Vercel project and set:

| Setting          | Value                            |
| ---------------- | -------------------------------- |
| Root directory   | `apps/marketing`                 |
| Framework preset | Astro                            |
| Install command  | `pnpm install --frozen-lockfile` |
| Build command    | `pnpm build`                     |
| Output directory | `dist`                           |
| Node version     | 24.x                             |

Enable access to files outside the root directory so Vercel can install the workspace from its
root lockfile. Set `PUBLIC_APP_URL` and `PUBLIC_SITE_URL` for each deployment environment, then
assign the desired domain. Vercel's normal Git preview deployments are sufficient for this site;
it does not need T3 Code's release-coupled deployment workflow or a server adapter.

This PR prepares the site for static hosting; it does not create a Vercel project or deploy it.
Other static hosts can serve `apps/marketing/dist` after the same build.

## Updating the product preview

`src/components/PlanPreview.astro` is an illustration of a training week using the first week's
workouts from `database/seed/cardiff-half-example.sql`. It is static presentation, not an interactive
application or a screenshot. The sidebar and navigation-like details are decorative. Its totals
match the sample's 39 km, 3h 40m, and five workouts.

To replace it with a real app screenshot, follow the browser verification guide, confirm the
dedicated verification account, select a populated May 2026 week, and wait for all API content to
load. Capture only the application viewport at a clean `/plan` URL. Keep login links, handshake
parameters, tokens, keys, and real athlete data out of images and source files. Import the image
through `astro:assets` for responsive image variants and retain a sample-data caption.

## Checks

```bash
pnpm --filter @askesis/marketing typecheck
pnpm --filter @askesis/marketing build
pnpm format:check
pnpm lint
```

The root `pnpm check` and CI include this workspace's typecheck and build. Browser verification
should cover desktop/mobile layout, both in-page anchors, the app link, and a page reload.
