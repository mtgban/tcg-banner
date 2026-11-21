// Reads every order placed in one range: a year, or the last 30, 90 or 120
// days.
//
// TCGplayer filters the history by a range held in the session, so the walk
// sets the range itself, reads every page checking each one still names
// that range, and then puts back the range and search the visitor had. That is
// the step go-mtgban's tcgHistory could not take: it read whatever range
// the session happened to hold. SPECIFICATIONS.md section 4.

globalThis.TCGB = globalThis.TCGB || {};

(function (TCGB) {
  "use strict";

  TCGB.CANCELLED = "Stopped; nothing was saved";
  TCGB.MOVED = "The order list changed while it was read; try again";

  // BUSY_WAIT is how long a walk TCGplayer asked to slow down waits before
  // it puts the visitor's range back, well past PACE.
  TCGB.BUSY_WAIT = 45000;

  function refuse(message) {
    throw new Error(message);
  }

  // walkRange answers with {orders, pending, pages, restore}: the range's
  // orders in TCGplayer's order, how many were pending and left out, how
  // many pages were read, and "" or why the visitor's range could not be
  // put back. It rejects when the list cannot be read whole; the error then
  // carries restore too.
  //
  // hooks.step(n, of) says which page is being read; hooks.stopped() is
  // asked before each request and stops the walk when it answers true;
  // hooks.waiting(ms) says the range will be put back after a pause.
  TCGB.walkRange = function (range, hooks) {
    // A year's orders are each checked to be dated in it. A relative range
    // has no such check: where TCGplayer puts its day boundary is not
    // known, so it rests on the heading and the counts.
    var year = /^\d{4}$/.test(range) ? range : "";
    var token = "";
    var original = null;
    var requests = 0;

    // ask makes one request, after the pause, unless the walk was stopped.
    function ask(make) {
      var wait = requests++ ? TCGB.PACE : 0;
      return TCGB.after(wait).then(function () {
        if (hooks.stopped && hooks.stopped()) {
          refuse(TCGB.CANCELLED);
        }
        return make();
      });
    }

    function read(n) {
      return ask(function () {
        return TCGB.fetchPage(n);
      }).then(function (doc) {
        var page = TCGB.readPage(doc);
        token = page.filter.token || token;
        return page;
      });
    }

    var seen = {};
    var orders = [];
    var pending = 0;
    var per = 0;
    var total = 0;
    var pages = 0;

    // take checks page n against the list page 1 fixed, and keeps its
    // orders.
    function take(page, n) {
      var f = page.filter;
      var l = page.list;
      if (f.range !== range || f.search !== "") {
        refuse(TCGB.MOVED);
      }
      if (n === 1 && l.empty === "none") {
        return;
      }
      if (l.empty || l.placed !== TCGB.placedIn(range)) {
        refuse(TCGB.MOVED);
      }
      if (n === 1) {
        total = l.total;
        per = l.last - l.first + 1;
        pages = Math.ceil(total / per);
        if (l.first !== 1 || per < 1 || (page.pageLast === null ? pages !== 1 : page.pageLast !== pages)) {
          refuse("The order list's pages do not add up; try again");
        }
      }
      var first = (n - 1) * per + 1;
      var last = Math.min(n * per, total);
      if (l.total !== total || l.first !== first || l.last !== last || page.orders.length !== last - first + 1) {
        refuse(TCGB.MOVED);
      }
      for (var i = 0; i < page.orders.length; i++) {
        var o = page.orders[i];
        if (o.error) {
          refuse("Order " + (o.id || "on page " + n) + ": " + o.error);
        }
        if (seen[o.id]) {
          refuse(TCGB.MOVED);
        }
        seen[o.id] = true;
        if (year && String(o.date.year) !== year) {
          refuse("Order " + o.id + " is not from " + year);
        }
        if (o.pending) {
          pending++;
        } else {
          orders.push(o);
        }
      }
    }

    function walk(n) {
      if (hooks.step) {
        hooks.step(n, pages || null);
      }
      return read(n).then(function (page) {
        take(page, n);
        return n < pages ? walk(n + 1) : undefined;
      });
    }

    // left says the list stayed on the range walked, and what to pick to
    // put back the range and search the visitor had: a reload shows the
    // walked range again.
    function left(how) {
      var back = original.range + (original.search ? ' and search "' + original.search + '"' : "");
      return "The order list was left on " + range + "; " + how + " " + back + " again";
    }

    // restore puts back the visitor's range and search, then reads page 1
    // to see that it took. It answers "" or why it did not.
    function restore() {
      return ask(function () {
        return TCGB.setFilter(token, original.range, original.search, !original.search);
      })
        .then(function () {
          return ask(function () {
            return TCGB.fetchPage(1);
          });
        })
        .then(function (doc) {
          var back = TCGB.readFilter(doc);
          if (!back || back.range !== original.range || back.search !== original.search) {
            return left("pick");
          }
          return "";
        })
        .catch(function () {
          return left("pick");
        });
    }

    var started = false;
    return read(1)
      .then(function (page) {
        original = { range: page.filter.range, search: page.filter.search };
        if (page.filter.ranges.indexOf(range) < 0) {
          refuse("TCGplayer does not list " + range);
        }
        started = true;
        return ask(function () {
          return TCGB.setFilter(token, range, "", true);
        });
      })
      .then(function () {
        return walk(1);
      })
      .then(
        function () {
          // Every page is read: a stop now could only keep the range from
          // going back.
          hooks = {};
          return restore().then(function (restored) {
            return { orders: orders, pending: pending, pages: pages || 1, restore: restored };
          });
        },
        function (err) {
          if (!started) {
            throw err;
          }
          // Stopped or refused: the range goes back all the same, so the
          // pause and the stop check must not keep it from going.
          var waiting = hooks.waiting;
          hooks = {};
          if (err.message === TCGB.CHALLENGE) {
            // Anything sent now meets the same check, which is the
            // visitor's to pass.
            err.restore = left("reload, pass the check, then pick");
            throw err;
          }
          var pause = Promise.resolve();
          if (err.message === TCGB.BUSY) {
            if (waiting) {
              waiting(TCGB.BUSY_WAIT);
            }
            pause = TCGB.after(TCGB.BUSY_WAIT);
          }
          return pause.then(restore).then(function (restored) {
            err.restore = restored;
            throw err;
          });
        }
      );
  };
})(globalThis.TCGB);
