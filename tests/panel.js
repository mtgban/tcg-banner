// Stands the content script up the way the browser does: one window at the
// order history's address, the scripts the manifest names in its order,
// evaluated in that window so document and location mean what they mean in
// a tab. Everything that would leave the page is recorded instead: fetches
// go to a fake session, downloads are kept, window.open answers with a
// stand-in for mtgban's handoff tab, and a form submission is caught.
//
// The window has a TCGplayer URL, so what it is given must name nothing it
// could fetch: the fixture carries no script, stylesheet or image source.

import { Window } from "happy-dom";
import { readFileSync } from "fs";
import { site } from "./helpers.js";

const URL_ = "https://store.tcgplayer.com/myaccount/orderhistory";
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

function source(name) {
  return readFileSync(new URL("../" + name, import.meta.url), "utf8");
}

// mount opens the order history with the session as options describe it
// (see site in helpers.js); body, when given, is the page instead.
export function mount(options = {}) {
  const session = site(options);
  const window = new Window({
    url: URL_,
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true },
  });
  const document = window.document;
  document.body.innerHTML = options.body ?? session.html(1);

  window.fetch = (url, init = {}) => {
    const asked = String(url);
    let answer;
    if (init.method === "POST") {
      const form = new URLSearchParams(init.body);
      answer = session
        .setFilter(form.get("__RequestVerificationToken"), form.get("DateRange"), form.get("SearchString"), form.get("ClearSessionFilters") === "true")
        .then(() => "<p>posted</p>");
    } else {
      const n = /[?&]PageNumber=(\d+)$/.exec(asked);
      session.asked.push("GET " + (n ? Number(n[1]) : 1));
      const page = session.html(n ? Number(n[1]) : 1);
      answer = page instanceof Error ? Promise.reject(page) : Promise.resolve(page);
    }
    return answer.then((text) => ({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve(text) }));
  };

  const saved = [];
  window.URL.createObjectURL = (blob) => {
    saved.push({ blob });
    return "blob:none";
  };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {
    saved[saved.length - 1].name = this.download;
  };

  // The handoff tab: what was opened, and what was posted to it.
  const tabs = [];
  window.open = (url) => {
    if (options.blockPopups) return null;
    const tab = {
      url,
      closed: false,
      posted: [],
      postMessage: (data, origin) => tab.posted.push({ data, origin }),
      close: () => {
        tab.closed = true;
      },
    };
    tabs.push(tab);
    return tab;
  };

  const submitted = [];
  document.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    submitted.push(Object.fromEntries(new window.FormData(form, event.submitter).entries()));
  });

  for (const entry of manifest.content_scripts) {
    for (const script of entry.js) {
      window.eval(source(script));
    }
  }
  window.TCGB.PACE = 0;

  const panel = document.getElementById("tcg-banner");
  const at = (selector) => panel && panel.querySelector(selector);

  return {
    window,
    document,
    panel,
    session,
    saved,
    tabs,
    submitted,
    word: () => at(".tcg-banner-word").textContent,
    tip: () => at(".tcg-banner-tip").textContent,
    year: () => at(".tcg-banner-year"),
    button: (text) => [...panel.querySelectorAll(".tcg-banner-go")].find((b) => b.textContent === text),
    failed: () => !at(".tcg-banner-mark").hidden && at(".tcg-banner-mark").classList.contains("tcg-banner-failed"),
    done: () => !at(".tcg-banner-mark").hidden && !at(".tcg-banner-mark").classList.contains("tcg-banner-failed"),
    busy: () => panel.classList.contains("tcg-banner-busy"),
    titled: () => panel.querySelectorAll("[title]").length,
    below: () => {
      const children = [...panel.children];
      return children.slice(children.indexOf(at(".tcg-banner-actions")) + 1).length;
    },
    choose: (value) => {
      at(".tcg-banner-year").value = value;
      at(".tcg-banner-year").dispatchEvent(new window.Event("change"));
    },
    escape: () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })),
    file: async (i = 0) => ({ name: saved[i].name, text: await saved[i].blob.text() }),
    // ready is mtgban's handoff page saying it is listening, from tab i.
    ready: (i = 0, origin = "https://mtgban.com") =>
      window.dispatchEvent(new window.MessageEvent("message", { data: { type: "mtgban-handoff-ready" }, origin, source: tabs[i] })),
    // idle waits for the work a click started to finish.
    idle: async () => {
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        await new Promise((done) => setTimeout(done, 10));
        if (!panel.classList.contains("tcg-banner-busy")) return;
      }
      throw new Error("still busy");
    },
  };
}
