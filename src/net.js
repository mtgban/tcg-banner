// Asks TCGplayer for its own order history, one request at a time and
// slowly, with the visitor's own session.
//
// The history's filter lives in the session, not the URL (SPECIFICATIONS.md
// section 1.1), so there are two requests: setFilter POSTs a range and a
// search the way the page's own dropdown does, and fetchPage GETs a page of
// whatever the session then holds.

globalThis.TCGB = globalThis.TCGB || {};

(function (TCGB) {
  "use strict";

  // PACE is the pause before each request after the first. It is the
  // siblings' figure; a long walk on the live site decides it for 0.1.0.
  TCGB.PACE = 1200;

  // TIMEOUT bounds one request, so a connection that goes quiet fails the
  // walk instead of leaving the spinner turning.
  var TIMEOUT = 30000;

  TCGB.CHALLENGE = "TCGplayer is checking the browser; reload and try again";
  TCGB.BUSY = "TCGplayer asked to slow down; wait a minute and try again";
  TCGB.TIMED_OUT = "TCGplayer did not answer in time";

  var PATH = "/myaccount/orderhistory";

  function deadline() {
    if (typeof AbortSignal === "undefined" || !AbortSignal.timeout) {
      return undefined;
    }
    return AbortSignal.timeout(TIMEOUT);
  }

  // check turns a challenge or a refusal into the error that says so. A
  // challenge is for the person at the keyboard and is never answered here.
  function check(response) {
    if (response.headers.get("cf-mitigated") === "challenge") {
      throw new Error(TCGB.CHALLENGE);
    }
    if (response.status === 429) {
      throw new Error(TCGB.BUSY);
    }
    if (!response.ok) {
      throw new Error("TCGplayer answered " + response.status);
    }
    return response;
  }

  function timedOut(err) {
    if (err && err.name === "TimeoutError") {
      throw new Error(TCGB.TIMED_OUT);
    }
    throw err;
  }

  TCGB.after = function (ms) {
    if (!ms) {
      return Promise.resolve();
    }
    return new Promise(function (resume) {
      setTimeout(resume, ms);
    });
  };

  // fetchPage reads page n of the list the session holds, parsed.
  TCGB.fetchPage = function (n) {
    return fetch(PATH + (n > 1 ? "?PageNumber=" + n : ""), {
      credentials: "same-origin",
      signal: deadline(),
      headers: { Accept: "text/html,application/xhtml+xml" },
    })
      .then(check)
      .then(function (response) {
        return response.text();
      })
      .then(function (text) {
        return new DOMParser().parseFromString(text, "text/html");
      })
      .catch(timedOut);
  };

  // setFilter puts a range and a search in the session, sending what the
  // page's SubmitOrderHistoryDateRange sends: the form's fields, the token
  // again as a header, and jQuery's X-Requested-With. clear is the page's
  // ClearSessionFilters, true for a new range and false for a search.
  TCGB.setFilter = function (token, range, search, clear) {
    var body = new URLSearchParams();
    body.set("__RequestVerificationToken", token);
    body.set("ClearSessionFilters", clear ? "true" : "False");
    body.set("SearchString", search);
    body.set("DateRange", range);
    return fetch(PATH, {
      method: "POST",
      credentials: "same-origin",
      signal: deadline(),
      headers: {
        __RequestVerificationToken: token,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: body.toString(),
    })
      .then(check)
      .then(function () {})
      .catch(timedOut);
  };
})(globalThis.TCGB);
