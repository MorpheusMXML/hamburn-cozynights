/**
 * Operator details for the legal pages (/legal-notice, /privacy, /booking-rules).
 *
 * They come from LEGAL_* variables in the server's .env, not from the
 * repository: the repository is public, and a postal address doesn't belong
 * in its history. Every environment (staging, production) sets its own; the
 * variables are listed in deploy/staging.env.template and docs/admin/legal.md.
 *
 * Multi-line values (address, hoster) separate their lines with "|".
 */
import { env } from '$env/dynamic/private';

export interface LegalInfo {
	/** Name of the person or organisation running the site, incl. legal form. */
	name: string;
	address: string[];
	/** Who represents the organisation, e.g. the board of an association. */
	representative: string;
	email: string;
	phone: string;
	/** Register court and number, e.g. "Amtsgericht Hamburg, VR 12345". */
	register: string;
	vatId: string;
	/** § 18 Abs. 2 MStV, only for journalistic-editorial content. */
	contentResponsible: string[];
	/** Contact for privacy requests; falls back to `email`. */
	privacyEmail: string;
	hoster: string[];
	supervisoryAuthority: string;
	logRetentionDays: number;
	/** When bookings, burner names and the ticket list are deleted. */
	deletionPeriod: string;
	/** The membership terms (published with the ticket shop), if there are any. */
	termsUrl: string;
	/** The event's code of conduct, if it has one online. */
	codeOfConductUrl: string;
	/** Required variables that are not set yet. */
	missing: string[];
}

export const REQUIRED_LEGAL_VARS = ['LEGAL_NAME', 'LEGAL_ADDRESS', 'LEGAL_EMAIL', 'LEGAL_HOSTER'];

const DEFAULT_LOG_RETENTION_DAYS = 14;
const DEFAULT_DELETION_PERIOD = 'at the latest four weeks after the end of the event';

/** Only plain web links; anything else (e.g. `javascript:`) is dropped. */
function webUrl(value: string): string {
	return /^https?:\/\/\S+$/i.test(value) ? value : '';
}

function lines(value: string): string[] {
	return value
		.split(/\s*(?:\||\\n|\n)\s*/)
		.map((line) => line.trim())
		.filter(Boolean);
}

export function parseLegalEnv(source: Record<string, string | undefined>): LegalInfo {
	const get = (key: string) => (source[key] ?? '').trim();
	const days = Number.parseInt(get('LEGAL_LOG_RETENTION_DAYS'), 10);
	return {
		name: get('LEGAL_NAME'),
		address: lines(get('LEGAL_ADDRESS')),
		representative: get('LEGAL_REPRESENTATIVE'),
		email: get('LEGAL_EMAIL'),
		phone: get('LEGAL_PHONE'),
		register: get('LEGAL_REGISTER'),
		vatId: get('LEGAL_VAT_ID'),
		contentResponsible: lines(get('LEGAL_CONTENT_RESPONSIBLE')),
		privacyEmail: get('LEGAL_PRIVACY_EMAIL') || get('LEGAL_EMAIL'),
		hoster: lines(get('LEGAL_HOSTER')),
		supervisoryAuthority: get('LEGAL_SUPERVISORY_AUTHORITY'),
		logRetentionDays: days > 0 ? days : DEFAULT_LOG_RETENTION_DAYS,
		deletionPeriod: get('LEGAL_DELETION_PERIOD') || DEFAULT_DELETION_PERIOD,
		termsUrl: webUrl(get('LEGAL_TERMS_URL')),
		codeOfConductUrl: webUrl(get('LEGAL_CODE_OF_CONDUCT_URL')),
		missing: REQUIRED_LEGAL_VARS.filter((key) => !get(key))
	};
}

let warned = false;

/** The operator details of this environment; warns once in the log when some are missing. */
export function getLegalInfo(): LegalInfo {
	const info = parseLegalEnv(env);
	if (info.missing.length && !warned) {
		warned = true;
		console.warn(
			`[legal] The legal pages are incomplete: set ${info.missing.join(', ')} in the server's .env`
		);
	}
	return info;
}
