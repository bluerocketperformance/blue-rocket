/* =====================================================================
   BLUE ROCKET PERFORMANCE — main.js
   ===================================================================== */
(function () {
  "use strict";

  /* ---- year ---- */
  const yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---- nav scroll state + progress bar ---- */
  const nav = document.getElementById("nav");
  const progress = document.getElementById("scrollProgress");
  let ticking = false;
  function onScroll() {
    const y = window.scrollY;
    nav.classList.toggle("scrolled", y > 20);
    const h = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    ticking = false;
  }
  window.addEventListener("scroll", () => {
    if (!ticking) { window.requestAnimationFrame(onScroll); ticking = true; }
  }, { passive: true });
  onScroll();

  /* ---- mobile menu ---- */
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open);
    });
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      })
    );
  }

  /* ---- lightbox gallery ---- */
  const gallery = document.getElementById("gallery");
  const lb = document.getElementById("lightbox");
  if (gallery && lb) {
    const items = [...gallery.querySelectorAll(".g-item")];
    const lbImg = document.getElementById("lbImg");
    const lbCap = document.getElementById("lbCap");
    let idx = 0;
    const show = (i) => {
      idx = (i + items.length) % items.length;
      const img = items[idx].querySelector("img");
      const cap = items[idx].querySelector("figcaption");
      lbImg.src = img.src;
      lbImg.alt = img.alt;
      lbCap.textContent = cap ? cap.textContent : "";
    };
    const open = (i) => { show(i); lb.classList.add("open"); lb.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; };
    const close = () => { lb.classList.remove("open"); lb.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; };
    items.forEach((it, i) => it.addEventListener("click", () => open(i)));
    document.getElementById("lbClose").addEventListener("click", close);
    document.getElementById("lbPrev").addEventListener("click", (e) => { e.stopPropagation(); show(idx - 1); });
    document.getElementById("lbNext").addEventListener("click", (e) => { e.stopPropagation(); show(idx + 1); });
    lb.addEventListener("click", (e) => { if (e.target === lb) close(); });
    document.addEventListener("keydown", (e) => {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") show(idx - 1);
      else if (e.key === "ArrowRight") show(idx + 1);
    });
  }

  /* ---- request-a-quote form (Resend via Worker) ---- */
  const form = document.getElementById("contactForm");
  const status = document.getElementById("formStatus");
  const submitBtn = document.getElementById("submitBtn");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = "";
      status.className = "form-status";

      const val = (id) => (form.querySelector("#" + id)?.value || "").trim();
      const data = {
        firstName: val("firstName"),
        lastName: val("lastName"),
        email: val("email"),
        phone: val("phone"),
        vehicle: val("vehicle"),
        message: val("message"),
        hearAbout: val("hearAbout"),
      };

      if (!data.firstName || !data.email || !data.message) {
        status.textContent = "Please add your name, email, and a message.";
        status.classList.add("err");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        status.textContent = "That email doesn't look right.";
        status.classList.add("err");
        return;
      }

      submitBtn.classList.add("loading");
      try {
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const out = await res.json().catch(() => ({}));
        if (res.ok) {
          status.textContent = "Thanks — we'll get back to you shortly.";
          status.classList.add("ok");
          form.reset();
        } else {
          status.textContent = out.error || "Something went wrong. Please call or text us instead.";
          status.classList.add("err");
        }
      } catch (err) {
        status.textContent = "Network error — please try again.";
        status.classList.add("err");
      } finally {
        submitBtn.classList.remove("loading");
      }
    });
  }
})();
