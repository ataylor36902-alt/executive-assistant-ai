// Keep attribution in the URL only. This does not collect or report conversions.
(() => {
  const incoming = new URLSearchParams(window.location.search);
  const destination = new URLSearchParams({ cs_account: "1" });
  const defaults = { utm_source: "meta_ad", utm_medium: "video", utm_campaign: "launch" };
  for (const [key, value] of Object.entries(defaults)) {
    destination.set(key, incoming.get(key) || value);
  }
  for (const key of ["utm_content", "utm_term"]) {
    if (incoming.get(key)) destination.set(key, incoming.get(key));
  }
  const href = "/?" + destination.toString() + "#clerk-account-heading";
  document.querySelectorAll("[data-signup]").forEach(link => { link.href = href; });
})();
