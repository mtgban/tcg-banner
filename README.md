# tcg-banner

**TCG BANner** is a browser extension for your TCGplayer order history
(`store.tcgplayer.com/myaccount/orderhistory`). It does three things:

- **Saves a year as CSV.** Pick a year and click *Orders* for one row per
  order (`Order ID`, `Order Date`, `Amount` net of refunds, then seller,
  subtotal, shipping, tax, total and refund), or *Items* for one row per card
  (product id, name, set, condition, foil, quantity, price, and its order).
  You do not have to set the page's date range first: the extension selects
  the year itself, reads every page, checks each one is still that year, and
  puts your range and search back when it is done.
- **Makes every order number a link.** Clicking `17B3D927-60B89F-0DA62` runs
  TCGplayer's own search for it and shows you that order alone.
- **Sends an order to BAN.** *Send to BAN* under an order opens mtgban's
  uploader in a new tab and hands it the order's cards, each by its TCGplayer
  product id, so every card resolves to its exact printing.

Magic only, for now: a line of another game, or one whose condition the
extension cannot read whole, is left out of a send and counted.

## Permissions

None. Everything the extension reads or sends goes to the TCGplayer page it
runs on, as you, one request at a time with a pause before each. *Send to BAN*
opens mtgban's `/upload/handoff` in a tab of its own and passes it the cards
with `postMessage`; that page uploads them with your mtgban session. Nothing
else leaves your browser.

Saving a year changes one thing you can see: while it reads, TCGplayer's own
date range is that year. If the tab is closed mid-read, the page's dropdown
will show the year until you change it back.

## Installing it

The same unpacked folder works in Chrome and Firefox.

**Chrome** - `chrome://extensions`, turn on Developer mode, *Load unpacked*,
and pick this folder.

**Firefox** - `about:debugging#/runtime/this-firefox`, *Load Temporary
Add-on*, and pick `manifest.json`. Firefox runs a Manifest V3 extension on a
site only once you allow it there, so the panel does not appear until you
do: on the order history, click the Extensions button (the puzzle piece),
then tcg-banner, and choose to always allow it on store.tcgplayer.com; or
in `about:addons`, tcg-banner, *Permissions*, turn on store.tcgplayer.com.
Firefox drops a temporary add-on when it restarts, so this needs redoing
each session.

Then open your order history on TCGplayer; the panel is at the bottom right.

## Developing

```
bun install
bun test tests/
bun run mutate
```

`AGENTS.md` says how to work on it, and `SPECIFICATIONS.md` what it reads
from TCGplayer and why.
