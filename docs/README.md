# Aperture for OpenCode

Discover models from an Aperture gateway and use them in OpenCode, over a direct
connection or an optional userspace Tailscale bridge.

## Start Here

| Goal | Guide |
| --- | --- |
| Install the plugin and send your first prompt | [How to Use](how-to-use.md) |
| Choose gateway credentials, API-key forwarding or ChatGPT forwarding | [Configuration](configuration.md) |
| Fix enrollment, discovery or request failures | [Troubleshooting](troubleshooting.md) |
| Compile and test this repository | [Build from Source](build.md) |
| Run your build without modifying normal OpenCode settings | [Run Locally](run-locally.md) |
| Prepare and publish a release | [Releasing](release.md) |

Package users do not need to clone this repository or run the development launcher.
Tailscale enrollment and provider authentication are separate: an enrolled device
can reach the gateway, but its model requests still need the appropriate grants
and authentication policy.

## Read These Docs Locally

From the repository root:

```sh
bunx docsify-cli@4.4.4 serve docs --port 3000
```

Open `http://localhost:3000`. Docsify renders the Markdown files directly; there
is no documentation build step. The renderer and search plugin load from a pinned
CDN version, so the preview needs network access. Do not open `index.html` using
`file://`; it needs an HTTP server to fetch the Markdown pages.

For GitHub Pages, select **Deploy from a branch**, choose the intended branch and
`/docs` folder in repository **Settings > Pages**. The included `.nojekyll` keeps
Docsify's underscore-prefixed navigation files available. These files do not
enable or publish a Pages site by themselves.
