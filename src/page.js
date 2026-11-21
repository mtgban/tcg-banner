// The content script on TCGplayer's order history: every order number made
// a control that searches for it, a Send to BAN beside each order whose
// cards can be sent, and the panel. The panel saves a year, or the last 30,
// 90 or 120 days, as CSV, or, on a
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

  // search does what typing the number and pressing Search does, with the
  // page's own form and button, but within the order's own year: a search
  // is scoped by the range, and a relative one like Last 90 Days moves on
  // while the order stays put. An order whose year is not offered, or whose
  // date did not read, keeps the range selected.
  function search(order) {
    var box = filter.form.querySelector("input#SearchString");
    var range = filter.form.querySelector("select#DateRange");
    var button = filter.form.querySelector('input[type="submit"]');
    var year = order.date ? String(order.date.year) : "";
    if (filter.years.indexOf(year) >= 0) {
      // .value alone, as for the box: the dropdown's own change handler
      // would post the range and reload before the search went.
      range.value = year;
    }
    // .value alone: the box carries jQuery's autocomplete, which a key
    // event would wake.
    box.value = order.id;
    filter.form.requestSubmit(button);
  }

  function orderButton(order) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "tcg-banner-order";
    button.textContent = order.id;
    button.addEventListener("click", function () {
      search(order);
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
      // A line not read whole first: a custom listing links to no product,
      // so it names no game either, and is not another game's card.
      if (l.problem) {
        unread++;
      } else if (!TCGB.handoffURL(l.game)) {
        other++;
      } else if (l.sealed) {
        // Until mtgban's uploader is known to resolve a sealed product id.
        sealed++;
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

  // aside is what a send that failed during a walk had to say, for the
  // walk's tooltip once it ends.
  var aside = "";

  // send hands an order's sendable cards to mtgban and says on the panel
  // what went. It runs straight from a click: window.open needs one. A walk
  // running meanwhile keeps the panel.
  function send(order, cards) {
    var count = cards.lines.reduce(function (n, l) {
      return n + l.qty;
    }, 0);
    if (!panel.working()) {
      // Until mtgban's page says it is listening, which it does only once
      // the reader is signed in there with the upload open to them.
      panel.clear();
      panel.word("sending");
      panel.recap("Waiting for mtgban's upload page to take the cards");
    }
    TCGB.handOff("magic", TCGB.cardsCSV(cards.lines), cards.lines.length, function (error) {
      // The later send speaks for itself. During a walk a send that went
      // says nothing, since the BAN tab shows what it took, and one that
      // failed waits for the walk to end.
      if (error === TCGB.REPLACED) {
        return;
      }
      if (panel.working()) {
        aside = error || aside;
        return;
      }
      if (error) {
        panel.word("");
        panel.fail(error);
        return;
      }
      panel.word("sent");
      panel.mark("done");
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

  // ---- A range: walked, every order of it in one file ----

  // isYear tells a year from one of TCGplayer's relative ranges.
  function isYear(range) {
    return /^\d{4}$/.test(range);
  }

  // fileName names a range's file. A relative range's carries the day it
  // was read, since the same range holds other orders tomorrow.
  function fileName(range) {
    if (isYear(range)) {
      return "tcg-orders-" + range + ".csv";
    }
    var d = new Date();
    var day = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
      .map(function (n) {
        return String(n).padStart(2, "0");
      })
      .join("-");
    return "tcg-orders-" + range.toLowerCase().replace(/ /g, "-") + "-" + day + ".csv";
  }

  function rangePanel() {
    panel.hint("Save a range of orders as CSV");

    // TCGplayer's own ranges in its own order: the relative ones, then the
    // years. "Last 120 Days" is shown as "120 days" to fit the box.
    var year = document.createElement("select");
    year.className = "tcg-banner-year";
    year.setAttribute("aria-label", "Range");
    for (var y = 0; y < filter.ranges.length; y++) {
      var option = document.createElement("option");
      option.value = filter.ranges[y];
      option.textContent = filter.ranges[y].replace(/^Last (\d+) Days$/, "$1 days");
      year.appendChild(option);
    }
    year.value = filter.range;
    panel.actions.appendChild(year);
    goButton("Download CSV", function () {
      save();
    });

    // Years walked on this page, so asking for one again costs no second
    // walk. Not a relative range, which moves on as the days do.
    var walked = {};
    var stopped = false;

    year.addEventListener("change", idle);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && panel.working()) {
        stopped = true;
      }
    });

    function write(chosen, result) {
      var name = fileName(chosen);
      var restore = result.restore ? [result.restore] : [];
      if (!result.orders.length) {
        panel.word("no orders");
        panel.fail(["No orders were placed in " + TCGB.placedIn(chosen) + (result.pending ? " that have shipped" : "")].concat(restore, spoken()).join("\n"));
        return;
      }
      TCGB.download(TCGB.ordersCSV(result.orders), name);
      panel.word(plural(result.orders.length, "order", "orders"));
      panel.mark("done");
      var notes = ["Saved " + name + " from " + plural(result.pages, "page", "pages")];
      if (result.pending) {
        notes.push(plural(result.pending, "pending order", "pending orders") + " left out");
      }
      panel.recap(notes.concat(restore, spoken()).join("\n"));
    }

    // spoken takes what a send failed with during the walk, to be said
    // once the walk has said its own.
    function spoken() {
      var said = aside ? ["Send to BAN: " + aside] : [];
      aside = "";
      return said;
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
      TCGB.walkRange(chosen, {
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
          if (isYear(chosen)) {
            walked[chosen] = result;
          }
          write(chosen, result);
        },
        function (err) {
          panel.busy(false);
          panel.word("");
          panel.fail([err.message].concat(err.restore ? [err.restore] : [], spoken()).join("\n"));
        }
      );
    }
  }

  var one = single();
  if (one) {
    orderPanel(one);
  } else {
    rangePanel();
  }
  idle();

  document.body.appendChild(panel.root);
})(globalThis.TCGB);
