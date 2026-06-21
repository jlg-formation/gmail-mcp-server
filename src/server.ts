import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import { z } from "zod";

const PORT = parseInt(process.env.PORT ?? "1976", 10);
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID ?? "";
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET ?? "";
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN ?? "";
const ENABLE_WRITE = process.env.ENABLE_WRITE === "true";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, mcp-session-id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

function createGmailClient() {
  const auth = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
}

// RFC 2047 encode a header value containing non-ASCII characters
function encodeHeader(value: string): string {
  if (!/[^\x00-\x7F]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

// Decode a base64url-encoded Gmail message body part
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

type GmailPayload = gmail_v1.Schema$MessagePart;

// Recursively find a MIME part by type, preferring text/plain over text/html
function findBodyPart(payload: GmailPayload, preferredMime = "text/plain"): string | null {
  if (payload.mimeType === preferredMime && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findBodyPart(part, preferredMime);
      if (found) return found;
    }
  }
  return null;
}

function extractBody(payload: GmailPayload): string {
  return (
    findBodyPart(payload, "text/plain") ??
    findBodyPart(payload, "text/html") ??
    ""
  );
}

function extractHeaders(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, names: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of names) {
    const header = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
    result[name] = header?.value ?? "";
  }
  return result;
}

function formatMessage(msg: gmail_v1.Schema$Message, includeBody: boolean) {
  const headers = extractHeaders(msg.payload?.headers, ["Subject", "From", "To", "Date", "Cc"]);
  const result: Record<string, unknown> = {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds ?? [],
    snippet: msg.snippet ?? "",
    ...headers,
  };
  if (includeBody && msg.payload) {
    result.body = extractBody(msg.payload);
  }
  return result;
}

const gmail = createGmailClient();

function createServer(): McpServer {
  const server = new McpServer({
    name: "gmail-mcp-server",
    version: "1.0.0",
  });

  // ── search_threads ────────────────────────────────────────────────────────
  server.tool(
    "search_threads",
    "Search Gmail threads using a Gmail search query (e.g. 'from:alice@example.com is:unread'). Returns thread IDs and snippets.",
    {
      query: z.string().describe("Gmail search query"),
      maxResults: z.number().int().min(1).max(500).default(20).describe("Maximum number of threads to return"),
    },
    async ({ query, maxResults }) => {
      try {
        const res = await gmail.users.threads.list({
          userId: "me",
          q: query,
          maxResults,
        });
        const threads = res.data.threads ?? [];
        return {
          content: [{ type: "text", text: JSON.stringify({ threads, nextPageToken: res.data.nextPageToken ?? null }, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ── get_thread ────────────────────────────────────────────────────────────
  server.tool(
    "get_thread",
    "Get a Gmail thread by ID, returning all messages with their headers and decoded body.",
    {
      threadId: z.string().describe("Thread ID"),
      format: z.enum(["full", "metadata"]).default("full").describe("'full' includes decoded body, 'metadata' returns headers only"),
    },
    async ({ threadId, format }) => {
      try {
        const res = await gmail.users.threads.get({
          userId: "me",
          id: threadId,
          format: format === "full" ? "full" : "metadata",
        });
        const messages = (res.data.messages ?? []).map((msg) =>
          formatMessage(msg, format === "full")
        );
        return {
          content: [{ type: "text", text: JSON.stringify({ threadId: res.data.id, messages }, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ── get_message ───────────────────────────────────────────────────────────
  server.tool(
    "get_message",
    "Get a single Gmail message by ID, returning headers and decoded body.",
    {
      messageId: z.string().describe("Message ID"),
      format: z.enum(["full", "metadata"]).default("full").describe("'full' includes decoded body, 'metadata' returns headers only"),
    },
    async ({ messageId, format }) => {
      try {
        const res = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: format === "full" ? "full" : "metadata",
        });
        return {
          content: [{ type: "text", text: JSON.stringify(formatMessage(res.data, format === "full"), null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ── list_messages ─────────────────────────────────────────────────────────
  server.tool(
    "list_messages",
    "List Gmail messages in one or more labels (default: INBOX). Returns message IDs and snippets.",
    {
      labelIds: z.array(z.string()).default(["INBOX"]).describe("Label IDs to filter by (e.g. ['INBOX', 'UNREAD'])"),
      maxResults: z.number().int().min(1).max(500).default(20).describe("Maximum number of messages to return"),
      pageToken: z.string().optional().describe("Page token for pagination (from a previous response)"),
    },
    async ({ labelIds, maxResults, pageToken }) => {
      try {
        const res = await gmail.users.messages.list({
          userId: "me",
          labelIds,
          maxResults,
          pageToken,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  messages: res.data.messages ?? [],
                  nextPageToken: res.data.nextPageToken ?? null,
                  resultSizeEstimate: res.data.resultSizeEstimate ?? 0,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ── list_labels ───────────────────────────────────────────────────────────
  server.tool(
    "list_labels",
    "List all Gmail labels for the account (system labels like INBOX, SENT, and user-created labels).",
    {},
    async () => {
      try {
        const res = await gmail.users.labels.list({ userId: "me" });
        const labels = (res.data.labels ?? []).map((l) => ({
          id: l.id,
          name: l.name,
          type: l.type,
          messagesTotal: l.messagesTotal,
          messagesUnread: l.messagesUnread,
        }));
        return { content: [{ type: "text", text: JSON.stringify(labels, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ── send_message (only when ENABLE_WRITE=true) ────────────────────────────
  if (ENABLE_WRITE) {
    server.tool(
      "send_message",
      "Send an email via Gmail.",
      {
        to: z.string().describe("Recipient email address(es), comma-separated"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Plain text email body"),
        cc: z.string().optional().describe("CC address(es), comma-separated"),
        bcc: z.string().optional().describe("BCC address(es), comma-separated"),
        inReplyTo: z.string().optional().describe("Message-ID header of the message being replied to (for threading)"),
        threadId: z.string().optional().describe("Gmail thread ID to attach this message to"),
      },
      async ({ to, subject, body, cc, bcc, inReplyTo, threadId }) => {
        try {
          const lines = [
            `To: ${to}`,
            cc ? `Cc: ${cc}` : null,
            bcc ? `Bcc: ${bcc}` : null,
            `Subject: ${encodeHeader(subject)}`,
            inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
            inReplyTo ? `References: ${inReplyTo}` : null,
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "",
            body,
          ].filter(Boolean).join("\r\n");

          const raw = Buffer.from(lines).toString("base64url");
          const res = await gmail.users.messages.send({
            userId: "me",
            requestBody: { raw, ...(threadId ? { threadId } : {}) },
          });
          return {
            content: [{ type: "text", text: JSON.stringify({ id: res.data.id, threadId: res.data.threadId }, null, 2) }],
          };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
        }
      }
    );
  }

  return server;
}

// ── Transport ─────────────────────────────────────────────────────────────────

const isStdio = process.argv.includes("--stdio");

if (isStdio) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else {
  async function withCors(res: Response): Promise<Response> {
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
    if (res.headers.get("content-type")?.includes("text/event-stream")) {
      return new Response(res.body, { status: res.status, headers });
    }
    const body = res.body ? await res.arrayBuffer() : null;
    return new Response(body, { status: res.status, headers });
  }

  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      if (url.pathname === "/mcp") {
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        const server = createServer();
        await server.connect(transport);
        const res = await transport.handleRequest(req);
        return withCors(res);
      }

      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { ...CORS_HEADERS, "content-type": "application/json" },
        });
      }

      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    },
  });

  console.log(`Gmail MCP server listening on http://localhost:${PORT}/mcp`);
}
