// The content script on TCGplayer's order history: every order number made
// a control that searches for it, a Send to BAN beside each order whose
// cards can be sent, and the panel. The panel saves a year as CSV, or, on a
// list a search has narrowed to one order, that order's cards, which it
// can also send to BAN.

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

  // send hands an order's sendable cards to mtgban and says on the panel
  // what went. It runs straight from a click: window.open needs one.
  function send(order, cards) {
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
      send(order, cards);
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

  // ---- Every order on the page ----

  var orders = [];
  var wraps = document.querySelectorAll("#SellerOrderWidgetWrap .orderWrap");
  for (var i = 0; i < wraps.length; i++) {
    var order = TCGB.readOrder(wraps[i]);
    if (!order.numberNode) {
      continue;
    }
    orders.push(order);
    var button = orderButton(order);
    if (!order.error) {
      sendButton(order, button);
    }
  }

  // ---- The panel ----

  var panel = TCGB.panel();

  // idle is the panel with nothing done yet, or nothing done since the
  // choice changed.
  function idle() {
    panel.clear();
    panel.word("ready");
    panel.mark("done");
  }

  // single is the order a search has narrowed the list to, read whole, or
  // null: the panel then offers that order rather than a year.
  function single() {
    if (!filter.search || orders.length !== 1 || orders[0].error) {
      return null;
    }
    try {
      return TCGB.readPage(document).list.total === 1 ? orders[0] : null;
    } catch (err) {
      return null;
    }
  }

  function goButton(text, act) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "tcg-banner-go";
    button.textContent = text;
    button.addEventListener("click", act);
    panel.actions.appendChild(button);
    return button;
  }

  // ---- One order: its cards, as a file or to BAN ----

  function orderPanel(one) {
    var cards = sendable(one);
    panel.hint(
      "Save the cards of " + one.id + " as CSV" +
        (cards.lines.length ? ", or send them to BAN" : "; none of them can go to BAN")
    );

    goButton("Download CSV", function () {
      var name = "tcg-order-" + one.id + ".csv";
      var count = one.lines.reduce(function (n, l) {
        return n + l.qty;
      }, 0);
      TCGB.download(TCGB.orderCSV(one), name);
      panel.word(plural(count, "card", "cards"));
      panel.mark("done");
      panel.recap("Saved " + name);
    });

    goButton("Send to BAN", function () {
      send(one, cards);
    }).disabled = !cards.lines.length;
  }

  // ---- A year: walked, every order of it in one file ----

  function yearPanel() {
    panel.hint("Save a year's orders as CSV");

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
    panel.actions.appendChild(year);
    goButton("Download CSV", function () {
      save();
    });

    // Walks done on this page, by year, so asking for a year again costs
    // no second walk.
    var walked = {};
    var stopped = false;

    year.addEventListener("change", idle);

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
  }

  var one = single();
  if (one) {
    orderPanel(one);
  } else {
    yearPanel();
  }
  idle();

  document.body.appendChild(panel.root);
})(globalThis.TCGB);
