// Cuts tests/fixtures/orders.html from a saved order history page.
//
//   bun scripts/cut-fixtures.mjs <saved order history.html>
//
// A saved page carries the account's email, name, postal addresses,
// tracking numbers, the form's token and every seller it bought from. The
// fixture keeps TCGplayer's markup for the part the extension reads, and
// none of that: it is rebuilt from an allowlist of attributes, the address
// and tracking cells are emptied, order numbers, sellers, prices and dates
// are replaced by synthetic ones that still add up and keep the list's
// order, and the token becomes TOKEN. Cards, sets, conditions and product
// ids stay: they are the catalogue, and what the parser is for.
//
// The cut checks its own output for anything it should have removed and
// writes nothing if it finds it. Run it locally; the saved page never goes
// in the repository.

import { Window } from "happy-dom";
import { readFileSync, writeFileSync } from "fs";

const [saved] = process.argv.slice(2);
if (!saved) {
  console.error("usage: bun scripts/cut-fixtures.mjs <saved order history.html>");
  process.exit(2);
}

const KEEP = new Set(["class", "data-aid", "data-original", "href", "id", "name", "type", "value", "selected", "method", "action"]);

// A saved page names its own stylesheets, scripts and images; none of them
// may reach the window, which has no URL and loads nothing.
const html = readFileSync(saved, "utf8")
  .replace(/<script\b[\s\S]*?<\/script>/gi, "")
  .replace(/<style\b[\s\S]*?<\/style>/gi, "")
  .replace(/<link\b[^>]*>/gi, "")
  .replace(/\ssrc="[^"]*"/gi, "")
  .replace(/url\([^)]*\)/gi, "");
const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
const window = new Window({
  settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true },
});
const document = window.document;
document.body.innerHTML = body ? body[1] : html;

const right = document.querySelector(".accountRightWrap");
if (!right) {
  throw new Error("no .accountRightWrap: is this a saved order history page?");
}

// What must not survive, gathered before it is removed.
const secrets = new Set();
const remember = (text) => {
  for (const line of text.split(/\n|<br>/)) {
    const t = line.replace(/\s+/g, " ").trim();
    if (t.length >= 4) secrets.add(t);
  }
};
for (const el of document.querySelectorAll(".account-welcome")) remember(el.textContent);
for (const el of document.querySelectorAll('[data-aid="spn-sellerorderwidget-shiptoaddress"], [data-aid="spn-sellerorderwidget-billtoaddress"]')) {
  for (const node of el.childNodes) if (node.nodeType === 3) remember(node.textContent);
}
for (const a of document.querySelectorAll('a[href*="/sellerfeedback/"]')) remember(a.textContent);
const token = document.querySelector('input[name="__RequestVerificationToken"]');
if (token) secrets.add(token.getAttribute("value"));

// seeded is a small PRNG, so a cut is the same every time.
let seed = 0x7cb1;
const seeded = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, "0").slice(-width);
const money = (cents) => "$" + String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+$)/g, ",") + "." + String(cents % 100).padStart(2, "0");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const printed = (d) => `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}, ${d.getUTCFullYear()}`;

right.querySelector(".account-welcome")?.remove();
for (const el of right.querySelectorAll('input[type="button"], .rateBox')) el.remove();

const wraps = [...right.querySelectorAll("#SellerOrderWidgetWrap .orderWrap")];
const numbers = new Map();
let day = Date.UTC(2026, 10, 20);
let lastDate = null;
let sellerCount = 0;
const sellers = new Map();
const sellerOf = (name) => {
  if (!sellers.has(name)) {
    sellerCount++;
    sellers.set(name, { name: "Seller " + sellerCount, id: hex(0x1000 + sellerCount, 8).toLowerCase() });
  }
  return sellers.get(name);
};

wraps.forEach((wrap, i) => {
  // Dates: newest first, a day or two apart, equal where the page's were.
  const dateSpan = wrap.querySelector('[data-aid="spn-sellerorderwidget-orderdate"]');
  const real = dateSpan.textContent.trim();
  if (lastDate !== null && real !== lastDate) day -= (1 + Math.floor(seeded() * 3)) * 86400000;
  lastDate = real;
  const date = new Date(day);
  dateSpan.textContent = printed(date);

  // The order number: the bare text node after its label.
  for (const title of wrap.querySelectorAll(".orderHeader .orderTitle")) {
    const label = title.textContent.replace(/\s+/g, " ").trim();
    if (label !== "Order Number" && label !== "TCGPLAYER DIRECT #") continue;
    for (const node of title.parentNode.childNodes) {
      const text = node.nodeType === 3 ? node.textContent.trim() : "";
      if (!text) continue;
      const synthetic =
        label === "Order Number"
          ? `${hex(0xa0000000 + i, 8)}-${hex(0x100000 + i, 6)}-${hex(0x10000 + i, 5)}`
          : `${String(date.getUTCFullYear()).slice(2)}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}-${hex(0xa000 + i, 4)}`;
      numbers.set(text, synthetic);
      secrets.add(text);
      node.textContent = node.textContent.replace(text, synthetic);
    }
  }

  // Addresses and tracking: the cells stay, with their labels alone.
  for (const cell of wrap.querySelectorAll('[data-aid="spn-sellerorderwidget-shiptoaddress"], [data-aid="spn-sellerorderwidget-billtoaddress"]')) {
    for (const node of [...cell.childNodes]) if (!(node.nodeType === 1 && node.classList.contains("orderTitle"))) node.remove();
  }
  for (const a of wrap.querySelectorAll('a[title="Track Package"]')) {
    let node = a.nextSibling;
    while (node && !(node.nodeType === 1 && node.tagName !== "BR")) {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }
    a.remove();
  }
  wrap.querySelector('[data-aid="spn-sellerorderwidget-trackingnumber"]')?.remove();

  // Sellers, everywhere they are named.
  for (const a of wrap.querySelectorAll('a[href*="/sellerfeedback/"]')) {
    const s = sellerOf(a.textContent.trim());
    a.textContent = s.name;
    a.setAttribute("href", "https://store.tcgplayer.com/sellerfeedback/" + s.id);
  }

  // Prices: synthetic, and the summary recomputed from them.
  let qty = 0;
  let subtotal = 0;
  for (const tr of wrap.querySelectorAll("table.orderTable tbody tr")) {
    const each = 5 + Math.floor(seeded() * seeded() * 3000);
    tr.querySelector("td.orderHistoryPrice").textContent = money(each);
    const q = Number(tr.querySelector("td.orderHistoryQuantity").textContent.trim());
    qty += q;
    subtotal += q * each;
  }
  const rows = {};
  for (const tr of wrap.querySelectorAll('table[data-aid="tbl-sellerorderwidget-productsinorder"] tr')) {
    const cells = tr.querySelectorAll("td");
    rows[cells[0].textContent.replace(/\s+/g, " ").trim()] = cells;
  }
  const shipping = subtotal >= 500 ? 0 : 99;
  let tax = 0;
  for (const label of Object.keys(rows)) {
    if (/^Sales Tax/.test(label)) {
      tax = Math.round(subtotal * 0.08);
      rows[label][0].textContent = "Sales Tax (ZZ):";
      rows[label][1].textContent = money(tax);
    }
  }
  rows["Quantity:"][1].textContent = String(qty);
  rows["Subtotal:"][1].textContent = money(subtotal);
  rows["Shipping:"][1].textContent = money(shipping);
  rows["Total:"][1].querySelector("b").textContent = money(subtotal + shipping + tax);

  // A refund: a synthetic amount and date, and a link to no message.
  for (const alert of wrap.querySelectorAll(".orderAlert")) {
    const refundDate = new Date(day + 3 * 86400000);
    alert.innerHTML = `<b>A partial refund</b> was issued on ${printed(refundDate)} for the amount of ${money(Math.max(1, Math.floor(subtotal / 7)))}.
                    <a href="https://store.tcgplayer.com/myaccount/messagecenter?refundId=1">(Details)</a>`;
  }
});

// Only the allowlist's attributes, everywhere.
for (const el of [right, ...right.querySelectorAll("*")]) {
  for (const attr of [...el.attributes]) {
    if (!KEEP.has(attr.name)) el.removeAttribute(attr.name);
  }
  if (el.getAttribute("name") === "__RequestVerificationToken") el.setAttribute("value", "TOKEN");
  for (const name of ["href", "value", "id", "data-aid"]) {
    const v = el.getAttribute(name);
    if (v === null) continue;
    let w = v;
    for (const [real, synthetic] of numbers) {
      w = w.split(real).join(synthetic).split(real.toLowerCase()).join(synthetic.toLowerCase());
    }
    if (w !== v) el.setAttribute(name, w);
  }
}
for (const img of right.querySelectorAll("img")) img.removeAttribute("src");

const out =
  "<!-- Cut by scripts/cut-fixtures.mjs from a saved order history page:\n" +
  "     TCGplayer's markup, synthetic orders. Do not edit by hand. -->\n" +
  right.outerHTML.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n\n+/g, "\n") +
  "\n";

// The check: nothing gathered above, no email, no long digit run, no token.
const leaks = [];
for (const s of secrets) if (s && out.includes(s)) leaks.push("kept: " + s.slice(0, 12) + "...");
if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(out)) leaks.push("an email address");
if (/\d{15,}/.test(out)) leaks.push("a 15-plus digit run");
if (/shipment\.co|refundId=(?!1")/.test(out)) leaks.push("a tracking or refund link");
if (leaks.length) {
  console.error("refusing to write the fixture:\n  " + leaks.join("\n  "));
  process.exit(1);
}
writeFileSync(new URL("../tests/fixtures/orders.html", import.meta.url), out);
console.log(`tests/fixtures/orders.html: ${wraps.length} orders, ${sellers.size} sellers`);
