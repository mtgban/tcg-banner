// Who the handoff will talk to. The page posts an order's cards to
// whichever origin answers, so this is where a wrong answer would leak them.

import { test, expect, describe } from "bun:test";
import { TCGB } from "./helpers.js";

describe("an mtgban origin", () => {
  test("is mtgban.com or a subdomain of it, over https", () => {
    expect(TCGB.isBanHost("https://mtgban.com")).toBe(true);
    expect(TCGB.isBanHost("https://www.mtgban.com")).toBe(true);
  });

  test("is not a name that only ends in mtgban.com", () => {
    expect(TCGB.isBanHost("https://evilmtgban.com")).toBe(false);
    expect(TCGB.isBanHost("https://mtgban.com.evil.example")).toBe(false);
  });

  test("is not one over plain http", () => {
    expect(TCGB.isBanHost("http://mtgban.com")).toBe(false);
    expect(TCGB.isBanHost("http://www.mtgban.com")).toBe(false);
  });

  test("is not something that is no origin at all", () => {
    expect(TCGB.isBanHost("null")).toBe(false);
    expect(TCGB.isBanHost("")).toBe(false);
  });
});
