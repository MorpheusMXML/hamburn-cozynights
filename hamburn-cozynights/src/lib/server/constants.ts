// PocketBase record IDs must be exactly 15 lowercase alphanumeric characters.
// The previous literal 'abcsettings123' (14 chars) fails validation on any
// fresh PocketBase instance, permanently blocking the singleton app_settings
// record from ever being created.
export const APP_SETTINGS_ID = 'appsettings0123';

/**
 * The lock (withLock, $lib/server/booking) every write of the app to
 * app_settings runs under: PocketBase saves the whole record, so two writes
 * at once would undo each other. Taken last when combined with other locks.
 */
export const APP_SETTINGS_LOCK = 'app_settings';
