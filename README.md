# tandoor-mcp

An MCP server for [Tandoor Recipes](https://tandoor.dev): recipe search and
authoring, meal planning, shopping lists, and pantry tracking, exposed as a
small set of task-shaped tools rather than one per API endpoint.

See `docs/superpowers/specs/2026-09-17-tandoor-mcp-design.md` for the design
and `docs/security.md` for the threat model.

## Configuration

Copy `config.example.yaml` to your config directory as `config.yaml`, or set
the equivalent environment variables. See that file for every key.

## Running

```bash
npm install
npm run build
TANDOOR_MCP_CONFIG_DIR=./config node dist/src/index.js
```
