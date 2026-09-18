<!--
@component
One line under a booking button: the booking rules (/booking-rules) apply.
Opens in a new tab, so an open booking dialog stays as it is.
-->
<p class="booking-rules">
	The <a href="/booking-rules" target="_blank" rel="noopener">booking rules</a> apply.
</p>

<style>
	.booking-rules {
		margin: 0.9rem 0 0;
		color: #8a8a8a;
		font-size: 0.78rem;
		line-height: 1.5;
		text-align: center;
	}

	a {
		color: #b5b5b5;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	a:hover {
		color: #fff;
	}

	a:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
		border-radius: 4px;
	}
</style>
