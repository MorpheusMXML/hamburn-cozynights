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
      <h1>Hamburn Cozynights</h1>
    </div>
    
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

  h1 {
    font-size: 3rem;
    font-weight: bold;
    color: white;
    margin-bottom: 2rem;
    text-shadow: 2px 2px 10px rgba(0, 0, 0, 0.7);
    white-space: nowrap;
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