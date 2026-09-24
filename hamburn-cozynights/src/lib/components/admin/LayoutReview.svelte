<!--
@component
The review of a layout template: what differs between the file and the camp,
as a tree of houses ▸ rooms ▸ spots that folds open with +/−. Every
difference has a checkbox; `selection` holds the keys of the chosen ones
(rules in $lib/template-diff: a new room needs its new house, a removed house
takes its rooms and spots along).
-->
<script lang="ts">
	import { houseKindEntry } from '$lib/accommodation';
	import { slide } from 'svelte/transition';
	import type { Action } from 'svelte/action';
	import {
		selectionState,
		toggleSelection,
		type AnyNode,
		type ChangeKind,
		type FieldChange,
		type FieldValue,
		type HouseDiff,
		type LayoutDiff,
		type RoomDiff
	} from '$lib/template-diff';

	export let diff: LayoutDiff;
	export let selection: Set<string>;
	/** Show, but don't let anyone choose (regular admins, Live Booking). */
	export let readOnly = false;

	const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

	/** Has something to apply, itself or inside. */
	const hasChanges = (node: AnyNode) => selectionState(node, new Set()) !== 'nothing';

	$: changedHouses = diff.houses.filter(hasChanges);
	$: sameHouses = diff.houses.filter((house) => !hasChanges(house));

	// Small reviews start unfolded; big ones folded, one click per house.
	let open = new Set<string>();
	let seenDiff: LayoutDiff | null = null;
	$: if (diff !== seenDiff) {
		seenDiff = diff;
		open = new Set(
			changedHouses.length <= 3
				? changedHouses.flatMap((house) => [house.key, ...house.rooms.map((room) => room.key)])
				: []
		);
	}

	function toggleOpen(key: string) {
		if (open.has(key)) open.delete(key);
		else open.add(key);
		open = open;
	}

	function expandAll() {
		open = new Set(
			changedHouses.flatMap((house) => [house.key, ...house.rooms.map((room) => room.key)])
		);
	}

	function collapseAll() {
		open = new Set();
	}

	function choose(key: string) {
		if (!readOnly) selection = toggleSelection(diff, selection, key);
	}

	/** Checkbox that can show "some chosen". */
	const partial: Action<HTMLInputElement, boolean> = (node, value) => {
		node.indeterminate = !!value;
		return {
			update(next) {
				node.indeterminate = !!next;
			}
		};
	};

	const KIND_LABEL: Record<ChangeKind, string> = {
		new: 'New',
		changed: 'Changed',
		removed: 'Not in file'
	};

	function show(value: FieldValue): string {
		if (value === true) return 'on';
		if (value === false) return 'off';
		if (value === null || value === '') return '—';
		return String(value);
	}

	const FIELD_LABEL: Record<string, string> = {
		enabled: 'active',
		is_locked: 'locked',
		is_special: 'special needs',
		position: 'position',
		name: 'name',
		label: 'label',
		kind: 'kind',
		bed_type: 'bed',
		features: 'features',
		description: 'description'
	};

	const describe = (change: FieldChange) =>
		`${FIELD_LABEL[change.field] ?? change.field}: ${show(change.from)} → ${show(change.to)}`;

	const count = (list: { own: ChangeKind | null }[], kind: ChangeKind) =>
		list.filter((item) => item.own === kind).length;

	/** "1 new spot · 2 spots not in file (1 booked)" for the spots of a list of rooms. */
	function spotSummary(rooms: RoomDiff[]): string[] {
		const spots = rooms.flatMap((room) => room.spots).filter((spot) => spot.own);
		const missing = spots.filter((spot) => spot.own === 'removed');
		const booked = missing.filter((spot) => spot.booked > 0).length;
		return [
			count(spots, 'new') ? plural(count(spots, 'new'), 'new spot') : '',
			count(spots, 'changed') ? `${plural(count(spots, 'changed'), 'spot')} changed` : '',
			missing.length
				? `${plural(missing.length, 'spot')} not in file${booked ? ` (${booked} booked)` : ''}`
				: ''
		];
	}

	/** "2 new rooms · 5 spots changed" for a folded house. */
	function inside(house: HouseDiff): string {
		const rooms = house.rooms.filter((room) => room.own);
		const bits = [
			count(rooms, 'new') ? `${plural(count(rooms, 'new'), 'new room')}` : '',
			count(rooms, 'changed') ? `${plural(count(rooms, 'changed'), 'room')} renamed` : '',
			count(rooms, 'removed') ? `${plural(count(rooms, 'removed'), 'room')} not in file` : '',
			...spotSummary(house.rooms.filter((room) => room.own !== 'new' && room.own !== 'removed'))
		];
		return bits.filter(Boolean).join(' · ');
	}

	$: c = diff.counts;
</script>

<div class="review">
	<ul class="counts" aria-label="Differences">
		{#if c.houses.new + c.rooms.new + c.spots.new > 0}
			<li class="new">
				+ {[
					c.houses.new ? plural(c.houses.new, 'house') : '',
					c.rooms.new ? plural(c.rooms.new, 'room') : '',
					c.spots.new ? plural(c.spots.new, 'spot') : ''
				]
					.filter(Boolean)
					.join(', ')}
			</li>
		{/if}
		{#if c.houses.changed + c.rooms.changed + c.spots.changed > 0}
			<li class="changed">
				± {[
					c.houses.changed ? plural(c.houses.changed, 'house') : '',
					c.rooms.changed ? plural(c.rooms.changed, 'room') : '',
					c.spots.changed ? plural(c.spots.changed, 'spot') : ''
				]
					.filter(Boolean)
					.join(', ')} changed
			</li>
		{/if}
		{#if c.houses.removed + c.rooms.removed + c.spots.removed > 0}
			<li class="removed">
				− {[
					c.houses.removed ? plural(c.houses.removed, 'house') : '',
					c.rooms.removed ? plural(c.rooms.removed, 'room') : '',
					c.spots.removed ? plural(c.spots.removed, 'spot') : ''
				]
					.filter(Boolean)
					.join(', ')} not in the file
			</li>
		{/if}
		<li>{plural(sameHouses.length, 'house')} unchanged</li>
	</ul>

	{#if changedHouses.length === 0}
		<p class="all-set">✅ The camp already matches this file. There is nothing to apply.</p>
	{:else}
		<div class="tools">
			<button type="button" on:click={expandAll}>+ Expand all</button>
			<button type="button" on:click={collapseAll}>− Collapse all</button>
		</div>

		<ul class="tree" aria-label="Houses, rooms and spots">
			{#each changedHouses as house (house.key)}
				{@const state = selectionState(house, selection)}
				<li class="node house" data-kind={house.own ?? 'inside'}>
					<div class="line">
						<button
							type="button"
							class="sign"
							aria-expanded={open.has(house.key)}
							aria-label="{open.has(house.key) ? 'Collapse' : 'Expand'} {house.name}"
							on:click={() => toggleOpen(house.key)}>{open.has(house.key) ? '−' : '+'}</button
						>
						<label class="pick">
							<input
								type="checkbox"
								checked={state === 'all'}
								use:partial={state === 'some'}
								disabled={readOnly}
								on:change={() => choose(house.key)}
							/>
							<span class="name"
								>{houseKindEntry(house.kind)?.icon ?? '🛖'} {house.name}</span
							>
						</label>
						{#if house.own}<span class="badge {house.own}">{KIND_LABEL[house.own]}</span>{/if}
						{#if house.booked > 0 && house.own === 'removed'}
							<span class="badge warn">⚠️ {plural(house.booked, 'booking')}</span>
						{/if}
					</div>
					<p class="detail">
						{#if house.own === 'new'}
							At X {house.x} / Y {house.y} · {plural(house.rooms.length, 'room')} · {plural(
								house.rooms.reduce((sum, room) => sum + room.spots.length, 0),
								'spot'
							)}
						{:else if house.own === 'removed'}
							Not in the file. Tick it to remove the house with its {plural(
								house.rooms.length,
								'room'
							)}.
						{:else}
							{[...house.changes.map(describe), inside(house)].filter(Boolean).join(' · ')}
						{/if}
					</p>

					{#if open.has(house.key)}
						<ul class="rooms" transition:slide={{ duration: 150 }}>
							{#each house.rooms.filter(hasChanges) as room (room.key)}
								{@const roomState = selectionState(room, selection)}
								<li class="node room" data-kind={room.own ?? 'inside'}>
									<div class="line">
										<button
											type="button"
											class="sign small"
											aria-expanded={open.has(room.key)}
											aria-label="{open.has(room.key) ? 'Collapse' : 'Expand'} room {room.name}"
											on:click={() => toggleOpen(room.key)}>{open.has(room.key) ? '−' : '+'}</button
										>
										<label class="pick">
											<input
												type="checkbox"
												checked={roomState === 'all'}
												use:partial={roomState === 'some'}
												disabled={readOnly}
												on:change={() => choose(room.key)}
											/>
											<span class="name">#{room.number} {room.name}</span>
										</label>
										{#if room.own}<span class="badge {room.own}">{KIND_LABEL[room.own]}</span>{/if}
										{#if room.booked > 0 && room.own === 'removed'}
											<span class="badge warn">⚠️ {plural(room.booked, 'booking')}</span>
										{/if}
									</div>
									{#if room.own === 'new'}
										<p class="detail">{plural(room.spots.length, 'spot')}</p>
									{:else if room.own !== 'removed'}
										<p class="detail">
											{[...room.changes.map(describe), ...spotSummary([room])]
												.filter(Boolean)
												.join(' · ')}
										</p>
									{/if}

									{#if open.has(room.key)}
										<ul class="spots" transition:slide={{ duration: 150 }}>
											{#each room.spots.filter((spot) => spot.own) as spot (spot.key)}
												<li class="node spot" data-kind={spot.own}>
													<label class="pick">
														<input
															type="checkbox"
															checked={selection.has(spot.key)}
															disabled={readOnly}
															on:change={() => choose(spot.key)}
														/>
														<span class="name">{spot.label}</span>
													</label>
													{#if spot.own}<span class="badge {spot.own}">{KIND_LABEL[spot.own]}</span
														>{/if}
													{#if spot.booked && spot.own === 'removed'}
														<span class="badge warn">⚠️ booked</span>
													{/if}
													{#if spot.own === 'changed'}
														<span class="detail inline"
															>{spot.changes.map(describe).join(' · ')}</span
														>
													{/if}
												</li>
											{/each}
										</ul>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if sameHouses.length > 0}
		<p class="same">
			Unchanged: {sameHouses.map((house) => house.name).join(', ')}
		</p>
	{/if}
</div>

<style>
	.review {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		text-align: left;
	}
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.counts li {
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1px solid #333;
		color: #bbb;
		font-size: 0.8rem;
		font-weight: 800;
	}
	.counts .new {
		border-color: rgba(74, 222, 128, 0.5);
		color: #86efac;
	}
	.counts .changed {
		border-color: rgba(251, 146, 60, 0.5);
		color: #fdba74;
	}
	.counts .removed {
		border-color: rgba(248, 113, 113, 0.5);
		color: #fca5a5;
	}
	.all-set {
		margin: 0;
		color: #86efac;
	}
	.tools {
		display: flex;
		gap: 0.5rem;
	}
	.tools button {
		min-height: 36px;
		padding: 0 0.8rem;
		border-radius: 999px;
		border: 1px solid #333;
		background: transparent;
		color: #aaa;
		font-weight: 800;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.tools button:hover {
		border-color: #2dd4bf;
		color: #2dd4bf;
	}

	.tree,
	.rooms,
	.spots {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.rooms {
		margin: 0.5rem 0 0 1.1rem;
		padding-left: 0.8rem;
		border-left: 1px dashed #333;
	}
	.spots {
		margin: 0.45rem 0 0.2rem 1rem;
		padding-left: 0.8rem;
		border-left: 1px dashed #2a2a2a;
		gap: 0.25rem;
	}
	.node {
		border-radius: 12px;
	}
	.house {
		background: #0e0e0e;
		border: 1px solid #222;
		border-left: 4px solid #555;
		padding: 0.55rem 0.7rem;
	}
	.house[data-kind='new'] {
		border-left-color: #4ade80;
	}
	.house[data-kind='changed'],
	.house[data-kind='inside'] {
		border-left-color: #fb923c;
	}
	.house[data-kind='removed'] {
		border-left-color: #f87171;
	}
	.line {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.35rem 0.6rem;
	}
	.sign {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 1px solid #333;
		background: #141414;
		color: #2dd4bf;
		font-weight: 900;
		font-size: 1.05rem;
		line-height: 1;
		cursor: pointer;
	}
	.sign.small {
		width: 28px;
		height: 28px;
		font-size: 0.95rem;
	}
	.sign:hover {
		border-color: #2dd4bf;
	}
	.pick {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 36px;
		cursor: pointer;
		min-width: 0;
	}
	.pick input {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		/* accent-color for plain browsers, color for the Tailwind forms plugin */
		accent-color: #2dd4bf;
		color: #14b8a6;
	}
	.pick input:disabled {
		cursor: not-allowed;
	}
	.name {
		font-weight: 800;
		color: #fff;
		overflow-wrap: anywhere;
	}
	.room .name {
		font-weight: 700;
		color: #e5e5e5;
	}
	.spot .name {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 600;
		font-size: 0.85rem;
	}
	.spot {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.2rem 0.6rem;
	}
	.badge {
		font-size: 0.65rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		border: 1px solid #444;
		color: #bbb;
	}
	.badge.new {
		border-color: rgba(74, 222, 128, 0.5);
		color: #86efac;
	}
	.badge.changed {
		border-color: rgba(251, 146, 60, 0.5);
		color: #fdba74;
	}
	.badge.removed {
		border-color: rgba(248, 113, 113, 0.5);
		color: #fca5a5;
	}
	.badge.warn {
		border-color: #ef4444;
		color: #fecaca;
		background: rgba(239, 68, 68, 0.12);
	}
	.detail {
		margin: 0.25rem 0 0 2.6rem;
		color: #999;
		font-size: 0.8rem;
		line-height: 1.45;
	}
	.detail:empty {
		display: none;
	}
	.room .detail {
		margin-left: 2.35rem;
	}
	.detail.inline {
		margin: 0;
		font-size: 0.78rem;
	}
	.same {
		margin: 0;
		color: #777;
		font-size: 0.8rem;
		line-height: 1.5;
	}

	@media (max-width: 640px) {
		.rooms {
			margin-left: 0.6rem;
			padding-left: 0.5rem;
		}
		.spots {
			margin-left: 0.4rem;
			padding-left: 0.5rem;
		}
		.detail {
			margin-left: 0.2rem;
		}
		.room .detail {
			margin-left: 0.2rem;
		}
	}
</style>
