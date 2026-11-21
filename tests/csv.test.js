import { test, expect, describe } from "bun:test";
import { TCGB, fixture } from "./helpers.js";

const orders = () => TCGB.readPage(fixture()).orders;
const header = (csv) => csv.split("\n")[0];

describe("the orders file", () => {
  test("starts with the columns go-mtgban's tool and ck-banner share", () => {
    expect(header(TCGB.ordersCSV(orders()))).toBe(
      "Order ID,Order Date,Amount,Kind,Seller,Quantity,Subtotal,Shipping,Sales Tax,Total,Refunded"
    );
  });

  test("one row per order, the amount net of a refund", () => {
    const all = orders();
    const rows = TCGB.ordersCSV(all).trimEnd().split("\n").slice(1);
    expect(rows.length).toBe(10);
    const refunded = all.find((o) => o.refunded);
    const row = rows.find((r) => r.startsWith(refunded.id + ","));
    const q = (cents) => '"' + TCGB.dollars(cents) + '"';
    const field = (cents) => (cents >= 100000 ? q(cents) : TCGB.dollars(cents));
    expect(row).toContain("," + field(refunded.summary.total) + ",");
    expect(row.endsWith("," + field(refunded.refunded))).toBe(true);
    expect(row).toContain('2026",' + field(refunded.summary.total - refunded.refunded) + ",Direct");
  });
});

describe("the items file", () => {
  test("names its order column so docparse does not take it for a variant", () => {
    const columns = header(TCGB.itemsCSV(orders())).split(",");
    expect(columns).toEqual([
      "TCGplayer Product ID", "Name", "Edition", "Foil", "Condition", "Quantity", "Price",
      "Order", "Order Date", "Seller", "Game", "Language",
    ]);
    // docparse reads a header holding "number" as the card's variant, and
    // one of exactly "tcgplayer id" as a SKU that wipes the product id.
    expect(columns.filter((c) => /number/i.test(c) || c.toLowerCase() === "tcgplayer id")).toEqual([]);
  });

  test("one row per line", () => {
    expect(TCGB.itemsCSV(orders()).trimEnd().split("\n").length).toBe(1 + 185);
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
    const items = TCGB.itemsCSV(all).split("\n");
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
