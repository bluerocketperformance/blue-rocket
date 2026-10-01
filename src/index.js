/**
 * Blue Rocket Performance — Cloudflare Worker
 * Serves the static site from ./public and handles the Resend contact form.
 *
 * Secrets / vars (set before deploy):
 *   RESEND_API_KEY  -> npx wrangler secret put RESEND_API_KEY
 *   CONTACT_TO      -> inbox for quotes (wrangler.toml [vars] or secret)
 *   CONTACT_FROM    -> a verified Resend sender (defaults to onboarding@resend.dev)
 *
 * EUROWERKS OS quote intake (quotes also land in the OS Inbox):
 *   OS_QUOTE_URL         -> wrangler.toml [vars]
 *   OS_SHOP_SLUG         -> wrangler.toml [vars] (bluerocketperformance)
 *   QUOTE_INGEST_SECRET  -> npx wrangler secret put QUOTE_INGEST_SECRET
 */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

async function handleContact(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const firstName = (body.firstName || "").toString().trim().slice(0, 80);
  const lastName = (body.lastName || "").toString().trim().slice(0, 80);
  const email = (body.email || "").toString().trim().slice(0, 160);
  const phone = (body.phone || "").toString().trim().slice(0, 40);
  const vehicle = (body.vehicle || "").toString().trim().slice(0, 160);
  const message = (body.message || "").toString().trim().slice(0, 4000);
  const hearAbout = (body.hearAbout || "").toString().trim().slice(0, 80);
  const name = `${firstName} ${lastName}`.trim();

  if (!firstName || !email || !message) return json({ error: "Missing required fields." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Invalid email address." }, 400);
  const to = env.CONTACT_TO || "jerryduncklee@gmail.com";
  const from = env.CONTACT_FROM || "Blue Rocket <onboarding@resend.dev>";

  const row = (label, value) =>
    `<p style="margin:0 0 8px"><strong>${label}:</strong> ${esc(value) || "—"}</p>`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0a0e17">
      <div style="background:#0a0e17;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0">
        <h2 style="margin:0;font-size:18px">New quote request — Blue Rocket Performance</h2>
      </div>
      <div style="border:1px solid #e6e9ef;border-top:0;border-radius:0 0 10px 10px;padding:24px">
        ${row("Name", name)}
        ${row("Email", email)}
        ${row("Phone", phone)}
        ${row("Vehicle / Bike", vehicle)}
        ${row("Heard about us", hearAbout)}
        <hr style="border:0;border-top:1px solid #e6e9ef;margin:16px 0" />
        <p style="margin:0;white-space:pre-wrap">${esc(message)}</p>
      </div>
    </div>`;

  // Email the shop and drop the quote into EUROWERKS OS at the same time.
  // The customer gets "ok" if either one lands, so a mail hiccup never loses a lead.
  const [mail, os] = await Promise.all([
    sendEmail(env, { from, to, replyTo: email, subject: `New quote request from ${name}`, html }),
    sendToOs(env, { to, name, email, phone, vehicle, hear: hearAbout, message }),
  ]);
  if (mail.ok || os.ok) return json({ ok: true });
  if (mail.skipped && os.skipped) return json({ error: "Email is not configured yet." }, 500);
  return json({ error: "Could not send message.", detail: mail.detail || os.detail }, 502);
}

async function sendEmail(env, { from, to, replyTo, subject, html }) {
  if (!env.RESEND_API_KEY) return { ok: false, skipped: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, html }),
    });
    if (res.ok) return { ok: true };
    return { ok: false, detail: await res.text().catch(() => "") };
  } catch {
    return { ok: false, detail: "Mail service unavailable." };
  }
}

// POST the quote to EUROWERKS OS (Inbox + quote chat + notify email for the Blue Rocket shop).
async function sendToOs(env, quote) {
  if (!env.OS_QUOTE_URL || !env.QUOTE_INGEST_SECRET) return { ok: false, skipped: true };
  try {
    const res = await fetch(env.OS_QUOTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: env.QUOTE_INGEST_SECRET,
        shop: env.OS_SHOP_SLUG || "bluerocketperformance",
        ...quote,
      }),
    });
    if (res.ok) return { ok: true };
    return { ok: false, detail: `OS ${res.status}: ${await res.text().catch(() => "")}` };
  } catch {
    return { ok: false, detail: "OS unavailable." };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/contact") {
      if (request.method === "POST") return handleContact(request, env);
      return json({ error: "Method not allowed." }, 405);
    }
    // Fallback to static assets (also serves 404s for unknown paths).
    return env.ASSETS.fetch(request);
  },
};
