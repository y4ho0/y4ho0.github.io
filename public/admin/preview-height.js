/* Fixed, repository-owned control channel for an opaque-origin preview iframe.
 * Only two bounded measurements cross the boundary: full-preview height and
 * split-preview scroll fraction. No content, markup, storage or credentials. */
(() => {
  "use strict";
  const marker = document.querySelector('meta[name="garden-preview-token"]');
  const token = marker?.getAttribute("content");
  const mode = marker?.getAttribute("data-preview-mode");
  if (!token || !/^[a-f0-9-]{36}$/u.test(token) || !["full", "split"].includes(mode)) return;

  if (mode === "full") {
    let lastHeight = 0;
    let queued = false;
    const measure = () => {
      queued = false;
      const height = Math.ceil(document.body.getBoundingClientRect().height) + 4;
      if (!Number.isFinite(height) || height < 0 || height === lastHeight) return;
      lastHeight = height;
      parent.postMessage({ type: "garden:preview-height", token, height }, "*");
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      // Unlike rAF, an ordinary task can run before a mobile iframe is in view.
      setTimeout(measure, 0);
    };
    new ResizeObserver(schedule).observe(document.body);
    window.addEventListener("load", schedule, { once: true });
    window.addEventListener("resize", schedule);
    document.fonts?.ready.then(schedule).catch(() => {});
    measure();
    schedule();
    return;
  }

  // Split-mode sync never needs to inspect article text or communicate a
  // cursor position. The proportional position remains bounded in [0,1].
  const scroller = document.scrollingElement || document.documentElement;
  const span = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const progress = () => span() === 0 ? 0 : Math.min(1, Math.max(0, scroller.scrollTop / span()));
  const scriptOrigin = new URL(document.currentScript.src).origin;
  let lastReceived = null;
  let pending = false;

  window.addEventListener("message", event => {
    if (event.source !== parent || event.origin !== scriptOrigin) return;
    const data = event.data;
    if (!data || typeof data !== "object" || Array.isArray(data)
      || data.type !== "garden:scroll-set" || data.token !== token
      || typeof data.progress !== "number" || !Number.isFinite(data.progress)
      || data.progress < 0 || data.progress > 1) return;
    lastReceived = data.progress;
    scroller.scrollTop = data.progress * span();
  });

  window.addEventListener("scroll", () => {
    const value = progress();
    // Ignore the event caused by our own programmatic scroll, but do not
    // suppress the next real wheel/keyboard interaction.
    if (lastReceived !== null && Math.abs(value - lastReceived) < .012) {
      lastReceived = null;
      return;
    }
    lastReceived = null;
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      parent.postMessage({ type: "garden:scroll-position", token, progress: progress() }, "*");
    }, 16);
  }, { passive: true });
})();
