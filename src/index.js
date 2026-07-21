/**
 * Blue Rocket Performance — Cloudflare Worker
 * Serves the static site from ./public and handles the Resend contact form.
 *
 * Secrets / vars (set before deploy):
 *   RESEND_API_KEY  -> npx wrangler secret put RESEND_API_KEY
 *   CONTACT_TO      -> inbox for quotes (wrangler.toml [vars] or secret)
 *   CONTACT_FROM    -> a verified Resend sender (defaults to onboarding@resend.dev)
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
  if (!env.RESEND_API_KEY) return json({ error: "Email is not configured yet." }, 500);

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

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: `New quote request from ${name}`,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return json({ error: "Could not send message.", detail }, 502);
    }
    return json({ ok: true });
  } catch {
    return json({ error: "Mail service unavailable." }, 502);
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
