## Context

OpenCode 1.18.29 invokes native TUI bootstrap on `server.instance.disposed`. Its own provider-login flow disposes the current instance before refreshing providers. The public `instance.dispose` API recreates server plugin/config state on later requests, whereas config updates persist files and global disposal affects unrelated instances. The TUI plugin survives server instance disposal.

## Goals / Non-Goals

Populate the selector automatically after enrollment and refresh on demand without mutating native OAuth or persisting ephemeral routing. Skip reload when active inference is observed and preserve unrelated instances. Do not claim remote-TUI setup support or atomic idle/disposal semantics unavailable in the host. Native OAuth login is not a prerequisite for catalog visibility; inference authentication remains separate.

## Decisions

Close the enrollment worker and socket and commit settings before refreshing. Capture the current client/directory, query all session statuses, and refuse disposal for busy/retry or unknown status results. Subscribe to the directory-scoped disposal event before calling public `instance.dispose` once. Query rebuilt `config.providers` for the matching Aperture-backed OpenAI models; this native provider catalog is the readiness signal because the plugin's read-only TUI state mirror can lag after disposal. Bound requests/waits and unsubscribe on all exits. Only manual refresh opens native `model.list`; automatic refresh reports ready counts.

The idle check is not atomic: another client could begin work between status and disposal. Users must avoid starting new work during refresh; concurrent work in that race can be interrupted. Never use global disposal or dummy config writes. Manual refresh requires local-server confirmation. Cancelling the dialog stops waiting but cannot roll back an accepted server reload; native history is not deleted.

An instance recreated while another holds the same worker must obtain fresh catalog data. The private worker control channel uses correlated discovery requests/responses, coalesced across concurrent requests, with a 12-second parent bound around the 10-second discovery fetch. Discovery errors leave existing model snapshots and other owners' transport intact; worker death still invalidates all its leases. Do not log discovery bodies or proxy credentials.

## Risks / Trade-offs

Lost disposal events or failed discovery produce bounded actionable refresh failures, not false success. Enrollment remains saved even when refresh fails. Model filtering remains authoritative; compare only models exposed by the rebuilt native catalog. Local-only TUI assumptions remain unchanged.

Readiness validates model IDs and names in rebuilt `config.providers`, with listeners installed before disposal. `/aperture-status` remains a saved-settings report, not live connectivity. `/aperture-disconnect` and manual settings/environment changes retain their restart semantics. Existing users must restart once to load this implementation, then may refresh without re-enrollment.
