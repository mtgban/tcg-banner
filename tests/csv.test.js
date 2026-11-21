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
      "Order ID,Order Date,Amount,Kind,Seller,Tax State,Quantity,Subtotal,Shipping,Sales Tax,Refunded,Total"
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

describe("the tax state", () => {
  const stateOf = (taxes) => {
    const [order] = orders();
    order.summary.taxes = taxes;
    const [head, row] = rowsOf(TCGB.ordersCSV([order]));
    return row[head.indexOf("Tax State")];
  };

  test("is the state a Sales Tax row names", () => {
    expect(stateOf(["Sales Tax (NY)"])).toBe("NY");
    // The fixture's own rows, as cut from the saved page.
    expect(rowsOf(TCGB.ordersCSV(orders())).slice(1).map((r) => r[5])).toContain("ZZ");
  });

  test("is empty where no row names one", () => {
    expect(stateOf(["Sales Tax"])).toBe("");
    // Canada's GST: CA is the country, not California.
    expect(stateOf(["CA GST"])).toBe("");
    expect(stateOf([])).toBe("");
  });
});

describe("one order's file", () => {
  test("names its order column so docparse does not take it for a variant", () => {
    const columns = header(TCGB.orderCSV(orders()[0])).split(",");
    expect(columns).toEqual([
      "TCGplayer Product ID", "Name", "Edition", "Foil", "Condition", "Quantity", "Price",
      "Order", "Order Date", "Seller", "Game", "Language",
    ]);
    // docparse reads a header holding "number" as the card's variant, and
    // one of exactly "tcgplayer id" as a SKU that wipes the product id.
    expect(columns.filter((c) => /number/i.test(c) || c.toLowerCase() === "tcgplayer id")).toEqual([]);
  });

  test("one row per line of that order, each naming it", () => {
    const order = orders()[0];
    const [head, ...rows] = rowsOf(TCGB.orderCSV(order));
    expect(rows.length).toBe(order.lines.length);
    expect(rows.map((r) => r[head.indexOf("Order")])).toEqual(order.lines.map(() => order.id));
    expect(rows.map((r) => r[0])).toEqual(order.lines.map((l) => l.productID));
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
    direct.lines[0] = { ...direct.lines[0], seller: "@SUM(A1)", name: "+2 Mace", edition: "-Set" };
    const row = (csv, id) => csv.split("\n").find((r) => r.startsWith(id + ","));
    expect(row(TCGB.ordersCSV(all), seller.id)).toContain(",'=1+1,");
    const items = TCGB.orderCSV(direct).split("\n");
    expect(items[1]).toStartWith("4842,'+2 Mace,'-Set,");
    expect(items[1]).toContain(",'@SUM(A1),");
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
