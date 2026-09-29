# dsh-set-session-title

A model-facing `set_session_title` tool for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — the agent can rename its own session.

[中文说明](README.zh.md)

## Why this exists

DSH owns session titles properly: they are log-only `session/title` events (zero tokens) served by `@deepseek-ai/dsh-session-title`, written either by a deterministic first-prompt fallback or by an optional LLM provider.

What is missing is a way for the agent to *fix* one. Automatic titling can produce a content-free result — observed on a real session: the provider overwrote a usable fallback with the bare phrase `会话标题` ("session title"), i.e. the instruction's own vocabulary echoed back ([discussion #8289](https://github.com/deepseek-ai/deepseek-harness/discussions/8289)). The rename capability itself exists (`SessionTitleService.rename(session, title)`, the GUI rename dialog, the host's own delivery path uses it), but 0.2.0-rc.2 exposes it to **no** model-facing surface:

- no tool;
- no `session` CLI subcommand (`plugin` and `duplicate` only);
- `/api` guarded by an authority-bound signed cookie whose launch token is a per-process `randomBytes()` value that is never persisted, so a local process cannot legitimately obtain it.

This plugin adds exactly that one existing service call as a tool. It does not touch authentication, storage, or the session log directly — the capability is granted by composing the row.

## Behaviour

| | |
|---|---|
| Write | appends a `session/title` event with `source: { kind: "user" }` |
| Pinning | a user-sourced title is authoritative: in-flight automatic generation is superseded and later prompts schedule none (an explicit `refresh` is the deliberate unpin) |
| Scope | the calling agent's own session (`exec.agent.session`) |
| Normalization | trimmed, terminal control sequences removed, capped at the deployment's `maxTitleBytes` (dsh-base ships `80`); input that normalizes to empty is rejected |
| Cost | changes no message in the conversation and adds no tokens |

## Install

```sh
# pinned to a release (recommended)
dsh plugin --profile <name> add https://github.com/CancerTiN/dsh-set-session-title/archive/refs/tags/v0.1.1.tar.gz
# or track the main branch
dsh plugin --profile <name> add https://github.com/CancerTiN/dsh-set-session-title/archive/refs/heads/main.tar.gz
```

The manifest declares `dsh.bundle.patch`, so `add` appends `dsh-set-session-title` to the profile's `dsh.profile.bundles` and its patch inserts the tool row into the composed tree. A git spec works too:

```sh
dsh plugin --profile <name> add github:CancerTiN/dsh-set-session-title
```

On 0.2.0-rc.2 the desktop app picked the tool up **without a restart** (the client-side tool schema updated mid-session and the call succeeded immediately). Other builds may need the profile restarted.

## Requirements

Both injected services ship with `dsh-base`, so the default `web` / `desktop` / `headless` compositions satisfy them:

| service | role |
|---|---|
| `tools` | tool registry |
| `sessionTitle` | `@deepseek-ai/dsh-session-title` (row id `session-title`) |

A composition missing either one fails loud at load instead of registering a tool that cannot work.

## Usage

Ask the agent, or call it from a skill. Argument:

```json
{"title": "安装终端插件并核验连通性"}
```

Result:

```json
{"title": "安装终端插件并核验连通性", "eventSeq": 1307}
```

Read back either way (both should show the new title):

```sh
# the projection cache the GUI reads; seq matches the returned eventSeq
python3 -c "import json;print(json.load(open('$DSH_HOME/storages/session_projcache/sessions/$DSH_SESSION_ID.json'))['record']['rows']['title'])"

# the durable log; the last session/title event's source.kind should be "user"
zstd -dc "$DSH_HOME"/sessions/*/"$DSH_SESSION_ID"/session.v4.jsonl.zstd | grep session/title | tail -1
```

## Why this package has zero dependencies

This is a hard constraint, not a style choice.

Declaring an in-box package (for example `@deepseek-ai/dsh-tools`, the documented home of `defineTool`) as a dependency makes pnpm materialize a second copy inside the profile. Module identity then splits for a module-local `Symbol` that keys a runtime surface of the tool registry, so `ctx.tools[TOOL_RUNTIME_SCHEDULER]` reads back `undefined` inside `dsh-agent-loop` and **every tool call in that profile fails** — `bash`, `read`, and this plugin's tool alike — with a bare `Cannot read properties of undefined (reading 'prepare')`. Reproduced and isolated on 0.2.0-rc.2; written up in [discussion #8287](https://github.com/deepseek-ai/deepseek-harness/discussions/8287).

So `lib/index.js` imports nothing and the tool definition is hand-written JSON Schema. `ctx.tools.register()` requires only `output: { schema, render }` plus a schema inside the supported subset (`type` / `properties` / `required` / `additionalProperties` / `items` / `enum` / `const` and the `description` annotation) — which is what `defineTool` compiles a declaration into. The trade-off: `register()` does not wrap `execute` with schema validation, so the single argument is checked by hand.

## Verified on

`@deepseek-ai/dsh-desktop-runtime` 0.2.0-rc.2, macOS, session format v4 — both a `headless` profile and the desktop app's live session:

```json
{"type":"tool/call","seq":1306,"data":{"name":"set_session_title","arguments":"{\"title\":\"安装终端插件并核验连通性\"}"}}
{"type":"session/title","seq":1307,"data":{"title":"安装终端插件并核验连通性","messageSeqs":[],"source":{"kind":"user"}}}
```

`messageSeqs: []` is the signature of `rename()`: the title is explicit, not derived from a prompt.

## Limitations

- Only the **calling** session can be renamed; there is no cross-session rename and no target-id argument.
- A non-agent caller (plain host-side execution) is rejected.
- A deployment that does not compose `session-title` fails loudly at load — deliberate, so the tool can never appear without the capability behind it.

## Uninstall

```sh
dsh plugin --profile <name> remove dsh-set-session-title
```

Titles already written stay in the session log: a title is a log fact, not plugin state.

## License

MIT
