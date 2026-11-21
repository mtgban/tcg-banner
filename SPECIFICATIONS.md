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
`[data-aid=spn-sellerorderwidget-vendorname] a`, except an order TCGplayer
sold itself (`TCGPLAYER-...`), whose span holds the plain text `TCGplayer`
and no link; a Direct order names a seller on each line (`.orderSoldby a`).

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
`https://store.tcgplayer.com/*`, the host alone. The path is decided in
`page.js`, the way the server reads it: `/myaccount/orderhistory` in any
letter case, with slashes doubled or not, and a trailing one or not. The
server answers `//myaccount/orderhistory` alike, a visitor was found there
(2026-11-21), and a match pattern for one spelling misses the others. On any
other path the script returns before it touches the page, and on the history
it gets no panel where the page has no filter form or heading (a sign-in
page). Every request
is same-origin with the visitor's session.

## 3. Order numbers

Each order number becomes a `<button>` styled as a link. A click sets the
page's own `#SearchString` to the number (`.value` only: the box carries
jQuery autocomplete, and a key event would wake it) and submits the page's
own form with its own Search button, `form.requestSubmit(button)`. That is
what typing the number and pressing Search does: the token,
`ClearSessionFilters=False`, the number, and the range. The range is the
order's own year, set as `#DateRange`'s `.value` (its `onchange` would post
the range and reload first), since a search is scoped by the range and a
relative one moves on: an order of July 21, 2026, searched from Last 90 Days
in November, matches nothing. An order whose year the dropdown does not
offer, or whose date did not read, keeps the range selected.

## 4. The walk

The panel offers every range `#DateRange` lists, in its order: the last 30,
90 and 120 days (shown as `30 days` and so on, to fit), then the years. It
starts on the range the page shows. *Download CSV* walks the chosen range,
here called the year, since a relative range is walked the same way but
for one check, the date's, in step 3:

1. **Read the state fresh**: GET page 1 and take the range and search the
   session holds, and the token, from it.
2. **Set the year**: POST `DateRange=<year>`, `ClearSessionFilters=true`, an
   empty search.
3. **Read every page**, `?PageNumber=1..N`. Page 1 fixes the total, the page
   size and N, and N must equal `pageLast` (or be 1 with no pager). Every
   page must have the year selected and no search, a heading naming the year,
   its own slice of the same total, exactly that many orders, none seen
   before, every one read whole and, for a year, dated in it. A relative
   range has no date check: where TCGplayer puts its day boundary is not
   known, so it rests on the heading and the counts. Anything else refuses
   the walk: the list moved (another tab changed the range), or an order
   could not be read, named by its number.
4. **Put back** the range and search from step 1 (`ClearSessionFilters`
   true for none, False to keep a search), then GET page 1 and check they
   took. This runs whatever happened in step 3, a refusal or Escape
   included. If it fails, the tooltip says "The order list was left on
   <year>; pick Last 30 Days again", naming the range and any search from
   step 1, since a reload would only show the year again. After a 429 it waits 45 s first (`BUSY_WAIT`,
   the word saying so), since TCGplayer has just asked to slow down. After
   a challenge it sends nothing, since anything sent meets the same check:
   the tooltip says to reload, pass the check, and pick that range again.

A year with no orders is an empty result, said on the tooltip, and no file.
A refused or stopped walk writes nothing.

One request at a time, 1.2 s apart (`PACE`, the siblings' figure; the live
read of section 11 drew no challenge), 30 s each. A Cloudflare challenge
(`cf-mitigated: challenge`) or a 429 stops the walk; neither is answered in
code.

A tab closed mid-walk leaves the session on the year, visible in the page's
own dropdown. That is the one side effect, and the same POST the dropdown
makes.

A finished year is kept for the page's life, so asking for it again costs
no second walk. A relative range is walked each time, since it moves on
as the days do.

## 5. The CSVs

Bytes as Go's `csv.Writer` writes them: quoted only when a value holds a
comma, a quote or a line break, quotes doubled, every row ending in LF.
The orders file is for a spreadsheet, so a seller's name is written with a
leading `'` when it starts with `=`, `+`, `-`, `@`, a tab or a CR, which a
spreadsheet would run as a formula; a seller names their own store. The
cards file of section 6 goes to mtgban alone and is written as read.

**`tcg-orders-<year>.csv`**, or `tcg-orders-last-30-days-<yyyy-mm-dd>.csv`
for a relative range, dated the day it was read, one row per order, in
TCGplayer's order. The
first three are the columns go-mtgban's `tcgHistory` wrote and ck-banner's
history file shares, under the same names and meaning:

| Column | Value |
|--------|-------|
| `Order ID` | the number as printed |
| `Order Date` | as printed |
| `Amount` | `Total:` minus every refund, `$23.13` |
| `Kind` | `Seller` or `Direct` |
| `Seller` | the seller, or `TCGplayer Direct` |
| `Tax State` | the state a `Sales Tax (NY)` row names, `NY`; empty for a plain `Sales Tax`, for Canada's `CA GST`, or for no tax row |
| `Quantity`, `Subtotal`, `Shipping`, `Sales Tax` | the summary |
| `Refund` | the refunds' sum as a negative amount, `-$1.02`, or empty |
| `Tax Refund (est.)` | the part of `Refund` that was tax, as a negative amount, or empty without a refund; see below |
| `Total` | `Total:` with the refunds taken off, the same as `Amount` |
| `Total Tax` | `Sales Tax` with `Tax Refund (est.)` taken off |

`Subtotal`, `Shipping`, `Sales Tax` and `Refund` add up to `Total`.
`Tax Refund (est.)` sits beside `Refund` as the part of it that was tax, not
added to it, and `Total Tax` after `Total` is what tax the order came to.

A refund note gives one amount and never says how much of it was tax, so
`Tax Refund (est.)` is the refunds scaled by the order's own share of tax,
`Sales Tax` over `Total:`, rounded to the cent. It is exact for a full
refund, where it is the whole tax, and an estimate for any other. The saved
page's $1.02 partial refund, on a $215.06 New York order with $17.52 of
tax, comes to $0.08: a $0.94 card and its tax. The same order also holds a
$1.02 card, so the refund could equally have been that card with no tax;
the note alone cannot tell them apart.

**`tcg-order-<number>.csv`**, saved from the panel on one order (section 7),
one row per line of it, every line included: the columns of section 6, then
`Order`, `Order Date`, `Seller` (the line's own seller on a Direct order),
`Game` and `Language`. `Order`, not `Order Number`: docparse reads a header
holding "number" as the card's variant. `Name`, `Edition` and `Seller` are guarded like
the orders file's seller.

## 6. Send to BAN

Each order with a line that can be sent gets **Send to BAN** beside its
number: the BAN stroopwafel as a small round button, named "Send to BAN"
for a screen reader and on hover. The number and the icon share a span that
does not wrap, so the icon stays on the number's line, running past the
header's column if it has to. The lines are on the page already, so the click opens the tab with
nothing asynchronous in front of `window.open`. The protocol is cm-banner's:

```
click       window.open("https://mtgban.com/upload/handoff")
handoff  -> { type: "mtgban-handoff-ready" }   from the opened tab, an mtgban origin
extension-> { type: "mtgban-handoff-rows", csv, rows, source: location.href }
```

The extension answers only the tab it opened, at `mtgban.com` or a
subdomain over https, and posts to the origin that spoke. Until that tab
speaks the word is `sending`: mtgban's page stays silent while the reader
is not signed in there or cannot upload, and says why in its own tab. A tab
closed before it spoke is noticed when this one gets focus back, with no
timer, and the send fails with "The upload page was closed; try again". One handoff waits
at a time: a second closes the first one's tab, which would otherwise wait
for rows that are not coming. A send goes out while a year walk runs too,
and leaves the panel to the walk: one that went says nothing, since the BAN
tab shows what it took, and one that failed is added to the walk's tooltip
when the walk ends.

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
drawn tooltip, one row (the range, *Download CSV*). Until it is asked for
something, and again when the year changes, the word is `ready` with a
tick, and with no word the heading drops its dash. On a list a search has
narrowed to one order (a search is set, the heading counts one order, and
that order is read whole), the row is that order's instead: *Download CSV*
saves its cards with no request, and *Send to BAN* does what the icon beside
its number does, disabled when none of its lines can be sent. A fixed width; nothing
is written under the row and nothing carries a `title`. While a walk runs the
word is the page being read (`page 3 of 22`), every control in the row is disabled,
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

The reader and the walk's checks ran twice in the account's own tab, one
request every 1.2 s, with no challenge and no 429, and the range was put
back after each pass and checked. The first pass (2026-11-20) covered every
year the dropdown offers. The second (2026-11-21), with the reader as
section 1 has it, covered 2026 back to 2019 and was stopped during 2018.

| Year | Orders | Pages | Lines |
|------|-------:|------:|------:|
| 2026 | 144 | 15 | 1,644 |
| 2025 | 211 | 22 | 1,690 |
| 2024 | 304 | 31 | 1,640 |
| 2023 | 118 | 12 | 635 |
| 2022 | 144 | 15 | 578 |
| 2021 | 23 | 3 | 42 |
| 2020 | 86 | 9 | 521 |
| 2019 | 28 | 3 | 86 |
| 2018 | 36 | 4 | |
| 2017 | 27 | 3 | |
| 2016 | 0 | 1 | |

Orders and pages are the same in both passes; lines are the second pass's,
which did not reach 2018 and before. Every page had the year selected,
named it, held its own slice of the total and as many orders as it said.
The second pass read every order but six that TCGplayer sold itself
(`TCGPLAYER-...`, five in 2023 and one in 2024), whose lines are not
counted above; section 1 reads them since, and they have not been read
live again. One line, a custom listing, had no product id.

Across the second pass (2019 to 2026, and the part of 2018 read before it
stopped): 48 full refunds, 183 partial and 5 of shipping cost; tax rows of
859 `Sales Tax (XX)`, 203 plain `Sales Tax` and 2 `CA GST`; 7 sealed lines
and 5 not in English (4 Japanese, 1 Spanish). In the first pass every line
was Magic.
