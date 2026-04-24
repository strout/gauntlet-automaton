# Agent Guidelines: Gauntlet Automaton

This document provides essential information for AI agents working on the
Gauntlet Automaton repository.

**What This Is**: A Discord bot for managing Magic: The Gathering league play. It
handles pool management and standings via Google Sheets. League logic lives in
`leagues/<season>/` and changes each release.

## Commands

The project uses [Deno](https://deno.com/).

### Execution

- **Run Bot**: `deno task start bot` (Runs `main.ts bot`)
- **Populate Pools**: `deno task start pop` - Scans Discord for starting pool
  messages and updates the spreadsheet.
- **Check Pools**: `deno task start check` - Verifies that spreadsheet pools
  match the reconstructed pool from the change log.
- **Rebuild Pools**: `deno task start rebuild` - Performs a full reconstruction
  of all player pools.
- **Watch Mode**: `deno task dev` - Runs the bot in watch mode.

### Quality Control

- **Format**: `deno fmt` - Rigorously followed.
- **Lint**: `deno lint` - Must pass before any PR.
- **Type Check**: `deno check main.ts`

## Project Structure

- `main.ts`: Main entry point. Configures the Discord client and dispatches
  events.
- `leagues/`: Contains logic for specific league seasons (e.g., `ecl/`).
  `setup()` in these modules returns event handlers.
- `standings.ts`: Core logic for reading/writing the Google Sheet (Players,
  Matches, Pool Changes).
- `scryfall.ts`: Scryfall API integration with caching and image tiling support.
- `sealeddeck.ts`: Wrapper for sealeddeck.tech API (fetching/creating pools).
- `sheets.ts`: Low-level Google Sheets API wrapper.
- `dispatch.ts`: Custom event dispatch system using "claim/release" handlers.
- `mutex.ts`: Mutual exclusion for sensitive operations (like state saving).
- `retry.ts`: Retry wrapper for unstable external APIs.
- `archive/`: Legacy league code (mostly excluded from standard Deno tasks).

## Code Style & Conventions

### Imports

- Use [JSR](https://jsr.io/) or [NPM](https://www.npmjs.com/) imports via the
  `imports` map in `deno.jsonc`.
- Avoid direct URL imports if an alias exists.
- Group imports: Standard library, external packages, then local modules.

### Formatting & Naming

- Follow `deno fmt` (2-space indentation, semi-colons).
- **Variables/Functions**: `camelCase`.
- **Classes/Interfaces/Types**: `PascalCase`.
- **Constants (Global)**: `SCREAMING_SNAKE_CASE` (e.g., `CONFIG`).
- **Interfaces**: Prefer interfaces over types for object definitions. Use
  `readonly` for immutable properties.

### TypeScript Usage

- Be explicit with types, especially for function parameters and return values.
- Use `readonly T[]` or `ReadonlyArray<T>` for arrays that should not be
  mutated.
- Use `const` by default; only use `let` when reassignment is necessary.
- **Modern Features**: Utilize `using` for resource management (see `mutex.ts`
  usage).

### Error Handling

- Wrap network calls and file operations in `try/catch` blocks.
- Use `console.error` for logging errors.
- Use `withRetry` (from `retry.ts`) for unstable external APIs (Scryfall, Google
  Sheets, SealedDeck).

### Discord.js & Dispatch System

- The project uses `discord.js` (v14+) via NPM.
- **Handlers**: Defined as `Handler<T>`.
  - `handle.claim()` prevents subsequent handlers from seeing the event.
  - `handle.release()` allows concurrent processing by other handlers.
- Event handlers are registered in `main.ts` or through league `setup()`.
- **Adding Features**: New bot commands or event handling typically means adding
  a handler function and registering it in `main.ts` or a league's `setup()`.

## Design Principles

- **Parse, Don't Validate**: When receiving data, parse it into a structured type
  rather than just validating it. This transforms unstructured input into a
  typed representation you can safely work with.
- **Parse at the Boundaries**: Perform parsing as close to the system boundary as
  possible (e.g., at API endpoints, file I/O, or external data sources). This
  keeps the rest of your codebase working with well-typed, validated data.
- **Prefer Total Functions**: Design functions that handle all possible inputs
  without throwing or returning undefined. Use types like `Result<T, E>` or
  `Option<T>` to make partiality explicit in the type system.

## Core Logic: Pool Management

- **Pool Changes**: The `Pool Changes` sheet is the source of truth for all
  additions/removals.
- **Rebuild**: Pools are reconstructed by iterating over the change log for a
  player.
- **SealedDeck**: card data is often fetched from `sealeddeck.tech`. Use
  `fetchSealedDeck(id)` to get pool contents.
- **Spreadsheet Sync**: `standings.ts` handles reading tables using `Zod` for
  validation.

## Rules & Instructions

- **No Sensitive Info**: NEVER commit `.env` or files in `private/`.
- **Consistency**: Mimic the style of `scryfall.ts` for utilities and `main.ts`
  for bot logic.
- **Deno APIs**: Prefer Deno's built-in APIs (e.g., `Deno.readTextFile`) over
  Node.js `fs`.
- **Spreadsheets**: When reading from Google Sheets, use `readTable` and
  `parseTable` with a Zod schema to ensure data integrity.
- **Documentation**: Use JSDoc-style comments for exported functions, especially
  documenting parameters and return values.
