// The content script on TCGplayer's order history: every order number made
// a control that searches for it, a Send to BAN beside each order whose
// cards can be sent, and the panel that saves a year as CSV.

globalThis.TCGB = globalThis.TCGB || {};

(function (TCGB) {
  "use strict";

  // The manifest names the host alone, and the path is decided here, read
  // the way TCGplayer's server reads it: any letter case, and slashes
  // doubled or not. It answers //myaccount/orderhistory too, which no
  // single match pattern covers alongside the plain one.
  function onHistory(pathname) {
    return pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "").toLowerCase() === "/myaccount/orderhistory";
  }

  if (!onHistory(location.pathname)) {
    return;
  }

  var filter = TCGB.readFilter(document);
  if (!filter || !document.querySelector(".breadcrumbs")) {
    // A sign-in page, an error: nothing here to read.
    return;
  }

  // ---- The order number searches for itself ----

  // search does what typing the number and pressing Search does: the page's
  // own form, its own button, the range already selected. A clicked order is
  // on the page, so it is inside that range.
  function search(number) {
    var box = filter.form.querySelector("input#SearchString");
    var button = filter.form.querySelector('input[type="submit"]');
    // .value alone: the box carries jQuery's autocomplete, which a key
    // event would wake.
    box.value = number;
    filter.form.requestSubmit(button);
  }

  function orderButton(order) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "tcg-banner-order";
    button.textContent = order.id;
    button.addEventListener("click", function () {
      search(order.id);
    });
    // The number and its Send to BAN keep to one line: the header's column
    // is just wide enough for a seller order's number alone.
    var line = document.createElement("span");
    line.className = "tcg-banner-number";
    line.appendChild(button);
    order.numberNode.replaceWith(line);
    return button;
  }

  // ---- Send to BAN ----

  // sendable is an order's lines that can go to mtgban, and what was left.
  function sendable(order) {
    var lines = [];
    var other = 0;
    var sealed = 0;
    var foreign = 0;
    var unread = 0;
    for (var i = 0; i < order.lines.length; i++) {
      var l = order.lines[i];
      if (!TCGB.handoffURL(l.game)) {
        other++;
      } else if (l.sealed) {
        // Until mtgban's uploader is known to resolve a sealed product id.
        sealed++;
      } else if (l.problem) {
        unread++;
      } else if (l.language !== "English") {
        // mtgban's uploader reads no language: the product id would price
        // the English printing.
        foreign++;
      } else {
        lines.push(l);
      }
    }
    return { lines: lines, other: other, sealed: sealed, foreign: foreign, unread: unread };
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  // left says what a send did not carry, one fact a line.
  function left(order, cards) {
    var notes = [];
    if (cards.other) {
      notes.push(plural(cards.other, "line", "lines") + " of another game not sent");
    }
    if (cards.sealed) {
      notes.push(plural(cards.sealed, "sealed line", "sealed lines") + " not sent");
    }
    if (cards.foreign) {
      notes.push(plural(cards.foreign, "line", "lines") + " not in English, not sent");
    }
    if (cards.unread) {
      notes.push(plural(cards.unread, "line", "lines") + " not read whole, not sent");
    }
    if (order.refunded) {
      notes.push("A refund of " + TCGB.dollars(order.refunded) + " does not say which cards it covers");
    }
    return notes;
  }

  function sendButton(order, after) {
    var cards = sendable(order);
    if (!cards.lines.length) {
      return;
    }
    var button = document.createElement("button");
    button.type = "button";
    button.className = "tcg-banner-send";
    // The stroopwafel alone, beside the number; the name is for a screen
    // reader and the cursor.
    button.setAttribute("aria-label", "Send to BAN");
    button.title = "Send to BAN";
    button.addEventListener("click", function () {
      // A walk owns the panel until it ends.
      if (panel.working()) {
        return;
      }
      var count = cards.lines.reduce(function (n, l) {
        return n + l.qty;
      }, 0);
      panel.clear();
      TCGB.handOff("magic", TCGB.cardsCSV(cards.lines), cards.lines.length, function (error) {
        // The later send speaks for itself, and a walk started since owns
        // the panel: its count and its file matter more, and the BAN tab
        // already shows what it took.
        if (error === TCGB.REPLACED || panel.working()) {
          return;
        }
        if (error) {
          panel.fail(error);
          return;
        }
        panel.word("");
        panel.recap(["Sent " + plural(count, "card", "cards") + " of " + order.id].concat(left(order, cards)).join("\n"));
      });
    });
    after.after(button);
  }

  // holdSends disables every Send to BAN while a walk runs.
  function holdSends(on) {
    var sends = document.querySelectorAll("button.tcg-banner-send");
    for (var i = 0; i < sends.length; i++) {
      sends[i].disabled = on;
    }
  }

  // ---- The panel ----

  var panel = TCGB.panel();
  var HINT = "Save a year's orders as CSV";
  panel.hint(HINT);

  var year = document.createElement("select");
  year.className = "tcg-banner-year";
  year.setAttribute("aria-label", "Year");
  for (var y = 0; y < filter.years.length; y++) {
    var option = document.createElement("option");
    option.value = option.textContent = filter.years[y];
    year.appendChild(option);
  }
  if (filter.years.indexOf(filter.range) >= 0) {
    year.value = filter.range;
  }

  var go = document.createElement("button");
  go.type = "button";
  go.className = "tcg-banner-go";
  go.textContent = "Download CSV";
  go.addEventListener("click", function () {
    save();
  });

  panel.actions.appendChild(year);
  panel.actions.appendChild(go);

  // Walks done on this page, by year, so asking for a year again costs no
  // second walk.
  var walked = {};
  var stopped = false;

  year.addEventListener("change", function () {
    panel.word("");
    panel.clear();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && panel.working()) {
      stopped = true;
    }
  });

  function write(chosen, result) {
    var name = "tcg-orders-" + chosen + ".csv";
    if (!result.orders.length) {
      panel.word("no orders");
      panel.fail("No orders were placed in " + chosen + (result.pending ? " that have shipped" : ""));
      return;
    }
    TCGB.download(TCGB.ordersCSV(result.orders), name);
    panel.word(plural(result.orders.length, "order", "orders"));
    panel.mark("done");
    var notes = ["Saved " + name + " from " + plural(result.pages, "page", "pages")];
    if (result.pending) {
      notes.push(plural(result.pending, "pending order", "pending orders") + " left out");
    }
    if (result.restore) {
      notes.push(result.restore);
    }
    panel.recap(notes.join("\n"));
  }

  function save() {
    var chosen = year.value;
    if (walked[chosen]) {
      write(chosen, walked[chosen]);
      return;
    }
    stopped = false;
    panel.clear();
    panel.busy(true);
    holdSends(true);
    TCGB.walkYear(chosen, {
      step: function (n, of) {
        panel.word("page " + n + (of ? " of " + of : ""));
      },
      stopped: function () {
        return stopped;
      },
      waiting: function (ms) {
        panel.word("waiting " + Math.round(ms / 1000) + " s");
      },
    }).then(
      function (result) {
        panel.busy(false);
        holdSends(false);
        walked[chosen] = result;
        write(chosen, result);
      },
      function (err) {
        panel.busy(false);
        holdSends(false);
        panel.word("");
        panel.fail(err.message + (err.restore ? "\n" + err.restore : ""));
      }
    );
  }

  // ---- Every order on the page ----

  var wraps = document.querySelectorAll("#SellerOrderWidgetWrap .orderWrap");
  for (var i = 0; i < wraps.length; i++) {
    var order = TCGB.readOrder(wraps[i]);
    if (!order.numberNode) {
      continue;
    }
    var button = orderButton(order);
    if (!order.error) {
      sendButton(order, button);
    }
  }

  document.body.appendChild(panel.root);
})(globalThis.TCGB);
