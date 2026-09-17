# tandoor-mcp design

An MCP server for [Tandoor Recipes](https://tandoor.dev), built as a sibling project to `~/git/arr-mcp`: same stack, same OWASP MCP Top 10 threat-model approach, same OpenAPI-fixture contract testing, same contributing rules — scaled down for one app, one instance, no config UI.

## Non-goals

- Multiple Tandoor instances/spaces. One URL, one token.
- A web config UI. Config is a file plus env-var overrides.
- Feature parity with every Tandoor API endpoint. Tools are verbs, not endpoint wrappers — see Tool surface.
- Public release infrastructure justifying itself on user count. It's built anyway (below), but the bar for scope is "what arr-mcp does," not "what a growing OSS project needs."

## Architecture

- TypeScript, Node ≥24, ESM, `tsc` build to `dist/`. Same toolchain as arr-mcp: `hono` (HTTP), `zod` (schemas), `vitest` (tests), `eslint`.
- Transport: HTTP via `hono` + `@hono/node-server`, one `/mcp` endpoint gated by a bearer token. Binds `127.0.0.1` by default; `BIND_ADDR` env var to opt into wider exposure.
- No adapter registry. One `TandoorClient` in `src/client.ts` wraps the Tandoor REST API directly — no `services/` directory, no per-instance id, no capability-interface machinery. That machinery exists in arr-mcp to support many backends and many instances of each; tandoor-mcp has one of each.
- `src/core/` carries over the cross-cutting pieces that aren't about multiplicity: `http.ts` (client with sanitized error surfacing), `fence.ts` (untrusted-text fencing, ported as-is), `confirm.ts` (HMAC write-confirmation), `permissions.ts` (two-tier gate), `audit.ts` (SQLite write log), `errors.ts`, `logger.ts`.

## Configuration

`config.yaml`, zod-validated, with env-var overrides for every key:

| Key | Env var | Purpose |
|---|---|---|
| `tandoor.url` | `TANDOOR_URL` | Base URL of the Tandoor instance |
| `tandoor.token` | `TANDOOR_TOKEN` | Static API token (Bearer auth) |
| `mcp.bearerToken` | `MCP_BEARER_TOKEN` | Token clients must send to reach `/mcp` |
| `mcp.bindAddr` | `BIND_ADDR` | Default `127.0.0.1:6061` |
| `permissions.safeWrite` | `PERMISSIONS_SAFE_WRITE` | Default `false` |
| `permissions.destructive` | `PERMISSIONS_DESTRUCTIVE` | Default `false` |

Auth to Tandoor is a static personal API token sent as `Authorization: Bearer <token>` — no username/password, no session refresh, no interaction with Tandoor's 10-requests/day auth rate limit.

## Tool surface

Twelve tools. Each is a verb with real logic behind it, not a thin per-endpoint wrapper — collapsing what would otherwise be 20+ CRUD tools.

**Reads**

| Tool | Behavior |
|---|---|
| `search_recipes` | Filter by name, keyword, food, rating. |
| `get_recipe` | Full detail; scales ingredient amounts server-side when a target `servings` is given. |
| `get_meal_plan` | Date-range list, optional meal-type filter. |
| `get_shopping_list` | Flat or grouped-by-checked-state. |
| `list_reference_data` | `kind` enum (`keyword` \| `unit` \| `food` \| `meal_type`) instead of four near-identical list tools. |
| `get_cook_log` | Filtered by recipe id and/or days-back. |

**Writes** (all go through the plan/confirm harness — see below)

| Tool | Behavior | Permission tier |
|---|---|---|
| `create_recipe` | Takes a plain ingredients/instructions block; resolves each ingredient's food and unit by search-or-create, builds steps, creates the recipe in one call. | `safe_write` |
| `plan_meals` | Resolves recipe(s) by id or name, resolves meal type by name, creates one or more meal-plan entries across a date range. | `safe_write` |
| `update_shopping_list` | One tool, an `action` enum (`add` \| `check` \| `uncheck` \| `remove` \| `clear_checked`); resolves item names to food ids internally. `clear_checked` also flips matching foods to on-hand in the pantry as a stated side effect. | `safe_write` for `add`/`check`/`uncheck`/`remove`; `clear_checked` requires `destructive` because of its pantry side effect |
| `update_pantry` | Batch-marks foods on-hand/not-on-hand, resolving names to food ids (search-or-create). | `safe_write` |
| `log_cooked_recipe` | Records a cook: recipe id, servings, rating, comment. | `safe_write` |
| `delete_meal_plan` | Deletes a meal-plan entry by id. | `destructive` |

**`suggest_recipes`** (read, but the deepest tool in the set): no Tandoor endpoint does this — it cross-references current pantry against every recipe's ingredient list, computes a match percentage per recipe, and supports a `mode` (`maximum-use` \| `expiring-soon`). Pure derived logic layered over `search_recipes` + `get_recipe` + `list_reference_data(kind: food)`.

Deferred, not designed: anything beyond this set (e.g. nutrition tracking, meal-plan templates). New capability extends one of these twelve first; a new tool needs its own design pass and a stated reason the existing ones can't absorb it — same rule as arr-mcp's "the tool surface is the public API."

## Write-safety model

Full parity with arr-mcp:

1. **Two permission tiers**, both default `false`, checked from config before anything else runs: `safe_write` and `destructive` (assignments above).
2. **Plan/confirm handshake** via a shared `registerWriteTool` harness — every write tool provides `plan()` (pure, does a read-before-write, returns `{ target, summary, effects, noop? }`) and `apply()` (reached only after the permission check and a valid confirm token). The confirm token is an HMAC over the exact operation (tool, tier, resolved target, every effect-bearing argument), single-use, 5-minute TTL, signing key generated fresh per process and never persisted.
3. **Audit trail**: every write attempt — including denied and preview-only ones — gets a row in `audit.db` (SQLite, in the mounted config volume), written `attempted` before the call and updated after. A row stuck at `attempted` means the process died mid-write.

## Security

`docs/security.md`, structured like arr-mcp's: one subsection per OWASP MCP Top 10 item (MCP01–MCP10), each split into *the risk*, *what tandoor-mcp does*, *what it does not solve*. Carried over directly:

- **MCP01 (secret exposure)**: no tool returns or accepts a credential; `src/core/http.ts` errors carry origin + path, never the full URL or token.
- **MCP02 (privilege escalation)**: two-tier gate, resolved from arguments before any check runs.
- **MCP03 (prompt injection via data)**: `src/core/fence.ts`, ported as-is, wraps every piece of free text from Tandoor (recipe descriptions, notes, comments) — escapes the value's own angle brackets, strips control/zero-width/bidi-override characters, truncates at 2000 chars.
- **MCP05 (command injection)**: no shell/`exec`/`child_process`; the HTTP client only ever prefixes the configured base URL.
- **MCP06 (intent-flow subversion)**: the confirm handshake described above.
- **MCP07 (auth)**: mandatory bearer token on `/mcp`, no unauthenticated mode, `BIND_ADDR` defaults to loopback.
- **MCP08 (audit)**: the SQLite write log described above.
- **MCP09/MCP10**: static in-process tool registration only, no dynamic tool descriptions, fresh server instance per request with no per-caller session state.

Threat model statement (verbatim intent from arr-mcp, restated for this server): a single-operator appliance for one Tandoor instance, not multi-tenant, not designed to be exposed to the internet. Top-level `SECURITY.md` covers vulnerability reporting with the same in-scope / known-not-a-vulnerability split.

## Testing and fixtures

- `scripts/fetch-specs.sh` pulls Tandoor's OpenAPI schema (drf-spectacular, `/api/schema/`) into `specs/tandoor.json`.
- `scripts/codegen.mjs` runs `openapi-typescript` against it into `src/generated/tandoor.ts`.
- `scripts/capture-fixtures.ts` hits a live, user-supplied Tandoor instance and writes scrubbed responses to `test/fixtures/*.json` — refuses to write a fixture that still contains a credential, scrubs identity fields (account names, emails, hostnames) per-endpoint, keeps real recipe content.
- `test/contract.test.ts`: for each tool, a declared list of dotted field paths it reads; the test checks each path exists in both the captured fixture and the vendored spec's declared response schema for that endpoint. Not full-schema validation, for the same reason arr-mcp avoids it: upstream API drift that can't break a tool shouldn't fail a check that gets ignored as a result.
- Flat `test/*.test.ts` files, fake `fetch` injected via a `serving()` helper ported from arr-mcp's `test/helpers/serve.ts`. No live service touched in CI or by a plain `npm install && npm test`.

## Deployment

- Multi-stage `Dockerfile`, pinned-by-digest `node:24-trixie-slim` for both stages, non-root (reuse the image's existing `node` user), `npm ci && npm run build && npm prune --omit=dev`.
- `VOLUME ["/config"]` for `config.yaml` and `audit.db`.
- `HEALTHCHECK` against `/healthz`, reading the port from the same env var the server binds to.
- `LABEL io.modelcontextprotocol.server.name=io.github.<owner>/tandoor-mcp`.
- `docker-compose.example.yml` mounting `./config:/config`, documenting bearer-token generation.

## Release and CI

Full pipeline from day one, matching arr-mcp:

- `ci.yml`: lint, typecheck, test, contract check on every PR.
- `openapi-drift.yml`: nightly spec refetch + regen + contract/typecheck, opens a PR on drift.
- `release.yml`: `release-please` (Conventional Commits) → GHCR image with SBOM and build provenance → MCP Registry publish via `server.json`, version kept in lockstep with `package.json`.
- MIT license, matching arr-mcp.

## Contributing guidelines

`CONTRIBUTING.md` ported from arr-mcp with the multi-adapter sections removed (there's one client, not a registry to extend) and the rest kept: the three gates (lint/typecheck/test) and "CI runs exactly what you can run locally," the agent-authorship rules (never hand-write a fixture, paste actual gate output, state what a human actually exercised, fix generated-type mismatches at the mapper not with a cast), Conventional Commits with the breaking/minor definitions specific to this tool surface (renaming/removing a tool or parameter, or removing a response field, is breaking), the tool-surface-is-public-API rule, the fencing rule for any new free-text field, the write-tool-harness rule for any new write tool, and the fixture-capture/scrubbing rules.

## Open items for the implementation plan

- Exact Tandoor OpenAPI schema URL and shape need confirming against the live instance during fixture capture (drf-spectacular's default path is `/api/schema/`, but self-hosted instances sometimes disable it — falls back to hand-maintained minimal type stubs for any endpoint missing from the spec, same as arr-mcp does for Bazarr/SABnzbd/Transmission/qBittorrent).
- `suggest_recipes`' match-percentage thresholds per `mode` need concrete default values, ported from the reference implementation's `maximum-use` (≥50%) and `expiring-soon` (≥30% match, ≤3 missing ingredients) as a starting point, revisited once real fixtures are in hand.
