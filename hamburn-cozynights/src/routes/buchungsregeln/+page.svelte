<!--
Buchungsregeln (rules for picking a sleeping spot). German on purpose, like
the other legal pages. The spot is part of the Hamburn ticket, so these are
rules of use, not a contract of their own; the event's participation terms
(LEGAL_TERMS_URL, published with the ticket shop) apply on top. Keep them in
line with what the app does and with the participation terms.
-->
<script lang="ts">
	import LegalDocument from '$lib/components/LegalDocument.svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	const UPDATED = '18. September 2026';

	$: legal = data.legal;
	// Only the contact address matters here.
	$: missing = legal.missing.filter((key) => key === 'LEGAL_EMAIL');
</script>

<svelte:head>
	<title>Buchungsregeln · CozyNights</title>
</svelte:head>

<LegalDocument title="Buchungsregeln" updated={UPDATED} {missing}>
	<p class="lead">
		Mit CozyNights wählst du den Schlafplatz, der zu deinem Hamburn-Ticket gehört. Diese Regeln
		gelten für die Wahl; ergänzend gelten die
		{#if legal.termsUrl}
			<a href={legal.termsUrl} rel="noopener">Teilnahmebedingungen von Hamburn</a>.
		{:else}
			Teilnahmebedingungen von Hamburn, die du beim Ticketkauf akzeptiert hast.
		{/if}
	</p>

	<h2>Wer buchen kann</h2>
	<ul>
		<li>
			Buchen kannst du mit einem gültigen Ticketcode. Ein Ticket steht für genau einen Schlafplatz;
			der Platz ist im Ticket enthalten und kostet nichts extra.
		</li>
		<li>
			Behandle deinen Ticketcode wie einen Schlüssel: Wer ihn kennt, kann deinen Platz wechseln oder
			freigeben.
		</li>
	</ul>

	<h2>Wann und wie</h2>
	<ul>
		<li>
			Die Buchung öffnet zu dem Zeitpunkt, den der Countdown anzeigt. Wer zuerst wählt, bekommt den
			Platz.
		</li>
		<li>
			Solange die Buchung offen ist, kannst du deinen Platz wechseln oder freigeben. Danach hilft
			dir die Crew.
		</li>
		<li>
			Das Destiny Roulette schlägt einen zufälligen freien Platz vor; gebucht ist er erst, wenn du
			bestätigst.
		</li>
		<li>Plätze, die die Crew gesperrt hat („Reserved by the crew“), kann niemand buchen.</li>
	</ul>

	<h2>Kein Anspruch auf einen bestimmten Platz</h2>
	<p>
		Aus organisatorischen Gründen, etwa wegen Sicherheit, Barrierefreiheit oder defekter Betten,
		kann die Crew Plätze umverteilen. Dann schreiben wir dir an die E-Mail-Adresse aus deiner
		Ticketbestellung. Hast du keinen Platz gewählt, sagt dir die Crew vor Ort, wo du schläfst.
	</p>

	<h2>Burner-Name</h2>
	<p>
		Der Burner-Name ist freiwillig. Andere Gäste mit Ticketcode sehen ihn auf der Zimmerseite neben
		deinem Platz. Wähle keinen beleidigenden oder diskriminierenden Namen und nicht den echten Namen
		einer anderen Person; solche Namen kann die Crew ändern oder entfernen.
	</p>

	<h2>Fair bleiben</h2>
	<ul>
		<li>
			Probiere keine fremden Ticketcodes aus, buche nicht automatisiert und halte keine Plätze für
			Menschen ohne Ticket frei. Bei Missbrauch kann die Crew Buchungen aufheben.
		</li>
		<li>
			Gibst du dein Ticket nach den Teilnahmebedingungen weiter, geht der Platz mit dem Ticketcode
			auf die neue Person über. Sag uns Bescheid, damit wir die E-Mail-Adresse dazu aktualisieren
			können.
		</li>
	</ul>

	<h2>In den Unterkünften</h2>
	<ul>
		<li>
			Es gelten die Hausregeln, die vor Ort aushängen. Immer gilt: kein offenes Feuer und keine
			Kerzen in Gebäuden, Rücksicht in geteilten Räumen.
		</li>
		<li>
			<strong>Consent:</strong> Fremde Schlafbereiche betrittst du nur mit Zustimmung der Menschen, die
			dort schlafen.
		</li>
		<li>Leave No Trace: Hinterlasse deinen Platz so, wie du ihn vorgefunden hast.</li>
		<li>
			Für Schäden an Unterkunft und Inventar, die du schuldhaft verursachst, haftest du nach den
			gesetzlichen Vorschriften.
		</li>
	</ul>

	<h2>Fragen</h2>
	<p>
		Schreib uns an
		{#if legal.email}
			<a href="mailto:{legal.email}">{legal.email}</a>.
		{:else}
			<span class="missing">(E-Mail-Adresse fehlt, LEGAL_EMAIL)</span>.
		{/if}
		Wie wir mit deinen Daten umgehen, steht in der <a href="/datenschutz">Datenschutzerklärung</a>.
	</p>
</LegalDocument>
