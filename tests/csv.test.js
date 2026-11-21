import { test, expect, describe } from "bun:test";
import { TCGB, fixture } from "./helpers.js";

const orders = () => TCGB.readPage(fixture()).orders;
const header = (csv) => csv.split("\n")[0];

// rowsOf parses what ordersCSV writes: quoted fields, doubled quotes, LF.
function rowsOf(csv) {
  return csv.trimEnd().split("\n").map((line) => [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].slice(0, -1).map((m) => m[1].replace(/^"|"$/g, "").replace(/""/g, '"')));
}

describe("the orders file", () => {
  test("starts with the columns go-mtgban's tool and ck-banner share", () => {
    expect(header(TCGB.ordersCSV(orders()))).toBe(
      "Order ID,Order Date,Amount,Kind,Seller,Quantity,Subtotal,Shipping,Sales Tax,Refunded,Total"
    );
  });

  test("reads as a sum: Subtotal, Shipping, Sales Tax and the refund, negative, make Total", () => {
    const all = orders();
    const [head, ...rows] = rowsOf(TCGB.ordersCSV(all));
    expect(rows.length).toBe(10);
    const at = (row, name) => row[head.indexOf(name)];
    const cents = (text) => (text === "" ? 0 : (text.startsWith("-") ? -1 : 1) * TCGB.cents(text.replace(/^-/, "")));
    for (const row of rows) {
      const sum = ["Subtotal", "Shipping", "Sales Tax", "Refunded"].reduce((n, name) => n + cents(at(row, name)), 0);
      expect([at(row, "Order ID"), sum]).toEqual([at(row, "Order ID"), cents(at(row, "Total"))]);
      expect(at(row, "Amount")).toBe(at(row, "Total"));
    }
    const refunded = all.find((o) => o.refunded);
    const row = rows.find((r) => r[0] === refunded.id);
    expect(at(row, "Refunded")).toBe("-" + TCGB.dollars(refunded.refunded));
    expect(at(row, "Total")).toBe(TCGB.dollars(refunded.summary.total - refunded.refunded));
    expect(at(rows.find((r) => r[0] !== refunded.id), "Refunded")).toBe("");
  });
});

describe("the cards sent to BAN", () => {
  test("carry the uploader's columns and nothing else", () => {
    const lines = orders()[0].lines;
    const csv = TCGB.cardsCSV(lines);
    expect(header(csv)).toBe("TCGplayer Product ID,Name,Edition,Foil,Condition,Quantity,Price");
    expect(csv.split("\n")[1]).toBe("4842,Portent,Ice Age,No,SP," + lines[0].qty + "," + TCGB.decimal(lines[0].each));
  });
});

describe("free text", () => {
  test("a seller's name is not run as a formula", () => {
    const all = orders();
    const seller = all.find((o) => o.kind === "Seller");
    seller.seller = "=1+1";
    const direct = all[0];
    direct.lines[0] = { ...direct.lines[0], name: "+2 Mace", edition: "-Set" };
    const row = (csv, id) => csv.split("\n").find((r) => r.startsWith(id + ","));
    expect(row(TCGB.ordersCSV(all), seller.id)).toContain(",'=1+1,");
    // mtgban reads the cards file, and reads it as written.
    expect(TCGB.cardsCSV([direct.lines[0]]).split("\n")[1]).toStartWith("4842,+2 Mace,-Set,");
  });
});

describe("quoting", () => {
  test("a comma is quoted", () => {
    const line = { productID: "1", name: "Borborygmos, Enraged", edition: 'Set "X"', foil: true, condition: "NM", qty: 1, each: 100 };
    expect(TCGB.cardsCSV([line]).split("\n")[1]).toBe('1,"Borborygmos, Enraged","Set ""X""",Yes,NM,1,1.00');
  });

  test("every row ends in LF alone", () => {
    const csv = TCGB.ordersCSV(orders());
    expect(csv.endsWith("\n")).toBe(true);
    expect(csv).not.toContain("\r");
  });
});
