# Decision note — Q1: Pairing model for desktop handoff

**Status**: Proposed (needs main's ratification before any implementation)
**Date**: 2026-07-07
**Question** (interaction-model §9.1): When mobile shows "Continue on Desktop", how does it know which laptop to `codev://` deep-link to? Per-user Tower Cloud account? QR pairing? Shared workspace token?

## Decision

**No pairing subsystem. The Tower Cloud account IS the pairing; the handoff target is a URL, not a device.**

The three options in the question all assume mobile must address a *device*. It doesn't — it must address a *view*. Reframe:

1. **Primary handoff: a cloud URL.** "Continue on Desktop" produces `https://<cloud>/t/<towerId>/<view-path>` (the tunnel proxy path that already exists for browser access — see issue #655's `/t/{towerId}/...` reference). Any signed-in browser on any of the user's machines opens it. Share-sheet / copy-link semantics; no device registry needed.
2. **Progressive enhancement: `codev://` on top.** If the Codev IDE registered the `codev://` scheme on a desktop (that work lives in the external codev-ide repo now), the *desktop side* can claim those links. Mobile never needs to know whether the claim succeeded — it fires the same URL either way; the browser link is the universal fallback the interaction-model doc already specified.
3. **Devices-as-consequence, not devices-as-registry.** The per-device tokens from [[q2-auth-model]] give the cloud a device list for *revocation*; we do not build a "which laptop is mine" picker on top of it. If a user has three desktops, all three can open the link; whichever they're sitting at wins. That is the correct UX and it costs nothing.

## Why not QR pairing or shared workspace tokens

- **QR pairing** solves proximity bootstrap for *unauthenticated* devices (TV login pattern). Both ends here are already signed in to the same cloud account; QR adds a ceremony that authenticates nothing new. (QR *may* reappear later as a convenience for the initial app sign-in itself — that's Q2/first-run territory, not handoff.)
- **Shared workspace token** creates a second credential system parallel to the account, with all the revocation/rotation burden and none of the attribution. Rejected on the same grounds `ctk_`-on-phone was rejected in [[q2-auth-model]].

## v0 (LAN PoC) carve-out

No cloud in v0 → handoff button renders `http://<tower-lan-host>:4100/<view-path>` (dashboard URL). Works on the same LAN, which is the only place v0 works anyway. Handoff is therefore v0-includable at trivial cost, but only as "open the dashboard URL" — no `codev://`, no cloud links.

## Open remainder (deferred, small)

- Exact `<view-path>` grammar: mobile and web must agree on canonical view URLs (e.g. `/workspace/<ws>/builder/<id>?view=cmap`). This is a web-dashboard routing question first; mobile consumes whatever the dashboard canonicalizes. Coordinate with main when the dashboard routes stabilize.

## Related

- [[q2-auth-model]] — account anchor and device tokens.
- Issue #855 — `apps/web` rename lands the URL surface this leans on.
