import type { TuiPluginModule, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { fileURLToPath } from "node:url";
import { lstat } from "node:fs/promises";
import { startBridgeWorker, type BridgeSession } from "./bridge-client";
import { refreshApertureModels } from "./model-refresh";
import { openEnrollmentBrowser } from "./browser";
import { createBridgeSocketDir, defaultBridgeSettings, forgetBridgeState, loadBridgeSettings, prepareBridgeStateDirectory,
  resolveBridgeRuntime, saveBridgeSettings, settingsPath, validateBridgeSettings } from "./bridge-settings";

export default {
  id: "@jaxxstorm/opencode-aperture",
  async tui(api) {
    let running: Promise<void> | undefined;
    let controller: AbortController | undefined;
    let disposing = false;
    let enrollmentSaved = false;
    const alert = (message: string) => {
      if (disposing || api.lifecycle.signal.aborted) return;
      api.ui.dialog.replace(() => api.ui.DialogAlert({ title: "Aperture", message,
        onConfirm: () => api.ui.dialog.clear() }));
    };
    function ask<T>(render: (finish: (value: T | undefined) => void) => ReturnType<TuiPluginApi["ui"]["DialogPrompt"]>): Promise<T | undefined> {
      const signal = controller!.signal;
      return new Promise(resolve => {
        let settled = false;
        const finish = (value: T | undefined) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", cancel);
          api.ui.dialog.clear();
          resolve(value);
        };
        const cancel = () => finish(undefined);
        if (signal.aborted) { cancel(); return; }
        signal.addEventListener("abort", cancel, { once: true });
        api.ui.dialog.replace(() => render(finish), cancel);
      });
    }
    const prompt = (title: string, value = "") => ask<string>(finish => api.ui.DialogPrompt({ title, value,
      onConfirm: finish, onCancel: () => finish(undefined) }));
    const confirm = (message: string) => ask<boolean>(finish => api.ui.DialogConfirm({ title: "Aperture", message,
      onConfirm: () => finish(true), onCancel: () => finish(false) }));
    const select = <T extends string>(title: string, options: { title: string; value: T }[], current: T) =>
      ask<T>(finish => api.ui.DialogSelect({ title, options, current, onSelect: option => finish(option.value) }));

    async function refresh(timeoutMs: number, enrolled: boolean) {
      const refreshController = controller!;
      let finished = false;
      let ownsDialog = false;
      const prefix = enrolled ? "Device enrolled; settings saved. " : "Saved Aperture settings remain enabled. ";
      try {
        api.ui.dialog.replace(() => api.ui.DialogSelect({ title: "Aperture models", skipFilter: true, flat: true,
          current: "wait", options: [
            { title: "Keep waiting", value: "wait", footer: `${prefix}Refreshing models on the local server. Enter keeps waiting.` },
            { title: "Cancel waiting", value: "cancel", footer: "Stop waiting only; saved settings and enrollment are retained." },
          ], onSelect: option => { if (option.value === "cancel") api.ui.dialog.clear(); },
        }), () => { ownsDialog = false; if (!finished) refreshController.abort(); });
        ownsDialog = true;
        const result = await refreshApertureModels(api, { signal: refreshController.signal, timeoutMs });
        finished = true;
        if (ownsDialog) { api.ui.dialog.clear(); ownsDialog = false; }
        if (disposing || api.lifecycle.signal.aborted) return;
        if (result.status === "ready") {
          api.ui.toast({ variant: "success", message: `${prefix}${result.count} Aperture models ready in /models. Gateway-managed models use gateway credentials; subscription forwarding uses separate native OpenAI login.` });
          if (!enrolled) api.keymap.dispatchCommand("model.list");
        } else {
          const details = result.status === "failure" ? {
            cancelled: "Waiting stopped; an accepted server reload may still finish.",
            timeout: "The refresh deadline expired.",
            scope: "The current client or project directory changed or is unavailable.",
            status: "Could not verify that the current instance is idle; reload was skipped.",
            catalog: "The server returned no valid Aperture model catalog. Check gateway discovery and provider configuration.",
            unavailable: "A public OpenCode API call failed or is unavailable.",
          }[result.reason] : "";
          const message = result.status === "busy"
            ? `${prefix}Finish active requests, then run /aperture-models. No requests were aborted.`
            : `${prefix}Model refresh ${result.reason === "cancelled" ? "waiting cancelled" : "could not be verified"} [${result.reason}${result.stage ? `:${result.stage}` : ""}]. ${details} Retry /aperture-models or check /models. Do not forget or re-enroll to retry refresh. Native OpenAI login is separate.`;
          // Cancellation may mean another dialog replaced ours; do not replace it back.
          if (result.status === "failure" && result.reason === "cancelled") api.ui.toast({ variant: "info", message });
          else alert(message);
        }
      } finally { finished = true; if (ownsDialog) api.ui.dialog.clear(); }
    }

    async function action(kind: "setup" | "login" | "models" | "status" | "disconnect" | "forget") {
      const original = await loadBridgeSettings();
      if (controller!.signal.aborted) return;
      if (kind === "models") {
        if (!original?.bridge.enabled) { alert("Aperture models require enabled local bridge settings. Run /aperture-setup first."); return; }
        if (!await confirm("Refresh Aperture models on this local OpenCode server? Remote TUI servers are unsupported. Refresh checks for idle sessions; avoid starting new requests while it reloads. Native OpenAI login remains separate.")) return;
        await refresh(original.bridge.startupTimeoutMs + 15_000, false);
        return;
      }
      if (kind === "status") {
        alert(`Local saved settings only: ${original ? (original.bridge.enabled ? "enabled" : "disabled; restart applies disconnect") : "not configured"}.\nFile: ${settingsPath()}\nUse /aperture-models to refresh an enabled profile while idle. This is not live connection status. Remote TUI servers are unsupported. Native OpenAI login is separate.`);
        return;
      }
      if (kind === "login" && !original) {
        alert("No saved Aperture connection exists. Run /aperture-setup first.");
        return;
      }
      const settings = structuredClone(original ?? defaultBridgeSettings());
      const unchanged = async () => {
        if (controller!.signal.aborted) throw new Error("Cancelled");
        if (JSON.stringify(await loadBridgeSettings()) !== JSON.stringify(original)) throw new Error("Settings changed");
        if (controller!.signal.aborted) throw new Error("Cancelled");
      };
      if (kind === "forget") {
        if (!original || original.bridge.enabled) {
          alert("Forget requires saved disabled settings. Disable the local bridge, then quit and restart OpenCode first. Remote TUI servers are unsupported.");
          return;
        }
        if (!await confirm(`Permanently delete this machine's local Aperture bridge identity and profile?\n${settings.bridge.stateDir}\n\nDisable and restart OpenCode first; stop other OpenCode instances and helpers using this profile. Remote TUI servers are unsupported. This requires enrollment again and does not revoke the device remotely or change native OpenAI login. Revoke the device separately in your tailnet admin console.`)) return;
        await unchanged();
        await forgetBridgeState(settings);
        alert("Local Aperture profile forgotten. Saved settings remain disabled; enrollment is required to reconnect. Remote device revocation is separate: use your tailnet admin console. Native OpenAI login is unchanged.");
        return;
      }
      if (kind === "setup" && !await confirm("This configures this machine only. Remote TUI servers are unsupported. Continue only with a local OpenCode server. Native OpenAI login remains separate.")) return;
      if (kind === "login" && !await confirm(`Enroll using your saved local connection?\nGateway: ${settings.bridge.gateway}\nRuntime: ${settings.bridge.runtime.mode}\nBridge module: ${settings.bridge.modulePath ?? "installed package"}\n\nContinue only if you trust this gateway and bridge code. Remote servers are unsupported. Native OpenAI login remains separate.`)) return;
      const mode = kind === "login" ? "enable" : kind === "disconnect" ? "disable" : await select("Aperture bridge", [
        { title: "Enable and enroll", value: "enable" }, { title: "Disable on restart", value: "disable" },
      ], "enable");
      if (!mode) return;
      if (mode === "disable") {
        if (!await confirm("Disable the local bridge on restart? This does not stop the running server worker, delete its identity, or revoke the device remotely. Remote servers are unsupported.")) return;
        await unchanged();
        settings.bridge.enabled = false;
        await saveBridgeSettings(settings, { expected: original });
        alert("Disabled for the next start. Quit and restart OpenCode to disconnect the server bridge. Identity is retained; revoke the device independently in your tailnet admin console if needed.");
        return;
      }
      const gateway = kind === "login" ? settings.bridge.gateway : await prompt("Trusted gateway HTTPS origin", settings.bridge.gateway);
      if (gateway === undefined) return;
      if (kind !== "login" && !await confirm("The gateway you select can receive your OpenAI credentials and requests. Continue only if you trust its operator.")) return;
      const runtimeMode = kind === "login" ? settings.bridge.runtime.mode : await select("Bridge runtime (requires Bun 1.4.2)", [
        { title: "External Bun (recommended)", value: "external" },
        { title: "OpenCode executable (explicit opt-in, no fallback)", value: "opencode" },
      ], settings.bridge.runtime.mode);
      if (!runtimeMode) return;
      const executable = kind === "login" ? settings.bridge.runtime.executable ?? "" : await prompt("Absolute runtime executable (blank = mode default)", settings.bridge.runtime.executable ?? "");
      if (executable === undefined) return;
      const modulePath = kind === "login" ? settings.bridge.modulePath ?? "" : await prompt("Trusted bridge JS entry (absolute; blank = installed package)", settings.bridge.modulePath ?? "");
      if (modulePath === undefined) return;
      if (kind !== "login" && modulePath && !await confirm("This overrides the packaged bridge with executable JavaScript. Select this JS entry only if you trust the code. It runs with your user permissions.")) return;
      const hostname = kind === "login" ? settings.bridge.hostname : await prompt("Tailnet device hostname", settings.bridge.hostname);
      if (hostname === undefined) return;
      const enrollment = await select("Enroll device", [
        { title: "Browser link (shown only in a private dialog)", value: "browser" },
        { title: "Auth key environment variable reference (never paste a key)", value: "env" },
      ], "browser");
      if (!enrollment) return;
      let authKeyEnv: string | undefined;
      if (enrollment === "env") {
        authKeyEnv = await prompt("Environment variable NAME only, not its secret value", settings.bridge.authKeyEnv ?? "TS_AUTHKEY");
        if (authKeyEnv === undefined) return;
      }
      const draft = validateBridgeSettings({ version: 1, bridge: { ...settings.bridge, enabled: true, gateway, hostname,
        runtime: { mode: runtimeMode, ...(executable ? { executable } : {}) },
        modulePath: modulePath || undefined, authKeyEnv } });
      // The worker uses the stricter DNS-label hostname contract.
      if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(hostname)) throw new Error("Invalid hostname");
      const runtime = resolveBridgeRuntime(draft.bridge.runtime);
      if (modulePath) {
        const file = await lstat(modulePath);
        if (!file.isFile() || file.isSymbolicLink() || file.uid !== process.getuid!() || (file.mode & 0o022)) throw new Error("Unsafe module");
      }
      await unchanged();
      await prepareBridgeStateDirectory(draft.bridge.stateDir);
      const socket = await createBridgeSocketDir();
      let session: BridgeSession | undefined;
      let finished = false;
      let replacing = false;
      let ownsDialog = false;
      const enrollmentController = controller!;
      const cancelled = () => {
        if (!disposing && !api.lifecycle.signal.aborted) api.ui.toast({ variant: "info", message: "Aperture enrollment cancelled. Saved settings were not changed. Retry with /aperture-login." });
      };
      enrollmentController.signal.addEventListener("abort", cancelled, { once: true });
      const pending = (message: string) => {
        if (enrollmentController.signal.aborted) return;
        replacing = true;
        try {
          api.ui.dialog.replace(() => api.ui.DialogSelect({ title: "Aperture enrollment", skipFilter: true, flat: true,
            current: "wait", options: [
              { title: "Keep waiting", value: "wait", footer: message },
              { title: "Cancel enrollment", value: "cancel", footer: "Stop enrollment without saving settings." },
            ],
            onSelect: option => { if (option.value === "cancel") api.ui.dialog.clear(); },
          }), () => {
            ownsDialog = false;
            if (!finished && !replacing) enrollmentController.abort();
          });
          ownsDialog = true;
        } finally { replacing = false; }
      };
      const pendingUrl = (url: string) => {
        if (enrollmentController.signal.aborted) return;
        replacing = true;
        try {
          api.ui.dialog.replace(() => api.ui.DialogPrompt({ title: "Copy Aperture enrollment URL if your browser does not open. Keep this dialog open; Enter waits, Escape cancels.", value: url,
            onConfirm: () => pendingUrl(url), onCancel: () => api.ui.dialog.clear() }), () => {
            ownsDialog = false;
            if (!finished && !replacing) enrollmentController.abort();
          });
          ownsDialog = true;
        } finally { replacing = false; }
      };
      const openedUrls = new Set<string>();
      try {
        pending(`Starting Tailscale and waiting for a login link (up to ${Math.ceil(draft.bridge.startupTimeoutMs / 1000)} seconds).\nEnter keeps waiting. Escape or Cancel enrollment stops this attempt. Settings are not saved until enrollment completes.`);
        const authKey = authKeyEnv ? process.env[authKeyEnv] : undefined;
        if (authKeyEnv && !authKey) throw new Error("Missing enrollment environment variable");
        session = await startBridgeWorker({ runtime,
          workerPath: fileURLToPath(new URL("./bridge-worker.js", import.meta.url)),
          signal: controller!.signal,
          start: { action: "enroll", gateway, hostname, stateDir: draft.bridge.stateDir,
            modulePath: draft.bridge.modulePath, authKey, browser: enrollment === "browser",
            timeoutMs: draft.bridge.startupTimeoutMs, socketPath: socket.socketPath },
          onAuthRequired: url => {
            if (enrollmentController.signal.aborted) return;
            pendingUrl(url);
            if (!openedUrls.has(url)) {
              openedUrls.add(url);
              void openEnrollmentBrowser(url);
            }
          },
        });
      } finally {
        finished = true;
        enrollmentController.signal.removeEventListener("abort", cancelled);
        if (ownsDialog) api.ui.dialog.clear();
        try { await session?.close(); } finally { await socket.cleanup(); }
      }
      await unchanged();
      await saveBridgeSettings(draft, { expected: original });
      enrollmentSaved = true;
      await refresh(draft.bridge.startupTimeoutMs + 15_000, true);
    }
    const run = (kind: "setup" | "login" | "models" | "status" | "disconnect" | "forget"): Promise<void> => {
      if (running || disposing || api.lifecycle.signal.aborted) return Promise.resolve();
      controller = new AbortController();
      enrollmentSaved = false;
      running = action(kind).catch((error: unknown) => {
        if (enrollmentSaved) {
          if (!controller!.signal.aborted) alert("Device enrolled; settings saved. Model refresh failed. Retry /aperture-models, check /models, or restart OpenCode. Native OpenAI login remains separate.");
          return;
        }
        if (kind === "models") {
          if (!controller!.signal.aborted) alert("Aperture model refresh failed. Check local bridge settings, retry /aperture-models, check /models, or restart OpenCode.");
          return;
        }
        if (kind === "forget") {
          if (!controller!.signal.aborted) alert("Aperture could not forget the local profile. It must be private, plugin-owned, saved disabled, and unlocked. Disable and restart OpenCode first. A live or stale .aperture-lock is never removed automatically: stop all OpenCode processes and helpers, then manually review the sibling lock directory before removing a stale lease. No destructive fallback was attempted; remote revocation is separate.");
          return;
        }
        if (controller!.signal.aborted) return;
        const messages: Record<string, string> = {
          UNSUPPORTED_RUNTIME: "The selected runtime is not supported. Choose external Bun 1.4.2 in /aperture-setup; OpenCode's current embedded Bun is too old.",
          UNSUPPORTED_PLATFORM: "The bridge does not support this operating system or architecture.",
          MODULE_UNAVAILABLE: "The bridge module could not load. Check its installed absolute JS entry in /aperture-setup.",
          HELPER_UNAVAILABLE: "The installed bridge is missing an executable helper for this platform. Reinstall the reviewed bridge artifact.",
          STATE_LOCKED: "The Tailscale profile is locked. Quit other OpenCode test windows and helpers using it before retrying. Never remove a live lease; review a stale lock only after all helpers have stopped.",
          STATE_UNSAFE: "The Tailscale state location or permissions are unsafe. Check its private ownership and profile settings before retrying.",
          AUTH_REQUIRED: "This profile needs enrollment. Retry /aperture-login and choose Browser link.",
          AUTH_FAILED: "Tailscale rejected enrollment. Retry browser login, or check the referenced auth key and tailnet permissions.",
          STARTUP_TIMEOUT: "Tailscale enrollment timed out before completion. Check connectivity, then retry /aperture-login and finish browser authentication before the deadline.",
          HELPER_FAILED: "The Tailscale helper stopped before enrollment completed. Check the installed bridge/runtime and retry /aperture-login.",
          CANCELLED: "Tailscale enrollment was cancelled. Saved settings were not changed; retry /aperture-login.",
        };
        let code = error instanceof Error ? error.message.replace(/^Aperture bridge: /, "") : "";
        if (error instanceof Error && error.message.startsWith("Aperture profile is locked.")) code = "STATE_LOCKED";
        if (error instanceof Error && error.message === "Invalid or unsafe Aperture bridge settings") code = "STATE_UNSAFE";
        alert(messages[code] ?? "Aperture could not complete this action. Check the saved connection, external Bun, bridge installation and environment reference, then retry /aperture-login. No secrets are shown; saved settings were not changed.");
      }).finally(() => { running = undefined; controller = undefined; });
      return running;
    };
    const unregister = api.keymap.registerLayer({ commands: [
      { namespace: "palette", name: "aperture.setup", title: "Aperture: Set up local bridge", slashName: "aperture-setup", run: () => run("setup") },
      { namespace: "palette", name: "aperture.login", title: "Aperture: Log in with saved settings", slashName: "aperture-login", run: () => run("login") },
      { namespace: "palette", name: "aperture.status", title: "Aperture: Saved settings status", slashName: "aperture-status", run: () => run("status") },
      { namespace: "palette", name: "aperture.disconnect", title: "Aperture: Disconnect on restart", slashName: "aperture-disconnect", run: () => run("disconnect") },
      { namespace: "palette", name: "aperture.forget", title: "Aperture: Forget local profile", slashName: "aperture-forget", run: () => run("forget") },
      { namespace: "palette", name: "aperture.models", title: "Aperture: Refresh models", slashName: "aperture-models", run: () => run("models") },
    ] });
    const abort = () => controller?.abort();
    api.lifecycle.signal.addEventListener("abort", abort, { once: true });
    api.lifecycle.onDispose(async () => {
      disposing = true;
      abort();
      await running;
      unregister();
      api.lifecycle.signal.removeEventListener("abort", abort);
    });
  },
} satisfies TuiPluginModule;
