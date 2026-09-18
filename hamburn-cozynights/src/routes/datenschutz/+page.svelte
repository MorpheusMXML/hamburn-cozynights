<!--
Datenschutzerklärung (privacy policy, Art. 13/14 GDPR). German on purpose,
like the legal notice. It describes what this app actually does; when the app
changes what it stores, shares or logs, update this page and the date below.
Operator details are LEGAL_* variables in the server's .env
(`$lib/server/legal`).
-->
<script lang="ts">
	import LegalDocument from '$lib/components/LegalDocument.svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	const UPDATED = '18. September 2026';
	const GOOGLE_PRIVACY = 'https://policies.google.com/privacy?hl=de';
	const GITHUB_PRIVACY =
		'https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement';

	$: legal = data.legal;
</script>

<svelte:head>
	<title>Datenschutzerklärung · CozyNights</title>
</svelte:head>

<LegalDocument title="Datenschutzerklärung" updated={UPDATED} missing={legal.missing}>
	<h2>Das Wichtigste in Kürze</h2>
	<ul>
		<li>
			CozyNights ist das Werkzeug, mit dem Ticketinhaberinnen und Ticketinhaber ihren Schlafplatz
			für Hamburn wählen. Wir verarbeiten nur die Daten, die dafür und für einen sicheren Betrieb
			nötig sind.
		</li>
		<li>
			Es gibt kein Tracking, keine Analyse- oder Werbedienste und keine eingebundenen Inhalte
			Dritter: Schriften, Bilder und Videos kommen von unserem eigenen Server.
		</li>
		<li>Wir setzen nur technisch notwendige Cookies. Deshalb gibt es auch kein Cookie-Banner.</li>
	</ul>

	<h2>Verantwortlich</h2>
	<p>Verantwortlich für die Datenverarbeitung auf dieser Website ist:</p>
	<address>
		{#if legal.name}
			{legal.name}<br />
		{:else}
			<span class="missing">Name fehlt (LEGAL_NAME)</span><br />
		{/if}
		{#each legal.address as line}
			{line}<br />
		{:else}
			<span class="missing">Anschrift fehlt (LEGAL_ADDRESS)</span><br />
		{/each}
		E-Mail:
		{#if legal.privacyEmail}
			<a href="mailto:{legal.privacyEmail}">{legal.privacyEmail}</a>
		{:else}
			<span class="missing">fehlt (LEGAL_EMAIL)</span>
		{/if}
	</address>
	<p>Weitere Angaben findest du im <a href="/impressum">Impressum</a>.</p>

	<h2>Hosting</h2>
	<p>Die Website läuft auf einem Server von:</p>
	<address>
		{#each legal.hoster as line}
			{line}<br />
		{:else}
			<span class="missing">Hosting-Anbieter fehlt (LEGAL_HOSTER)</span>
		{/each}
	</address>
	<p>
		Der Anbieter verarbeitet die Daten ausschließlich in unserem Auftrag; mit ihm besteht ein
		Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO. Der Server steht in der Europäischen Union.
	</p>

	<h2>Beim Besuch der Website</h2>
	<h3>Server-Logdateien</h3>
	<p>
		Bei jedem Aufruf speichert unser Webserver automatisch: IP-Adresse, Datum und Uhrzeit,
		aufgerufene Adresse, Statuscode, übertragene Datenmenge, die zuvor besuchte Seite (Referrer) und
		die Kennung deines Browsers. Wir brauchen diese Daten, um die Website auszuliefern, Fehler zu
		finden und Angriffe abzuwehren. Rechtsgrundlage ist unser berechtigtes Interesse an einem
		sicheren und stabilen Betrieb (Art. 6 Abs. 1 lit. f DSGVO). Die Logdateien werden nach
		{legal.logRetentionDays} Tagen automatisch gelöscht.
	</p>
	<h3>Schutz vor dem Erraten von Ticketcodes</h3>
	<p>
		Gibst du mehrfach einen falschen Ticketcode ein, merkt sich die Anwendung deine IP-Adresse für
		bis zu zehn Minuten im Arbeitsspeicher und bremst weitere Versuche. So schützen wir die
		Ticketcodes aller Gäste (Art. 6 Abs. 1 lit. f DSGVO). Ticketcodes selbst landen nie in
		Logdateien.
	</p>

	<h2>Schlafplatzwahl mit Ticketcode</h2>
	<p>Für die Schlafplatzwahl verarbeiten wir:</p>
	<ul>
		<li>
			deinen <strong>Ticketcode</strong> und die <strong>E-Mail-Adresse</strong> aus deiner Ticketbestellung.
			Beides übernehmen wir aus unserem Ticketverkauf für Hamburn;
		</li>
		<li>den <strong>Schlafplatz</strong>, den du wählst, und den Zeitpunkt der Buchung;</li>
		<li>
			deinen <strong>Burner-Namen</strong>, falls du einen angibst. Das ist freiwillig: Lässt du das
			Feld leer, würfelt die App einen Fantasienamen. Andere Gäste mit Ticketcode und die Crew sehen
			den Namen auf der Zimmerseite neben deinem Platz.
		</li>
	</ul>
	<p>
		Wir nutzen diese Daten, um die Schlafplätze im Rahmen deiner Teilnahme an der Veranstaltung zu
		verteilen und dich dazu zu erreichen, etwa wenn die Crew umverteilen muss (Art. 6 Abs. 1 lit. b
		DSGVO). Deine E-Mail-Adresse sehen andere Gäste nicht, und wir schicken dir darüber keine
		Werbung. Den Burner-Namen verarbeiten wir, weil du ihn freiwillig angibst (Einwilligung, Art. 6
		Abs. 1 lit. a DSGVO). Solange die Buchung offen ist, kannst du ihn ändern oder deinen Platz
		freigeben; danach hilft dir die Crew. Burner-Namen speichern wir verschlüsselt.
	</p>
	<p>
		Nach deiner Anmeldung speichert dein Browser den Ticketcode 30 Tage lang in einem Cookie (<code
			>bookingCode</code
		>), damit du angemeldet bleibst. Skripte auf der Seite können ihn nicht lesen. Das Cookie ist
		technisch notwendig (§ 25 Abs. 2 Nr. 2 TDDDG).
	</p>
	<p>
		Buchungen, Burner-Namen und die Ticketliste löschen wir, sobald wir sie nicht mehr brauchen, {legal.deletionPeriod}.
	</p>

	<h2>Anmeldung der Crew</h2>
	<p>
		Crew-Mitglieder melden sich ausschließlich mit ihrem Google-Konto der Orga an. Dabei leitet die
		Website zu Google weiter (Google Ireland Limited, Gordon House, Barrow Street, Dublin 4,
		Irland). Google verarbeitet die Anmeldung als eigener Verantwortlicher nach seiner
		<a href={GOOGLE_PRIVACY} rel="noopener">Datenschutzerklärung</a>; dabei können Daten an Google
		LLC in den USA übermittelt werden. Google ist nach dem EU-US Data Privacy Framework
		zertifiziert.
	</p>
	<p>
		Von Crew-Konten speichern wir die E-Mail-Adresse, gegebenenfalls einen Namen und die Rolle. Nach
		der Anmeldung hält ein Sitzungs-Cookie (<code>pb_auth</code>, drei Tage, bei Nutzung verlängert)
		die Anmeldung aufrecht; während der Anmeldung schützt ein zweites Cookie (<code
			>admin_oauth</code
		>, zehn Minuten) vor untergeschobenen Anmeldungen. Rechtsgrundlage ist unser berechtigtes
		Interesse an einem sicheren Zugang zur Verwaltung (Art. 6 Abs. 1 lit. f DSGVO). Crew-Konten
		löschen wir, wenn jemand nicht mehr zur Crew gehört.
	</p>

	<h2>Einstellungen im Browser</h2>
	<p>
		Die Startseite merkt sich im Speicher deines Browsers (localStorage), ob du die Titel-Animation
		angehalten hast; die Anleitung merkt sich zum Beispiel abgehakte Checklisten. Diese Einträge
		bleiben in deinem Browser und werden nicht an uns übertragen. Du kannst sie jederzeit über die
		Browser-Einstellungen löschen.
	</p>

	<h2>Anleitung auf GitHub Pages</h2>
	<p>
		Die öffentliche Anleitung (Help &amp; FAQ) steht zusätzlich auf GitHub Pages, einem Dienst der
		GitHub, Inc. (USA). Rufst du sie dort auf, verarbeitet GitHub deine IP-Adresse in seinen
		Server-Logs. GitHub ist nach dem EU-US Data Privacy Framework zertifiziert. Rechtsgrundlage ist
		unser berechtigtes Interesse, die Anleitung einfach bereitzustellen (Art. 6 Abs. 1 lit. f
		DSGVO). Mehr dazu in der
		<a href={GITHUB_PRIVACY} rel="noopener">Datenschutzerklärung von GitHub</a>. Das gilt auch, wenn
		du Links zum Quellcode auf GitHub folgst.
	</p>

	<h2>Kontakt per E-Mail</h2>
	<p>
		Schreibst du uns, verarbeiten wir deine Nachricht und deine Kontaktdaten, um dir zu antworten
		(Art. 6 Abs. 1 lit. b oder f DSGVO), und löschen sie, wenn die Sache erledigt ist und keine
		Aufbewahrungspflichten bestehen.
	</p>

	<h2>Empfänger und Sicherheit</h2>
	<p>
		Wir verkaufen keine Daten und geben sie nicht an Dritte weiter. Zugriff haben nur die
		Crew-Mitglieder, die die Schlafplätze organisieren, und der Hosting-Anbieter im Rahmen der
		Auftragsverarbeitung. Die Verbindung zur Website ist per TLS verschlüsselt. Von der Datenbank
		erstellen wir regelmäßig Sicherungskopien, die nach Ablauf ihrer Aufbewahrungszeit überschrieben
		werden. Eine automatisierte Entscheidungsfindung oder Profilbildung findet nicht statt.
	</p>
	<p>Ohne Ticketcode kannst du keinen Schlafplatz wählen; alle anderen Angaben sind freiwillig.</p>

	<h2>Deine Rechte</h2>
	<p>Du hast das Recht auf:</p>
	<ul>
		<li>Auskunft über deine gespeicherten Daten (Art. 15 DSGVO),</li>
		<li>Berichtigung unrichtiger Daten (Art. 16 DSGVO),</li>
		<li>Löschung (Art. 17 DSGVO) und Einschränkung der Verarbeitung (Art. 18 DSGVO),</li>
		<li>Datenübertragbarkeit (Art. 20 DSGVO),</li>
		<li>
			Widerruf einer Einwilligung mit Wirkung für die Zukunft (Art. 7 Abs. 3 DSGVO), etwa indem du
			deinen Burner-Namen löschst oder uns schreibst.
		</li>
	</ul>
	<p class="callout">
		<strong>Widerspruchsrecht:</strong> Verarbeiten wir Daten auf Grundlage unseres berechtigten Interesses
		(Art. 6 Abs. 1 lit. f DSGVO), kannst du dem aus Gründen, die sich aus deiner besonderen Situation
		ergeben, jederzeit widersprechen (Art. 21 DSGVO). Wir verarbeiten die Daten dann nicht mehr, es sei
		denn, wir können zwingende schutzwürdige Gründe nachweisen, die deine Interessen überwiegen, oder
		die Verarbeitung dient der Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen.
	</p>
	<p>
		Schreib uns dafür einfach an
		{#if legal.privacyEmail}
			<a href="mailto:{legal.privacyEmail}">{legal.privacyEmail}</a>.
		{:else}
			<span class="missing">(E-Mail-Adresse fehlt, LEGAL_EMAIL)</span>.
		{/if}
	</p>
	<p>
		Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO),
		insbesondere in dem Mitgliedstaat deines Wohnorts, deines Arbeitsplatzes oder des mutmaßlichen
		Verstoßes.
		{#if legal.supervisoryAuthority}
			Für uns zuständig ist: {legal.supervisoryAuthority}.
		{/if}
	</p>

	<h2>Änderungen</h2>
	<p>
		Wir passen diese Datenschutzerklärung an, wenn sich die Anwendung oder die Rechtslage ändert. Es
		gilt die hier veröffentlichte Fassung.
	</p>
</LegalDocument>
