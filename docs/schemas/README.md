# Structured data contracts

Zod schemas in `app/schemas/` and `services/api/src/` are the runtime source of
truth for data received from or sent to services. Each contract validates
untrusted JSON at the boundary and infers the corresponding TypeScript type
from the same schema. API session contracts live in
`services/api/src/session-contracts.ts`; they define data shapes only and do
not by themselves implement session routes, persistence, or lifecycle rules.

The published JSON Schema is generated from those Zod contracts for
documentation, OpenAPI integration, and provider structured outputs. Regenerate
or verify it with:

```bash
npm run schemas:build
npm run schemas:check
```

Do not hand-edit generated JSON Schema. Add cross-field rules and any
non-JSON-representable validation in Zod, then test the behavior at the
receiving boundary.

The old mixed prompt/code notebook was preserved as
[`gpt-patient-obgyn-legacy-notes.md`](../gpt-patient-obgyn-legacy-notes.md);
the `.json` path now contains a machine-readable example checked against the
runtime contract.
