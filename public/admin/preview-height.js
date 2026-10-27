/* Fixed, repository-owned measurements only. The iframe keeps its document
 * when the admin switches between split and full preview, preventing a costly
 * srcdoc reset, re-parse, layout and font loading on every tab switch.
 * It remains opaque-origin and cannot read the parent's DOM or credentials. */
(() => {
  "use strict";
  const marker = document.querySelector('meta[name="garden-preview-token"]');
  const token = marker?.getAttribute("content");
  let mode = marker?.getAttribute("data-preview-mode");
  if (!token || !/^[a-f0-9-]{36}$/u.test(token) || !["full", "split"].includes(mode)) return;

  const scriptOrigin = new URL(document.currentScript.src).origin;
  const scroller = document.scrollingElement || document.documentElement;
  const span = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const progress = () => span() === 0 ? 0 : Math.max(0, Math.min(1, scroller.scrollTop / span()));
  let lastReceived = null;
  let scrollPending = false;
  let resizePending = false;
  let lastHeight = -1;

  const measure = () => {
    resizePending = false;
    if (mode !== "full") return;
    const height = Math.ceil(document.body.getBoundingClientRect().height) + 4;
    if (!Number.isFinite(height) || height < 0 || height === lastHeight) return;
    lastHeight = height;
    parent.postMessage({ type: "garden:preview-height", token, height }, "*");
  };
  const scheduleMeasure = () => {
    if (resizePending || mode !== "full") return;
    resizePending = true;
    // Offscreen iframe requestAnimationFrame may be throttled by browsers.
    setTimeout(measure, 0);
  };
  new ResizeObserver(scheduleMeasure).observe(document.body);
  window.addEventListener("load", scheduleMeasure, { once: true });
  window.addEventListener("resize", scheduleMeasure);
  document.fonts?.ready.then(scheduleMeasure).catch(() => {});

  window.addEventListener("message", event => {
    if (event.source !== parent || event.origin !== scriptOrigin) return;
    const data = event.data;
    if (!data || typeof data !== "object" || Array.isArray(data)
      || data.token !== token) return;
    if (data.type === "garden:preview-mode" && ["full", "split"].includes(data.mode)) {
      mode = data.mode;
      if (mode === "full") {
        lastHeight = -1; // report height even if the text has not changed
        scheduleMeasure();
      }
    } else if (data.type === "garden:scroll-set" && mode === "split"
      && typeof data.progress === "number" && Number.isFinite(data.progress)
      && data.progress >= 0 && data.progress <= 1) {
      lastReceived = data.progress;
      scroller.scrollTop = data.progress * span();
    }
  });
  window.addEventListener("scroll", () => {
    if (mode !== "split") return;
    const value = progress();
    if (lastReceived !== null && Math.abs(value - lastReceived) < .012) {
      lastReceived = null;
      return;
    }
    lastReceived = null;
    if (scrollPending) return;
    scrollPending = true;
    setTimeout(() => {
      scrollPending = false;
      if (mode === "split") parent.postMessage({
        type: "garden:scroll-position", token, progress: progress(),
      }, "*");
    }, 16);
  }, { passive: true });

  if (mode === "full") {
    measure();
    scheduleMeasure();
  }
})();