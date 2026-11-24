#!/usr/bin/env node
/**
 * getoolkit-mcp — deterministic developer utilities exposed as MCP tools.
 *
 * Companion MCP server to https://getoolkit.com — the same algorithms the
 * web tools run, callable from Claude, ChatGPT plugins, Cursor, or any
 * MCP-compatible client. Zero network calls at runtime: every result is
 * computed locally and reproducible.
 *
 * Transport: stdio. Node >= 18.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import crypto from "node:crypto";

const HASH_ALGOS = ["md5", "sha1", "sha256", "sha512"];

const server = new McpServer({
  name: "getoolkit-mcp",
  version: "0.1.0"
});

/* ---------------------------------------------------------- hash_text */

server.registerTool(
  "hash_text",
  {
    title: "Hash text",
    description:
      "Compute the hash digest of a UTF-8 string using MD5, SHA-1, SHA-256, or SHA-512. " +
      "Deterministic and local. MD5 and SHA-1 are provided for legacy checksums only — " +
      "both are broken for security purposes; use sha256 as the default.",
    inputSchema: {
      algorithm: z.enum(HASH_ALGOS).describe("Hash algorithm"),
      text: z.string().describe("UTF-8 text to hash"),
      encoding: z.enum(["hex", "base64"]).default("hex").describe("Digest output encoding")
    },
    outputSchema: {
      algorithm: z.string(),
      digest: z.string(),
      length_bits: z.number()
    }
  },
  async ({ algorithm, text, encoding }) => {
    const h = crypto.createHash(algorithm).update(text, "utf8").digest(encoding);
    return {
      content: [{ type: "text", text: `${algorithm}: ${h}` }],
      structuredContent: { algorithm, digest: h, length_bits: h.length * 4 }
    };
  }
);

/* --------------------------------------------------- timestamp_convert */

server.registerTool(
  "timestamp_convert",
  {
    title: "Convert Unix timestamp",
    description:
      "Bidirectional Unix timestamp converter. Pass a number (seconds or milliseconds since " +
      "the Unix epoch) to get ISO 8601 and UTC strings; pass a date string to get the epoch " +
      "in both seconds and milliseconds. Local, timezone-aware via the host clock.",
    inputSchema: {
      value: z.union([z.number(), z.string()]).describe(
        "Epoch number (seconds or milliseconds, auto-detected by magnitude) or a parseable date string"
      )
    },
    outputSchema: {
      direction: z.string(),
      iso8601: z.string(),
      utc_string: z.string(),
      epoch_seconds: z.number().optional(),
      epoch_milliseconds: z.number().optional()
    }
  },
  async ({ value }) => {
    let date, direction;
    if (typeof value === "number") {
      // Auto-detect unit: anything below 10^11 cannot be milliseconds for
      // any date in the plausible range (2286 AD at 10^10 seconds).
      const ms = Math.abs(value) >= 1e11 ? value : value * 1000;
      date = new Date(ms);
      direction = `epoch (assumed ${Math.abs(value) >= 1e11 ? "milliseconds" : "seconds"}) → date`;
    } else {
      date = new Date(value);
      direction = "date string → epoch";
    }
    if (Number.isNaN(date.getTime())) {
      return {
        content: [{ type: "text", text: `Unparseable date value: ${JSON.stringify(value)}` }],
        isError: true
      };
    }
    const out = {
      direction,
      iso8601: date.toISOString(),
      utc_string: date.toUTCString()
    };
    if (typeof value === "number") {
      out.epoch_seconds = Math.floor(date.getTime() / 1000);
      out.epoch_milliseconds = date.getTime();
    } else {
      out.epoch_seconds = Math.floor(date.getTime() / 1000);
      out.epoch_milliseconds = date.getTime();
    }
    return {
      content: [{ type: "text", text: JSON.stringify(out) }],
      structuredContent: out
    };
  }
);

/* -------------------------------------------------------- generate_uuid */

server.registerTool(
  "generate_uuid",
  {
    title: "Generate UUID v4",
    description:
      "Generate one or more random UUID version 4 identifiers (RFC 9562) using the host " +
      "CSPRNG. Universally unique without a coordination service.",
    inputSchema: {
      count: z.number().int().min(1).max(100).default(1).describe("How many UUIDs to generate")
    },
    outputSchema: {
      count: z.number(),
      uuids: z.array(z.string())
    }
  },
  async ({ count }) => {
    const uuids = Array.from({ length: count }, () => crypto.randomUUID());
    return {
      content: [{ type: "text", text: uuids.join("\n") }],
      structuredContent: { count, uuids }
    };
  }
);

/* -------------------------------------------------------------- base64 */

server.registerTool(
  "base64",
  {
    title: "Base64 encode/decode",
    description:
      "Encode UTF-8 text to Base64 (or URL-safe Base64) or decode Base64 back to text. " +
      "URL-safe mode swaps +/ for -_ and strips padding, as used in JWTs.",
    inputSchema: {
      mode: z.enum(["encode", "decode"]),
      text: z.string().describe("Text to encode, or Base64 to decode"),
      url_safe: z.boolean().default(false).describe("Use URL-safe alphabet (encode mode)")
    },
    outputSchema: {
      result: z.string(),
      length_bytes: z.number()
    }
  },
  async ({ mode, text, url_safe }) => {
    try {
      if (mode === "encode") {
        let out = Buffer.from(text, "utf8").toString("base64");
        if (url_safe) out = out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        return {
          content: [{ type: "text", text: out }],
          structuredContent: { result: out, length_bytes: Buffer.byteLength(out) }
        };
      }
      let normalized = text.replace(/-/g, "+").replace(/_/g, "/");
      while (normalized.length % 4 !== 0) normalized += "=";
      const decoded = Buffer.from(normalized, "base64").toString("utf8");
      return {
        content: [{ type: "text", text: decoded }],
        structuredContent: { result: decoded, length_bytes: Buffer.byteLength(decoded) }
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Base64 ${mode} failed: ${e.message}` }],
        isError: true
      };
    }
  }
);

/* ----------------------------------------------------------- url_encode */

server.registerTool(
  "url_encode",
  {
    title: "URL encode/decode",
    description:
      "Percent-encode or decode text. Component mode (default) escapes reserved characters " +
      "like & = ? for embedding in a single URL parameter; full mode only escapes spaces " +
      "and non-URI characters.",
    inputSchema: {
      mode: z.enum(["encode", "decode"]),
      text: z.string(),
      component: z.boolean().default(true).describe("Component-level encoding (encodeURIComponent)")
    },
    outputSchema: {
      result: z.string()
    }
  },
  async ({ mode, text, component }) => {
    let out;
    try {
      out =
        mode === "encode"
          ? component ? encodeURIComponent(text) : encodeURI(text)
          : component ? decodeURIComponent(text) : decodeURI(text);
    } catch (e) {
      return {
        content: [{ type: "text", text: `URL ${mode} failed: ${e.message}` }],
        isError: true
      };
    }
    return {
      content: [{ type: "text", text: out }],
      structuredContent: { result: out }
    };
  }
);

/* ------------------------------------------------------------------ run */

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio keeps the process alive; no further output on stdout (protocol-only).
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
