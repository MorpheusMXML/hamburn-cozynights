<script lang="ts">
  import { goto } from '$app/navigation';
  let bookingCode: string = '';

  function handleStart() {
    if (bookingCode.length > 3) {
      goto('/uebersicht');
    } else {
      alert("Bitte gib einen gültigen Code ein.");
    }
  }
</script>

<section class="hero">
  <div class="content-wrapper">
    <h1 class="main-title">Hamburn - Cozynights</h1>
    
    <div class="logo-container">
      <img src="/logo.png" alt="Event Logo" class="title-image" />
    </div>
    
    <div class="login-box">
      <h2>Secure your Bed by entering your Booking Number:</h2>
      <input 
        type="text" 
        bind:value={bookingCode} 
        placeholder="Enter Booking Code" 
      />
      <button on:click={handleStart}>Start</button>
    </div>
  </div>
</section>

<style>
  /* Hero Sektion mit Hintergrund */
  .hero {
    height: 100vh;
    width: 100%;
    background: url('/background.jpg') no-repeat center center/cover;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }

  /* Wrapper für alle Inhalte */
  .content-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center; /* Zentriert alles horizontal */
    text-align: center;
    width: 100%;
    max-width: 600px;
    padding: 20px;
  }

  /* Der neue große Titel */
  .main-title {
    font-size: 3.5rem;
    font-weight: bold;
    color: white;
    margin-bottom: 1rem;
    text-shadow: 2px 2px 10px rgba(0, 0, 0, 0.7); /* Bessere Lesbarkeit */
  }

  /* Logo Container zur Zentrierung */
  .logo-container {
    margin-bottom: 2rem;
  }

  .title-image {
    width: 200px; /* Etwas größer */
    height: auto;
    filter: drop-shadow(0 0 10px rgba(0,0,0,0.5));
  }

  /* Login Box Anpassungen */
  .login-box {
    background: rgba(0, 0, 0, 0.85); /* Weniger transparent (höherer Alpha-Wert) */
    padding: 2.5rem;
    border-radius: 15px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    width: 100%;
    max-width: 400px;
  }

  .login-box h2 {
    color: white;
    margin-top: 0;
    margin-bottom: 1.5rem;
  }

  /* Text in der Box weiß machen */
  input {
    width: 100%;
    padding: 1rem;
    margin-bottom: 1rem;
    border-radius: 8px;
    border: 1px solid #444;
    background: #222; /* Dunklerer Hintergrund für das Input */
    color: white;     /* TEXT FARBE WEISS */
    font-size: 1rem;
    box-sizing: border-box;
  }


  button {
    width: 100%;
    padding: 1rem;
    background: #ff3e00;
    color: white;
    font-weight: bold;
    font-size: 1.1rem;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.3s ease;
  }

  button:hover {
    background: #ff5e2b;
  }
</style>