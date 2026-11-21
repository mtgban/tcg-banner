import { test, expect, describe } from "bun:test";
import { TCGB } from "./helpers.js";

describe("cents", () => {
  test("reads dollars, grouped or not", () => {
    expect(TCGB.cents("$0.52")).toBe(52);
    expect(TCGB.cents(" $1,234.56 ")).toBe(123456);
    expect(TCGB.cents("$186.06")).toBe(18606);
  });

  test("refuses three decimals", () => {
    expect(TCGB.cents("$1.234")).toBeNull();
  });

  test("refuses any other shape", () => {
    for (const bad of ["1.00", "$1", "$1,23.00", "$01,000.00", "-$1.00", "$1.0", ""]) {
      expect(TCGB.cents(bad)).toBeNull();
    }
  });
});

describe("count", () => {
  test("reads a quantity", () => {
    expect(TCGB.count("84")).toBe(84);
    expect(TCGB.count("1,204")).toBe(1204);
    expect(TCGB.count("1.5")).toBeNull();
  });
});

describe("dollars and decimal", () => {
  test("write cents back", () => {
    expect(TCGB.dollars(123456)).toBe("$1,234.56");
    expect(TCGB.dollars(5)).toBe("$0.05");
    expect(TCGB.decimal(52)).toBe("0.52");
    expect(TCGB.decimal(123456)).toBe("1234.56");
  });
});

describe("date", () => {
  test("reads the order date as printed", () => {
    expect(TCGB.date("November 09, 2026")).toEqual({ year: 2026, month: 11, day: 9 });
    // Refund notes do not pad the day.
    expect(TCGB.date("November 3, 2026")).toEqual({ year: 2026, month: 11, day: 3 });
  });

  test("refuses a day the month does not have", () => {
    expect(TCGB.date("February 29, 2025")).toBeNull();
    expect(TCGB.date("February 29, 2024")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(TCGB.date("April 31, 2026")).toBeNull();
  });

  test("refuses another shape", () => {
    for (const bad of ["Nov 09, 2026", "November 009, 2026", "2026-11-09", "november 09, 2026"]) {
      expect(TCGB.date(bad)).toBeNull();
    }
  });
});
