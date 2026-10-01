/**
 * Blue Rocket OS — password-protected marketing dashboard at /os.
 *
 * One shared Google connection (the BRP marketing account) feeds every viewer,
 * so whoever logs in sees the same GA4 / Search Console / Ads data.
 *
 * Secrets (never commit these — set from a terminal, see README):
 *   OS_PASSWORD             shared login password for /os
 *   GOOGLE_CLIENT_ID        OAuth client (Desktop app) from Cloud Console
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN    created by `npm run google-auth`
 *   ADS_DEVELOPER_TOKEN     Google Ads Manager account -> API Center
 *   SERPAPI_KEY             serpapi.com dashboard
 *
 * Non-secret IDs live in wrangler.toml [vars].
 */

const SESSION_COOKIE = "os_session";
const SESSION_DAYS = 30;
const SERP_CACHE_SECONDS = 12 * 60 * 60;

class OsError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
  });

const html = (body, status = 200, extra = {}) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });

const missing = (env, names) => names.filter((n) => !env[n] || !String(env[n]).trim());

/* ---------------------------------------------------------------- auth */

const enc = new TextEncoder();

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

async function safeEqual(a, b) {
  // Hash first so both sides are the same length, then compare in constant time.
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b))),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

async function isSignedIn(request, env) {
  const value = readCookie(request, SESSION_COOKIE);
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(env.OS_PASSWORD, `os:${exp}`));
}

async function handleLogin(request, env) {
  const form = await request.formData().catch(() => null);
  const password = form ? String(form.get("password") || "") : "";
  if (!password || !(await safeEqual(password, env.OS_PASSWORD))) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return html(loginPage("Wrong password."), 401);
  }
  const exp = Date.now() + SESSION_DAYS * 86400 * 1000;
  const cookie = `${SESSION_COOKIE}=${exp}.${await hmac(env.OS_PASSWORD, `os:${exp}`)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
  return new Response(null, { status: 303, headers: { Location: "/os", "Set-Cookie": cookie, ...SECURITY_HEADERS } });
}

function handleLogout() {
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/os",
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      ...SECURITY_HEADERS,
    },
  });
}

/* --------------------------------------------------------------- pages */

const shell = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${title}</title>
<link rel="icon" href="/assets/logo-trans.png" />
<link rel="stylesheet" href="/os-assets/os.css" />
</head>
<body>
${body}
</body>
</html>`;

const loginPage = (error = "") =>
  shell(
    "Blue Rocket OS",
    `<main class="login">
  <form method="post" action="/os/login" class="login-card">
    <img src="/assets/logo-trans.png" alt="" width="56" height="56" />
    <h1>Blue Rocket OS</h1>
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus />
    ${error ? `<p class="login-error" role="alert">${error}</p>` : ""}
    <button type="submit">Sign in</button>
  </form>
</main>`
  );

const dashboardPage = () =>
  shell(
    "Blue Rocket OS",
    `<header class="top">
  <div class="brand"><img src="/assets/logo-trans.png" alt="" width="28" height="28" /> Blue Rocket OS</div>
  <nav class="tabs" role="tablist">
    <button role="tab" data-tab="marketing" aria-selected="true">Marketing</button>
    <button role="tab" data-tab="trends" aria-selected="false">Trends</button>
  </nav>
  <a class="logout" href="/os/logout">Sign out</a>
</header>
<main id="app"></main>
<div id="tooltip" class="tooltip" hidden></div>
<script src="/os-assets/os.js" defer></script>`
  );

const notConfiguredPage = () =>
  shell(
    "Blue Rocket OS",
    `<main class="login"><div class="login-card"><h1>Blue Rocket OS</h1>
  <p>Not set up yet. Set the login password from a terminal:</p>
  <pre>npx wrangler secret put OS_PASSWORD</pre></div></main>`
  );

/* ------------------------------------------------------------- helpers */

const iso = (d) => d.toISOString().slice(0, 10);

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

// Current window ends `lagDays` ago; previous window is the same length right before it.
function ranges(days, lagDays) {
  const end = addDays(new Date(), -lagDays);
  const start = addDays(end, -(days - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return { start: iso(start), end: iso(end), prevStart: iso(prevStart), prevEnd: iso(prevEnd) };
}

function dateList(start, end) {
  const out = [];
  for (let d = new Date(start + "T00:00:00Z"); iso(d) <= end; d = addDays(d, 1)) out.push(iso(d));
  return out;
}

const fillDaily = (start, end, map) => dateList(start, end).map((date) => ({ date, value: map.get(date) || 0 }));

function parseDays(url) {
  const days = Number(url.searchParams.get("days"));
  return [7, 28, 90].includes(days) ? days : 28;
}

async function cached(key, ttl, fn) {
  const cache = caches.default;
  const req = new Request(`https://os-cache.internal/${key}`);
  try {
    const hit = await cache.match(req);
    if (hit) return hit.json();
  } catch {}
  const data = await fn();
  try {
    await cache.put(
      req,
      new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttl}` },
      })
    );
  } catch {}
  return data;
}

/* -------------------------------------------------------------- google */

const GOOGLE_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];
let tokenCache = { token: "", exp: 0 };

async function googleToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new OsError(
      `Google connection failed (${data.error_description || data.error || res.status}). Re-run "npm run google-auth".`
    );
  }
  tokenCache = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

async function googleFetch(env, url, body, extraHeaders = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await googleToken(env)}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = Array.isArray(data) ? data[0]?.error : data.error;
    const detail = err?.details?.[0]?.errors?.[0]?.message;
    throw new OsError(detail || err?.message || `Google API error ${res.status}`);
  }
  return data;
}

/* ----------------------------------------------------------------- GA4 */

async function ga4(env, days) {
  const need = missing(env, [...GOOGLE_KEYS, "GA4_PROPERTY_ID"]);
  if (need.length) return { configured: false, missing: need };

  const r = ranges(days, 1);
  const cur = { startDate: r.start, endDate: r.end, name: "current" };
  const prev = { startDate: r.prevStart, endDate: r.prevEnd, name: "previous" };
  const totalsMetrics = ["sessions", "totalUsers", "keyEvents", "engagementRate"];

  const data = await googleFetch(
    env,
    `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID.trim()}:batchRunReports`,
    {
      requests: [
        { dateRanges: [cur, prev], metrics: totalsMetrics.map((name) => ({ name })) },
        { dateRanges: [cur], dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }] },
        {
          dateRanges: [cur],
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }, { name: "keyEvents" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 8,
        },
        {
          dateRanges: [cur],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }],
          orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
          limit: 10,
        },
      ],
    }
  );

  const [totalsRep, dailyRep, channelRep, pageRep] = data.reports || [];
  const num = (row, i) => Number(row?.metricValues?.[i]?.value || 0);
  const totalsFor = (name) => {
    const row = (totalsRep?.rows || []).find((x) => x.dimensionValues?.[0]?.value === name);
    return {
      sessions: num(row, 0),
      users: num(row, 1),
      keyEvents: num(row, 2),
      engagementRate: num(row, 3),
    };
  };

  const daily = new Map(
    (dailyRep?.rows || []).map((row) => {
      const d = row.dimensionValues[0].value; // YYYYMMDD
      return [`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, num(row, 0)];
    })
  );

  return {
    configured: true,
    range: r,
    totals: totalsFor("current"),
    previous: totalsFor("previous"),
    daily: fillDaily(r.start, r.end, daily),
    channels: (channelRep?.rows || []).map((row) => ({
      name: row.dimensionValues[0].value,
      sessions: num(row, 0),
      keyEvents: num(row, 1),
    })),
    pages: (pageRep?.rows || []).map((row) => ({ path: row.dimensionValues[0].value, views: num(row, 0) })),
  };
}

/* ------------------------------------------------------ Search Console */

async function searchConsole(env, days) {
  const need = missing(env, [...GOOGLE_KEYS, "GSC_SITE_URL"]);
  if (need.length) return { configured: false, missing: need };

  const r = ranges(days, 3); // Search Console data lags ~2-3 days
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    env.GSC_SITE_URL.trim()
  )}/searchAnalytics/query`;
  const query = (body) => googleFetch(env, url, body);

  const [totals, previous, daily, queries, pages] = await Promise.all([
    query({ startDate: r.start, endDate: r.end }),
    query({ startDate: r.prevStart, endDate: r.prevEnd }),
    query({ startDate: r.start, endDate: r.end, dimensions: ["date"] }),
    query({ startDate: r.start, endDate: r.end, dimensions: ["query"], rowLimit: 15 }),
    query({ startDate: r.start, endDate: r.end, dimensions: ["page"], rowLimit: 10 }),
  ]);

  const totalsOf = (res) => {
    const row = res.rows?.[0] || {};
    return { clicks: row.clicks || 0, impressions: row.impressions || 0, ctr: row.ctr || 0, position: row.position || 0 };
  };
  const rows = (res) =>
    (res.rows || []).map((row) => ({
      key: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }));

  return {
    configured: true,
    range: r,
    totals: totalsOf(totals),
    previous: totalsOf(previous),
    daily: fillDaily(r.start, r.end, new Map((daily.rows || []).map((row) => [row.keys[0], row.clicks]))),
    queries: rows(queries),
    pages: rows(pages),
  };
}

/* ---------------------------------------------------------- Google Ads */

async function googleAds(env, days) {
  const need = missing(env, [...GOOGLE_KEYS, "ADS_DEVELOPER_TOKEN", "ADS_CUSTOMER_ID"]);
  if (need.length) return { configured: false, missing: need };

  const r = ranges(days, 1);
  const customer = env.ADS_CUSTOMER_ID.replace(/\D/g, "");
  const login = (env.ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, "");
  const version = env.ADS_API_VERSION || "v25";
  const search = async (gaql) =>
    (
      await googleFetch(
        env,
        `https://googleads.googleapis.com/${version}/customers/${customer}/googleAds:search`,
        { query: gaql },
        { "developer-token": env.ADS_DEVELOPER_TOKEN, ...(login ? { "login-customer-id": login } : {}) }
      )
    ).results || [];

  const between = (a, b) => `segments.date BETWEEN '${a}' AND '${b}'`;
  const totalsQuery = (a, b) =>
    `SELECT customer.currency_code, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM customer WHERE ${between(a, b)}`;

  const [cur, prev, daily, campaigns] = await Promise.all([
    search(totalsQuery(r.start, r.end)),
    search(totalsQuery(r.prevStart, r.prevEnd)),
    search(
      `SELECT segments.date, metrics.cost_micros FROM customer WHERE ${between(r.start, r.end)} ORDER BY segments.date`
    ),
    search(
      `SELECT campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE ${between(
        r.start,
        r.end
      )} AND campaign.status != 'REMOVED' ORDER BY metrics.cost_micros DESC LIMIT 20`
    ),
  ]);

  const metricsOf = (m = {}) => ({
    cost: Number(m.costMicros || 0) / 1e6,
    clicks: Number(m.clicks || 0),
    impressions: Number(m.impressions || 0),
    conversions: Number(m.conversions || 0),
  });

  return {
    configured: true,
    range: r,
    currency: cur[0]?.customer?.currencyCode || "USD",
    totals: metricsOf(cur[0]?.metrics),
    previous: metricsOf(prev[0]?.metrics),
    daily: fillDaily(
      r.start,
      r.end,
      new Map(daily.map((row) => [row.segments.date, Number(row.metrics.costMicros || 0) / 1e6]))
    ),
    campaigns: campaigns.map((row) => ({
      name: row.campaign.name,
      status: row.campaign.status,
      ...metricsOf(row.metrics),
    })),
  };
}

/* ------------------------------------------------------------- SerpAPI */

const keywordList = (value, max) =>
  String(value || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, max);

async function serpapi(env, params) {
  const url = new URL("https://serpapi.com/search.json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", env.SERPAPI_KEY);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new OsError(`SerpAPI: ${data.error || res.status}`);
  return data; // a 200 with data.error just means "no results"
}

async function rankings(env) {
  const need = missing(env, ["SERPAPI_KEY", "SERP_KEYWORDS"]);
  if (need.length) return { configured: false, missing: need };

  const domain = (env.SITE_DOMAIN || "bluerocketperformance.com").replace(/^www\./, "");
  const business = (env.BUSINESS_NAME || "Blue Rocket").toLowerCase();
  const location = env.SERP_LOCATION || "Portland, Oregon, United States";

  const rows = await Promise.all(
    keywordList(env.SERP_KEYWORDS, 10).map((keyword) =>
      cached(`serp/${encodeURIComponent(location)}/${encodeURIComponent(keyword)}`, SERP_CACHE_SECONDS, async () => {
        const data = await serpapi(env, { engine: "google", q: keyword, location, gl: "us", hl: "en" });
        const organic = (data.organic_results || []).find((o) => {
          try {
            return new URL(o.link).hostname.replace(/^www\./, "").endsWith(domain);
          } catch {
            return false;
          }
        });
        const places = Array.isArray(data.local_results) ? data.local_results : data.local_results?.places || [];
        const local = places.find((p) => (p.title || "").toLowerCase().includes(business));
        const leader = data.organic_results?.[0];
        return {
          keyword,
          organic: organic?.position ?? null,
          url: organic?.link || "",
          local: local ? local.position ?? places.indexOf(local) + 1 : null,
          leader: leader ? { title: leader.title, link: leader.link } : null,
          checkedAt: new Date().toISOString(),
        };
      })
    )
  );

  return { configured: true, location, domain, rows };
}

async function trends(env) {
  const need = missing(env, ["SERPAPI_KEY", "TRENDS_KEYWORDS"]);
  if (need.length) return { configured: false, missing: need };

  const keywords = keywordList(env.TRENDS_KEYWORDS, 5); // Google Trends compares max 5
  const geo = env.TRENDS_GEO || "US-OR";
  return cached(`trends/${geo}/${encodeURIComponent(keywords.join(","))}`, SERP_CACHE_SECONDS, async () => {
    const data = await serpapi(env, {
      engine: "google_trends",
      q: keywords.join(","),
      geo,
      date: "today 12-m",
      data_type: "TIMESERIES",
    });
    const timeline = data.interest_over_time?.timeline_data || [];
    return {
      configured: true,
      geo,
      keywords,
      series: keywords.map((keyword) => ({
        keyword,
        points: timeline.map((t) => ({
          date: t.date,
          value: Number(t.values?.find((v) => v.query === keyword)?.extracted_value || 0),
        })),
      })),
      checkedAt: new Date().toISOString(),
    };
  });
}

/* -------------------------------------------------------------- router */

const API = {
  "/api/os/ga4": (env, url) => ga4(env, parseDays(url)),
  "/api/os/search-console": (env, url) => searchConsole(env, parseDays(url)),
  "/api/os/ads": (env, url) => googleAds(env, parseDays(url)),
  "/api/os/rankings": (env) => rankings(env),
  "/api/os/trends": (env) => trends(env),
};

export function isOsPath(pathname) {
  return pathname === "/os" || pathname.startsWith("/os/") || pathname.startsWith("/api/os/");
}

export async function handleOs(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (!env.OS_PASSWORD) {
    return path.startsWith("/api/") ? json({ error: "OS is not set up." }, 503) : html(notConfiguredPage(), 503);
  }

  if (path === "/os/login" && request.method === "POST") return handleLogin(request, env);
  if (path === "/os/logout") return handleLogout();

  const signedIn = await isSignedIn(request, env);

  if (path === "/os") return signedIn ? html(dashboardPage()) : html(loginPage());

  const route = API[path];
  if (!route) return json({ error: "Not found." }, 404);
  if (!signedIn) return json({ error: "Sign in required." }, 401);
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);

  try {
    return json(await route(env, url));
  } catch (err) {
    return json({ error: err.message || "Something went wrong." }, err.status || 500);
  }
}
