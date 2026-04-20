<div align="center">
  <h1>Agentic Inbox</h1>
  <p><em>A self-hosted email client with an AI agent, running entirely on Cloudflare Workers</em></p>
</div>

Fork of [cloudflare/agentic-inbox](https://github.com/cloudflare/agentic-inbox) with custom enhancements for the BJJ Lotus Club platform.

## What It Does

Agentic Inbox lets you send, receive, and manage emails through a modern web interface -- all powered by your own Cloudflare account. Incoming emails arrive via [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/), each mailbox is isolated in its own [Durable Object](https://developers.cloudflare.com/durable-objects/) with a SQLite database, and attachments are stored in [R2](https://developers.cloudflare.com/r2/).

An **AI-powered Email Agent** can read your inbox, search conversations, and draft replies -- built with the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) and [Workers AI](https://developers.cloudflare.com/workers-ai/).

![Agentic Inbox screenshot](./demo_app.png)

## Fork Changes (vs upstream)

This fork adds significant functionality on top of the original Cloudflare template:

- **Gmail Sync** -- Import emails from an existing Gmail account via Google OAuth2. Fetches unread messages, downloads attachments, preserves threading headers, and marks synced messages as read in Gmail. Idempotent (duplicate-safe) with configurable batch size.
- **MCP Server** -- Full [Model Context Protocol](https://modelcontextprotocol.io/) endpoint at `/mcp` exposing 13 tools for external AI tools (Claude Code, Cursor, ProtoAgent, etc.) to read/search/draft/send emails programmatically.
- **Expanded Agent Tools** -- The built-in agent now has 9 tools including `draft_email` (new outbound), `discard_draft`, `mark_email_read`, and `move_email` beyond the original read/search/draft/send set.
- **Send Rate Limiting** -- Rate limit enforcement on outbound emails to prevent abuse.
- **AI Draft Verification** -- Every draft is verified by a secondary AI call before saving/sending. Detects and blocks prompt injection attempts in both email body and thread context.
- **Prompt Injection Defense** -- Dual-layer protection: scans incoming email body AND thread history for prompt injection before auto-drafting.
- **Shared Tool Library** -- `workers/lib/tools.ts` provides a unified business-logic layer used by both the Agent (WebSocket) and MCP server, ensuring consistent behavior.
- **Folder Management** -- 6 system folders (inbox, sent, draft, archive, trash, spam) with move operations and proper sidebar ordering.
- **Timezone Support** -- All dates rendered in Australia/Brisbane (AEST, UTC+10) via date-fns-tz.
- **Reply/Forward API** -- Dedicated API endpoints for reply and forward threading with proper `In-Reply-To` and `References` headers.

## Features

- **Full email client** -- Send and receive emails via Cloudflare Email Routing with a rich text composer, reply/forward threading, folder organization, search, and attachments
- **Per-mailbox isolation** -- Each mailbox runs in its own Durable Object with SQLite storage and R2 for attachments
- **Built-in AI agent** -- Side panel with 9 email tools for reading, searching, drafting, and sending
- **Auto-draft on new email** -- Agent automatically reads inbound emails and generates draft replies, always requiring explicit confirmation before sending
- **MCP server** -- 13 tools exposed via MCP for programmatic email access from any MCP-compatible AI tool
- **Gmail import** -- Sync existing Gmail inbox with full attachment and threading support
- **Configurable and persistent** -- Custom system prompts per mailbox, persistent chat history, streaming markdown responses, and tool call visibility

## Architecture

```
                              bjjlotusclub.com
                                   /mail (reverse proxy)
                                       |
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────>│  Hono Worker     │────>│  MailboxDO      │
│  React SPA   │     │  (API + SSR)     │     │  (SQLite + R2)  │
│  Agent Panel │     │                  │     └─────────────────┘
└──────┬───────┘     │  /agents/* ──────┼────>┌─────────────────┐
       │             │                  │     │  EmailAgent DO  │
       │ WebSocket   │                  │     │  (AIChatAgent)  │
       └─────────────┤                  │     │  9 email tools  │
                     │                  │     │  Workers AI     │
                     │  /mcp ───────────┼────>│  (Kimi K2.5)    │
                     │                  │     └─────────────────┘
                     └──────────────────┘     ┌─────────────────┐
                                              │  EmailMCP DO    │
                                              │  13 MCP tools   │
                                              └─────────────────┘
```

The inbox runs as a standalone Cloudflare Worker and is integrated into the BJJ Lotus Club site via a reverse proxy at `/mail` (git submodule + Express proxy).

## Stack

- **Frontend:** React 19, React Router v7, Tailwind CSS, Zustand, TipTap rich text editor, `@cloudflare/kumo`
- **Backend:** Hono, Cloudflare Workers, Durable Objects (SQLite), R2, Email Routing, Email Service
- **AI Agent:** Cloudflare Agents SDK (`AIChatAgent`), AI SDK v6, Workers AI (`@cf/moonshotai/kimi-k2.5`), `react-markdown` + `remark-gfm`
- **MCP Server:** `@modelcontextprotocol/sdk`, agents/mcp (`McpAgent`)
- **Auth:** Cloudflare Access JWT validation (required outside local development)

## Quick Start

```bash
npm install
npm run dev
```

### Configuration

1. Copy `.dev.vars.example` to `.dev.vars` and set your domain
2. Create an R2 bucket: `wrangler r2 bucket create bjj-agentic-inbox`
3. For Gmail sync, set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` as secrets

### Deploy

```bash
npm run deploy
```

### Secrets (set via Wrangler dashboard or CLI)

| Secret | Description |
|---|---|
| `POLICY_AUD` | Cloudflare Access policy audience tag |
| `TEAM_DOMAIN` | Cloudflare Access team URL or full `/cdn-cgi/access/certs` URL |
| `GMAIL_CLIENT_ID` | Google OAuth2 client ID (optional, for Gmail sync) |
| `GMAIL_CLIENT_SECRET` | Google OAuth2 client secret (optional, for Gmail sync) |
| `GMAIL_REFRESH_TOKEN` | Google OAuth2 refresh token (optional, for Gmail sync) |

## Production Setup

### 1. Cloudflare Access (Required)

Enable [one-click Cloudflare Access](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/) on your Worker under Settings > Domains & Routes. The modal shows your `POLICY_AUD` and `TEAM_DOMAIN` values -- set these as Worker secrets.

### 2. Email Routing

In the Cloudflare dashboard, go to your domain > Email Routing and create a catch-all rule that forwards to this Worker.

### 3. Email Service

The worker needs the `send_email` binding to send outbound emails. See [Email Service docs](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/).

### 4. Create a Mailbox

Visit your deployed app and create a mailbox for any address on your domain (e.g. `hello@example.com`).

## MCP Integration

The MCP server is available at `/mcp` and exposes these tools:

| Tool | Description |
|---|---|
| `list_mailboxes` | List all available mailboxes |
| `list_emails` | List emails in a folder with pagination |
| `get_email` | Get full email content by ID |
| `get_thread` | Get all messages in a conversation thread |
| `search_emails` | Search across subject and body fields |
| `draft_reply` | Draft a reply (saves to Drafts, does not send) |
| `create_draft` | Create a new draft email |
| `update_draft` | Update an existing draft |
| `delete_email` | Permanently delete an email |
| `send_reply` | Send a reply to an existing email |
| `send_email` | Send a new outbound email |
| `mark_email_read` | Mark an email as read/unread |
| `move_email` | Move an email between folders |

Connect from Claude Code, Cursor, or any MCP-compatible client by pointing to the `/mcp` endpoint with a `mailboxId` parameter.

## Troubleshooting

**"Invalid or expired Access token"**
- `POLICY_AUD` or `TEAM_DOMAIN` secrets are incorrect. [Turn Access off and back on](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/) to get fresh values, then reset the secrets.

**"Cloudflare Access must be configured in production"**
- Access is not enabled. Enable it via [one-click Cloudflare Access for Workers](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/), then set the required secrets.

## Prerequisites

- Cloudflare account with a domain
- [Email Routing](https://developers.cloudflare.com/email-routing/) enabled for receiving
- [Email Service](https://developers.cloudflare.com/email-service/) enabled for sending
- [Workers AI](https://developers.cloudflare.com/workers-ai/) enabled (for the agent)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) configured (required in production)

> Any user who passes the shared Cloudflare Access policy can access all mailboxes in this app. The MCP server at `/mcp` is accessible to any authenticated user. There is no per-mailbox authorization -- the Cloudflare Access policy is the single trust boundary.

## License

Apache 2.0 -- see [LICENSE](LICENSE).

Original project: [cloudflare/agentic-inbox](https://github.com/cloudflare/agentic-inbox)
