# ClassScribe RevenueCat credits: owner follow-up

The standalone setup script imports pack amounts/prices and monthly bonuses
from `artifacts/api-server/src/lib/credits-config.ts`, then reads the live
`ClassScribe` project before writing. Credit packs live in their own,
non-current RevenueCat offering with lookup key `credits`; the current `default`
offering remains dedicated to Student/Pro subscriptions.

```sh
pnpm --filter @workspace/scripts exec tsx src/align-classscribe-credits-revenuecat.ts
pnpm --filter @workspace/scripts exec tsx src/align-classscribe-credits-revenuecat.ts --apply
pnpm --filter @workspace/scripts exec tsx src/setup-classscribe-credits-revenuecat.ts
pnpm --filter @workspace/scripts exec tsx src/setup-classscribe-credits-revenuecat.ts --apply
pnpm --filter @workspace/scripts exec tsx src/align-classscribe-credits-stripe.ts
pnpm --filter @workspace/scripts exec tsx src/align-classscribe-credits-stripe.ts --apply
```

The alignment scripts are inspection-only unless passed `--apply`. The
RevenueCat alignment replaces the previous custom-key credit packages in
`credits` with the exact required package identifiers, then removes only the
three old credit package records from `default`. It keeps the subscription
offering current and preserves products and currency grants. The setup script is
for subsequent pack/grant management; it targets `credits` and leaves the
Student/Pro packages in `default`. RevenueCat does not support changing an
existing package lookup key in place, and the API rejects duplicate package
display names within one offering. The alignment retains the old credits
packages until their correctly named replacements are attached. Do not run a
seed script for this migration. Because `credits` remains non-current, clients
must explicitly request that offering by its identifier rather than assume
credit packs are part of the current subscription offering.

## Create the real store products

The RevenueCat project currently has Test Store credit products only; Apple and
Google credit products still need to be created and imported. Do not use Test
Store products as a substitute for real store products.

The post-alignment RevenueCat readback verified that `default` is still the
current offering and contains the existing Student/Pro packages only. The
non-current `credits` offering contains exactly the packages `credits_10`,
`credits_30`, and `credits_75`, displayed as **10 Scribe Credits**, **30 Scribe
Credits (Best value)**, and **75 Scribe Credits (Most credits)**. Each package
is attached to its existing Test Store product. The existing product records,
prices, and `CRD` grants were preserved; no Apple/Play credit products were
discovered or created.

1. **Apple:** In App Store Connect, open the ClassScribe app, go to
   **Monetization → In-App Purchases → +**, and create three **Consumable**
    products with product IDs `credits_10`, `credits_30`, and `credits_75`;
    use reference names **Scribe Credits 10**, **Scribe Credits 30**, and
    **Scribe Credits 75**. Set the customer-facing localized display names to
    **10 Scribe Credits**, **30 Scribe Credits**, and **75 Scribe Credits**,
    respectively, with a short description such as “10 Scribe Credits to use
    in ClassScribe.” Set prices to **$1.99**, **$4.99**, and **$9.99**. Add
    required localization and review metadata, then submit with an app version
    when App Store Connect requires it.
2. **Apple review screenshot:** after the purchase UI exists in an installed
    native build, capture a genuine screenshot of that screen on the device and
    upload it in the IAP's App Review Information. Do not fabricate, composite,
    or edit a purchase sheet/receipt, and do not submit a screenshot of a
    purchase flow that is not actually available in the installed app. If the
    native screen is not ready, wait to submit the IAP rather than fake evidence.
3. **Google Play:** in Play Console, open the ClassScribe app and go to
    **Monetize with Play → Products → One-time products**. Create one
    **one-time product** for each ID `credits_10`, `credits_30`, and
    `credits_75`; set the product names to **10 Scribe Credits**, **30 Scribe
    Credits**, and **75 Scribe Credits** and descriptions to explain the
    corresponding ClassScribe credit amount. Add and activate a one-time
    purchase option for each item, configure its base-plan/region availability
    and exact USD price ($1.99/$4.99/$9.99), then save and activate the
    products. These are consumable in-app purchases: the app must consume a
    successful purchase so it can be purchased again. Do not create
    subscription products for packs.
4. **RevenueCat:** import/add each Apple and Google product under its existing
    App Store or Play Store app, confirm exact product IDs and one-time/
    consumable classification, then run
    `align-classscribe-credits-revenuecat.ts --apply`. It attaches the imported
    store products to the matching `credits_10`, `credits_30`, and
    `credits_75` packages under the `credits` offering and grants 10/30/75
    `CRD`. Read back the packages and products before release.

App Store Connect/Play Console prices and products are not configured by the
RevenueCat script. Do not change or detach the existing Student/Pro store
products or packages as part of this work.

## Grant semantics and source of truth

RevenueCat's current [Virtual Currency API schema](https://www.revenuecat.com/docs/redocusaurus/openapi-v2-virtual-currency.yaml)
defines `product_grants` with `product_ids`, `amount`, `trial_amount`, and
`expire_at_cycle_end`. The [subscription guide](https://www.revenuecat.com/docs/offerings/virtual-currency/subscriptions)
says subscription grants occur on initial purchase and renewals; trials get a
grant at trial start only when configured. This setup uses `trial_amount: 0`
(no trial credits), `amount: 10` for Student and `amount: 30` for Pro, and
`expire_at_cycle_end: false` for those monthly subscription grants. RevenueCat's
[expiration guide](https://www.revenuecat.com/docs/offerings/virtual-currency/expiring-currencies)
explains that enabling auto-expiration removes unspent grants at the end of a
billing cycle; with auto-expiration disabled, monthly Student/Pro credits roll
over across renewals and remain after cancellation/expiration rather than being
cleared at the cycle boundary. Cancellation stops future subscription grants
when the paid subscription period ends; it does not expire the existing
non-expiring balance. Refunds or other balance adjustments may still change a
balance. Purchased one-time pack credits also use
`expire_at_cycle_end: false`.

`credits-config.ts` currently defines packs of 10/$1.99, 30/$4.99, and
75/$9.99 credits, plus monthly bonuses of 10 Student and 30 Pro. The setup
script now imports those numeric values rather than duplicating them.
`credits-config.ts` and the verified RevenueCat configuration both use
`CRD` / “Scribe Credits”; the setup script checks this before applying.

## RevenueCat currency icon

The [Virtual Currency API schema](https://www.revenuecat.com/docs/redocusaurus/openapi-v2-virtual-currency.yaml)
does not expose an icon field, so the setup script cannot set this visual
property. In the RevenueCat dashboard, open the ClassScribe project, select
**Product catalog → In-App Currencies**, open **Scribe Credits** (`CRD`) for
editing, choose the green coin/sound-wave icon that matches the existing green
app icon in the **Icon** picker, and save the currency. The icon is dashboard
metadata; do not change the currency code, name, grants, or products while
setting it.

## Credits customer provisioning blocker

A live check with an anonymous disposable user reached the web Credits screen,
but no balance appeared. The server's RevenueCat
`POST /v2/projects/{project_id}/customers` request returned **403** because the
connected OAuth integration lacks
`customer_information:customers:read_write`. The OAuth connection is healthy;
its available scope list includes only
`customer_information:customers:read` and `purchases:read`. Reauthorizing that
same provider cannot grant a write scope that the provider does not offer.

The official [Virtual Currency API schema](https://www.revenuecat.com/docs/redocusaurus/openapi-v2-virtual-currency.yaml)
specifies `x-scopes: customer_information:purchases:read_write` for the
applicable currency operations; reading a customer balance uses
`purchases:read`. Before retrying balance provisioning or any purchase flow,
the owner must create a **V2 Secret API Key** scoped to the same ClassScribe
RevenueCat project, with customer read/write
(`customer_information:customers:read_write`) and purchase read/write
(`customer_information:purchases:read_write`) permissions. Retain `purchases:read`
for balance reads. Follow RevenueCat's current [API keys guide](https://www.revenuecat.com/docs/projects/api-keys).

The server and migration/reconciliation scripts now use the optional
server-only `REVENUECAT_CREDITS_API_KEY` through the shared
`revenueCatRequest()` helper for supported project/customer/virtual-currency
operations. Configure the V2 secret only in the secure server or scheduled-job
environment. If an explicit key is configured but invalid, its 401/403 is a
hard failure; the request does not fall back to connector OAuth. Catalog
configuration endpoints remain on the RevenueCat connector and still require
its project-configuration scopes. Do not use a public SDK key, put the secret
in client configuration, commit it, or include it in chat or documentation.
The key value must remain private.

## RevenueCat webhook configuration

A GET-only RevenueCat readback found one integration: **ClassScribe Test Store
sandbox webhook**, scoped to the Test Store app and `sandbox`, targeting a
Replit development hostname (`*.riker.replit.dev`) at
`/api/revenuecat/webhook`. It includes `virtual_currency_transaction` and the
subscription event types. No production webhook integration was present. The
Webhook GET response does not include an `authorization_header` field, so GET
cannot confirm whether a value is stored; no header value was read or logged.

The server route is `POST /api/revenuecat/webhook`. It requires the exact
`Authorization` header value configured in the Replit
`REVENUECAT_WEBHOOK_AUTH_HEADER` secret (the secret is configured, but its
value was intentionally not accessed). The route returns 401 for a missing or
incorrect header and 503 if webhook authentication is not configured or
processing is unavailable. It passes the event to both subscription-billing
and credits handlers. RevenueCat's [current webhook API schema](https://www.revenuecat.com/docs/redocusaurus/openapi-v2-integration.yaml)
allows a production integration with `environment: production`; omitting
`app_id` scopes it to every app in the project, while providing an app ID
scopes it to that app.

Before launch, in RevenueCat **Project → Integrations → Webhooks**, create a
separate production integration using the stable production URL
`https://class-scribe.replit.app/api/revenuecat/webhook`, environment
**Production**, and the exact authorization-header value held in the Replit
secret. Omit app scope to cover both existing production apps, or create
separate app-scoped integrations for iOS and Android. Select the currently
used events: `initial_purchase`, `renewal`, `product_change`, `cancellation`,
`billing_issue`, `non_renewing_purchase`, `uncancellation`, `transfer`,
`subscription_paused`, `expiration`, `subscription_extended`,
`invoice_issuance`, `temporary_entitlement_grant`, `refund_reversed`, and
`virtual_currency_transaction`. Do not reuse the sandbox development URL for
production. This task did not send test events or change any webhook; GET-only
inspection cannot verify endpoint reachability, secret equality, or successful
event processing.

## Stripe test packs and owner administration

The standalone `align-classscribe-credits-stripe.ts` inspection script uses the
existing authenticated Stripe helper in test mode. With `--apply`, it updates
only mismatched names/metadata on existing TEST products and their exact
existing active one-time USD prices. It never creates a product or price. The
required names and prices are **10 Scribe Credits /
$1.99**, **30 Scribe Credits / $4.99**, and **75 Scribe Credits / $9.99**.
The server requires matching `pack_id` and `credits` metadata on both the
Stripe Price and Product before a checkout can grant CRD.

The test-mode readback found one existing product and exact active one-time USD
price per pack. Prices already matched at $1.99/$4.99/$9.99, and both products
and prices already had the required `pack_id` / `credits` metadata. Applying
alignment changed only the three product names to the required names above.
Readback confirmed all three products and prices remain test-mode and verified;
no product or price was created. Production Stripe prices and an actual paid
test checkout remain unverified.

The server checks the paid Checkout Session, its exact price/product, and the
library identity before granting CRD. Verified paid Student/Pro
subscription-start and monthly-cycle invoices grant 10/30 credits,
respectively. Unpaid and proration-only invoices do not grant the monthly
bonus.

The owner-only endpoint is `POST /api/credits/admin/adjust`. Configure
`CLASSSCRIBE_CREDITS_OWNER_CLERK_IDS` with your own Clerk user ID before using
it; when no owner is configured, it remains disabled. Requests need your
authenticated Clerk session, the target library's `X-CS-User` header, a
non-zero integer `amount`, and a short `reason`. Supply a stable
`Idempotency-Key` when retrying the same adjustment. Do not put credentials or
library codes into public documentation.

## Verification results and remaining release checks

Passed automated checks cover credit grants/debits/refunds, zero and low
balances, welcome-grant retries, replay protection, Stripe purchase binding,
signed RevenueCat transaction history, Student/Pro invoice bonuses,
recording finish/release concurrency, Ask overages, study guides, mobile
confirmation-request wiring, and served-browser transcription request wiring.
API build/type checks and mobile type checks passed. The development credit
tables were applied; the updated development schema needs to be included in
the next Publish.

The browser startup regression found during review was fixed and rebuilt. A
live anonymous disposable UI check reached the Credits screen, but the balance
was missing because RevenueCat customer provisioning failed with the 403
scope error above. No purchase flow was completed and no store transaction was
performed. The web view showing a missing balance is not a native review
screenshot; do not fabricate or submit a native purchase screenshot.

**Not completed:** an installed-phone Test Store consumable purchase, a real
Stripe test-card checkout, an actual subscription renewal, and a real
cross-device balance check. In particular, both Test Store and Stripe pack
purchases were not attempted because RevenueCat could not provision the
customer/balance. Mocked checks are not evidence that those store transactions
succeeded.

Before a release:

1. Create/import the native consumable products in App Store Connect and
   Play Console, and attach them to packages in the RevenueCat `credits`
   offering. Keep Student/Pro packages in the current `default` offering.
2. Create the project-scoped V2 Secret API Key with the customer and purchase
   scopes above, then provide it securely as server-only
   `REVENUECAT_CREDITS_API_KEY` when the server support is available. Verify
   disposable customer provisioning and balance readback before purchases.
3. After provisioning works, complete one real Test Store pack purchase in an
   installed native debug build and one web Stripe TEST-card pack checkout;
   verify each transaction and the resulting shared balance. The existing
   Stripe test products/prices are already aligned.
4. Capture any App Store review screenshot only from the real Credits purchase
   screen in an installed native app. Do not fabricate purchase UI or receipts;
   if the real native screen is unavailable, defer that screenshot/submission.
5. Select the RevenueCat dashboard icon and configure the production webhook
   described above.
6. Configure your owner allowlist if you want administrative adjustments.
7. Confirm a Student/Pro renewal grants 10/30 once; confirm an over-limit
   action prompts before spending, cancellation spends nothing, a failed
   action refunds once, and retrying a completed action does not debit again.

Do not use a Test Store key in a native release build, and do not report these
remaining checks as passed until the actual transactions have completed.