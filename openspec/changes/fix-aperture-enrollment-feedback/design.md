## Context

The pinned host's DialogAlert confirms and clears on Enter/OK. The current callback aborts the worker, and the catch suppresses cancellation feedback. DialogSelect does not automatically clear after selection and supports a private text footer. Dialog replacement synchronously invokes the previous close callback.

## Goals / Non-Goals

Provide visible progress, a private login link, intentional cancellation, and quick retry with saved settings. Preserve no secrets in logs, toasts, argv, settings or model context. No automatic browser launch or native OAuth changes.

## Decisions

Use DialogSelect with a default no-op Keep waiting option and a separate Cancel enrollment option. Put the sensitive URL only in its private footer. Escape dismisses and cancels; display a nonsecret cancellation toast. Track ownership so cleanup cannot close an unrelated replacement dialog. Keep synchronous replacement guarded and capture the current enrollment controller for callbacks.

Register `/aperture-login` in the palette namespace. It requires saved settings, confirms their trust, then asks only for the enrollment method. Original setup remains available for editing configuration. Unknown worker errors remain generic; only known bridge codes get actionable UI messages.

## Risks / Trade-offs

Terminal link detection is not guaranteed; instruct the user to open the displayed URL themselves. Mock tests must exercise wait/cancel choices, link replacement, and foreign dialog ownership rather than assuming alerts stay open. Live browser enrollment remains user-driven.
