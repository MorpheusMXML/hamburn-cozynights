<script lang="ts">
	import { formatCount } from '$lib/intel';
	import { QUICK_TOOLS, type QuickGroup } from '$lib/quick-views';

	/** From quickViews() ($lib/quick-views.ts): the lists with their live counts. */
	export let groups: QuickGroup[];
</script>

<section class="quick" aria-label="Quick views">
	{#each groups as group (group.key)}
		<div class="quick-group">
			<a class="quick-head" href={group.href}>
				<span aria-hidden="true">{group.icon}</span>
				{group.label} →
			</a>
			<ul class="quick-list">
				{#each group.views as view (view.key)}
					<li>
						<a class="quick-view" data-state={view.state} href={view.href} title={view.title}>
							{#if view.value !== undefined}
								<span class="quick-value">{formatCount(view.value)}</span>
							{/if}
							<span class="quick-label">{view.label}</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/each}

	<div class="quick-group">
		<span class="quick-head plain"><span aria-hidden="true">🧰</span> Desk & tools</span>
		<ul class="quick-list">
			{#each QUICK_TOOLS as tool (tool.href)}
				<li>
					<a class="quick-view tool" href={tool.href} title={tool.title}>
						<span aria-hidden="true">{tool.icon}</span>
						<span class="quick-label">{tool.label}</span>
					</a>
				</li>
			{/each}
		</ul>
	</div>
</section>

<style>
	.quick {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 16px;
		padding: 1.25rem 1.5rem;
		min-width: 0;
	}
	.quick-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.quick-head {
		align-self: flex-start;
		font-size: 0.65rem;
		font-weight: 900;
		letter-spacing: 2px;
		text-transform: uppercase;
		color: #2dd4bf;
		text-decoration: none;
	}
	a.quick-head:hover {
		text-decoration: underline;
	}
	.quick-head.plain {
		color: #a3a3a3;
	}
	.quick-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.quick-list li {
		min-width: 0;
		max-width: 100%;
	}
	.quick-view {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
		max-width: 100%;
		min-height: 40px;
		box-sizing: border-box;
		padding: 0.45rem 0.8rem;
		border-radius: 10px;
		border: 1px solid #1f1f1f;
		background: var(--state-soft, rgba(255, 255, 255, 0.03));
		text-decoration: none;
		color: #d4d4d4;
	}
	.quick-view:hover,
	.quick-view:focus-visible {
		border-color: var(--state, #2dd4bf);
	}
	.quick-view.tool {
		align-items: center;
		background: rgba(45, 212, 191, 0.05);
		border-color: rgba(45, 212, 191, 0.2);
	}
	.quick-value {
		font-size: 1.05rem;
		font-weight: 900;
		color: var(--state, #fff);
		line-height: 1.1;
	}
	.quick-view[data-state='idle'] .quick-value {
		color: #fff;
	}
	.quick-label {
		min-width: 0;
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.5px;
		overflow-wrap: anywhere;
	}

	@media (max-width: 640px) {
		.quick {
			padding: 1rem;
		}
	}
</style>
