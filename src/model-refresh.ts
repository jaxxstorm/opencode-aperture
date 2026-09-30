import type { TuiPluginApi } from "@opencode-ai/plugin/tui";

export type ModelRefreshResult =
  | { status: "ready"; count: number }
  | { status: "busy" }
  | { status: "failure"; reason: "cancelled" | "timeout" | "scope" | "status" | "catalog" | "unavailable";
      stage?: "session-status" | "subscribe" | "reload" | "reload-event" | "catalog" };

export async function refreshApertureModels(api: TuiPluginApi, input: { signal: AbortSignal; timeoutMs: number }): Promise<ModelRefreshResult> {
  const deadline = new AbortController();
  const signal = AbortSignal.any([input.signal, api.lifecycle.signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), Math.min(315_000, Math.max(1, input.timeoutMs)));
  let unsubscribe: (() => void) | undefined;
  let stage: "session-status" | "subscribe" | "reload" | "reload-event" | "catalog" = "session-status";
  let abort!: () => void;
  const interrupted = new Promise<never>((_, reject) => { abort = () => reject(new Error("Interrupted")); });
  signal.addEventListener("abort", abort, { once: true });
  const bounded = <T>(call: () => Promise<T>) => {
    signal.throwIfAborted();
    return Promise.race([call(), interrupted]);
  };
  try {
    signal.throwIfAborted();
    const client = api.client;
    const directory = api.state.path.directory;
    if (typeof directory !== "string" || !directory.trim()) return { status: "failure", reason: "scope" };
    const scope = { directory };
    const options = { throwOnError: true as const, signal };
    const current = () => api.client === client && api.state.path.directory === directory;
    const status = (await bounded(() => client.session.status(scope, options))).data;
    if (!status || typeof status !== "object" || Array.isArray(status) ||
      Object.values(status).some(value => !value || !["idle", "busy", "retry"].includes(value.type))) {
      return { status: "failure", reason: "status" };
    }
    if (Object.values(status).some(value => value.type !== "idle")) return { status: "busy" };
    if (!current()) return { status: "failure", reason: "scope" };
    // Capture the event before disposal: SSE may arrive before the HTTP response.
    stage = "subscribe";
    const disposed = new Promise<void>(resolve => {
      unsubscribe = api.event.on("server.instance.disposed", event => {
        if (event.properties.directory === directory) resolve();
      });
    });
    stage = "reload";
    await bounded(() => client.instance.dispose(scope, options));
    stage = "reload-event";
    await bounded(() => disposed);
    if (!current()) return { status: "failure", reason: "scope" };
    stage = "catalog";
    const data = (await bounded(() => client.config.providers(scope, options))).data;
    if (!current()) return { status: "failure", reason: "scope" };
    const providers = data?.providers?.filter(provider => (provider.id.startsWith("aperture-") || provider.id === "openai") && provider.name.startsWith("Aperture ("));
    const models = providers?.flatMap(provider => Object.entries(provider.models ?? {}));
    if (!models?.length || models.some(([id, model]) => !id.trim() || !model || model.id !== id || typeof model.name !== "string" || !model.name.trim())) {
      return { status: "failure", reason: "catalog" };
    }
    return { status: "ready", count: models.length };
  } catch {
    return { status: "failure", reason: input.signal.aborted || api.lifecycle.signal.aborted ? "cancelled" : deadline.signal.aborted ? "timeout" : "unavailable", stage };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    unsubscribe?.();
  }
}
