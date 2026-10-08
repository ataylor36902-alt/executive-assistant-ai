import type Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient";

type CreditsConfig = {
  packs: Array<{
    id: string;
    credits: number;
    priceCents: number;
    name: string;
  }>;
};
type PackTarget = {
  id: string;
  credits: number;
  priceCents: number;
  name: string;
  creditsText: string;
};

const configUrl = new URL(
  "../../artifacts/api-server/src/lib/credits-config.ts",
  import.meta.url,
).href;
const { creditsConfig } = (await import(configUrl)) as {
  creditsConfig: CreditsConfig;
};
const PACKS: PackTarget[] = creditsConfig.packs.map((pack) => ({
  ...pack,
  creditsText: String(pack.credits),
}));

async function listAllProducts(stripe: Stripe): Promise<Stripe.Product[]> {
  const products: Stripe.Product[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.products.list({
      active: true,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    products.push(...page.data);
    if (!page.has_more) return products;
    startingAfter = page.data.at(-1)?.id;
    if (!startingAfter) throw new Error("Stripe product pagination was incomplete.");
  }
}

async function listAllPrices(stripe: Stripe): Promise<Stripe.Price[]> {
  const prices: Stripe.Price[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.prices.list({
      active: true,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    prices.push(...page.data);
    if (!page.has_more) return prices;
    startingAfter = page.data.at(-1)?.id;
    if (!startingAfter) throw new Error("Stripe price pagination was incomplete.");
  }
}

function associatedProductId(price: Stripe.Price): string | undefined {
  return typeof price.product === "string" ? price.product : price.product.id;
}

function isPackNameMatch(product: Stripe.Product, pack: PackTarget): boolean {
  if (
    product.metadata.pack_id === pack.id ||
    product.metadata.classscribe_credits_pack === pack.id
  ) {
    return true;
  }
  const escapedAmount = pack.creditsText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escapedAmount}\\b.*\\bcredits?\\b`, "i").test(
    product.name,
  );
}

function findUnique<T>(
  items: T[],
  predicate: (item: T) => boolean,
  description: string,
): T {
  const matches = items.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Stripe ${description}; found ${matches.length}. No product writes made.`,
    );
  }
  return matches[0]!;
}

async function main(): Promise<void> {
  if (
    PACKS.length !== 3 ||
    PACKS.some(
      (pack) =>
        !pack.id ||
        !pack.name ||
        !Number.isSafeInteger(pack.credits) ||
        pack.credits < 1 ||
        !Number.isSafeInteger(pack.priceCents) ||
        pack.priceCents < 1,
    ) ||
    new Set(PACKS.map((pack) => pack.id)).size !== PACKS.length
  ) {
    throw new Error("The server credits configuration has invalid Stripe pack values.");
  }

  const stripe = await getUncachableStripeClient();
  const [products, prices] = await Promise.all([
    listAllProducts(stripe),
    listAllPrices(stripe),
  ]);
  const targets = PACKS.map((pack) => {
    const product = findUnique(
      products,
      (candidate) => isPackNameMatch(candidate, pack),
      `test product for pack ${pack.id}`,
    );
    if (product.livemode) {
      throw new Error(
        `Stripe product ${pack.id} is live mode; no changes made.`,
      );
    }
    const exactPrices = prices.filter(
      (price) =>
        associatedProductId(price) === product.id &&
        price.active &&
        !price.livemode &&
        price.type === "one_time" &&
        price.currency === "usd" &&
        price.unit_amount === pack.priceCents,
    );
    const price = findUnique(
      exactPrices,
      () => true,
      `existing active $${(pack.priceCents / 100).toFixed(2)} one-time test price for ${pack.id}`,
    );
    const conflictingDiscoverablePrices = prices.filter(
      (candidate) =>
        candidate.active &&
        (candidate.metadata.pack_id === pack.id ||
          candidate.metadata.credits === pack.creditsText) &&
        (associatedProductId(candidate) !== product.id ||
          candidate.id !== price.id ||
          candidate.type !== "one_time" ||
          candidate.currency !== "usd" ||
          candidate.unit_amount !== pack.priceCents ||
          candidate.livemode),
    );
    if (conflictingDiscoverablePrices.length) {
      throw new Error(
        `Stripe product ${pack.id} has conflicting active metadata-matched prices; no changes made.`,
      );
    }
    return { pack, product, price };
  });

  const plan = {
    mode: process.argv.includes("--apply") ? "apply" : "inspect-only",
    products: targets.map(({ pack, product, price }) => ({
      id: product.id,
      name: product.name,
      expectedName: pack.name,
      livemode: product.livemode,
      priceId: price.id,
      currency: price.currency,
      unitAmount: price.unit_amount,
      expectedUnitAmount: pack.priceCents,
      productMetadata: product.metadata,
      priceMetadata: price.metadata,
      expectedMetadata: { pack_id: pack.id, credits: pack.creditsText },
    })),
    pricesCreated: false,
  };
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  for (const { pack, product, price } of targets) {
    const productMetadataMatches =
      product.metadata.pack_id === pack.id &&
      product.metadata.credits === pack.creditsText;
    if (product.name !== pack.name || !productMetadataMatches) {
      await stripe.products.update(product.id, {
        ...(product.name !== pack.name ? { name: pack.name } : {}),
        ...(!productMetadataMatches
          ? {
              metadata: {
                ...product.metadata,
                pack_id: pack.id,
                credits: pack.creditsText,
              },
            }
          : {}),
      });
    }
    const priceMetadataMatches =
      price.metadata.pack_id === pack.id &&
      price.metadata.credits === pack.creditsText;
    if (!priceMetadataMatches) {
      await stripe.prices.update(price.id, {
        metadata: {
          ...price.metadata,
          pack_id: pack.id,
          credits: pack.creditsText,
        },
      });
    }
  }

  const verifiedProducts = await listAllProducts(stripe);
  const verifiedPrices = await listAllPrices(stripe);
  const verified = targets.map(({ pack, product, price }) => {
    const currentProduct = verifiedProducts.find(
      (candidate) => candidate.id === product.id,
    );
    const currentPrice = verifiedPrices.find(
      (candidate) => candidate.id === price.id,
    );
    if (
      !currentProduct ||
      !currentPrice ||
      currentProduct.livemode ||
      currentPrice.livemode ||
      currentProduct.name !== pack.name ||
      currentProduct.metadata.pack_id !== pack.id ||
      currentProduct.metadata.credits !== pack.creditsText ||
      currentPrice.metadata.pack_id !== pack.id ||
      currentPrice.metadata.credits !== pack.creditsText ||
      !currentPrice.active ||
      currentPrice.type !== "one_time" ||
      currentPrice.currency !== "usd" ||
      currentPrice.unit_amount !== pack.priceCents ||
      associatedProductId(currentPrice) !== currentProduct.id
    ) {
      throw new Error(
        `Stripe readback did not verify pack ${pack.id}; no prices were created.`,
      );
    }
    return {
      packId: pack.id,
      productId: currentProduct.id,
      name: currentProduct.name,
      priceId: currentPrice.id,
      currency: currentPrice.currency,
      unitAmount: currentPrice.unit_amount,
      productMetadata: {
        pack_id: currentProduct.metadata.pack_id,
        credits: currentProduct.metadata.credits,
      },
      priceMetadata: {
        pack_id: currentPrice.metadata.pack_id,
        credits: currentPrice.metadata.credits,
      },
      livemode: currentProduct.livemode,
    };
  });

  console.log(
    JSON.stringify({ status: "verified", products: verified, pricesCreated: false }, null, 2),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const safeReasons = [
    "Stripe is not connected. Connect Stripe in the Integrations tab before creating products.",
    "Stripe connection must provide one consistent secret API key.",
    "The connected Stripe key is not test mode; no changes made.",
  ];
  const reason = safeReasons.find((candidate) => candidate === message);
  console.error(
    "Stripe credit pack alignment failed:",
    reason ??
      (error instanceof Error
        ? error.name
        : "Unknown error; credential values and provider responses are suppressed."),
  );
  process.exitCode = 1;
});