// The panel both pages share: a heading (the stroopwafel, "TCG BANner", one
// word, a mark) with a tooltip the panel draws itself, over one row of
// controls. It is a fixed width, and nothing is ever written under the row:
// what a finished or failed piece of work has to say goes on the tooltip.

globalThis.TCGB = globalThis.TCGB || {};

(function (TCGB) {
  "use strict";

  // hold asks the browser to confirm before the page goes anywhere, which
  // would take a running read with it. The wording is the browser's own.
  function hold(event) {
    event.preventDefault();
    event.returnValue = "";
    return "";
  }

  // panel builds the box and answers with what changes it. Nothing is on
  // the page until the caller appends root.
  TCGB.panel = function () {
    var root = document.createElement("div");
    root.id = "tcg-banner";
    root.innerHTML =
      '<div class="tcg-banner-label" tabindex="0" aria-describedby="tcg-banner-tip">' +
      'TCG BAN<i class="tcg-banner-ner">ner</i><span class="tcg-banner-sep"> - </span>' +
      '<span class="tcg-banner-spin" aria-hidden="true"></span>' +
      '<b class="tcg-banner-word"></b>' +
      '<span class="tcg-banner-mark" aria-hidden="true" hidden></span>' +
      "</div>" +
      '<span class="tcg-banner-tip" id="tcg-banner-tip" role="tooltip"></span>' +
      '<div class="tcg-banner-actions"></div>';

    var hinted = "";
    var recapped = "";
    var jumper = null;

    function at(selector) {
      return root.querySelector(selector);
    }

    var label = at(".tcg-banner-label");
    label.addEventListener("click", function () {
      if (jumper) {
        jumper();
      }
    });
    label.addEventListener("keydown", function (event) {
      if (jumper && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        jumper();
      }
    });

    function working() {
      return root.classList.contains("tcg-banner-busy");
    }

    // One tooltip: what the last piece of work said while that stands, or
    // else what the panel offers. Quiet while work runs, since the heading
    // holds the progress then.
    function tip() {
      at(".tcg-banner-tip").textContent = recapped || (working() ? "" : hinted);
    }

    var panel = {
      root: root,
      actions: at(".tcg-banner-actions"),

      // word is the heading's one word; with none, the heading is just the
      // name and its mark.
      word: function (text) {
        at(".tcg-banner-word").textContent = text;
        at(".tcg-banner-sep").hidden = !text;
      },

      hint: function (text) {
        hinted = text;
        tip();
      },

      recap: function (text) {
        recapped = text;
        tip();
      },

      // mark is the sign beside the word: "done" a tick, "failed" a red
      // cross, "" neither.
      mark: function (how) {
        var sign = at(".tcg-banner-mark");
        sign.hidden = !how;
        sign.textContent = how === "failed" ? "✗" : "✓";
        sign.classList.toggle("tcg-banner-failed", how === "failed");
      },

      fail: function (message) {
        panel.mark("failed");
        panel.recap(message);
      },

      clear: function () {
        panel.mark("");
        panel.recap("");
      },

      // busy turns the spinner on, takes every control in the row away,
      // and holds the page, for as long as work runs.
      busy: function (on) {
        root.classList.toggle("tcg-banner-busy", on);
        var controls = panel.actions.querySelectorAll("button, select");
        for (var i = 0; i < controls.length; i++) {
          controls[i].disabled = on;
        }
        if (on) {
          window.addEventListener("beforeunload", hold);
        } else {
          window.removeEventListener("beforeunload", hold);
        }
        tip();
      },

      // jump makes the heading a control that calls go, or plain text again
      // when go is null.
      jump: function (go) {
        jumper = go;
        label.classList.toggle("tcg-banner-jumps", !!go);
        if (go) {
          label.setAttribute("role", "button");
        } else {
          label.removeAttribute("role");
        }
      },

      // release lets the page go without asking, for a reload the work
      // itself calls for; the spinner and the disabled row stay until then.
      release: function () {
        window.removeEventListener("beforeunload", hold);
      },

      working: working,
    };
    return panel;
  };

  // download hands text to the browser as a file.
  TCGB.download = function (text, filename, type) {
    var blob = new Blob([text], { type: type || "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Firefox needs the object to outlive the click it was made for.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 30000);
  };
})(globalThis.TCGB);
