# Spec 778 — Iteration-2 Rebuttals (Approach-B spec)

**Verdicts:** Codex REQUEST_CHANGES · Gemini COMMENT · Claude REQUEST_CHANGES
**Disposition:** All substantive points **accepted and addressed**. No point rejected. Several were
*convergent* (the three reviewers reinforced each other), and Gemini supplied the concrete mechanism
that resolves Codex's main ask. Code claims were re-verified against the tree before encoding them.

---

## Unanimous must-fix

### Stale "lane uses the Pro model class" in Desired State (Codex, Gemini, Claude). ✅ FIXED
When I applied the architect's "don't pin Pro" decision, I updated the directive, the verified-contract
bullet, open questions, success criteria, risks, tests, and notes — but **missed the Desired State
bullet**, which still said "uses the Pro model class." Corrected to "uses `agy`'s default model (no
pinning; currently Gemini 3.5 Flash)". Good catch; this was a real inconsistency.

---

## Claude (REQUEST_CHANGES)

### C1 — Model identifier must be stated to stay `gemini`. ✅ FIXED
Added explicitly (Desired State + Iteration-2 Decisions): the identifier stays `gemini` across
`MODEL_CONFIGS`, `VALID_MODELS`, `protocol-schema.json` enum, default lists, user config, and the
`pro` alias — only the backend changes; no rename to `agy`/`antigravity`.

### C2 — `extractReviewText` gemini branch does `JSON.parse` → throws on agy plain text. ✅ ADDRESSED
Verified (`usage-extractor.ts`: `if (model==='gemini'){ JSON.parse(output)…return parsed.response }`).
Iteration-2 Decisions now require adapting that branch to **return the raw output** for the agy
backend; usage extraction returns null → cost rows degrade gracefully.

### C3 — `hermes` precedent. ✅ ADDED
Verified (`index.ts:39,651-668,1587`): hermes is a CLI model with `envVar:null`, role folded into the
prompt, temp-file when prompt > 100k chars, plain-text output. Spec now points the builder at this as
the working template (also resolves the E2BIG concern below).

### C4 — `pro` alias semantics. ✅ DECIDED
Keep as-is (historical name; resolves to the `gemini`/agy lane). No rename, no deprecation warning —
leanest, per the architect's "keep it lean."

### C5 — `harness.ts` `GEMINI_HARNESS` distinct/untouched. ✅ CLARIFIED
Iteration-2 Decisions explicitly state it's untouched and a separate concern from the consult
`MODEL_CONFIGS.gemini` lane.

### C6 — Timeout interaction (agy `--print-timeout` vs Codev's own kill). ✅ DECIDED
Codev manages its **own** timeout and SIGTERMs the child if `agy` hangs past it; does not rely solely
on `--print-timeout`. Exact values are a Plan detail.

### C7 — Binary verification criteria. ✅ ADDRESSED (see Codex CX4 below).

---

## Codex (REQUEST_CHANGES)

### CX1 — Stale Pro contradiction. ✅ FIXED (see unanimous, above).

### CX2 — Non-blocking skip under-specified at the observable-contract level. ✅ RESOLVED
Adopted the concrete mechanism (Gemini supplied it): the lane emits **`VERDICT: COMMENT` /
`SUMMARY: Skipped (...)`** when `agy` is unavailable. Verified `verdict.ts:42,54-59` — `COMMENT` is
parsed and `allApprove` treats it as non-blocking, while a *missing* verdict defaults to
`REQUEST_CHANGES` (blocks). So the explicit `COMMENT` is mandatory and now specified, not deferred.

### CX3 — Require a porch-orchestrated progression test. ✅ ADDED
New test scenario 2b: an actual porch SPIR run with `agy` missing/unauthed must show **phase
progression continues** (not just a unit test of the skip).

### CX4 — Binary-resolution rejection rule. ✅ ADDED
Iteration-2 Decisions: prefer `~/.local/bin/agy`; else a PATH lookup **verified** to be the real
headless CLI (responds to `--print`/`--version` as the CLI, not the IDE Electron launcher); if none
is valid (missing or only the IDE stub/symlink), treat the lane as **unavailable → `COMMENT` skip
with guidance** — never launch the IDE.

---

## Gemini (COMMENT — non-blocking)

### G1 — Stale Pro contradiction. ✅ FIXED (unanimous).

### G2 — `E2BIG` / large-prompt mitigation. ✅ ADDRESSED
Follow the `hermes` temp-file pattern (prompt > 100k chars → temp file); and `buildPRQuery` already
writes the diff to a temp file the reviewer reads, so large content stays file-referenced. Captured in
Iteration-2 Decisions; prompt-delivery specifics (positional vs stdin) confirmed as a Plan check.

### G3 — Auth hangs ~30s. ✅ ADDED
Wrapper streams stdout/stderr and **terminates the child early when the OAuth URL is detected**,
emitting the `COMMENT` skip — so an unauthed lane skips fast instead of blocking the run.

### G4 — Concrete non-blocking skip via `COMMENT`. ✅ ADOPTED
This is the mechanism now specified (see CX2). Thanks to Gemini for the grounded, minimal approach.

---

## Net change summary
The one real defect (stale Pro line) is fixed. The skip contract is now concrete (`COMMENT` verdict)
rather than deferred, with a fast auth-skip and a binary-rejection rule. Output handling
(`extractReviewText`), timeout ownership, the `hermes` template, the `pro`-alias call, and the
`harness.ts` distinction are all pinned down. All changes preserve the architect's constraints
(agentic file-reading, subscription/OAuth, default model = Flash, lean scope). No open question
remains that blocks implementation; the residual items are Plan-level value choices (timeout numbers,
prompt-delivery confirmation).
