# Security Policy

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability** on
[the repository](https://github.com/dgibbons/tandoor-mcp/security/advisories/new).
That opens a channel only you and I can read, which is what you want before
anything is fixed.

If that page is unavailable to you for any reason, open a normal issue saying
you have found something and want a private channel — **without the details** —
and I will open one.

Please include, as far as you have it: the tandoor-mcp version, how it is
deployed (Docker image or from source), and the smallest sequence of calls
that shows the problem. A confirm token or bearer token from your own
instance is not useful to me and should stay yours; redact them.

## What to expect

This is a one-person project, so the honest version rather than a
service-level agreement: I will acknowledge a report within a week, tell you
whether I agree it is a vulnerability and why, and keep you updated while it
is being fixed. Fixes ship as a normal release with the advisory published
alongside. There is no bounty. Credit in the advisory if you want it, and
none if you would rather not be named.

**Only the latest release is supported.** There are no backports to older
versions; the fix will be in the next release and the upgrade is a tag
change.

## Scope

Things worth reporting:

- Reaching `/mcp` without a valid bearer token, or any bypass of
  `allowed_hosts`.
- Any way to read the Tandoor API token or the bearer token out of a tool
  response, a log line, an error message, or the audit trail.
- Any way to make a write happen without passing the permission tier, or with
  a confirmation token that was not issued for that exact operation and
  target. This includes a token bound to one target being accepted for
  another.
- Content from Tandoor escaping its fence and reaching the model as
  instruction rather than as data.
- Anything wrong with the published image's provenance, or with the release
  workflow that builds it.

Things that are known and documented rather than vulnerabilities:

- **No OAuth.** tandoor-mcp authenticates with a single bearer token by
  design. See [MCP07](docs/security.md#mcp07-insufficient-authentication-and-authorization).
- **`config.yaml` is plaintext.** Filesystem permissions on the config volume
  are the boundary; there is no encryption at rest. See
  [MCP01](docs/security.md#mcp01-token-mismanagement-and-secret-exposure).
- **Binding `127.0.0.1` by default.** tandoor-mcp is not reachable from
  another machine unless you deliberately change `BIND_ADDR`. Doing that, and
  forwarding a port to it, is a deployment decision, not a defect.
- **A model that confirms its own preview.** The confirm handshake guarantees
  that the *first* call cannot mutate anything, not that a determined caller
  cannot call twice. See
  [MCP06](docs/security.md#mcp06-intent-flow-subversion).
- **Vulnerabilities in Tandoor itself.** Report those to that project. If
  tandoor-mcp makes one materially easier to reach, that part *is* in scope,
  so say so.

## Threat model

[docs/security.md](docs/security.md) sets out what this server defends
against, how, and what it deliberately does not solve, walked against the
OWASP MCP Top 10. Reading the "what it does not solve" paragraphs first is
the quickest way to tell whether what you have found is already known.
