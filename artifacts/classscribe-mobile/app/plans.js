import React, { useCallback, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Btn, Screen } from '../components/ui';
import { LEVELS } from '../components/ProfileFields';
import { useResolvedTheme, useStore } from '../lib/store';
import { C } from '../lib/theme';
import { billingStatusLabel, formatBillingDate, planName, readBillingStatus, useBillingStatus } from '../lib/billing';
import { createStripeCheckout, createStripePortal, getServer, getUid } from '../lib/api';
import { getRevenueCatCustomerInfo, getRevenueCatOfferings, isRevenueCatExpoGo, isRevenueCatPreviewMode, purchaseRevenueCatPackage, restoreRevenueCatPurchases, showRevenueCatManageSubscriptions } from '../lib/revenuecat';
import { canChooseFreePlan, isOnboardingPlanReady, needsOnboardingPlan } from '../lib/onboarding-plan';
import { billingSourceGuidance, billingSourceName, getBillingActionBlock } from '../lib/plan-billing';
import { billingPeriodMessage as formatBillingPeriodMessage } from '../lib/renewal-copy';
import { canUseNativeRevenueCat, logRevenueCatError } from '../lib/revenuecat-diagnostics';
import { useCreditsStatus } from '../lib/credits-status';
import { UsageAllowances } from '../components/UsageAllowances';
import { usesWebPlanCheckout } from '../lib/plan-checkout';

const PLANS = [
  {
    id: 'free', name: 'ClassScribe Free', features: [
      '5 monthly transcription hours', '5 saved recordings per month', 'Up to 3 courses', 'Ask: 1 question per month for 1 Scribe Credit', 'No generated exam tools',
    ],
  },
  {
    id: 'student', name: 'ClassScribe Student', packageId: 'student_monthly', period: '/month', features: [
      '40 monthly transcription hours', '20 saved recordings per month', 'Unlimited courses', 'Study guides, flashcards, and quizzes', 'Ask ClassScribe: 25 questions per month',
    ],
  },
  {
    id: 'pro', name: 'ClassScribe Pro', packageId: 'pro_monthly', period: '/month', features: [
      '120 monthly transcription hours', '60 saved recordings per month', 'No course-count cap', 'Study guides, flashcards, and quizzes', 'Ask questions included (no monthly question cap)', 'Extra recording and transcription usage requires credits', 'Grades: track your scores and averages', 'Finals Mode, Teach me, and Weak areas tutor',
    ],
  },
];

const CONSENT = [
  'Consent before every session',
  'Always-visible recording indicator with pause and discard controls',
  'Private by default: sharing is deliberate, limited to your course group, and can be undone',
  'No exam predictions: Exam Center shows what got the most attention in course materials, never claims to know what will be on a test',
  'Accessibility first: students with a recording accommodation can note it in the consent step',
];

function billingReturnUrl(marker) {
  if (typeof window === 'undefined' || typeof window.location?.href !== 'string') return undefined;
  const url = new URL(window.location.href);
  url.searchParams.delete('billing');
  url.searchParams.delete('session_id');
  if (marker) url.searchParams.set('billing', marker);
  return url.toString();
}

function webPlansUrlText() {
  const configured = process.env.EXPO_PUBLIC_WEB_URL || process.env.EXPO_PUBLIC_DOMAIN || getServer();
  if (!configured) return 'Web plans URL is not configured for this preview.';
  const base = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password) return 'Web plans URL is not configured for this preview.';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/plans`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'Web plans URL is not configured for this preview.';
  }
}

function webPlansUrl() {
  const text = webPlansUrlText();
  if (text.startsWith('https://')) return text;
  throw new Error(text);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

const APP_STORE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';
const PLAY_STORE_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';

function inIframe() {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function reserveCheckoutTab(newTab) {
  if (!newTab) return null;
  const checkoutTab = window.open('', '_blank');
  if (!checkoutTab) throw new Error('Your browser blocked the new checkout tab. Allow pop-ups for this preview and try again.');
  checkoutTab.opener = null;
  return checkoutTab;
}

function openStripeURL(url, checkoutTab) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new Error('The billing server returned an invalid checkout URL.');
  }
  if (target.protocol !== 'https:') throw new Error('The billing server returned an insecure checkout URL.');
  if (checkoutTab) {
    checkoutTab.location.href = target.toString();
    return;
  }
  if (Platform.OS === 'web') window.location.assign(target.toString());
  else return Linking.openURL(target.toString());
}

function confirmedPlanMessage(plan) {
  return `You’re on ClassScribe ${planName(plan)}`;
}

function billingPeriodMessage(status) {
  const date = formatBillingDate(status.periodEnd);
  return formatBillingPeriodMessage(status, date);
}

function PlanCard({ plan, pkg, wide, currentPlan, onPurchase, onChooseFree, onBuyCredits, canChooseFree, purchaseBusy, purchaseDisabled, isOnboarding, webCheckout, webReady, expoGo, billingBlock }) {
  useResolvedTheme();
  const isCurrent = currentPlan === plan.id;
  const hasStorePrice = !!pkg?.product?.priceString;
  const tier = { free: 0, student: 1, pro: 2 };
  const isDowngrade = plan.id !== 'free' && tier[currentPlan] > 0 && tier[currentPlan] > tier[plan.id];
  const actionLabel = plan.id === 'free'
    ? isCurrent ? 'Your current plan' : isOnboarding ? 'Choose Free' : 'Free plan'
    : isCurrent ? 'Your current plan' : billingBlock ? 'Switch blocked — see current plan above' : webCheckout ? `${isOnboarding ? 'Choose' : 'Upgrade to'} ${plan.id === 'student' ? 'Student — $7.99/month' : 'Pro — $12.99/month'}` : isDowngrade ? `Switch to ${plan.id === 'student' ? 'Student' : 'Pro'}` : hasStorePrice ? `${isOnboarding ? 'Choose' : 'Upgrade to'} ${plan.id === 'student' ? 'Student' : 'Pro'}` : 'Store price unavailable';
  const actionDisabled = plan.id === 'free'
    ? !canChooseFree || isCurrent || purchaseBusy
    : isCurrent || !!billingBlock || (webCheckout ? purchaseDisabled : !hasStorePrice || purchaseDisabled) || purchaseBusy;
  const price = plan.id === 'free'
    ? '$0'
    : webCheckout ? (plan.id === 'student' ? '$7.99' : '$12.99') : pkg?.product?.priceString || 'Store price unavailable';
  return (
    <View style={{
      width: wide ? '48.6%' : '100%', backgroundColor: C.cell, borderRadius: 20,
      borderWidth: plan.popular ? 2 : 1, borderColor: plan.popular ? C.accent : C.sep,
      padding: 20, gap: 14,
    }} testID={`plan-card-${plan.name.split(' ').at(-1).toLowerCase()}`}>
      <View style={{ minHeight: 23 }}>
        {plan.popular ? <Text style={{ alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 99, backgroundColor: C.accentSoft, color: C.accent, paddingHorizontal: 11, paddingVertical: 4, fontSize: 12, fontWeight: '800' }}>Most popular</Text> : null}
      </View>
      <View>
        <Text style={{ fontSize: 21, fontWeight: '800', color: C.ink, letterSpacing: -0.5 }}>{plan.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 8 }}>
          <Text style={{ fontSize: price.length > 10 ? 19 : 34, fontWeight: '800', color: C.ink, letterSpacing: -1 }}>{price}</Text>
          {plan.period && (hasStorePrice || webCheckout) ? <Text style={{ color: C.sec, fontSize: 15 }}>{plan.period}</Text> : null}
        </View>
      </View>
      <View style={{ gap: 11, flex: 1, paddingVertical: 6 }}>
        {plan.features.map((feature) => (
          <View key={feature} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Ionicons name="checkmark-circle" size={18} color={C.accent} style={{ marginTop: 1 }} />
            <Text style={{ color: C.ink, flex: 1, fontSize: 14, lineHeight: 21 }}>{feature}</Text>
          </View>
        ))}
      </View>
      {(
        <Btn
          title={actionLabel}
          icon={plan.id !== 'free' && !isCurrent ? 'card-outline' : undefined}
          disabled={actionDisabled}
          busy={purchaseBusy}
          onPress={() => plan.id === 'free' ? onChooseFree() : onPurchase(plan, pkg)}
          kind={isCurrent ? 'secondary' : plan.popular ? 'primary' : 'secondary'}
          accessibilityLabel={actionLabel}
          accessibilityState={{ disabled: !!actionDisabled, selected: isCurrent }}
          testID={`button-${plan.id}`}
        />
      )}
      {plan.id === 'free' ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>Buy Scribe Credits without a subscription.</Text>
          <Btn title="Buy Scribe Credits" onPress={onBuyCredits} kind="secondary" testID="button-free-buy-credits" />
        </View>
      ) : null}
    </View>
  );
}

function CurrentPlan({ billing, onRetry, onManage, manageBusy }) {
  const { status, loading, error } = billing;
  return (
    <View style={{ marginBottom: 22, padding: 18, borderRadius: 18, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Ionicons name="shield-checkmark-outline" size={21} color={C.accent} />
        <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800', flex: 1 }}>
          {status && (status.plan === 'student' || status.plan === 'pro') ? confirmedPlanMessage(status.plan) : 'Your library plan'}
        </Text>
      </View>
      {loading && !status ? (
        <Text style={{ color: C.sec, fontSize: 14 }}>Checking your library’s plan…</Text>
      ) : error ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 14, lineHeight: 20 }}>{error}</Text>
          <Btn title="Try again" kind="secondary" small onPress={onRetry} />
        </View>
      ) : status ? (
        <>
          <Text style={{ color: C.sec, fontSize: 14 }}>
            {status.plan === 'free' ? 'Free plan' : billingStatusLabel(status.status)}{billingPeriodMessage(status)}
          </Text>
          {status.plan !== 'free' ? (
            <>
              <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }} testID="billing-source">
                Billed through {billingSourceName(status.billingSource) || 'an unrecognized source'}
              </Text>
              <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }} testID="billing-source-guidance">
                {billingSourceGuidance(status.billingSource)}
              </Text>
            </>
          ) : null}
          {status.billingConflict ? (
            <Text style={{ color: C.warn, fontSize: 13, lineHeight: 19 }} testID="billing-conflict">
              Multiple billing systems were detected. Purchases are paused to prevent duplicate charges.
            </Text>
          ) : null}
          <Text style={{ color: C.ink, fontSize: 14, fontWeight: '700' }}>
            {typeof status.recordingHoursUsed === 'number'
              ? `${status.recordingHoursUsed.toFixed(1)} of ${status.recordingHoursLimit} monthly transcription hours used`
              : `Monthly transcription limit: ${status.recordingHoursLimit} hours`}
          </Text>
          {typeof status.recordingCountUsed === 'number' && typeof status.recordingCountLimit === 'number'
            ? <Text style={{ color: C.sec, fontSize: 13 }}>{status.recordingCountUsed} of {status.recordingCountLimit} monthly saved recordings used</Text>
            : null}
          {status.courseLimit == null
            ? <Text style={{ color: C.sec, fontSize: 13 }}>Course limit: no limit</Text>
            : <Text style={{ color: C.sec, fontSize: 13 }}>Course limit: {status.courseLimit}</Text>}
          <UsageAllowances status={status} />
          {status.plan !== 'free' ? (
            <Btn
              title={status.billingSource === 'test_store' ? 'Check Test Store management options' : 'Manage subscription'}
              icon="settings-outline"
              kind="secondary"
              onPress={onManage}
              disabled={!!manageBusy}
              busy={!!manageBusy}
              testID="button-manage-subscription"
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function PurchaseErrorMessage({ message, diagnostic, onDismiss }) {
  const [showDetails, setShowDetails] = useState(false);
  if (!message) return null;
  if (!diagnostic) {
    return <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 14, lineHeight: 20 }}>{message}</Text>;
  }
  return (
    <View style={{ gap: 5 }}>
      <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 14, lineHeight: 20 }}>{message}</Text>
      <Pressable
        onPress={() => setShowDetails((visible) => !visible)}
        accessibilityRole="button"
        accessibilityLabel={showDetails ? 'Hide purchase error details' : 'Show purchase error details'}
        accessibilityState={{ expanded: showDetails }}
        style={{ minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start' }}
        testID="button-purchase-error-details"
      >
        <Text style={{ color: C.accent, fontSize: 14, fontWeight: '700' }}>{showDetails ? 'Hide details' : 'Details'}</Text>
      </Pressable>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss purchase error"
        style={{ minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start' }}
        testID="button-dismiss-purchase-error"
      >
        <Text style={{ color: C.accent, fontSize: 14, fontWeight: '700' }}>Dismiss</Text>
      </Pressable>
      {showDetails ? (
        <View accessibilityLabel="Purchase error details" style={{ gap: 4 }}>
          {diagnostic.underlyingErrorMessage ? (
            <Text selectable style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>Underlying error: {diagnostic.underlyingErrorMessage}</Text>
          ) : null}
          {diagnostic.readableErrorCode ? (
            <Text selectable style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>Code: {diagnostic.readableErrorCode}</Text>
          ) : null}
          {diagnostic.message && diagnostic.message !== diagnostic.underlyingErrorMessage ? (
            <Text selectable style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>SDK message: {diagnostic.message}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function Plans() {
  useResolvedTheme();
  const st = useStore();
  const billing = useBillingStatus(st.status.uid);
  const credits = useCreditsStatus(st.status.uid);
  const libraryCode = st.status.uid;
  const { onboarding, billing: checkoutResult } = useLocalSearchParams();
  const isOnboarding = onboarding === '1' || needsOnboardingPlan(st.profile);
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 720;
  const level = LEVELS.includes(st.profile?.level) ? st.profile.level : null;
  const [offering, setOffering] = useState(null);
  const [purchaseLoading, setPurchaseLoading] = useState(Platform.OS !== 'web');
  const [purchaseReady, setPurchaseReady] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const [purchaseErrorDiagnostic, setPurchaseErrorDiagnostic] = useState(null);
  const retainedStoreError = useRef(false);
  const [purchaseNotice, setPurchaseNotice] = useState('');
  const [confirmPackage, setConfirmPackage] = useState(null);
  const [purchaseConsent, setPurchaseConsent] = useState(false);
  const [nativePackagesUnavailable, setNativePackagesUnavailable] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);
  const portalRefreshStarted = useRef(false);
  const expoGo = Platform.OS !== 'web' && isRevenueCatExpoGo();
  const webCheckout = usesWebPlanCheckout(Platform.OS, expoGo);
  const testStorePreview = Platform.OS !== 'web' && !expoGo && __DEV__ && isRevenueCatPreviewMode();
  const webStripeReady = webCheckout &&
    !billing.loading &&
    !billing.error &&
    billing.status?.billingReadiness?.ready === true;
  const webBillingBlock = getBillingActionBlock(billing.status, 'stripe_checkout', Platform.OS);
  const nativeBillingBlock = getBillingActionBlock(billing.status, 'native_purchase', Platform.OS);
  const libraryMatches = !!libraryCode && libraryCode === getUid();
  const verifiedBilling = libraryMatches && !billing.loading && !billing.error ? billing.status : null;
  const planReady = isOnboarding && !!st.profile && isOnboardingPlanReady(st.profile, verifiedBilling);
  const chooseFree = useCallback(async () => {
    if (!canChooseFreePlan({ isOnboarding, hasProfile: !!st.profile, libraryMatches, purchaseBusy })) return;
    setPurchaseBusy('free');
    setPurchaseError('');
    setPurchaseErrorDiagnostic(null);
    try {
      const currentBilling = await billing.refresh();
      if (libraryCode !== getUid()) return;
      if (!currentBilling) {
        setPurchaseError('Could not check your library plan. Check your connection and tap Choose Free to try again.');
        return;
      }
      if (currentBilling.plan !== 'free') {
        setPurchaseError('This library already has a paid plan. Its confirmed plan is shown above.');
        return;
      }
      await st.saveProfile({ onboardingPlanChoice: 'free', onboardingPlanPending: false });
      if (libraryCode === getUid()) router.replace('/home');
    } catch (error) {
      if (libraryCode === getUid()) {
        await st.saveProfile({ onboardingPlanChoice: null, onboardingPlanPending: true }).catch(() => {});
        setPurchaseError(error?.message || 'Could not save your Free plan selection. Please try again.');
      }
    } finally {
      setPurchaseBusy('');
    }
  }, [billing.refresh, isOnboarding, libraryCode, libraryMatches, purchaseBusy, st.profile, st.saveProfile]);

  const continueOnboarding = useCallback(async () => {
    if (!planReady || !libraryMatches || purchaseBusy || !verifiedBilling) return;
    setPurchaseBusy('continue');
    setPurchaseError('');
    setPurchaseErrorDiagnostic(null);
    try {
      await st.saveProfile({ onboardingPlanChoice: verifiedBilling.plan, onboardingPlanPending: false });
      if (libraryCode === getUid()) router.replace('/home');
    } catch (error) {
      if (libraryCode === getUid()) {
        await st.saveProfile({ onboardingPlanPending: true }).catch(() => {});
        setPurchaseError(error?.message || 'Could not finish setting up your library. Please try again.');
      }
    } finally {
      setPurchaseBusy('');
    }
  }, [planReady, libraryMatches, purchaseBusy, verifiedBilling, st.saveProfile, libraryCode]);

  useFocusEffect(useCallback(() => {
    let active = true;
    let loadId = 0;
    const load = async () => {
      const currentLoad = ++loadId;
      const isCurrent = () => active && currentLoad === loadId && libraryCode === getUid();
      setPurchaseReady(false);
      setPurchaseNotice('');
      setNativePackagesUnavailable(false);
      if (Platform.OS === 'web') {
        setOffering(null);
        setPurchaseLoading(false);
        const result = Array.isArray(checkoutResult) ? checkoutResult[0] : checkoutResult;
        const forceRefresh = result === 'portal' && !portalRefreshStarted.current;
        if (forceRefresh) portalRefreshStarted.current = true;
        const confirmed = await billing.refresh({ forceRefresh });
        if (!active || libraryCode !== getUid()) return;
        if (result === 'success') {
          setPurchaseNotice(confirmed && confirmed.plan !== 'free'
            ? confirmedPlanMessage(confirmed.plan)
            : 'Checkout returned, but the library server has not confirmed a paid plan yet. Access remains on your server-confirmed plan.');
        } else if (result === 'cancel') {
          setPurchaseNotice('Checkout was canceled. Your server-confirmed plan has not changed.');
        } else if (result === 'portal') {
          setPurchaseNotice(confirmed?.plan && confirmed.plan !== 'free'
            ? `Billing management closed. ${planName(confirmed.plan)} remains confirmed by the library server.`
            : 'Billing management closed. Your plan remains the one confirmed by the library server.');
        }
        return;
      }
      if (!canUseNativeRevenueCat({ platform: Platform.OS, expoGo })) {
        setOffering(null);
        setPurchaseLoading(false);
        if (expoGo) await billing.refresh();
        return;
      }
      setPurchaseLoading(true);
      let revenueCatDiagnostic = null;
      try {
        let result;
        try {
          result = await getRevenueCatOfferings(libraryCode);
        } catch (error) {
          revenueCatDiagnostic = logRevenueCatError('getOfferings', error);
          throw error;
        }
        if (!isCurrent()) return;
        if (!result.current || !result.current.availablePackages?.length) {
          setNativePackagesUnavailable(true);
          throw new Error('There are no monthly subscription packages available in the current store offering.');
        }
        if (!['student_monthly', 'pro_monthly'].every((packageId) => result.current.availablePackages.some((pkg) => pkg.identifier === packageId))) {
          setNativePackagesUnavailable(true);
          throw new Error('Both Student and Pro store packages are required but are not configured for this app yet.');
        }
        setOffering(result.current);
        await billing.refreshFromRevenueCat();
        if (isCurrent()) setPurchaseReady(true);
      } catch (error) {
        if (!isCurrent()) return;
        setPurchaseReady(false);
        if (!retainedStoreError.current) {
          setPurchaseErrorDiagnostic(revenueCatDiagnostic);
          setPurchaseError(revenueCatDiagnostic?.friendlyMessage || error?.message || 'In-app purchases are not available for this library right now.');
        }
        await billing.refresh();
      } finally {
        if (isCurrent()) setPurchaseLoading(false);
      }
    };
    load();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') load();
    });
    return () => {
      active = false;
      loadId++;
      subscription.remove();
    };
  }, [billing.refresh, billing.refreshFromRevenueCat, checkoutResult, expoGo, libraryCode]));

  const purchase = useCallback(async () => {
    if (!canUseNativeRevenueCat({ platform: Platform.OS, expoGo })) return;
    if (!confirmPackage || !purchaseReady || purchaseBusy) return;
    const targetLibrary = libraryCode;
    const { plan, pkg } = confirmPackage;
    setConfirmPackage(null);
    setPurchaseBusy(plan.id);
    retainedStoreError.current = false;
    setPurchaseError('');
    setPurchaseErrorDiagnostic(null);
    setPurchaseNotice('');
    let storePurchaseComplete = false;
    let revenueCatDiagnostic = null;
    try {
      const freshStatus = await billing.refresh({ forceRefresh: true });
      if (targetLibrary !== getUid()) throw new Error('The active library changed. Reopen its plan page before purchasing.');
      if (!freshStatus) throw new Error('Could not refresh this library’s billing status. No purchase was started; check your connection and try again.');
      const billingBlock = getBillingActionBlock(freshStatus, 'native_purchase', Platform.OS, {
        testStorePreview,
        targetPlan: plan.id,
      });
      if (billingBlock) throw new Error(billingBlock);
      let previousProductIdentifier;
      let customerInfo;
      if (Platform.OS === 'android' && freshStatus.plan !== 'free' && freshStatus.billingSource === 'play_store') {
        customerInfo = await getRevenueCatCustomerInfo(targetLibrary);
        const activeSubscriptions = customerInfo.activeSubscriptions || [];
        if (activeSubscriptions.length !== 1) {
          throw new Error('Google Play could not identify exactly one current subscription to replace. No purchase was started to avoid a duplicate subscription; use Restore Purchases or manage it in Google Play.');
        }
        previousProductIdentifier = activeSubscriptions[0];
        if (previousProductIdentifier === pkg.product.identifier) {
          throw new Error('The library server and Google Play report the same subscription product. No duplicate purchase was started; refresh your plan status or manage the existing subscription.');
        }
      }
      const purchaseStatus = await billing.refresh({ forceRefresh: true });
      if (targetLibrary !== getUid()) throw new Error('The active library changed. Reopen its plan page before purchasing.');
      if (!purchaseStatus) throw new Error('Could not refresh this library’s billing status. No purchase was started; check your connection and try again.');
      if (purchaseStatus.plan !== freshStatus.plan || purchaseStatus.billingSource !== freshStatus.billingSource || purchaseStatus.billingConflict !== freshStatus.billingConflict) {
        throw new Error('This library’s billing status changed while checking the store. No purchase was started; refresh the page and try again.');
      }
      const finalBillingBlock = getBillingActionBlock(purchaseStatus, 'native_purchase', Platform.OS, {
        testStorePreview,
        targetPlan: plan.id,
      });
      if (finalBillingBlock) throw new Error(finalBillingBlock);
      const targetTier = ({ student: 1, pro: 2 })[plan.id] < ({ student: 1, pro: 2 })[purchaseStatus.plan] ? 'downgrade' : 'upgrade';
      try {
        await purchaseRevenueCatPackage(targetLibrary, pkg, previousProductIdentifier, targetTier);
      } catch (error) {
        revenueCatDiagnostic = logRevenueCatError('purchasePackage', error);
        throw error;
      }
      storePurchaseComplete = true;
      if (targetLibrary !== getUid()) {
        setPurchaseNotice('The store completed the transaction while you switched libraries. The newly open library was not changed; reopen the original library to refresh its server-confirmed plan.');
        return;
      }
      const verifiedStatus = readBillingStatus(await billing.refreshFromRevenueCat());
      if (targetLibrary !== getUid()) {
        setPurchaseNotice('The store completed the transaction, but the active library changed before the server could confirm it. Reopen the original library to refresh its plan.');
        return;
      }
      const tier = { free: 0, student: 1, pro: 2 };
      setPurchaseNotice(tier[verifiedStatus.plan] < tier[plan.id]
        ? `The store completed the transaction, but the library server has not confirmed ${planName(plan.id)} yet. Your access remains on the server-confirmed plan; try Restore Purchases or refresh again.`
        : `${planName(verifiedStatus.plan)} is confirmed by the library server.`);
    } catch (error) {
      if (error?.userCancelled || error?.code === 'PURCHASE_CANCELLED_ERROR') return;
      retainedStoreError.current = !!revenueCatDiagnostic;
      setPurchaseErrorDiagnostic(revenueCatDiagnostic);
      setPurchaseError(revenueCatDiagnostic
        ? revenueCatDiagnostic.friendlyMessage
        : storePurchaseComplete
        ? `The store purchase completed, but the library server could not confirm it. Your access remains based on the server-confirmed plan. ${error?.message || ''}`.trim()
        : error?.message || 'The purchase could not be completed. Please try again.');
      if (storePurchaseComplete && targetLibrary === getUid()) await billing.refresh();
    } finally {
      setPurchaseBusy('');
    }
  }, [billing.refresh, billing.refreshFromRevenueCat, confirmPackage, expoGo, libraryCode, purchaseBusy, purchaseReady, testStorePreview]);

  const restore = useCallback(async () => {
    if (!canUseNativeRevenueCat({ platform: Platform.OS, expoGo })) return;
    if (!purchaseReady || purchaseBusy) return;
    const targetLibrary = libraryCode;
    setPurchaseBusy('restore');
    retainedStoreError.current = false;
    setPurchaseError('');
    setPurchaseErrorDiagnostic(null);
    setPurchaseNotice('');
    let revenueCatDiagnostic = null;
    try {
      try {
        await restoreRevenueCatPurchases(targetLibrary);
      } catch (error) {
        revenueCatDiagnostic = logRevenueCatError('restorePurchases', error);
        throw error;
      }
      if (targetLibrary !== getUid()) {
        setPurchaseNotice('Purchases were restored on this device, but the active library changed. Reopen the original library to refresh its server-confirmed plan.');
        return;
      }
      const verifiedStatus = readBillingStatus(await billing.refreshFromRevenueCat());
      if (verifiedStatus.plan === 'free') {
        setPurchaseNotice('The server did not confirm an active paid subscription for this library. Your current server-confirmed plan remains Free.');
      } else {
        setPurchaseNotice(`${planName(verifiedStatus.plan)} is confirmed by the library server.`);
      }
    } catch (error) {
      retainedStoreError.current = !!revenueCatDiagnostic;
      setPurchaseErrorDiagnostic(revenueCatDiagnostic);
      setPurchaseError(revenueCatDiagnostic?.friendlyMessage || error?.message || 'Purchases could not be restored or verified. Try again when you are online.');
      if (targetLibrary === getUid()) await billing.refresh();
    } finally {
      setPurchaseBusy('');
    }
  }, [billing.refresh, billing.refreshFromRevenueCat, expoGo, libraryCode, purchaseBusy, purchaseReady]);

  const startStripeCheckout = useCallback(async () => {
    if (purchaseBusy) return;
    if (!confirmPackage || !purchaseConsent || !webStripeReady || libraryCode !== getUid()) {
      setPurchaseError(!purchaseConsent
        ? 'Check the subscription confirmation box before continuing.'
        : libraryCode !== getUid()
          ? 'Your active library changed. Close this confirmation and reopen Plans.'
          : 'Secure checkout is not ready. Refresh the plan page and try again.');
      return;
    }
    const targetLibrary = libraryCode;
    const plan = confirmPackage.plan;
    const newTab = inIframe();
    let checkoutTab = null;
    try {
      checkoutTab = reserveCheckoutTab(newTab);
      setPurchaseBusy(plan.id);
      setPurchaseError('');
      setPurchaseErrorDiagnostic(null);
      const freshStatus = await billing.refresh({ forceRefresh: true });
      if (targetLibrary !== getUid()) {
        checkoutTab?.close();
        setPurchaseError('The active library changed. Reopen its plan page to start checkout.');
        return;
      }
      if (!freshStatus) throw new Error('Could not refresh this library’s billing status. No checkout was started; check your connection and try again.');
      const billingBlock = getBillingActionBlock(freshStatus, 'stripe_checkout', Platform.OS);
      if (billingBlock) throw new Error(billingBlock);
      const result = await createStripeCheckout(plan.id, billingReturnUrl(), targetLibrary);
      if (targetLibrary !== getUid()) {
        checkoutTab?.close();
        setPurchaseError('The active library changed. Reopen its plan page to start checkout.');
        return;
      }
      if (typeof result?.url !== 'string') throw new Error('The billing server did not return a checkout URL.');
      await openStripeURL(result.url, checkoutTab);
      setConfirmPackage(null);
    } catch (error) {
      checkoutTab?.close();
      setPurchaseError(error?.message || 'Secure checkout could not be started. Please try again.');
    } finally {
      setPurchaseBusy('');
    }
  }, [billing.refresh, confirmPackage, libraryCode, purchaseBusy, purchaseConsent, webStripeReady]);

  const manageSubscription = useCallback(async () => {
    if (manageBusy || libraryCode !== getUid()) return;
    const targetLibrary = libraryCode;
    const newTab = Platform.OS === 'web' && inIframe();
    let checkoutTab = null;
    try {
      if (newTab) checkoutTab = reserveCheckoutTab(true);
      setManageBusy(true);
      setPurchaseError('');
      setPurchaseErrorDiagnostic(null);
      const confirmed = await billing.refresh({ forceRefresh: true });
      if (targetLibrary !== getUid()) {
        checkoutTab?.close();
        setPurchaseError('The active library changed. Reopen its plan page to manage billing.');
        return;
      }
      if (!confirmed || confirmed.plan === 'free') {
        checkoutTab?.close();
        setPurchaseError('The library server does not currently confirm a paid plan for this library.');
        return;
      }
      if (confirmed.billingSource === 'web') {
        if (Platform.OS === 'web') {
          const result = await createStripePortal(billingReturnUrl('portal'), targetLibrary);
          if (targetLibrary !== getUid()) {
            checkoutTab?.close();
            setPurchaseError('The active library changed. Reopen its plan page to manage billing.');
            return;
          }
          if (typeof result?.url !== 'string') throw new Error('The billing server did not return a subscription-management URL.');
          openStripeURL(result.url, checkoutTab);
        } else {
          await Linking.openURL(webPlansUrl());
        }
        return;
      }
      if (confirmed.billingSource === 'app_store' || confirmed.billingSource === 'play_store' || confirmed.billingSource === 'test_store') {
        if (confirmed.billingSource === 'test_store') {
          if (Platform.OS === 'web' || expoGo) {
            setPurchaseNotice('RevenueCat Test Store management is available only in an installed Debug preview. Use the RevenueCat Test Store controls to reset or end this test entitlement.');
            return;
          }
          const customerInfo = await getRevenueCatCustomerInfo(targetLibrary);
          const managementUrl = safeHttpsUrl(customerInfo.managementURL);
          if (managementUrl) {
            await Linking.openURL(managementUrl);
            return;
          }
          setPurchaseNotice('RevenueCat did not provide a management link for this Test Store subscription. Use the RevenueCat Test Store controls to reset or end the test entitlement; a Pro entitlement must end before Student can take effect.');
          return;
        }
        let managementUrl = null;
        if (Platform.OS !== 'web' && !expoGo) {
          try {
            managementUrl = safeHttpsUrl((await getRevenueCatCustomerInfo(targetLibrary)).managementURL);
          } catch {
            managementUrl = null;
          }
        }
        if (managementUrl) {
          await Linking.openURL(managementUrl);
          return;
        }
        if (confirmed.billingSource === 'app_store') {
          if (Platform.OS === 'ios' && !expoGo) await showRevenueCatManageSubscriptions(targetLibrary);
          else await Linking.openURL(APP_STORE_SUBSCRIPTIONS_URL);
        } else {
          await Linking.openURL(PLAY_STORE_SUBSCRIPTIONS_URL);
        }
        return;
      }
      throw new Error('The billing source could not be identified. Refresh your plan status and try again.');
    } catch (error) {
      checkoutTab?.close();
      setPurchaseError(error?.message || 'Subscription management could not be opened. Please try again.');
    } finally {
      setManageBusy(false);
    }
  }, [billing.refresh, expoGo, libraryCode, manageBusy]);

  const packageFor = (plan) => offering?.availablePackages?.find((pkg) => pkg.identifier === plan.packageId) || null;
  const billingBlockForPlan = (plan) => webCheckout
    ? webBillingBlock
    : getBillingActionBlock(billing.status, 'native_purchase', Platform.OS, {
      testStorePreview,
      targetPlan: plan.id,
    });
  if (isOnboarding && st.profile === null) return <Redirect href="/welcome" />;
  return (
    <Screen style={{ paddingBottom: 60 }}>
      <View style={{ width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 16 }}>
        <View style={{ paddingTop: 20, paddingBottom: 24, gap: 8 }}>
          <Text style={{ color: C.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' }}>ClassScribe plans</Text>
          <Text style={{ fontSize: 31, lineHeight: 38, letterSpacing: -1, fontWeight: '800', color: C.ink }}>Pick what fits your semester</Text>
          <Text style={{ color: C.sec, fontSize: 16, lineHeight: 23 }}>Plans include monthly transcription-hour and saved-recording limits, plus course limits. Student and Pro include study guides, flashcards, and quizzes; Pro adds Finals Mode and advanced tutor modes.</Text>
        </View>
        {(!isOnboarding || planReady) ? <CurrentPlan billing={billing} onRetry={billing.refresh} onManage={manageSubscription} manageBusy={manageBusy} /> : null}
        {isOnboarding ? (
          <View style={{ marginBottom: 22, padding: 16, borderRadius: 16, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, gap: 12 }}>
            <Text style={{ color: C.ink, fontSize: 17, fontWeight: '700' }}>{planReady ? 'Your account is ready' : 'Choose your plan to continue'}</Text>
            <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>{planReady
              ? `${planName(verifiedBilling.plan)} is confirmed for this library. You can continue now.`
              : 'Choose Free below, or select Student or Pro and continue to secure checkout. Your paid plan becomes active only after the library server confirms the subscription.'}</Text>
            {!planReady && webCheckout ? <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>Choose Free, Student ($7.99/month), or Pro ($12.99/month). Review your selection before going to secure checkout.</Text> : null}
            {!planReady && billing.error ? <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 14, lineHeight: 20 }}>Could not check your library plan: {billing.error} Tap Choose Free to retry.</Text> : null}
            <PurchaseErrorMessage
              message={purchaseError}
              diagnostic={purchaseErrorDiagnostic}
              onDismiss={() => { retainedStoreError.current = false; setPurchaseError(''); setPurchaseErrorDiagnostic(null); }}
            />
            {planReady ? <Btn title="Continue to your library" onPress={continueOnboarding} disabled={!!purchaseBusy} busy={purchaseBusy === 'continue'} /> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.name}
              plan={plan}
              pkg={packageFor(plan)}
              wide={wide}
              currentPlan={isOnboarding && !planReady && billing.status?.plan === 'free' ? null : billing.status?.plan}
              onPurchase={(selectedPlan, pkg) => { setPurchaseConsent(false); setConfirmPackage({ plan: selectedPlan, pkg }); }}
              onChooseFree={chooseFree}
              onBuyCredits={() => router.push('/credits')}
              canChooseFree={canChooseFreePlan({ isOnboarding, hasProfile: !!st.profile, libraryMatches, purchaseBusy })}
              isOnboarding={isOnboarding}
              purchaseBusy={purchaseBusy === plan.id}
              purchaseDisabled={webCheckout ? !!purchaseBusy : purchaseLoading || !purchaseReady || !!purchaseBusy}
              webCheckout={webCheckout}
              webReady={webStripeReady}
              expoGo={expoGo}
              billingBlock={billingBlockForPlan(plan)}
            />
          ))}
        </View>
        <View accessibilityLiveRegion="polite" testID="plans-credits-balance" style={{ marginTop: 18, padding: 17, borderRadius: 18, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.sep, gap: 8 }}>
          <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>Remaining Scribe Credits</Text>
          <Text style={{ color: C.ink, fontSize: 28, fontWeight: '800' }}>{credits.status ? credits.status.balance.toLocaleString() : credits.loading ? 'Checking balance…' : 'Balance unavailable'}</Text>
          <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>Student and Pro use included allowances first, then confirm credits for extra transcription hours, transcriptions, or saved recordings. Unspent credits do not expire.</Text>
          {credits.status ? <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>{credits.status.costs.transcription10Minutes} credit per 10 extra transcription minutes (rounded up) · {credits.status.costs.savedRecording} credits per extra saved recording.</Text> : null}
          {credits.error ? <Text accessibilityRole="alert" style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>{credits.error}</Text> : null}
          <Btn title="View balance and buy credits" onPress={() => router.push('/credits')} kind="secondary" />
          {!credits.status ? <Btn title="Refresh balance" onPress={credits.refresh} busy={credits.loading} kind="secondary" /> : null}
        </View>
        {credits.status?.monthlyBonus ? (
          <View style={{ marginTop: 18, padding: 17, borderRadius: 18, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, gap: 8 }}>
            <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>Monthly Credits bonuses</Text>
            <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>Student receives {credits.status.monthlyBonus.student} bonus Credits each month. Pro receives {credits.status.monthlyBonus.pro}. Bonuses are confirmed by your library server.</Text>
            <Pressable onPress={() => router.push('/credits')} accessibilityRole="link" accessibilityLabel="See Credits balance and history" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
              <Text style={{ color: C.accent, fontSize: 14, fontWeight: '700' }}>See Credits balance and history →</Text>
            </Pressable>
          </View>
        ) : credits.error ? (
          <Text accessibilityRole="alert" style={{ color: C.sec, fontSize: 13, lineHeight: 19, marginTop: 14 }}>Monthly Credits bonus details are unavailable: {credits.error}</Text>
        ) : null}
        {webCheckout && !webStripeReady ? (
          <View style={{ marginTop: 18, padding: 18, borderRadius: 18, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, gap: 8 }} testID="web-upgrades-unavailable">
            <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>{billing.loading ? 'Checking upgrade availability…' : billing.error ? 'Could not check upgrade availability' : "Upgrades aren't set up yet"}</Text>
            <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>{billing.loading
              ? 'Checking whether secure web checkout is ready for this library.'
              : billing.error
                ? billing.error
                : 'Web subscriptions are not available for this library yet. Your current plan remains unchanged.'}</Text>
            <Btn title="Try again" kind="secondary" onPress={billing.refresh} disabled={billing.loading} busy={billing.loading} testID="button-retry-upgrade-readiness" />
          </View>
        ) : null}
        {webCheckout && webBillingBlock ? (
          <View style={{ marginTop: 18, padding: 18, borderRadius: 18, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, gap: 8 }} testID="native-billing-on-web">
            <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>{billing.status?.billingSource
              ? `Manage this subscription through ${billingSourceName(billing.status.billingSource)}`
              : 'Billing source needs attention'}</Text>
            <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>{webBillingBlock}</Text>
            {billing.status?.billingSource === 'web' ? (
              <Btn title="Manage web subscription" icon="settings-outline" kind="secondary" onPress={manageSubscription} disabled={manageBusy} busy={manageBusy} testID="button-manage-web-plan" />
            ) : null}
          </View>
        ) : null}
        {!webCheckout && nativeBillingBlock && billing.status?.billingSource !== 'web' && billing.status?.billingSource !== 'test_store' ? (
          <View style={{ marginTop: 18, padding: 18, borderRadius: 18, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, gap: 8 }} testID="native-billing-conflict">
            <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>Purchases are paused</Text>
            <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>{nativeBillingBlock}</Text>
          </View>
        ) : null}
        {!webCheckout && billing.status?.billingSource === 'web' ? (
          <View style={{ marginTop: 18, padding: 18, borderRadius: 18, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, gap: 8 }} testID="web-billing-on-phone">
            <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>Manage your web subscription</Text>
            <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>{nativeBillingBlock}</Text>
            <Btn title="Open web subscription management" kind="secondary" onPress={manageSubscription} disabled={manageBusy} busy={manageBusy} testID="button-manage-web-subscription" />
          </View>
        ) : null}
        {expoGo ? (
          <View style={{ marginTop: 18, padding: 18, borderRadius: 18, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, gap: 8 }} testID="preview-purchase-guidance">
            <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>{webCheckout ? 'Secure checkout in this preview' : 'Purchases in the installed app'}</Text>
            <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>{webCheckout ? 'Student and Pro are available. Choose a plan above to open secure web checkout for this library. Installed iPhone apps use Apple’s in-app purchases.' : 'Use the installed ClassScribe app to purchase a subscription.'}</Text>
          </View>
        ) : nativePackagesUnavailable ? (
          <View style={{ marginTop: 18, padding: 18, borderRadius: 18, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, gap: 8 }} testID="native-purchases-coming-soon">
            <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>Store prices could not be loaded</Text>
            <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>Student and Pro are available, but this device could not load their store prices. Retry below; your current plan remains unchanged.</Text>
          </View>
        ) : null}
        <View style={{ marginTop: 18, padding: 20, borderRadius: 20, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, gap: 12 }} testID="coming-soon-editions">
          <Text style={{ color: C.ink, fontSize: 20, fontWeight: '800' }}>Coming soon</Text>
          <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>These ClassScribe editions are planned, not available to subscribe to yet.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {['ClassScribe EDU', 'ClassScribe Law', 'ClassScribe Medicine'].map((edition) => (
              <View key={edition} style={{ backgroundColor: C.accentSoft, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>{edition}</Text>
              </View>
            ))}
          </View>
        </View>
        {Platform.OS === 'web' ? (
          <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19, marginTop: 16 }}>Web subscriptions use secure Stripe checkout. This page shows only the plan confirmed by your library server; a completed payment does not change access until the server verifies it.</Text>
        ) : purchaseLoading ? (
          <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19, marginTop: 16 }}>Loading store plans and verifying your library subscription…</Text>
        ) : null}
        {!isOnboarding ? (
          <View style={{ marginTop: 12 }}>
            <PurchaseErrorMessage
              message={purchaseError}
              diagnostic={purchaseErrorDiagnostic}
              onDismiss={() => { retainedStoreError.current = false; setPurchaseError(''); setPurchaseErrorDiagnostic(null); }}
            />
          </View>
        ) : null}
        {purchaseNotice ? <Text accessibilityRole="status" style={{ color: C.accent, fontSize: 14, lineHeight: 20, marginTop: 12 }}>{purchaseNotice}</Text> : null}
        {Platform.OS !== 'web' ? (
          <View style={{ marginTop: 12 }}>
            <Btn title="Restore purchases" icon="refresh-outline" kind="secondary" onPress={restore} disabled={!purchaseReady || !!purchaseBusy} busy={purchaseBusy === 'restore'} testID="button-restore-purchases" />
          </View>
        ) : null}
        {Platform.OS !== 'web' && !purchaseReady && !purchaseLoading && !purchaseError ? (
          <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19, marginTop: 12 }}>Purchases are unavailable until this library can be securely linked to the subscription service.</Text>
        ) : null}

        <Modal visible={!!confirmPackage} transparent animationType="fade" onRequestClose={() => setConfirmPackage(null)}>
          <View style={{ flex: 1, justifyContent: 'center', padding: 22, backgroundColor: 'rgba(0,0,0,0.55)' }}>
            <View style={{ backgroundColor: C.cell, borderRadius: 20, borderWidth: 1, borderColor: C.sep, padding: 22, gap: 14 }}>
              <Text style={{ color: C.ink, fontSize: 21, fontWeight: '800' }}>Confirm subscription</Text>
              <Text style={{ color: C.sec, fontSize: 15, lineHeight: 22 }}>
                {confirmPackage ? webCheckout
                  ? `${confirmPackage.plan.name} · ${confirmPackage.plan.id === 'student' ? '$7.99' : '$12.99'}/month. Continue to Stripe to review the final subscription terms before you pay.`
                  : `${confirmPackage.plan.name} · ${confirmPackage.pkg.product.priceString || 'Price unavailable'}${confirmPackage.plan.period || ''}. Apple or Google will show the final price and subscription terms before you approve.`
                  : ''}
              </Text>
              <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>{webCheckout
                ? 'ClassScribe applies subscription access only after the library server confirms your Stripe subscription.'
                : 'ClassScribe applies subscription access only after the library server verifies the store transaction.'}</Text>
              <PurchaseErrorMessage
                message={purchaseError}
                diagnostic={purchaseErrorDiagnostic}
                onDismiss={() => { retainedStoreError.current = false; setPurchaseError(''); setPurchaseErrorDiagnostic(null); }}
              />
              {!webCheckout && isRevenueCatPreviewMode() ? (
                <Text style={{ color: C.accent, fontSize: 14, lineHeight: 21 }}>Test mode: this is a RevenueCat preview purchase, not a live store subscription.</Text>
              ) : null}
              {webCheckout && billing.status?.billingReadiness?.mode === 'test' ? (
                <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>This is a Stripe test checkout. No real payment will be taken until live payments are connected and published.</Text>
              ) : null}
              {webCheckout && !webStripeReady ? (
                <View style={{ gap: 8 }}>
                  <Text accessibilityRole="alert" style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>
                    {billing.loading ? 'Checking secure checkout…' : billing.error || billing.status?.billingReadiness?.message || 'Secure checkout is not ready yet. You can review this plan, but your subscription has not changed.'}
                  </Text>
                  <Btn title="Retry checkout availability" kind="secondary" onPress={billing.refresh} disabled={billing.loading} busy={billing.loading} />
                </View>
              ) : null}
              <Pressable onPress={() => setPurchaseConsent((consented) => !consented)} accessibilityRole="checkbox" accessibilityState={{ checked: purchaseConsent }} testID="checkbox-purchase-consent" style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name={purchaseConsent ? 'checkbox' : 'square-outline'} size={22} color={purchaseConsent ? C.accent : C.sec} />
                <Text style={{ color: C.ink, fontSize: 14, lineHeight: 20, flex: 1 }}>{webCheckout
                  ? 'I understand Stripe will show the checkout total and recurring subscription terms before I pay.'
                  : 'I understand the store will show the final price and renewal terms before I approve.'}</Text>
              </Pressable>
              {!purchaseConsent ? <Text accessibilityLiveRegion="polite" style={{ color: C.sec, fontSize: 13 }}>Check the confirmation box above to enable the continue button.</Text> : null}
              <Btn title={webCheckout ? 'Continue to secure checkout' : 'I agree — continue'} icon="card-outline" onPress={webCheckout ? startStripeCheckout : purchase} busy={!!purchaseBusy} disabled={(webCheckout ? !webStripeReady : !purchaseReady) || !purchaseConsent || !!purchaseBusy} testID="button-confirm-subscription" />
              <Btn title="Not now" kind="plain" onPress={() => setConfirmPackage(null)} disabled={!!purchaseBusy} />
            </View>
          </View>
        </Modal>

        <View style={{ marginTop: 30, padding: 20, borderRadius: 20, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="shield-checkmark-outline" size={24} color={C.accent} />
            <Text style={{ fontSize: 21, fontWeight: '800', color: C.ink, flex: 1 }}>Recording consent and privacy</Text>
          </View>
          <Text style={{ fontSize: 15, lineHeight: 23, color: C.sec, marginTop: 13 }}>
            Universities and instructors set different recording policies, and recording laws vary by state and country. ClassScribe keeps consent visible instead of recording quietly in the background.
          </Text>
          <View style={{ gap: 13, marginTop: 20 }}>
            {CONSENT.map((point) => (
              <View key={point} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
                <Ionicons name="checkmark-circle-outline" size={19} color={C.accent} style={{ marginTop: 2 }} />
                <Text style={{ fontSize: 14, lineHeight: 21, color: C.ink, flex: 1 }}>{point}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ marginTop: 30, padding: 20, borderRadius: 20, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep }}>
          <Text style={{ fontSize: 21, fontWeight: '800', color: C.ink }}>Where ClassScribe is headed</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            {LEVELS.map((item) => (
              <View key={item} accessibilityLabel={`${item}${item === level ? ', your level' : ''}`} style={{
                minHeight: 44, justifyContent: 'center', paddingHorizontal: 15, borderRadius: 99,
                backgroundColor: item === level ? C.accent : C.fill,
              }}>
                <Text style={{ color: item === level ? C.accentText : C.ink, fontSize: 13, fontWeight: '700' }}>
                  {item === 'High School' ? 'ClassScribe High School' : item}
                </Text>
              </View>
            ))}
          </View>
          {isOnboarding ? (
            <>
              <Text style={{ color: C.sec, fontSize: 13, marginTop: 10 }}>Change your level in Account whenever you like.</Text>
              <Pressable accessibilityRole="link" accessibilityLabel="Manage account sign-in" onPress={() => router.push('/account-sign-in')} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }} testID="link-onboarding-account-sign-in">
                <Text style={{ color: C.accent, fontWeight: '700' }}>Manage account sign-in →</Text>
              </Pressable>
            </>
          ) : (
            <Pressable accessibilityRole="link" accessibilityLabel="Change your level in your account" onPress={() => router.push('/account')} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 10 }} testID="link-change-level-account">
              <Text style={{ color: C.accent, fontWeight: '700' }}>Change it in your account →</Text>
            </Pressable>
          )}
        </View>
        {planReady ? (
          <View style={{ marginTop: 20 }}>
            <Btn title="Continue to your library" onPress={continueOnboarding} disabled={!!purchaseBusy} busy={purchaseBusy === 'continue'} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
