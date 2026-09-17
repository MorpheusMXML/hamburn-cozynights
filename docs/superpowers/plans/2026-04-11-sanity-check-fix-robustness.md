# Sanity Check Usability Fix & Telemetry Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the issue where saving data in the Sanity Check "Fix" modal doesn't update the database. Ensure the flow is robust, errors are displayed, and database updates are verified.

**Architecture:** We will ensure IDs are passed explicitly in form data to avoid reliance on URL params in cross-page actions. We will also add error handling to the modal and logging to the server to trace the failure.

**Tech Stack:** Svelte, SvelteKit, PocketBase.

---

### Task 1: Ensure Explicit ID Passing in Forms

**Files:**
- Modify: `hamburn-cozynights/src/lib/components/admin/AddRoomForm.svelte`
- Modify: `hamburn-cozynights/src/lib/components/admin/AddBedForm.svelte`

- [ ] **Step 1: Pass houseId/roomId in AddRoomForm explicitly**
Ensure the hidden input is correctly used and the action can read it.

- [ ] **Step 2: Pass roomId in AddBedForm explicitly**
Already exists, but ensure it's named consistently with what the action expects.

---

### Task 2: Robust Server Actions for Cross-Page Posting

**Files:**
- Modify: `hamburn-cozynights/src/routes/admin/house/[id]/+page.server.ts`
- Modify: `hamburn-cozynights/src/routes/admin/room/[id]/+page.server.ts`

- [ ] **Step 1: Update createRoom to prefer form data for houseId**
Modify `createRoom` action to check `data.get('houseId')` before falling back to `params.id`.

```typescript
// src/routes/admin/house/[id]/+page.server.ts
createRoom: async ({ request, locals, params }) => {
    // ...
    const data = await request.formData();
    const houseId = (data.get('houseId') as string) || params.id;
    // ...
}
```

- [ ] **Step 2: Update createBed to prefer form data for roomId**
Modify `createBed` action to check `data.get('roomId')` before falling back to `params.id`.

```typescript
// src/routes/admin/room/[id]/+page.server.ts
createBed: async ({ request, params, locals }) => {
    // ...
    const data = await request.formData();
    const roomId = (data.get('roomId') as string) || params.id;
    // ...
}
```

---

### Task 3: Improve Modal Feedback and UX

**Files:**
- Modify: `hamburn-cozynights/src/lib/components/admin/SanityChecks.svelte`

- [ ] **Step 1: Add error state and display to the modal**
Capture non-success results and show a message to the user.

- [ ] **Step 2: Add loading state to the "Solve" button**
Prevent multiple clicks and give feedback during submission.

---

### Task 4: Verification and Documentation

- [ ] **Step 1: Write an E2E test for the Sanity Check Fix flow**
Create `hamburn-cozynights/tests/e2e/sanity-fix.test.ts` to verify the modal works and DB is updated.

- [ ] **Step 2: Update documentation**
Note the cross-page action pattern in `WORKFLOW.md`.

- [ ] **Step 3: Run verification tests**
```bash
npm run test:setup
npm run test:e2e -- tests/e2e/sanity-fix.test.ts
```