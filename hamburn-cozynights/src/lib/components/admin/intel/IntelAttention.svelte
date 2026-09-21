<script lang="ts">
	import type { AttentionItem, AttentionTone } from '$lib/intel';

	export let items: AttentionItem[];

	// The app's state colours: red for what went wrong, orange for what waits,
	// grey for what is merely worth knowing.
	const STATE: Record<AttentionTone, string> = {
		danger: 'danger',
		warning: 'warning',
		info: 'idle'
	};
</script>

<section class="attention" aria-labelledby="intel-attention-title">
	<h4 id="intel-attention-title" class="attention-title">
		NEEDS ATTENTION{items.length ? ` · ${items.length}` : ''}
	</h4>
	{#if items.length}
		<ul class="attention-list">
			{#each items as item (item.key)}
				<li
					class="attention-item"
					class:state-ring={item.tone !== 'info'}
					data-state={STATE[item.tone]}
				>
					<span class="attention-icon" aria-hidden="true">{item.icon}</span>
					<span class="attention-text">{item.text}</span>
					{#if item.href}
						<a class="attention-link" href={item.href}>{item.linkLabel ?? 'Open'} →</a>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="attention-clear" data-state="open">
			<span class="state-dot" aria-hidden="true"></span>
			All clear: nothing waits for the crew right now.
		</p>
	{/if}
</section>

<style>
	.attention {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.attention-title {
		margin: 0;
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 2px;
		color: #a3a3a3;
	}
	.attention-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
		gap: 0.5rem;
	}
	/* Icon, text, link in a row; on a narrow card the link drops under the
	   text instead of squeezing it. */
	.attention-item {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.2rem 0.6rem;
		min-width: 0;
		padding: 0.6rem 0.8rem;
		border-radius: 10px;
		background: var(--state-soft);
		border: 1px solid #1f1f1f;
		container-type: inline-size;
	}
	.attention-icon {
		font-size: 1rem;
	}
	.attention-text {
		min-width: 0;
		font-size: 0.75rem;
		font-weight: 700;
		color: #e5e5e5;
		line-height: 1.35;
	}
	.attention-link {
		display: inline-flex;
		align-items: center;
		min-height: 32px;
		color: #2dd4bf;
		font-size: 0.7rem;
		font-weight: 800;
		text-decoration: none;
		white-space: nowrap;
	}
	.attention-link:hover {
		text-decoration: underline;
	}
	@container (max-width: 300px) {
		.attention-link {
			grid-column: 2;
			min-height: 28px;
		}
	}
	.attention-clear {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0;
		font-size: 0.75rem;
		font-weight: 700;
		color: #a3a3a3;
	}
</style>
