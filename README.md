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

## Structure

```
public/
  index.html        # the page
  styles.css        # dark, flat theme (Archivo + Inter)
  main.js           # nav, lightbox, form submit
  assets/           # logo, OG image, build gallery photos
  _headers          # cache-control
  robots.txt, sitemap.xml
src/
  index.js          # Cloudflare Worker (assets + Resend contact API)
wrangler.toml
```
