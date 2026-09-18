<!--
@component
Links to the legal notice (Impressum) and the privacy policy
(Datenschutzerklärung). German law wants both clearly labelled and reachable
from every page; the root layout shows them in the footer, full-screen pages
place them themselves.
-->
<nav class="legal-links" aria-label="Legal">
	<a href="/impressum" lang="de">Impressum</a>
	<span aria-hidden="true">·</span>
	<a href="/datenschutz" lang="de">Datenschutz</a>
</nav>

<style>
	.legal-links {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	a {
		display: inline-flex;
		align-items: center;
		min-height: 28px;
		padding: 0 0.2rem;
		border-radius: 6px;
		color: #a3a3a3;
		text-decoration: none;
	}

	a:hover {
		color: #fff;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	a:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}

	span {
		color: #525252;
	}
</style>
