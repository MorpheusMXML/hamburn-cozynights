<!--
Booking rules. The bed is part of an Indoor membership, so these are rules of
use, not a contract of their own; the membership terms (LEGAL_TERMS_URL,
published with the ticket shop) apply on top. Keep them in line with what the
app does and with those terms, and don't add rules the organizers haven't
decided.
-->
<script lang="ts">
	import LegalDocument from '$lib/components/LegalDocument.svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	const UPDATED = '18 September 2026';

	$: legal = data.legal;
	// Only the contact address matters here.
	$: missing = legal.missing.filter((key) => key === 'LEGAL_EMAIL');
</script>

<svelte:head>
	<title>Booking rules · CozyNights</title>
</svelte:head>

<LegalDocument title="Booking rules" updated={UPDATED} {missing}>
	<p class="lead">
		CozyNights is where holders of an Indoor membership for Hamburn pick their bed. These rules
		apply to picking a bed; the
		{#if legal.termsUrl}
			<a href={legal.termsUrl} rel="noopener">terms of your membership</a>
		{:else}
			terms you accepted when you bought your membership
		{/if}
		apply as well.
	</p>

	<h2>Who can book</h2>
	<ul>
		<li>
			Only Indoor memberships include a bed, as part of the membership price. Camper memberships
			don't include a bed and have no access to CozyNights.
		</li>
		<li>You book with the ticket code of your Indoor membership. One code, one bed.</li>
		<li>Treat your ticket code like a key: anyone who knows it can change or release your bed.</li>
	</ul>

	<h2>When and how</h2>
	<ul>
		<li>Booking opens at the time the countdown shows. First come, first served.</li>
		<li>
			While booking is open you can change or release your bed. After that, the crew helps you.
		</li>
		<li>Destiny Roulette suggests a random free bed; it is only booked when you confirm.</li>
		<li>Beds the crew has locked ("Reserved by the crew") can't be booked.</li>
	</ul>

	<h2>No claim to a particular bed</h2>
	<p>
		For organizational reasons, for example safety, accessibility or a broken bed, the crew may move
		people to other beds. We then write to the email address of your order.
	</p>

	<h2>Burner name</h2>
	<p>
		The burner name is voluntary. Other guests with a ticket code see it on the room page next to
		your bed. Don't choose a name that is offensive or discriminatory, or someone else's real name;
		the crew may change or remove such names.
	</p>

	<h2>Play fair</h2>
	<ul>
		<li>
			Don't try other people's ticket codes, don't book with scripts or bots, and don't hold beds
			for people without an Indoor membership. In case of abuse the crew may cancel bookings.
		</li>
		<li>
			If you pass on your Indoor membership as its terms allow, the bed goes with the ticket code.
			Let us know, so we can update the email address.
		</li>
	</ul>

	<h2>In the houses</h2>
	<ul>
		<li>Follow the crew's instructions and the house rules of the venue.</li>
		<li>
			<strong>Consent:</strong> only enter other people's sleeping areas with the consent of the people
			sleeping there.
		</li>
		<li><strong>Leave No Trace:</strong> leave your bed the way you found it.</li>
		<li>
			You are liable for damage to the accommodation and its furnishings that you cause through your
			own fault, as the law provides.
		</li>
	</ul>

	<h2>Questions</h2>
	<p>
		Write to us at
		{#if legal.email}
			<a href="mailto:{legal.email}">{legal.email}</a>.
		{:else}
			<span class="missing">(email address missing, LEGAL_EMAIL)</span>.
		{/if}
		How we handle your data is described in the <a href="/privacy">privacy policy</a>.
	</p>
</LegalDocument>
