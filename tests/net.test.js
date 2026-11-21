import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";
import { TCGB, restore } from "./helpers.js";

// fetchPage parses what it reads, as a tab's DOMParser does.
globalThis.DOMParser = new Window().DOMParser;

const realFetch = globalThis.fetch;
// These are the real fetchPage and setFilter whatever ran before.
beforeEach(restore);

afterEach(() => {
  globalThis.fetch = realFetch;
});

// answer stands in for fetch, recording what was asked.
function answer({ status = 200, headers = {}, body = "<p>ok</p>" } = {}) {
  const asked = [];
  globalThis.fetch = (url, options) => {
    asked.push({ url, options });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      text: () => Promise.resolve(body),
    });
  };
  return asked;
}

describe("fetchPage", () => {
  test("asks for the page with the visitor's session, page 1 without a number", async () => {
    const asked = answer();
    await TCGB.fetchPage(1);
    await TCGB.fetchPage(3);
    expect(asked.map((a) => a.url)).toEqual(["/myaccount/orderhistory", "/myaccount/orderhistory?PageNumber=3"]);
    expect(asked[0].options.credentials).toBe("same-origin");
  });

  test("a Cloudflare challenge is told apart from an ordinary refusal", async () => {
    answer({ status: 403, headers: { "cf-mitigated": "challenge" } });
    await expect(TCGB.fetchPage(1)).rejects.toThrow(TCGB.CHALLENGE);
    answer({ status: 403 });
    await expect(TCGB.fetchPage(1)).rejects.toThrow("TCGplayer answered 403");
  });

  test("a 429 says to slow down", async () => {
    answer({ status: 429 });
    await expect(TCGB.fetchPage(1)).rejects.toThrow(TCGB.BUSY);
  });
});

describe("setFilter", () => {
  test("sends what the page's own date range change sends", async () => {
    const asked = answer();
    await TCGB.setFilter("T0K", "2025", "", true);
    const { url, options } = asked[0];
    expect(url).toBe("/myaccount/orderhistory");
    expect(options.method).toBe("POST");
    expect(options.credentials).toBe("same-origin");
    expect(options.headers.__RequestVerificationToken).toBe("T0K");
    expect(options.headers["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(options.body).toBe("__RequestVerificationToken=T0K&ClearSessionFilters=true&SearchString=&DateRange=2025");
  });

  test("keeps a search with ClearSessionFilters False, as the Search button does", async () => {
    const asked = answer();
    await TCGB.setFilter("T", "Last 30 Days", "261120-A3C0", false);
    expect(asked[0].options.body).toBe(
      "__RequestVerificationToken=T&ClearSessionFilters=False&SearchString=261120-A3C0&DateRange=Last+30+Days"
    );
  });
});
