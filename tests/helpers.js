// Runs the scripts the way the browser does: plain scripts sharing one
// global, each run once, here. And stands in for TCGplayer: a session
// holding a range and a search, serving pages of a list cut from the
// fixture.

import { Window } from "happy-dom";
import { readFileSync } from "fs";

function source(name) {
  return readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
}

globalThis.TCGB = globalThis.TCGB || {};
for (const name of ["money.js", "csv.js", "read.js", "net.js", "walk.js", "handoff.js"]) {
  new Function("globalThis", source(name))(globalThis);
}

export const TCGB = globalThis.TCGB;

export function text(name) {
  return readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
}

// docOf parses markup in a window with no URL, so nothing it names is fetched.
export function docOf(html) {
  const window = new Window({
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true },
  });
  window.document.body.innerHTML = html;
  return window.document;
}

export const fixture = () => docOf(text("orders.html"));

const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, "0").slice(-width);

// pageHTML is page n of a list of total orders in range, as TCGplayer would
// render it with the session holding range and search: the fixture's ten
// orders, as many as page n holds, renumbered so every order of the list is
// its own, and dated in the range's year.
export function pageHTML({ range = "Last 30 Days", search = "", total = 31, n = 1, per = 10 } = {}) {
  const doc = fixture();
  for (const option of doc.querySelectorAll("#DateRange option")) {
    if (option.textContent.trim() === range) option.setAttribute("selected", "selected");
    else option.removeAttribute("selected");
  }
  if (!doc.querySelector(`#DateRange option[selected]`)) throw new Error("no such range: " + range);
  if (search) doc.querySelector("#SearchString").setAttribute("value", search);

  const placed = /^\d{4}$/.test(range) ? range : "the " + range.toLowerCase();
  const first = (n - 1) * per + 1;
  const last = Math.min(n * per, total);
  const crumbs = doc.querySelector(".breadcrumbs span");
  crumbs.textContent = total ? `Viewing ${first} - ${last} of ${total} order(s) placed in ${placed}` : "You do not have any orders to display.";

  const wraps = [...doc.querySelectorAll(".orderWrap")];
  wraps.forEach((wrap, k) => {
    if (k >= last - first + 1) {
      wrap.remove();
      return;
    }
    const g = first + k;
    for (const title of wrap.querySelectorAll(".orderHeader .orderTitle")) {
      const label = title.textContent.trim();
      for (const node of title.parentNode.childNodes) {
        if (node.nodeType !== 3 || !node.textContent.trim()) continue;
        if (label === "Order Number") node.textContent = ` ${hex(g, 8)}-100000-10000 `;
        if (label === "TCGPLAYER DIRECT #") node.textContent = ` 261120-${hex(g, 4)} `;
      }
    }
    if (/^\d{4}$/.test(range)) {
      const date = wrap.querySelector('[data-aid="spn-sellerorderwidget-orderdate"]');
      date.textContent = date.textContent.replace(/\d{4}/, range);
    }
  });

  const pager = doc.querySelector(".pageView");
  const pages = Math.ceil(total / per);
  if (pages <= 1) pager.remove();
  else pager.querySelector("a.pageLast").setAttribute("href", "/myaccount/orderhistory?PageNumber=" + pages);
  return doc.body.innerHTML;
}

// site is TCGplayer's session: a range and a search, set by setFilter as
// the server sets them, and pages served of whatever it holds. totals names
// how many orders each range has (31 for one not named). change(html, n,
// state), when given, rewrites a page or answers with an Error.
export function site({ range = "Last 30 Days", search = "", totals = {}, change, failPost } = {}) {
  const state = { range, search };
  const asked = [];
  const html = (n) => {
    const total = state.range in totals ? totals[state.range] : 31;
    let page = pageHTML({ range: state.range, search: state.search, total, n });
    return change ? change(page, n, state) : page;
  };
  return {
    state,
    asked,
    html,
    fetchPage(n) {
      asked.push("GET " + n);
      const page = html(n);
      return page instanceof Error ? Promise.reject(page) : Promise.resolve(docOf(page));
    },
    setFilter(token, range, search, clear) {
      asked.push(`POST ${range}|${search}|${clear}`);
      if (failPost && failPost(range, search)) return Promise.reject(new Error("TCGplayer answered 500"));
      state.range = range;
      state.search = clear ? "" : search;
      return Promise.resolve();
    },
  };
}
