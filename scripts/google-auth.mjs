#!/usr/bin/env node
/**
 * One-time Google connection for Blue Rocket OS.
 *
 *   npm run google-auth
 *
 * Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from .dev.vars, opens Google
 * sign-in (use the shared BRP account), then saves the resulting refresh token
 * to .dev.vars. The token is never printed. Run `npm run push-secrets` after.
 */
import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { readDevVars, writeDevVar, DEV_VARS } from "./dev-vars.mjs";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/adwords",
];

const vars = readDevVars();
const clientId = vars.GOOGLE_CLIENT_ID;
const clientSecret = vars.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error(`\nAdd GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to ${DEV_VARS} first (see README).\n`);
  process.exit(1);
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
const state = b64url(crypto.randomBytes(16));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/callback") return res.writeHead(404).end();

  const finish = (status, message) => {
    res.writeHead(status, { "Content-Type": "text/html" }).end(
      `<body style="font-family:system-ui;padding:40px;background:#080b12;color:#eaeef6"><h2>${message}</h2><p>You can close this tab and go back to the terminal.</p></body>`
    );
    server.close();
  };

  if (url.searchParams.get("state") !== state) return finish(400, "Sign-in check failed. Run the command again.");
  if (url.searchParams.get("error")) {
    console.error(`\nGoogle sign-in was cancelled: ${url.searchParams.get("error")}\n`);
    return finish(400, "Sign-in cancelled.");
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: url.searchParams.get("code"),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(data.error_description || data.error || tokenRes.status);
    if (!data.refresh_token) {
      throw new Error(
        "Google didn't return a refresh token. Remove the app at myaccount.google.com/permissions and run this again."
      );
    }

    const email = data.id_token
      ? JSON.parse(Buffer.from(data.id_token.split(".")[1], "base64url").toString()).email
      : "unknown account";
    const granted = (data.scope || "").split(" ");
    const lacking = SCOPES.filter((s) => s.startsWith("https://") && !granted.includes(s));

    writeDevVar("GOOGLE_REFRESH_TOKEN", data.refresh_token);
    console.log(`\n✔ Connected as ${email}. Token saved to ${DEV_VARS} (not shown).`);
    if (lacking.length) console.log(`  Heads up: these permissions were not ticked: ${lacking.join(", ")}`);
    console.log("  Next: npm run push-secrets\n");
    finish(200, `Connected as ${email}`);
  } catch (err) {
    console.error(`\nCould not finish connecting: ${err.message}\n`);
    finish(500, "Something went wrong — check the terminal.");
  }
});

let redirectUri = "";
server.listen(0, "127.0.0.1", () => {
  redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

  console.log("\nSign in with the shared BRP Google account and tick every permission.");
  console.log("If a browser doesn't open, paste this link into one:\n");
  console.log(authUrl + "\n");
  const opener = process.platform === "win32" ? 'start ""' : process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${opener} "${authUrl}"`, () => {});
});
