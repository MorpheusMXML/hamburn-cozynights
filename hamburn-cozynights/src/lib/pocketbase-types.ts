/**
 * This file was @generated using pocketbase-typegen
 */

import type PocketBase from 'pocketbase';
import type { RecordService } from 'pocketbase';

export enum Collections {
	Authorigins = '_authOrigins',
	Externalauths = '_externalAuths',
	Mfas = '_mfas',
	Otps = '_otps',
	Superusers = '_superusers',
	Admins = 'admins',
	Beds = 'beds',
	Houses = 'houses',
	Orders = 'orders',
	Rooms = 'rooms',
	Users = 'users',
	AppSettings = 'app_settings',
	GuestNotify = 'guest_notify',
	AdminEvents = 'admin_events',
	MessageTexts = 'message_texts',
	SpecialRequests = 'special_requests'
}

// Alias types for improved usability
export type IsoDateString = string;
export type IsoAutoDateString = string & { readonly autodate: unique symbol };
export type RecordIdString = string;
export type FileNameString = string & { readonly filename: unique symbol };
export type HTMLString = string;

type ExpandType<T> = unknown extends T
	? T extends unknown
		? { expand?: unknown }
		: { expand: T }
	: { expand: T };

// System fields
export type BaseSystemFields<T = unknown> = {
	id: RecordIdString;
	collectionId: string;
	collectionName: Collections;
} & ExpandType<T>;

export type AuthSystemFields<T = unknown> = {
	email: string;
	emailVisibility: boolean;
	username: string;
	verified: boolean;
} & BaseSystemFields<T>;

// Record types for each collection

export type AuthoriginsRecord = {
	collectionRef: string;
	created: IsoAutoDateString;
	fingerprint: string;
	id: string;
	recordRef: string;
	updated: IsoAutoDateString;
};

export type ExternalauthsRecord = {
	collectionRef: string;
	created: IsoAutoDateString;
	id: string;
	provider: string;
	providerId: string;
	recordRef: string;
	updated: IsoAutoDateString;
};

export type MfasRecord = {
	collectionRef: string;
	created: IsoAutoDateString;
	id: string;
	method: string;
	recordRef: string;
	updated: IsoAutoDateString;
};

export type OtpsRecord = {
	collectionRef: string;
	created: IsoAutoDateString;
	id: string;
	password: string;
	recordRef: string;
	sentTo?: string;
	updated: IsoAutoDateString;
};

export type SuperusersRecord = {
	created: IsoAutoDateString;
	email: string;
	emailVisibility?: boolean;
	id: string;
	password: string;
	tokenKey: string;
	updated: IsoAutoDateString;
	verified?: boolean;
};

export enum AdminsRoleOptions {
	superuser = 'superuser',
	admin = 'admin'
}
export type AdminsRecord = {
	created: IsoAutoDateString;
	email: string;
	emailVisibility?: boolean;
	id: string;
	last_sign_in?: IsoDateString;
	name?: string;
	password: string;
	role: AdminsRoleOptions;
	tokenKey: string;
	updated: IsoAutoDateString;
	verified?: boolean;
};

export type BedsRecord = {
	created: IsoAutoDateString;
	enabled?: boolean;
	id: string;
	label?: string;
	occupied?: boolean;
	order?: RecordIdString;
	room: RecordIdString;
	updated: IsoAutoDateString;
	is_locked?: boolean;
	is_special?: boolean;
	/** When the spot got its ticket; set and cleared by PocketBase (pb_hooks/cozy_booked.pb.js). */
	booked_at?: IsoDateString;
	/** When the crew checked the guest in at arrival; gone with the booking (pb_hooks/cozy_booked.pb.js). */
	checked_in_at?: IsoDateString;
	/** The admin who checked the guest in (e-mail). */
	checked_in_by?: string;
	/** What kind of bed this spot is (src/lib/accommodation.ts); empty = not specified. */
	bed_type?: string;
	/** What is true for this spot itself; it inherits its room's and house's features. */
	features?: string[];
};

export type HousesRecord = {
	created: IsoAutoDateString;
	id: string;
	name: string;
	occupied?: boolean;
	updated: IsoAutoDateString;
	x?: number;
	y?: number;
	/** House, hut group, tent area or something else (src/lib/accommodation.ts). */
	kind?: string;
	/** What is true for the whole building or cluster; its rooms and spots inherit it. */
	features?: string[];
	/** Free text for what only this venue knows, shown to guests. */
	description?: string;
};

export type OrdersRecord = {
	booking_date?: IsoDateString;
	created: IsoAutoDateString;
	customer_name: string;
	burner_name?: string;
	email?: string;
	id: string;
	order_number: string;
	pass_code?: string;
	order_hash?: string;
	updated: IsoAutoDateString;
};

export type RoomsRecord = {
	amount_beds?: number;
	created: IsoAutoDateString;
	house: RecordIdString;
	id: string;
	name: string;
	occupied?: boolean;
	room_number: number;
	updated: IsoAutoDateString;
	/** Room, hut, tent or something else (src/lib/accommodation.ts). */
	kind?: string;
	/** What is true for this room; its spots inherit it, on top of the house's features. */
	features?: string[];
	/** Free text for what only this venue knows, shown to guests. */
	description?: string;
};

export type UsersRecord = {
	avatar?: FileNameString;
	created: IsoAutoDateString;
	email: string;
	emailVisibility?: boolean;
	id: string;
	name?: string;
	password: string;
	tokenKey: string;
	updated: IsoAutoDateString;
	verified?: boolean;
};

export type AppSettingsRecord = {
	created: IsoAutoDateString;
	id: string;
	is_booking_active?: boolean;
	booking_unlock_at?: IsoDateString;
	booking_close_at?: IsoDateString;
	booking_timer_paused?: boolean;
	booking_closed?: boolean;
	notify_mail?: boolean;
	telegram_bot?: string;
	special_requests_open?: boolean;
	updated: IsoAutoDateString;
};

export type GuestNotifyRecord = {
	attempts?: number;
	created: IsoAutoDateString;
	due?: IsoDateString;
	id: string;
	last_error?: string;
	mail_label?: string;
	mail_req?: string;
	mail_sent?: IsoDateString;
	mail_spot?: string;
	mail_to?: string;
	order: RecordIdString;
	tg_chat?: string;
	tg_label?: string;
	tg_new?: boolean;
	tg_req?: string;
	tg_sent?: IsoDateString;
	tg_spot?: string;
	tg_token_exp?: IsoDateString;
	tg_token_hash?: string;
	updated: IsoAutoDateString;
};

export enum AdminEventsAlertStatusOptions {
	pending = 'pending',
	sent = 'sent',
	failed = 'failed',
	off = 'off'
}
export type AdminEventsRecord<Tdetails = unknown> = {
	action: string;
	actor?: string;
	alert_attempts?: number;
	alert_error?: string;
	alert_status?: AdminEventsAlertStatusOptions;
	created: IsoAutoDateString;
	details?: null | Tdetails;
	id: string;
	subject?: string;
	updated: IsoAutoDateString;
};

export enum SpecialRequestsStatusOptions {
	pending = 'pending',
	approved = 'approved',
	declined = 'declined'
}
export type SpecialRequestsRecord = {
	bed?: RecordIdString;
	burner_name?: string;
	consent_at: IsoDateString;
	created: IsoAutoDateString;
	decided_at?: IsoDateString;
	decided_by?: string;
	id: string;
	needs?: string;
	order: RecordIdString;
	reason?: string;
	status: SpecialRequestsStatusOptions;
	updated: IsoAutoDateString;
};

export type MessageTextsRecord = {
	created: IsoAutoDateString;
	id: string;
	key: string;
	text: string;
	updated: IsoAutoDateString;
	updated_by?: string;
};

// Response types include system fields and match responses from the PocketBase API
export type AuthoriginsResponse<Texpand = unknown> = Required<AuthoriginsRecord> &
	BaseSystemFields<Texpand>;
export type ExternalauthsResponse<Texpand = unknown> = Required<ExternalauthsRecord> &
	BaseSystemFields<Texpand>;
export type MfasResponse<Texpand = unknown> = Required<MfasRecord> & BaseSystemFields<Texpand>;
export type OtpsResponse<Texpand = unknown> = Required<OtpsRecord> & BaseSystemFields<Texpand>;
export type SuperusersResponse<Texpand = unknown> = Required<SuperusersRecord> &
	AuthSystemFields<Texpand>;
export type AdminsResponse<Texpand = unknown> = Required<AdminsRecord> & AuthSystemFields<Texpand>;
export type BedsResponse<Texpand = unknown> = Required<BedsRecord> & BaseSystemFields<Texpand>;
export type HousesResponse<Texpand = unknown> = Required<HousesRecord> & BaseSystemFields<Texpand>;
export type OrdersResponse<Texpand = unknown> = Required<OrdersRecord> & BaseSystemFields<Texpand>;
export type RoomsResponse<Texpand = unknown> = Required<RoomsRecord> & BaseSystemFields<Texpand>;
export type UsersResponse<Texpand = unknown> = Required<UsersRecord> & AuthSystemFields<Texpand>;
export type AppSettingsResponse<Texpand = unknown> = Required<AppSettingsRecord> &
	BaseSystemFields<Texpand>;
export type GuestNotifyResponse<Texpand = unknown> = Required<GuestNotifyRecord> &
	BaseSystemFields<Texpand>;
export type AdminEventsResponse<Tdetails = unknown, Texpand = unknown> = Required<
	AdminEventsRecord<Tdetails>
> &
	BaseSystemFields<Texpand>;
export type SpecialRequestsResponse<Texpand = unknown> = Required<SpecialRequestsRecord> &
	BaseSystemFields<Texpand>;
export type MessageTextsResponse<Texpand = unknown> = Required<MessageTextsRecord> &
	BaseSystemFields<Texpand>;

// Types containing all Records and Responses, useful for creating typing helper functions

export type CollectionRecords = {
	_authOrigins: AuthoriginsRecord;
	_externalAuths: ExternalauthsRecord;
	_mfas: MfasRecord;
	_otps: OtpsRecord;
	_superusers: SuperusersRecord;
	admins: AdminsRecord;
	beds: BedsRecord;
	houses: HousesRecord;
	orders: OrdersRecord;
	rooms: RoomsRecord;
	users: UsersRecord;
	app_settings: AppSettingsRecord;
	guest_notify: GuestNotifyRecord;
	admin_events: AdminEventsRecord;
	special_requests: SpecialRequestsRecord;
	message_texts: MessageTextsRecord;
};

export type CollectionResponses = {
	_authOrigins: AuthoriginsResponse;
	_externalAuths: ExternalauthsResponse;
	_mfas: MfasResponse;
	_otps: OtpsResponse;
	_superusers: SuperusersResponse;
	admins: AdminsResponse;
	beds: BedsResponse;
	houses: HousesResponse;
	orders: OrdersResponse;
	rooms: RoomsResponse;
	users: UsersResponse;
	app_settings: AppSettingsResponse;
	guest_notify: GuestNotifyResponse;
	admin_events: AdminEventsResponse;
	special_requests: SpecialRequestsResponse;
	message_texts: MessageTextsResponse;
};

// Utility types for create/update operations

type ProcessCreateAndUpdateFields<T> = Omit<
	{
		// Omit AutoDate fields
		[
			K in keyof T as Extract<T[K], IsoAutoDateString> extends never ? K : never
		]: T[K] extends infer U // Convert FileNameString to File
			? U extends FileNameString | FileNameString[]
				? U extends any[]
					? File[]
					: File
				: U
			: never;
	},
	'id'
>;

// Create type for Auth collections
export type CreateAuth<T> = {
	id?: RecordIdString;
	email: string;
	emailVisibility?: boolean;
	password: string;
	passwordConfirm: string;
	verified?: boolean;
} & ProcessCreateAndUpdateFields<T>;

// Create type for Base collections
export type CreateBase<T> = {
	id?: RecordIdString;
} & ProcessCreateAndUpdateFields<T>;

// Update type for Auth collections
export type UpdateAuth<T> = Partial<
	Omit<ProcessCreateAndUpdateFields<T>, keyof AuthSystemFields>
> & {
	email?: string;
	emailVisibility?: boolean;
	oldPassword?: string;
	password?: string;
	passwordConfirm?: string;
	verified?: boolean;
};

// Update type for Base collections
export type UpdateBase<T> = Partial<Omit<ProcessCreateAndUpdateFields<T>, keyof BaseSystemFields>>;

// Get the correct create type for any collection
export type Create<T extends keyof CollectionResponses> =
	CollectionResponses[T] extends AuthSystemFields
		? CreateAuth<CollectionRecords[T]>
		: CreateBase<CollectionRecords[T]>;

// Get the correct update type for any collection
export type Update<T extends keyof CollectionResponses> =
	CollectionResponses[T] extends AuthSystemFields
		? UpdateAuth<CollectionRecords[T]>
		: UpdateBase<CollectionRecords[T]>;

// Type for usage with type asserted PocketBase instance
// https://github.com/pocketbase/js-sdk#specify-typescript-definitions

export type TypedPocketBase = {
	collection<T extends keyof CollectionResponses>(
		idOrName: T
	): RecordService<CollectionResponses[T]>;
} & PocketBase;
