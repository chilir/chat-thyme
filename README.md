<div align="center">
  <img src="img/banner.jpg" width="175" />
</div>

# 🌿 chat-thyme

Every cooked up model deserves the proper seasoning. **chat-thyme** is a new way to interface with large
language models (LLMs) and inject some flavor.

(gif here)

## Features
* Tool calling<sup>1</sup> - equip your models with search, powered by [Exa](https://exa.ai/)
* Familiar interface - chat with LLMs through Discord
* Session persistence - pick up the conversation where you left off<sup>2</sup>
* Flexible configuration - fiddle with sampling parameters to your heart's content
* Pick up and go with Docker or [Nix](https://nixos.org/) - `.env` and `config.yaml` is all you
  need<sup>3</sup>
* (Almost) Universal compatibility - interface with any LLM serving framework with OpenAI
  compatibility: [Ollama](https://ollama.com/blog/openai-compatibility),
  [OpenRouter](https://openrouter.ai/docs/quickstart),
  [vLLM](https://docs.vllm.ai/en/stable/serving/openai_compatible_server.html),
  [SGLang](https://docs.sglang.ai/backend/openai_api_completions.html), and more

<sup>1</sup> Multi-turn tool calling is not supported across all models through the OpenAI chat
completions API -
[Gemini is a known issue](https://discuss.ai.google.dev/t/multi-turn-tool-usage-with-gemini-openai/53202)

<sup>2</sup> A new thread will be created when the `/resume-chat` command is called

<sup>3</sup> Post-Nix installation emotional support is not included, though the
[Determinate Nix installer](https://determinate.systems/nix-installer/) actually makes it not too
bad

## Quickstart
chat-thyme operates on a BYOE (bring your own everything) paradigm. Before getting started, you may
want do the following in preparation:
* Setup a
[Discord bot application](https://discordjs.guide/preparations/setting-up-a-bot-application.html#creating-your-bot)
and have the token handy - note that the bot must have thread creation permissions
  * [Invite the bot](https://discordjs.guide/preparations/adding-your-bot-to-servers.html#bot-invite-links)
    to your server afterwards
* Have a live local LLM server (e.g. Ollama) or identify a service provider (e.g. OpenRouter) with
  an API key and sufficient credits
* An Exa API key and sufficient credits if you wish to allow the model to search with Exa

### Configuration
#### .env
```
# .env

DISCORD_BOT_TOKEN=discord_bot_token_here # required
API_KEY=model_server_api_key_here  # optional if model server is hosted locally
EXA_API_KEY=exa_api_key_here  # optional if tool use is not needed
```

#### config.yaml
```yaml
# config.yaml

---
model: hermes3:8b-llama3.1-q6_K # required
useTools: true
serverUrl: http://host.docker.internal:11434/v1/  # just an example, change as needed!
systemPrompt: >
  You are a helpful assistant with have access to an advanced search engine. Please provide the
  user with the information they are looking for by using the search tool provided.
```

### Docker
Set up a Docker compose file specifying the necessary mounts:
```yaml
# compose.yaml

services:
  app:
    image: ghcr.io/chilir/chat-thyme:v0.1.0
    command: [ "-c", "/app/config.yaml" ]
    env_file:
      - ./.env # required
    volumes:
      - ./config.yaml:/app/config.yaml:ro # required
      - ./.sqlite:/app/.sqlite:rw  # will be created if not present

    # if you're hosting the model service on the same machine:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Then spin up chat-thyme in a container:
```bash
docker compose up
```

### Nix
Directly run the chat-thyme Nix flake through [FlakeHub](https://flakehub.com/flake/chilir/chat-thyme):
```bash
nix run https://flakehub.com/f/chilir/chat-thyme/0.1.0.tar.gz -- -c config.yaml
```

Or from GitHub:
```bash
nix run github:chilir/chat-thyme/0.1.0 -- -c config.yaml
```

### From source
chat-thyme is built with [Bun](https://bun.sh/), make sure it is installed first. From there, the
repository can be cloned and the entrypoint can be directly run with Bun.

```bash
# clone source code
git clone https://github.com/chilir/chat-thyme.git
git switch v0.1.0

# install environment and build
bun install --frozen-lockfile

# run entrypoint
bun run src/index.ts -c config.yaml
```

## Bot Commands
Once the bot is live, use `/start-chat` to begin a conversation. The bot will create a private
thread and a randomly generated chat identifier will be set as the thread title. The thread will be
automatically archived after no activity for 1 hour.

(gif here)

To resume a chat at a later point in time, use `/resume-chat <chat_identifier>`

(gif here)

## Documentation
Further documentation on configuration is a work-in-progress, please refer to the
[configuration schema](src/config/schema.ts) and parameter descriptions in the slash commands at the
time being.

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing
Contributions are very welcome! The [contributing guidelines](CONTRIBUTING.md) are still under
construction, but feel free to refer to them for some brief notes for now.

---
## TODO
* Expand documentation!!
* Slash command to end a chat
* Slash command for a help menu
* Image support