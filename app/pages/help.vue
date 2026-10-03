<template>
  <article class="content-page">
    <p class="eyebrow">Help</p>
    <h1>Using the patient encounter</h1>
    <h2>The patient session does not start</h2>
    <p>Session creation and patient setup require the GPTMD API, authentication, PostgreSQL, Redis JSON, and configured patient generation. If setup is unavailable, check the API service and confirm that all database migrations are applied.</p>
    <h2>Microphone or audio is unavailable</h2>
    <p>Voice conversation uses the browser's standard speech recognition and speech synthesis APIs. Support and audio processing vary by browser; if recognition is unavailable or denied, switch to Transcript mode. Never use real patient information.</p>
    <h2>Training data</h2>
    <p>Cases are fictional. Do not enter real patient identifiers, private health information, or other sensitive personal data.</p>
  </article>
</template>
