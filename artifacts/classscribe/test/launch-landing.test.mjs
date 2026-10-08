import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const campaign = "utm_source=meta_ad&utm_medium=video&utm_campaign=launch";

function entry(path) {
  const url = new URL(path, "https://class-scribe.replit.app");
  let redirect;
  vm.runInNewContext(read("web-public/launch-assets/entry.js"), {
    URLSearchParams,
    window: { location: {
      pathname: url.pathname, search: url.search, hash: url.hash,
      replace: value => { redirect = value; },
    } },
    document: { readyState: "loading", addEventListener() {} },
  });
  return redirect;
}

test("the original ad URL reaches the landing page with attribution intact", () => {
  assert.equal(entry("/?" + campaign), "/launch.html?" + campaign);
  assert.equal(entry("/?" + campaign + "&utm_content=variant_b"), "/launch.html?" + campaign + "&utm_content=variant_b");
});

test("ordinary app, account, instructor, payment and hash routes stay unchanged", () => {
  for (const path of ["/", "/?cs_account=1&" + campaign, "/instructor?" + campaign,
    "/?billing=success&" + campaign, "/?credits=success&" + campaign, "/?" + campaign + "#account",
    "/?utm_source=other&utm_medium=video&utm_campaign=launch"]) {
    assert.equal(entry(path), undefined, path);
  }
});

test("all signup links retain only attribution and reach the supported Account entry", () => {
  for (const query of ["", "?" + campaign + "&utm_content=variant_a&other=ignored"]) {
    const links = [{}, {}, {}];
    vm.runInNewContext(read("web-public/launch-assets/launch.js"), {
      URLSearchParams, window: { location: { search: query } },
      document: { querySelectorAll: selector => {
        assert.equal(selector, "[data-signup]");
        return links;
      } },
    });
    for (const link of links) {
      const url = new URL(link.href, "https://class-scribe.replit.app");
      assert.equal(url.pathname, "/");
      assert.equal(url.searchParams.get("cs_account"), "1");
      for (const [key, value] of new URLSearchParams(campaign)) assert.equal(url.searchParams.get(key), value);
      assert.equal(url.searchParams.has("other"), false);
      assert.equal(url.hash, "#clerk-account-heading");
    }
  }
});

test("source and served app both load the same narrowly scoped entry router", () => {
  for (const file of ["web-src/1_head.html", "web-public/index.html"]) {
    assert.match(read(file), /<script src="\/launch-assets\/entry\.js"><\/script>/);
  }
  const app = read("web-public/index.html");
  assert.match(app, /get\('cs_account'\)==='1'\)S\.view=\{name:'account'\}/);
  assert.match(app, /id="clerk-account-heading"/);
  assert.match(app, /data-act="clerkSignupAgeStart"/);
});

test("the ad signup link reveals Account's existing signup section after rendering", () => {
  let ready, mutation, disconnected = false, revealed = false, present = false, intro = true, signupHidden = true;
  vm.runInNewContext(read("web-public/launch-assets/entry.js"), {
    URLSearchParams,
    window: { location: { pathname: "/", search: "?cs_account=1&" + campaign, hash: "#clerk-account-heading" } },
    document: {
      readyState: "loading", body: {},
      addEventListener: (name, handler) => { assert.equal(name, "DOMContentLoaded"); ready = handler; },
      getElementById: id => {
        if (id === "launch-intro") return intro ? {} : null;
        if (id === "clerk-signup-age-start") return present ? { hidden: signupHidden } : null;
        assert.equal(id, "clerk-account-heading");
        return present ? { scrollIntoView: () => { revealed = true; } } : null;
      },
    },
    MutationObserver: class {
      constructor(handler) { mutation = handler; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    setTimeout() {},
  });
  ready();
  assert.equal(revealed, false);
  present = true;
  mutation();
  assert.equal(revealed, false);
  signupHidden = false;
  mutation();
  assert.equal(revealed, false);
  intro = false;
  mutation();
  assert.equal(revealed, true);
  assert.equal(disconnected, true);
});

test("landing copy discloses plan boundaries, demo data and supported signup steps", () => {
  const html = read("web-public/launch.html");
  for (const text of ["Study guides require Student or Pro", "Free, Student and Pro",
    "EDU, Law and Medicine are coming soon for new sign-ups", "Fictional demonstration with sample data",
    "Create a new account", "required age check"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/data-signup/g) || []).length, 2);
  assert.match(html, /launch-assets\/launch\.js/);
});
