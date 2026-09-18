<!--
Impressum (legal notice, § 5 DDG). German on purpose, like the privacy page.
The operator details are LEGAL_* variables in the server's .env
(`$lib/server/legal`); this file only holds the wording.
-->
<script lang="ts">
	import LegalDocument from '$lib/components/LegalDocument.svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	const REPOSITORY = 'https://github.com/MorpheusMXML/hamburn-cozynights';

	$: legal = data.legal;
	// The hoster only matters for the privacy page.
	$: missing = legal.missing.filter((key) => key !== 'LEGAL_HOSTER');
	$: phoneHref = legal.phone.replace(/[^\d+]/g, '');
</script>

<svelte:head>
	<title>Impressum · CozyNights</title>
	<!-- Reachable from every page, but no need to hand the address to search engines. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<LegalDocument title="Impressum" {missing}>
	<p class="lead">Angaben gemäß § 5 DDG</p>
	<address>
		{#if legal.name}
			<strong>{legal.name}</strong><br />
		{:else}
			<span class="missing">Name des Anbieters fehlt (LEGAL_NAME)</span><br />
		{/if}
		{#each legal.address as line}
			{line}<br />
		{:else}
			<span class="missing">Anschrift fehlt (LEGAL_ADDRESS)</span>
		{/each}
	</address>
	{#if legal.representative}
		<p><strong>Vertreten durch:</strong> {legal.representative}</p>
	{/if}

	<h2>Kontakt</h2>
	<p>
		E-Mail:
		{#if legal.email}
			<a href="mailto:{legal.email}">{legal.email}</a>
		{:else}
			<span class="missing">fehlt (LEGAL_EMAIL)</span>
		{/if}
		{#if legal.phone}
			<br />Telefon: <a href="tel:{phoneHref}">{legal.phone}</a>
		{/if}
	</p>

	{#if legal.register}
		<h2>Registereintrag</h2>
		<p>{legal.register}</p>
	{/if}

	{#if legal.vatId}
		<h2>Umsatzsteuer-ID</h2>
		<p>Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz: {legal.vatId}</p>
	{/if}

	{#if legal.contentResponsible.length}
		<h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
		<p>
			{#each legal.contentResponsible as line}
				{line}<br />
			{/each}
		</p>
	{/if}

	<h2>Haftungsausschluss</h2>

	<h3>Inhalte</h3>
	<p>
		Wir pflegen die Inhalte dieser Website sorgfältig. Trotzdem können wir nicht garantieren, dass
		alle Angaben jederzeit vollständig, richtig und aktuell sind. Für eigene Inhalte sind wir nach
		den allgemeinen Gesetzen verantwortlich.
	</p>

	<h3>Links</h3>
	<p>
		Diese Website verlinkt auf Angebote Dritter, zum Beispiel auf GitHub. Für deren Inhalte ist
		allein der jeweilige Anbieter verantwortlich. Als wir die Links gesetzt haben, waren keine
		Rechtsverstöße erkennbar. Erfahren wir von einer Rechtsverletzung, entfernen wir den Link
		umgehend.
	</p>

	<h3>Verfügbarkeit</h3>
	<p>
		CozyNights wird ehrenamtlich betrieben. Wir bemühen uns um einen störungsfreien Betrieb, können
		aber nicht garantieren, dass die Anwendung jederzeit erreichbar und fehlerfrei ist.
	</p>

	<h3>Schlafplatzwahl</h3>
	<p>
		Für die Wahl der Schlafplätze gelten die <a href="/buchungsregeln">Buchungsregeln</a>
		{#if legal.termsUrl}
			und die <a href={legal.termsUrl} rel="noopener">Teilnahmebedingungen von Hamburn</a>.
		{:else}
			und die Teilnahmebedingungen von Hamburn, die du beim Ticketkauf akzeptiert hast.
		{/if}
	</p>

	<h3>Urheberrecht</h3>
	<p>
		Texte, Bilder, Logos und Gestaltung dieser Website sind urheberrechtlich geschützt; die Rechte
		liegen bei den jeweiligen Urheberinnen und Urhebern. Der Quellcode der Anwendung ist
		<a href={REPOSITORY} rel="noopener">auf GitHub</a> öffentlich einsehbar.
	</p>

	<h2>Datenschutz</h2>
	<p>
		Welche Daten wir verarbeiten und welche Rechte du hast, steht in der
		<a href="/datenschutz">Datenschutzerklärung</a>.
	</p>
</LegalDocument>
