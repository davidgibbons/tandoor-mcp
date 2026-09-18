# Security

What tandoor-mcp does about the risks specific to running an MCP server, what
it deliberately does not do, and where the boundary sits.

The structure follows the [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/)
(v0.1, beta) because it is the only shared vocabulary for this that currently
exists. Each risk gets the same three answers: what it is, what this server
does about it, and what it still does not solve. The third one is the reason
the page is worth reading.

To report something, see [SECURITY.md](../SECURITY.md).

## The threat model first

tandoor-mcp is a **single-operator appliance**. One person configures it, one
bearer token reaches it, one Tandoor instance and one set of permissions apply
to every tool. It is not multi-tenant, it does not federate, and it binds
`127.0.0.1` by default rather than `0.0.0.0` — reaching it from another
machine requires deliberately changing `BIND_ADDR`, not just running the
container.

Within that, two questions are separate and both matter:

| Question | Answered by |
| --- | --- |
| Who may reach this server at all? | Bearer token, `BIND_ADDR`, `allowed_hosts` |
| What may a caller do once it is in? | Permission tiers, the confirm handshake, the audit trail |

An authenticated caller is not automatically a trustworthy one, because the
caller is a language model acting on text it read somewhere else — including
recipe descriptions and step instructions that came from whoever wrote the
recipe in Tandoor. The second row is where the interesting failure is, and
where most of this server's design effort went.

## MCP01 Token Mismanagement and Secret Exposure

**The risk.** Credentials in logs, in model context, in debug traces, in the
transcript. This server holds a Tandoor API token and its own bearer token, so
it is a concentrated target for both.

**What tandoor-mcp does.**

- Credentials live in `config.yaml` in the mounted config directory (or the
  `TANDOOR_TOKEN` / `MCP_BEARER_TOKEN` environment variables). No tool returns
  one, and no tool takes one as an argument.
- The Tandoor token travels only as an `Authorization: Bearer` header, never in
  a URL or query string, so a logged request URL is never a logged credential.
- Upstream errors carry the **origin and path only**, never the full URL or
  any query string (`src/core/http.ts`).
- Audit arguments pass through a key-name redactor before they are written,
  even though no write tool accepts a credential today (`src/core/audit.ts`).
  That keeps it true by construction rather than by everyone remembering.

**What it does not solve.** `config.yaml` is plaintext on disk. There is no
secret manager integration and no encryption at rest, so filesystem
permissions on the config volume are the real boundary. Config is also read
once at startup — rotating either token means editing `config.yaml` (or the
environment) and restarting the process, not a live update.

## MCP02 Privilege Escalation via Scope Creep

**The risk.** Permissions granted once, broadly, and never narrowed. The agent
ends up able to do more than anyone consciously decided.

**What tandoor-mcp does.**

- Two ordered tiers, `safe_write` and `destructive`, both defaulting to
  `false`. `destructive: true` implies `safe_write`, because a policy that
  permits deletion but refuses a safe re-add describes nothing anyone would
  choose on purpose.
- There is exactly one Tandoor instance and one permissions block
  (`src/core/permissions.ts`), so there is no per-instance or per-argument
  resolution step for a compromised or buggy tool to exploit — every write
  tool checks the same fixed object, decided at startup from config.
- The gate reads configuration and nothing else. No tool argument, and
  nothing in a Tandoor response, can influence what a write tool is allowed
  to do.

**What it does not solve.** The tiers are coarse on purpose. There is no
per-tool grant, so enabling `destructive` enables every destructive tool
(`clear_shopping_list`, `delete_meal_plan`), not just one you had in mind.

## MCP03 Tool Poisoning

**The risk.** Content the server returns is treated by the model as
instruction rather than as data. Tandoor recipes are frequently imported from
public websites, so a recipe description, a step instruction, or an
ingredient note can contain attacker-controllable text.

**What tandoor-mcp does.** Every piece of free text Tandoor returns — recipe
descriptions, step instructions, ingredient notes, shopping-list notes, and
cook-log comments — is fenced (`src/core/fence.ts`) before it reaches the
model:

- Wrapped in a labelled boundary that names its source field, so injected
  text is visibly data with a provenance attached.
- The value's own angle brackets are escaped first, so it cannot close the
  fence and continue outside it. A fence a value can escape is worse than no
  fence, because it looks like protection.
- C0 and C1 control characters, zero-width characters, and the bidirectional
  override and isolate ranges are stripped. U+202E is the one that matters
  most: it makes the rest of a string render right to left, so an ingredient
  note can display as something completely different from the bytes a human
  later reads in an audit log.
- Truncated at 2000 characters, so a single hostile description cannot crowd
  out everything else in the answer.
- Escaped rather than censored — the words survive verbatim, so the model can
  still read what the recipe actually said.

Tool definitions themselves are static and registered in-process. Nothing
fetches a tool description from a remote source, so there is no rug-pull
surface where a tool's description changes after you approved it.

**What it does not solve.** Fencing does not make prompt injection impossible.
It makes injected text *visibly* data and removes the characters that let a
string render as something other than what it is. A model that decides to
obey fenced text anyway is not something this server can prevent — which is
precisely why the write path has a second line of defence. See MCP06.

## MCP04 Software Supply Chain and Dependency Tampering

**The risk.** A compromised dependency or a tampered image changes what the
server does without any change to its source.

**What tandoor-mcp does.**

- Eight runtime dependencies (`package.json`). Every addition is a deliberate
  decision.
- Dependabot groups non-major updates into one monthly PR per ecosystem
  (npm, GitHub Actions, Docker), because a solo maintainer reviewing separate
  patch bumps one at a time is many chances to rubber-stamp one. Security
  updates are exempt from that schedule and land as soon as the advisory
  does.
- Images are built with an SBOM and `provenance: mode=max`, and the pushed
  digest is attested with `actions/attest-build-provenance`, so you can
  verify that the image you pulled came from this repository's workflow.
- `npm ci` from a committed lockfile, everywhere, including inside the image
  build.

**What it does not solve.** There is no dependency pinning by hash beyond the
lockfile, and no reproducible-build guarantee. Provenance tells you where the
image was built, not that its inputs were uncompromised.

## MCP05 Command Injection and Execution

**The risk.** Servers that shell out to build a response, letting attacker
data reach a real shell.

**What tandoor-mcp does.** There is no shell tool, no `exec`, and no
`child_process` import anywhere in `src/`. That entire risk class does not
have a foothold here.

Outbound requests all go through one HTTP client against the Tandoor base URL
the operator configured. Paths are **prefixed, not resolved**
(`src/core/http.ts`), so a tool's path cannot escape Tandoor's URL base. The
configured URL must be `http://` or `https://`, validated at startup. No tool
accepts a URL, a hostname, or a filesystem path as an argument, so no
model-controlled string decides a network destination or a location on disk.

**What it does not solve.** Nothing structural outstanding here. This is the
one row where the honest answer is that the risk was designed out rather than
mitigated.

## MCP06 Intent Flow Subversion

**The risk.** Instructions embedded in context steer the agent away from what
the user actually asked for. This is the risk MCP03 turns into when the model
does obey the injected text.

**What tandoor-mcp does.** This is what the confirm handshake exists for
(`src/core/confirm.ts`).

A write tool called without `confirm` performs nothing. It returns a preview
plus a token, and only a second call carrying that token mutates anything.

- The token is an **HMAC over the exact operation**: tool, tier, operation,
  resolved target, and every effect-bearing argument. A token issued for
  "delete meal plan entry 5" cannot be replayed as "delete meal plan entry 9".
  Without that binding a model could preview something harmless and confirm
  something else — worse than no confirmation, because it would look like
  protection.
- It binds to the **resolved id, not the phrase the user typed** — a recipe
  or meal type given by name is resolved before the token is issued, so a
  token cannot survive re-resolving a name to a different recipe.
- **Single-use**, so "add to the meal plan" cannot be confirmed twice into a
  duplicate.
- **Five-minute TTL**, so a token found in an old transcript is dead.
- The signing key is fresh per process and never written down. A restart
  invalidating outstanding tokens is the correct behaviour.
- Expiry is checked before the signature, so an old token reports "expired"
  rather than a misleading "mismatch"; the spent-token check happens after
  the signature, so an unsigned guess cannot probe which tokens have been
  used.
- Surrounding backticks, quotes, and trailing punctuation are stripped before
  the token is parsed, so a caller that clips one character too many is
  refused and reissued a token in the same form rather than stuck in a loop.
  Nothing about the check relaxes: none of those characters can occur in a
  real token, the HMAC still decides, and the stripped form is what the
  single-use set records.
- `dry_run` is a terminal preview that never issues a token and is never
  refused by the permission tier, so "what would this do, and what would I
  need to enable for it" stays answerable without granting anything.

**What it does not solve.** State this plainly: the handshake does not stop a
determined model, which holds the token and can simply call twice. What it
guarantees is that the **first** call cannot mutate anything, so a mis-parsed
instruction surfaces as a preview a human can see and an audit row that
exists either way. The control is visibility before the fact, not
impossibility.

## MCP07 Insufficient Authentication and Authorization

**The risk.** Servers that verify nothing, which is the majority in every
survey so far.

**What tandoor-mcp does.**

- `/mcp` requires a bearer token, checked with a timing-safe comparison
  (`src/mcp/endpointAuth.ts`). There is no unauthenticated mode and no
  "trusted network" bypass.
- `BIND_ADDR` defaults to `127.0.0.1:6061`. tandoor-mcp is **not** reachable
  from another machine unless you deliberately rebind it — `allowed_hosts` is
  offered as defense-in-depth for when you do, not a load-bearing default-on
  protection.
- `allowed_hosts`, when set, is checked on every request against the `Host`
  header, guarding against DNS-rebinding even once the server is reachable
  beyond loopback.
- Request bodies are capped at 4 MB, refused with `413` before authentication
  runs. The cap is deliberately not configurable — every legitimate request
  is orders of magnitude below it.

**What it does not solve.** There is no OAuth, no per-client identity, and no
scoping of one token differently from another — one operator, one token. TLS
is a reverse proxy's job; tandoor-mcp speaks plain HTTP and says so. The
bearer token and `allowed_hosts` are read from config once at startup, so
rotating the token or changing the allowlist means restarting the process,
not sending a new request.

If you forward tandoor-mcp's port from your router or otherwise expose it to
the internet, the bearer token is the only thing between the internet and
your Tandoor instance. Do not do that.

## MCP08 Lack of Audit and Telemetry

**The risk.** Something happened, and nobody can reconstruct what.

**What tandoor-mcp does.**

- Every write attempt writes a row to `audit.db`, including previews, no-ops,
  and refusals. There is no path from arguments to a mutation that skips the
  trail.
- The row is written as `attempted` **before** Tandoor is called, and
  replaced when the call resolves. A row still reading `attempted` therefore
  means tandoor-mcp died mid-write — precisely the case an after-the-fact-only
  log cannot show.
- Outcomes are a closed set: `attempted`, `applied`, `dry_run`, `denied`,
  `unconfirmed`, `failed`. A refusal is as much a recorded event as a write.
- The database lives in the mounted config directory, not the container
  filesystem. A trail that vanishes on `docker compose down` is not a trail.
- Logs go to stdout unconditionally, so `docker logs` shows every request
  without any further setup.

**What it does not solve.** There is no external log shipping, no syslog
target, and no SIEM export. `audit.db` is ordinary SQLite, which is the
integration point if you want one. Read-only calls are not audited, only
logged.

## MCP09 Shadow MCP Servers

**The risk.** Unapproved servers running outside anyone's governance. This is
mostly an organisational problem rather than a property of a server, and
pretending otherwise would be dishonest.

What is relevant here: tandoor-mcp talks to exactly one Tandoor instance and
registers a fixed, static set of tools — nothing about its surface changes
based on what it discovers at runtime. The published image carries the
`io.modelcontextprotocol.server.name` label, and the MCP Registry refuses to
publish unless that label matches the server name it is claiming, so a
lookalike image cannot claim this identity. `/healthz` reports the name and
version without authentication, so you can identify what is actually running
on a port.

## MCP10 Context Injection and Over-Sharing

**The risk.** Data from one task or session leaking into another, or a single
answer dumping far more than was asked for.

**What tandoor-mcp does.**

- A fresh MCP server instance is built per request. There is no per-caller
  session state to leak between calls; what does outlive a request is
  deliberate and impersonal — the spent-confirmation-token set and the audit
  database.
- Reads are windowed. `limit` defaults to 50 with a hard maximum of 500,
  paired with `offset`, so no single answer can pour an entire recipe library
  into the context window.
- Tools return shaped fields chosen per tool rather than raw Tandoor
  payloads, which keeps internal ids and unrelated fields out of answers that
  had no use for them.

**What it does not solve.** There is exactly one Tandoor account behind the
configured token, and everything it can see, the model can see. tandoor-mcp
has no concept of per-caller identity — it does not ask "who is asking" and
cannot filter a response by who is using it. If you do not want a model to
see your recipes, do not configure a token that can read them.

## What this page does not cover

- **Multi-tenancy.** One operator, one token, one permission set. If several
  people need different access, run several instances against separate
  Tandoor tokens.
- **Internet exposure.** Covered by refusing to design for it (loopback
  binding by default) rather than by hardening for it.
- **Tandoor itself.** If your Tandoor instance is reachable without its own
  authentication, nothing here helps.
- **Your client.** tandoor-mcp cannot tell whether a call originated with a
  person or with an agent acting on a poisoned recipe import. The permission
  tiers, the confirm handshake, and the audit trail are what remain when that
  distinction is unavailable, and they are designed on the assumption that it
  always is.

## Sources

- [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/), v0.1 beta
