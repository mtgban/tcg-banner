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

  // One row per order. The first three are the columns go-mtgban's
  // tcgHistory wrote and ck-banner's history file shares, under the same
  // names and meaning the same thing; Amount is what was paid, net of
  // refunds. The money then reads left to right as a sum: Subtotal,
  // Shipping, Sales Tax and the refunds, as a negative, come to Total.
  var ORDERS = [
    ["Order ID", function (o) { return o.id; }],
    ["Order Date", function (o) { return o.dateText; }],
    ["Amount", function (o) { return TCGB.dollars(o.amount); }],
    ["Kind", function (o) { return o.kind; }],
    ["Seller", function (o) { return text(o.seller); }],
    ["Quantity", function (o) { return o.summary.quantity; }],
    ["Subtotal", function (o) { return TCGB.dollars(o.summary.subtotal); }],
    ["Shipping", function (o) { return TCGB.dollars(o.summary.shipping); }],
    ["Sales Tax", function (o) { return TCGB.dollars(o.summary.tax); }],
    ["Refunded", function (o) { return o.refunded ? TCGB.dollars(-o.refunded) : ""; }],
    ["Total", function (o) { return TCGB.dollars(o.amount); }],
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

  TCGB.ordersCSV = function (orders) {
    return table(ORDERS, orders);
  };

  // cardsCSV is what goes to mtgban: the uploader's columns alone.
  TCGB.cardsCSV = function (lines) {
    return table(CARDS, lines);
  };
})(globalThis.TCGB);
