# getoolkit-mcp

Deterministic developer utilities as [Model Context Protocol](https://modelcontextprotocol.io) tools. Companion to [getoolkit.com](https://getoolkit.com) — the same algorithms the web tools run, callable from Claude Desktop, Claude Code, Cursor, or any MCP-compatible client.

**Zero network calls at runtime. No API keys. Every result is computed locally and reproducible.**

## Tools

| Tool | What it does | Notes |
|---|---|---|
| `hash_text` | MD5 / SHA-1 / SHA-256 / SHA-512 digest of a UTF-8 string | MD5/SHA-1 for legacy checksums only; default to `sha256` |
| `timestamp_convert` | Bidirectional Unix timestamp ↔ date | Number in → ISO 8601 + UTC string (unit auto-detected); date string in → epoch seconds and milliseconds |
| `generate_uuid` | 1–100 random UUID v4 identifiers (RFC 9562) | Host CSPRNG |
| `base64` | Encode / decode, optional URL-safe alphabet | URL-safe swaps `+/` for `-_`, strips padding (JWT style) |
| `url_encode` | Percent-encode / decode | Component mode (default) escapes `& = ?` for single URL parameters |

## Install

Requires Node >= 18.

```bash
npm install -g getoolkit-mcp
```

Or run from source:

```bash
git clone https://github.com/qwehkkk/getoolkit-mcp.git
cd getoolkit-mcp && npm install && npm start
```

## Client configuration

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "getoolkit": {
      "command": "npx",
      "args": ["-y", "getoolkit-mcp"]
    }
  }
}
```

### Cursor

Add the same block to `.cursor/mcp.json`.

## Example

```
> hash_text { "algorithm": "sha256", "text": "abc" }
sha256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

## Why this exists

AI agents frequently need deterministic encoding and hashing done *for* them instead of guessed at — LLMs should not compute hashes or epoch conversions from memory. This server exists so an agent can call a local, verifiable implementation instead.

The web version of every tool is at [getoolkit.com](https://getoolkit.com) (no signup, no tracking).

## Verify

```bash
npm test
```

The smoke test spawns the server over stdio, runs the full MCP handshake, lists tools, and calls every tool with round-trip assertions.

## License

MIT
