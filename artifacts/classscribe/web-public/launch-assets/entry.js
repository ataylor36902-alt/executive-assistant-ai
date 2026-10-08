// Route only the original launch-ad destination. Account and app links stay intact.
(() => {
  const params = new URLSearchParams(window.location.search);
  // The Account view is rendered asynchronously, after the browser's initial
  // fragment jump. Keep this ad-only link focused on the existing signup section.
  if (window.location.pathname === "/" && params.get("cs_account") === "1" &&
      window.location.hash === "#clerk-account-heading" &&
      params.get("utm_source") === "meta_ad") {
    const openSignupSection = () => {
      let observer;
      const reveal = () => {
        const heading = document.getElementById("clerk-account-heading");
        const start = document.getElementById("clerk-signup-age-start");
        // Wait for Clerk's initial mount/focus and the opening animation.
        // Jumping earlier lets initialization move the viewport back up.
        if (!heading || !start || start.hidden || document.getElementById("launch-intro")) return false;
        heading.scrollIntoView({ block: "start" });
        observer?.disconnect();
        return true;
      };
      if (reveal()) return;
      observer = new MutationObserver(reveal);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
      setTimeout(() => observer.disconnect(), 15000);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", openSignupSection, { once: true });
    } else openSignupSection();
    return;
  }
  if (window.location.pathname !== "/" || window.location.hash ||
      params.has("cs_account") || params.has("billing") || params.has("credits")) return;
  if (params.get("utm_source") !== "meta_ad" ||
      params.get("utm_medium") !== "video" ||
      params.get("utm_campaign") !== "launch") return;
  window.location.replace("/launch.html" + window.location.search);
})();
