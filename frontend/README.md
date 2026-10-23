# Frontend: Business Performance Control Tower

A React + TypeScript single-page app (Vite, Tailwind CSS v4, shadcn/ui, Recharts, TanStack Table and Query) that presents what the API returns. It computes no metrics of its own.

## Pages

| Page | What it shows | Filters apply? |
|---|---|---|
| Overview | 8 KPI cards with the previous-period change and the formula behind each; monthly sales and profit charts; priority insights | yes |
| Performance Drivers | Sales, profit and margin by region, segment, category or sub-category (charts and a sortable, exportable table); driver insights | yes |
| Product Performance | Profit by sub-category; a product table with sales, profit, margin, quantity, average discount and orders. Server-side search, sorting and pagination; export of the current page | yes |
| Operations | Days to ship (ship date − order date) by ship mode, region and both, plus the distribution | yes |
| Action Plan | Actions with title, assignee, priority, deadline and status, saved in `localStorage`; can start from an insight | no |
| Methodology & Data Quality | Data source and period, metric definitions, pipeline steps, validation checks and limitations | no |

**On-time delivery is not shown on the Operations page.** The dataset has no promised or delivery date, so the page shows time to ship only and explains why.

**Insights** come from the Python pipeline and cover the full dataset; they don't change with the filters. Each insight card shows:
- its severity, with an icon and a label;
- its caveat;
- the evidence behind it;
- links to the related metrics;
- an **Add to action plan** button.

## Architecture

```
src/
  api/client.ts      the only module that calls the API (URL building, error handling)
  api/types.ts       response types
  hooks/useApi.ts    TanStack Query wrappers around api/client.ts
  hooks/useFilters.ts global filters, stored in the URL (?start=&end=&region=…)
  lib/               formatting (currency, %, dates), filters, CSV export, metric definitions
  components/        layout (sidebar, filter bar), KPI cards, charts, data table, UI states, shadcn/ui
  features/          insights (cards, evidence, links), action plan (storage, form)
  pages/             one component per page, lazy-loaded
```

- **Filters** live in the URL, so any view can be bookmarked or shared. Clearing the filters keeps page settings such as the sort order.
- **Number formats** are defined once in `src/lib/format.ts`: `$2,297,201`, `12.5%`, `+1.2 pp`, `3.96 days` and `Jan 1, 2017` (UTC, so there is no time-zone drift). Missing values show as `—`.
- **UI states:** every data block has loading skeletons; an error panel with the API message, request ID and a retry button; and an empty state with a **Clear filters** button when the filters match nothing.
- **Charts** show one measure each, with no dual axes:
  - Colours come from a palette checked for colour-blind safety and contrast, in light and dark mode.
  - Profit uses blue for gains and red for losses, always with a text legend.
  - Every chart has hover tooltips and a **Show table** view.
- **Accessibility:**
  - Semantic landmarks and a skip link.
  - Labelled form controls, sortable headers with `aria-sort`, and visible focus rings.
  - Status is always shown with an icon and text, not colour alone.
  - Reduced motion is respected, and the layout is responsive, with a collapsible sidebar.

## Running locally

Prerequisites:
- Node 20+.
- The API running locally (see [../api/README.md](../api/README.md)) on `http://localhost:8787`. Its default CORS settings allow `http://localhost:5173`.

```bash
cd frontend
npm ci
cp .env.example .env.local      # VITE_API_BASE_URL=http://localhost:8787
npm run dev                     # http://localhost:5173
```

Other scripts:

```bash
npm test            # Vitest + Testing Library (jsdom)
npm run typecheck   # tsc -b
npm run build       # type-check, then production build into dist/
npm run preview     # serve dist/ on http://localhost:4173 (use --port 5173 to match the API's CORS default)
```

## Configuration and security

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Base URL of the Worker API, without a trailing slash, e.g. `https://bpct-api.<subdomain>.workers.dev` |

- **No secrets in `VITE_*` variables:** Vite bakes them into the public bundle, so they must never hold credentials. The API is read-only and needs none. The build ships no source maps.
- **Security headers:** `public/_headers` sets CSP and security headers on Cloudflare Pages. `connect-src` allows `*.workers.dev`; add your API's custom domain there if you use one.
- **Action plan storage:** the action plan stays in the browser's `localStorage`. It is validated on load and never sent anywhere.

## Deploying to Cloudflare Pages

1. Create a Pages project connected to the repository, or use direct upload:
   - Root directory: `frontend`
   - Build command: `npm ci && npm run build`
   - Output directory: `dist`
   - Environment variable: `VITE_API_BASE_URL=https://bpct-api.<subdomain>.workers.dev`
2. Alternatively, deploy from your machine:
   ```bash
   VITE_API_BASE_URL=https://bpct-api.<subdomain>.workers.dev npm run build
   npx wrangler pages deploy dist --project-name bpct
   ```
3. Add the Pages URLs to the Worker's `ALLOWED_ORIGINS` in `api/wrangler.jsonc`, for example `https://bpct.pages.dev,https://*.bpct.pages.dev`, then redeploy the Worker with `npm run deploy` in `api/`.

Pages serves `index.html` for unknown paths (there is no `404.html`), so deep links such as `/products?sort=profit` work.
