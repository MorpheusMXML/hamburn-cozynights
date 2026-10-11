<!--
@component
The rules half of the check before every booking ($lib/booking-check): one
box the guest ticks to confirm that they have read and understood the
Code of Conduct, the privacy policy and, most importantly, the booking
rules. The three links sit in the sentence and open in a new tab, so the
booking window stays as it is; a link inside the label doesn't tick the box.
`checked` is bindable; `nudge()` shakes the box and focuses it when the
guest tries to book without it. The Code of Conduct only shows while the
server knows its link (LEGAL_CODE_OF_CONDUCT_URL).
-->
<script lang="ts">
	let {
		checked = $bindable(false),
		codeOfConductUrl = '',
		error = '',
		id = 'rules-check'
	}: {
		checked?: boolean;
		codeOfConductUrl?: string;
		/** Why the booking waits for the box; empty while there is nothing to say. */
		error?: string;
		/** Prefix of the ids inside, unique per page. */
		id?: string;
	} = $props();

	let shaking = $state(false);
	let box = $state<HTMLInputElement>();

	/** The guest tried to book without the box: shake it and put the focus there. */
	export function nudge() {
		shaking = false;
		requestAnimationFrame(() => (shaking = true));
		box?.focus();
	}
</script>

<div class="rules-check" class:checked class:shaking onanimationend={() => (shaking = false)}>
	<label class="confirm" for="{id}-box">
		<input
			id="{id}-box"
			type="checkbox"
			bind:checked
			bind:this={box}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? `${id}-error` : undefined}
		/>
		<span class="box" aria-hidden="true">
			<svg viewBox="0 0 24 24" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
		</span>
		<!-- The order Max put it in: the booking rules last, as the most important. -->
		<span class="text">
			I've read and understood {#if codeOfConductUrl}the
				<a href={codeOfConductUrl} target="_blank" rel="noopener">Code of Conduct</a>,{' '}{/if}the
			<a href="/privacy" target="_blank" rel="noopener">privacy policy</a> and,
			<em>most importantly</em>, the
			<a class="main" href="/booking-rules" target="_blank" rel="noopener">booking rules</a>.
		</span>
	</label>
	{#if error}
		<p id="{id}-error" class="rules-error" role="alert">{error}</p>
	{/if}
</div>

<style>
	.rules-check {
		margin: 0 0 1.25rem;
		padding: 0.8rem 0.9rem;
		border-radius: 14px;
		border: 1.5px solid rgba(244, 114, 182, 0.45);
		background: rgba(244, 114, 182, 0.05);
		text-align: left;
		transition:
			border-color 0.2s,
			background-color 0.2s;
	}
	.rules-check.checked {
		border-color: rgba(45, 212, 191, 0.7);
		background: rgba(45, 212, 191, 0.06);
	}
	.rules-check.shaking {
		animation: nudge 0.42s cubic-bezier(0.36, 0.07, 0.19, 0.97);
	}

	.confirm {
		position: relative;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		column-gap: 0.75rem;
		align-items: start;
		cursor: pointer;
	}
	/* The real checkbox stays in place for the keyboard and screen readers;
	   the drawn box below it is what shows. */
	.confirm input {
		position: absolute;
		top: 0;
		left: 0;
		width: 28px;
		height: 28px;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.box {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		border: 2px solid #6b6575;
		background: #0b0910;
		transition:
			background-color 0.15s,
			border-color 0.15s;
	}
	.box svg {
		width: 18px;
		height: 18px;
	}
	.box path {
		fill: none;
		stroke: #0b0910;
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
		/* the tick draws itself when the box is ticked */
		stroke-dasharray: 24;
		stroke-dashoffset: 24;
		transition: stroke-dashoffset 0.25s ease-out 0.05s;
	}
	.confirm input:checked + .box {
		border-color: #2dd4bf;
		background: #2dd4bf;
	}
	.confirm input:checked + .box path {
		stroke-dashoffset: 0;
	}
	.confirm input:focus-visible + .box {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}
	.confirm:hover .box {
		border-color: #f472b6;
	}
	.confirm:hover input:checked + .box {
		border-color: #2dd4bf;
	}

	.text {
		color: #d4d4d4;
		font-size: 0.9rem;
		font-weight: 500;
		line-height: 1.5;
	}
	.text a {
		color: #fff;
		font-weight: 800;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.text a.main {
		color: #f9a8d4;
	}
	.text a:hover {
		color: #2dd4bf;
	}
	.text a:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
		border-radius: 4px;
	}
	.text em {
		color: #fbcfe8;
		font-style: normal;
		font-weight: 800;
	}

	.rules-error {
		margin: 0.6rem 0 0;
		color: #fecaca;
		font-size: 0.85rem;
		font-weight: 700;
		line-height: 1.4;
	}

	@keyframes nudge {
		10%,
		90% {
			transform: translateX(-2px);
		}
		20%,
		80% {
			transform: translateX(4px);
		}
		30%,
		50%,
		70% {
			transform: translateX(-6px);
		}
		40%,
		60% {
			transform: translateX(6px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rules-check.shaking {
			animation: none;
		}
		.box path {
			transition: none;
		}
	}
</style>
