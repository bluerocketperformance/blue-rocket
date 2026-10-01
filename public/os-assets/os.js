/* Blue Rocket OS — dashboard front end. Data comes from /api/os/* (login required). */
(() => {
  "use strict";

  const app = document.getElementById("app");
  const tooltip = document.getElementById("tooltip");
  const state = { tab: "marketing", days: 28 };

  /* ---------- tiny DOM helper (API strings always go in as text) ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const nf = new Intl.NumberFormat("en-US");
  const fmt = {
    int: (v) => nf.format(Math.round(v)),
    pct: (v) => (v * 100).toFixed(1) + "%",
    pos: (v) => (v ? v.toFixed(1) : "—"),
    money: (v, cur = "USD") =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: v < 100 ? 2 : 0 }).format(v),
  };
  const shortDate = (iso) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  async function api(path) {
    const res = await fetch(path, { credentials: "same-origin" });
    if (res.status === 401) {
      location.href = "/os";
      throw new Error("Signed out.");
    }
    const data = await res.json().catch(() => ({ error: "Bad response from server." }));
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ").");
    return data;
  }

  /* ---------- cards ---------- */
  // Each card keeps its last render while refetching (no layout jump).
  function card(title, sub) {
    const body = h("div", { class: "card-body" }, h("p", { class: "note", text: "Loading…" }));
    const subEl = h("span", { class: "sub", text: sub || "" });
    const el = h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: title }), subEl), body);
    return {
      el,
      async load(fn, render) {
        el.classList.add("loading");
        try {
          const data = await fn();
          body.replaceChildren(...(data.configured === false ? notConfigured(data.missing) : render(data, subEl)));
        } catch (err) {
          body.replaceChildren(h("p", { class: "note error", text: err.message }));
        } finally {
          el.classList.remove("loading");
        }
      },
    };
  }

  function notConfigured(missingKeys) {
    return [
      h(
        "p",
        { class: "note" },
        "Not connected yet. Missing: ",
        ...missingKeys.flatMap((k, i) => [i ? ", " : "", h("code", { text: k })]),
        ". See the README's “Blue Rocket OS” section."
      ),
    ];
  }

  function tiles(items) {
    return h(
      "div",
      { class: "tiles" },
      items.map(({ label, value, prev, format, lowerIsBetter }) => {
        let delta = "";
        if (prev) {
          const change = (value - prev) / prev;
          const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "•";
          const good = lowerIsBetter ? change < 0 : change > 0;
          delta = arrow + " " + Math.abs(change * 100).toFixed(0) + "% vs prior" + (change && good ? " (better)" : "");
        } else if (prev === 0 && value) delta = "new vs prior";
        return h(
          "div",
          { class: "tile" },
          h("div", { class: "label", text: label }),
          h("div", { class: "value", text: format(value) }),
          h("div", { class: "delta", text: delta || " " })
        );
      })
    );
  }

  function table(columns, rows, empty = "No data for this period.") {
    if (!rows.length) return h("p", { class: "note", text: empty });
    return h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        null,
        h("thead", null, h("tr", null, columns.map((c) => h("th", { class: c.num ? "num" : "", text: c.label })))),
        h(
          "tbody",
          null,
          rows.map((row) =>
            h(
              "tr",
              null,
              columns.map((c) => {
                const v = c.value(row);
                return h("td", { class: c.num ? "num" : "text", title: c.num ? null : String(v) }, v instanceof Node ? v : String(v));
              })
            )
          )
        )
      )
    );
  }

  /* ---------- single-series line chart with crosshair tooltip ---------- */
  function lineChart(title, points, format, opts = {}) {
    const wrap = h("div", { class: "chart" }, h("div", { class: "chart-title", text: title }));
    const height = opts.height || 160;
    const draw = () => {
      wrap.querySelector("svg")?.remove();
      const width = Math.max(wrap.clientWidth, 240);
      const pad = { l: 44, r: 8, t: 8, b: 22 };
      const iw = width - pad.l - pad.r;
      const ih = height - pad.t - pad.b;
      const max = opts.max || Math.max(...points.map((p) => p.value), 1);
      const x = (i) => pad.l + (points.length > 1 ? (i / (points.length - 1)) * iw : iw / 2);
      const y = (v) => pad.t + ih - (v / max) * ih;
      const ns = "http://www.w3.org/2000/svg";
      const s = (tag, attrs) => {
        const el = document.createElementNS(ns, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        return el;
      };
      const svg = s("svg", { width, height, role: "img", "aria-label": title });
      [0, 0.5, 1].forEach((f) => {
        const yy = pad.t + ih - f * ih;
        svg.append(s("line", { class: "grid", x1: pad.l, x2: width - pad.r, y1: yy, y2: yy }));
        const t = s("text", { class: "axis", x: pad.l - 6, y: yy + 4, "text-anchor": "end" });
        t.textContent = format(max * f);
        svg.append(t);
      });
      if (points.length) {
        const labels = [0, points.length - 1];
        labels.forEach((i, n) => {
          const t = s("text", { class: "axis", x: x(i), y: height - 4, "text-anchor": n ? "end" : "start" });
          t.textContent = opts.label ? opts.label(points[i]) : points[i].date;
          svg.append(t);
        });
        svg.append(s("path", { class: "line", d: points.map((p, i) => (i ? "L" : "M") + x(i) + " " + y(p.value)).join("") }));
      }
      const hair = s("line", { class: "hair", y1: pad.t, y2: pad.t + ih, visibility: "hidden" });
      const dot = s("circle", { class: "dot", r: 4, visibility: "hidden" });
      svg.append(hair, dot);
      const hit = s("rect", { x: pad.l, y: 0, width: iw, height, fill: "transparent" });
      svg.append(hit);
      const show = (evt) => {
        if (!points.length) return;
        const rect = svg.getBoundingClientRect();
        const px = evt.clientX - rect.left;
        const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / iw) * (points.length - 1))));
        const p = points[i];
        [hair].forEach((l) => (l.setAttribute("x1", x(i)), l.setAttribute("x2", x(i)), l.setAttribute("visibility", "visible")));
        dot.setAttribute("cx", x(i));
        dot.setAttribute("cy", y(p.value));
        dot.setAttribute("visibility", "visible");
        tooltip.replaceChildren(h("strong", { text: format(p.value) }), h("span", { text: opts.label ? opts.label(p) : p.date }));
        tooltip.hidden = false;
        const tx = Math.min(evt.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8);
        tooltip.style.left = tx + "px";
        tooltip.style.top = evt.clientY - tooltip.offsetHeight - 12 + "px";
      };
      const hide = () => {
        tooltip.hidden = true;
        hair.setAttribute("visibility", "hidden");
        dot.setAttribute("visibility", "hidden");
      };
      hit.addEventListener("pointermove", show);
      hit.addEventListener("pointerleave", hide);
      wrap.append(svg);
    };
    requestAnimationFrame(draw);
    new ResizeObserver(() => requestAnimationFrame(draw)).observe(wrap);
    return wrap;
  }

  const rangeLabel = (r) => shortDate(r.start) + " – " + shortDate(r.end);
  const dailyLabel = (p) => shortDate(p.date);

  /* ---------- Marketing tab ---------- */
  function renderMarketing() {
    const filters = h(
      "div",
      { class: "filters", role: "group", "aria-label": "Date range" },
      h("span", { text: "Range" }),
      [7, 28, 90].map((d) =>
        h("button", {
          class: "chip",
          "aria-pressed": String(state.days === d),
          text: "Last " + d + " days",
          onclick: () => {
            state.days = d;
            filters.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.textContent === "Last " + d + " days")));
            loadAll();
          },
        })
      )
    );

    const ga = card("Website traffic", "Google Analytics 4");
    const sc = card("Google search", "Search Console");
    const ads = card("Google Ads", "Ads overview");
    app.replaceChildren(filters, ga.el, sc.el, ads.el);

    function loadAll() {
      const q = "?days=" + state.days;

      ga.load(
        () => api("/api/os/ga4" + q),
        (d, sub) => {
          sub.textContent = "Google Analytics 4 · " + rangeLabel(d.range);
          return [
            tiles([
              { label: "Sessions", value: d.totals.sessions, prev: d.previous.sessions, format: fmt.int },
              { label: "Users", value: d.totals.users, prev: d.previous.users, format: fmt.int },
              { label: "Key events (leads)", value: d.totals.keyEvents, prev: d.previous.keyEvents, format: fmt.int },
              { label: "Engagement rate", value: d.totals.engagementRate, prev: d.previous.engagementRate, format: fmt.pct },
            ]),
            lineChart("Sessions per day", d.daily, fmt.int, { label: dailyLabel }),
            h(
              "div",
              { class: "split" },
              table(
                [
                  { label: "Channel", value: (r) => r.name },
                  { label: "Sessions", num: true, value: (r) => fmt.int(r.sessions) },
                  { label: "Key events", num: true, value: (r) => fmt.int(r.keyEvents) },
                ],
                d.channels
              ),
              table(
                [
                  { label: "Top page", value: (r) => r.path },
                  { label: "Views", num: true, value: (r) => fmt.int(r.views) },
                ],
                d.pages
              )
            ),
          ];
        }
      );

      sc.load(
        () => api("/api/os/search-console" + q),
        (d, sub) => {
          sub.textContent = "Search Console · " + rangeLabel(d.range) + " (data lags ~3 days)";
          return [
            tiles([
              { label: "Clicks", value: d.totals.clicks, prev: d.previous.clicks, format: fmt.int },
              { label: "Impressions", value: d.totals.impressions, prev: d.previous.impressions, format: fmt.int },
              { label: "Click-through rate", value: d.totals.ctr, prev: d.previous.ctr, format: fmt.pct },
              { label: "Avg. position", value: d.totals.position, prev: d.previous.position, format: fmt.pos, lowerIsBetter: true },
            ]),
            lineChart("Clicks per day", d.daily, fmt.int, { label: dailyLabel }),
            h(
              "div",
              { class: "split" },
              table(
                [
                  { label: "Search query", value: (r) => r.key },
                  { label: "Clicks", num: true, value: (r) => fmt.int(r.clicks) },
                  { label: "Impr.", num: true, value: (r) => fmt.int(r.impressions) },
                  { label: "Pos.", num: true, value: (r) => fmt.pos(r.position) },
                ],
                d.queries
              ),
              table(
                [
                  { label: "Page", value: (r) => r.key.replace(/^https?:\/\/[^/]+/, "") || "/" },
                  { label: "Clicks", num: true, value: (r) => fmt.int(r.clicks) },
                  { label: "Pos.", num: true, value: (r) => fmt.pos(r.position) },
                ],
                d.pages
              )
            ),
          ];
        }
      );

      ads.load(
        () => api("/api/os/ads" + q),
        (d, sub) => {
          sub.textContent = "Google Ads · " + rangeLabel(d.range);
          const money = (v) => fmt.money(v, d.currency);
          const cpc = (m) => (m.clicks ? m.cost / m.clicks : 0);
          const cpa = (m) => (m.conversions ? m.cost / m.conversions : 0);
          return [
            tiles([
              { label: "Spend", value: d.totals.cost, prev: d.previous.cost, format: money },
              { label: "Clicks", value: d.totals.clicks, prev: d.previous.clicks, format: fmt.int },
              { label: "Avg. CPC", value: cpc(d.totals), prev: cpc(d.previous), format: money, lowerIsBetter: true },
              { label: "Conversions", value: d.totals.conversions, prev: d.previous.conversions, format: fmt.int },
              { label: "Cost / conversion", value: cpa(d.totals), prev: cpa(d.previous), format: money, lowerIsBetter: true },
            ]),
            lineChart("Spend per day", d.daily, money, { label: dailyLabel }),
            table(
              [
                { label: "Campaign", value: (r) => r.name },
                { label: "Status", value: (r) => r.status.toLowerCase() },
                { label: "Spend", num: true, value: (r) => money(r.cost) },
                { label: "Clicks", num: true, value: (r) => fmt.int(r.clicks) },
                { label: "Conv.", num: true, value: (r) => fmt.int(r.conversions) },
                { label: "CPC", num: true, value: (r) => money(cpc(r)) },
              ],
              d.campaigns,
              "No campaign activity in this period."
            ),
          ];
        }
      );
    }

    loadAll();
  }

  /* ---------- Trends tab ---------- */
  function renderTrends() {
    const ranks = card("Keyword rankings", "SerpAPI");
    const interest = card("Search interest", "Google Trends via SerpAPI");
    app.replaceChildren(ranks.el, interest.el);

    ranks.load(
      () => api("/api/os/rankings"),
      (d, sub) => {
        const checked = d.rows.map((r) => r.checkedAt).sort()[0];
        sub.textContent = "Searched from " + d.location + (checked ? " · checked " + new Date(checked).toLocaleString() : "");
        const place = (v, outside) => (v == null ? h("span", { class: "muted", text: outside }) : "#" + v);
        return [
          table(
            [
              { label: "Keyword", value: (r) => r.keyword },
              { label: "Google (organic)", num: true, value: (r) => place(r.organic, "not top 10") },
              { label: "Map pack", num: true, value: (r) => place(r.local, "not shown") },
              {
                label: "Our ranking page / #1 result",
                value: (r) => (r.url ? r.url.replace(/^https?:\/\/[^/]+/, "") || "/" : r.leader ? "#1: " + r.leader.title : "—"),
              },
            ],
            d.rows,
            "No keywords set."
          ),
          h("p", { class: "note", text: "Results are cached for 12 hours to save SerpAPI credits." }),
        ];
      }
    );

    interest.load(
      () => api("/api/os/trends"),
      (d, sub) => {
        sub.textContent = "Google Trends · " + d.geo + " · last 12 months";
        if (!d.series.length || !d.series[0].points.length) return [h("p", { class: "note", text: "No trend data returned." })];
        return [
          h(
            "p",
            { class: "note", style: "margin-bottom:12px" },
            "0–100 scale shared across all keywords (100 = the busiest week for any of them)."
          ),
          h(
            "div",
            { class: "multiples" },
            d.series.map((s) =>
              lineChart(s.keyword, s.points, (v) => fmt.int(v), { max: 100, height: 120, label: (p) => p.date })
            )
          ),
        ];
      }
    );
  }

  /* ---------- tabs ---------- */
  const tabs = document.querySelectorAll(".tabs button");
  function show(tab) {
    state.tab = tab;
    tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    try {
      localStorage.setItem("os-tab", tab);
    } catch {}
    tooltip.hidden = true;
    (tab === "trends" ? renderTrends : renderMarketing)();
  }
  tabs.forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  let saved = "marketing";
  try {
    saved = localStorage.getItem("os-tab") || saved;
  } catch {}
  show(saved === "trends" ? "trends" : "marketing");
})();
