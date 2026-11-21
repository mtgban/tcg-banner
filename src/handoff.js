// Hands an order's cards to mtgban's uploader.
//
// The upload needs mtgban's session, whose cookie is not sent on a request
// made from TCGplayer's page. So nothing is posted from here: mtgban serves
// /upload/handoff, which opens as an ordinary navigation, says when it is
// listening, takes the rows from the window that opened it, and uploads
// them itself. The protocol is cm-banner's; SPECIFICATIONS.md section 6.

globalThis.TCGB = globalThis.TCGB || {};

(function (TCGB) {
  "use strict";

  var READY = "mtgban-handoff-ready";
  var ROWS = "mtgban-handoff-rows";

  // Magic alone until a saved page has shown how TCGplayer names another
  // game's products.
  var HOSTS = {
    magic: "mtgban.com",
  };

  TCGB.handoffURL = function (game) {
    return HOSTS[game] ? "https://" + HOSTS[game] + "/upload/handoff" : "";
  };

  // isBanHost says whether an origin is one of mtgban's. The window that
  // answers may have been redirected to another of them, so what pins the
  // conversation to it is the source check beside this one.
  TCGB.isBanHost = function (origin) {
    var parsed;
    try {
      parsed = new URL(origin);
    } catch (err) {
      return false;
    }
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "mtgban.com" || parsed.hostname.slice(-11) === ".mtgban.com")
    );
  };

  TCGB.REPLACED = "Another order was sent instead";
  TCGB.CLOSED = "The upload page was closed; try again";

  // A handoff still waiting to hear from its tab: {listener, onFocus,
  // opened, done}.
  // The page it opens has no deadline, so one at a time is what keeps a tab
  // that never answers from leaving its listener behind for the life of
  // this page.
  var awaiting = null;

  // handOff opens the game's handoff page and gives it csv, rows long. It
  // must be called from a click with nothing asynchronous in front of it:
  // window.open needs the click. done(error) is called once, with "" when
  // the rows have gone, TCGB.CLOSED when the tab was closed before it said
  // it was listening, or TCGB.REPLACED when a later send took over: its
  // tab, still waiting for rows that will not come, is closed.
  TCGB.handOff = function (game, csv, rows, done) {
    if (awaiting) {
      var replaced = stopWaiting();
      if (!replaced.opened.closed) {
        replaced.opened.close();
      }
      replaced.done(TCGB.REPLACED);
    }
    var opened = window.open(TCGB.handoffURL(game), "_blank");
    if (!opened) {
      done("The upload page was blocked; use the CSV");
      return;
    }

    function onMessage(event) {
      if (
        event.source !== opened ||
        !TCGB.isBanHost(event.origin) ||
        !event.data ||
        event.data.type !== READY
      ) {
        return;
      }
      stopWaiting();
      if (opened.closed) {
        done(TCGB.CLOSED);
        return;
      }
      // Answered to the origin that spoke, which is where the page ended
      // up. source names the page the rows were read from, so the results
      // can say where they came from.
      opened.postMessage({ type: ROWS, csv: csv, rows: rows, source: location.href }, event.origin);
      done("");
    }

    // A tab closed before it spoke never will. Coming back to this one is
    // when that can be seen, with no timer: it is where the person is.
    function onFocus() {
      if (opened.closed) {
        stopWaiting();
        done(TCGB.CLOSED);
      }
    }

    awaiting = { listener: onMessage, onFocus: onFocus, opened: opened, done: done };
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", onFocus);
  };

  // stopWaiting takes the waiting handoff's listeners down and answers with
  // it.
  function stopWaiting() {
    var was = awaiting;
    awaiting = null;
    window.removeEventListener("message", was.listener);
    window.removeEventListener("focus", was.onFocus);
    return was;
  }
})(globalThis.TCGB);
