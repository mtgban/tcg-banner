// Runs the reader on saved pages, which CI never has:
//
//   TCG_SAVED_ORDERS="<saved order history.html>[:<another>...]" bun test tests/
//
// Without the variable it skips. A saved page stays outside the repository;
// the last test checks that none of its order numbers reached a fixture.

import { test, expect, describe } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { TCGB, docOf } from "./helpers.js";

const paths = (process.env.TCG_SAVED_ORDERS || "").split(":").filter(Boolean);

// A saved page names its own scripts, styles and images; none may load.
const stripped = (path) =>
  readFileSync(path, "utf8")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/\ssrc="[^"]*"/gi, "")
    .replace(/url\([^)]*\)/gi, "");

describe.skipIf(!paths.length)("saved pages", () => {
  for (const path of paths) {
    test("reads every order whole: " + path.split("/").at(-1), () => {
      const page = TCGB.readPage(docOf(stripped(path)));
      expect(page.orders.length).toBe(page.list.last - page.list.first + 1);
      expect(page.orders.filter((o) => o.error).map((o) => o.id + ": " + o.error)).toEqual([]);
      const problems = page.orders.flatMap((o) => o.lines.filter((l) => l.problem).map((l) => o.id + ": " + l.name + ": " + l.problem));
      console.log(`${page.orders.length} orders, ${page.orders.reduce((n, o) => n + o.lines.length, 0)} lines, ${problems.length} lines not read whole`);
      for (const p of problems) console.log("  " + p);
    });

    test("left no order number in a fixture: " + path.split("/").at(-1), () => {
      const page = TCGB.readPage(docOf(stripped(path)));
      const fixtures = readdirSync(new URL("./fixtures/", import.meta.url)).map((name) =>
        readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8")
      );
      expect(page.orders.map((o) => o.id).filter((id) => fixtures.some((f) => f.includes(id)))).toEqual([]);
    });
  }
});
