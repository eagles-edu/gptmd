<template>
  <main class="checkout-demo" :class="{ 'theme-dark': isDark }" aria-labelledby="checkout-title">
    <div class="demo-banner">
      <span class="demo-dot" aria-hidden="true"/>
      CHECKOUT PREVIEW · SAMPLE PRICES · NO PAYMENT IS PROCESSED
    </div>

    <header class="checkout-heading">
      <div>
        <p class="eyebrow">GPTpatient membership · Gói GPTpatient</p>
        <h1 id="checkout-title">Practice with confidence.</h1>
        <p class="heading-copy">Choose an access period and review a digital service checkout preview.</p>
      </div>
      <div class="secure-note delivery-note">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z" /><path d="M4 9h16M8 5v4m8-4v4" /></svg>
        <span><strong>Digital access</strong><small>No physical shipment</small></span>
      </div>
    </header>

    <nav class="checkout-steps" aria-label="Checkout stages">
      <button
        v-for="(label, index) in stageLabels"
        :key="label"
        type="button"
        class="step-button"
        :class="{ 'is-active': stage === index, 'is-complete': stage > index }"
        :aria-current="stage === index ? 'step' : undefined"
        :aria-label="`Stage ${index + 1}: ${label}`"
        :disabled="index > stage"
        @click="stage = index"
      >
        <span class="step-number">
          <svg v-if="stage > index" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>
          <template v-else>{{ index + 1 }}</template>
        </span>
        <span class="step-label">{{ label }}</span>
      </button>
    </nav>

    <div class="checkout-layout">
      <section class="checkout-panel" aria-live="polite">
        <template v-if="stage === 0">
          <div class="panel-heading">
            <p class="panel-kicker">01 · Select access</p>
            <h2>Choose your practice plan</h2>
            <p>Build your clinical communication skills with unlimited simulated encounters.</p>
          </div>
          <fieldset class="plan-options">
            <legend class="visually-hidden">Membership duration</legend>
            <label
              class="plan-option"
              :class="{ 'plan-selected': selectedTerm === 'three' }"
            >
              <input v-model="selectedTerm" class="native-radio" type="radio" name="membership-duration" value="three">
              <span class="plan-copy"><strong>3-month access</strong><small>A shorter first term for your practice</small></span>
              <span class="plan-price"><strong>$60.00</strong><small>sample amount</small></span>
            </label>
            <label
              class="plan-option"
              :class="{ 'plan-selected': selectedTerm === 'six' }"
            >
              <input v-model="selectedTerm" class="native-radio" type="radio" name="membership-duration" value="six">
              <span class="plan-copy"><strong>6-month access</strong><small>Flexible access to your practice space</small></span>
              <span class="plan-price"><strong>$120.00</strong><small>sample amount</small></span>
            </label>
            <label
              class="plan-option"
              :class="{ 'plan-selected': selectedTerm === 'twelve' }"
            >
              <input v-model="selectedTerm" class="native-radio" type="radio" name="membership-duration" value="twelve">
              <span class="plan-copy"><strong>12-month access</strong><small>A full year to sharpen your skills</small></span>
              <span class="plan-price"><strong>$216.00</strong><small>sample amount</small></span>
              <span class="plan-badge">BEST VALUE</span>
            </label>
          </fieldset>
          <div class="renewal-note">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <span><strong>Nothing renews automatically.</strong> You choose when to purchase your next access period.</span>
          </div>
          <div class="panel-actions">
            <span class="quiet-copy">You can review everything before payment.</span>
            <button class="primary-button" type="button" @click="addPlanToCart">{{ hasPlanInCart ? 'Update plan in cart' : 'Add plan to cart' }} <span aria-hidden="true">→</span></button>
          </div>
        </template>

        <template v-else-if="stage === 1">
          <div class="panel-heading">
            <p class="panel-kicker">02 · Contact and delivery · Liên hệ và cung cấp</p>
            <h2>Where should access details go?</h2>
            <p>Thông tin truy cập sẽ được gửi đến đâu?</p>
            <p>This preview keeps the information on this page only. It is not sent or saved. · Bản xem trước chỉ giữ thông tin trên trang này, không gửi hoặc lưu lại.</p>
          </div>
          <form class="buyer-details" @submit.prevent="stage = 2">
            <label class="field-label" for="buyer-name">Name <span>Họ và tên</span></label>
            <input id="buyer-name" v-model.trim="buyerName" autocomplete="name" name="name" type="text" required>
            <label class="field-label" for="buyer-email">Email for service information <span>Email nhận thông tin dịch vụ</span></label>
            <input id="buyer-email" v-model.trim="buyerEmail" autocomplete="email" name="email" type="email" required>
            <label class="field-label" for="billing-address">Billing/contact address <span>Địa chỉ thanh toán/liên hệ</span></label>
            <textarea id="billing-address" v-model.trim="billingAddress" autocomplete="street-address" name="address" rows="3" required/>
            <label class="field-label" for="delivery-method">Delivery method <span>Phương thức cung cấp</span></label>
            <select id="delivery-method" v-model="deliveryMethod" name="delivery-method" required>
              <option value="digital">Digital workspace access · Truy cập không gian làm việc số</option>
            </select>
            <p class="field-help">No package or carrier is used. Workspace access would be provided after a confirmed payment; that activation is not connected yet.</p>
            <p class="field-help" lang="vi">Không giao hàng vật lý. Quyền truy cập sẽ được cấp sau khi xác nhận thanh toán; chức năng kích hoạt hiện chưa được kết nối.</p>
            <div class="panel-actions">
              <button class="text-button" type="button" @click="stage = 0">← Change plan</button>
              <button class="primary-button" type="submit">Review details · Xem lại thông tin <span aria-hidden="true">→</span></button>
            </div>
          </form>
        </template>

        <template v-else-if="stage === 2">
          <div class="panel-heading">
            <p class="panel-kicker">03 · Review your order</p>
            <h2>Everything look right?</h2>
            <p>This is a preview. No order has been submitted.</p>
          </div>
          <div class="order-review">
            <div class="review-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /><path d="M8 7h8M8 11h8" /></svg>
            </div>
            <div class="review-copy"><strong>GPTpatient practice access</strong><span>{{ termLabel }}</span><small>One-time purchase · No automatic renewal</small></div>
            <strong class="review-price">{{ priceLabel }}</strong>
          </div>
          <div class="included-section">
            <h3>Included with your access</h3>
            <ul>
              <li><span aria-hidden="true">✓</span> Guided history-taking practice</li>
              <li><span aria-hidden="true">✓</span> Simulated patient encounters</li>
              <li><span aria-hidden="true">✓</span> Progress tools for your learning</li>
            </ul>
          </div>
          <dl class="buyer-review">
            <div><dt>Name</dt><dd>{{ buyerName }}</dd></div>
            <div><dt>Email</dt><dd>{{ buyerEmail }}</dd></div>
            <div><dt>Billing/contact address</dt><dd>{{ billingAddress }}</dd></div>
            <div><dt>Delivery</dt><dd>Digital workspace access</dd></div>
          </dl>
          <label class="policy-acknowledgement">
            <input v-model="acceptedPolicies" type="checkbox" name="policy-acknowledgement">
            <span>
              <span>I acknowledge that I have reviewed the <NuxtLink to="/service-provision" target="_blank" rel="noopener noreferrer">service provision</NuxtLink>, <NuxtLink to="/refunds" target="_blank" rel="noopener noreferrer">refund</NuxtLink>, and <NuxtLink to="/terms" target="_blank" rel="noopener noreferrer">terms</NuxtLink> information for this preview.</span>
              <span lang="vi">Tôi xác nhận đã đọc thông tin <NuxtLink to="/service-provision" target="_blank" rel="noopener noreferrer">cung cấp dịch vụ</NuxtLink>, <NuxtLink to="/refunds" target="_blank" rel="noopener noreferrer">hoàn tiền</NuxtLink> và <NuxtLink to="/terms" target="_blank" rel="noopener noreferrer">điều khoản</NuxtLink> của bản xem trước này.</span>
            </span>
          </label>
          <div class="panel-actions">
            <button class="text-button" type="button" @click="stage = 1">← Edit details</button>
            <button class="primary-button" type="button" :disabled="!acceptedPolicies" @click="stage = 3">Pay via ACB2Pay sandbox <span aria-hidden="true">→</span></button>
          </div>
        </template>

        <template v-else>
          <div class="panel-heading">
            <p class="panel-kicker">04 · ACB2Pay sandbox</p>
            <h2>Sandbox connection pending</h2>
            <p>The ACB2Pay handoff screen is ready for integration. The bank's merchant-specific API package and test credentials are still pending.</p>
            <p lang="vi">Màn hình chuyển tiếp ACB2Pay đã sẵn sàng để tích hợp. Tài liệu API và thông tin kiểm thử riêng cho đơn vị bán hàng đang chờ ngân hàng cung cấp.</p>
          </div>
          <div class="payment-status" role="status" aria-live="polite">
            <strong>Payment is unavailable in this preview</strong>
            <p>No payment request was sent. No order was created, no charge was made, and no workspace access was changed.</p>
            <p lang="vi">Bản xem trước không gửi yêu cầu thanh toán, không tạo đơn hàng, không thu tiền và không thay đổi quyền truy cập.</p>
          </div>
          <div class="panel-actions">
            <button class="text-button" type="button" @click="stage = 2">← Back to order review</button>
            <span class="quiet-copy">No provider request was made from this preview.</span>
          </div>
        </template>
      </section>

      <aside class="summary-card" aria-label="Order summary">
        <div class="summary-top"><p>CART PREVIEW</p><span class="cart-count">{{ cartCountLabel }}</span></div>
        <div v-if="hasPlanInCart" class="summary-product"><span class="summary-logo">GPT</span><div><strong>GPTpatient</strong><small>Clinical communication practice</small></div></div>
        <p v-else class="empty-cart">Choose an access plan, then add it here.</p>
        <template v-if="hasPlanInCart">
          <div class="summary-plan"><span>{{ termLabel }}</span><button v-if="stage === 0" type="button" @click="stage = 0">Edit</button></div>
          <div class="summary-line"><span>Sample amount</span><strong>{{ priceLabel }}</strong></div>
          <div class="summary-line muted-line"><span>Taxes and fees</span><span>Not calculated in preview</span></div>
          <div class="summary-total"><span>Total</span><strong>{{ priceLabel }}<small>USD</small></strong></div>
          <div class="summary-renewal"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3" /></svg><span>This is a one-time purchase. Renew only when you decide.</span></div>
        </template>
        <div class="summary-foot"><span>Digital access</span><span>·</span><span>Preview only</span></div>
      </aside>
    </div>
    <footer class="checkout-footer"><span>Need help? <NuxtLink to="/contact">Contact support</NuxtLink></span><span>ACB2Pay sandbox is not connected.</span></footer>
  </main>
</template>

<script setup lang="ts">
useHead({ title: 'Checkout preview | GPTpatient' })

const stageLabels = ['Plan', 'Details', 'Review', 'Pay']
const { isDark } = useAppTheme()
const stage = ref(0)
const hasPlanInCart = ref(false)
const selectedTerm = ref<'three' | 'six' | 'twelve'>('twelve')
const buyerName = ref('')
const buyerEmail = ref('')
const billingAddress = ref('')
const deliveryMethod = ref('digital')
const acceptedPolicies = ref(false)
const planDetails = {
  three: { termLabel: '3-month access', priceLabel: '$60.00' },
  six: { termLabel: '6-month access', priceLabel: '$120.00' },
  twelve: { termLabel: '12-month access', priceLabel: '$216.00' }
} as const
const selectedPlan = computed(() => planDetails[selectedTerm.value])
const termLabel = computed(() => selectedPlan.value.termLabel)
const priceLabel = computed(() => selectedPlan.value.priceLabel)
const cartCountLabel = computed(() => hasPlanInCart.value ? '1 item' : '0 items')

function addPlanToCart() {
  hasPlanInCart.value = true
  stage.value = 1
}
</script>

<style scoped>
.checkout-demo {
  margin: 0 auto;
  max-width: 1180px;
  padding: 1.5rem 1.5rem 2.25rem;
}

.demo-banner {
  align-items: center;
  background: #fff7e5;
  border: 1px solid #f2dfb3;
  border-radius: 0.6rem;
  color: #765712;
  display: flex;
  font-size: 0.7rem;
  font-weight: 800;
  gap: 0.55rem;
  justify-content: center;
  letter-spacing: 0.075em;
  min-height: 2.2rem;
  text-align: center;
}

.demo-dot {
  background: #c28924;
  border-radius: 50%;
  height: 0.45rem;
  width: 0.45rem;
}

.checkout-heading {
  align-items: center;
  display: flex;
  justify-content: space-between;
  padding: 2.1rem 0 1.65rem;
}

.eyebrow, .panel-kicker {
  color: #087b75;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  margin: 0 0 0.55rem;
  text-transform: uppercase;
}

h1, h2, h3, p {
  margin-top: 0;
}

.checkout-heading h1 {
  color: #153650;
  font-size: clamp(1.9rem, 4vw, 2.65rem);
  letter-spacing: -0.045em;
  line-height: 1.1;
  margin-bottom: 0.55rem;
}

.heading-copy {
  color: #667a8b;
  font-size: 0.96rem;
  margin-bottom: 0;
}

.secure-note {
  align-items: center;
  background: #fff;
  border: 1px solid #dbe6ed;
  border-radius: 0.85rem;
  display: flex;
  gap: 0.65rem;
  padding: 0.75rem 1rem;
}

.secure-note svg {
  fill: none;
  height: 1.35rem;
  stroke: #087b75;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  width: 1.35rem;
}

.secure-note span, .secure-note small {
  display: block;
}

.secure-note strong {
  color: #153650;
  font-size: 0.78rem;
}

.secure-note small {
  color: #667a8b;
  font-size: 0.68rem;
  margin-top: 0.1rem;
}

.checkout-steps {
  border-bottom: 1px solid #dbe6ed;
  display: flex;
  gap: 0;
  margin-bottom: 1.5rem;
}

.step-button {
  align-items: center;
  background: transparent;
  border: 0;
  color: #748695;
  cursor: pointer;
  display: flex;
  flex: 1;
  font: inherit;
  gap: 0.55rem;
  justify-content: center;
  padding: 0.75rem 0.35rem 0.9rem;
  position: relative;
}

.step-button::after {
  background: transparent;
  bottom: -1px;
  content: "";
  height: 2px;
  left: 12%;
  position: absolute;
  right: 12%;
}

.step-button.is-active::after {
  background: #087b75;
}

.step-number {
  align-items: center;
  border: 1px solid #c7d4dc;
  border-radius: 50%;
  display: inline-flex;
  flex: 0 0 1.55rem;
  font-size: 0.72rem;
  font-weight: 750;
  height: 1.55rem;
  justify-content: center;
}

.step-number svg {
  fill: none;
  height: 0.8rem;
  stroke: currentcolor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  width: 0.8rem;
}

.step-label {
  font-size: 0.76rem;
  font-weight: 700;
  white-space: nowrap;
}

.step-button.is-active {
  color: #075f5b;
}

.step-button.is-active .step-number {
  background: #087b75;
  border-color: #087b75;
  color: #fff;
}

.step-button.is-complete {
  color: #087b75;
}

.step-button.is-complete .step-number {
  background: #e0f4ef;
  border-color: #a9d8cd;
}

.step-button:disabled {
  cursor: default;
}

.step-button:disabled:not(.is-active) {
  opacity: 0.62;
}

.checkout-layout {
  align-items: start;
  display: grid;
  gap: 1.5rem;
  grid-template-columns: minmax(0, 1fr) 330px;
}

.checkout-panel, .summary-card {
  background: #fff;
  border: 1px solid #dbe6ed;
  border-radius: 1rem;
  box-shadow: 0 12px 35px rgb(30 61 80 / 6%);
}

.checkout-panel {
  min-height: 440px;
  padding: clamp(1.35rem, 4vw, 2.4rem);
}

.panel-heading {
  margin-bottom: 1.6rem;
}

.panel-heading h2, .success-view h2 {
  color: #153650;
  font-size: clamp(1.45rem, 3vw, 1.85rem);
  letter-spacing: -0.035em;
  margin-bottom: 0.5rem;
}

.panel-heading > p:last-child, .success-view > p:not(.panel-kicker) {
  color: #667a8b;
  font-size: 0.9rem;
  line-height: 1.6;
  margin-bottom: 0;
}

.plan-options {
  border: 0;
  display: grid;
  gap: 0.8rem;
  margin: 0;
  min-width: 0;
  padding: 0;
}

.buyer-details {
  display: grid;
  gap: 0.55rem;
}

.field-label {
  color: #27465b;
  font-size: 0.8rem;
  font-weight: 700;
  margin-top: 0.35rem;
}

.field-label span {
  color: #667a8b;
  display: block;
  font-size: 0.69rem;
  font-weight: 500;
  margin-top: 0.12rem;
}

.buyer-details input, .buyer-details textarea, .buyer-details select {
  background: #fff;
  border: 1px solid #bac9d2;
  border-radius: 0.55rem;
  color: #203b52;
  font: inherit;
  font-size: 0.9rem;
  min-height: 2.8rem;
  padding: 0.65rem 0.75rem;
  width: 100%;
}

.buyer-details textarea {
  min-height: 6rem;
  resize: vertical;
}

.buyer-details input:focus-visible, .buyer-details textarea:focus-visible, .buyer-details select:focus-visible, .policy-acknowledgement input:focus-visible {
  outline: 3px solid #e8c879;
  outline-offset: 2px;
}

.field-help {
  color: #667a8b;
  font-size: 0.74rem;
  line-height: 1.5;
  margin: 0.15rem 0 0;
}

.plan-option {
  align-items: center;
  background: #fff;
  border: 1px solid #dbe6ed;
  border-radius: 0.8rem;
  color: #203b52;
  cursor: pointer;
  display: flex;
  gap: 0.8rem;
  min-height: 5.4rem;
  padding: 0.9rem 1rem;
  position: relative;
  text-align: left;
  transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}

.plan-option:hover {
  border-color: #78b9af;
}

.plan-option:focus-within {
  outline: 3px solid #e8c879;
  outline-offset: 3px;
}

.plan-option.plan-selected {
  background: #f2faf8;
  border: 1.5px solid #087b75;
  box-shadow: 0 0 0 3px rgb(8 123 117 / 8%);
}

.native-radio {
  accent-color: #087b75;
  flex: 0 0 1.15rem;
  height: 1.15rem;
  margin: 0;
  width: 1.15rem;
}

.choice-radio {
  align-items: center;
  border: 1.5px solid #a8bac5;
  border-radius: 50%;
  display: flex;
  flex: 0 0 1.15rem;
  height: 1.15rem;
  justify-content: center;
}

.is-chosen .choice-radio {
  border-color: #087b75;
}

.choice-radio span {
  background: #087b75;
  border-radius: 50%;
  height: 0.58rem;
  width: 0.58rem;
}

.plan-copy, .plan-copy small, .plan-price, .plan-price small {
  display: block;
}

.plan-copy {
  flex: 1;
}

.plan-copy strong {
  color: #153650;
  display: block;
  font-size: 0.94rem;
}

.plan-copy small {
  color: #667a8b;
  font-size: 0.76rem;
  margin-top: 0.25rem;
}

.plan-price {
  margin-left: auto;
  text-align: right;
}

.plan-price strong {
  color: #153650;
  display: block;
  font-size: 1rem;
}

.plan-price small {
  color: #8998a4;
  font-size: 0.67rem;
  margin-top: 0.2rem;
}

.plan-badge {
  align-self: flex-start;
  background: #dff3ed;
  border-radius: 99px;
  color: #087268;
  font-size: 0.57rem;
  font-weight: 850;
  letter-spacing: 0.06em;
  margin-left: 0.25rem;
  padding: 0.26rem 0.42rem;
}

.renewal-note, .provider-note {
  align-items: flex-start;
  background: #f3f8fa;
  border-radius: 0.65rem;
  color: #506579;
  display: flex;
  font-size: 0.78rem;
  gap: 0.65rem;
  line-height: 1.5;
  margin-top: 1.1rem;
  padding: 0.85rem 0.95rem;
}

.renewal-note svg, .provider-note svg {
  fill: none;
  flex: 0 0 1.1rem;
  height: 1.1rem;
  stroke: #087b75;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  width: 1.1rem;
}

.renewal-note strong {
  color: #254557;
}

.panel-actions {
  align-items: center;
  border-top: 1px solid #e8eef2;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  margin-top: 1.55rem;
  padding-top: 1.2rem;
}

.quiet-copy {
  color: #8796a2;
  font-size: 0.73rem;
}

.primary-button {
  align-items: center;
  background: #087b75;
  border: 1px solid #087b75;
  border-radius: 0.6rem;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.83rem;
  font-weight: 750;
  gap: 0.65rem;
  justify-content: center;
  min-height: 2.85rem;
  padding: 0.7rem 1rem;
  text-decoration: none;
  transition: background 140ms ease, transform 140ms ease;
}

.primary-button:hover {
  background: #06645f;
  transform: translateY(-1px);
}

.primary-button:disabled {
  background: #80918f;
  border-color: #80918f;
  cursor: not-allowed;
  transform: none;
}

.primary-button:focus-visible, .text-button:focus-visible, .step-button:focus-visible, .plan-option:focus-visible, .payment-choice:focus-visible, .sheet-pay-button:focus-visible, .sheet-cancel:focus-visible, .change-button:focus-visible {
  outline: 3px solid #e8c879;
  outline-offset: 3px;
}

.text-button {
  background: transparent;
  border: 0;
  color: #08756f;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 750;
  padding: 0.55rem 0;
}

.order-review {
  align-items: center;
  background: #f6f9fa;
  border: 1px solid #e4edf2;
  border-radius: 0.75rem;
  display: flex;
  gap: 0.8rem;
  padding: 1rem;
}

.review-icon {
  align-items: center;
  background: #dff3ed;
  border-radius: 0.65rem;
  display: flex;
  flex: 0 0 2.8rem;
  height: 2.8rem;
  justify-content: center;
}

.review-icon svg {
  fill: none;
  height: 1.4rem;
  stroke: #087b75;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
  width: 1.4rem;
}

.review-copy {
  flex: 1;
}

.review-copy strong, .review-copy span, .review-copy small {
  display: block;
}

.review-copy strong {
  color: #153650;
  font-size: 0.85rem;
}

.review-copy span {
  color: #506579;
  font-size: 0.78rem;
  margin-top: 0.22rem;
}

.review-copy small {
  color: #8796a2;
  font-size: 0.69rem;
  margin-top: 0.35rem;
}

.review-price {
  color: #153650;
  font-size: 0.9rem;
  white-space: nowrap;
}

.included-section {
  margin: 1.5rem 0 0.2rem;
}

.buyer-review {
  background: #f6f9fa;
  border: 1px solid #e4edf2;
  border-radius: 0.75rem;
  display: grid;
  gap: 0.75rem;
  margin: 1.2rem 0;
  padding: 1rem;
}

.buyer-review div {
  min-width: 0;
}

.buyer-review dt {
  color: #667a8b;
  font-size: 0.7rem;
  font-weight: 700;
}

.buyer-review dd {
  color: #203b52;
  font-size: 0.83rem;
  margin: 0.15rem 0 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.policy-acknowledgement {
  align-items: flex-start;
  color: #506579;
  display: flex;
  font-size: 0.77rem;
  gap: 0.55rem;
  line-height: 1.5;
}

.policy-acknowledgement > span > span {
  display: block;
}

.policy-acknowledgement > span > span + span {
  margin-top: 0.35rem;
}

.policy-acknowledgement input {
  accent-color: #087b75;
  flex: 0 0 auto;
  height: 1rem;
  margin: 0.15rem 0 0;
  width: 1rem;
}

.policy-acknowledgement a {
  color: #08756f;
  font-weight: 700;
  text-underline-offset: 0.15em;
}

.payment-status {
  background: #fff7e5;
  border: 1px solid #f2dfb3;
  border-radius: 0.75rem;
  color: #765712;
  padding: 1rem;
}

.payment-status strong {
  display: block;
  font-size: 0.85rem;
}

.payment-status p {
  font-size: 0.78rem;
  line-height: 1.55;
  margin: 0.4rem 0 0;
}

.included-section h3 {
  color: #27465b;
  font-size: 0.82rem;
  margin-bottom: 0.7rem;
}

.included-section ul {
  display: grid;
  gap: 0.5rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.included-section li {
  color: #506579;
  font-size: 0.79rem;
}

.included-section li span {
  color: #0a8a75;
  font-weight: 850;
  margin-right: 0.45rem;
}

.payment-choice {
  align-items: center;
  background: #f4faf8;
  border: 1.5px solid #087b75;
  border-radius: 0.75rem;
  color: #203b52;
  cursor: pointer;
  display: flex;
  gap: 0.85rem;
  padding: 1rem;
  text-align: left;
  width: 100%;
}

.gpay-wordmark {
  align-items: center;
  color: #263238;
  display: inline-flex;
  font-size: 1.05rem;
  gap: 0.08rem;
  letter-spacing: -0.04em;
  white-space: nowrap;
}

.gpay-wordmark strong {
  font-weight: 650;
}

.google-g {
  background: conic-gradient(from -45deg, #4285f4 0 25%, #34a853 25% 48%, #fbbc05 48% 71%, #ea4335 71% 83%, #4285f4 83%);
  color: transparent;
  display: inline-block;
  font-size: 1.22em;
  font-weight: 800;
  background-clip: text;
}

.choice-detail {
  flex: 1;
}

.choice-detail strong, .choice-detail small {
  display: block;
}

.choice-detail strong {
  color: #153650;
  font-size: 0.84rem;
}

.choice-detail small {
  color: #748695;
  font-size: 0.72rem;
  margin-top: 0.2rem;
}

.choice-chevron {
  fill: none;
  height: 1rem;
  stroke: #7e909c;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  width: 1rem;
}

.provider-note {
  margin-top: 1rem;
}

.provider-note svg {
  flex-basis: 1.25rem;
  height: 1.25rem;
  width: 1.25rem;
}

.provider-note span {
  max-width: 52ch;
}

.panel-actions .primary-button .google-g {
  font-size: 1.1rem;
}

.sheet-intro {
  margin-bottom: 1.15rem;
}

.pay-sheet {
  background: #fff;
  border: 1px solid #d8e0e5;
  border-radius: 0.9rem;
  box-shadow: 0 14px 40px rgb(27 52 71 / 12%);
  margin: 0 auto;
  max-width: 420px;
  overflow: hidden;
  padding: 1.15rem 1.25rem;
}

.sheet-topline {
  align-items: center;
  display: flex;
  justify-content: space-between;
  padding-bottom: 1rem;
}

.demo-chip {
  background: #fef2cf;
  border-radius: 99px;
  color: #795a16;
  font-size: 0.58rem;
  font-weight: 850;
  letter-spacing: 0.08em;
  padding: 0.32rem 0.5rem;
}

.sheet-merchant {
  align-items: center;
  border-bottom: 1px solid #e8edf0;
  display: flex;
  gap: 0.65rem;
  padding: 0.95rem 0;
}

.merchant-mark {
  align-items: center;
  background: #e9f4f1;
  border-radius: 0.65rem;
  color: #087b75;
  display: flex;
  font-family: Georgia, serif;
  font-size: 1.55rem;
  font-weight: 800;
  height: 2.6rem;
  justify-content: center;
  width: 2.6rem;
}

.sheet-merchant span:last-child strong, .sheet-merchant span:last-child small {
  display: block;
}

.sheet-merchant strong {
  color: #263238;
  font-size: 0.82rem;
}

.sheet-merchant small {
  color: #73818b;
  font-size: 0.68rem;
  margin-top: 0.18rem;
}

.sheet-amount {
  padding: 1rem 0 0.85rem;
}

.sheet-amount small, .sheet-amount strong, .sheet-amount span {
  display: block;
}

.sheet-amount small {
  color: #74818a;
  font-size: 0.72rem;
}

.sheet-amount strong {
  color: #202b31;
  font-size: 1.5rem;
  letter-spacing: -0.035em;
  margin-top: 0.15rem;
}

.sheet-amount span {
  color: #66747e;
  font-size: 0.72rem;
  margin-top: 0.2rem;
}

.sheet-divider {
  border-top: 1px solid #e8edf0;
}

.sheet-row {
  align-items: center;
  border-bottom: 1px solid #edf0f2;
  display: flex;
  gap: 0.65rem;
  min-height: 3.65rem;
}

.sheet-row > span:nth-child(2) {
  flex: 1;
}

.sheet-row > span:nth-child(2) strong, .sheet-row > span:nth-child(2) small {
  display: block;
}

.sheet-row > span:nth-child(2) strong {
  color: #2b363d;
  font-size: 0.72rem;
}

.sheet-row > span:nth-child(2) small {
  color: #77858e;
  font-size: 0.63rem;
  margin-top: 0.16rem;
}

.sheet-row-icon {
  align-items: center;
  border: 1px solid #e0e5e8;
  border-radius: 0.4rem;
  display: flex;
  height: 1.8rem;
  justify-content: center;
  width: 2rem;
}

.sheet-row-icon svg {
  fill: none;
  height: 1rem;
  stroke: #647680;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
  width: 1rem;
}

.contact-icon {
  border: 0;
}

.change-button {
  background: transparent;
  border: 0;
  color: #1769aa;
  cursor: pointer;
  font: inherit;
  font-size: 0.67rem;
  font-weight: 750;
  padding: 0.5rem;
}

.sheet-check {
  fill: none;
  height: 1rem;
  stroke: #1982d1;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  width: 1rem;
}

.sheet-disclaimer {
  color: #89959d;
  font-size: 0.59rem;
  line-height: 1.45;
  margin: 0.8rem 0;
}

.sheet-pay-button {
  align-items: center;
  background: #1a73e8;
  border: 0;
  border-radius: 0.42rem;
  color: #fff;
  cursor: pointer;
  display: flex;
  font: inherit;
  font-size: 0.78rem;
  justify-content: space-between;
  min-height: 2.65rem;
  padding: 0 0.95rem;
  width: 100%;
}

.sheet-pay-button:hover {
  background: #1768d0;
}

.sheet-pay-button strong {
  font-size: 0.78rem;
}

.sheet-cancel {
  background: transparent;
  border: 0;
  color: #1769aa;
  cursor: pointer;
  display: block;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 700;
  margin: 0.45rem auto 0;
  padding: 0.45rem;
}

.actual-sheet-note {
  background: #fff8e8;
  border-left: 3px solid #d4a33c;
  border-radius: 0.2rem 0.5rem 0.5rem 0.2rem;
  color: #755b26;
  font-size: 0.7rem;
  line-height: 1.5;
  margin-top: 1rem;
  padding: 0.65rem 0.8rem;
}

.success-view {
  align-items: center;
  display: flex;
  flex-direction: column;
  min-height: 390px;
  justify-content: center;
  padding: 1.5rem 0;
  text-align: center;
}

.success-mark {
  align-items: center;
  background: #dff5eb;
  border-radius: 50%;
  display: flex;
  height: 4.2rem;
  justify-content: center;
  margin-bottom: 1.15rem;
  width: 4.2rem;
}

.success-mark svg {
  fill: none;
  height: 2rem;
  stroke: #087b75;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.5;
  width: 2rem;
}

.success-view .panel-kicker {
  margin-bottom: 0.45rem;
}

.success-view h2 {
  margin-bottom: 0.55rem;
}

.success-view > p:not(.panel-kicker) {
  max-width: 44ch;
}

.success-receipt {
  background: #f6f9fa;
  border: 1px solid #e4edf2;
  border-radius: 0.75rem;
  display: grid;
  gap: 0.35rem;
  margin: 1.35rem 0 1.1rem;
  max-width: 370px;
  padding: 0.9rem 1.15rem;
  text-align: left;
  width: 100%;
}

.success-receipt span {
  color: #506579;
  font-size: 0.76rem;
}

.success-receipt strong {
  color: #153650;
  font-size: 1.1rem;
}

.success-receipt small {
  color: #8998a4;
  font-size: 0.67rem;
}

.success-actions {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.summary-card {
  padding: 1.35rem;
}

.summary-top {
  align-items: center;
  border-bottom: 1px solid #e8eef2;
  display: flex;
  justify-content: space-between;
  padding-bottom: 1rem;
}

.summary-top p {
  color: #506579;
  font-size: 0.67rem;
  font-weight: 850;
  letter-spacing: 0.1em;
  margin: 0;
}

.cart-count {
  color: #087b75;
  font-size: 0.7rem;
  font-weight: 750;
}

.summary-product {
  align-items: center;
  display: flex;
  gap: 0.7rem;
  padding: 1.1rem 0 1rem;
}

.empty-cart {
  color: #748695;
  font-size: 0.78rem;
  line-height: 1.5;
  margin: 1rem 0;
}

.summary-logo {
  align-items: center;
  background: #e1f1ed;
  border-radius: 0.55rem;
  color: #08736c;
  display: flex;
  font-size: 0.66rem;
  font-weight: 900;
  height: 2.4rem;
  justify-content: center;
  letter-spacing: -0.06em;
  width: 2.4rem;
}

.summary-product strong, .summary-product small {
  display: block;
}

.summary-product strong {
  color: #153650;
  font-size: 0.8rem;
}

.summary-product small {
  color: #748695;
  font-size: 0.66rem;
  margin-top: 0.16rem;
}

.summary-plan, .summary-line {
  align-items: center;
  color: #506579;
  display: flex;
  font-size: 0.76rem;
  justify-content: space-between;
  padding: 0.62rem 0;
}

.summary-plan {
  border-bottom: 1px solid #e8eef2;
  color: #254557;
  font-weight: 700;
}

.summary-plan button {
  background: transparent;
  border: 0;
  color: #08756f;
  cursor: pointer;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 750;
}

.summary-line strong {
  color: #254557;
  font-size: 0.76rem;
}

.muted-line {
  align-items: flex-start;
  color: #748695;
  font-size: 0.68rem;
  gap: 1rem;
}

.muted-line span:last-child {
  max-width: 7rem;
  text-align: right;
}

.summary-total {
  align-items: center;
  border-top: 1px solid #dbe6ed;
  color: #153650;
  display: flex;
  font-size: 0.85rem;
  font-weight: 800;
  justify-content: space-between;
  margin-top: 0.35rem;
  padding: 0.9rem 0 0.8rem;
}

.summary-total strong {
  font-size: 1.12rem;
}

.summary-total small {
  color: #748695;
  font-size: 0.62rem;
  font-weight: 600;
  margin-left: 0.3rem;
}

.summary-renewal {
  align-items: flex-start;
  background: #f1f8f6;
  border-radius: 0.6rem;
  color: #456a67;
  display: flex;
  font-size: 0.68rem;
  gap: 0.5rem;
  line-height: 1.45;
  padding: 0.72rem;
}

.summary-renewal svg {
  fill: none;
  flex: 0 0 1rem;
  height: 1rem;
  stroke: #087b75;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
  width: 1rem;
}

.summary-foot {
  align-items: center;
  color: #98a5ae;
  display: flex;
  font-size: 0.61rem;
  gap: 0.35rem;
  justify-content: center;
  padding-top: 1rem;
}

.checkout-footer {
  align-items: center;
  color: #7d8d99;
  display: flex;
  font-size: 0.68rem;
  justify-content: space-between;
  padding: 1.35rem 0 0.2rem;
}

.checkout-footer a {
  color: #08756f;
  font-weight: 750;
  text-decoration: none;
}

.checkout-footer a:hover {
  text-decoration: underline;
}

.checkout-demo.theme-dark .checkout-panel,
.checkout-demo.theme-dark .summary-card,
.checkout-demo.theme-dark .secure-note,
.checkout-demo.theme-dark .plan-option,
.checkout-demo.theme-dark .order-review,
.checkout-demo.theme-dark .buyer-review,
.checkout-demo.theme-dark .buyer-details input,
.checkout-demo.theme-dark .buyer-details textarea,
.checkout-demo.theme-dark .buyer-details select {
  background: var(--app-surface);
  border-color: var(--app-border);
  color: var(--app-text);
}

.checkout-demo.theme-dark .plan-option.plan-selected,
.checkout-demo.theme-dark .review-icon,
.checkout-demo.theme-dark .summary-logo,
.checkout-demo.theme-dark .summary-renewal {
  background: var(--app-surface-accent);
}

.checkout-demo.theme-dark .checkout-heading h1,
.checkout-demo.theme-dark .panel-heading h2,
.checkout-demo.theme-dark .plan-copy strong,
.checkout-demo.theme-dark .plan-price strong,
.checkout-demo.theme-dark .summary-line strong,
.checkout-demo.theme-dark .review-copy strong,
.checkout-demo.theme-dark .review-price,
.checkout-demo.theme-dark .included-section h3,
.checkout-demo.theme-dark .summary-product strong,
.checkout-demo.theme-dark .summary-total,
.checkout-demo.theme-dark .summary-total strong,
.checkout-demo.theme-dark .field-label,
.checkout-demo.theme-dark .buyer-review dd {
  color: var(--app-text-strong);
}

.checkout-demo.theme-dark .heading-copy,
.checkout-demo.theme-dark .panel-heading > p:last-child,
.checkout-demo.theme-dark .field-label span,
.checkout-demo.theme-dark .field-help,
.checkout-demo.theme-dark .review-copy small,
.checkout-demo.theme-dark .buyer-review dt,
.checkout-demo.theme-dark .summary-plan,
.checkout-demo.theme-dark .summary-line,
.checkout-demo.theme-dark .summary-top p,
.checkout-demo.theme-dark .empty-cart,
.checkout-demo.theme-dark .summary-product small,
.checkout-demo.theme-dark .summary-foot,
.checkout-demo.theme-dark .summary-total small,
.checkout-demo.theme-dark .checkout-footer {
  color: var(--app-text-muted);
}

.checkout-demo.theme-dark .step-button,
.checkout-demo.theme-dark .text-button,
.checkout-demo.theme-dark .policy-acknowledgement a,
.checkout-demo.theme-dark .checkout-footer a {
  color: var(--app-accent);
}

.checkout-demo.theme-dark .step-number,
.checkout-demo.theme-dark .panel-actions,
.checkout-demo.theme-dark .summary-top {
  border-color: var(--app-border);
}

.checkout-demo.theme-dark .summary-renewal {
  color: var(--app-text);
}

.checkout-demo.theme-dark .summary-renewal svg {
  stroke: var(--app-accent);
}

.checkout-demo.theme-dark .cart-count {
  color: var(--app-accent);
}

.checkout-demo.theme-dark .payment-status {
  background: var(--app-warning-soft);
  border-color: var(--app-warning);
  color: var(--app-warning);
}

.checkout-demo.theme-dark .payment-status p {
  color: var(--app-text);
}

@media (width <= 850px) {
  .checkout-layout {
    grid-template-columns: minmax(0, 1fr) 285px;
    gap: 1rem;
  }

  .step-label {
    font-size: 0.68rem;
  }

  .summary-card {
    padding: 1.1rem;
  }
}

@media (width <= 680px) {
  .checkout-demo {
    padding: 1rem 1rem 1.5rem;
  }

  .checkout-heading {
    align-items: flex-start;
    padding: 1.5rem 0 1.2rem;
  }

  .secure-note {
    display: none;
  }

  .checkout-steps {
    justify-content: space-between;
    overflow-x: auto;
  }

  .step-button {
    flex: 0 0 auto;
    gap: 0.4rem;
    padding-left: 0.45rem;
    padding-right: 0.45rem;
  }

  .step-number {
    flex-basis: 1.4rem;
    height: 1.4rem;
  }

  .step-label {
    font-size: 0.65rem;
  }

  .checkout-layout {
    display: flex;
    flex-direction: column-reverse;
  }

  .checkout-panel, .summary-card {
    width: 100%;
  }

  .checkout-panel {
    min-height: 0;
    padding: 1.2rem;
  }

  .summary-card {
    padding: 1rem;
  }

  .summary-top {
    padding-bottom: 0.7rem;
  }

  .summary-product {
    padding: 0.75rem 0;
  }

  .summary-plan, .summary-line {
    padding: 0.42rem 0;
  }

  .summary-total {
    padding: 0.62rem 0;
  }

  .summary-foot {
    padding-top: 0.65rem;
  }

  .panel-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .panel-actions .primary-button {
    width: 100%;
  }

  .panel-actions .text-button {
    align-self: flex-start;
  }

  .quiet-copy {
    text-align: center;
  }

  .plan-option {
    gap: 0.55rem;
    padding: 0.8rem 0.7rem;
  }

  .plan-copy strong {
    font-size: 0.81rem;
  }

  .plan-copy small {
    font-size: 0.68rem;
  }

  .plan-price strong {
    font-size: 0.85rem;
  }

  .plan-badge {
    font-size: 0.5rem;
  }

  .checkout-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.4rem;
  }
}

@media (width <= 390px) {
  .demo-banner {
    font-size: 0.57rem;
    letter-spacing: 0.04em;
    padding: 0 0.3rem;
  }

  .step-button {
    flex-direction: column;
    gap: 0.25rem;
  }

  .step-label {
    font-size: 0.59rem;
  }

  .plan-badge {
    display: none;
  }

  .plan-copy small {
    max-width: 13ch;
  }
}
</style>
