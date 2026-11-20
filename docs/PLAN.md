# tcg-banner plan

A browser extension for a TCGplayer buyer's order history, sibling to
ck-banner (Card Kingdom) and cm-banner (Cardmarket). Three things:

1. **Year export.** Pick a year, download every order placed in it as CSV.
2. **Order links.** Every order number on the page is clickable: it runs
   TCGplayer's own search for that number and lands on that order alone.
3. **Send to BAN.** An order's lines go to mtgban's uploader through
   `/upload/handoff`, the way cm-banner sends a seller's offers.

This file is the plan, revised after a review (section 13). Once agreed,
its content moves into `SPECIFICATIONS.md` and `AGENTS.md` in the shape the
siblings use, and each build step (section 10) is its own PR off `master`.

Every markup fact below was read from one saved page of a signed-in
account (2026-11-20, "Last 30 Days", page 1 of 4, 10 orders, 185 lines).
"Unknown" marks a thing step 0 (section 10) checks on the live site before
the step that depends on it.

## 1. The page

`https://store.tcgplayer.com/myaccount/orderhistory`, the old ASP.NET MVC
account page, rendered on the server with jQuery on top. Nothing re-renders
under the extension once it has loaded.

### 1.1 The filter is session state, not a URL

```
<form id="OrderHistoryFilterForm" action="/myaccount/orderhistory" method="post">
  <input name="__RequestVerificationToken" type="hidden" value="...">
  <input id="ClearSessionFilters" name="ClearSessionFilters" value="False">
  <input id="SearchString" name="SearchString">     (jQuery autocomplete)
  <input type="submit" value="Search">
  <select id="DateRange" name="DateRange" onchange="SubmitOrderHistoryDateRange();">
    Last 30 Days | Last 90 Days | Last 120 Days | 2026 | 2025 | ... | 2016
```

Changing the select runs `SubmitOrderHistoryDateRange()`: it sets
`ClearSessionFilters=true` and `$.ajax`-POSTs the serialized form to
`https://store.tcgplayer.com/MyAccount/OrderHistory` with the token both as a
field and as a `__RequestVerificationToken` header (jQuery adds
`X-Requested-With: XMLHttpRequest` and the urlencoded content type), then
reloads the same URL. The server keeps the range, and a search, **in the
session**; every later GET of the page and of `?PageNumber=N` is filtered by
it.

That is the "you always have to set the date range properly": the range is
not a parameter of the page you read but a side effect you cause first, and
anything sharing the session (another tab, the user) can change it.

### 1.2 The list

- Breadcrumb: `Viewing 1 - 10 of 31 order(s)` then `placed in the last 30
  days`. The year form, the search form and the empty form are unknown.
- `#SellerOrderWidgetWrap > .orderWrap`, one per order, newest first,
  10 per page.
- Pager: `.pager a.pages`, `?PageNumber=N`, `a.pageLast` names the last
  page. A one-page list may have no pager (unknown).

### 1.3 An order

Header (`.orderHeader`), label/value pairs found by label text:

| Label | Value |
|-------|-------|
| `Order Date` | `November 09, 2026` in `span[data-aid=spn-sellerorderwidget-orderdate]` |
| `Channel` | `TCG Marketplace` |
| `Order Number` | `17B3D927-60B89F-0DA62`, a seller order: a **bare text node** after the `<br>` |
| `TCGPLAYER DIRECT #` | `261120-A3C0`, a Direct order, same shape |

Two kinds of order, told apart by that label:

- **Seller**: `SHIPPED AND SOLD BY` names one seller
  (`span[data-aid=spn-sellerorderwidget-vendorname] a`).
- **Direct**: `SHIPPED BY TCGplayer Direct`; each line names its own
  seller (`.orderSoldby a`).

Summary (`table[data-aid=tbl-sellerorderwidget-productsinorder]`), rows found
by label with the colon: `Quantity:`, `Subtotal:`, `Shipping:`,
`Sales Tax (XX):` (NY, WA, FL seen), `Total:`. Never by position: go-mtgban's
tool reads Total as the fifth row, which an order with no tax row would
break.

Alerts: the one seen is `div.orderAlert.yellow[data-aid=div-sellerorderwidget-singlerefund]`,
`A partial refund was issued on November 14, 2026 for the amount of $1.02.`
The `single` implies a multiple-refund variant, and the page's CSS defines
`.pendingOrder`; cancelled and fully refunded orders are unseen. **Any alert,
badge or `data-aid` of another shape refuses the order** (or is counted on
the tooltip, as ck-banner counts unfamiliar statuses), never exported as "no
refund".

Never read: `SHIP TO`, `BILL TO`, tracking, the welcome line (it prints the
account's email), store credit.

### 1.4 A line

`table.orderTable[data-aid=tbl-sellerorderwidget-ordertable] tbody tr`,
columns by header (`ITEMS`, `DETAILS`, `PRICE`, `QUANTITY`), every field
from inside its own row:

| Field | Where |
|-------|-------|
| product id | the row's `img.orderThumbnail` `data-original`, `.../product/4842_25w.jpg` -> `4842`; not `src`, and id `0` (the `onerror` fallback) is refused |
| name | the row's product `a.nocontext` (the header has another `a.nocontext`, the seller) |
| set | the text node after that link's `<br>`, `Ice Age` |
| game | first path segment of that link, `magic` |
| seller | `.orderSoldby a` (Direct lines only) |
| rarity, condition, foil | DETAILS: `Rarity: C<br>Condition: Lightly Played[ Foil]` |
| price each | `$0.52` |
| quantity | `1` |

On the saved page every line was Magic and every DETAILS cell had exactly
that shape, NM/LP/MP/HP spelled out, no language. Any other shape
(language, Damaged, sealed, another game) makes the line unreadable until a
saved page shows it. There is no SKU id on the page.

Lines must add up: quantities to `Quantity:`, `quantity x price` to
`Subtotal:`, and Subtotal + Shipping + Tax to `Total:`. All ten saved orders
do, the refunded one included. An order that does not is refused, never
exported short.

## 2. Where it runs

Manifest V3, no `permissions`, `host_permissions`, `background` or
`web_accessible_resources`, pinned by a test. One content script on
`https://store.tcgplayer.com/myaccount/orderhistory*`. Every request is
same-origin with the visitor's session; nothing goes anywhere else except
the handoff tab the user opens with a click.

## 3. Order links

The order number is a bare text node. The script wraps it in a `<button>`
styled as a link, and on click:

1. sets the page's own `#SearchString` to the number (`.value` only, no key
   events: the field carries jQuery autocomplete);
2. `form.requestSubmit(searchButton)` on the page's own form.

That is what typing the number and pressing Search does: token,
`ClearSessionFilters=False`, `SearchString`, and the `DateRange` already
selected. A clicked order is on the page, so it is inside that range; the
range is left alone.

Unknown (step 0): whether Direct numbers are searchable, whether a search
persists to the next visit, and how the page clears one.

No hash link that searches on load: any page could link to it and make the
extension POST into the session with no click, and Back would fire it again.

## 4. The year walk

The panel offers the years `#DateRange` lists, never a hard-coded range.
One year per walk.

1. **Read the state fresh.** GET page 1 (not the DOM, which another tab may
   have made stale) and take the current range from its selected option and
   breadcrumb, and the token from it. **Refuse to start while a search is
   active.**
2. **Set** the year: POST as the page's XHR does, `DateRange=<year>`,
   `ClearSessionFilters=true`, empty `SearchString`, token as field and
   header, `X-Requested-With`.
3. **Walk** `?PageNumber=1..N` one at a time, 1.2 s apart, 30 s deadline
   each. Every page must:
   - name **the year asked for** in its breadcrumb (a range changed from
     another tab mid-walk refuses the walk);
   - print its own slice of the same total (`11 - 20 of 31`);
   - hold exactly that many orders, none seen before.
   N from page 1's total and page size, agreeing with `pageLast` where there
   is one. The token for later POSTs comes from the latest page fetched.
4. **Restore** the original range, whatever happened (refusal, Escape), and
   **verify** it with one GET. If the restore fails, say so and reload the
   tab so the page shows what the session holds. While the walk runs the
   page's own pager would serve the year's pages; the panel says so.
5. Every order adds up (1.4) and is dated in the year.

A refused or cancelled walk writes nothing. A sign-in page, an error page, a
challenge or a 429 refuses, and is never retried or answered in code.

A tab closed mid-walk leaves the session on the year, visible in the page's
own dropdown. That is the one side effect, and it is the same POST the
dropdown makes.

Pace: 1.2 s, the siblings' figure, until a long walk on the live site says
otherwise; the commit that changes it says what was observed.

## 5. The CSVs

**`tcg-orders-<year>.csv`**, one row per order. go-mtgban's `tcgHistory`
wrote `Order Date, Order ID, Amount` and ck-banner writes `Order ID`, `Order
Date`, `Amount` among its five, so those names come first and mean the same:

| Column | From |
|--------|------|
| `Order ID` | the order number as printed |
| `Order Date` | as printed |
| `Amount` | `Total:` minus the refund, printed `$23.13` as ck-banner does |
| `Kind` | `Seller` or `Direct` |
| `Seller` | the seller, or `TCGplayer Direct` |
| `Quantity`, `Subtotal`, `Shipping`, `Sales Tax`, `Total` | summary, as printed |
| `Refunded` | the refund, or empty |

**`tcg-items-<year>.csv`**, one row per line, the same seven columns the
handoff sends (section 6) followed by `Order`, `Order Date`, `Seller`.
`Order`, not `Order Number`: docparse reads any header containing `number`
as the card's variant (`docparse.go:297`), which would feed the order
number to the matcher. `Seller` and `Order Date` map to nothing.

Bytes as Go's `csv.Writer` writes them, as in ck-banner. One click per file:
the panel offers *Orders* and *Items* rather than two downloads at once.

Not in the first version: *All years*, the kept file (ck-banner section 12).

## 6. Send to BAN

Each order header gets **Send to BAN** beside its order button. The lines
are already on the page, so one click opens the tab inside the click's
activation. cm-banner's protocol, unchanged:

```
click       window.open("https://mtgban.com/upload/handoff")
handoff  -> { type: "mtgban-handoff-ready" }          to each allowed origin
extension-> { type: "mtgban-handoff-rows", csv, rows, source: location.href }
```

The CSV carries only what docparse reads, each header traced through
`ParseHeader`:

| Column | docparse | Value |
|--------|----------|-------|
| `TCGplayer Product ID` | `id` (line 269), exact via go-mtgban's TCGplayer id space | product id |
| `Name` | name (287) | link text |
| `Edition` | edition (292) | set line |
| `Foil` | printing (307, 566) | `Yes` / `No` |
| `Condition` | conditions (585-593) | `NM`, `SP`, `MP`, `HP`, BAN's own codes |
| `Quantity` | quantity | |
| `Price` | price | plain dollars, `0.52` |

Never a column headed exactly `TCGplayer Id` (the SKU column, which wipes
the product id when the SKU is unknown, line 524).

Magic only in the first version, to `mtgban.com`: an order's non-Magic lines
are not sent and the tooltip counts them. Other games wait for a saved page
showing their slugs.

A partial refund does not say which line it covers, so a send of such an
order may overstate; the tooltip says so.

**Site side, lands first: config only.** `"https://store.tcgplayer.com":
{"name": "TCGplayer"}` in the infrastructure file's `handoff_origins`, from
the admin tab. It must be `store.`, the origin of the window that calls
`window.open` and `postMessage`; `www.` would never match `event.origin`.
Step 0 checks the opener survives (no COOP header on the TCGplayer page).

The handoff lands in whichever mode the reader last used (uploader or
buylist/optimizer, from the `uploadMode` cookie). Choosing it from the
handoff is section 11.

## 7. Panel

ck-banner's rules: fixed width, nothing under the buttons, one drawn
tooltip, a tick or a cross beside the count, Escape stops, the page asks
before it is left mid-walk. Row: year, *Orders*, *Items*. The heading names
the page being read while walking.

## 8. What go-mtgban and mtgban-website hold

**go-mtgban.** `origin/master` has no TCGplayer buyer-history code, nor does
go-tcgplayer. The one scraper of this page is `cmd/tcgHistory/main.go`, on
the unmerged local branch `codex/restore-tools-api` (`8b424693a`). It lifts
`TCGAuthTicket_Production` and `ASP.NET_SessionId` from Firefox's cookie
store, GETs `?PageNumber=1..N` with no pause, sets no range (it prints
"change the search range in the tcgplayer UI", with `// todo add flag option
to filter for year`), reads Total positionally, and writes `Order Date,
Order ID, Amount` net of the refund from `div.orderAlert.yellow`. This plan
keeps its selectors and its three columns, and replaces the range it cannot
set with one set and checked on every page.

**mtgban-website.** `/upload/handoff` (`routes.go:145`,
`upload_handoff.go:186`, `js/upload-handoff.js`) is cm-banner's protocol.
Allowed origins live in the infrastructure file, not the repository
(`internal/infrastructure/infrastructure.go:27-44`). `upload_handoff.go:31`
promises an allowed origin "changes nothing that outlasts the request".

## 9. Fixtures

The saved page carries the account's email, name, two postal addresses,
tracking numbers, a `__RequestVerificationToken` and seller ids. It stays
outside the repository. Fixtures are cut by allowlist with a local script,
as ck-banner's `scripts/cut-fixtures.py`: keep the filter form (token
replaced), breadcrumb, order blocks and pager; drop SHIP TO, BILL TO,
tracking and the welcome line whole; renumber order numbers; synthetic
sellers; amounts and dates rewritten so each order still adds up and the
list keeps its order. `tests/repo.test.js` scans every fixture for an email,
a tracking-number shape, a token and the real order numbers.
`tests/saved.test.js` runs the parsers on saved pages named by environment
variables, and skips without them.

## 10. Build order

0. **Live observation, before any code that depends on it** (DevTools on
   the real page, nothing committed): the breadcrumb for a year, a search
   and an empty year; the range POST's status and body; whether a search
   persists and how it clears; whether a Direct number is searchable;
   COOP on the page; and ten minutes on `https://www.tcgplayer.com/account`
   for an order API that takes explicit dates, which would replace section
   4 altogether.

Then each a PR off `master`, merged by rebase:

1. Scaffold: manifest, AGENTS.md, SPECIFICATIONS.md, CI (bun test, manifest
   files exist, mutate), the no-permissions test.
2. Shared: money and dates (month table, never `Date.parse`), Go-compatible
   CSV, paced fetch with challenge/429 refusal.
3. Read one page: orders, lines, every refusal of section 1, against a
   fixture cut from the saved page.
4. Order links (section 3).
5. The year walk (section 4).
6. The panel and both CSVs.
7. mtgban-website: the `handoff_origins` entry, live and checked.
8. Send to BAN.

## 11. Later, not in the first version

- **Choosing uploader or optimizer from the handoff.** This is the "work in
  the handoff" the request expects, and it needs care: `readSetFlag`
  (`utils.go:1371`) only takes `true`/`false` and writes a forever cookie,
  which would break the promise at `upload_handoff.go:31`. Done right, the
  rows message carries a bool, the handoff page passes it in its own hidden
  field, and `/upload` reads it for that request without touching the
  cookie, gated by `UploadBuylistEnabled` as today.
- Other games, once a saved page shows them.
- *All years*, and the kept file.
- Naming the order in the results heading.

## 12. Before 0.1.0

On the live site, Chrome and Firefox: a multi-page year walk with the range
restored after it; a walk refused when the range is changed from another tab
mid-walk; the order button on a Seller and a Direct order; a send of one
order reaching the uploader; and a saved page with a non-English, Damaged,
sealed or non-Magic line.

## 13. Review

Reviewed by Fable on 2026-11-20 against the saved page, both siblings,
mtgban-website and go-mtgban. Changes taken: `Order` for `Order Number`
(docparse's variant), the handoff CSV narrowed to seven traced columns, the
walk reads its starting state fresh, refuses under an active search and
verifies its restore, step 0 before any walk code, `mode` moved to later
(the proposed values would not have parsed and the cookie breaks a stated
promise), the year no longer set on an order click, the hash link cut, the
orders CSV keeping `Order ID`/`Order Date`/`Amount`, stricter alert guards,
Magic only, `store.tcgplayer.com` as the origin, and the nits (labels with
colons, row-scoped link, id 0, one match pattern, a button not `href="#"`,
no key events at the autocomplete, latest token, `SP` not `LP`).
