# Phase 3 — iter-1 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers**: Gemini (APPROVE), Codex (REQUEST_CHANGES), Claude (APPROVE)

---

## Summary

Codex caught two real corrections — both addressed. Gemini and Claude both APPROVE'd cleanly. No findings rejected.

---

## Gemini (APPROVE) — clean

All five files contain the required content with the required addressing forms, spoofing-check constraint, and thread-file references. No findings.

---

## Codex (REQUEST_CHANGES) — both findings addressed

### C-P3.1-1. `agent-farm.md` `afx send architect` main-fallback inaccuracy

**Finding**: `codev/resources/commands/agent-farm.md` line 332 said non-builder `afx send architect` routes to `main`. The actual code at `tower-messages.ts:281-348` falls back to the first registered architect when `main` is absent. The repo-root `CLAUDE.md` and `AGENTS.md` already described this correctly; `agent-farm.md` was the outlier.

**Verification**: Confirmed by re-reading the tower-messages.ts routing logic. The resolver returns `entry.architects.get(DEFAULT_ARCHITECT_NAME) ?? entry.architects.values().next().value!` — `main` first, then the first registered architect as a fallback.

**Resolution**: Updated agent-farm.md `Named target` bullet to read: "routes to the architect named `main` if present, else the first registered architect."

**Where**: `codev/resources/commands/agent-farm.md` — `Arguments` block (the `Named target: architect` bullet).

### C-P3.1-2. Missing explicit `ls codev/state/` post-merge discovery command

**Finding**: The "Discovering active agents" sections in all five files mentioned that merged threads land in `codev/state/` on `main` but did not give an explicit `ls codev/state/` command alongside the in-flight `ls .builders/*/codev/state/*.md`. The plan/spec called for both discovery paths to be spelled out.

**Verification**: Conceded — the original wording was implicit. A reader needs both discovery commands to fully exercise the discovery story.

**Resolution**: Rewrote the post-merge sentence across all five files. Now reads (with adopter-friendly variant in skeleton templates):

> **In-flight discovery**: `ls .builders/*/codev/state/*.md` and `cat .builders/<id>/codev/state/<id>_thread.md`. **Post-merge discovery**: after a builder's PR merges, its thread lands in `codev/state/` on `main`, alongside `codev/reviews/` — list with `ls codev/state/` and read with `cat codev/state/<builder-id>_thread.md` from the main checkout.

Both discovery paths are now explicit commands. Skeleton templates use a slightly tighter variant without the `codev/reviews/` parenthetical (adopter context).

**Where**: All five files (`CLAUDE.md`, `AGENTS.md`, `codev/resources/commands/agent-farm.md`, `codev-skeleton/templates/CLAUDE.md`, `codev-skeleton/templates/AGENTS.md`).

`copy-skeleton` verified: both shipped templates at `packages/codev/skeleton/templates/CLAUDE.md` and `packages/codev/skeleton/templates/AGENTS.md` carry the updated content.

---

## Claude (APPROVE) — clean

All acceptance criteria pass. No findings.

---

## Net Phase 3 change summary (iter-1)

- **1 inaccuracy fix** (agent-farm.md main-fallback).
- **5-file wording sharpened** (explicit `ls codev/state/` post-merge command).
- **No findings rejected.** No disagreements.

## Iter-2 readiness

Phase 3 is ready for iter-2 if porch triggers one. Both Codex findings addressed. Gemini and Claude were already APPROVE.
