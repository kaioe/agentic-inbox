// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;

	// Gmail API sync (set via wrangler secret put)
	GMAIL_CLIENT_ID?: string;
	GMAIL_CLIENT_SECRET?: string;
	GMAIL_REFRESH_TOKEN?: string;
}

export { MailboxDO } from "./durableObject";
