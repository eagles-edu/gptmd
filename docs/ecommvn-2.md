# MoIT and ACB2Pay readiness for GPTpatient

**Status: site preparation is in progress; the MoIT notice/registration and ACB merchant onboarding are not complete.**

This is a verified implementation checklist for GPTpatient, a Nuxt application that offers online access to fictional clinical-communication practice. The source note mixed physical-goods checkout requirements with digital service requirements and included unsourced bank fees, timelines, and approval steps. Do not use those as promises to users or as established government requirements.

## Verified facts and boundaries

- The checkout route now has a browser-only order journey for plan selection, buyer/contact details, digital delivery, policy acknowledgement, and the ACB2Pay handoff screen. It sends no buyer data, creates no order, takes no payment, and does not activate workspace access. There is still no configured ACB2Pay integration or payment confirmation.
- The project owner reports having contacted ACB and expects merchant-specific sandbox materials next week. This is user-provided timing; the materials and access are not yet verified in the repository.
- User-provided context says the business already has an ACB corporate current account; this repository does not independently verify the account or establish ACB2Pay merchant approval.
- The account's checkout URLs and support email are unset in the active ignored `.env`. The repository does not provide the merchant legal name, tax ID and issuance particulars, registered address, official phone, MoIT confirmation, or ACB onboarding records. The owner supplied `obgyn.gptpaitient.com`; that spelling did not resolve in the current check. `obgyn.gptpatient.com` resolves, but the public edge currently returns HTTP 403 (`Forbidden: Malicious bot detected`) for the tested paths. Confirm the intended spelling and review edge allowlisting separately.
- GPTpatient provisions workspace access, not shipped goods. A shipping address, carrier, physical inspection, and shipping-fee rules do not describe this digital service. The service-provision policy is the applicable product-facing page; any legally required field must still be confirmed for the actual portal category.
- ACB's ACB2Pay page says corporate applicants provide business documents, the legal representative's appointment decision and ID, power of attorney if applicable, order/service-return/complaint handling processes, and a website verified by MoIT. It lists Visa, Mastercard, JCB, and domestic NAPAS cards, describes EBC transaction tools, and says account credit notices are provided after one working day. It does not publish a universal 2–2.5% merchant fee or establish that Google Pay is available for this merchant's ACB2Pay integration. Obtain written terms and confirm wallet support with ACB.
- ACB's published ACB2Pay agreement requires clear service description, price/currency, refund rules, service-provision conditions and timing, and customer-care/contact information. It calls for the refund policy to be clear and linked from the online payment channel and made visible at order time, with acknowledgement before the final order action. It also requires a complaint process and relevant ACB/card branding supplied by ACB. These provisions apply to a future contracted checkout; they do not turn the current mockup into a payment flow.
- Use the current MoIT portal and the Law on E-Commerce No. 122/2025/QH15 with Decree No. 248/2026/ND-CP, both effective July 1, 2026, to confirm GPTpatient's correct procedure and exact required information. Do not rely on the old portal instructions, a promised 7–10 working day timeline, or an assumed badge/API-key sequence in the supplied draft.

## Requirements mapped to GPTpatient

| Requirement | Current implementation | Remaining work / evidence |
| --- | --- | --- |
| Service/refund/terms/privacy policies in Vietnamese and English | `/service-provision`, `/refunds`, `/terms`, and `/privacy` are prerendered, linked from the shared footer, and describe the current no-payment state. Checkout review links these terms and requires acknowledgement before the ACB2Pay handoff. | Insert verified operator details; have a local compliance reviewer confirm wording and required publication fields. Place/retain the acknowledgement immediately before final order submission when the real order API is implemented. |
| Complaint and service issue process | `/contact` now describes where and what to submit and avoids requesting patient data. Email and phone are configuration-driven. | Configure a monitored email and official phone, define an internal complaint owner and response target, exercise intake and resolution, and publish the verified service target. Both contact settings are currently empty. |
| Merchant identity in the footer | Footer supports legal name, tax ID, tax-ID issue date/place, registered address, phone, email, and (after confirmation) an HTTPS MoIT-confirmation link. The profile appears only when all required identity/contact values are configured. | Populate the exact values from official business records through ignored `.env`; compare with the bank account and current MoIT form. Do not put them in this tracked file or `.env.example`. |
| MoIT approval mark | Footer reserves a confirmation link that appears only when an HTTPS URL is configured and merchant details are complete. | Submit the correct application through the current portal, receive confirmation, then configure the official confirmation URL or follow the exact embed instructions issued by MoIT. No mark or approval claim is currently displayed. |
| Digital service delivery | `/service-provision` describes workspace access and explicitly says there is no active checkout, license email, or payment-based activation. | Confirm the portal's required category-specific fields and align the notice with the deployed access-provisioning and account lifecycle behavior. |
| Safe checkout handoff | `/checkout-demo` captures required preview fields in page memory, displays policy acknowledgement, and opens a clear sandbox-pending state; it makes no payment request. | Replace the handoff state with ACB's actual sandbox session and callback flow after receiving the merchant package. Never put merchant secrets in `NUXT_PUBLIC_*` or client bundles. |
| Public domain and HTTP behavior | User supplied a candidate hostname; a public check of the correctly spelled DNS name returned HTTP 403 before the app routes could be checked. Local browser tests check route rendering and 404 behavior. | Confirm the intended hostname and configure the production edge to allow the reviewer's origin/bot traffic. Verify public policy links and unknown-path HTTP 404 responses after that change. |
| Product, order, and support disclosures | Account access is workspace-based; the checkout design shows sample amounts only. | Set actual approved service plans, price and currency, start/end/renewal conditions, payment and confirmation steps, refund terms, records/receipts, dispute handling, and support workflow before a real transaction can be offered. |

## Nuxt operational acceptance checklist

The criteria below are tracked as readiness checks supplied for this project, not as a verbatim MoIT technical specification. The public portal describes its administrative service and application workflow; it does not establish in the pages reviewed that every seller must use a physical-goods cart, shipping address, or carrier selector. Confirm the correct procedure and required fields for GPTpatient's digital service in the current portal before filing. `online.gov.vn` is the government portal; it is not a production domain for this application.

| Check | Status on 2026-10-02 | Evidence and remaining work |
| --- | --- | --- |
| Production domain visibility | **Domain identified; external access needs work.** | The likely intended host `obgyn.gptpatient.com` resolves, but the current public edge returns HTTP 403 (`Forbidden: Malicious bot detected`) on home, contact, checkout, and unknown paths. The spelling supplied in chat (`gptpaitient`) did not resolve in the current check. Remove the review-path block and verify the origin with the owner-confirmed hostname. Do not use `online.gov.vn` as the storefront domain. |
| Functional checkout loop | **UI journey implemented; order processing remains open.** | The reviewer can add one access plan to the in-page cart, enter name/email/contact address, choose digital workspace delivery, review linked policies and acknowledge them, then open the ACB2Pay handoff screen. Cart and form state stay in page memory and are not sent. There is no server order, receipt, or payment yet. Physical shipping/carrier options would misrepresent this digital service unless MoIT/ACB confirm otherwise. |
| ACB2Pay sandbox checkout | **Handoff screen implemented; provider integration pending.** | The `Pay via ACB2Pay sandbox` action opens the handoff screen without a 500; it does not send a provider request or claim success. The owner reports ACB sandbox materials are expected next week. On receipt, implement the server-side sandbox session and authenticated callback, then test success, cancellation, decline, retry, and provider outage without exposing secrets to the browser. The generic ACB Developer Portal workflow alone does not establish access to this merchant's ACB2Pay product. |
| SSR 404 response | **Implemented; local verification passed.** | The Nuxt catch-all route sets response status `404`; the browser suite requests an unknown path and asserts the HTTP status. Repeat the same assertion against the deployed production origin, including the rendered not-found page and server logs. |

### Steps required to close the blockers

1. Confirm the exact merchant hostname (including spelling) and remove the public-edge 403 from the intended review path.
2. Confirm GPTpatient's seller/service category and required checkout fields with the current MoIT portal. The product is a digital subscription; the current form calls the postal field a billing/contact address and offers digital access, not a shipping carrier.
3. When ACB sends the sandbox package, integrate its documented payment session and authenticated server callback. Grant workspace access only after verifying the provider's confirmed payment status.
4. Run checkout success/failure scenarios and production-origin status checks before asking MoIT or ACB to review the site. Keep production payment disabled until ACB approves the merchant and supplies the required production configuration.

## Merchant settings

Set these only in the ignored active `.env`; values marked public are intentionally rendered in the public site footer. Leave the MoIT confirmation URL empty until the portal confirms the filing.

```dotenv
NUXT_PUBLIC_MERCHANT_LEGAL_NAME=
NUXT_PUBLIC_MERCHANT_TAX_ID=
NUXT_PUBLIC_MERCHANT_TAX_ID_ISSUED=
NUXT_PUBLIC_MERCHANT_ADDRESS=
NUXT_PUBLIC_MERCHANT_PHONE=
NUXT_PUBLIC_SUPPORT_EMAIL=
NUXT_PUBLIC_MOIT_VERIFICATION_URL=
```

The deployed app must be rebuilt/restarted after setting build-time public runtime configuration. Confirm the actual values in the rendered production footer without exposing internal credentials. Never place ACB keys, HMAC/signing secrets, bank account credentials, or customer payment data in these variables.

The merchant identity/footer requirements and operational review checks are mapped in the tables above. The footer is already structured to show the full legal name, tax ID and issuance details, registered address, complaint phone/email, and an MoIT confirmation link only after verified values are configured. Do not display placeholder company data or an approval mark before MoIT confirmation.

## ACB onboarding questions to get answered in writing

1. Confirm ACB2Pay eligibility for GPTpatient's digital subscription/workspace-access service and provide the merchant agreement, current fee schedule, settlement/notification terms, accepted payment methods, and refund/chargeback rules.
2. Ask whether ACB2Pay supports Google Pay for this exact online integration and merchant category. ACB's public ACB2Pay page describes card brands; its separate POS Google Pay support is not proof of online ACB2Pay wallet support.
3. Request the current sandbox account, API package, test-card/test-wallet instructions, callback authentication and replay rules, failure/refund scenarios, security checklist, and written go-live criteria.
4. Confirm the precise MoIT filing type and what evidence ACB accepts after the portal issues the result. Publish only the approval artifact/code issued for this merchant and domain.

## Sources checked on 2026-10-02

- [Online.gov.vn, MoIT e-commerce management portal](https://online.gov.vn/): the current national portal; its 2026 notices describe the new Law/Decree taking effect and updated administrative handling. Confirm the signed-in workflow and service-specific classification in the portal before filing.
- [Online.gov.vn, current portal overview](https://online.gov.vn/Home/WebDetails/92331): describes the portal's nationwide online public services, complaint handling, and current 2026 notices.
- [ACB Developer Portal, getting started](https://developer.acb.com.vn/acb/open/vi/getting-started): describes requesting API-product testing, choosing a test environment, and receiving test data. This generic portal flow is not proof that this merchant has ACB2Pay sandbox credentials.
- [ACB eCOMMERCE (ACB2PAY)](https://acb.com.vn/en/business-payment-solution/acb2pay): current public merchant conditions, documents, accepted card brands, EBC and support statements.
- [ACB2Pay merchant terms and conditions (February 2026)](https://acb.com.vn/acbwebsite/files/BANG%20DIEU%20KHOAN%20DIEU%20KIEN%20ACB2PAY%2026%2002%2026.pdf): merchant website/order information, refund and contact disclosures, checkout acknowledgement, and card branding provisions.
- [Law on E-Commerce No. 122/2025/QH15](https://en.baochinhphu.vn/viet-nams-law-on-e-commerce-111260825143234285.htm), effective 2026-07-01.
- [Decree No. 248/2026/ND-CP](https://vanban.chinhphu.vn/?docid=218747&orggroupid=2&pageid=27160), effective 2026-07-01.
- [Law on Personal Data Protection No. 91/2025/QH15](https://vanban.chinhphu.vn/?classid=1&docid=214590&orggroupid=1&pageid=27160), effective 2026-01-01.
