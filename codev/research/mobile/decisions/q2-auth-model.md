# Decision note — Q2: Mobile auth model

**Status**: Proposed (needs main's ratification before any implementation)
**Date**: 2026-07-07
**Question** (interaction-model §9.2): How does mobile authenticate to Tower Cloud? Same identity as the CLI? Separate token per device?

## Ground truth (verified against repo, 2026-07-07)

- The cloud relay exists in code today: `afx tower connect` (`packages/codev/src/agent-farm/commands/tower-cloud.ts`) registers the tower with `cloud.codevos.ai` and stores `~/.agent-farm/cloud-config.json` (`tower_id`, `ctk_...` api key, `server_url`, perms 0600).
- The `ctk_` key authenticates **tower → cloud**, not user → tower. There is no user→tower credential anywhere in the system.
- Tower's own HTTP surface is unauthenticated by design (`server-utils.ts` `isRequestAllowed` returns true); the perimeter (localhost bind, or the cloud edge) is the security boundary.
- Issue #655 (cloud messaging) already anticipates this question: "Could reuse the existing `ctk_` tower keys, or introduce separate…" — it must NOT reuse `ctk_`.

## Decision

**Per-device mobile tokens, issued by Tower Cloud, distinct from `ctk_` tower keys. The user's cloud account is the identity anchor; devices are revocable children of it.**

Concretely:

1. **Identity**: the user's Tower Cloud account (the same one that authorizes `afx tower connect` in the browser today). Mobile does not get a separate identity; it gets a separate *credential*.
2. **Credential**: a device-scoped refresh token (`cmd_` prefix proposed, "codev mobile device") issued via OAuth-style sign-in in the app. Short-lived access tokens derived from it. Never a `ctk_` key on a phone: `ctk_` grants tower-level control with no user attribution and no per-device revocation.
3. **Storage**: platform secure store (Keychain / Keystore via expo-secure-store). Biometric gate on foreground.
4. **Revocation**: per-device list in the cloud account UI. Lost phone = revoke one row, desktop and other devices unaffected.
5. **Attribution**: every cloud→tunnel→tower request carries the device/user principal so Tower's (future) audit log can record it. This aligns with the two in-tower mitigations already identified in the May-2026 security review: make `isRequestAllowed` a real check using an edge-propagated session token, and add an audit log for state-changing endpoints.

## Why not "same identity as the CLI"

The CLI has no user identity — it has a *tower* credential. Reusing it would mean: no per-device revocation, no user attribution, and a stolen phone equals a stolen tower. The question as posed in §9 embeds a false premise; the refresh doc should correct it.

## v0 (LAN PoC) carve-out

For the local-Tower LAN PoC, there is no cloud and therefore no auth issuer. v0 connects directly to `http://<lan-ip>:4100` and inherits Tower's existing perimeter model (same trust as the web dashboard on the LAN — requires deliberate non-localhost bind, which already warns). This is acceptable for a developer PoC and explicitly unacceptable for anything shipped. The scope-lock issue must state this in writing so PoC convenience doesn't become shipped policy.

## Dependencies / sequencing

- Hard prerequisite for shipped mobile: close the in-tower auth gap (`isRequestAllowed` returning `true` unconditionally) — Tower must verify the edge-propagated principal, not trust the tunnel unconditionally. The full gap analysis is in `feasibility-2026-07.md` §5.
- Coordinate with #655 (cloud messaging), which needs the same user-level (not tower-level) auth story.

## Related

- [[q1-pairing-model]] — pairing rides on the same account anchor.
- Tower Cloud security review (2026-05-26; local research note, unpublished) §4–6 — findings restated with code citations in `feasibility-2026-07.md` §5.
