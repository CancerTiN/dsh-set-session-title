/**
 * `set_session_title` — expose the harness session-title service to the model,
 * so an agent can rename its own session instead of leaving a generic or
 * placeholder title in place.
 *
 * The tool calls `ctx.sessionTitle.rename(session, title)`, the same entry the
 * host's own delivery path uses, which appends the ordinary log-only
 * `session/title` event with a `user` source. A user-sourced title pins the
 * session: later automatic (fallback or LLM) revisions are superseded and no
 * further automatic revision is scheduled.
 *
 * Nothing here touches authentication, storage, or the session log directly —
 * the capability comes from a harness service, granted by composing this row.
 *
 * ## Why this file imports nothing
 *
 * It deliberately does not import `@deepseek-ai/dsh-tools` for `defineTool`.
 * Declaring an in-box `@deepseek-ai/*` package as a dependency makes pnpm
 * materialize a second copy inside the profile, and module identity for the
 * symbol-keyed runtime surfaces then splits: `ctx.tools[TOOL_RUNTIME_SCHEDULER]`
 * (installed by the app's own copy of `dsh-tools`) reads back undefined inside
 * the app's own `dsh-agent-loop`, which breaks *every* tool call in that
 * profile, not only this one. Observed on 0.2.0-rc.2 as
 * `Cannot read properties of undefined (reading 'prepare')`.
 *
 * So the definition is written out directly. `ctx.tools.register()` accepts it:
 * it requires only `output: { schema, render }` plus a schema inside the
 * supported subset (`type`/`properties`/`required`/`additionalProperties`/
 * `items`/`enum`/`const` and the `description` annotation) — exactly what
 * `defineTool` would have compiled this declaration into.
 * @module dsh-set-session-title
 */

/** Loader name for this plugin row. */
export const name = "set-session-title";

/** Services this plugin consumes: the tool registry and the title service. */
export const inject = ["tools", "sessionTitle"];

const TITLE_DESCRIPTION =
	"The new title text. The harness normalizes it (whitespace-trimmed, terminal control sequences " +
	"removed) and caps it at the deployment's title byte limit; input that normalizes to empty is rejected.";

/** Model-facing description; names the tool's one job and its pinning effect. */
const DESCRIPTION =
	"Set the title of the current session to an exact string you choose. Use it when the current title is " +
	"missing, generic, or stale — for example a placeholder left by automatic titling. The title is recorded " +
	"as user-sourced, which pins the session so automatic titling never overwrites it again. This changes no " +
	"message in the conversation and costs no tokens.";

/** Model-facing argument schema (the shape `defineTool` compiles to). */
const PARAMETERS = {
	type: "object",
	properties: {
		title: {
			type: "string",
			description: TITLE_DESCRIPTION
		}
	},
	required: ["title"]
};

/** Tool-result schema. */
const OUTPUT_SCHEMA = {
	type: "object",
	properties: {
		title: {
			type: "string",
			description: "The accepted, normalized title."
		},
		eventSeq: {
			type: "integer",
			description: "Sequence of the appended session/title event."
		}
	},
	required: ["title", "eventSeq"]
};

/**
 * Register `set_session_title` on the tool registry.
 * @param ctx - registrant context carrying `tools` and `sessionTitle`.
 */
export function apply(ctx) {
	ctx.tools.register({
		name: "set_session_title",
		description: DESCRIPTION,
		parameters: PARAMETERS,
		output: {
			schema: OUTPUT_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: `Session title set to "${value.title}".`
			}]
		},
		execute(args, exec) {
			// `register()` does not wrap execute with schema validation, so the
			// single argument is checked here rather than trusted from the call site.
			if (typeof args?.title !== "string") throw new Error("set_session_title requires a string `title`");
			if (!exec.agent) throw new Error("set_session_title requires an owning agent session");
			const snapshot = ctx.sessionTitle.rename(exec.agent.session, args.title);
			return Promise.resolve({
				title: snapshot.title,
				eventSeq: snapshot.eventSeq
			});
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Rename session",
			kind: "other",
			rawInput: args.title
		})
	});
}
