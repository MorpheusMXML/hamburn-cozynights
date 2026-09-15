// PocketBase record IDs must be exactly 15 lowercase alphanumeric characters.
// The previous literal 'abcsettings123' (14 chars) fails validation on any
// fresh PocketBase instance, permanently blocking the singleton app_settings
// record from ever being created.
export const APP_SETTINGS_ID = 'appsettings0123';
