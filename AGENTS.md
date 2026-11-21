# AGENTS.md

Guidance for AI coding agents working on **tcg-banner**, a browser extension
for a TCGplayer buyer's order history: a year saved as CSV, every order
number made a search for that order, and an order's cards sent to mtgban's
uploader. Read `SPECIFICATIONS.md` for what it does and what is known about
TCGplayer's page; this file is about how to work on it without breaking it.

## The one rule that matters

**Verify against a saved TCGplayer page, not against the fixture.**

A fixture is a reconstruction, and a reconstruction drifts toward whatever the
code already does. The sibling extensions learned this more than once: a
parser and its fixture agreed with each other and were both wrong, until a
real page showed it. When you change the parser, ask for a saved page
(`Cmd-S`, complete) and run against it:

```
TCG_SAVED_ORDERS="<saved order history.html>" bun test tests/
```

`tests/saved.test.js` reads every order on it, prints the lines it could not
read whole, and checks none of its order numbers reached a fixture. Without
the variable it skips.

**Saved pages are not committable as they are.** One carries the account's
email (the welcome line), name, two postal addresses, tracking numbers, the
filter form's `__RequestVerificationToken`, and every seller it bought from.
Work on them outside the repository and delete them after. The fixture is cut
by `scripts/cut-fixtures.mjs`, never by editing a saved page down;
`tests/repo.test.js` scans every fixture for what a cut must never keep.

## Layout

```
manifest.json    MV3; one host, no permissions, and a test keeps it that way
icons/           the BAN stroopwafel, shared with ck-banner and cm-banner
src/money.js     "$1,234.56" to cents and back; "November 09, 2026" to parts
src/csv.js       the orders, items and cards CSVs: their columns and Go's quoting
src/read.js      a page: the filter, the list's heading, every order and line
src/net.js       one request at a time: a page, or the filter POST
src/walk.js      a year: set it, read every page, put the visitor's range back
src/handoff.js   window.open and postMessage to mtgban's /upload/handoff
src/ui.js        the panel, and the file download
src/page.js      content script: order buttons, Send to BAN, the panel
src/panel.css, src/orders.css
scripts/cut-fixtures.mjs  cuts tests/fixtures/ from a saved page, locally only
scripts/mutate.mjs        breaks each guard in tests/mutations.json in turn
tests/panel.js   stands the content script up in a window; clicks are real
tests/           bun + happy-dom, no browser
```

The scripts share one global, `globalThis.TCGB`, the way the browser runs
them; `tests/helpers.js` runs them the same way and stands in for TCGplayer's
session (a range, a search, and pages of a list cut from the fixture).

## Verifying

```
bun install
bun test tests/
bun run mutate
```

CI runs the same on every push, and checks that every file the manifest names
exists. There is no build step: the scripts are plain ES5-ish so they can be
`content_scripts` entries as they are; keep them that way.

A guard (a refusal, a strict shape, a check that keeps the walk honest) lands
with an entry in `tests/mutations.json`: the text that breaks it and the name
of the test that must then fail. `bun run mutate` fails if that test does not
fail, if no test file names it, or if an entry's text no longer appears
exactly once.

## Traps

**The date range is session state.** TCGplayer keeps the range, and a search,
in the session, not the URL. Every GET is filtered by whatever was last
POSTed, by this extension, by the visitor in another tab, or by the page's
own dropdown. That is why the walk checks every page names the year it asked
for, and why it puts the visitor's range and search back, verified, whatever
happens. A search is scoped by the range: an order outside the range is "No
orders match your search criteria."

**A saved page in happy-dom can reach TCGplayer.** Given a
`store.tcgplayer.com` URL, the window resolves the page's own stylesheets,
scripts and images against it and fetches them. Strip `<script>`, `<link>`,
`src` and `url()` first, give the window no URL, and turn its file loading
off.

**Reloading the extension is not enough.** A content script already injected
into an open tab keeps running the old code, so the TCGplayer tab needs
reloading too.

**Never hand `expect` an object holding a DOM node.** An order keeps its
wrapper and its number's text node; a failing `toEqual` on one prints the
whole happy-dom window. Compare the plain fields.

**The order number is a bare text node** after the label's `<br>`. Replacing
it is what makes it a button; reading a whole span's text would take the
label with it.

## Things not to do

- **Do not add a permission**, or declare a file web-accessible. Every request
  is the page's own origin, and the handoff is a tab the visitor opens.
- **Do not drive TCGplayer's search by key events.** The box carries jQuery
  autocomplete; setting `.value` and submitting the page's own form with its
  own button is all a search needs.
- **Do not write a short export.** A walk that missed a page, saw the list
  move, or met an order it could not read whole writes nothing.
- **Do not guess** a condition, a language, an id or a game. A line that
  cannot be read whole carries what was read and says why; it is not sent to
  BAN.
- **Do not fan out the walk.** One request at a time, with a pause before
  each. A challenge or a 429 stops it; never answer one in code.
- **Do not resize the panel, or write anything under its buttons.** Status is
  a mark beside the heading and a drawn tooltip.
- **Do not write an em dash.** Use a plain dash, a comma or a new sentence; a
  test fails on one.

## Working with the other repositories

The cards CSV is a contract with **mtgban-website**: every column name is
chosen for how `internal/docparse`'s `ParseHeader` reads it (SPECIFICATIONS.md
section 6). A header holding "number" becomes the card's variant, and one of
exactly "TCGplayer Id" is a SKU that wipes the product id. Check that file
before adding or renaming a column.

The handoff protocol is the one cm-banner speaks; mtgban-website's
`/upload/handoff` must list `https://store.tcgplayer.com` in its
`handoff_origins` (infrastructure config, not code) or the page never
answers. When a change here needs one there, land the site side first.

ck-banner and cm-banner are the siblings: share their conventions, not their
code.

## Commits

One topic per commit; a plain imperative subject with no `area:` prefix,
wrapped at 80 columns; the reason and what was measured in the body. No
`Co-Authored-By` lines. Pull requests off `master`, merged by rebase.
