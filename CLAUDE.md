# Blue Rocket Performance (BRP) — notes for Claude sessions

## Google Analytics 4
- GA4 property: **Blue Rocket Performance** (owned by the BRP Google account)
- Measurement ID (website tag): **`G-R7DDN3DRLE`** — installed in the `<head>` of `public/index.html`.
  Add the same snippet to any new HTML page.
- Leads are sent as the `generate_lead` event (quote form submit, `tel:` and `mailto:` taps) from `public/main.js`.
  In GA4 Admin → Events, mark `generate_lead` as a **key event**.
- GA4 **Property ID: `556951105`** — this numeric ID is what EUROWERKS OS needs (Marketing → settings → GA4 Property ID), not the G- ID.

## EUROWERKS OS (marketing dashboard)
- Repo: `jerryduncklee/eurowerks-os`. It's multi-shop; Blue Rocket is shop slug `bluerocketperformance`.
- Marketing settings are stored **per shop**: log in with the Blue Rocket user, then Marketing → settings
  (`mktConfigModal` in `public/index.html`). Fields: GA4 Property ID, site domain
  (`bluerocketperformance.com`), Search Console URL (`sc-domain:bluerocketperformance.com`), and the
  Blue Rocket service-account JSON key (or the `GOOGLE_SA_JSON_BR` Worker secret).
- Grant the service-account email: GA4 **Viewer**, Search Console **Full**. Ads data comes via the GA4 ↔ Google Ads link.
- SerpAPI (Trends) uses one OS-wide `SERPAPI_KEY`; keywords are per shop.

## Secrets
- This repo is **public**. Never commit or paste API keys, service-account JSON, or tokens.
  Set them from a terminal (`npx wrangler secret put NAME`) or the OS settings form.
