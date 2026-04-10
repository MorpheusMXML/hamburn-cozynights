# 🛠️ Development & Operations

This guide covers how to maintain, test, and update the Hamburn Cozynights application.

## 1. Environment Setup

Copy `.env.example` to `.env` and fill in the following:
- `PUBLIC_PB_URL`: The URL of your PocketBase instance.
- `ENCRYPTION_KEY`: A 64-character hex string (32 bytes).
- `PB_ADMIN_EMAIL`: Your superuser email.
- `PB_ADMIN_PASSWORD`: Your superuser password.

To generate a new key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 2. Database Migrations

If the database schema changes, you may need to run these scripts:

- **Update Schema:** Adds new fields like `order_hash` and `is_locked`.
  ```bash
  npx tsx scripts/add_security_fields.ts
  ```
- **Encrypt Data:** Migrates existing plaintext data to the encrypted format.
  ```bash
  npx tsx scripts/encrypt_db_migration.ts
  ```

*Note: These scripts automatically detect if you are using PocketBase v0.23+ (Superusers) or an older version.*

## 3. Testing Suite

We use two types of testing to ensure the app is robust:

### Unit & Security Tests (Vitest)
Checks the core logic like encryption, hashing, and server-side actions.
```bash
npm run test       # Run once
npm run test:ui    # Open visual Vitest dashboard
```

### End-to-End Tests (Playwright)
Simulates a real user journey: logging in, navigating the map, booking a bed, and releasing it.
```bash
npm run test:e2e      # Run in terminal
npm run test:e2e:ui   # Open professional visual dashboard 📊
```

## 4. Backups & Portability

Since `pb_data` is ignored by Git, use these scripts to manage your database state:

- **Backup:** Compress and encrypt the local database.
  ```bash
  ./scripts/encrypt_data.sh
  ```
- **Restore:** Decrypt and extract an existing backup.
  ```bash
  ./scripts/decrypt_data.sh
  ```

**Important:** Always run the backup script and commit the resulting `.gpg` file before finishing your session if you've made database changes you want to save.
