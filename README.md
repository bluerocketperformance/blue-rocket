# Blue Rocket Performance

Marketing site for **Blue Rocket Performance** — a Portland, Oregon shop for
high-performance motorcycle repair (Ducati, BMW, track bikes), custom TIG
fabrication, and custom Subaru STI parts and builds.

Single-page site served by a **Cloudflare Worker**, with a Resend-powered
"Request a quote" contact form.

## Stack

- Static front end (plain HTML/CSS/JS) in [`public/`](public/)
- Cloudflare Worker in [`src/index.js`](src/index.js) — serves the static assets
  and handles `POST /api/contact` (emails the quote request via Resend)
- Config in [`wrangler.toml`](wrangler.toml)

## Local development

```bash
npm install
npx wrangler dev
```

## Deploy

```bash
npx wrangler deploy
```

Live at: https://blue-rocket.jdauth.workers.dev

## Contact form (Resend)

The form at `/api/contact` needs these set before it will send mail:

```bash
npx wrangler secret put RESEND_API_KEY        # your Resend API key
# CONTACT_TO / CONTACT_FROM live in wrangler.toml [vars],
# or override them as secrets. CONTACT_FROM must be a verified Resend sender.
```

Until a key is configured, the phone (`tel:`) and email (`mailto:`) links still work.

## Blue Rocket OS (`/os`) — marketing dashboard

A password-protected dashboard at `/os` with two tabs:

- **Marketing** — GA4 traffic and leads, Search Console clicks and queries, and a Google Ads overview
- **Trends** — SerpAPI keyword rankings (Google organic and the map pack) and Google Trends search interest

Everything uses **one shared Google account (the BRP account)**. Anyone with the
OS password sees the same data, whoever's login it is.

### Rules

- Sign in to Google Cloud, GA4, Search Console, Google Ads and SerpAPI with the **BRP account**.
- **Secrets are set from a terminal only.** Never paste them into a chat, an email
  or this repo (it's public). They go in `.dev.vars`, which git ignores, and are
  uploaded to Cloudflare with `npm run push-secrets`.
- IDs (GA4 property, Search Console site, Ads customer IDs) are not secret. They go in
  `wrangler.toml` under `[vars]`.

### 1. Google Cloud Console (existing project)

1. **APIs & Services → Library** → enable: Google Analytics Data API, Google Search Console API, Google Ads API.
2. **OAuth consent screen** → External → add the BRP email under **Test users**.
3. **Credentials → Create credentials → OAuth client ID → Desktop app**. No redirect URI is needed.
4. Keep the Client ID and Client Secret for step 4.

> While the consent screen is in **Testing**, Google expires the connection after 7 days.
> To avoid that, click **Publish app** on the consent screen. It's only used by the BRP
> account, so no Google review is needed for this; you'll just see an "unverified app"
> warning when signing in, which you can click through.

### 2. Account access and IDs → `wrangler.toml`

| What | Where to find it | `wrangler.toml` key |
|---|---|---|
| GA4 property ID | GA4 → Admin → Property details (numbers only) | `GA4_PROPERTY_ID` |
| Search Console property | Search Console property picker, e.g. `sc-domain:bluerocketperformance.com` or `https://bluerocketperformance.com/` | `GSC_SITE_URL` |
| Google Ads account ID | Ads → top right, `123-456-7890` | `ADS_CUSTOMER_ID` |
| Ads manager (MCC) ID | Manager account → top right | `ADS_LOGIN_CUSTOMER_ID` |
| Keywords to track | your choice, comma separated (max 10) | `SERP_KEYWORDS` |
| Trends keywords | comma separated (max 5) | `TRENDS_KEYWORDS` |

The BRP account must have access to each one: GA4 **Viewer** or higher, Search Console
**Full** or **Owner**, and Google Ads **Read-only** or higher.

**Ads developer token:** in the Ads **Manager account** → Admin → **API Center**,
copy the token and **apply for Basic Access**. Until that's approved, the token only works
on test accounts, so the Ads panel shows an error.

### 3. SerpAPI

Sign up at [serpapi.com](https://serpapi.com/) with the BRP email and copy the API key.
Results are cached for 12 hours, so 10 keywords use about 20 searches a day.

### 4. Secrets: in a terminal, from the repo folder

```bash
npm install
cp dev-vars.example .dev.vars
notepad .dev.vars            # Windows  (Mac: open -e .dev.vars)
```

Fill in `OS_PASSWORD` (a long password for `/os`), `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `ADS_DEVELOPER_TOKEN` and `SERPAPI_KEY`, then save. Then run:

```bash
npm run google-auth          # browser opens: sign in as BRP, tick every box
npx wrangler login           # once, to the Cloudflare account that hosts the site
npm run push-secrets         # uploads the secrets to Cloudflare (values are never shown)
npx wrangler deploy          # deploys the IDs from wrangler.toml and the code
```

Open `/os` and sign in with `OS_PASSWORD`. Any panel that isn't ready lists exactly which
setting it's missing. To test locally first, run `npx wrangler dev` and open
http://localhost:8787/os.

## Structure

```
public/
  index.html        # the page
  styles.css        # dark, flat theme (Archivo + Inter)
  main.js           # nav, lightbox, form submit
  assets/           # logo, OG image, build gallery photos
  _headers          # cache-control
  robots.txt, sitemap.xml
  os-assets/        # /os dashboard front end (no data; data needs login)
src/
  index.js          # Cloudflare Worker (assets + Resend contact API)
  os.js             # /os dashboard: login, GA4, Search Console, Ads, SerpAPI
scripts/
  google-auth.mjs   # one-time Google sign-in -> .dev.vars
  push-secrets.mjs  # .dev.vars -> Cloudflare secrets
wrangler.toml
```
