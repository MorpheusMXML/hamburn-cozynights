<!--
Legal notice (Impressum, § 5 DDG). The operator details are LEGAL_* variables
in the server's .env (`$lib/server/legal`); this file only holds the wording.
-->
<script lang="ts">
	import LegalDocument from '$lib/components/LegalDocument.svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	const REPOSITORY = 'https://github.com/MorpheusMXML/hamburn-cozynights';

	$: legal = data.legal;
	// The hoster only matters for the privacy policy.
	$: missing = legal.missing.filter((key) => key !== 'LEGAL_HOSTER');
	$: phoneHref = legal.phone.replace(/[^\d+]/g, '');
</script>

<svelte:head>
	<title>Legal notice · CozyNights</title>
	<!-- Reachable from every page, but no need to hand the address to search engines. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<LegalDocument title="Legal notice" {missing}>
	<p class="lead">Information according to § 5 DDG (German Digital Services Act)</p>
	<address>
		{#if legal.name}
			<strong>{legal.name}</strong><br />
		{:else}
			<span class="missing">Name of the provider missing (LEGAL_NAME)</span><br />
		{/if}
		{#each legal.address as line}
			{line}<br />
		{:else}
			<span class="missing">Address missing (LEGAL_ADDRESS)</span>
		{/each}
	</address>
	{#if legal.representative}
		<p><strong>Represented by:</strong> {legal.representative}</p>
	{/if}

	<h2>Contact</h2>
	<p>
		Email:
		{#if legal.email}
			<a href="mailto:{legal.email}">{legal.email}</a>
		{:else}
			<span class="missing">missing (LEGAL_EMAIL)</span>
		{/if}
		{#if legal.phone}
			<br />Phone: <a href="tel:{phoneHref}">{legal.phone}</a>
		{/if}
	</p>

	{#if legal.register}
		<h2>Register entry</h2>
		<p>{legal.register}</p>
	{/if}

	{#if legal.vatId}
		<h2>VAT ID</h2>
		<p>VAT identification number according to § 27a of the German VAT Act: {legal.vatId}</p>
	{/if}

	{#if legal.contentResponsible.length}
		<h2>Responsible for the content according to § 18 (2) MStV</h2>
		<p>
			{#each legal.contentResponsible as line}
				{line}<br />
			{/each}
		</p>
	{/if}

	<h2>Disclaimer</h2>

	<h3>Content</h3>
	<p>
		We take care with the content of this website. Still, we can't guarantee that everything is
		complete, correct and up to date at all times. We are responsible for our own content under the
		general laws.
	</p>

	<h3>Links</h3>
	<p>
		This website links to other providers' sites, for example GitHub. Their content is the sole
		responsibility of the respective provider. When we set the links, no legal violations were
		apparent. If we learn of one, we remove the link right away.
	</p>

	<h3>Availability</h3>
	<p>
		CozyNights is run by volunteers. We do our best to keep it running, but we can't guarantee that
		it is always available and free of errors.
	</p>

	<h3>Booking a bed</h3>
	<p>
		Picking a bed follows the <a href="/booking-rules">booking rules</a>
		{#if legal.termsUrl}
			and the <a href={legal.termsUrl} rel="noopener">terms of your membership</a>.
		{:else}
			and the terms you accepted when you bought your membership.
		{/if}
	</p>

	<h3>Copyright</h3>
	<p>
		Texts, images, logos and design of this website are protected by copyright; the rights belong to
		their respective creators. The source code of the app is public
		<a href={REPOSITORY} rel="noopener">on GitHub</a>.
	</p>

	<h2>Privacy</h2>
	<p>
		What data we process and what rights you have is described in the
		<a href="/privacy">privacy policy</a>.
	</p>
</LegalDocument>
