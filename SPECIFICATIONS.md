# tcg-banner specification

What the extension does, what it reads from TCGplayer, and the rules it
keeps. Every markup fact here was read from TCGplayer's own pages of a
signed-in account: one saved page (2026-11-20, 10 orders, 185 lines) and a
read of that account's whole history on the live site (section 11). The
numbers in examples are made up.

## 1. The page

`https://store.tcgplayer.com/myaccount/orderhistory`, an ASP.NET MVC page
rendered on the server with jQuery on top. Nothing re-renders under the
extension once it has loaded. `www.tcgplayer.com/account/orders` redirects
here; there is no other order list.

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
`ClearSessionFilters=true` and POSTs the serialized form with the token both
as a field and as a `__RequestVerificationToken` header, with jQuery's
`X-Requested-With: XMLHttpRequest`, then reloads. Search posts the same form
with `ClearSessionFilters=False`. The server keeps the range and the search
**in the session**: every later GET of the page, and of `?PageNumber=N`, is
filtered by them, the search survives to the next visit, and the page
renders them back as the selected option and the box's `value`.

Observed on the live site (2026-11-20):

- A search is scoped by the range: an order outside it is "No orders match
  your search criteria."
- Direct order numbers are searchable as well as seller ones.
- `ClearSessionFilters=true` with an empty search clears a search; so does
  submitting an empty search.
- The POST answers 200 with the page itself.
- No `Cross-Origin-Opener-Policy` header, so a tab the page opens keeps its
  opener (section 6).

This is why go-mtgban's `cmd/tcgHistory` (local branch
`codex/restore-tools-api`) said "change the search range in the tcgplayer
UI": it read whatever range the session held and could neither set nor check
it.

### 1.2 The list

The heading, `.breadcrumbs`, is one of:

| Heading | Meaning |
|---------|---------|
| `Viewing 1 - 10 of 31 order(s) placed in the last 30 days` | a range of the last N days |
| `Viewing 11 - 20 of 211 order(s) placed in 2025` | a year; also a search inside it |
| `You do not have any orders to display.` | a range with no orders |
| `No orders match your search criteria.` | a search that found nothing |

`#SellerOrderWidgetWrap > .orderWrap`, one per order, newest first, 10 a
page. The pager's `a.pageLast` links `?PageNumber=N` for the last page,
except on the last page itself, where it is `ui-state-disabled` and links
nowhere. A list of one page has no pager.

### 1.3 An order

Header (`.orderHeader`), pairs found by their `.orderTitle` label; any other
label refuses the order:

| Label | Value |
|-------|-------|
| `Order Date` | `November 09, 2026`, the day padded |
| `Channel` | `TCG Marketplace` |
| `Order Number` | `17B3D927-60B89F-0DA62`, a **seller** order; the first group is the seller's id, five hex digits on orders from 2020 and before (`33636-744618-D7765`), or `TCGPLAYER` on an order TCGplayer sold itself |
| `TCGPLAYER DIRECT #` | `261120-A3C0`, a **Direct** order |

The number is a bare text node after the label's `<br>`; a number of
another shape refuses the order. A seller order names its seller in
`[data-aid=spn-sellerorderwidget-vendorname] a`; a Direct order names a
seller on each line (`.orderSoldby a`).

The summary, `table[data-aid=tbl-sellerorderwidget-productsinorder]`, is
read by label: `Quantity:`, `Subtotal:`, `Shipping:`, `Total:`, and
any number of tax rows: `Sales Tax (NY):`, plain `Sales Tax:` (seen at
$0.00), or Canada's `CA GST:` (also accepted: HST, PST, QST). Any other row
refuses the order. Never by position.

Notes are `div.orderAlert`. One refund is
`data-aid="div-sellerorderwidget-singlerefund"`:

```
A partial refund was issued on November 3, 2026 for the amount of $1.02. (Details)
A full refund was issued on November 3, 2026 for the amount of $7.63. (Details)
A shipping cost refund was issued on April 26, 2022 for the amount of $1.49. (Details)
```

Several are `data-aid="div-sellerorderwidget-refunds"`: "Multiple refunds
have been issued on this order for the total amount of $2.59." with
(Show) and (Hide) links and a hidden `span#Refunds_<order>` listing each
refund in the shape above, one per `<br>`. The listed refunds must come to
the total. A refund's date is not padded. Any other note refuses the order.

`<span class="pendingOrder">Pending</span>` in the header, where the
Contact and Rate buttons otherwise are, marks the order pending; it was seen
on four orders from 2019 and 2020. A pending order is left out of an export
and counted on the tooltip.

Never read: `SHIP TO`, `BILL TO`, tracking, the welcome line (it prints the
account's email), store credit.

### 1.4 A line

`table.orderTable[data-aid=tbl-sellerorderwidget-ordertable]`, columns
`ITEMS`, `DETAILS`, `PRICE`, `QUANTITY` or the order is refused. Each field
from inside its own row:

| Field | Where |
|-------|-------|
| product id | `img.orderThumbnail`'s `data-original`, `.../product/4842_25w.jpg` -> `4842`; not `src`, and `0` (the `onerror` fallback) is none |
| name | the row's `a.nocontext` (the header has another, the seller) |
| set | the text after that link's `<br>`, `Ice Age` |
| game | the link's first path segment, `/magic/ice-age/portent` -> `magic` |
| condition, foil, language | `Rarity: C<br>Condition: Lightly Played[ Foil][ - Japanese]` |
| sealed | `Rarity:<br>Condition: Unopened` |
| price each, quantity | `$0.52`, `1` |

Conditions fold onto BAN's codes as go-mtgban folds TCGplayer's: Near Mint
`NM`, Lightly Played `SP`, Moderately Played `MP`, Heavily Played `HP`.
A printing not in English names its language after the condition. Details
of any other shape leave the line unread: it keeps what was read, says why,
and is never sent. A custom listing ("with photo") has no thumbnail and a
`/listing?q=` link, so no product id: it is unread too. A line whose price or
quantity cannot be read refuses the order.

Every order must add up: its lines' quantities to `Quantity:`, their
`quantity x price` to `Subtotal:`, and Subtotal + Shipping + Tax to
`Total:`. Refunds come off after, not before. An order that does not add up
is refused, never exported short.

## 2. Where it runs

Manifest V3, no `permissions`, `host_permissions`, `background` or
`web_accessible_resources`; a test pins their absence. One content script on
`https://store.tcgplayer.com/myaccount/orderhistory*`, which gets no panel
where the page has no filter form or heading (a sign-in page). Every request
is same-origin with the visitor's session.

## 3. Order numbers

Each order number becomes a `<button>` styled as a link. A click sets the
page's own `#SearchString` to the number (`.value` only: the box carries
jQuery autocomplete, and a key event would wake it) and submits the page's
own form with its own Search button, `form.requestSubmit(button)`. That is
exactly what typing the number and pressing Search does: the token,
`ClearSessionFilters=False`, the number, and the range already selected. A
clicked order is on the page, so it is inside that range.

## 4. The year walk

The panel offers the years `#DateRange` lists. *Orders* or *Items* walks the
chosen year:

1. **Read the state fresh**: GET page 1 and take the range and search the
   session holds, and the token, from it.
2. **Set the year**: POST `DateRange=<year>`, `ClearSessionFilters=true`, an
   empty search.
3. **Read every page**, `?PageNumber=1..N`. Page 1 fixes the total, the page
   size and N, and N must equal `pageLast` (or be 1 with no pager). Every
   page must have the year selected and no search, a heading naming the year,
   its own slice of the same total, exactly that many orders, none seen
   before, every one read whole and dated in the year. Anything else refuses
   the walk: the list moved (another tab changed the range), or an order
   could not be read, named by its number.
4. **Put back** the range and search from step 1 (`ClearSessionFilters`
   true for none, False to keep a search), then GET page 1 and check they
   took. This runs whatever happened in step 3, a refusal or Escape
   included. If it fails, the tooltip says "The order list was left on
   <year>; reload the page". After a 429 it waits 45 s first (`BUSY_WAIT`,
   the word saying so), since TCGplayer has just asked to slow down. After
   a challenge it sends nothing, since anything sent meets the same check:
   the tooltip says to reload, pass the check, and pick the range again.

A year with no orders is an empty result, said on the tooltip, and no file.
A refused or stopped walk writes nothing.

One request at a time, 1.2 s apart (`PACE`, the siblings' figure; the live
read of section 11 drew no challenge), 30 s each. A Cloudflare challenge
(`cf-mitigated: challenge`) or a 429 stops the walk; neither is answered in
code.

A tab closed mid-walk leaves the session on the year, visible in the page's
own dropdown. That is the one side effect, and the same POST the dropdown
makes.

A finished walk is kept for the page's life, so the year's second file
costs no second walk.

## 5. The CSVs

Bytes as Go's `csv.Writer` writes them: quoted only when a value holds a
comma, a quote or a line break, quotes doubled, every row ending in LF.
These two files are for a spreadsheet, so their free text (a seller, a
card's name, its set) is written with a leading `'` when it starts with
`=`, `+`, `-`, `@`, a tab or a CR, which a spreadsheet would run as a
formula; a seller names their own store. The cards file of section 6 goes
to mtgban alone and is written as read.

**`tcg-orders-<year>.csv`**, one row per order, in TCGplayer's order. The
first three are the columns go-mtgban's `tcgHistory` wrote and ck-banner's
history file shares, under the same names and meaning:

| Column | Value |
|--------|-------|
| `Order ID` | the number as printed |
| `Order Date` | as printed |
| `Amount` | `Total:` minus every refund, `$23.13` |
| `Kind` | `Seller` or `Direct` |
| `Seller` | the seller, or `TCGplayer Direct` |
| `Quantity`, `Subtotal`, `Shipping`, `Sales Tax`, `Total` | the summary |
| `Refunded` | the refunds' sum, or empty |

**`tcg-items-<year>.csv`**, one row per line: the seven columns of section
6, then `Order`, `Order Date`, `Seller` (the line's own on a Direct order),
`Game` and `Language`. A sealed line's condition is `Sealed`. A line not read whole is
written with what was read.

## 6. Send to BAN

Each order with a line that can be sent gets **Send to BAN** under its
number. The lines are on the page already, so the click opens the tab with
nothing asynchronous in front of `window.open`. The protocol is cm-banner's:

```
click       window.open("https://mtgban.com/upload/handoff")
handoff  -> { type: "mtgban-handoff-ready" }   from the opened tab, an mtgban origin
extension-> { type: "mtgban-handoff-rows", csv, rows, source: location.href }
```

The extension answers only the tab it opened, at `mtgban.com` or a
subdomain over https, and posts to the origin that spoke. One handoff waits
at a time: a second closes the first one's tab, which would otherwise wait
for rows that are not coming. While a year walk runs, every Send to BAN is
disabled, since the walk owns the panel, and a send answered during one
leaves the panel to it: the BAN tab already shows what it took.

The CSV holds only what mtgban's `internal/docparse` `ParseHeader` reads:

| Column | docparse | Value |
|--------|----------|-------|
| `TCGplayer Product ID` | `id`, resolved through go-mtgban's TCGplayer id space to the exact printing | product id |
| `Name` | name | the link's text |
| `Edition` | edition | the set line |
| `Foil` | printing | `Yes` / `No` |
| `Condition` | conditions | `NM`, `SP`, `MP`, `HP` |
| `Quantity` | quantity | |
| `Price` | price | plain dollars, `0.52` |

Never a header holding "number" (docparse reads it as the card's variant),
and never one of exactly "TCGplayer Id" (a SKU, which wipes the product id
when it is unknown).

Left out of a send and counted on the tooltip: lines of a game BAN is not
wired for here (Magic alone until a page shows another game's slug), sealed
lines (until the uploader is known to resolve a sealed product id), lines
not in English (docparse reads no language, so the product id would price
the English printing), and lines not read whole. A refunded order's tooltip says the refund does not
name its cards.

**Site side.** mtgban-website's handoff page answers only origins in its
`handoff_origins` (the infrastructure file, edited from the admin tab):
`"https://store.tcgplayer.com": {"name": "TCGplayer"}`. It must be `store.`,
the origin of the window that opens the tab and posts to it. Without the
entry the page never says it is listening, and the send waits. The handoff
lands in whichever mode, uploader or buylist, the reader last used.

## 7. The panel

ck-banner's panel: the stroopwafel and "TCG BANner", one word, a mark, a
drawn tooltip, one row (the year, *Orders*, *Items*). A fixed width; nothing
is written under the row and nothing carries a `title`. While a walk runs the
word is the page being read (`page 3 of 22`), every control is disabled,
Escape stops it, and the page asks before it is left. Done, the word counts
the orders and a tick stands beside it; the tooltip names the file, the
pages read, pending orders left out, and a range that could not be put back.
A refusal is a red cross with the reason. A send says how many cards went,
and what was left.

## 8. Fixtures

`tests/fixtures/orders.html` is cut from a saved page by
`scripts/cut-fixtures.mjs`. It keeps TCGplayer's markup from an allowlist of
attributes and drops the welcome line, the address and tracking cells'
contents, the rating buttons and modal. Order numbers, sellers, prices,
taxes, dates and refunds are synthetic, and each order still adds up; cards,
sets, conditions and product ids stay. The script checks its output for
everything it removed and writes nothing if it finds any, and
`tests/repo.test.js` scans every fixture for an email, a long digit run, a
token, an address or tracking link, the welcome line and a real seller.

## 9. Build order

1. Scaffold, the plan, and this file.
2. Read a page, against the fixture and saved pages.
3. The year walk and both CSVs.
4. Order buttons.
5. Send to BAN, once `handoff_origins` lists TCGplayer.

## 10. Not yet

- Choosing uploader or buylist mode from the handoff. `/upload` reads
  `mode` with `strconv.ParseBool` and writes it to a forever cookie, which
  would break the handoff's promise to change nothing beyond the request;
  done right, the rows message carries a bool and `/upload` honours it for
  that request alone.
- Other games, once a page shows their slugs and sealed, once the uploader
  is known to resolve a sealed product id.
- *All years*, and a kept file.
- Damaged, signed and the like, once a page shows how TCGplayer prints them.
- Sending a line not in English, once the uploader reads a language.

## 11. Checked on the live site

On 2026-11-20 the reader and the walk's checks ran in the account's own
tab over every year it offers, one request every 1.2 s, with no challenge
and no 429; the range was put back after each pass and checked.

| Year | Orders | Lines | Pages |
|------|-------:|------:|------:|
| 2026 | 144 | 1,421 | 15 |
| 2025 | 211 | 1,540 | 22 |
| 2024 | 304 | 1,629 | 31 |
| 2023 | 118 | 634 | 12 |
| 2022 | 144 | 516 | 15 |
| 2021 | 23 | 42 | 3 |
| 2020 | 86 | 423 | 9 |
| 2019 | 28 | 8 | 3 |
| 2018 | 36 | 147 | 4 |
| 2017 | 27 | 203 | 3 |
| 2016 | 0 | | 1 |

Line counts are of the orders the first pass could read; that pass refused
106 orders on the shapes section 1 now reads (multiple and shipping cost
refunds, CA GST, the older order numbers). Every page had the year
selected, named it, held its own slice of the total and as many orders as
it said. Every line was Magic: 6,562 lines, 7 sealed, 5 not in English, 1
custom listing. 165 refunds (41 full), and 195 orders with no tax row
naming a state.
