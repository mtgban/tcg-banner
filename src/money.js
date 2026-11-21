// Reads the money, counts and dates TCGplayer prints.
//
// Each is read by its shape and with arithmetic, never by parseFloat or
// Date.parse: those accept what the page should not be trusted to print
// ("$1.234", a locale's own date order), and a value read wrong is worse
// than one refused.

globalThis.TCGB = globalThis.TCGB || {};

(function (TCGB) {
  "use strict";

  // "$1,234.56" or "$0.02": dollars, grouped or not, and exactly two cents.
  var MONEY = /^\$([1-9]\d{0,2}(?:,\d{3})+|\d+)\.(\d{2})$/;

  // "84" or "1,204".
  var COUNT = /^([1-9]\d{0,2}(?:,\d{3})+|\d+)$/;

  var MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // "November 09, 2026", the month in full. Order dates pad the day and
  // refund notes do not ("November 3, 2026").
  var DATE = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/;

  function daysIn(year, month) {
    if (month === 2) {
      return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    }
    return [4, 6, 9, 11].indexOf(month) >= 0 ? 30 : 31;
  }

  function squeeze(text) {
    return String(text).replace(/\s+/g, " ").trim();
  }

  // cents reads "$1,234.56" as 123456, and answers null for any other shape.
  TCGB.cents = function (text) {
    var m = MONEY.exec(squeeze(text));
    if (!m) {
      return null;
    }
    return Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);
  };

  // count reads "1,204" as 1204, and answers null for any other shape.
  TCGB.count = function (text) {
    var m = COUNT.exec(squeeze(text));
    return m ? Number(m[1].replace(/,/g, "")) : null;
  };

  // dollars writes cents the way TCGplayer prints them.
  TCGB.dollars = function (cents) {
    var sign = cents < 0 ? "-" : "";
    var abs = Math.abs(cents);
    var whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+$)/g, ",");
    return sign + "$" + whole + "." + String(abs % 100).padStart(2, "0");
  };

  // decimal writes cents as plain dollars, "0.52", for mtgban's uploader.
  TCGB.decimal = function (cents) {
    return Math.floor(cents / 100) + "." + String(cents % 100).padStart(2, "0");
  };

  // date reads "November 09, 2026" or "November 9, 2026" into {year,
  // month, day}, and answers null for any other shape or a day the month
  // does not have.
  TCGB.date = function (text) {
    var m = DATE.exec(squeeze(text));
    if (!m) {
      return null;
    }
    var month = MONTHS.indexOf(m[1]) + 1;
    var year = Number(m[3]);
    var day = Number(m[2]);
    if (month === 0 || day < 1 || day > daysIn(year, month)) {
      return null;
    }
    return { year: year, month: month, day: day };
  };

  TCGB.squeeze = squeeze;
})(globalThis.TCGB);
