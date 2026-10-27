/* Runs only inside the opaque-origin, allow-scripts-only preview iframe.
 * The parent verifies both the sending window and a per-render token.
 * No DOM data, article content or credentials are transmitted. */
(() => {
  "use strict";
  const marker = document.querySelector('meta[name="garden-preview-token"]');
  const token = marker?.getAttribute("content");
  if (!token || !/^[a-f0-9-]{36}$/u.test(token)) return;

  let lastHeight = 0;
  let queued = false;
  const measure = () => {
    queued = false;
    // body has content-driven height, unlike the iframe viewport itself.
    const height = Math.ceil(document.body.getBoundingClientRect().height) + 4;
    if (!Number.isFinite(height) || height < 0 || height === lastHeight) return;
    lastHeight = height;
    parent.postMessage({ type: "garden:preview-height", token, height }, "*");
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    // rAF can be entirely suspended for an offscreen sandboxed iframe on
    // mobile; a one-shot task reports height even before the reader scrolls
    // down to the preview.
    setTimeout(measure, 0);
  };
  new ResizeObserver(schedule).observe(document.body);
  window.addEventListener("load", schedule, { once: true });
  window.addEventListener("resize", schedule);
  document.fonts?.ready.then(schedule).catch(() => {});
  // Initial measurement must not depend on viewport visibility.
  measure();
  schedule();
})();
