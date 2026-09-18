# Baseline E2E Test Suite Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diagnose and fix the admin login timeout in the `booking-extended.test.ts` E2E test to ensure a stable baseline for deployments.

**Architecture:** We will add telemetry to the server and the test itself to identify the root cause of the login hang. Once identified, we will apply the fix (either server-side or test-side).

**Tech Stack:** Playwright, PocketBase JS SDK, SvelteKit.

---

### Task 1: Add Diagnostic Telemetry

**Files:**
- Modify: `hamburn-cozynights/src/routes/admin/login/+page.server.ts`
- Modify: `hamburn-cozynights/tests/e2e/booking-extended.test.ts`

- [ ] **Step 1: Add detailed logging to the login action**
Add logs to see which email is being used and which auth branch succeeds or fails.

```typescript
// Modify: hamburn-cozynights/src/routes/admin/login/+page.server.ts
// Add this in the login action:
console.log(`[Login Attempt] Email: ${email}`);
// ... in the catch branches ...
console.error(`[Login Error] User auth failed for ${email}`);
console.error(`[Login Error] Superuser auth failed for ${email}`);
```

- [ ] **Step 2: Update the test to handle login errors explicitly**
Instead of waiting blindly for a URL, click and then check the page state or wait for a specific success indicator.

```typescript
// Modify: hamburn-cozynights/tests/e2e/booking-extended.test.ts
// Replace the admin login part with:
await adminPage.click('button[type="submit"]');
// Check for immediate failure
const errorBanner = adminPage.locator('.error-banner');
if (await errorBanner.isVisible()) {
    const msg = await errorBanner.innerText();
    throw new Error(`Admin Login Failed: ${msg}`);
}
await adminPage.waitForURL('/admin', { timeout: 10000 });
```

- [ ] **Step 3: Run the tests to capture the error**
Run: `npm run test:setup && npx playwright test tests/e2e/booking-extended.test.ts --project=chromium`
Expected: FAIL, but with a clear error message in the logs.

---

### Task 2: Implement Fix and Verify

**Files:**
- Modify: `hamburn-cozynights/src/routes/admin/login/+page.server.ts` (if needed)
- Modify: `hamburn-cozynights/tests/e2e/booking-extended.test.ts`

- [ ] **Step 1: Apply the root cause fix**
(Assuming the fix is related to auth logic or env vars).

- [ ] **Step 2: Run all E2E tests**
Run: `npx playwright test tests/e2e/booking-extended.test.ts --project=chromium`
Expected: PASS

- [ ] **Step 3: Commit and Cleanup**
Remove diagnostic console.logs and commit.
Run: `git add . && git commit -m "test: fix admin login timeout in e2e baseline"`
```bash
git add .
git commit -m "test: fix admin login timeout in e2e baseline"
```