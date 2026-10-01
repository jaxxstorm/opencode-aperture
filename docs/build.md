# Build From Source

Use external **Bun 1.4.2**. Local execution and native integration checks target
**OpenCode 1.18.29**; its embedded Bun is not the build or bridge-worker runtime.
Install Git and npm as well (packing invokes `npm pack`).

## Checkout and Build

```sh
git clone https://github.com/jaxxstorm/opencode-aperture.git
cd opencode-aperture
bun --version
opencode --version
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
```

Check the printed versions against the pins above before continuing. Run these
commands from the checkout root. Installation includes the optional published
`@jaxxstorm/bun-tailscale-bridge@0.1.0` dependency by default; bridge use is opt-in.

The build creates three Bun ESM bundles:

| Output | Purpose |
| --- | --- |
| `dist/index.js` | Server plugin; package root and `/server` entry |
| `dist/tui.js` | Separate local TUI plugin; package `/tui` entry |
| `dist/bridge-worker.js` | Internal worker, not a plugin registration or package export |

Keep all three files together. Do not register the worker or put it in an
auto-discovered plugin directory. Source edits require another `bun run build`
and an OpenCode restart; the local profile loads built files, not TypeScript.

## Next Steps

- [User guide](how-to-use.md) and [configuration](configuration.md) cover installation and normal use.
- [Run locally](run-locally.md) creates an isolated profile from scratch using this build.
- `bun run pack` rebuilds and writes a versioned npm tarball in the checkout; it does not publish.
- `bun run test:package` checks the packed artifact in clean consumers.
- [Developer verification](verification.md) covers package, routing, cleanup, prerequisites, and evidence limits.
- [Release procedure](release.md) covers candidate handling and publication.
- [Script index](https://github.com/jaxxstorm/opencode-aperture/blob/main/scripts/README.md) lists the supporting tools.
