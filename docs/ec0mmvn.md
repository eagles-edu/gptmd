# Vietnam-facing service policy requirements

**Status: public policy pages implemented; paid-sale and regulatory launch readiness remains incomplete.**

This document translates the supplied policy draft into GPTpatient requirements. The supplied text was a template, not verified company or payment configuration. It contained unfilled placeholders, claims about ACB and Google Pay, invented processing periods, and a blanket liability exclusion. Those claims must not be published as facts.

See [`ecommvn-2.md`](./ecommvn-2.md) for the separate, current MoIT and ACB2Pay onboarding matrix, website-footer data requirements, and deployment blockers.

## Current product facts

- GPTpatient is an online clinical-communication training application using fictional scenarios.
- Sign-in uses the configured Supabase Auth integration with Google OAuth. Protected access also depends on active GPTpatient workspace membership.
- Account and encounter details are not written to browser local storage. Session cookies may be used when authentication is configured.
- The checkout screen is a visual mockup and explicitly says no payment is processed. No payment provider, payment confirmation, automated access activation, card collection, recurring billing, refund pipeline, or purchase email is established by the current implementation.
- The API has OpenAI, PostgreSQL, and Redis integrations. A feature that sends a model request may send its necessary prompt/content to OpenAI. Deployment configuration determines the hosting and data locations.
- Support email is optional configuration. The repository does not establish the legal name, registered/business address, responsible service operator, complaint response period, or a complete data retention schedule.

## Implemented public requirements

| Requirement | Public route | Current behavior represented |
| --- | --- | --- |
| Privacy and personal-data information, Vietnamese and English | `/privacy` | Describes account, workspace, usage, fictional practice content, configured processors, limits of current retention knowledge, and user requests without claiming a fixed location or security certification. |
| Service provision and activation, Vietnamese and English | `/service-provision` | Describes online workspace access and explicitly says checkout, ACB, Google Pay, license keys, and activation email are not currently active. |
| Cancellation and refund information, Vietnamese and English | `/refunds` | States no direct payment is currently accepted and no refund or automatic renewal exists; requires transaction-specific terms before sales open. |
| Service terms, Vietnamese and English | `/terms` | Limits use to fictional educational practice and preserves applicable consumer rights; avoids unverified IP ownership claims and blanket liability exclusions. |
| Find policy pages from the public site | Site footer | Links to all four policies from the shared footer. |
| Ministry submission test access | Pre-launch checklist below | Does not assume that a particular portal field or test-account rule still applies. Confirm the current form and implementing rules before submission. |

## Pre-launch requirements before accepting payment or submitting a notice

1. Confirm the seller/operator's exact legal name, registered address, business and tax details as applicable, and a monitored complaint/support channel. Publish the legally required operator and contact information on the service and policy pages.
2. Have Vietnamese counsel or a qualified local compliance reviewer check the policies, service classification, required notice/registration, user-facing disclosures, electronic-contract flow, complaint handling, tax/invoice duties, and current MoIT portal process against the live business model.
3. Inventory actual production processors, subprocessors, hosting locations, international transfers, data categories, purposes, lawful bases/consents, retention/deletion rules, security controls, and data-subject request procedures. Align the privacy notice and operational controls; do not claim PCI DSS or another certification without evidence.
4. Before opening a paid checkout, select and integrate the provider; verify server-side payment confirmation, entitlement activation, receipt/confirmation delivery, cancellation, refunds, charge disputes, and support escalation. Publish real prices, term start/end rules, renewal behavior, refund eligibility and timing, and payment-provider terms before the user commits. Retest the public policy claims whenever the integration changes.
5. If the current MoIT workflow asks for a test login, create a dedicated least-privilege demo account with fictional data and no paid capabilities. Provide credentials only in the portal's designated restricted field, rotate or expire them after review, and never publish credentials in this repository, the website, or public notes. Confirm the live portal's fields and current requirement first; do not use a real user's account.
6. Replace this status with a dated launch record only after the facts above are verified and the public pages match the deployed configuration.

## Legal references checked on 2026-10-02

These links establish the current legal instruments and effective dates; they are not a legal opinion about GPTpatient's classification or the sufficiency of these pages.

- [Law on E-Commerce No. 122/2025/QH15](https://en.baochinhphu.vn/viet-nams-law-on-e-commerce-111260825143234285.htm), effective 2026-07-01.
- [Decree No. 248/2026/ND-CP](https://vanban.chinhphu.vn/?docid=218747&orggroupid=2&pageid=27160), detailing parts of the Law on E-Commerce, effective 2026-07-01.
- [Law on Personal Data Protection No. 91/2025/QH15](https://vanban.chinhphu.vn/?classid=1&docid=214590&orggroupid=1&pageid=27160), effective 2026-01-01.
- [Law on Protection of Consumers' Rights No. 19/2023/QH15](https://vanban.chinhphu.vn/?classid=1&docid=208363&orggroupid=1&pageid=27160), effective 2024-07-01.
