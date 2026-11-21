// Writes orders and their lines as CSV, byte for byte what Go's csv.Writer
// writes for the same rows: a value is quoted only when it holds a comma, a
// quote or a line break, a quote is doubled, and every row ends in LF.

globalThis.TCGB = globalThis.TCGB || {};

(function (TCGB) {
  "use strict";

  function field(value) {
    var text = value === undefined || value === null ? "" : String(value);
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  // text keeps a spreadsheet from running free text as a formula: a seller
  // names their own store, and "=HYPERLINK(...)" is a name like any other.
  function text(value) {
    return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  }

  function table(columns, rows) {
    var lines = [columns.map(function (c) { return field(c[0]); }).join(",")];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      lines.push(columns.map(function (c) { return field(c[1](row)); }).join(","));
    }
    return lines.join("\n") + "\n";
  }

  // taxState is the state an order's "Sales Tax (NY)" row names. A plain
  // "Sales Tax" or Canada's "CA GST" names none. Should rows ever name two,
  // both are given rather than one picked.
  function taxState(o) {
    var named = [];
    for (var i = 0; i < o.summary.taxes.length; i++) {
      var m = /^Sales Tax \(([A-Z]{2})\)$/.exec(o.summary.taxes[i]);
      if (m && named.indexOf(m[1]) < 0) {
        named.push(m[1]);
      }
    }
    return named.join(" ");
  }

  // refundedTax is the tax share of an order's refunds, in cents: the
  // refunds scaled by the order's tax over its Total. A refund note gives one
  // amount and never says how much of it was tax, so this is exact for a full
  // refund and an estimate for any other.
  function refundedTax(o) {
    return o.summary.total ? Math.round((o.refunded * o.summary.tax) / o.summary.total) : 0;
  }

  // One row per order. The first three are the columns go-mtgban's
  // tcgHistory wrote and ck-banner's history file shares, under the same
  // names and meaning the same thing; Amount is what was paid, net of
  // refunds. The money then reads left to right as a sum: Subtotal,
  // Shipping, Sales Tax and the refunds, as a negative, come to Total.
  // Refunded Tax, after it, is the part of Refunded that was tax.
  var ORDERS = [
    ["Order ID", function (o) { return o.id; }],
    ["Order Date", function (o) { return o.dateText; }],
    ["Amount", function (o) { return TCGB.dollars(o.amount); }],
    ["Kind", function (o) { return o.kind; }],
    ["Seller", function (o) { return text(o.seller); }],
    ["Tax State", taxState],
    ["Quantity", function (o) { return o.summary.quantity; }],
    ["Subtotal", function (o) { return TCGB.dollars(o.summary.subtotal); }],
    ["Shipping", function (o) { return TCGB.dollars(o.summary.shipping); }],
    ["Sales Tax", function (o) { return TCGB.dollars(o.summary.tax); }],
    ["Refunded", function (o) { return o.refunded ? TCGB.dollars(-o.refunded) : ""; }],
    ["Total", function (o) { return TCGB.dollars(o.amount); }],
    ["Refunded Tax", function (o) { return o.refunded ? TCGB.dollars(-refundedTax(o)) : ""; }],
  ];

  // The columns mtgban's uploader reads, each traced through docparse's
  // ParseHeader. The product id resolves the printing exactly; never add a
  // column headed "TCGplayer Id", which docparse takes for a SKU and lets
  // wipe the product id.
  var CARDS = [
    ["TCGplayer Product ID", function (l) { return l.productID; }],
    ["Name", function (l) { return l.name; }],
    ["Edition", function (l) { return l.edition; }],
    ["Foil", function (l) { return l.foil ? "Yes" : "No"; }],
    ["Condition", function (l) { return l.sealed ? "Sealed" : l.condition; }],
    ["Quantity", function (l) { return l.qty; }],
    ["Price", function (l) { return TCGB.decimal(l.each); }],
  ];

  // One order's lines, for a spreadsheet: the uploader's columns, its free
  // text guarded, then where each line came from. "Order", not "Order
  // Number": docparse reads a header holding "number" as the card's variant.
  var ITEMS = CARDS.map(function (c) {
    return c[0] === "Name" || c[0] === "Edition"
      ? [c[0], function (l) { return text(c[1](l)); }]
      : c;
  }).concat([
    ["Order", function (l) { return l.order.id; }],
    ["Order Date", function (l) { return l.order.dateText; }],
    ["Seller", function (l) { return text(l.seller || l.order.seller); }],
    ["Game", function (l) { return l.game; }],
    ["Language", function (l) { return l.language; }],
  ]);

  TCGB.ordersCSV = function (orders) {
    return table(ORDERS, orders);
  };

  // orderCSV is one order's file: a row for every line it holds.
  TCGB.orderCSV = function (order) {
    return table(ITEMS, order.lines.map(function (l) {
      return Object.assign({ order: order }, l);
    }));
  };

  // cardsCSV is what goes to mtgban: the uploader's columns alone.
  TCGB.cardsCSV = function (lines) {
    return table(CARDS, lines);
  };
})(globalThis.TCGB);
