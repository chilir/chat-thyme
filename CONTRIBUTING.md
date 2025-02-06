# Contributing

WIP! The highest need right now is expanding the documentation! The next highest need is to thoroughly use the app and break it in ways I haven't yet 🥹.

Feature development is also highly welcomed! Unfortunately (for the project, fortunately for me) I am currently employed full-time so my response time may be delayed. But all contributions are welcomed and appreciated! If you decide to make a contribution (thank you in advance!), I will make every effort to find time to review the change.

Easiest way to set up a development environment is to have Nix and direnv installed. From there, you can clone the repo and run `bun install`. Otherwise, minimally you would need Bun and sqlite.

Unit tests can be run with `bun --env-file=.env.test test`

Biome is used for linting and formatting, would highly recommend installing the official extension/plugin for your IDE. It is available in the Nix development shell as well if you prefer using the CLI instead.

No pre-commit hooks at this point in time - I understand they are widely disliked. However I do think one would be useful - a hook to prevent accidentally committing to the `main` branch.