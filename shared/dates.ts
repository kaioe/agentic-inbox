// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
// https://opensource.org/licenses/Apache-2.0

/**
 * Consolidated date formatting utilities.
 *
 * Previously spread across `app/lib/utils.ts` (4 functions) and
 * `workers/lib/html.ts` (`formatEmailDate`). Now one canonical set
 * imported by both the frontend and backend.
 *
 * All dates are displayed in **Australia/Brisbane (UTC+10)** timezone.
 */

import { format, formatDistanceToNow, parseISO } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const BRISBANE_TZ = "Australia/Brisbane";

/** Parse safely — returns null on invalid dates instead of NaN-date. */
function safeParse(dateStr: string | undefined | null): Date | null {
	if (!dateStr) return null;
	try {
		const d = new Date(dateStr);
		return isNaN(d.getTime()) ? null : d;
	} catch {
		return null;
	}
}

/** Helper to convert a Date to Brisbane time string for formatting. */
function toBrisbaneTime(date: Date): Date {
	return toZonedTime(date, BRISBANE_TZ);
}

/**
 * Email list rows.
 * - Today: "3:42 PM"
 * - This year: "Apr 15"
 * - Older: "Apr 15, 2024"
 * All times are in **Australia/Brisbane (UTC+10)**.
 */
export function formatListDate(dateStr: string): string {
	const date = safeParse(dateStr);
	if (!date) return dateStr;

	const brisbaneDate = toBrisbaneTime(date);
	const now = toBrisbaneTime(new Date());

	if (brisbaneDate.toDateString() === now.toDateString()) {
		return format(brisbaneDate, "h:mm a");
	}
	if (brisbaneDate.getFullYear() === now.getFullYear()) {
		return format(brisbaneDate, "MMM d");
	}
	return format(brisbaneDate, "MMM d, yyyy");
}

/**
 * Email detail header.
 * "Tue, Apr 15, 3:42 PM"
 * All times are in **Australia/Brisbane (UTC+10)**.
 */
export function formatDetailDate(dateStr: string): string {
	const date = safeParse(dateStr);
	if (!date) return dateStr;

	const brisbaneDate = toBrisbaneTime(date);
	return format(brisbaneDate, "EEE, MMM d, h:mm a");
}

/**
 * Thread message headers — time only.
 * "3:42 PM"
 * All times are in **Australia/Brisbane (UTC+10)**.
 */
export function formatShortDate(dateStr: string): string {
	const date = safeParse(dateStr);
	if (!date) return dateStr;

	const brisbaneDate = toBrisbaneTime(date);
	return format(brisbaneDate, "h:mm a");
}

/**
 * Compose quoted replies & backend quoted blocks.
 * "Tue, Apr 15, 2026, 3:42 PM"
 *
 * All times are in **Australia/Brisbane (UTC+10)**.
 */
export function formatQuotedDate(dateStr: string | undefined): string {
	if (!dateStr) return "";
	const date = safeParse(dateStr);
	if (!date) return dateStr;

	const brisbaneDate = toBrisbaneTime(date);
	return format(brisbaneDate, "EEE, MMM d, yyyy, h:mm a");
}
