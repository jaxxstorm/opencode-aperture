import { rm } from "node:fs/promises";
import { join } from "node:path";
import { command, consumer, isolatedEnv, packageName } from "./integration-support";

try {
  for (const bridge of [true, false]) {
    const result = await consumer(undefined, { bridge });
    try {
      await command([process.execPath, "--eval", `
        import assert from 'node:assert/strict';
        import { access, chmod, constants, lstat, mkdir, readdir } from 'node:fs/promises';
        import { dirname, join } from 'node:path';
        import { fileURLToPath } from 'node:url';
        const bridge = ${bridge};
        const workerPath = ${JSON.stringify(join(result.installed, "dist/bridge-worker.js"))};
        const bridgeName = '@jaxxstorm/bun-tailscale-bridge';
        if (bridge) {
          const entry = import.meta.resolve(bridgeName);
          assert(entry.startsWith('file://' + process.cwd() + '/node_modules/'));
          const module = await import(bridgeName);
          assert.deepEqual(Object.keys(module).sort(), ['BridgeError', 'createBridge']);
          assert.equal(typeof module.createBridge, 'function');
          assert.equal(new module.BridgeError('INVALID_OPTIONS').code, 'INVALID_OPTIONS');
          const directory = join(dirname(fileURLToPath(entry)), '..');
          const manifest = await Bun.file(join(directory, 'package.json')).json();
          assert.equal(manifest.name, bridgeName);
          assert.equal(manifest.version, '0.1.0');
          const helper = join(directory, 'bin', 'bridge-' + process.platform + '-' + process.arch);
          const stat = await lstat(helper);
          assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111));
          await access(helper, constants.X_OK);
          const header = Buffer.from(await Bun.file(helper).slice(0, 32).arrayBuffer());
          assert(['arm64', 'x64'].includes(process.arch));
          if (process.platform === 'darwin') {
            assert.equal(header.readUInt32LE(0), 0xfeedfacf);
            assert.equal(header.readUInt32LE(4), process.arch === 'arm64' ? 0x0100000c : 0x01000007);
          } else {
            assert.equal(process.platform, 'linux');
            assert.equal(header.subarray(0, 4).toString('hex'), '7f454c46');
            assert.equal(header[4], 2);
            assert.equal(header[5], 1);
            assert.equal(header.readUInt16LE(18), process.arch === 'arm64' ? 183 : 62);
          }
        } else {
          assert.equal(await Bun.file('node_modules/' + bridgeName + '/package.json').exists(), false);
          assert.throws(() => import.meta.resolve(bridgeName));
        }

        // State validation follows module import but precedes createBridge: no helper or enrollment starts.
        await chmod(process.env.XDG_STATE_HOME, 0o700);
        const stateDir = join(process.env.XDG_STATE_HOME, 'unsafe-state');
        await mkdir(stateDir);
        await chmod(stateDir, 0o755);
        const worker = Bun.spawn([process.execPath, workerPath], {
          env: process.env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
        });
        const timer = setTimeout(() => worker.kill('SIGKILL'), 5000);
        const stderr = new Response(worker.stderr).text();
        try {
          worker.stdin.write(JSON.stringify({ type: 'start', protocol: 1, action: 'connect',
            gateway: 'https://gateway.invalid', hostname: 'package-verification', stateDir,
            socketPath: join(process.cwd(), 'unused.sock'), browser: false, timeoutMs: 1000 }) + '\\n');
          await worker.stdin.flush();
          let pending = '';
          const frames = [];
          for await (const chunk of worker.stdout) {
            pending += new TextDecoder().decode(chunk);
            assert(pending.length < 65536);
            let newline;
            while ((newline = pending.indexOf('\\n')) !== -1) {
              const frame = JSON.parse(pending.slice(0, newline));
              pending = pending.slice(newline + 1);
              frames.push(frame);
              if (frame.type === 'failure') {
                worker.stdin.write(JSON.stringify({ type: 'close', protocol: 1 }) + '\\n');
                await worker.stdin.flush();
              }
            }
          }
          assert.equal(await worker.exited, 0);
          assert.equal(await stderr, '');
          assert.equal(pending, '');
          assert.equal(frames.length, 2);
          assert.equal(frames[0].type, 'hello');
          assert.equal(frames[0].protocol, 1);
          assert.deepEqual(frames[1], { type: 'failure', code: bridge ? 'STATE_UNSAFE' : 'MODULE_UNAVAILABLE' });
          assert.deepEqual(await readdir(stateDir), []);
          assert.deepEqual(await readdir(process.env.XDG_STATE_HOME), ['unsafe-state']);
          assert.deepEqual((await readdir(process.cwd())).sort(), ['node_modules', 'package-lock.json', 'package.json']);
        } finally {
          clearTimeout(timer);
          worker.kill('SIGKILL');
          await worker.exited;
          await stderr;
        }

        // Registration is unconditional and lazy; mock fetch before importing either entrypoint.
        assert.equal(process.env.OPENCODE_APERTURE_ENABLE, undefined);
        let requests = 0;
        let configuring = false;
        globalThis.fetch = async (url, options) => {
          requests++;
          assert(configuring, 'Registration must not fetch before config is called');
          assert.equal(String(url), 'http://127.0.0.1:12345/api/providers');
          assert.equal(options.redirect, 'error');
          return Response.json([{ id: 'openai', models: ['fixture-model'], compatibility: { openai_responses: true } }]);
        };
        const factory = (await import('${packageName}/server')).default;
        const tui = (await import('${packageName}/tui')).default;
        const hooks = await factory();
        assert.deepEqual(Object.keys(hooks).sort(), ['chat.headers', 'config', 'dispose']);
        let commands, dispose, unregistered = false;
        await tui.tui({
          keymap: { registerLayer(layer) { commands = layer.commands; return () => { unregistered = true; }; } },
          lifecycle: { signal: new AbortController().signal, onDispose(callback) { dispose = callback; } },
        });
        assert.deepEqual(commands.map(command => command.name).sort(),
          ['aperture.disconnect', 'aperture.forget', 'aperture.login', 'aperture.models', 'aperture.setup', 'aperture.status']);
        assert(commands.every(command => typeof command.run === 'function'));
        await dispose();
        assert(unregistered);
        assert.equal(requests, 0);

        // Mock fetch rather than opening a gateway connection, including for failure diagnostics.
        process.env.APERTURE_HOST = 'http://127.0.0.1:12345';
        configuring = true;
        const config = {};
        await hooks.config(config);
        assert.equal(requests, 1);
        assert(Object.values(config.provider).some(provider => Object.hasOwn(provider.models, 'fixture-model')));
        await hooks.dispose();
        const failedHooks = await factory();
        const errors = [];
        console.error = (...args) => errors.push(args.join(' '));
        globalThis.fetch = async () => { throw new Error('fixture-private-diagnostic'); };
        const unchanged = { model: 'keep/original' };
        await failedHooks.config(unchanged);
        assert.deepEqual(unchanged, { model: 'keep/original' });
        assert.equal(errors.length, 1);
        assert(errors[0].includes('provider discovery failed: check gateway connectivity and redirects'));
        assert(!errors[0].includes('fixture-private-diagnostic'));
        await failedHooks.dispose();
      `], join(result.root, "work"), isolatedEnv(result.root));
      console.log(JSON.stringify({ check: "packed-clean-consumer", status: "pass", bridge, files: result.files }));
    } finally { await rm(result.root, { recursive: true, force: true }); }
  }
} catch {
  console.error("FAIL: packed clean-consumer verification; check build, package entrypoints and exact allowlist (raw subprocess output withheld)");
  process.exitCode = 1;
}
