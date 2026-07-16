# Codev Mobile: Feasibility and Use-Case Strategy — July 2026 Refresh

**Date:** 2026-07-07
**Supersedes:** the May-2026 feasibility snapshot (2026-05-26; a local pre-implementation exploration, not committed to the repo). This refresh is self-contained; the May doc is not required reading.
**Companion:** `codev/research/mobile/interaction-model.md` (the interaction design), `codev/research/mobile/decisions/` (design-decision notes for the open questions).
**Audience:** Strategy / product planning, plus enough repo ground truth to sequence spikes. ~2,200 commits landed between the May snapshot and this refresh; every repo claim below was re-verified on 2026-07-07.

---

## 0. TL;DR

- **Technical feasibility remains high and is now better evidenced.** The cloud-relay tunnel is real, working code (HTTP/2 role-reversal over WSS to codevos.ai). The dashboard's data layer audit shows ~70-75% is portable to React Native, and all wire contracts already live in `@cluesmith/codev-types`. React Native + Expo remains the stack call.
- **The honest constraint is still scope, not engineering — but the sequencing insight has sharpened.** A LAN-only PoC (local Tower, no cloud, no push) proves the interaction model in weeks, not months. Everything cloud-dependent (push, per-device auth, offline questions, desktop handoff at distance) is a separate workstream gated on Tower Cloud maturing.
- **The defining use case is unchanged**: run your AI dev team during the 30-second attention windows of your day. Approval inbox, glanceable status, structured question-answering. Replicating the desktop UI on a smaller screen remains the failure mode.
- **The terminal-substrate/interface split stands**: the PTY remains the source of truth; mobile renders projections (chat bubbles, feed rows, decision cards) with the raw terminal one tap away. New ground truth strengthens this: Tower today does *zero* PTY content parsing, so the projection layer is genuinely new plumbing — and it benefits web and VS Code equally, which changes who should design it (main, not mobile alone).
- **The security posture is unchanged and the warning stands**: `isRequestAllowed` still returns `true` unconditionally; there is no in-tower defense in depth. Closing this gap remains a hard prerequisite for any credential living on a phone. Verified current, not just a May snapshot.
- **Recommended path (updated 2026-07-16):** spike-driven LAN PoC. The `apps/mobile` scaffold + LAN reachability spike is complete and green (`spikes/expo-lan-reachability-2026-07.md`); feed/chat/question flows against a LAN Tower come next. The shared client layer arrives via the `codev-sdk` split (#1189), not a dashboard extraction. Cloud/push stays a separately-specced phase coordinated with issue #655. Do not let mobile silently become "build Tower Cloud."

---

## 1. Current state baseline (re-verified 2026-07-07)

- **Tower** runs locally (`127.0.0.1:4100` default; `BRIDGE_MODE=1` opt-in for LAN binding, with startup warning). Plain Node `http.Server` + `ws`, ~30 HTTP routes, three WS routes.
- **Cloud relay exists in code**: `afx tower connect` (`packages/codev/src/agent-farm/commands/tower-cloud.ts`) registers with `cloud.codevos.ai`; the Tower daemon dials an outbound WSS tunnel and serves HTTP/2 over it (`lib/tunnel-client.ts`, `servers/tower-tunnel.ts`). `ctk_` keys authenticate tower→cloud. Browser access via the tunnel proxy (`/t/{towerId}/...`).
- **Web dashboard** (`@cluesmith/codev-dashboard`) is the browser surface; it is what mobile users reach for today. Data layer: plain React hooks, polling + SSE-triggered refetch of the `GET /api/overview` snapshot; typed contracts all in `@cluesmith/codev-types`.
- **VS Code extension** is the polished desktop UX.
- **No native mobile client.**

The implication stands from May: a mobile app is not bridging a connectivity gap. It must be meaningfully better than "the web UI on your phone" — via native pickers, push (eventually), and a feed built for glancing — or it has no reason to exist.

## 2. What changed since May (staleness audit)

Six weeks of platform evolution that the May doc predates, each with a mobile consequence:

| Change | What it is | Mobile consequence |
|---|---|---|
| **Multi-architect workspaces** (Spec 755, #786, #826) | A workspace hosts named sibling architects (`main`, `mobile`, `reviewer`…); `afx send architect:<name>`; spoofing check on builder senders | The May doc's mental model of "the architect" is stale. Feed, chat targets, and notification scoping are all **per-architect**. The mobile chat UI needs an architect switcher, not a single thread |
| **global.db consolidation** (#1118/#1127) | Per-workspace `state.db` retired; single `~/.agent-farm/global.db`, composite-keyed `(workspace_path, id)` tables, `spawned_by_architect` column | One DB serving all workspaces makes multi-workspace mobile UX (decisions/q5) natural server-side; `pending_question` persistence has an established home and migration path |
| **Sibling-architect messaging** | Architects message each other; the message bus carries these frames | The feed should render architect↔architect traffic (e.g. `mobile → main: scope-lock ready`) — a feed row type the May doc never anticipated |
| **artifact-canvas + review-comment codec** (spec 945, #1055, #1029) | Shared markdown + inline-review-comment rendering package for DOM hosts; native split explicitly deferred (#1029) until native rendering is committed | The "review comments as inline speech bubbles" pattern now has a reference implementation. Mobile's rendering spike decides RN-native vs WebView-hosted artifact-canvas, and feeds #1029 |
| **Runnable worktrees / `afx dev`** | Builders' worktrees can run dev servers; single-slot dev PTY | Marginal for mobile v0; a "dev server running" feed row is a nice-to-have |
| **IDE workstream externalized** | Codev IDE fork moved to `amrmelsayed/codev-ide` | `codev://` deep-link registration is now an *external* dependency; handoff design (decisions/q1) deliberately makes it optional enhancement, browser-URL fallback primary |
| **PIR protocol matured; Stream Deck integration shipped** | More gate-heavy protocols in daily use (`plan-approval`, `dev-approval`, `pr`); a physical-button approval surface exists in the sibling codev-integrations repo | Confirms the approval-inbox thesis with usage evidence: gates are the highest-frequency human touchpoint. Stream Deck is the desk-bound cousin of the mobile approval card; a Tower-side gate-approval endpoint (interaction-model §8.5) serves both |

**What did NOT change:** the security gaps (§5 below) — re-verified, all four still present. The tunnel architecture. The types-first contract discipline (strengthened, if anything: the dashboard defines zero wire types of its own).

## 3. Technical feasibility — React Native + Expo (unchanged call, sharper evidence)

The May analysis of RN vs PWA vs Capacitor vs native vs Flutter stands; nothing in six weeks moved it. RN + Expo (managed workflow, EAS) remains the recommendation. Three updates:

1. **The code-sharing story is now concrete.** The client data layer was audited (2026-07-07; the findings now drive the `codev-sdk` design in #1189, which superseded the tower-sdk extraction idea — see `interaction-model.md` §7.2): the dashboard's data layer is plain React hooks (no Redux/React Query/Zustand), snapshot-polling + SSE-refetch, with **all wire contracts in `@cluesmith/codev-types`**. ~70-75% ports as-is. The three knots are all transport/glue, not business logic: (a) workspace identity implied by browser URL (`getApiBase() = './'`, reverse-proxy prefix) — SDK must take explicit `baseUrl` + `workspacePath`; (b) the module-global `EventSource` singleton with `document.visibilitychange` lifecycle — needs an injected transport + RN `AppState`; (c) three divergent auth/storage paths (browser `localStorage`, Node `~/.agent-farm/local-key`, and nothing for RN) — needs injected `getToken()`/storage interfaces.
2. **Terminal rendering is settled by decision, not by WebView benchmarking.** v0 ships a read-only monospace snapshot (the `/ws/terminal/:id` byte bridge exists; rendering read-only is a client choice) and no interactive terminal. The May doc's §5.5 substrate-vs-interface argument is preserved in `interaction-model.md` §2/§5 as the design principle.
3. **Markdown/code rendering has a fork in it** (#1029): RN-native markdown vs WebView-hosted artifact-canvas. Spike question, not a blocker.

## 4. Architecture implications (updated)

### 4.1 The three-layer split is the whole game

- `apps/mobile` (Expo/RN, view layer) — new
- `packages/codev-sdk` (#1189) — the single Tower client implementation (API + WS/message-bus, injected transport/auth, framework-free); consumed by `apps/web`, `apps/vscode`, the CLI's Tower-facing commands, and mobile. Replaces the earlier tower-sdk extraction idea (see `interaction-model.md` §7.2 for the supersession rationale)
- Tower plumbing (structured events, question detection, gate-approval endpoint) — new, **shared with web**, designed with main

Issue #855 (`apps/*` split) **merged 2026-07-16** (PR #1188): `apps/web` and `apps/vscode` exist; `apps/mobile` lands fresh into the established layout.

### 4.2 Backend changes — reframed by what exists

The May doc's backend list assumed more cloud than exists. Reframed:

**Tower-side (local, benefits all surfaces, v0-relevant):**
- Structured event emission (question_pending/question_resolved at minimum; activity events eventually). Tower currently does zero PTY content inspection — detection mechanism (PTY parsing vs harness-hook emission) is itself a spike question.
- Gate approve/reject HTTP endpoint preserving human-only semantics (today porch-CLI-only).
- Overview/state already rich enough for the v0 feed (OverviewBuilder carries phase, gates, blocked, prReady, spawnedByArchitect).

**Cloud-side (v1+, gates shipped mobile, coordinate with #655):**
- User-level identity + per-device mobile tokens (decisions/q2) — distinct from `ctk_` tower keys.
- Push infrastructure (APNs/FCM registration, event→push wiring, per-type/per-architect controls — decisions/q4).
- In-tower verification of edge-propagated principals (closing §5's gap) + audit logging.

### 4.3 What mobile must NOT become

The scope trap, named plainly: push, auth, offline questions, and handoff-at-distance are all Tower Cloud features. If mobile's critical path runs through all of them, mobile *is* the Tower Cloud project wearing a costume. The v0 scope-lock exists precisely to sever that: LAN PoC proves interaction value with zero cloud dependency; cloud work proceeds on its own track with its own spec (#655 is the seed).

## 5. Security (re-verified 2026-07-07 — unchanged, warning stands)

All four gaps identified in the May-2026 Tower Cloud security review (a local research note, unpublished; its findings are restated here with code citations so this doc stands alone) remain current:

1. `isRequestAllowed` (`packages/codev/src/agent-farm/utils/server-utils.ts`) returns `true` unconditionally — zero in-tower auth.
2. Admitted requests reach the full control plane (`/api/launch`, `/api/send`, `/api/stop`, terminal WS attach).
3. CORS allows any `https://` origin.
4. No audit logging of state-changing operations.

Consequences for mobile, restated as decisions:
- **v0 (LAN PoC)** inherits the existing perimeter model — same trust as the LAN dashboard, acceptable for a developer PoC, stated in writing in the scope-lock as unacceptable to ship.
- **Shipped mobile** hard-requires: in-tower principal verification, per-device tokens (decisions/q2), audit trail with device attribution. Non-negotiable, unchanged from May.

## 6. Core use cases and feature tiers (carried forward, trimmed to what survives contact with ground truth)

The May doc's four narrative use-case flows (8am decision sweep, commute spec, car update, cafe conflict resolution) and its tiered feature inventory remain the north star; they are not re-litigated here. What ground truth changes:

- **The approval inbox is even more central than May thought.** PIR's three human gates are now the daily-driver protocol shape, and the Stream Deck integration is independent evidence that fast gate approval is the highest-frequency human loop. Tier 1 = approval inbox + feed + chat + question cards. Unchanged.
- **AI-summarized cards move from "backend feature" to "open design question."** May assumed server-side summaries; there is no summarization infrastructure in Tower and none planned. v0 renders what exists (gate names, issue titles, PR metadata from overview). Summarization is v1+, unspecced.
- **Voice, Watch, CarPlay, widgets, Live Activities**: all still Tier 2/3, all cloud-and-after. Nothing new.
- **The single sharpest claim stands**: *a first-class Codev mobile app turns "managing your AI dev team" into something you can do during the time it takes to drink a coffee.* Every scope decision tests against it.

## 7. Anti-patterns (carried forward verbatim in spirit)

1. Do not port the desktop UI screen-for-screen.
2. Do not make the raw terminal the default rendering (keep it one tap away).
3. Do not optimize for long-form editing.
4. Do not duplicate VS Code extension features.
5. Do not require API-key copy-paste (mobile auth is account + biometric; see decisions/q2).
6. Do not ship before the in-tower auth gap is closed.
7. Do not over-notify (defaults in decisions/q4).
8. Do not build a chat interface that tries to replace the architect — mobile is a remote control, not a duplicate brain.
9. **New:** do not design Tower's structured-event/question plumbing mobile-shaped — it serves web and VS Code equally, and its design belongs with main.

## 8. Phasing (updated for the spike-first reality)

**Phase S — spikes (LAN-only, no shipped code).** Status as of 2026-07-16: ~~tower-sdk extraction~~ (retired; replaced by the #1189 codev-sdk split, which is scheduled implementation work, not a spike); **apps/mobile Expo scaffold + LAN reachability — DONE, green** (`spikes/expo-lan-reachability-2026-07.md`; device-verification half pending a BRIDGE_MODE Tower session). Remaining, in order: AskUserQuestion detection design (with main); RN real-time feed; chat/card rendering (RN-native vs WebView artifact-canvas, feeds #1029); native diff viewer eval; push wiring sandbox (APNs/FCM feasibility only). Output: research notes in `codev/research/mobile/spikes/`.

**Phase 1 — LAN PoC** (PIR specs, real implementation): feed + chat + question cards + gate approval against a LAN Tower. Cold-tester round (3 testers, timed tasks) mirroring the IDE PoC pattern. #855 merged 2026-07-16, so `apps/mobile` has its home.

**Phase 2 — cloud-connected mobile**: per-device auth, push, offline semantics, handoff at distance. Gated on Tower Cloud work (its own spec; seeded by #655 and the security-profile mitigations). This phase's timeline is owned by the cloud workstream, not mobile.

**Phase 3 — differentiation**: voice, Watch, widgets, summaries. Unchanged from May Tier 2/3; unscheduled.

The May doc's calendar estimates (12-16 weeks MVP, 9-12 months first-class, ~35 person-months) assumed a staffed human team and predate agent-farm delivery capacity; they are retired rather than revised. Sequencing above replaces them; re-estimate after the first three spikes land.

## 9. Strategic open questions — status update

Of the May doc's seven strategic questions:

1. **Primary persona** — still open, but the de-facto answer for v0 is "the solo Codev power user" (i.e., dogfooding). Formal persona decision deferred to Phase 2 when pricing/packaging matter.
2. **Pricing** — deferred to commercialization strategy; not a v0 concern.
3. **Single-user vs team** — v0 is single-user by construction (LAN, own Tower).
4. **Self-host story** — the `--service <url>` override already exists in `afx tower connect`; mobile should honor arbitrary cloud URLs from day one of Phase 2. Affirmed.
5. **Store distribution** — Phase 2 concern; v0 is Expo dev builds.
6. **iOS-first vs simultaneous** — RN keeps both open; v0 PoC targets whatever device is on the desk (pragmatically iOS); no store commitment implied.
7. **Separate codebase vs shared with web** — **decided**: separate view layers; sharing happens through `codev-types` (contracts) and `codev-sdk` (#1189, the single Tower client). See `interaction-model.md` §7.

The seven *interaction-design* open questions from the interaction-model draft are separately answered in `codev/research/mobile/decisions/` (q1–q7).

## 10. References

- `codev/research/mobile/interaction-model.md` — the interaction design (refreshed same day)
- `codev/research/mobile/decisions/q1..q7` — design-decision notes
- Tower Cloud security review (2026-05-26; local research note, unpublished) — tunnel mechanics + threat model. Its load-bearing findings are restated with code citations in §5, so it is background, not a dependency
- Commercialization strategy (2026-05-21; local research note, unpublished) — Tower Cloud revenue frame
- Issues: #855 (apps/* split), #655 (cloud messaging), #1029 (artifact-canvas native split deferral), #1118/#1127 (global.db)
- Historical: the May-2026 feasibility snapshot this refresh supersedes (local pre-implementation exploration, not committed)
