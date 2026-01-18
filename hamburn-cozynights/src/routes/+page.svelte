<script lang="ts">
  import { goto } from '$app/navigation';

  let bookingCode = '';

  function handleStart() {
    if (bookingCode.trim()) {
      goto('/map');
    } else {
      alert('Bitte geben Sie einen Buchungscode ein.');
    }
  }
</script>

<section class="hero">
  <video class="background-video" autoplay muted loop playsinline poster="/background.jpg">
    <source src="/background.mp4" type="video/mp4" />
  </video>
  
  <div class="content-wrapper">
    <div class="logo-container">
      <h1 class="burning-text">Hamburn Cozynights</h1>
    </div>
    
    <img src="/logo.png" alt="Vereinslogo" class="club-logo" />
    
    <div class="input-group">
      <input 
        type="text" 
        placeholder="enter your booking code" 
        bind:value={bookingCode} 
        on:keydown={(e) => e.key === 'Enter' && handleStart()}
      />
      <button on:click={handleStart}>Start</button>
    </div>
  </div>

  <button class="admin-btn" on:click={() => goto('/admin')}>Admin</button>

  <svg style="width: 0; height: 0; position: absolute;">
    <defs>
      <filter id="fire-filter" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" />
      </filter>
    </defs>
  </svg>

</section>

<style>
  .hero {
    position: relative;
    min-height: 100vh;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    overflow: hidden;
    background: #222 url('/background.jpg') no-repeat center center / cover;
  }

  .background-video {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .content-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    width: 100%;
    max-width: 800px;
    padding: 20px;
    z-index: 1;
  }

  /* --- DER BRENNENDE TEXT STIL --- */
  .burning-text {
    font-size: 4rem; /* Groß und mächtig */
    font-weight: 900;
    margin-bottom: 1rem;
    white-space: nowrap;
    
    /* Farbe als Farbverlauf (Unten heiß/weiß, oben rot/dunkel) */
    background: linear-gradient(0deg, #ffff00 0%, #ff6600 40%, #ff0000 80%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    
    /* Der Filter aus dem SVG */
    filter: url(#fire-filter);
    
    /* Glühen um den Text herum */
    text-shadow: 0 0 20px rgba(255, 69, 0, 0.6);

    /* Animation für das Flackern */
    animation: flicker-fire 3s infinite alternate;
  }

  /* Lässt das Feuer "atmen" */
  @keyframes flicker-fire {
    0% {
      opacity: 1;
      filter: url(#fire-filter) drop-shadow(0 0 10px rgba(255, 100, 0, 0.5));
      transform: scale(1);
    }
    50% {
      opacity: 0.95;
      filter: url(#fire-filter) drop-shadow(0 0 25px rgba(255, 50, 0, 0.8));
    }
    100% {
      opacity: 1;
      filter: url(#fire-filter) drop-shadow(0 0 15px rgba(255, 120, 0, 0.6));
      transform: scale(1.02); /* Leichtes Pulsieren */
    }
  }

  /* Responsive Anpassung für Mobile */
  @media (max-width: 600px) {
    .burning-text {
      font-size: 2.5rem; /* Kleiner auf Handy */
      white-space: normal; /* Umbruch erlauben */
    }
  }
  /* ------------------------------- */

  .club-logo {
    width: 150px;
    height: auto;
    object-fit: contain;
    margin-bottom: 2rem;
    /* Dein Logo Glühen (habe ich beibehalten) */
    animation: intense-glow 2s ease-in-out infinite alternate;
  }

  @keyframes intense-glow {
    from {
      filter: 
        drop-shadow(0 0 10px rgba(255, 255, 200, 0.8))
        drop-shadow(0 0 30px rgba(255, 140, 0, 0.8))
        drop-shadow(0 0 80px rgba(255, 60, 0, 0.6));
    }
    to {
      filter: 
        drop-shadow(0 0 20px rgba(255, 255, 255, 1))
        drop-shadow(0 0 60px rgba(255, 200, 0, 0.9))
        drop-shadow(0 0 120px rgba(255, 100, 0, 0.8));
    }
  }

  .input-group {
    display: flex;
    gap: 10px;
    background: rgba(255, 255, 255, 0.1);
    padding: 15px;
    border-radius: 10px;
    backdrop-filter: blur(10px);
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
  }

  input {
    padding: 10px 15px;
    font-size: 1rem;
    border: none;
    border-radius: 5px;
    outline: none;
    width: 250px;
  }

  button {
    padding: 10px 20px;
    font-size: 1rem;
    font-weight: bold;
    color: white;
    background: #ff3e00;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.3s;
  }

  button:hover {
    background: #ff5e2b;
  }

  .admin-btn {
    position: absolute;
    bottom: 20px;
    left: 20px;
    width: auto;
    padding: 0.5rem 1rem;
    background: rgba(0, 0, 0, 0.5);
    font-size: 0.9rem;
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: rgba(255, 255, 255, 0.8);
    font-weight: normal;
    z-index: 1;
  }

  .admin-btn:hover {
    background: rgba(0, 0, 0, 0.7);
  }
</style>