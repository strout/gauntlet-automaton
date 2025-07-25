# Config

The config contains information like Discord and Google Sheet IDs. While not
secret, I'd rather not have those in a public or semi-public repository so
they're managed separtely. See the example config.

# Handlers

Handlers (see dispatch.ts) are a bit like normal event listeners but with a bit
more control over the order and extent of processing. If an event is dispatched
to a list of handlers, each one of them is given it one at a time. A handler can
claim an event, release it, or do neither. Claiming an event means no further
event handlers will run. Releasing it means that the next handler can process
the event, even if the current handler isn't finished; they both process it
concurrently. If neither happens, the next handler will process the event but
only after the current one is done.

# Persistence

Google Sheets is the source of truth. There isn't another persistent data
store. Discord message state is also somewhere things can be persisted but it's
secondary to Google Sheets, since sometimes things end up being hand-edited.

Avoid tracking state in-memory. It may be need for performance reasons or to
avoid rate limits, however. Caching should be enough in most cases. Make sure
it can be rebuilt from the sheets.

# Naming conventions

An "index" is 0-based. A "row number" (or "column number") is 1-based.

# Source layout

* main.ts: The entrypoint. It starts the bot. Contains a bit of clutter.
* sealeddeck.ts, sheets.ts, scryfall.ts: external APIs.
* archive/leagues/*.ts: Old leagues' implementations. These likely don't compile.
  Kept around in case they're useful.
