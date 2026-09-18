<!--
Privacy policy (Art. 13/14 GDPR). It describes what this app actually does;
when the app changes what it stores, shares or logs, update this page and the
date below (checklist: docs/admin/legal.md). Operator details are LEGAL_*
variables in the server's .env (`$lib/server/legal`).
-->
<script lang="ts">
	import LegalDocument from '$lib/components/LegalDocument.svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	const UPDATED = '18 September 2026';
	const GOOGLE_PRIVACY = 'https://policies.google.com/privacy?hl=en';
	const GITHUB_PRIVACY =
		'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement';

	$: legal = data.legal;
</script>

<svelte:head>
	<title>Privacy policy · CozyNights</title>
</svelte:head>

<LegalDocument title="Privacy policy" updated={UPDATED} missing={legal.missing}>
	<h2>In short</h2>
	<ul>
		<li>
			CozyNights is where holders of an Indoor membership for Hamburn pick their bed. We only
			process the data needed for that and for running the site securely.
		</li>
		<li>
			No tracking, no analytics or advertising services and no embedded third-party content: fonts,
			images and videos come from our own server.
		</li>
		<li>We only set cookies the site can't work without, so there is no cookie banner.</li>
	</ul>

	<h2>Controller</h2>
	<p>The controller for the processing of personal data on this website is:</p>
	<address>
		{#if legal.name}
			{legal.name}<br />
		{:else}
			<span class="missing">Name missing (LEGAL_NAME)</span><br />
		{/if}
		{#each legal.address as line}
			{line}<br />
		{:else}
			<span class="missing">Address missing (LEGAL_ADDRESS)</span><br />
		{/each}
		Email:
		{#if legal.privacyEmail}
			<a href="mailto:{legal.privacyEmail}">{legal.privacyEmail}</a>
		{:else}
			<span class="missing">missing (LEGAL_EMAIL)</span>
		{/if}
	</address>
	<p>More details are in the <a href="/legal-notice">legal notice</a>.</p>

	<h2>Hosting</h2>
	<p>This website runs on a server of:</p>
	<address>
		{#each legal.hoster as line}
			{line}<br />
		{:else}
			<span class="missing">Hosting provider missing (LEGAL_HOSTER)</span>
		{/each}
	</address>
	<p>
		The provider processes the data only on our behalf, under a data processing agreement according
		to Art. 28 GDPR. The server is located in the European Union.
	</p>

	<h2>When you visit the website</h2>
	<h3>Server log files</h3>
	<p>
		With every request our web server automatically stores: IP address, date and time, the requested
		address, status code, amount of data transferred, the page you came from (referrer) and your
		browser's identification (user agent). We need this data to deliver the website, find errors and
		fend off attacks. The legal basis is our legitimate interest in a secure and stable operation
		(Art. 6(1)(f) GDPR). The log files are deleted automatically after
		{legal.logRetentionDays} days.
	</p>
	<h3>Protection against guessing ticket codes</h3>
	<p>
		If you enter a wrong ticket code several times, the app keeps your IP address in memory for up
		to ten minutes and slows down further attempts. This protects every guest's ticket code (Art.
		6(1)(f) GDPR). Ticket codes themselves never end up in log files.
	</p>

	<h2>Booking a bed</h2>
	<p>Only Indoor memberships include a bed. For them we process:</p>
	<ul>
		<li>
			your <strong>ticket code</strong> and the <strong>email address</strong> of your order. We take
			both from the ticket shop in which you bought your membership;
		</li>
		<li>the <strong>bed</strong> you choose and when you booked it;</li>
		<li>
			your <strong>burner name</strong>, if you enter one. This is voluntary: leave the field empty
			and the app rolls a made-up name. Other guests with a ticket code and the crew see the name on
			the room page next to your bed.
		</li>
	</ul>
	<p>
		We use this data to allocate the beds as part of your participation in the event and to contact
		you about your bed, for example if the crew has to move you (Art. 6(1)(b) GDPR). Other guests
		never see your email address, and we don't use it for advertising. We process the burner name
		because you give it voluntarily (consent, Art. 6(1)(a) GDPR). While booking is open you can
		change it or release your bed; after that the crew helps you. Burner names are stored encrypted.
	</p>
	<p>
		After you sign in, your browser keeps the ticket code in a cookie (<code>bookingCode</code>) for
		30 days so you stay signed in. Scripts on the page can't read it. The cookie is strictly
		necessary (§ 25(2) no. 2 TDDDG).
	</p>
	<p>
		We delete bookings, burner names and the ticket list as soon as we no longer need them,
		{legal.deletionPeriod}.
	</p>

	<h2>Crew sign-in</h2>
	<p>
		Crew members sign in only with the Google account of the organization. The website redirects to
		Google (Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Ireland). Google
		processes the sign-in as a controller in its own right under its
		<a href={GOOGLE_PRIVACY} rel="noopener">privacy policy</a>; data may be transferred to Google
		LLC in the USA. Google is certified under the EU-U.S. Data Privacy Framework.
	</p>
	<p>
		For crew accounts we store the email address, where applicable a name, and the role. After
		sign-in a session cookie (<code>pb_auth</code>, three days, extended while in use) keeps the
		crew member signed in; during sign-in a second cookie (<code>admin_oauth</code>, ten minutes)
		protects against forged sign-ins. The legal basis is our legitimate interest in secure access to
		the administration (Art. 6(1)(f) GDPR). We delete crew accounts when someone leaves the crew.
	</p>

	<h2>Settings in your browser</h2>
	<p>
		The start page remembers in your browser's storage (localStorage) whether you paused the title
		animation; the guide remembers, for example, ticked checklists. These entries stay in your
		browser and are not sent to us. You can delete them at any time in your browser settings.
	</p>

	<h2>The guide on GitHub Pages</h2>
	<p>
		The public guide (Help &amp; FAQ) is also available on GitHub Pages, a service of GitHub, Inc.
		(USA). When you open it there, GitHub processes your IP address in its server logs. GitHub is
		certified under the EU-U.S. Data Privacy Framework. The legal basis is our legitimate interest
		in providing the guide easily (Art. 6(1)(f) GDPR). More in
		<a href={GITHUB_PRIVACY} rel="noopener">GitHub's privacy statement</a>. This also applies when
		you follow links to the source code on GitHub.
	</p>

	<h2>Contacting us by email</h2>
	<p>
		If you write to us, we process your message and your contact details to reply (Art. 6(1)(b) or
		(f) GDPR) and delete them once the matter is settled and no retention obligation applies.
	</p>

	<h2>Recipients and security</h2>
	<p>
		We don't sell data and don't pass it on to third parties. Only the crew members who organize the
		beds and the hosting provider, as our processor, have access. The connection to the website is
		encrypted with TLS. We back up the database regularly; backups are overwritten when their
		retention time is over. There is no automated decision-making or profiling.
	</p>
	<p>Without a ticket code you can't pick a bed; everything else is voluntary.</p>

	<h2>Your rights</h2>
	<p>You have the right to:</p>
	<ul>
		<li>access to your data (Art. 15 GDPR),</li>
		<li>rectification of incorrect data (Art. 16 GDPR),</li>
		<li>erasure (Art. 17 GDPR) and restriction of processing (Art. 18 GDPR),</li>
		<li>data portability (Art. 20 GDPR),</li>
		<li>
			withdraw your consent at any time with effect for the future (Art. 7(3) GDPR), for example by
			deleting your burner name or writing to us.
		</li>
	</ul>
	<p class="callout">
		<strong>Right to object:</strong> Where we process data on the basis of our legitimate interests (Art.
		6(1)(f) GDPR), you can object at any time on grounds relating to your particular situation (Art. 21
		GDPR). We then no longer process the data unless we can demonstrate compelling legitimate grounds
		that override your interests, or the processing serves the establishment, exercise or defence of legal
		claims.
	</p>
	<p>
		Just write to us at
		{#if legal.privacyEmail}
			<a href="mailto:{legal.privacyEmail}">{legal.privacyEmail}</a>.
		{:else}
			<span class="missing">(email address missing, LEGAL_EMAIL)</span>.
		{/if}
	</p>
	<p>
		You can also lodge a complaint with a data protection supervisory authority (Art. 77 GDPR), in
		particular in the member state of your habitual residence, your place of work or the place of
		the alleged infringement.
		{#if legal.supervisoryAuthority}
			The authority responsible for us is {legal.supervisoryAuthority}.
		{/if}
	</p>

	<h2>Changes</h2>
	<p>
		We update this privacy policy when the app or the law changes. The version published here
		applies.
	</p>
</LegalDocument>
