<!--
@component
The small version counter: "v0.18.1" next to the title on the landing page,
in the admin menu and in the footer. It links to the GitHub release of that
version, and its tooltip names the build (commit and day), so a bug report
can say exactly which build it saw.

Three sizes: `title` (the landing page, a neon pill that ignites on hover),
`nav` (the admin menu, quiet), `footer` (plain text next to the credit).
-->
<script lang="ts">
	import { APP_VERSION, releaseUrl, versionTitle } from '$lib/version';

	let { size = 'footer' }: { size?: 'title' | 'nav' | 'footer' } = $props();

	const label = `v${APP_VERSION}`;
	const title = versionTitle();
</script>

<a
	class="version-badge {size}"
	href={releaseUrl()}
	target="_blank"
	rel="noopener"
	{title}
	aria-label="{title}, release notes on GitHub"
	data-version={APP_VERSION}
>
	<span class="spark" aria-hidden="true"></span>
	{label}
</a>

<style>
	.version-badge {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 600;
		letter-spacing: 0.06em;
		line-height: 1;
		white-space: nowrap;
		text-decoration: none;
		color: #b5b5b5;
		border-radius: 999px;
		transition:
			color 0.25s ease,
			border-color 0.25s ease,
			box-shadow 0.25s ease,
			transform 0.25s ease;
	}

	.version-badge:hover,
	.version-badge:focus-visible {
		color: #fff;
	}

	.version-badge:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 3px;
	}

	/* The spark: a small dot that glows when the badge is looked at. */
	.spark {
		width: 0.45em;
		height: 0.45em;
		border-radius: 50%;
		background: #2dd4bf;
		box-shadow: 0 0 6px rgba(45, 212, 191, 0.7);
		flex: none;
	}

	/* Landing page: a neon pill under the effigy's top edge. */
	.version-badge.title {
		padding: 0.42em 0.8em;
		font-size: clamp(0.62rem, 1.9vw, 0.78rem);
		border: 1px solid rgba(45, 212, 191, 0.45);
		background: rgba(0, 0, 0, 0.55);
		box-shadow:
			0 0 0 rgba(45, 212, 191, 0),
			inset 0 0 12px rgba(45, 212, 191, 0.08);
	}

	.version-badge.title:hover,
	.version-badge.title:focus-visible {
		border-color: #2dd4bf;
		box-shadow:
			0 0 18px rgba(45, 212, 191, 0.45),
			inset 0 0 12px rgba(45, 212, 191, 0.2);
		transform: translateY(-1px);
	}

	/* Admin menu: sits after the "Admin" tag, as quiet as the tag. */
	.version-badge.nav {
		padding: 0.25em 0.55em;
		font-size: 0.66rem;
		border: 1px solid #262626;
		background: #0f0f0f;
		color: #8a8a8a;
	}

	.version-badge.nav:hover,
	.version-badge.nav:focus-visible {
		border-color: #2dd4bf;
		color: #e5e5e5;
	}

	.version-badge.nav .spark {
		width: 0.4em;
		height: 0.4em;
	}

	/* Footer: text next to the credit, the spark is the only colour. */
	.version-badge.footer {
		padding: 0.2em 0.35em;
		min-height: 28px;
		font-size: 0.7rem;
		color: #737373;
	}

	.version-badge.footer:hover,
	.version-badge.footer:focus-visible {
		color: #e5e5e5;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	@media (prefers-reduced-motion: no-preference) {
		.version-badge.title:hover .spark,
		.version-badge.title:focus-visible .spark {
			animation: ignite 0.9s ease-in-out infinite;
		}
	}

	@keyframes ignite {
		0%,
		100% {
			transform: scale(1);
			box-shadow: 0 0 6px rgba(45, 212, 191, 0.7);
		}
		50% {
			transform: scale(1.5);
			box-shadow: 0 0 12px rgba(45, 212, 191, 1);
		}
	}

	@media (forced-colors: active) {
		.version-badge {
			border: 1px solid CanvasText;
		}
		.spark {
			background: CanvasText;
			box-shadow: none;
		}
	}
</style>
