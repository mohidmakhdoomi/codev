# Decision note — Q7: Notification permission on first launch

**Status**: Proposed (needs main's ratification; implementation is Phase 2 / cloud-gated)
**Date**: 2026-07-07
**Question** (interaction-model §9.7): How and when do we ask for notification permission? First-run flow?

## Decision

**Never on first launch. Ask at the first moment a notification would have helped, with a pre-permission explainer card.**

1. **First run** (Phase 2 cloud build): sign in → pick workspace → land in the inbox/feed. Zero permission prompts. The app is fully usable pull-based (open it, look), so nothing is blocked.
2. **Trigger point**: the first time a `needs-you` event exists (a gate goes pending, or a question fires) while the user has the app open, show an in-app card: *"A gate just hit. Want a push next time so you don't have to check? [Enable notifications] [Not now]"* — tapping Enable fires the OS prompt. This is the classic pre-permission pattern: the OS prompt appears only after an in-context yes, so acceptance is near-certain and an OS-level "Don't Allow" (which iOS makes expensive to reverse) is rarely burned on a cold ask.
3. **"Not now"** is remembered and re-offered sparingly (next trigger ≥ a few days later), plus a permanent switch in settings.
4. **Provisional notifications on iOS** (deliver-quietly, no prompt) are NOT used in v1: quiet delivery to the notification center defeats the whole needs-you value (time-sensitive interruption), and juggling provisional→full upgrade flows adds states for no win. Revisit only if prompt-acceptance data disappoints.
5. **Defaults on grant**: exactly the [[q4-push-controls]] defaults — `needs-you` on, informational off, all architects on. The permission prompt is never a settings wizard.

## v0 note

The LAN PoC has no push at all, so this whole flow is Phase 2. It's decided now because the first-run experience shapes the Phase 1 → Phase 2 upgrade path (Phase 1 users must not be prompted on update; the trigger-point rule handles that automatically).

## Related

- [[q4-push-controls]], [[q2-auth-model]] (sign-in precedes any permission ask).
