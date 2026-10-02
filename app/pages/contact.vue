<template>
  <article class="contact-page">
    <p class="eyebrow">Contact</p>
    <h1>Contact Us</h1>
    <p class="lead">Questions about GPTpatient or your account? Reach the team using the contact information below.</p>
    <a v-if="supportEmail" class="email-link" :href="`mailto:${supportEmail}`">{{ supportEmail }}</a>
    <a v-if="supportPhone" class="phone-link" :href="`tel:${supportPhone}`">{{ supportPhone }}</a>
    <v-alert v-if="!supportEmail && !supportPhone" type="info" variant="tonal">
      Support contact details are not configured yet. Please check back when the GPTpatient support channel is available.
    </v-alert>
    <section class="complaint-process" aria-labelledby="complaint-title">
      <h2 id="complaint-title">Complaints and service issues</h2>
      <ol>
        <li>Contact support by the configured email or phone above.</li>
        <li>Include the sign-in email, a description of the issue, and the date it occurred.</li>
        <li>Support will review the report and contact you using the channel you provided.</li>
      </ol>
      <p v-if="!supportEmail && !supportPhone" class="configuration-note">
        Complaint intake is not operational until a support email or phone is configured.
      </p>
      <div lang="vi">
        <h2>Khiếu nại và sự cố dịch vụ</h2>
        <ol>
          <li>Liên hệ bộ phận hỗ trợ qua email hoặc điện thoại được công bố ở trên.</li>
          <li>Nêu email đăng nhập, mô tả vấn đề và ngày xảy ra sự việc.</li>
          <li>Bộ phận hỗ trợ sẽ xem xét và liên hệ lại qua kênh bạn cung cấp.</li>
        </ol>
        <p v-if="!supportEmail && !supportPhone" class="configuration-note">
          Chưa thể tiếp nhận khiếu nại cho đến khi cấu hình email hoặc số điện thoại hỗ trợ.
        </p>
      </div>
    </section>
    <p class="privacy-note">Do not include real patient identifiers or private health information in support requests.</p>
  </article>
</template>

<script setup lang="ts">
const supportEmail = useRuntimeConfig().public.supportEmail
const supportPhone = useRuntimeConfig().public.merchantPhone
</script>

<style scoped>
.contact-page {
  margin: 0 auto;
  max-width: 760px;
  padding: clamp(2rem, 5vw, 4rem) 1.5rem;
}

.eyebrow {
  color: #267a75;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1 {
  font-size: clamp(2.2rem, 5vw, 3.5rem);
  letter-spacing: -0.04em;
  margin: 0.5rem 0;
}

.lead {
  color: var(--app-muted-text, #59696a);
  font-size: 1.12rem;
  line-height: 1.7;
  margin-bottom: 1.5rem;
}

.email-link {
  color: #176d70;
  font-size: 1.1rem;
  font-weight: 700;
}

.phone-link {
  color: #176d70;
  display: block;
  font-size: 1.1rem;
  font-weight: 700;
  margin-top: 0.5rem;
}

.complaint-process {
  line-height: 1.6;
  margin-top: 2rem;
}

.complaint-process h2 {
  font-size: 1.35rem;
}

.configuration-note {
  color: #805815;
  font-weight: 700;
}

.privacy-note {
  color: var(--app-muted-text, #59696a);
  font-size: 0.9rem;
  margin-top: 1.5rem;
}
</style>
