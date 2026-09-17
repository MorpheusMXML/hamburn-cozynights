<script lang="ts">
	import { page } from '$app/stores';
</script>

<div class="error-wrapper">
	<div class="error-card">
		<span class="icon">🛑</span>
		<h1>{$page.status} — Something snapped</h1>
		<p>{$page.error?.message || 'The playa says NO. Something went wrong.'}</p>
		<a href="/admin/login" class="btn-back">BACK TO PORTAL 🔐</a>
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		background-color: #0a0a0a;
	}

	.error-wrapper {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		font-family: 'Inter', system-ui, sans-serif;
		background: radial-gradient(circle at top right, #111, #050505);
	}

	.error-card {
		max-width: 440px;
		width: 100%;
		text-align: center;
		background: #0f0f0f;
		border: 1px solid #222;
		border-radius: 16px;
		padding: 2.5rem;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
	}

	.icon {
		font-size: 2.5rem;
	}

	h1 {
		font-size: 1.1rem;
		font-weight: 900;
		color: #fff;
		margin: 1rem 0 0.5rem 0;
		letter-spacing: -0.5px;
	}

	p {
		color: #888;
		font-size: 0.85rem;
		margin: 0 0 1.75rem 0;
	}

	.btn-back {
		display: inline-block;
		background: #2dd4bf;
		color: #000;
		text-decoration: none;
		padding: 0.85rem 1.5rem;
		border-radius: 8px;
		font-weight: 900;
		font-size: 0.85rem;
		letter-spacing: 1px;
	}
</style>
