<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  
  export let form: { error?: string };
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
    
    <form method="POST" action="?/login" use:enhance class="input-group">
      <input 
        type="text" 
        name="bookingCode" 
        placeholder="enter your booking code" 
        required
        autocomplete="off"
      />
      <button type="submit">Start</button>
    </form>

    {#if form?.error}
      <p class="error-msg">{form.error}</p>
    {/if}
  </div>

  <button class="admin-btn" on:click={() => goto('/admin/login')}>Admin</button>

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
  .hero { position: relative; min-height: 100vh; width: 100%; display: flex; align-items: center; justify-content: center; font-family: sans-serif; overflow: hidden; background: #222 center center / cover; }
  .background-video { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }
  .content-wrapper { display: flex; flex-direction: column; align-items: center; text-align: center; width: 100%; max-width: 800px; padding: 20px; z-index: 1; }
  .burning-text { font-size: 4rem; font-weight: 900; background: linear-gradient(0deg, #ffff00 0%, #ff6600 40%, #ff0000 80%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; filter: url(#fire-filter); animation: flicker-fire 3s infinite alternate; }
  @keyframes flicker-fire { 0% { opacity: 1; transform: scale(1); } 100% { opacity: 1; transform: scale(1.02); } }
  .club-logo { width: 150px; height: auto; margin-bottom: 2rem; animation: intense-glow 2s ease-in-out infinite alternate; }
  @keyframes intense-glow { from { filter: drop-shadow(0 0 10px rgba(255, 140, 0, 0.8)); } to { filter: drop-shadow(0 0 20px rgba(255, 200, 0, 0.9)); } }
  .input-group { display: flex; gap: 10px; background: rgba(255, 255, 255, 0.1); padding: 15px; border-radius: 10px; backdrop-filter: blur(10px); }
  input { padding: 10px 15px; font-size: 1rem; border: none; border-radius: 5px; width: 250px; }
  button { padding: 10px 20px; font-size: 1rem; font-weight: bold; color: white; background: #ff3e00; border: none; border-radius: 5px; cursor: pointer; }
  .admin-btn { position: absolute; bottom: 20px; left: 20px; padding: 0.5rem 1rem; background: rgba(0, 0, 0, 0.5); color: white; border: 1px solid rgba(255, 255, 255, 0.3); }
  .error-msg { color: #ff4500; font-weight: bold; margin-top: 15px; text-shadow: 0 0 5px black; }
</style>