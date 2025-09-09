# Gauntlet Automaton

## Prerequisites

- [Deno](https://deno.land/) OR [Nix](https://nixos.org/)

## Setup

1.  **Discord Credentials**: Create a `.env` file with your Discord bot token:
    ```
    DISCORD_TOKEN=your_discord_bot_token_here
    ```

2.  **Google Service Account**: Set up your Google service account credentials.

3.  **Configuration**: Copy `config.json.example` to `private/config.json` and fill in the required IDs and sheet information.

## Run

Using Deno:
```bash
deno task start bot
```

Using Nix (if available):
```bash
nix run . bot
```