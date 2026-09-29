# dsh-set-session-title

给 DeepSeek Harness 的模型侧加一个 `set_session_title` 工具：**agent 可以自己给当前会话改名**。

[English](README.md)

## 为什么需要它

DSH 的会话标题是 log-only 的 `session/title` 事件（不占 token），由 `@deepseek-ai/dsh-session-title` 服务拥有：

- 自动来源一：首条人类 prompt 的确定性 fallback（`dsh-base` 配的是 5 词 / 40 字节）；
- 自动来源二：一个可选的 LLM provider（`dsh-session-title-first-prompt-llm`，5 词 / 10 个 CJK 字）。

这两条都可能产出没用的标题。实测某会话被 LLM provider 命名成了字面量「会话标题」。

改名能力本身存在（`SessionTitleService.rename(session, title)`，GUI 的会话列表里有改名对话框，host 的 webhook 路径也用它），但**之前没有任何入口是给模型用的**：没有工具、CLI 也只有 `plugin` / `duplicate`、`/api` 被 cookie 栅栏挡住。所以技能想「自动改名」时无路可走。

本插件把那行服务调用包成一个工具，capability 由 host 组合授予，不碰鉴权、不写存储。

## 行为

- 调用 `ctx.sessionTitle.rename(session, title)`，写入 `source: {kind: "user"}` 的 `session/title` 事件；
- **钉住语义**：user 来源的标题会压制自动改名，之后不再自动重命名（要恢复自动得显式 `refresh`）；
- 标题按部署配置归一化与截断（`dsh-base` 为 `maxTitleBytes: 80`），归一化后为空则拒绝；
- 只改标题，不动任何消息、不产生 token 成本。

## 组成要求

| 依赖 | 说明 |
|---|---|
| `tools` | 工具注册表（`dsh-base` 组合） |
| `sessionTitle` | `@deepseek-ai/dsh-session-title` 服务（`dsh-base` 组合，id `session-title`） |

`inject` 缺任一服务会在加载时 fail loud，不会静默降级。

## 安装

```sh
# 推荐：git 形式，解析同一份内容，且不受下面 tarball 坑的影响
dsh plugin --profile <name> add github:CancerTiN/dsh-set-session-title

# tarball URL 也可用——但请先读下面的注意事项
dsh plugin --profile <name> add https://github.com/CancerTiN/dsh-set-session-title/archive/refs/tags/v0.1.1.tar.gz
```

`package.json` 里声明了 `dsh.bundle.patch`，所以 `add` 成功后会自动把 `dsh-set-session-title` 追加进该 profile 的 `dsh.profile.bundles`，其 patch 再把工具行 insert 进组合树。

安装后**不需要重启**即可生效：app 的 HMR 会认领 profile 变更（实测 0.2.0-rc.2 桌面版在 `add` 完成后，当前会话的工具清单立刻出现了 `set_session_title`）。若你的版本未热加载，重启该 profile 即可。

> **tarball URL 的坑**：在桌面版内置的 pnpm 11.7.0 下，GitHub tarball URL 能装成功一次，之后**任何复用同一 pnpm store 的再次解析都会失败**（`ERR_PNPM_MISSING_TARBALL_INTEGRITY`；删 lockfile、加 `--force` 均无效）。已复现并上报为 [discussion #8294](https://github.com/deepseek-ai/deepseek-harness/discussions/8294)。上面的 git 形式不受影响。

## ⚠️ 零依赖是硬约束，不是风格选择

本插件的 `package.json` **刻意不声明任何依赖**，`lib/index.js` 也**刻意不 import 任何东西**（没有 `@deepseek-ai/dsh-tools` 的 `defineTool`）。

原因：一旦把 in-box 的 `@deepseek-ai/*` 声明为依赖，pnpm 就会在 profile 里装第二份副本，而**符号（symbol）键的运行时表面会因此分裂**——app 自己的 `dsh-agent-loop` 读 `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 拿到 `undefined`，于是该 profile 里**所有**工具调用全部失败（不只是本工具）。0.2.0-rc.2 上的实测报错就是：

```
Cannot read properties of undefined (reading 'prepare')
```

隔离实验（可复现）：装带 `dsh-tools` 依赖的版本 → 连第一方 `bash` 工具都失败；移除后 → 恢复正常。所以工具定义改为手写：`ctx.tools.register()` 只要求 `output: { schema, render }` 加一份受支持的 JSON Schema（`type`/`properties`/`required`/`additionalProperties`/`items`/`enum`/`const` + `description` 注解），这正是 `defineTool` 会编译成的形状。手写定义因此少了 `defineTool` 的参数校验包装，`execute` 里自行校验那一个字符串参数。

## 验证记录（0.2.0-rc.2，headless profile 端到端）

```
seq=20  tool/call      set_session_title  {"title": "端到端改名验证"}
seq=21  session/title  {"title": "端到端改名验证", "messageSeqs": [], "source": {"kind": "user"}}
seq=28  turn/end       {"reason": {"kind": "completed"}}
```

同一 profile 里 `bash` 工具同轮通过（`EXIT=0`），确认无符号分裂。桌面 profile 上的实测见下（会话 v4 日志）：

```
seq=1306  tool/call      set_session_title  {"title": "安装终端插件并核验连通性"}
seq=1307  session/title  {"title": "安装终端插件并核验连通性", "messageSeqs": [], "source": {"kind": "user"}}
```

回读核验：投影缓存 `$DSH_HOME/storages/session_projcache/sessions/<session-id>.json` 的 `record.rows.title.val` 与上述一致。

## 已知边界

- 只能改**调用者自己**的会话（工具用 `exec.agent.session`），没有跨会话改名；
- 非 agent 调用者（纯 host 侧执行）会被拒绝；
- 若某部署没有组合 `session-title` 服务，本插件加载失败——这是刻意的，避免出现「工具在但能力不在」。

## 卸载

```sh
dsh plugin --profile <name> remove dsh-set-session-title
```

卸载后已写入的标题事件仍在会话日志里（标题是日志事实，不是插件状态）。
