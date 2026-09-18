# Contributing

## You do not need Tandoor running

Every test runs against an injected `fetch` and recorded fixtures. CI never
touches a live instance, and neither do you for normal development:

```bash
npm install
npm test
```

A maintainer with a real Tandoor instance refreshes the recorded fixtures
with `npm run capture` — see below.

## The three gates

CI runs exactly what you can run locally. Please make all three pass before
opening a PR:

```bash
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

## If you are working with a coding agent

Welcome, and held to the same bar — not a lower one, and not a higher one.
tandoor-mcp is itself built with one. A patch is judged by whether it holds
up, so there is no separate review track and nothing to disclose beyond
being straight about what was actually verified.

This file is written to be read by an agent, and everything in it applies.
Four rules matter more than the rest, because breaking them produces a pull
request that *looks* finished:

- **Never write a fixture by hand.** Asked for one, an agent will produce
  something plausible — and a plausible fixture is worse than no fixture at
  all, because the test passes, the tool ships, and the shape was never
  Tandoor's. Capture with `npm run capture` against a live instance, or say
  in the PR that the fixture is missing.
- **Run the three gates and paste what they printed.** "Should pass" is not
  a result, and CI runs exactly what you can run locally, so there is
  nothing to guess about.
- **Say what a *human* exercised.** An agent cannot run your Tandoor. A tool
  that has never touched a live instance is still worth opening; one
  described as tested when nobody tested it is not, because the maintainer
  cannot check that claim without a Tandoor instance of their own.
- **A typecheck failure against generated types is the codegen doing its
  job.** Fix the mapper; do not widen it with a cast. This is the failure
  most likely to get papered over, and the cast survives long after the
  reason for it is forgotten.

## Dependencies

Dependabot runs monthly, plus immediate PRs for security advisories. Three
ecosystems are watched — `npm`, `github-actions`, and the Docker base image
— with non-major updates grouped into one PR per ecosystem per month.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/).

| Prefix | Effect on version |
| --- | --- |
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or a `BREAKING CHANGE:` footer | **major** |
| `chore:`, `docs:`, `ci:`, `test:`, `refactor:` | none |

**What counts as breaking**, which is the part worth writing down:

- A tool renamed or removed
- A tool parameter renamed or removed
- A field removed from a tool's structured output

Adding a tool, an optional parameter, or an additive output field is a
**minor** — those are additive and nothing that reads the old shape stops
working.

## The tool surface is the public API

The 14 tools registered in `src/tools/register.ts` are the public API.
Renaming a tool or removing a parameter breaks every user's saved prompts
and agent configuration, and it breaks **silently** — the model stops
finding the tool rather than raising an error.

Extend an existing tool before adding a fifteenth. If a new tool genuinely
does not fit any of the 14, say why in the PR description.

## If your tool returns free text

Any field Tandoor returns as free text must be passed through `fenceText`
(`src/core/fence.ts`) before it reaches a tool's text or structured output.
Fields that already need it: recipe `description`, step `instruction`,
shopping-list `note`, meal-plan `note`, and cook-log `comment`. A new field
that carries user-authored text gets checked against that list, not assumed
safe.

## Adding a write tool

Write tools are **not** registered like read tools. Use `registerWriteTool`
(`src/tools/write.ts`) and supply only two callbacks:

- `plan(args)` — resolves the arguments into a `WritePlan`: the concrete
  `target`, a one-sentence `summary`, and an itemised `effects` list. It
  must not mutate anything, and it must not create anything either — a
  search-or-create helper like `resolveFoodId` belongs in `apply()`, never
  in `plan()`, because a preview must be incapable of a side effect. Set
  `noop: true` when there is nothing to do, and the harness skips the
  confirmation rather than asking the user to approve a no-op.
- `apply(plan, args)` — performs the write. It is reached only after the
  permission tier passed, a valid single-use confirmation token was
  presented, and an audit row was opened.

The tier check, `dry_run`, the audit trail, and the confirmation handshake
are properties of the harness, not of your tool. Do not reimplement any of
them.

Pick the tier by what an undo costs. `safe` is anything reversible — adding
a shopping list item, planning a meal. `destructive` is anything that loses
data — clearing checked shopping list items, deleting a meal plan entry.
When unsure, it is `destructive`; the cost of over-classifying is one
config flag, and the cost of under-classifying is someone's data.

## Vendored API spec

`specs/tandoor.json` is Tandoor's upstream OpenAPI document, refreshed by
`npm run specs:fetch` and regenerated into `src/generated/` by
`npm run codegen`. Both are committed and move together — a spec refreshed
without a regeneration leaves the types describing an API that no longer
exists. Regenerate with `npm run specs:fetch && npm run codegen` and review
the diff.

## Recorded fixtures

`test/fixtures/*.json` are captured once from a real Tandoor instance and
scrubbed, never hand-written. Maintainers refresh them with:

```bash
npm run capture   # reads a live Tandoor instance; maintainer-only
```

Review `git diff test/fixtures/` before committing regardless.

## Reporting a bug

Please include your Tandoor version, how tandoor-mcp is deployed (Docker
image or from source), and redacted logs. Redact the Tandoor API token and
the bearer token.
