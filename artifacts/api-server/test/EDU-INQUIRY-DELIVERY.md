# EDU inquiry delivery verification

Verified on 2026-10-08 against the running development API using the live connected Gmail provider.

## Live check

- The user approved one real test email and use of the connected Gmail address as the designated internal contact.
- Submitted through `POST /api/edu-inquiries`, not directly through a replacement mail implementation.
- Used fictional institution/contact-name fields and a body clearly marked **INTERNAL DELIVERY TEST — not a school inquiry**. No real student or school data was submitted.
- The test body included reference `CS-EDU-DELIVERY-20261008-01`, requested no sales follow-up, and explicitly disclaimed any subscription, agreement, invoice, or billing action.
- The endpoint returned HTTP 200 and `{ "accepted": true }`.
- Read the matching Gmail Sent message back through the connector. Its To header matched the established `SUPPORT_EMAIL` destination, and its Reply-To matched the approved submitter address.
- **The user separately confirmed receipt in the support inbox**, not spam/junk. Provider acceptance alone was not treated as proof of delivery.
- Only one live inquiry was sent. Failure/retry tests use a mocked provider, never additional real messages.

## Failure and billing checks

Run `pnpm --filter @workspace/api-server run test:edu-inquiries`.

The suite checks provider rejection, absent/empty message IDs, invalid provider JSON, connector exceptions, and a successful retry following failure. Failures return HTTP 503, retry guidance, and no `accepted` confirmation.

The database fixture permits inserts only into the inquiry rate-limit table, and provider calls are restricted to Gmail profile lookup and mail send. The endpoint itself imports only rate limiting and support mail; it does not call checkout, subscription, store-purchase, or agreement creation. Billing fields in an inquiry are rejected. The live request contained no student library identity or payment identifiers.

## Scope and limits

This confirms the live provider path from the development API and inbox receipt at the established destination. It is not a separate published-deployment check.

The current web/mobile plan pages label EDU as coming soon and do not expose an inquiry submission form. Therefore failure feedback was verified at the API response boundary, not in a nonexistent web/mobile form. No form or paid EDU offering was added by this verification task.
