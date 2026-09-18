<script lang="ts">
	import { page } from '$app/stores';

	// SvelteKit's stock messages for errors nobody wrote a text for.
	const STOCK_MESSAGES = ['Not Found', 'Internal Error'];

	$: status = $page.status;
	$: ownMessage =
		$page.error?.message && !STOCK_MESSAGES.includes($page.error.message)
			? $page.error.message
			: '';

	$: headline =
		status === 404
			? 'Lost in the dust'
			: status >= 500
				? 'Something broke on our side'
				: 'That did not work';

	$: message =
		ownMessage ||
		(status === 404
			? "This page doesn't exist (anymore)."
			: status >= 500
				? 'The app ran into a problem. Please try again in a moment.'
				: 'The request could not be completed. Please go back and try again.');
</script>

<svelte:head>
	<title>{status} · CozyNights</title>
</svelte:head>

<main class="error-page">
	<div class="error-card">
		<p class="status" aria-hidden="true">{status}</p>
		<h1>{headline}</h1>
		<p class="message">{message}</p>
		{#if status >= 500}
			<p class="hint">If it keeps happening, tell the crew what you were trying to do.</p>
		{/if}
		<div class="actions">
			<a class="btn primary" href="/map">Back to the map</a>
			<a class="btn" href="/">Start page</a>
		</div>
	</div>
</main>

<style>
	.error-page {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: clamp(1rem, 4vw, 2rem);
		font-family: 'Inter', system-ui, sans-serif;
		color: #fff;
	}

	.error-card {
		width: min(100%, 520px);
		padding: clamp(1.5rem, 6vw, 3rem);
		text-align: center;
		background: rgba(10, 10, 10, 0.9);
		border: 1px solid #222;
		border-top: 4px solid #f472b6;
		border-radius: 28px;
		box-shadow: 0 40px 100px rgba(0, 0, 0, 0.8);
	}

	.status {
		margin: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: clamp(3.5rem, 18vw, 6rem);
		font-weight: 900;
		line-height: 1;
		background: linear-gradient(to right, #2dd4bf, #f472b6);
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}

	h1 {
		margin: 1rem 0 0.75rem;
		font-size: clamp(1.25rem, 5vw, 1.75rem);
		font-weight: 900;
		letter-spacing: -0.5px;
		text-transform: uppercase;
		color: #f472b6;
		text-shadow: 0 0 20px rgba(244, 114, 182, 0.4);
	}

	.message {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.5;
		color: #e5e5e5;
		overflow-wrap: anywhere;
	}

	.hint {
		margin: 0.75rem 0 0;
		font-size: 0.9rem;
		color: #9a9a9a;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 2rem;
	}

	.btn {
		flex: 1 1 160px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		padding: 0.75rem 1.25rem;
		border-radius: 12px;
		border: 1px solid #444;
		color: #ddd;
		font-weight: 900;
		font-size: 0.9rem;
		letter-spacing: 1px;
		text-transform: uppercase;
		text-decoration: none;
	}

	.btn:hover {
		border-color: #fff;
		color: #fff;
	}

	.btn.primary {
		background: #2dd4bf;
		border-color: #2dd4bf;
		color: #000;
	}

	.btn.primary:hover {
		box-shadow: 0 0 30px rgba(45, 212, 191, 0.4);
		color: #000;
	}

	.btn:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 3px;
	}
</style>
