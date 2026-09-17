<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import { fade, fly } from 'svelte/transition';

	export let data: PageData;
	export let form: ActionData;

	$: admins = data.admins;

	let inviting = false;
	let confirmingRevoke: string | null = null;
</script>

<div class="users-page" in:fly={{ y: 10, duration: 400 }}>
	<header class="page-header">
		<h1>ACCESS CONTROL 🔑</h1>
		<p class="subtitle">Only burners invited here can ever log in — no public sign-up exists.</p>
	</header>

	{#if form?.error}
		<div class="banner error" in:fade>🛑 {form.error}</div>
	{/if}
	{#if form?.success}
		<div class="banner success" in:fade>✅ {form.message}</div>
	{/if}

	<section class="invite-card">
		<h2>Invite a new admin</h2>
		<form
			method="POST"
			action="?/invite"
			class="invite-form"
			use:enhance={() => {
				inviting = true;
				return async ({ update }) => {
					inviting = false;
					await update();
				};
			}}
		>
			<input name="email" type="email" placeholder="burner@playa.com" required autocomplete="off" />
			<button type="submit" class="btn-ignite" disabled={inviting}>
				{inviting ? 'SENDING…' : 'SEND INVITE ✉️'}
			</button>
		</form>
		<p class="hint">
			They'll get an email with a link to choose their own passphrase. Links expire after 30 minutes
			— you can resend below if needed.
		</p>
	</section>

	<section class="list-card">
		<h2>Existing accounts ({admins.length})</h2>
		{#if admins.length === 0}
			<p class="empty">No admins yet. Invite yourself above to get started.</p>
		{:else}
			<div class="table">
				<div class="row head">
					<span>Email</span>
					<span>Status</span>
					<span>Invited</span>
					<span></span>
				</div>
				{#each admins as admin (admin.id)}
					<div class="row">
						<span class="email">{admin.email}</span>
						<span>
							{#if admin.verified}
								<span class="tag active">ACTIVE</span>
							{:else}
								<span class="tag pending">PENDING</span>
							{/if}
						</span>
						<span class="date">{new Date(admin.created).toLocaleDateString()}</span>
						<span class="actions">
							{#if !admin.verified}
								<form method="POST" action="?/resend" use:enhance>
									<input type="hidden" name="email" value={admin.email} />
									<button type="submit" class="btn-link">RESEND</button>
								</form>
							{/if}
							{#if confirmingRevoke === admin.id}
								<form method="POST" action="?/revoke" use:enhance>
									<input type="hidden" name="id" value={admin.id} />
									<button type="submit" class="btn-link danger">CONFIRM?</button>
								</form>
								<button type="button" class="btn-link" on:click={() => (confirmingRevoke = null)}
									>CANCEL</button
								>
							{:else}
								<button
									type="button"
									class="btn-link danger"
									on:click={() => (confirmingRevoke = admin.id)}>REVOKE</button
								>
							{/if}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.users-page {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		max-width: 900px;
	}

	.page-header h1 {
		font-size: 1.75rem;
		font-weight: 900;
		color: #fff;
		margin: 0;
		letter-spacing: -0.5px;
	}
	.subtitle {
		color: #666;
		font-size: 0.85rem;
		margin-top: 0.4rem;
	}

	.banner {
		padding: 0.9rem 1.2rem;
		border-radius: 10px;
		font-size: 0.85rem;
		font-weight: bold;
	}
	.banner.error {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: #f87171;
	}
	.banner.success {
		background: rgba(45, 212, 191, 0.1);
		border: 1px solid rgba(45, 212, 191, 0.3);
		color: #2dd4bf;
	}

	.invite-card,
	.list-card {
		background: #0f0f0f;
		border: 1px solid #222;
		border-radius: 16px;
		padding: 1.75rem;
	}

	h2 {
		font-size: 0.95rem;
		color: #fff;
		margin: 0 0 1rem 0;
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	.invite-form {
		display: flex;
		gap: 0.75rem;
	}
	.invite-form input {
		flex: 1;
		background: #050505;
		border: 1px solid #222;
		color: white;
		padding: 0.85rem 1rem;
		border-radius: 8px;
		font-size: 0.95rem;
	}
	.invite-form input:focus {
		outline: none;
		border-color: #2dd4bf;
		box-shadow: 0 0 15px rgba(45, 212, 191, 0.2);
	}

	.btn-ignite {
		background: #2dd4bf;
		color: #000;
		border: none;
		padding: 0.85rem 1.5rem;
		border-radius: 8px;
		font-weight: 900;
		cursor: pointer;
		font-size: 0.85rem;
		letter-spacing: 1px;
		white-space: nowrap;
		transition: all 0.2s;
	}
	.btn-ignite:hover {
		transform: scale(1.02);
	}
	.btn-ignite:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
	}

	.hint {
		color: #555;
		font-size: 0.75rem;
		margin: 0.75rem 0 0 0;
	}

	.empty {
		color: #555;
		font-size: 0.85rem;
	}

	.table {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: grid;
		grid-template-columns: 2fr 1fr 1fr 1.5fr;
		align-items: center;
		padding: 0.85rem 0;
		border-bottom: 1px solid #1a1a1a;
		gap: 1rem;
	}
	.row.head {
		font-size: 0.65rem;
		color: #555;
		text-transform: uppercase;
		letter-spacing: 1px;
		font-weight: 900;
	}
	.row:last-child {
		border-bottom: none;
	}
	.email {
		font-family: monospace;
		font-size: 0.85rem;
		color: #ddd;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.date {
		font-size: 0.75rem;
		color: #666;
	}

	.tag {
		font-size: 0.65rem;
		font-weight: 900;
		padding: 3px 8px;
		border-radius: 20px;
		letter-spacing: 0.5px;
	}
	.tag.active {
		background: rgba(45, 212, 191, 0.1);
		color: #2dd4bf;
		border: 1px solid rgba(45, 212, 191, 0.3);
	}
	.tag.pending {
		background: rgba(251, 191, 36, 0.1);
		color: #fbbf24;
		border: 1px solid rgba(251, 191, 36, 0.3);
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
	}
	.btn-link {
		background: none;
		border: none;
		color: #888;
		cursor: pointer;
		font-weight: 900;
		font-size: 0.7rem;
		padding: 0;
		letter-spacing: 0.5px;
		text-decoration: underline;
	}
	.btn-link:hover {
		color: #fff;
	}
	.btn-link.danger {
		color: #f87171;
	}
	.btn-link.danger:hover {
		color: #fca5a5;
	}
</style>
