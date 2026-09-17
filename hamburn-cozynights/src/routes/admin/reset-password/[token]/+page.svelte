<script lang="ts">
	import type { ActionData } from './$types';
	import { fade, fly } from 'svelte/transition';

	export let form: ActionData;
</script>

<div class="login-wrapper">
	<div class="login-container" in:fly={{ y: 20, duration: 600 }}>
		<header class="login-header">
			<div class="laser-line-top"></div>
			<h1>WELCOME TO THE CREW ✨</h1>
			<p class="subtitle">Choose a passphrase to activate your admin account</p>
		</header>

		{#if form?.message}
			<div class="error-banner" in:fade>
				<span class="icon">🛑</span>
				<div class="msg-content">{form.message}</div>
			</div>
		{/if}

		<form method="POST" class="laser-form" in:fade>
			<div class="input-group">
				<label for="password">NEW PASSPHRASE</label>
				<input
					name="password"
					id="password"
					type="password"
					placeholder="••••••••"
					minlength="8"
					required
				/>
			</div>
			<div class="input-group">
				<label for="passwordConfirm">CONFIRM PASSPHRASE</label>
				<input
					name="passwordConfirm"
					id="passwordConfirm"
					type="password"
					placeholder="••••••••"
					minlength="8"
					required
				/>
			</div>
			<button type="submit" class="btn-ignite">ACTIVATE ACCOUNT ⚡️</button>
		</form>
	</div>
</div>

<style>
	.login-wrapper {
		min-height: 80vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}

	.login-container {
		width: 100%;
		max-width: 440px;
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
		font-size: 0.8rem;
	}

	.laser-form {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.input-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.input-group label {
		font-size: 0.65rem;
		font-weight: 900;
		color: #444;
		letter-spacing: 1.5px;
	}

	input {
		background: #050505;
		border: 1px solid #222;
		color: white;
		padding: 1rem;
		border-radius: 8px;
		font-size: 1rem;
		transition: all 0.3s;
	}
	input:focus {
		outline: none;
		border-color: #2dd4bf;
		box-shadow: 0 0 15px rgba(45, 212, 191, 0.2);
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
		margin-top: 0.5rem;
		transition: all 0.3s;
		box-shadow: 0 0 20px rgba(45, 212, 191, 0.3);
	}
	.btn-ignite:hover {
		transform: scale(1.02);
		box-shadow: 0 0 30px rgba(45, 212, 191, 0.5);
	}
</style>
