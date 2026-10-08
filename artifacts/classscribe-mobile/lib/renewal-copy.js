export const REVENUECAT_RENEWAL_STATUSES = new Set([
  'will_renew',
  'will_not_renew',
  'will_change_product',
  'will_pause',
  'requires_price_increase_consent',
]);

export function isRevenueCatRenewalStatus(value) {
  return REVENUECAT_RENEWAL_STATUSES.has(value);
}

export function billingPeriodMessage(status, date) {
  if (!status || status.plan === 'free') return '';

  const isRevenueCatBilling = ['app_store', 'play_store', 'test_store'].includes(status.billingSource);
  if (!isRevenueCatBilling) {
    if (!date) return '';
    return status.cancelAtPeriodEnd === true
      ? ` · cancels ${date} (paid access continues until then)`
      : ` · renews ${date}`;
  }

  switch (status.renewalStatus) {
    case 'will_not_renew':
      return date
        ? ` · cancels ${date} (paid access continues until then)`
        : ' · cancels at period end (paid access continues until then)';
    case 'will_change_product':
      return date ? ` · plan changes ${date}` : ' · plan changes at period end';
    case 'will_pause':
      return date
        ? ` · pauses ${date} (paid access continues until then)`
        : ' · pauses after this period (paid access continues until then)';
    case 'requires_price_increase_consent':
      return date
        ? ` · renewal needs your price-increase consent by ${date}`
        : ' · renewal needs your consent to the price increase';
    case 'will_renew':
      return date ? ` · renews ${date}` : '';
    default:
      if (!date) return '';
      return status.cancelAtPeriodEnd === true
        ? ` · cancels ${date} (paid access continues until then)`
        : ` · renews ${date}`;
  }
}