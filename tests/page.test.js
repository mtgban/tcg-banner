// The content script in a window: what a click on the page does.

import { test, expect, describe } from "bun:test";
import { mount } from "./panel.js";
import { TCGB, docOf, pageHTML } from "./helpers.js";

describe("the panel", () => {
  test("offers TCGplayer's ranges, the last days then the years, and nothing under its buttons", () => {
    const p = mount();
    const options = [...p.year().options];
    expect(options.map((o) => o.value).slice(0, 4)).toEqual(["Last 30 Days", "Last 90 Days", "Last 120 Days", "2026"]);
    expect(options.map((o) => o.textContent).slice(0, 4)).toEqual(["30 days", "90 days", "120 days", "2026"]);
    expect(options.at(-1).value).toBe("2016");
    // The range the page shows.
    expect(p.year().value).toBe("Last 30 Days");
    expect(p.panel.querySelectorAll(".tcg-banner-go").length).toBe(1);
    expect(!!p.button("Download CSV")).toBe(true);
    expect(p.below()).toBe(0);
    expect(p.titled()).toBe(0);
  });

  test("is ready, with a tick and no dangling dash, until asked for something", () => {
    const p = mount();
    expect(p.word()).toBe("ready");
    expect(p.done()).toBe(true);
    expect(p.panel.querySelector(".tcg-banner-sep").hidden).toBe(false);
    expect(p.tip()).toBe("Save a range of orders as CSV");
    expect(p.panel.querySelector(".tcg-banner-label").textContent).toBe("TCG BANner - ready✓");
    // A panel given no word shows no dash either.
    expect(p.window.TCGB.panel().root.querySelector(".tcg-banner-sep").hidden).toBe(true);
  });

  test("is ready again once another year is chosen", async () => {
    const p = mount({ totals: { 2025: 23 } });
    p.choose("2025");
    p.button("Download CSV").click();
    await p.idle();
    p.choose("2024");
    expect(p.word()).toBe("ready");
    expect(p.done()).toBe(true);
    expect(p.tip()).toBe("Save a range of orders as CSV");
  });

  test("picks the year the page already shows", () => {
    const p = mount({ range: "2024" });
    expect(p.year().value).toBe("2024");
  });

  test("works at every spelling of the path the server answers", async () => {
    for (const path of ["//myaccount/orderhistory", "/MyAccount/OrderHistory", "/myaccount/orderhistory/?PageNumber=2"]) {
      const p = mount({ url: "https://store.tcgplayer.com" + path, totals: { 2025: 23 } });
      expect([path, !!p.panel]).toEqual([path, true]);
    }
    const p = mount({ url: "https://store.tcgplayer.com//myaccount/orderhistory", totals: { 2025: 23 } });
    p.choose("2025");
    p.button("Download CSV").click();
    await p.idle();
    expect(p.word()).toBe("23 orders");
  });

  test("stays off the site's other pages", () => {
    // The manifest runs it on the whole store; the order history's markup
    // on another path is still not the order history.
    const p = mount({ url: "https://store.tcgplayer.com/myaccount/messagecenter" });
    expect(p.panel === null).toBe(true);
    expect(p.document.querySelectorAll("button.tcg-banner-order").length).toBe(0);
  });

  test("is not put on a page without the order history", () => {
    const p = mount({ body: "<form id=login></form>" });
    expect(p.panel === null).toBe(true);
  });
});

describe("Download CSV", () => {
  test("walks the year and saves its orders", async () => {
    const p = mount({ totals: { 2025: 23 } });
    p.choose("2025");
    p.button("Download CSV").click();
    expect(p.busy()).toBe(true);
    await p.idle();
    const file = await p.file();
    expect(file.name).toBe("tcg-orders-2025.csv");
    expect(file.text.trimEnd().split("\n").length).toBe(1 + 23);
    expect(p.word()).toBe("23 orders");
    expect(p.done()).toBe(true);
    expect(p.tip()).toContain("Saved tcg-orders-2025.csv from 3 pages");
    expect(p.session.state).toEqual({ range: "Last 30 Days", search: "" });
  });

  test("walks the last days and names the file for the day it was read", async () => {
    const p = mount({ totals: { "Last 90 Days": 14 } });
    p.choose("Last 90 Days");
    p.button("Download CSV").click();
    await p.idle();
    const file = await p.file();
    expect(file.name).toMatch(/^tcg-orders-last-90-days-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(file.text.trimEnd().split("\n").length).toBe(1 + 14);
    expect(p.word()).toBe("14 orders");
    expect(p.session.state).toEqual({ range: "Last 30 Days", search: "" });
  });

  test("the last days are walked again each time, as they move on", async () => {
    const p = mount();
    p.button("Download CSV").click();
    await p.idle();
    const asked = p.session.asked.length;
    p.button("Download CSV").click();
    await p.idle();
    expect(p.session.asked.length).toBeGreaterThan(asked);
  });

  test("no orders in the last days says so in TCGplayer's words", async () => {
    const p = mount({ totals: { "Last 30 Days": 0 } });
    p.button("Download CSV").click();
    await p.idle();
    expect(p.tip()).toBe("No orders were placed in the last 30 days");
  });

  test("asking for a year again needs no second walk", async () => {
    const p = mount({ totals: { 2025: 23 } });
    p.choose("2025");
    p.button("Download CSV").click();
    await p.idle();
    const asked = p.session.asked.length;
    p.button("Download CSV").click();
    await p.idle();
    expect(p.session.asked.length).toBe(asked);
    expect((await p.file(1)).name).toBe("tcg-orders-2025.csv");
  });

  test("a year with no orders saves nothing and says so", async () => {
    const p = mount({ totals: { 2016: 0 } });
    p.choose("2016");
    p.button("Download CSV").click();
    await p.idle();
    expect(p.saved.length).toBe(0);
    expect(p.failed()).toBe(true);
    expect(p.tip()).toBe("No orders were placed in 2016");
  });

  test("a year with no orders still says when the range could not be put back", async () => {
    const p = mount({ totals: { 2016: 0 }, failPost: (range) => range === "Last 30 Days" });
    p.choose("2016");
    p.button("Download CSV").click();
    await p.idle();
    expect(p.tip()).toBe("No orders were placed in 2016\nThe order list was left on 2016; pick Last 30 Days again");
  });

  test("a refused walk saves nothing, with the reason on the tooltip", async () => {
    const p = mount({
      totals: { 2025: 23 },
      change: (html, n, state) => (state.range === "2025" && n === 2 ? html.replace("Subtotal:", "Discount:") : html),
    });
    p.choose("2025");
    p.button("Download CSV").click();
    await p.idle();
    expect(p.saved.length).toBe(0);
    expect(p.failed()).toBe(true);
    expect(p.tip()).toContain('an order summary row labelled "Discount:"');
    expect(p.session.state.range).toBe("Last 30 Days");
  });

  test("Escape stops the walk and keeps nothing", async () => {
    const p = mount({ totals: { 2025: 23 } });
    p.choose("2025");
    p.button("Download CSV").click();
    p.escape();
    await p.idle();
    expect(p.saved.length).toBe(0);
    expect(p.tip()).toStartWith("Stopped");
    expect(p.session.state.range).toBe("Last 30 Days");
  });

  test("the page asks before it is left mid-walk", async () => {
    const p = mount({ totals: { 2025: 23 } });
    p.choose("2025");
    p.button("Download CSV").click();
    const event = new p.window.Event("beforeunload", { cancelable: true });
    p.window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await p.idle();
  });
});

describe("one order", () => {
  // The list a click on an order number leaves: the search holds it, and
  // the heading counts one order.
  const ONE = "261120-0001";
  const one = (options = {}) => mount({ search: ONE, totals: { "Last 30 Days": 1 }, ...options });

  test("the panel offers its cards, as a file or to BAN, and no year", () => {
    const p = one();
    expect(p.word()).toBe("ready");
    expect(p.year()).toBe(null);
    expect([...p.panel.querySelectorAll(".tcg-banner-go")].map((b) => b.textContent)).toEqual(["Download CSV", "Send to BAN"]);
    expect(p.tip()).toBe("Save the cards of " + ONE + " as CSV, or send them to BAN");
    expect(p.below()).toBe(0);
    expect(p.titled()).toBe(0);
  });

  test("Download CSV saves that order's lines and asks TCGplayer nothing", async () => {
    const p = one();
    p.button("Download CSV").click();
    const file = await p.file();
    expect(file.name).toBe("tcg-order-" + ONE + ".csv");
    const rows = file.text.trimEnd().split("\n");
    expect(rows[0]).toStartWith("TCGplayer Product ID,Name,Edition,");
    const [order] = TCGB.readPage(docOf(p.session.html(1))).orders;
    expect(order.id).toBe(ONE);
    expect(rows.length).toBe(1 + order.lines.length);
    expect(rows.slice(1).every((r) => r.includes("," + ONE + ","))).toBe(true);
    expect(p.session.asked).toEqual([]);
    expect(p.done()).toBe(true);
    expect(p.word()).toMatch(/^\d+ cards?$/);
    expect(p.tip()).toBe("Saved tcg-order-" + ONE + ".csv");
  });

  test("Send to BAN gives mtgban the same cards as the icon beside the number", () => {
    const p = one();
    p.button("Send to BAN").click();
    p.ready(0);
    p.document.querySelector("button.tcg-banner-send").click();
    p.ready(1);
    expect(p.tabs.length).toBe(2);
    expect(p.tabs[0].posted[0].data.csv).toBe(p.tabs[1].posted[0].data.csv);
    expect(p.tip()).toStartWith("Sent ");
  });

  test("an order with nothing BAN reads still saves, and its Send to BAN is off", () => {
    const p = one({ change: (html) => html.replaceAll("/magic/", "/pokemon/") });
    expect(p.button("Send to BAN").disabled).toBe(true);
    expect(p.tip()).toBe("Save the cards of " + ONE + " as CSV; none of them can go to BAN");
    expect(p.button("Download CSV").disabled).toBe(false);
  });

  test("a search listing several orders keeps the year panel", () => {
    // Ten on the page, more behind the pager.
    expect(mount({ search: "Portent", totals: { "Last 30 Days": 12 } }).year() === null).toBe(false);
    // One on the last page of eleven.
    const body = pageHTML({ search: "Portent", total: 11, n: 2 });
    const last = mount({ search: "Portent", body });
    expect(last.document.querySelectorAll(".orderWrap").length).toBe(1);
    expect(last.year() === null).toBe(false);
  });

  test("a single order with no search is still a year's list", () => {
    expect(mount({ totals: { "Last 30 Days": 1 } }).year() === null).toBe(false);
  });
});

describe("the order number", () => {
  test("becomes a button that searches for it with the page's own form", () => {
    const p = mount();
    const buttons = [...p.document.querySelectorAll("button.tcg-banner-order")];
    expect(buttons.length).toBe(10);
    const seller = buttons.find((b) => /^[0-9A-F]{8}-/.test(b.textContent));
    seller.click();
    expect(p.submitted).toEqual([
      {
        __RequestVerificationToken: "TOKEN",
        ClearSessionFilters: "False",
        SearchString: seller.textContent,
        DateRange: "2026",
      },
    ]);
  });

  test("searches within the order's own year, not a relative range", () => {
    // In Last 90 Days, an order from July is out of range by November.
    const p = mount({ range: "Last 90 Days", change: (html) => html.replace("November 20, 2026", "July 21, 2025") });
    const first = p.document.querySelector("button.tcg-banner-order");
    first.click();
    expect(p.submitted[0].SearchString).toBe(first.textContent);
    expect(p.submitted[0].DateRange).toBe("2025");
    expect(p.submitted[0].ClearSessionFilters).toBe("False");
  });

  test("an order that did not read whole still searches in its year", () => {
    const p = mount({
      range: "Last 90 Days",
      change: (html) => html.replace("November 20, 2026", "July 21, 2025").replace("Subtotal:", "Discount:"),
    });
    const first = p.document.querySelector(".orderWrap");
    expect(first.querySelectorAll("button.tcg-banner-send").length).toBe(0);
    first.querySelector("button.tcg-banner-order").click();
    expect(p.submitted[0].DateRange).toBe("2025");
  });

  test("an order dated in a year the dropdown does not offer keeps the range", () => {
    const p = mount({ change: (html) => html.replace("November 20, 2026", "July 21, 2015") });
    p.document.querySelector("button.tcg-banner-order").click();
    expect(p.submitted[0].DateRange).toBe("Last 30 Days");
  });

  test("a Direct order searches the same way", () => {
    const p = mount();
    const direct = p.document.querySelector("button.tcg-banner-order");
    expect(direct.textContent).toMatch(/^\d{6}-[0-9A-F]{4}$/);
    direct.click();
    expect(p.submitted[0].SearchString).toBe(direct.textContent);
  });
});

describe("Send to BAN", () => {
  test("is the BAN icon beside the order number, named for a screen reader", () => {
    const p = mount();
    const send = p.document.querySelector("button.tcg-banner-send");
    expect(send.textContent).toBe("");
    expect(send.getAttribute("aria-label")).toBe("Send to BAN");
    expect(send.previousElementSibling.className).toBe("tcg-banner-order");
    // Both in one span that does not wrap, so the icon never drops under a
    // long number.
    expect(send.parentNode.className).toBe("tcg-banner-number");
    expect(p.document.querySelectorAll("span.tcg-banner-number").length).toBe(10);
  });

  test("an order with nothing to send gets none", () => {
    const p = mount({ change: (html) => html.replaceAll("/magic/ice-age/portent", "/pokemon/base-set/portent") });
    const first = p.document.querySelector(".orderWrap");
    expect(first.querySelectorAll("button.tcg-banner-order").length).toBe(1);
    expect(first.querySelectorAll("button.tcg-banner-send").length).toBe(0);
  });

  test("every order of Magic cards gets one", () => {
    const p = mount();
    expect(p.document.querySelectorAll("button.tcg-banner-send").length).toBe(10);
  });

  test("opens mtgban's handoff and gives it the order's cards once it is listening", () => {
    const p = mount();
    const send = p.document.querySelector("button.tcg-banner-send");
    send.click();
    expect(p.tabs.map((t) => t.url)).toEqual(["https://mtgban.com/upload/handoff"]);
    expect(p.tabs[0].posted).toEqual([]);
    p.ready();
    const [{ data, origin }] = p.tabs[0].posted;
    expect(origin).toBe("https://mtgban.com");
    expect(data.type).toBe("mtgban-handoff-rows");
    expect(data.source).toBe("https://store.tcgplayer.com/myaccount/orderhistory");
    expect(data.csv.split("\n")[0]).toBe("TCGplayer Product ID,Name,Edition,Foil,Condition,Quantity,Price");
    expect(data.csv.trimEnd().split("\n").length).toBe(1 + data.rows);
    expect(p.tip()).toStartWith("Sent ");
  });

  test("says it is sending until mtgban's page listens", () => {
    const p = mount();
    p.document.querySelector("button.tcg-banner-send").click();
    expect(p.word()).toBe("sending");
    expect(p.done()).toBe(false);
    expect(p.tip()).toBe("Waiting for mtgban's upload page to take the cards");
    // Coming back while the tab is still open changes nothing.
    p.window.dispatchEvent(new p.window.Event("focus"));
    expect(p.word()).toBe("sending");
    p.ready();
    expect(p.word()).toBe("sent");
    expect(p.done()).toBe(true);
  });

  test("a BAN tab closed before it listened is noticed on coming back", () => {
    const p = mount();
    p.document.querySelector("button.tcg-banner-send").click();
    p.tabs[0].closed = true;
    p.window.dispatchEvent(new p.window.Event("focus"));
    expect(p.word()).toBe("");
    expect(p.failed()).toBe(true);
    expect(p.tip()).toBe("The upload page was closed; try again");
    // The listener went with it: a late ready from that tab posts nothing.
    p.ready();
    expect(p.tabs[0].posted).toEqual([]);
  });

  test("listens only to mtgban, from the tab it opened", () => {
    const p = mount();
    p.document.querySelector("button.tcg-banner-send").click();
    p.ready(0, "https://evil.example");
    p.window.dispatchEvent(new p.window.MessageEvent("message", { data: { type: "mtgban-handoff-ready" }, origin: "https://mtgban.com", source: {} }));
    expect(p.tabs[0].posted).toEqual([]);
  });

  test("goes out while a walk runs, which keeps the panel", async () => {
    const p = mount({ totals: { 2025: 23 } });
    p.choose("2025");
    p.button("Download CSV").click();
    const send = p.document.querySelector("button.tcg-banner-send");
    expect(send.disabled).toBe(false);
    send.click();
    expect(p.tabs.map((t) => t.url)).toEqual(["https://mtgban.com/upload/handoff"]);
    expect(p.busy()).toBe(true);
    p.ready();
    expect(p.tabs[0].posted.length).toBe(1);
    await p.idle();
    expect(p.word()).toBe("23 orders");
  });

  test("a send blocked during a walk is said once the walk ends", async () => {
    const p = mount({ totals: { 2025: 23 }, blockPopups: true });
    p.choose("2025");
    p.button("Download CSV").click();
    p.document.querySelector("button.tcg-banner-send").click();
    expect(p.failed()).toBe(false);
    await p.idle();
    expect(p.word()).toBe("23 orders");
    expect(p.tip()).toBe("Saved tcg-orders-2025.csv from 3 pages\nSend to BAN: The upload page was blocked; use the CSV");
  });

  test("a send answered during a walk leaves the walk's panel alone", async () => {
    // Page 2 is held until the send has been answered.
    let release;
    const held = new Promise((done) => (release = done));
    const p = mount({
      totals: { 2025: 23 },
      change: (html, n, state) => (state.range === "2025" && n === 2 ? held.then(() => html) : html),
    });
    p.document.querySelector("button.tcg-banner-send").click();
    p.choose("2025");
    p.button("Download CSV").click();
    await new Promise((done) => setTimeout(done, 20));
    const during = p.word();
    expect(during).toBe("page 2 of 3");
    p.ready();
    expect(p.tabs[0].posted.length).toBe(1);
    expect(p.word()).toBe(during);
    expect(p.tip()).not.toContain("Sent ");
    release();
    await p.idle();
    expect(p.word()).toBe("23 orders");
    expect(p.tip()).toStartWith("Saved tcg-orders-2025.csv");
  });

  test("a message of another type from the tab gets no cards", () => {
    const p = mount();
    p.document.querySelector("button.tcg-banner-send").click();
    p.window.dispatchEvent(new p.window.MessageEvent("message", { data: { type: "something-else" }, origin: "https://mtgban.com", source: p.tabs[0] }));
    expect(p.tabs[0].posted).toEqual([]);
    expect(p.word()).toBe("sending");
  });

  test("a tab that says it is listening after it was closed gets no cards", () => {
    const p = mount();
    p.document.querySelector("button.tcg-banner-send").click();
    p.tabs[0].closed = true;
    p.ready();
    expect(p.tabs[0].posted).toEqual([]);
    expect(p.tip()).toBe("The upload page was closed; try again");
  });

  test("a second send closes the first tab, which would wait for good", () => {
    const p = mount();
    const sends = p.document.querySelectorAll("button.tcg-banner-send");
    sends[0].click();
    sends[1].click();
    expect(p.tabs[0].closed).toBe(true);
    expect(p.failed()).toBe(false);
    p.ready(0);
    expect(p.tabs[0].posted).toEqual([]);
    p.ready(1);
    expect(p.tabs[1].posted.length).toBe(1);
    expect(p.tip()).toStartWith("Sent ");
  });

  test("a blocked tab says so", () => {
    const p = mount({ blockPopups: true });
    p.document.querySelector("button.tcg-banner-send").click();
    expect(p.failed()).toBe(true);
    expect(p.tip()).toBe("The upload page was blocked; use the CSV");
  });

  test("a line not in English is left out and counted", () => {
    const p = mount({ change: (html) => html.replace("Condition: Lightly Played\n", "Condition: Lightly Played - Japanese\n") });
    const wrap = p.document.querySelector(".orderWrap");
    wrap.querySelector("button.tcg-banner-send").click();
    p.ready();
    expect(p.tabs[0].posted[0].data.rows).toBe(2);
    expect(p.tip()).toContain("1 line not in English, not sent");
  });

  test("a refund is said not to name its cards", () => {
    const p = mount();
    const wrap = [...p.document.querySelectorAll(".orderWrap")].find((w) => w.querySelector(".orderAlert"));
    wrap.querySelector("button.tcg-banner-send").click();
    p.ready();
    expect(p.tip()).toContain("does not say which cards it covers");
  });

  test("a custom listing is counted as not read whole, not as another game", () => {
    const p = mount({
      change: (html) =>
        html
          .replace("https://tcgplayer-cdn.tcgplayer.com/product/4842_25w.jpg", "https://tcgplayer-cdn.tcgplayer.com/product/0_25w.jpg")
          .replace("https://store.tcgplayer.com/magic/ice-age/portent", "https://store.tcgplayer.com/listing?q=Portent"),
    });
    p.document.querySelector(".orderWrap button.tcg-banner-send").click();
    p.ready();
    expect(p.tabs[0].posted[0].data.rows).toBe(2);
    expect(p.tip()).toContain("1 line not read whole, not sent");
    expect(p.tip()).not.toContain("another game");
  });

  test("lines of another game are left out and counted", () => {
    const p = mount({
      change: (html) => html.replace("https://store.tcgplayer.com/magic/ice-age/portent", "https://store.tcgplayer.com/pokemon/base-set/portent"),
    });
    const wrap = p.document.querySelector(".orderWrap");
    wrap.querySelector("button.tcg-banner-send").click();
    p.ready();
    // The first of the order's three Portent lines is now a Pokemon card.
    expect(p.tabs[0].posted[0].data.rows).toBe(2);
    expect(p.tip()).toContain("1 line of another game not sent");
  });
});
