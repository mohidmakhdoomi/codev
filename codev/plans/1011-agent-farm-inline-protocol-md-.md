# PIR Plan: Inline `protocol.md` into the builder prompt at spawn

## Understanding

Spec 618 correctly moved framework files (protocols, roles, resources) out of user
projects and into the embedded package skeleton, resolved at runtime via the four-tier
resolver (`.codev/` → `codev/` → cache → skeleton). The resolver works.

The remaining bug is **consumer-side**: every protocol's `builder-prompt.md` tells the
builder to read `codev/protocols/<name>/protocol.md` — a literal path that does not exist
on disk in a fresh post-618 install (the file lives only in the embedded skeleton, reachable
through the resolver but *not* through a raw `cat`). So a freshly-spawned builder runs the
`cat`, gets "No such file", and wastes 1–3 minutes hunting before proceeding without the
protocol meta-doc (workflow overview, gate semantics, when-to-use guidance).

The per-phase prompts (delivered via `porch next` JSON, resolver-mediated) already cover the
actionable per-phase work, so they are *not* affected. The gap is purely the one-time meta-doc.

Verified in this worktree:

- `codev-skeleton/protocols/*/builder-prompt.md` contain literal `codev/protocols/<name>/protocol.md`
  instructions — confirmed in all 10 protocol templates (e.g. `spir/builder-prompt.md:30`,
  `pir/builder-prompt.md:30` and `:90`).
- `loadBuilderPromptTemplate()` at `packages/codev/src/agent-farm/commands/spawn-roles.ts:99-108`
  loads `builder-prompt.md` via `resolveCodevFile()` but never reads `protocol.md`.
- `resolveCodevFile()` (`packages/codev/src/lib/skeleton.ts`) reaches the embedded skeleton
  correctly. The resolver is not the bug.

## Proposed Change

Extend `loadBuilderPromptTemplate()` to additionally resolve `protocols/<name>/protocol.md`
via `resolveCodevFile()` and append its full text to the returned template under a clearly
delimited heading. The builder then has the meta-doc in its initial prompt context for the
whole session — read once, never re-shipped per phase, and the builder never runs a shell
command that bypasses the resolver.

Concretely, after loading the `builder-prompt.md` template and before returning it:

```ts
let template = readFileSync(templatePath, 'utf-8');

const protocolDocPath = resolveCodevFile(
  `protocols/${protocolName}/protocol.md`,
  config.workspaceRoot,
);
if (protocolDocPath) {
  template +=
    `\n\n---\n\n## Protocol Reference (full text)\n\n` +
    readFileSync(protocolDocPath, 'utf-8');
} else {
  logger.debug(`No protocol.md found for ${protocolName}; spawning without inlined reference`);
}
return template;
```

### Locked plan-gate decisions

1. **Delimiter / heading.** Append after a horizontal rule under an H2:
   `\n\n---\n\n## Protocol Reference (full text)\n\n<contents>`. The `---` + distinct heading
   keeps the meta-doc visually separate from the per-phase instructions above it, so the two
   don't blur in the builder's context. (Matches the issue's proposed wording.)

2. **Missing `protocol.md` → silently skip, no error**, with a `logger.debug` note. This is
   safe because `validateProtocol()` runs *earlier* in the spawn flow and already `fatal()`s
   if **both** `protocol.json` and `protocol.md` are absent. So reaching `loadBuilderPromptTemplate`
   with a missing `protocol.md` implies `protocol.json` exists — a malformed-but-registered
   protocol, not a typo. Spawning without the inline (rather than aborting) is the right
   degradation. (Satisfies acceptance criterion #2.)

3. **Unconditional — no config flag.** The inline cost is ~90–660 lines of markdown delivered
   once at spawn; there is no scenario where a user wants the builder to *not* have its own
   protocol doc. A flag would be dead configuration.

### Where the inline happens relative to `renderTemplate()`

`buildPromptFromTemplate()` passes the returned template through `renderTemplate()`, which does
handlebars substitution, collapses `\n{3,}` → `\n\n`, and trims. Inlining inside
`loadBuilderPromptTemplate()` (per the issue and acceptance criterion #1) means the appended
`protocol.md` also passes through `renderTemplate()`. This is **verified safe today**: a grep
confirms **zero `{{` occurrences across all 8 skeleton `protocol.md` files**, so the substitution
pass is a no-op on the appended text. The only transformation is the newline-collapse, which is
harmless for markdown (single blank lines between blocks are preserved). See Risks for the
forward-looking consideration.

## Files to Change

- `packages/codev/src/agent-farm/commands/spawn-roles.ts:99-108` — extend
  `loadBuilderPromptTemplate()` to resolve and append `protocol.md` under the
  `## Protocol Reference (full text)` delimiter; `logger.debug` when absent. (~12 LOC.)
- `packages/codev/src/agent-farm/__tests__/spawn-roles.test.ts` — in the skeleton-fallback
  `describe` block (which already builds a temp skeleton with `spir/builder-prompt.md`), add a
  `protocol.md` to the temp skeleton and assert that `buildPromptFromTemplate(...)` output
  contains both the rendered template text **and** the `## Protocol Reference (full text)`
  heading plus the protocol.md body. Add a second assertion: when no `protocol.md` exists in
  the skeleton, the prompt still builds and simply omits the reference section (covers criterion
  #2). (~25 LOC of test.)

No changes to: the resolver, porch, any CLI surface, per-phase prompts, or the
`builder-prompt.md` templates themselves (the literal `cat` instruction can stay — the inlined
copy makes it redundant rather than wrong, and rewriting 10 templates is out of scope per the
issue).

## Risks & Alternatives Considered

- **Risk: a future `protocol.md` containing `{{...}}`** (e.g. a protocol doc that documents the
  prompt-templating syntax) would be mangled by `renderTemplate()`.
  *Mitigation / chosen position:* none of the 8 current docs contain handlebars (verified), and
  this is a documented invariant. If a protocol doc ever needs literal `{{`, the one-line fix is
  to move the append from `loadBuilderPromptTemplate()` (pre-render) into
  `buildPromptFromTemplate()` (post-render), delivering `protocol.md` verbatim. I am *not* doing
  that now to keep the change minimal and matching acceptance criterion #1, but flagging it as
  the known escape hatch.
- **Alternative: append post-render in `buildPromptFromTemplate()`.** More future-proof against
  the handlebars risk, but spreads the prompt-assembly logic across two functions and diverges
  from the issue's stated design (criterion #1 names `loadBuilderPromptTemplate`). Rejected as
  premature; the escape hatch above covers it if ever needed.
- **Risk: prompt bloat.** SPIR's `protocol.md` is 657 lines (~2K tokens). Delivered once at
  spawn, not per phase — acceptable, and far cheaper than the per-phase re-injection the issue
  explicitly rejected.
- **Alternative: restore framework file copying on init/update** (the #738 "Option 2"). Out of
  scope by the issue's own framing; reverses Spec 618. Not considered here.

## Test Plan

**Unit (automated, runs in `npm test` → `@cluesmith/codev`):**

- New test in `spawn-roles.test.ts` skeleton-fallback block: temp skeleton gets a
  `spir/protocol.md` with sentinel content; assert `buildPromptFromTemplate()` output contains
  the rendered template, the `## Protocol Reference (full text)` heading, and the sentinel.
- New test: temp skeleton with **no** `spir/protocol.md`; assert the prompt builds without error
  and does **not** contain the `## Protocol Reference` heading (covers criterion #2).
- All existing `spawn-roles.test.ts` cases continue to pass unchanged.

**Build / typecheck:** `npm run build` from the worktree root (routes to
`pnpm --filter @cluesmith/codev build`).

**Manual (for the human at the `dev-approval` gate):**

- Inspect the generated prompt directly. Quickest path: run the new unit test and read the
  asserted output, or add a throwaway `console.log` of `buildPromptFromTemplate(...)` for a
  protocol and confirm the protocol meta-doc is appended under the delimiter.
- Optional end-to-end: in a scratch `codev init` project (no local `codev/protocols/`), spawn a
  builder and confirm its initial prompt contains the protocol meta-doc — i.e. the builder no
  longer needs to `cat` a non-existent file. (This is the symptom the fix exists for.)

Note: `.codev/config.json` here has no `worktree.devCommand`, so `afx dev` is not applicable —
this is a spawn-time prompt-assembly change, not a running-app change. The `dev-approval` review
is "read the diff + run the unit test", which is appropriate for this class of change.
