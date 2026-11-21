// Reads one TCGplayer order history page: the filter the session holds, the
// list's heading and pager, and every order with its lines.
//
// Everything is found by a label, a class or a data-aid, never by position,
// and an order that cannot be read whole is refused with its number rather
// than read short. SPECIFICATIONS.md section 1 says what each piece is.

globalThis.TCGB = globalThis.TCGB || {};

(function (TCGB) {
  "use strict";

  var squeeze = TCGB.squeeze;

  // Order numbers: a seller order's three hex groups, the first of them
  // the seller's id (eight digits, five on orders from 2020 and before) or,
  // for an order TCGplayer sold itself, "TCGPLAYER"; a Direct order's date
  // and four hex digits.
  var SELLER_NUMBER = /^(?:[0-9A-F]{8}|[0-9A-F]{5}|TCGPLAYER)-[0-9A-F]{6}-[0-9A-F]{5}$/;
  var DIRECT_NUMBER = /^\d{6}-[0-9A-F]{4}$/;

  var HEADER = {
    "Order Date": "date",
    Channel: "channel",
    "Order Number": "Seller",
    "TCGPLAYER DIRECT #": "Direct",
  };

  var VIEWING = /^Viewing (\d+) - (\d+) of (\d+) order\(s\) placed in (.+)$/;
  var NONE = "You do not have any orders to display.";
  var NO_MATCH = "No orders match your search criteria.";

  var REFUND_AID = "div-sellerorderwidget-singlerefund";
  var REFUNDS_AID = "div-sellerorderwidget-refunds";
  var REFUNDS = /^Multiple refunds have been issued on this order for the total amount of (\$[\d,]+\.\d{2})\. \(Show\) \(Hide\) /;
  var REFUND = /^A (partial|full|shipping cost) refund was issued on ([A-Z][a-z]+ \d{1,2}, \d{4}) for the amount of (\$[\d,]+\.\d{2})\.(?: \(Details\))?$/;

  // A single's details, "Near Mint Foil - Japanese" for a printing not in
  // English; sealed product prints no rarity and is Unopened.
  var DETAILS = /^Rarity: ([A-Z]{1,2}) Condition: (Near Mint|Lightly Played|Moderately Played|Heavily Played)( Foil)?(?: - ([A-Z][A-Za-z ()]*[A-Za-z)]))?$/;
  var SEALED = "Rarity: Condition: Unopened";

  var TAX = /^(?:Sales Tax(?: \([A-Z]{2}\))?|[A-Z]{2} (?:GST|HST|PST|QST)):$/;

  // BAN's own condition codes, the ones go-mtgban folds TCGplayer's into.
  var CONDITIONS = {
    "Near Mint": "NM",
    "Lightly Played": "SP",
    "Moderately Played": "MP",
    "Heavily Played": "HP",
  };

  var THUMBNAIL = /^https:\/\/tcgplayer-cdn\.tcgplayer\.com\/product\/(\d+)_\w+\.jpg$/;

  var STORE = "https://store.tcgplayer.com/";

  function refuse(message) {
    throw new Error(message);
  }

  // valueOf is a header or summary pair's value: the text of the element
  // holding the label, without the label.
  function valueOf(title) {
    var holder = title.parentNode.cloneNode(true);
    var labels = holder.querySelectorAll(".orderTitle");
    for (var i = 0; i < labels.length; i++) {
      labels[i].remove();
    }
    return squeeze(holder.textContent);
  }

  // numberNode is the bare text node the order number is printed as.
  function numberNode(title, number) {
    var nodes = title.parentNode.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3 && squeeze(nodes[i].textContent) === number) {
        return nodes[i];
      }
    }
    return null;
  }

  function readHeader(order, header) {
    var titles = header.querySelectorAll(".orderTitle");
    var seen = {};
    for (var i = 0; i < titles.length; i++) {
      var label = squeeze(titles[i].textContent);
      var field = HEADER[label];
      if (!field) {
        refuse("an order header labelled \"" + label + "\"");
      }
      if (seen[field]) {
        refuse("an order header with two \"" + label + "\"");
      }
      seen[field] = true;
      var value = valueOf(titles[i]);
      if (field === "date") {
        order.dateText = value;
        order.date = TCGB.date(value);
      } else if (field === "channel") {
        order.channel = value;
      } else {
        order.kind = field;
        order.id = value;
        order.numberNode = numberNode(titles[i], value);
      }
    }
    if (!order.kind) {
      refuse("an order with no order number");
    }
    if (!(order.kind === "Seller" ? SELLER_NUMBER : DIRECT_NUMBER).test(order.id)) {
      refuse("an order number of another shape");
    }
    if (!order.numberNode) {
      refuse("an order number not printed on its own");
    }
    if (!order.date) {
      refuse("an order date of another shape");
    }
  }

  function readSummary(order, wrap) {
    var table = wrap.querySelector('table[data-aid="tbl-sellerorderwidget-productsinorder"]');
    if (!table) {
      refuse("no order summary");
    }
    var summary = { quantity: null, subtotal: null, shipping: null, tax: 0, taxes: [], total: null };
    var rows = table.querySelectorAll("tr");
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].querySelectorAll("td");
      if (cells.length !== 2) {
        refuse("an order summary row of another shape");
      }
      var label = squeeze(cells[0].textContent);
      var value = squeeze(cells[1].textContent);
      // "Sales Tax (NY):", "Sales Tax:", or Canada's "CA GST:"; an order
      // may carry more than one, and they add up to the Total with the rest.
      var tax = TAX.exec(label);
      if (label === "Quantity:") {
        summary.quantity = TCGB.count(value);
      } else if (label === "Subtotal:") {
        summary.subtotal = TCGB.cents(value);
      } else if (label === "Shipping:") {
        summary.shipping = TCGB.cents(value);
      } else if (label === "Total:") {
        summary.total = TCGB.cents(value);
      } else if (tax) {
        var cents = TCGB.cents(value);
        summary.taxes.push(label.slice(0, -1));
        summary.tax = cents === null || summary.tax === null ? null : summary.tax + cents;
      } else {
        refuse("an order summary row labelled \"" + label + "\"");
      }
    }
    for (var key in summary) {
      if (summary[key] === null) {
        refuse("an order summary with no readable " + key);
      }
    }
    order.summary = summary;
  }

  // refundOf reads one refund's line, or refuses it.
  function refundOf(text) {
    var m = REFUND.exec(text);
    var when = m && TCGB.date(m[2]);
    var cents = m && TCGB.cents(m[3]);
    if (!when || cents === null) {
      refuse("a refund of another shape");
    }
    return { kind: m[1], date: when, cents: cents };
  }

  // readAlerts reads the order's refunds: one note for a single refund, or
  // one for several, which names their total and lists each in a span the
  // page shows on (Show). The listed ones must come to that total.
  function readAlerts(order, wrap) {
    order.refunds = [];
    var alerts = wrap.querySelectorAll(".orderAlert");
    for (var i = 0; i < alerts.length; i++) {
      var aid = alerts[i].getAttribute("data-aid");
      if (aid === REFUND_AID) {
        order.refunds.push(refundOf(squeeze(alerts[i].textContent)));
        continue;
      }
      var head = REFUNDS.exec(squeeze(alerts[i].textContent));
      var list = alerts[i].querySelectorAll('span[id^="Refunds_"]');
      if (aid !== REFUNDS_AID || !head || list.length !== 1) {
        refuse("an order note this does not read");
      }
      // One refund between each <br>, read off the nodes themselves: this
      // runs on TCGplayer's live page, where re-parsing markup would make it
      // live again.
      var pieces = [""];
      var nodes = list[0].childNodes;
      for (var j = 0; j < nodes.length; j++) {
        if (nodes[j].nodeType === 1 && nodes[j].tagName === "BR") {
          pieces.push("");
        } else {
          pieces[pieces.length - 1] += nodes[j].textContent;
        }
      }
      var listed = 0;
      for (var k = 0; k < pieces.length; k++) {
        var text = squeeze(pieces[k]);
        if (text) {
          var refund = refundOf(text);
          listed += refund.cents;
          order.refunds.push(refund);
        }
      }
      if (listed !== TCGB.cents(head[1])) {
        refuse("refunds that do not add up to their total");
      }
    }
    order.refunded = order.refunds.reduce(function (sum, r) {
      return sum + r.cents;
    }, 0);
  }

  // editionOf is the set line: the text after the product link's <br>, up
  // to the next element.
  function editionOf(link) {
    var text = "";
    var node = link.nextSibling;
    if (node && node.nodeType === 1 && node.tagName === "BR") {
      node = node.nextSibling;
    }
    while (node && node.nodeType !== 1) {
      if (node.nodeType === 3) {
        text += node.textContent;
      }
      node = node.nextSibling;
    }
    return squeeze(text);
  }

  // readLine reads one line of an order. Its price and quantity must be
  // read, or the order cannot be added up and is refused; anything else a
  // line cannot say is its problem, kept beside what was read.
  function readLine(tr) {
    var cell = function (name) {
      var found = tr.querySelectorAll("td." + name);
      if (found.length !== 1) {
        refuse("a line without one " + name + " cell");
      }
      return found[0];
    };
    var items = cell("orderHistoryItems");
    var line = {
      productID: "",
      name: "",
      edition: "",
      game: "",
      seller: "",
      rarity: "",
      condition: "",
      foil: false,
      language: "",
      sealed: false,
      each: TCGB.cents(cell("orderHistoryPrice").textContent),
      qty: TCGB.count(cell("orderHistoryQuantity").textContent),
      problem: "",
    };
    if (line.each === null || !line.qty) {
      refuse("a line whose price or quantity cannot be read");
    }

    var img = items.querySelectorAll("img.orderThumbnail");
    var id = img.length === 1 ? THUMBNAIL.exec(img[0].getAttribute("data-original") || "") : null;
    if (id && id[1] !== "0") {
      line.productID = id[1];
    }

    var links = items.querySelectorAll("a.nocontext");
    if (links.length === 1) {
      line.name = squeeze(links[0].textContent);
      line.edition = editionOf(links[0]);
      var path;
      try {
        path = new URL(links[0].getAttribute("href") || "", STORE);
      } catch (err) {
        path = null;
      }
      var parts = path && path.origin + "/" === STORE ? path.pathname.split("/") : [];
      line.game = parts.length === 4 ? parts[1] : "";
    }

    var seller = items.querySelector(".orderSoldby a");
    line.seller = seller ? squeeze(seller.textContent) : "";

    var detail = squeeze(cell("orderHistoryDetail").textContent);
    var details = DETAILS.exec(detail);
    if (details) {
      line.rarity = details[1];
      line.condition = CONDITIONS[details[2]];
      line.foil = !!details[3];
      line.language = details[4] || "English";
    }
    line.sealed = detail === SEALED;

    if (!line.productID) {
      line.problem = "no product id";
    } else if (!line.name || !line.edition || !line.game) {
      line.problem = "no product link";
    } else if (!details && !line.sealed) {
      line.problem = "details of another shape";
    }
    return line;
  }

  function readLines(order, wrap) {
    var table = wrap.querySelectorAll('table.orderTable[data-aid="tbl-sellerorderwidget-ordertable"]');
    if (table.length !== 1) {
      refuse("an order without one table of lines");
    }
    var heads = table[0].querySelectorAll("thead th");
    var named = [];
    for (var i = 0; i < heads.length; i++) {
      named.push(squeeze(heads[i].textContent));
    }
    if (named.join(",") !== "ITEMS,DETAILS,PRICE,QUANTITY") {
      refuse("an order table with other columns");
    }
    order.lines = [];
    var rows = table[0].querySelectorAll("tbody tr");
    for (var j = 0; j < rows.length; j++) {
      order.lines.push(readLine(rows[j]));
    }
    if (!order.lines.length) {
      refuse("an order with no lines");
    }
  }

  function readSeller(order, wrap) {
    if (order.kind === "Direct") {
      order.seller = "TCGplayer Direct";
      for (var i = 0; i < order.lines.length; i++) {
        if (!order.lines[i].seller) {
          refuse("a Direct line with no seller");
        }
      }
      return;
    }
    var vendor = wrap.querySelectorAll('[data-aid="spn-sellerorderwidget-vendorname"] a');
    if (vendor.length !== 1) {
      refuse("a seller order with no seller");
    }
    order.seller = squeeze(vendor[0].textContent);
  }

  // addsUp checks the lines are all of the order: their quantities come to
  // its Quantity, their prices to its Subtotal, and the Subtotal with
  // Shipping and Tax to its Total.
  function addsUp(order) {
    var qty = 0;
    var subtotal = 0;
    for (var i = 0; i < order.lines.length; i++) {
      qty += order.lines[i].qty;
      subtotal += order.lines[i].qty * order.lines[i].each;
    }
    var s = order.summary;
    if (qty !== s.quantity || subtotal !== s.subtotal || s.subtotal + s.shipping + s.tax !== s.total) {
      refuse("an order whose lines do not add up to its summary");
    }
  }

  // readOrder answers with the order, or with {id, error} when it cannot be
  // read whole; id is what could be read of its number.
  TCGB.readOrder = function (wrap) {
    var order = { id: "", wrap: wrap };
    try {
      var header = wrap.querySelectorAll(".orderHeader");
      if (header.length !== 1) {
        refuse("an order without one header");
      }
      readHeader(order, header[0]);
      order.pending = !!wrap.querySelector(".pendingOrder");
      readSummary(order, wrap);
      readAlerts(order, wrap);
      readLines(order, wrap);
      readSeller(order, wrap);
      addsUp(order);
    } catch (err) {
      return { id: order.id, wrap: wrap, numberNode: order.numberNode || null, error: err.message };
    }
    order.amount = order.summary.total - order.refunded;
    order.error = "";
    return order;
  };

  // readFilter is the filter as the server rendered it: the range selected,
  // the search, the years offered, and the form's token.
  TCGB.readFilter = function (doc) {
    var form = doc.querySelector("form#OrderHistoryFilterForm");
    var select = form && form.querySelector("select#DateRange");
    var search = form && form.querySelector("input#SearchString");
    var token = form && form.querySelector('input[name="__RequestVerificationToken"]');
    if (!form || !select || !search || !token) {
      return null;
    }
    var options = select.querySelectorAll("option");
    var range = "";
    var ranges = [];
    var years = [];
    for (var i = 0; i < options.length; i++) {
      var text = squeeze(options[i].textContent);
      ranges.push(text);
      if (/^\d{4}$/.test(text)) {
        years.push(text);
      }
      if (options[i].hasAttribute("selected")) {
        range = text;
      }
    }
    return {
      form: form,
      range: range || ranges[0] || "",
      ranges: ranges,
      years: years,
      search: squeeze(search.getAttribute("value") || ""),
      token: token.getAttribute("value") || "",
    };
  };

  // placedIn is how the list's heading names a range: "2025", or "the last
  // 30 days" for "Last 30 Days".
  TCGB.placedIn = function (range) {
    return /^\d{4}$/.test(range) ? range : "the " + range.toLowerCase();
  };

  // readPage reads a whole page, or throws when it is not an order history
  // (a sign-in page, an error) or its list's heading is not one this reads.
  TCGB.readPage = function (doc) {
    var filter = TCGB.readFilter(doc);
    var crumbs = doc.querySelectorAll(".breadcrumbs");
    if (!filter || crumbs.length !== 1) {
      throw new Error(TCGB.NOT_HISTORY);
    }
    var heading = squeeze(crumbs[0].textContent);
    var list = { empty: "", first: 0, last: 0, total: 0, placed: "" };
    var m = VIEWING.exec(heading);
    if (m) {
      list.first = Number(m[1]);
      list.last = Number(m[2]);
      list.total = Number(m[3]);
      list.placed = m[4];
    } else if (heading === NONE) {
      list.empty = "none";
    } else if (heading === NO_MATCH) {
      list.empty = "nomatch";
    } else {
      throw new Error("The order list's heading is not one tcg-banner reads");
    }

    // The last page's own LAST is disabled and links nowhere.
    var last = doc.querySelector(".pager a.pageLast:not(.ui-state-disabled)");
    var pageLast = null;
    if (last) {
      var n = /[?&]PageNumber=(\d+)$/.exec(last.getAttribute("href") || "");
      if (!n) {
        throw new Error("The order list's pager is not one tcg-banner reads");
      }
      pageLast = Number(n[1]);
    }

    var wraps = doc.querySelectorAll("#SellerOrderWidgetWrap .orderWrap");
    var orders = [];
    for (var i = 0; i < wraps.length; i++) {
      orders.push(TCGB.readOrder(wraps[i]));
    }
    return { filter: filter, list: list, pageLast: pageLast, orders: orders };
  };

  TCGB.NOT_HISTORY = "TCGplayer did not answer with the order history; sign in and try again";
})(globalThis.TCGB);
