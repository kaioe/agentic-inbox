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
 * All dates are displayed in a configurable timezone (defaults to UTC).
 * Change DISPLAY_TZ below to your preferred IANA timezone
 * (e.g. "Australia/Brisbane", "America/New_York", "Europe/London").
 */

import { format, parseISO } from "date-fns";
import { toZonedTime } from "date-fns-tz";

/**
 * Timezone for displaying dates.
 * Defaults to "UTC" -- change to your preferred IANA timezone.
 */
const DISPLAY_TZ = "UTC";

/** Parse safely -- returns null on invalid dates instead of NaN-date. */
function safeParse(dateStr: string | undefined | null): Date | null {
	if (!dateStr) return null;
	try {
		const d = new Date(dateStr);
		return isNaN(d.getTime()) ? null : d;
	} catch {
		return null;
	}
}

/** Helper to convert a Date to the display timezone for formatting. */
function toDisplayTime(date: Date): Date {
	return toZonedTime(date, DISPLAY_TZ);
}

/**
 * Email list rows.
 * - Today: "3:42 PM"
 * - This year: "Apr 15"
 * - Older: "Apr 15, 2024"
 */
export function formatListDate(dateStr: string): string {
	const date = safeParse(dateStr);
	if (!date) return dateStr;

	const displayDate = toDisplayTime(date);
	const now = toDisplayTime(new Date());

	if (displayDate.toDateString() === now.toDateString()) {
		return format(displayDate, "h:mm a");
	}
	if (displayDate.getFullYear() === now.getFullYear()) {
		return format(displayDate, "MMM d");
	}
	return format(displayDate, "MMM d, yyyy");
}

/**
 * Email detail header.
 * "Tue, Apr 15, 3:42 PM"
 */
export function formatDetailDate(dateStr: string): string {
	const date = safeParse(dateStr);
	if (!date) return dateStr;

	const displayDate = toDisplayTime(date);
	return format(displayDate, "EEE, MMM d, h:mm a");
}

/**
 * Thread message headers -- time only.
 * "3:42 PM"
 */
export function formatShortDate(dateStr: string): string {
	const date = safeParse(dateStr);
	if (!date) return dateStr;

	const displayDate = toDisplayTime(date);
	return format(displayDate, "h:mm a");
}

/**
 * Compose quoted replies & backend quoted blocks.
 * "Tue, Apr 15, 2026, 3:42 PM"
 */
export function formatQuotedDate(dateStr: string | undefined): string {
	if (!dateStr) return "";
	const date = safeParse(dateStr);
	if (!date) return dateStr;

	const displayDate = toDisplayTime(date);
	return format(displayDate, "EEE, MMM d, yyyy, h:mm a");
}
