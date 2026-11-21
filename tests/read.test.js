import { test, expect, describe } from "bun:test";
import { TCGB, fixture, docOf, text } from "./helpers.js";

// Plain fields only: an order keeps its DOM node, and a failing toEqual on
// one prints the whole window.
const plain = (o) => ({ id: o.id, kind: o.kind, date: o.dateText, seller: o.seller, error: o.error, pending: o.pending });

// withOrder edits the first order of the fixture and reads it.
function withOrder(edit) {
  const doc = fixture();
  edit(doc.querySelector(".orderWrap"), doc);
  return TCGB.readOrder(doc.querySelector(".orderWrap"));
}

describe("a page", () => {
  test("reads the filter the session holds", () => {
    const page = TCGB.readPage(fixture());
    expect(page.filter.range).toBe("Last 30 Days");
    expect(page.filter.search).toBe("");
    expect(page.filter.token).toBe("TOKEN");
    expect(page.filter.years[0]).toBe("2026");
    expect(page.filter.years.at(-1)).toBe("2016");
    expect(page.filter.years).not.toContain("Last 90 Days");
  });

  test("reads the list's heading and pager", () => {
    const page = TCGB.readPage(fixture());
    expect(page.list).toEqual({ empty: "", first: 1, last: 10, total: 31, placed: "the last 30 days" });
    expect(page.pageLast).toBe(4);
  });

  test("reads every order whole", () => {
    const page = TCGB.readPage(fixture());
    expect(page.orders.length).toBe(10);
    expect(page.orders.filter((o) => o.error).map(plain)).toEqual([]);
    expect(page.orders.reduce((n, o) => n + o.lines.length, 0)).toBe(185);
  });

  test("the last page's LAST links nowhere", () => {
    const doc = fixture();
    const last = doc.querySelector(".pager a.pageLast");
    last.removeAttribute("href");
    last.className = "ui-state-disabled pageLast";
    expect(TCGB.readPage(doc).pageLast).toBeNull();
  });

  test("tells an empty year from a search that found nothing", () => {
    const empty = (heading) => {
      const doc = fixture();
      doc.querySelector(".breadcrumbs span").textContent = heading;
      return TCGB.readPage(doc).list.empty;
    };
    expect(empty("You do not have any orders to display.")).toBe("none");
    expect(empty("No orders match your search criteria.")).toBe("nomatch");
    expect(() => empty("Something else")).toThrow("heading");
  });

  test("names a year's range the way the heading does", () => {
    expect(TCGB.placedIn("2025")).toBe("2025");
    expect(TCGB.placedIn("Last 30 Days")).toBe("the last 30 days");
  });

  test("refuses a page that is not the order history", () => {
    expect(() => TCGB.readPage(docOf("<form id=login></form>"))).toThrow(TCGB.NOT_HISTORY);
  });
});

describe("an order", () => {
  test("a Direct order and a seller order", () => {
    const orders = TCGB.readPage(fixture()).orders;
    const direct = orders[0];
    expect(direct.kind).toBe("Direct");
    expect(direct.id).toMatch(/^\d{6}-[0-9A-F]{4}$/);
    expect(direct.seller).toBe("TCGplayer Direct");
    expect(direct.lines.every((l) => l.seller)).toBe(true);
    const seller = orders.find((o) => o.kind === "Seller");
    expect(seller.id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{6}-[0-9A-F]{5}$/);
    expect(seller.seller).toMatch(/^Seller \d+$/);
    expect(seller.lines.every((l) => !l.seller)).toBe(true);
  });

  test("reads the summary by its labels", () => {
    const o = TCGB.readPage(fixture()).orders[0];
    expect(o.summary.taxes).toEqual(["Sales Tax (ZZ)"]);
    expect(o.summary.subtotal + o.summary.shipping + o.summary.tax).toBe(o.summary.total);
    expect(o.amount).toBe(o.summary.total);
  });

  test("a partial refund comes off the amount", () => {
    const o = TCGB.readPage(fixture()).orders.find((x) => x.refunds.length);
    expect(o.refunds.length).toBe(1);
    expect(o.amount).toBe(o.summary.total - o.refunds[0].cents);
  });

  test("keeps the order number's own text node", () => {
    const o = TCGB.readPage(fixture()).orders[0];
    expect(o.numberNode.nodeType).toBe(3);
    expect(o.numberNode.textContent.trim()).toBe(o.id);
  });

  test("a full refund, its date unpadded, comes off the amount too", () => {
    const o = withOrder((wrap) => {
      const note = wrap.ownerDocument.createElement("div");
      note.className = "orderAlert yellow";
      note.setAttribute("data-aid", "div-sellerorderwidget-singlerefund");
      note.innerHTML = "<b>A full refund</b> was issued on November 3, 2026 for the amount of $2.00. <a>(Details)</a>";
      wrap.querySelector(".orderContent").prepend(note);
    });
    expect(o.error).toBe("");
    expect(o.refunds.map((r) => [r.kind, r.cents, r.date.day])).toEqual([["full", 200, 3]]);
    expect(o.amount).toBe(o.summary.total - 200);
  });

  // The page's markup for several refunds, its id and amounts made up.
  const several = (total) => `<b>Multiple refunds</b> have been issued on this order for the total amount of ${total}.
    <a class="nocontext" href="#" id="RefundsShow_X">(Show)</a>
    <a class="nocontext" href="#" style="display: none" id="RefundsHide_X">(Hide)</a>
    <span style="display: none;" id="Refunds_X">
      <br> <b>A partial refund</b> was issued on August 2, 2026 for the amount of $1.10. <a href="#">(Details)</a>
      <br> <b>A shipping cost refund</b> was issued on August 6, 2026 for the amount of $1.49. <a href="#">(Details)</a>
    </span>`;
  const withNote = (aid, html) =>
    withOrder((wrap) => {
      const note = wrap.ownerDocument.createElement("div");
      note.className = "orderAlert yellow";
      note.setAttribute("data-aid", aid);
      note.innerHTML = html;
      wrap.querySelector(".orderContent").prepend(note);
    });

  test("several refunds are read one by one, and come to their total", () => {
    const o = withNote("div-sellerorderwidget-refunds", several("$2.59"));
    expect(o.error).toBe("");
    expect(o.refunds.map((r) => [r.kind, r.cents])).toEqual([["partial", 110], ["shipping cost", 149]]);
    expect(o.amount).toBe(o.summary.total - 259);
  });

  test("several refunds are read without re-parsing the page's markup", () => {
    // The reader runs on TCGplayer's live page; what the page holds is read
    // as text and never written back as markup, which would make it live.
    const created = [];
    const doc = fixture();
    const wrap = doc.querySelector(".orderWrap");
    const note = doc.createElement("div");
    note.className = "orderAlert yellow";
    note.setAttribute("data-aid", "div-sellerorderwidget-refunds");
    note.innerHTML = several("$2.59");
    wrap.querySelector(".orderContent").prepend(note);
    const make = doc.createElement.bind(doc);
    doc.createElement = (name) => (created.push(name), make(name));
    expect(TCGB.readOrder(wrap).error).toBe("");
    expect(created).toEqual([]);
  });

  test("refuses several refunds that do not come to their total", () => {
    const o = withNote("div-sellerorderwidget-refunds", several("$2.60"));
    expect(o.error).toBe("refunds that do not add up to their total");
  });

  test("a Sales Tax row naming no state", () => {
    const o = withOrder((wrap) => {
      const td = [...wrap.querySelectorAll('[data-aid="tbl-sellerorderwidget-productsinorder"] td')].find((t) => /Sales Tax/.test(t.textContent));
      td.textContent = " Sales Tax: ";
    });
    expect(o.error).toBe("");
    expect(o.summary.taxes).toEqual(["Sales Tax"]);
  });

  test("Canada's GST is a tax like any other", () => {
    const o = withOrder((wrap) => {
      const td = [...wrap.querySelectorAll('[data-aid="tbl-sellerorderwidget-productsinorder"] td')].find((t) => /Sales Tax/.test(t.textContent));
      td.textContent = " CA GST: ";
    });
    expect(o.error).toBe("");
    expect(o.summary.taxes).toEqual(["CA GST"]);
  });

  test("refuses an order whose lines do not add up", () => {
    const o = withOrder((wrap) => wrap.querySelector("table.orderTable tbody tr").remove());
    expect(o.error).toContain("do not add up");
    expect(o.id).not.toBe("");
  });

  test("refuses a summary row it does not know", () => {
    const o = withOrder((wrap) => {
      const tr = wrap.querySelector('[data-aid="tbl-sellerorderwidget-productsinorder"] tr');
      tr.querySelector("td").textContent = "Discount:";
    });
    expect(o.error).toContain('"Discount:"');
  });

  test("refuses a note it does not read", () => {
    const o = withOrder((wrap) => {
      const note = wrap.ownerDocument.createElement("div");
      note.className = "orderAlert yellow";
      note.setAttribute("data-aid", "div-sellerorderwidget-multiplerefund");
      note.textContent = "Refunds were issued.";
      wrap.querySelector(".orderContent").prepend(note);
    });
    expect(o.error).toContain("note");
  });

  test("refuses a header label it does not know", () => {
    const o = withOrder((wrap) => {
      wrap.querySelector(".orderHeader .orderTitle").textContent = "Placed";
    });
    expect(o.error).toContain('"Placed"');
  });

  test("an order TCGplayer sold itself", () => {
    const doc = fixture();
    const wrap = [...doc.querySelectorAll(".orderWrap")].find((w) => /Order Number/.test(w.querySelector(".orderHeader").textContent));
    const title = [...wrap.querySelectorAll(".orderHeader .orderTitle")].find((t) => /Order Number/.test(t.textContent));
    title.parentNode.lastChild.textContent = " TCGPLAYER-682806-7F98E ";
    const o = TCGB.readOrder(wrap);
    expect([o.error, o.kind, o.id]).toEqual(["", "Seller", "TCGPLAYER-682806-7F98E"]);
    title.parentNode.lastChild.textContent = " 33636-744618-D7765 ";
    expect(TCGB.readOrder(wrap).id).toBe("33636-744618-D7765");
  });

  test("refuses an order number of another shape", () => {
    const o = withOrder((wrap) => {
      const span = [...wrap.querySelectorAll(".orderHeader .orderTitle")].find((t) => /DIRECT/.test(t.textContent)).parentNode;
      span.lastChild.textContent = " 12345 ";
    });
    expect(o.error).toContain("another shape");
  });

  test("marks a pending order", () => {
    const o = withOrder((wrap) => {
      const badge = wrap.ownerDocument.createElement("span");
      badge.className = "pendingOrder";
      wrap.querySelector(".orderHeader").append(badge);
    });
    expect(o.error).toBe("");
    expect(o.pending).toBe(true);
  });
});

describe("a line", () => {
  const first = () => TCGB.readPage(fixture()).orders[0].lines[0];

  test("reads the card from its own row", () => {
    const l = first();
    expect(l.productID).toBe("4842");
    expect(l.name).toBe("Portent");
    expect(l.edition).toBe("Ice Age");
    expect(l.game).toBe("magic");
    expect(l.rarity).toBe("C");
    expect(l.condition).toBe("SP");
    expect(l.foil).toBe(false);
    expect(l.problem).toBe("");
  });

  test("folds every condition onto BAN's codes, foil apart", () => {
    const lines = TCGB.readPage(fixture()).orders.flatMap((o) => o.lines);
    expect([...new Set(lines.map((l) => l.condition))].sort()).toEqual(["HP", "MP", "NM", "SP"]);
    expect(lines.some((l) => l.foil)).toBe(true);
    expect(lines.filter((l) => l.problem)).toEqual([]);
  });

  test("a language follows the condition", () => {
    const o = withOrder((wrap) => {
      wrap.querySelector("td.orderHistoryDetail").innerHTML = "Rarity: R<br> Condition: Near Mint Foil - Japanese";
    });
    expect([o.lines[0].condition, o.lines[0].foil, o.lines[0].language, o.lines[0].problem]).toEqual(["NM", true, "Japanese", ""]);
    expect(o.lines[1].language).toBe("English");
  });

  test("details of another shape are the line's problem, not a guess", () => {
    const o = withOrder((wrap) => {
      wrap.querySelector("td.orderHistoryDetail").textContent = "Rarity: C Condition: Near Mint Signed";
    });
    expect(o.error).toBe("");
    expect(o.lines[0].problem).toBe("details of another shape");
    expect(o.lines[0].condition).toBe("");
  });

  test("a sealed product is read as sealed, with no condition", () => {
    const o = withOrder((wrap) => {
      wrap.querySelector("td.orderHistoryDetail").innerHTML = "Rarity: <br> Condition: Unopened";
    });
    expect(o.lines[0].sealed).toBe(true);
    expect(o.lines[0].problem).toBe("");
    expect(o.lines[0].condition).toBe("");
  });

  test("the thumbnail's fallback is no product id", () => {
    const o = withOrder((wrap) => {
      wrap.querySelector("img.orderThumbnail").setAttribute("data-original", "https://tcgplayer-cdn.tcgplayer.com/product/0_25w.jpg");
    });
    expect(o.lines[0].productID).toBe("");
    expect(o.lines[0].problem).toBe("no product id");
  });

  test("the product link is the row's, not the seller's", () => {
    // The header's seller link is an a.nocontext too; a line reads only
    // inside its own row.
    const seller = TCGB.readPage(fixture()).orders.find((o) => o.kind === "Seller");
    expect(seller.lines.every((l) => l.game === "magic" && !/^Seller/.test(l.name))).toBe(true);
  });
});

test("the fixture is what the cutter writes", () => {
  expect(text("orders.html").startsWith("<!-- Cut by scripts/cut-fixtures.mjs")).toBe(true);
});
