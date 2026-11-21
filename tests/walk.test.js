import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { TCGB, site, restore } from "./helpers.js";

// on points the walk at a fake session and answers with it.
function on(s) {
  TCGB.fetchPage = s.fetchPage;
  TCGB.setFilter = s.setFilter;
  return s;
}

beforeEach(() => {
  TCGB.PACE = 0;
  TCGB.BUSY_WAIT = 0;
});

// The fake session must not outlive the test: net.test.js, run after this
// file, would be asking it instead of fetch.
afterEach(restore);

const walk = (year, hooks = {}) => TCGB.walkYear(year, hooks);

describe("a year", () => {
  test("sets the year, reads every page, and puts the range back", async () => {
    const s = on(site({ totals: { 2025: 23 } }));
    const result = await walk("2025");
    expect(result.orders.length).toBe(23);
    expect(result.pages).toBe(3);
    expect(result.restore).toBe("");
    expect(s.asked).toEqual([
      "GET 1",
      "POST 2025||true",
      "GET 1", "GET 2", "GET 3",
      "POST Last 30 Days||true",
      "GET 1",
    ]);
    expect(s.state).toEqual({ range: "Last 30 Days", search: "" });
    expect(new Set(result.orders.map((o) => o.id)).size).toBe(23);
    expect(result.orders.every((o) => o.date.year === 2025)).toBe(true);
  });

  test("puts back a search the visitor had", async () => {
    const s = on(site({ range: "2024", search: "Portent", totals: { 2025: 5, 2024: 3 } }));
    const result = await walk("2025");
    expect(result.restore).toBe("");
    expect(s.asked.at(-2)).toBe("POST 2024|Portent|false");
    expect(s.state).toEqual({ range: "2024", search: "Portent" });
  });

  test("a year with no orders is an empty file, not a refusal", async () => {
    on(site({ totals: { 2016: 0 } }));
    const result = await walk("2016");
    expect(result.orders).toEqual([]);
    expect(result.pages).toBe(1);
  });

  test("a year TCGplayer does not list is refused before anything is set", async () => {
    const s = on(site());
    await expect(walk("1999")).rejects.toThrow("does not list 1999");
    expect(s.asked).toEqual(["GET 1"]);
  });

  test("pending orders are counted and left out", async () => {
    on(site({
      totals: { 2025: 10 },
      change: (html, n, state) => state.range === "2025" ? html.replace('<div class="orderHeader">', '<div class="orderHeader"><span class="pendingOrder">Pending</span>') : html,
    }));
    const result = await walk("2025");
    expect(result.pending).toBe(1);
    expect(result.orders.length).toBe(9);
  });
});

describe("refusals", () => {
  test("a range changed from another tab mid-walk refuses the walk", async () => {
    const s = on(site({
      totals: { 2025: 23 },
      change: (html, n, state) => {
        if (state.range === "2025" && n === 2) state.range = "2024";
        return html;
      },
    }));
    // Page 2 is served for the range the session held when it was asked
    // for, which the change above moves for every page after.
    const err = await walk("2025").catch((e) => e);
    expect(err.message).toBe(TCGB.MOVED);
    expect(err.restore).toBe("");
    expect(s.state.range).toBe("Last 30 Days");
  });

  test("a heading naming another range refuses the walk", async () => {
    on(site({
      totals: { 2025: 23 },
      change: (html, n, state) => state.range === "2025" && n === 2 ? html.replace("placed in 2025", "placed in 2024") : html,
    }));
    await expect(walk("2025")).rejects.toThrow(TCGB.MOVED);
  });

  test("a page holding fewer orders than its heading says refuses the walk", async () => {
    on(site({
      totals: { 2025: 23 },
      change: (html, n, state) => (state.range === "2025" && n === 2 ? html.replace(/<div class="orderWrap">[\s\S]*?(?=<div class="orderWrap">)/, "") : html),
    }));
    await expect(walk("2025")).rejects.toThrow(TCGB.MOVED);
  });

  test("an order seen twice refuses the walk", async () => {
    // Page 2 answered with page 1's orders under page 2's heading.
    on(site({
      totals: { 2025: 23 },
      change: (html, n, state) => {
        if (state.range !== "2025" || n !== 2) return html;
        return html.replace("261120-000B", "261120-0001");
      },
    }));
    await expect(walk("2025")).rejects.toThrow(TCGB.MOVED);
  });

  test("a pager disagreeing with the heading refuses the walk", async () => {
    on(site({
      totals: { 2025: 23 },
      change: (html, n, state) => state.range === "2025" ? html.replace('PageNumber=3" class=" pageLast"', 'PageNumber=4" class=" pageLast"') : html,
    }));
    await expect(walk("2025")).rejects.toThrow("do not add up");
  });

  test("an order that cannot be read refuses the walk and names it", async () => {
    on(site({
      totals: { 2025: 23 },
      change: (html, n, state) => state.range === "2025" && n === 2 ? html.replace("Subtotal:", "Discount:") : html,
    }));
    await expect(walk("2025")).rejects.toThrow(/^Order [0-9A-F-]+: an order summary row labelled "Discount:"$/);
  });

  test("an order from another year refuses the walk", async () => {
    on(site({
      totals: { 2025: 23 },
      change: (html, n, state) => state.range === "2025" && n === 3 ? html.replace(/(orderdate">\s*\w+ \d{2}, )2025/, "$12024") : html,
    }));
    await expect(walk("2025")).rejects.toThrow("is not from 2025");
  });

  test("a sign-in page refuses the walk", async () => {
    on(site({
      totals: { 2025: 23 },
      change: (html, n, state) => state.range === "2025" && n === 2 ? "<form id=login></form>" : html,
    }));
    await expect(walk("2025")).rejects.toThrow(TCGB.NOT_HISTORY);
  });

  test("Escape stops the walk and the range still goes back", async () => {
    const s = on(site({ totals: { 2025: 23 } }));
    let stop = false;
    const err = await walk("2025", {
      step: (n) => {
        if (n === 2) stop = true;
      },
      stopped: () => stop,
    }).catch((e) => e);
    expect(err.message).toBe(TCGB.CANCELLED);
    expect(err.restore).toBe("");
    expect(s.state).toEqual({ range: "Last 30 Days", search: "" });
  });

  test("asked to slow down, the walk waits before it puts the range back", async () => {
    const s = on(site({ totals: { 2025: 23 } }));
    const get = s.fetchPage;
    s.fetchPage = (n) => (n === 2 && s.state.range === "2025" ? Promise.reject(new Error(TCGB.BUSY)) : get(n));
    TCGB.fetchPage = s.fetchPage;
    TCGB.BUSY_WAIT = 30;
    const waited = [];
    const started = Date.now();
    const err = await walk("2025", { waiting: (ms) => waited.push(ms) }).catch((e) => e);
    expect(err.message).toBe(TCGB.BUSY);
    expect(waited).toEqual([30]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    expect(err.restore).toBe("");
    expect(s.state.range).toBe("Last 30 Days");
  });

  test("a challenge is left for the visitor, and nothing more is sent", async () => {
    const s = on(site({ totals: { 2025: 23 } }));
    const get = s.fetchPage;
    s.fetchPage = (n) => (n === 2 && s.state.range === "2025" ? Promise.reject(new Error(TCGB.CHALLENGE)) : get(n));
    TCGB.fetchPage = s.fetchPage;
    const err = await walk("2025").catch((e) => e);
    expect(err.message).toBe(TCGB.CHALLENGE);
    expect(err.restore).toBe("The order list was left on 2025; reload, pass the check, then pick your range again");
    expect(s.asked.filter((a) => a.startsWith("POST"))).toEqual(["POST 2025||true"]);
    expect(s.state.range).toBe("2025");
  });

  test("a range that cannot be put back says so", async () => {
    const s = on(site({ totals: { 2025: 3 }, failPost: (range) => range === "Last 30 Days" }));
    const result = await walk("2025");
    expect(result.orders.length).toBe(3);
    expect(result.restore).toBe("The order list was left on 2025; reload the page");
    expect(s.state.range).toBe("2025");
  });

  test("a restore that did not take says so", async () => {
    const s = site({ totals: { 2025: 3 } });
    const set = s.setFilter;
    s.setFilter = (token, range, search, clear) => (range === "2025" ? set(token, range, search, clear) : Promise.resolve());
    on(s);
    const result = await walk("2025");
    expect(result.restore).toBe("The order list was left on 2025; reload the page");
  });
});
