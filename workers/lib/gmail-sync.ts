// Gmail API sync — fetches emails from a Gmail account via Google OAuth2
// and stores them in the Mailbox Durable Object using the same format as
// the inbound `receiveEmail()` handler in workers/index.ts.

import { storeAttachments, type StoredAttachment } from "./attachments";
import { Folders } from "../../shared/folders";
import type { Env, MailboxDO } from "../types";

// ── Gmail API helpers (pure fetch, no dependencies) ───────────────

/**
 * Exchange a refresh token for a fresh access token.
 */
async function getAccessToken(env: Env): Promise<string> {
	const resp = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.GMAIL_CLIENT_ID!,
			client_secret: env.GMAIL_CLIENT_SECRET!,
			refresh_token: env.GMAIL_REFRESH_TOKEN!,
			grant_type: "refresh_token",
		}),
	});
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Gmail OAuth token exchange failed: ${resp.status} ${text}`);
	}
	const data = (await resp.json()) as { access_token: string };
	return data.access_token;
}

/**
 * Call the Gmail API with auto-auth.
 */
async function gmailFetch(env: Env, path: string, init?: RequestInit): Promise<any> {
	const token = await getAccessToken(env);
	const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			...(init?.headers as Record<string, string> | undefined),
		},
	});
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Gmail API error ${resp.status}: ${text}`);
	}
	return resp.json();
}

// ── Parsing helpers ───────────────────────────────────────────────

interface GmailMessage {
	id: string;
	threadId: string;
	labelIds?: string[];
	historyId?: string;
	payload?: GmailMessagePart;
	internalDate?: string;
	sizeEstimate?: number;
	snippet?: string;
	raw?: string;
}

interface GmailMessagePart {
	partId?: string;
	mimeType?: string;
	filename?: string;
	headers?: { name: string; value: string }[];
	body?: { attachmentId?: string; size?: number; data?: string };
	parts?: GmailMessagePart[];
}

function getHeader(headers: { name: string; value: string }[] | undefined, name: string): string {
	const h = headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
	return h?.value || "";
}

/**
 * Recursively collect all attachment parts from a Gmail message.
 */
function collectAttachmentParts(part: GmailMessagePart | undefined, results: { part: GmailMessagePart; filename: string; mimeType: string }[] = []): { part: GmailMessagePart; filename: string; mimeType: string }[] {
	if (!part) return results;
	if (part.body?.attachmentId && part.filename) {
		results.push({ part, filename: part.filename, mimeType: part.mimeType || "application/octet-stream" });
	}
	if (part.parts) {
		for (const sub of part.parts) {
			collectAttachmentParts(sub, results);
		}
	}
	return results;
}

/**
 * Extract the text/html body from a Gmail message payload.
 * Prefers HTML over plain text.
 */
function extractBody(part: GmailMessagePart | undefined): { html: string; text: string } {
	let html = "";
	let text = "";
	if (!part) return { html, text };

	function walk(p: GmailMessagePart) {
		const mime = (p.mimeType || "").toLowerCase();
		if (p.body?.data && !p.filename) {
			if (mime === "text/html") {
				html = base64urlDecode(p.body.data);
			} else if (mime === "text/plain") {
				text = base64urlDecode(p.body.data);
			}
		}
		if (p.parts) {
			for (const sub of p.parts) walk(sub);
		}
	}
	walk(part);
	return { html, text };
}

function base64urlDecode(str: string): string {
	// Gmail uses URL-safe base64
	const padded = str.replace(/-/g, "+").replace(/_/g, "/");
	const decoded = atob(padded);
	// Try to decode as UTF-8
	try {
		return new TextDecoder("utf-8").decode(Uint8Array.from(decoded, (c) => c.charCodeAt(0)));
	} catch {
		return decoded;
	}
}

function extractMsgId(s: string): string {
	const m = s.match(/<([^>]+)>/);
	return m ? m[1] : s.trim().split(/\s+/)[0];
}

// ── Main sync logic ───────────────────────────────────────────────

export interface SyncResult {
	fetched: number;
	inserted: number;
	duplicates: number;
	errors: string[];
}

/**
 * Sync new (unseen) emails from Gmail into the Mailbox Durable Object.
 *
 * @param env         - Worker environment (needs GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)
 * @param mailboxId   - The mailbox email address (used as DO name, e.g. "oss@bjjlotusclub.com")
 * @param maxMessages - Maximum number of messages to fetch per sync (default 20)
 */
export async function syncGmailInbox(
	env: Env,
	mailboxId: string,
	maxMessages: number = 20,
): Promise<SyncResult> {
	const result: SyncResult = { fetched: 0, inserted: 0, duplicates: 0, errors: [] };

	// Verify Gmail secrets are configured
	if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
		throw new Error(
			"Gmail sync not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN secrets.",
		);
	}

	// Check mailbox exists
	const key = `mailboxes/${mailboxId}.json`;
	if (!(await env.BUCKET.head(key))) {
		throw new Error(`Mailbox "${mailboxId}" does not exist. Create it first via POST /api/v1/mailboxes.`);
	}

	// Get the MailboxDO stub
	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));

	try {
		// Fetch UNREAD messages from Gmail
		const data = await gmailFetch(
			env,
			`/messages?q=is:unread&maxResults=${maxMessages}`,
		);

		const messages: { id: string; threadId: string }[] = data.messages || [];
		result.fetched = messages.length;

		if (messages.length === 0) {
			console.log(`[Gmail Sync] No unread messages for ${mailboxId}`);
			return result;
		}

		console.log(`[Gmail Sync] Found ${messages.length} unread messages. Syncing...`);

		for (const msg of messages) {
			try {
				// Fetch full message with format=full to get payload
				const full: GmailMessage = await gmailFetch(env, `/messages/${msg.id}?format=full`);

				// Generate a local ID for the email (deterministic from Gmail ID)
				const emailId = `gmail-${full.id}`;

				// Skip if we already imported this email (PK-safe check)
				const existing = await (stub as any).emailExists(emailId);
				if (existing) {
					result.duplicates++;
					continue;
				}

				// Extract body
				const { html, text } = extractBody(full.payload);
				const body = html || text || full.snippet || "";

				// Extract headers
				const subject = getHeader(full.payload?.headers, "Subject") || "(no subject)";
				const from = getHeader(full.payload?.headers, "From") || "";
				const to = getHeader(full.payload?.headers, "To") || "";
				const cc = getHeader(full.payload?.headers, "Cc") || null;
				const bcc = getHeader(full.payload?.headers, "Bcc") || null;
				const date = getHeader(full.payload?.headers, "Date") || new Date(Number(full.internalDate)).toISOString();
				const inReplyTo = getHeader(full.payload?.headers, "In-Reply-To");
				const references = getHeader(full.payload?.headers, "References");

				// Build raw_headers for storage
				const rawHeaders = (full.payload?.headers || []).map((h) => ({ key: h.name, value: h.value }));

				// Parse references for threading
				const emailReferences = references
					? references.split(/\s+/).filter(Boolean).map(extractMsgId)
					: [];
				const threadId = full.threadId || msg.id;
				let localThreadId = emailReferences[0] || (inReplyTo ? extractMsgId(inReplyTo) : null) || threadId;

				// Try subject-based threading for emails without references
				if (!inReplyTo && emailReferences.length === 0) {
					const subjectThread = await (stub as any).findThreadBySubject(subject, from);
					if (subjectThread) localThreadId = subjectThread;
				}

				// Download and store attachments
				const attachmentParts = collectAttachmentParts(full.payload);
				const attachmentData: StoredAttachment[] = [];
				for (const att of attachmentParts) {
					try {
						const attResp = await gmailFetch(env, `/messages/${full.id}/attachments/${att.part.body?.attachmentId}`);
						const rawContent = base64urlDecode(attResp.data || "");

						const attId = crypto.randomUUID();
						const filename = att.filename.replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");

						await env.BUCKET.put(`attachments/${emailId}/${attId}/${filename}`, rawContent);
						attachmentData.push({
							id: attId,
							email_id: emailId,
							filename,
							mimetype: att.mimeType,
							size: rawContent.length,
							content_id: null,
							disposition: "attachment",
						});
					} catch (attErr: any) {
						result.errors.push(`Attachment download failed for ${att.filename}: ${attErr.message}`);
					}
				}

				const gmailMessageId = getHeader(full.payload?.headers, "Message-ID") || null;
				// Create the email in the DO (same format as receiveEmail)
				await stub.createEmail(Folders.INBOX, {
					id: emailId,
					subject,
					sender: from.toLowerCase(),
					recipient: to.toLowerCase(),
					cc: cc?.toLowerCase() || null,
					bcc: bcc?.toLowerCase() || null,
					date: new Date(date).toISOString() || new Date().toISOString(),
					body,
					in_reply_to: inReplyTo ? extractMsgId(inReplyTo) : null,
					email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
					thread_id: localThreadId,
					message_id: gmailMessageId,
					raw_headers: JSON.stringify(rawHeaders),
				}, attachmentData);

				result.inserted++;

				// Mark as READ in Gmail after successful import
				await gmailFetch(env, `/messages/${full.id}/modify`, {
					method: "POST",
					body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
				});

				console.log(`[Gmail Sync] Imported: "${subject}" (${full.id})`);

			} catch (msgErr: any) {
				console.error(`[Gmail Sync] Error processing message ${msg.id}:`, msgErr.message);
				result.errors.push(`Message ${msg.id}: ${msgErr.message}`);
			}
		}

		console.log(`[Gmail Sync] Complete: ${result.inserted} imported, ${result.duplicates} duplicates, ${result.errors.length} errors`);
		return result;

	} catch (error: any) {
		console.error(`[Gmail Sync] Fatal error:`, error.message);
		throw error;
	}
}
