<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { fade, fly } from 'svelte/transition';

	export let data: PageData;
	export let form: ActionData;

	const ERROR_MESSAGES: Record<string, { title: string; text: string }> = {
		not_authorized: {
			title: 'NO ACCESS 🛑',
			text: 'This Google account has no access to the control center. Ask a superuser to approve or invite it, or sign in with another account.'
		},
		wrong_domain: {
			title: 'WRONG ACCOUNT 🛑',
			text: `Only verified @${data.adminDomain} Google accounts can sign in. Try again and pick your @${data.adminDomain} account.`
		},
		not_workspace: {
			title: 'WRONG ACCOUNT 🛑',
			text: `Only @${data.adminDomain} Google Workspace accounts can sign in. Try again and pick your @${data.adminDomain} account.`
		},
		cancelled: {
			title: 'SIGN-IN CANCELLED',
			text: 'Google sign-in was cancelled. Try again whenever you are ready.'
		},
		expired: {
			title: 'SIGN-IN EXPIRED ⏳',
			text: 'The sign-in attempt timed out or was started in another tab. Please try again.'
		},
		unavailable: {
			title: 'BACKEND UNREACHABLE 📡',
			text: 'The control center backend could not be reached. Try again shortly.'
		},
		reauth: {
			title: 'WEEKLY CHECK 🔐',
			text: 'For security, admins sign in with Google again every 7 days. One click and you are back.'
		},
		failed: {
			title: 'SIGN-IN FAILED',
			text: 'Google sign-in did not complete. Please try again.'
		}
	};

	$: loginError = data.error ? (ERROR_MESSAGES[data.error] ?? ERROR_MESSAGES.failed) : null;
</script>

<svelte:head>
	<title>Admin sign-in · CozyNights</title>
</svelte:head>

<div class="login-wrapper">
	<div class="login-container" in:fly={{ y: 20, duration: 600 }}>
		<header class="login-header">
			<div class="laser-line-top"></div>
			<h1>ADMIN PORTAL 🔐</h1>
			<p class="subtitle">Secure access to the Hamburn Control Center</p>
		</header>

		{#if data.pendingAdmin}
			<div class="pending-banner" in:fade>
				<span class="icon">⏳</span>
				<div class="msg-content">
					<strong>ACCESS REQUESTED</strong>
					<p>
						Signed in as {data.pendingAdmin.email}. A superuser has to approve your access before
						you can enter the control center. Reload this page once you have been approved.
					</p>
				</div>
			</div>

			<form action="/admin/logout" method="POST" class="oauth-form">
				<button type="submit" class="btn-secondary">USE ANOTHER ACCOUNT</button>
			</form>
		{:else if form?.message || loginError || data.backendError}
			<div class="error-banner" role="alert" in:fade>
				<span class="icon">🛑</span>
				<div class="msg-content">
					{#if form?.message}
						{form.message}
					{:else if loginError}
						<strong>{loginError.title}</strong>
						<p>{loginError.text}</p>
					{:else}
						<strong>BACKEND UNREACHABLE 📡</strong>
						<p>The control center backend could not be reached. Try again shortly.</p>
					{/if}
				</div>
			</div>
		{/if}

		{#if data.pendingAdmin}
			<!-- waiting for approval: see banner above -->
		{:else if data.googleEnabled}
			<form action="?/google" method="POST" class="oauth-form">
				<button type="submit" class="btn-ignite">SIGN IN WITH GOOGLE ⚡️</button>
			</form>
		{:else if !data.backendError}
			<p class="hint">
				Google sign-in is not configured on this server yet, so nobody can sign in here. Ask the
				person who runs the server to set it up.
			</p>
		{/if}

		<p class="hint">
			Sign in with your <strong>@{data.adminDomain}</strong> Google Workspace account. New accounts need
			to be approved by a superuser.
		</p>
	</div>
</div>

<style>
	.login-wrapper {
		min-height: 80vh;
		min-height: 80dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}

	.login-container {
		width: 100%;
		max-width: 440px;
		box-sizing: border-box;
		background: #0f0f0f;
		border: 1px solid #222;
		border-radius: 16px;
		padding: 2.5rem;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
		position: relative;
		overflow: hidden;
	}

	.laser-line-top {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 2px;
		background: linear-gradient(90deg, transparent, #2dd4bf, #f472b6, transparent);
	}

	.login-header {
		text-align: center;
		margin-bottom: 2.5rem;
	}
	h1 {
		font-size: 1.5rem;
		font-weight: 900;
		color: #fff;
		margin: 0;
		letter-spacing: 1px;
	}
	.subtitle {
		font-size: 0.8rem;
		color: #666;
		margin-top: 0.5rem;
		font-weight: bold;
	}

	.error-banner {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 2rem;
		display: flex;
		gap: 1rem;
		align-items: center;
		color: #f87171;
	}
	.msg-content {
		min-width: 0;
		font-size: 0.85rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.msg-content strong {
		display: block;
		font-size: 0.75rem;
		letter-spacing: 1px;
	}
	.msg-content p {
		margin: 0.25rem 0 0 0;
		font-size: 0.85rem;
		opacity: 0.9;
	}

	.pending-banner {
		background: rgba(45, 212, 191, 0.08);
		border: 1px solid rgba(45, 212, 191, 0.3);
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 1.5rem;
		display: flex;
		gap: 1rem;
		align-items: center;
		color: #5eead4;
	}

	.btn-secondary {
		background: transparent;
		color: #aaa;
		border: 1px solid #333;
		min-height: 44px;
		padding: 0.75rem;
		border-radius: 8px;
		font-weight: 900;
		cursor: pointer;
		font-size: 0.8rem;
		letter-spacing: 1px;
	}
	.btn-secondary:hover {
		border-color: #666;
		color: #fff;
	}

	.oauth-form {
		display: flex;
		flex-direction: column;
	}

	.btn-ignite {
		background: #2dd4bf;
		color: #000;
		border: none;
		padding: 1rem;
		border-radius: 8px;
		font-weight: 900;
		cursor: pointer;
		font-size: 0.9rem;
		letter-spacing: 1px;
		transition: all 0.3s;
		box-shadow: 0 0 20px rgba(45, 212, 191, 0.3);
	}
	.btn-ignite:hover {
		transform: scale(1.02);
		box-shadow: 0 0 30px rgba(45, 212, 191, 0.5);
	}

	.hint {
		text-align: center;
		font-size: 0.8rem;
		color: #888;
		margin-top: 1.5rem;
		line-height: 1.5;
	}
	.hint strong {
		color: #bbb;
	}

	@media (max-width: 640px) {
		.login-wrapper {
			padding: 1rem 0;
		}
		.login-container {
			padding: 1.75rem 1.25rem;
		}
		.error-banner,
		.pending-banner {
			align-items: flex-start;
		}
	}
</style>
