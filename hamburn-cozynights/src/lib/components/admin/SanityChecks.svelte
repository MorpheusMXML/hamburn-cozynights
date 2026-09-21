<script lang="ts">
	import { slide } from 'svelte/transition';

	export let warnings: Array<{
		id: string;
		name: string;
		noRooms: boolean;
		roomsWithNoBeds: Array<{
			id: string;
			name: string;
			number: number;
		}>;
	}>;

	$: hasWarnings = warnings.length > 0;
	$: issueCount = warnings.reduce(
		(sum, warning) => sum + (warning.noRooms ? 1 : 0) + warning.roomsWithNoBeds.length,
		0
	);
</script>

{#if hasWarnings}
	<div class="sanity-wrapper" transition:slide>
		<header class="sanity-header">
			<span class="alert-icon">⚠️</span>
			<h3>RED ALERT: THE CAMP LAYOUT IS INCOMPLETE</h3>
			<span class="count">{issueCount} {issueCount === 1 ? 'ISSUE' : 'ISSUES'}</span>
		</header>
		<p class="sanity-intro">
			Guests cannot book anything in the places listed here. Add what is missing, or delete the
			house or room if it is not needed.
		</p>

		<div class="tree-container">
			{#each warnings as warning}
				<div class="house-node">
					<div class="node-content">
						<span class="icon">🛖</span>
						<span class="name">{warning.name}</span>
						{#if warning.noRooms}
							<span class="error-tag">This house has no rooms yet.</span>
							<a href="/admin/house/{warning.id}" class="fix-btn">ADD ROOMS ➕</a>
						{/if}
					</div>

					{#if warning.roomsWithNoBeds.length > 0}
						<div class="children">
							{#each warning.roomsWithNoBeds as room}
								<div class="room-node">
									<div class="node-content">
										<span class="icon">🚪</span>
										<span class="name">{room.name || `Room ${room.number}`}</span>
										<span class="error-tag">This room has no spots yet.</span>
										<a href="/admin/room/{room.id}" class="fix-btn">ADD SPOTS 🛌</a>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.sanity-wrapper {
		background: rgba(239, 68, 68, 0.05);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: 12px;
		margin-bottom: 2rem;
		overflow: hidden;
	}
	.sanity-header {
		background: rgba(239, 68, 68, 0.1);
		padding: 0.75rem 1.5rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		border-bottom: 1px solid rgba(239, 68, 68, 0.1);
	}
	.sanity-header h3 {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 2px;
		line-height: 1.5;
		color: #f87171;
		flex: 1 1 12rem;
		min-width: 0;
	}
	.count {
		font-size: 0.6rem;
		font-weight: 900;
		background: #f87171;
		color: #000;
		padding: 2px 8px;
		border-radius: 4px;
		white-space: nowrap;
	}
	.sanity-intro {
		margin: 0;
		padding: 1rem 1.5rem 0;
		font-size: 0.8rem;
		line-height: 1.5;
		color: #d4a5a5;
	}

	.tree-container {
		padding: 1rem 1.5rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.node-content {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.5rem 0;
	}
	.name {
		font-weight: 900;
		font-size: 0.85rem;
		color: #fff;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.error-tag {
		font-size: 0.75rem;
		color: #f87171;
		font-weight: bold;
		letter-spacing: 0.5px;
	}

	.fix-btn {
		margin-left: auto;
		font-size: 0.65rem;
		font-weight: 900;
		color: #2dd4bf;
		text-decoration: none;
		border: 1px solid #2dd4bf;
		padding: 4px 10px;
		border-radius: 4px;
		transition: all 0.2s;
		white-space: nowrap;
	}
	.fix-btn:hover {
		background: #2dd4bf;
		color: #000;
		box-shadow: 0 0 10px rgba(45, 212, 191, 0.4);
	}

	.children {
		margin-left: 1.5rem;
		padding-left: 1.5rem;
		border-left: 1px dashed #333;
		margin-top: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.room-node {
		position: relative;
	}
	.room-node::before {
		content: '';
		position: absolute;
		top: 1.25rem;
		left: -1.5rem;
		width: 1rem;
		height: 1px;
		background: #333;
	}

	@media (max-width: 640px) {
		.sanity-header,
		.sanity-intro {
			padding-left: 1rem;
			padding-right: 1rem;
		}
		.tree-container {
			padding: 0.75rem 1rem 1rem;
		}
		.children {
			margin-left: 0.5rem;
			padding-left: 1rem;
		}
		.room-node::before {
			left: -1rem;
			width: 0.75rem;
		}
		/* Finger-sized link on its own line */
		.fix-btn {
			flex-basis: 100%;
			margin-left: 0;
			box-sizing: border-box;
			min-height: 44px;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 0.75rem;
		}
	}
</style>
