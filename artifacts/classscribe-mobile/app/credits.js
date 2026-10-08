import React, { useCallback, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Btn, Screen } from '../components/ui';
import { C } from '../lib/theme';
import { useResolvedTheme, useStore } from '../lib/store';
import { selectCreditsOffering, useCreditsStatus } from '../lib/credits-status';
import { getCreditsCurrencyCode, getDisplayedCreditsBalance } from '../lib/credits-currency';
import { getUid } from '../lib/api';
import {
  getRevenueCatOfferings, getRevenueCatVirtualCurrencies, invalidateRevenueCatVirtualCurrenciesCache,
  isRevenueCatExpoGo, purchaseRevenueCatPackage,
} from '../lib/revenuecat';
import { isUnsafeRevenueCatTestStoreRelease } from '../lib/revenuecat-environment';

const COSTS = [
  ['transcription10Minutes', '10 minutes of transcription'],
  ['savedRecording', 'Save a recording'],
  ['studyGuide', 'Generate a study guide'],
  ['askQuestion', 'Ask a question'],
];

function safeNativeStoreAvailable() {
  return Platform.OS !== 'web' &&
    !isRevenueCatExpoGo() &&
    !isUnsafeRevenueCatTestStoreRelease({
      environment: process.env.EXPO_PUBLIC_REVENUECAT_ENVIRONMENT,
      devMode: __DEV__,
      expoGo: false,
    });
}

function Coin({ size = 34 }) {
  return <View accessible accessibilityRole="image" accessibilityLabel="Green Credits coin with sound wave" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.accentDark }}>
    <Ionicons name="pulse" size={size * 0.59} color={C.accentText} />
  </View>;
}

function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Credits() {
  useResolvedTheme();
  const st = useStore();
  const { status, loading, error, refresh } = useCreditsStatus(st.status.uid);
  const [offering, setOffering] = useState(null);
  const [offeringLibrary, setOfferingLibrary] = useState('');
  const [storeError, setStoreError] = useState('');
  const [purchaseNotice, setPurchaseNotice] = useState('');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [nativeBalance, setNativeBalance] = useState(null);
  const [nativeBalanceLibrary, setNativeBalanceLibrary] = useState('');
  const [nativeBalanceCurrency, setNativeBalanceCurrency] = useState('');
  const activeCurrencyCode = status ? getCreditsCurrencyCode(status) : '';
  const nativeStore = safeNativeStoreAvailable();
  const offeringIdentifier = status?.offeringIdentifier;
  const creditsStatusReady = !!status;
  const unsupportedStore = Platform.OS === 'web' || isRevenueCatExpoGo() ||
    isUnsafeRevenueCatTestStoreRelease({
      environment: process.env.EXPO_PUBLIC_REVENUECAT_ENVIRONMENT,
      devMode: __DEV__,
      expoGo: isRevenueCatExpoGo(),
    });

  const syncNativeBalance = useCallback(async (libraryCode, currencyCode) => {
    if (!safeNativeStoreAvailable() || libraryCode !== getUid()) return;
    try {
      const currency = await getRevenueCatVirtualCurrencies(libraryCode, currencyCode);
      if (libraryCode !== getUid()) return;
      if (currency && Number.isFinite(Number(currency.balance))) {
        setNativeBalance(Number(currency.balance));
        setNativeBalanceLibrary(libraryCode);
        setNativeBalanceCurrency(currencyCode);
      }
    } catch {
      setStoreError('The store balance could not be refreshed. Your authenticated server balance is still shown.');
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    setOffering(null);
    setOfferingLibrary('');
    if (!nativeStore || !creditsStatusReady || !st.status.uid || st.status.uid !== getUid()) return () => {};
    getRevenueCatOfferings(st.status.uid).then((result) => {
      if (active && st.status.uid === getUid()) {
        setOffering(selectCreditsOffering(result, { offeringIdentifier }));
        setOfferingLibrary(st.status.uid);
      }
    }).catch((reason) => {
      if (active) setStoreError(reason?.message || 'In-app purchases are unavailable right now. You can still view your server balance and history.');
    });
    return () => { active = false; };
  }, [nativeStore, st.status.uid, offeringIdentifier, creditsStatusReady]);

  React.useEffect(() => {
    setNativeBalance(null);
    setNativeBalanceLibrary('');
    setNativeBalanceCurrency('');
    setStoreError('');
    setPurchaseNotice('');
    setSelected(null);
  }, [st.status.uid]);

  React.useEffect(() => {
    if (!activeCurrencyCode) return;
    setNativeBalance(null);
    setNativeBalanceCurrency('');
  }, [activeCurrencyCode]);

  React.useEffect(() => {
    if (error) setSelected(null);
  }, [error]);

  React.useEffect(() => {
    // A newer server balance replaces a store snapshot from an earlier purchase.
    setNativeBalance(null);
  }, [status?.balance]);

  React.useEffect(() => {
    if (activeCurrencyCode) syncNativeBalance(st.status.uid, activeCurrencyCode);
  }, [activeCurrencyCode, st.status.uid, syncNativeBalance]);

  const buySelected = async () => {
    if (!selected || busy || !nativeStore || !status || error) return;
    const targetLibrary = selected.libraryCode;
    if (!targetLibrary || targetLibrary !== st.status.uid || targetLibrary !== getUid()) {
      setStoreError('The active library changed. Reopen Credits before purchasing.');
      setSelected(null);
      return;
    }
    setBusy(true);
    setStoreError('');
    setPurchaseNotice('');
    try {
      const pkg = offeringLibrary === targetLibrary
        ? offering?.availablePackages?.find((item) => item.identifier === selected.identifier)
        : null;
      if (!pkg) throw new Error('This Credits pack is not available in the current store offering.');
      await purchaseRevenueCatPackage(targetLibrary, pkg);
      setSelected(null);
      await invalidateRevenueCatVirtualCurrenciesCache(targetLibrary);
       await syncNativeBalance(targetLibrary, activeCurrencyCode);
      await refresh();
      setPurchaseNotice('Purchase complete. Your server balance will update when the library confirms the Credits.');
    } catch (reason) {
      if (reason?.userCancelled || reason?.code === 'PURCHASE_CANCELLED_ERROR') return;
      setStoreError(reason?.message || 'The purchase could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const currentOffering = offeringLibrary === st.status.uid ? offering : null;
  const packs = (status?.packs || []).slice(0, 3).map((pack) => {
    const identifier = pack.id;
    const pkg = currentOffering?.availablePackages?.find((item) => item.identifier === identifier);
    return { ...pack, identifier, pkg };
  });
  const displayedBalance = getDisplayedCreditsBalance(
    status?.balance,
    nativeBalance,
    nativeBalanceLibrary === st.status.uid && nativeBalanceCurrency === activeCurrencyCode,
  );

  return <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: C.bg }}>
    <Screen style={{ paddingHorizontal: 18, paddingTop: Platform.OS === 'web' ? 79 : 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: 10 }}>
      <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/home')} accessibilityRole="button" accessibilityLabel="Go back" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="chevron-back" size={24} color={C.ink} /></Pressable>
      <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={{ color: C.ink, fontSize: 24, fontWeight: '800', flex: 1 }}>Credits</Text>
      <Coin />
    </View>

    <View style={{ marginTop: 14, backgroundColor: C.accentSoft, borderRadius: 20, padding: 21, borderWidth: 1, borderColor: C.sep }}>
      <Text style={{ color: C.sec, fontSize: 13, fontWeight: '700' }}>REMAINING SCRIBE CREDITS</Text>
      <View accessibilityLabel={displayedBalance == null ? 'Credits balance loading' : `${displayedBalance} ${status?.currency?.name || 'Credits'}`} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 9 }}>
        <Coin size={43} />
        <Text style={{ color: C.ink, fontSize: 34, fontWeight: '800', letterSpacing: -1 }}>{loading && displayedBalance == null ? '…' : displayedBalance ?? '—'}</Text>
        <Text style={{ color: C.sec, fontSize: 16, fontWeight: '700' }}>{status?.currency?.name || 'Credits'}</Text>
      </View>
      {status ? <Text style={{ color: C.sec, fontSize: 12, marginTop: 4 }}>Currency: {activeCurrencyCode}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 13, lineHeight: 19, marginTop: 9 }}>{error}</Text> : null}
      <Btn title="Refresh balance" kind="secondary" small onPress={refresh} busy={loading} style={{ alignSelf: 'flex-start', marginTop: 12 }} />
    </View>

    {purchaseNotice ? <View accessibilityRole="status" style={{ marginTop: 12, padding: 13, borderRadius: 13, backgroundColor: C.accentSoft }}><Text style={{ color: C.ink, fontSize: 13, lineHeight: 19 }}>{purchaseNotice}</Text></View> : null}
    {storeError ? <View style={{ marginTop: 12, padding: 13, borderRadius: 13, backgroundColor: C.warnSoft, gap: 6 }}><Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 13, lineHeight: 19 }}>{storeError}</Text><Pressable onPress={() => { setStoreError(''); setOffering(null); }} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}><Text style={{ color: C.accent, fontSize: 14, fontWeight: '700' }}>Dismiss</Text></Pressable></View> : null}

    <Text style={{ color: C.ink, fontSize: 20, fontWeight: '800', marginTop: 25, marginBottom: 10 }}>Get more Credits</Text>
    {!status?.packs?.length ? <Text style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>{loading ? 'Loading available packs…' : 'Credits packs are not available from the server right now.'}</Text> :
      <View style={{ gap: 10 }}>
        {packs.map((pack) => {
          const priceString = pack.pkg?.product?.priceString;
          const canPurchase = nativeStore && !!priceString && !busy;
          return <View key={pack.id} style={{ backgroundColor: C.cell, borderRadius: 16, padding: 15, borderWidth: 1, borderColor: C.sep, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Coin size={38} />
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={{ color: C.ink, fontSize: 16, fontWeight: '800' }}>{pack.name}</Text>
              {pack.label ? <View accessibilityLabel={`${pack.label} Credits pack label`} style={{ alignSelf: 'flex-start', borderRadius: 8, backgroundColor: C.accentSoft, paddingHorizontal: 8, paddingVertical: 3, marginTop: 5 }}><Text style={{ color: C.accent, fontSize: 11, fontWeight: '800' }}>{pack.label}</Text></View> : null}
              <Text style={{ color: C.sec, fontSize: 13, marginTop: 3 }}>{pack.credits} Credits</Text>
            </View>
            {nativeStore ? <Pressable onPress={() => setSelected({ ...pack, libraryCode: st.status.uid, identifier: pack.id, priceString })} disabled={!canPurchase} accessibilityRole="button" accessibilityLabel={priceString ? `Buy ${pack.name} for ${priceString}` : `${pack.name} unavailable`} accessibilityState={{ disabled: !canPurchase }} style={{ minWidth: 92, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.accent, paddingHorizontal: 11, opacity: canPurchase ? 1 : 0.48 }}>
              <Text style={{ color: C.accentText, fontWeight: '800' }}>{priceString || 'Unavailable'}</Text>
            </Pressable> : <Text style={{ color: C.sec, fontSize: 12, flex: 1, textAlign: 'right' }}>Purchases available in the installed app</Text>}
          </View>;
        })}
      </View>}
    {nativeStore && currentOffering && packs.some((pack) => !pack.pkg?.product?.priceString) ? <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 13, lineHeight: 19, marginTop: 9 }}>Some Credits packs are not configured in the current store offering yet. Prices are shown only when the store provides them.</Text> : null}
    {unsupportedStore ? <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19, marginTop: 10 }}>Purchases are available through the App Store or Google Play in an installed ClassScribe app. This preview shows your server balance only.</Text> : null}

     <View style={{ marginTop: 24, backgroundColor: C.cell, borderRadius: 18, padding: 17, borderWidth: 1, borderColor: C.sep }}>
      <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>How Credits work</Text>
       <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21, marginTop: 8 }}>Student and Pro use included allowances first. After that, confirm credits for extra transcription hours, transcriptions, or saved recordings. Transcription minutes are rounded up to 10-minute blocks; exhausting both transcription limits does not charge twice. Other plan limits still apply. Your balance and activity are tied to this library and confirmed by its server. Credits accumulate and do not expire.</Text>
      <View style={{ gap: 11, marginTop: 15 }}>
        {COSTS.map(([key, label]) => <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Ionicons name="pulse-outline" size={17} color={C.accent} />
          <Text style={{ color: C.ink, fontSize: 13, flex: 1 }}>{label}</Text>
          <Text style={{ color: C.accent, fontSize: 13, fontWeight: '800' }}>{status?.costs?.[key] ?? '—'} credits</Text>
        </View>)}
      </View>
    </View>

    <Text style={{ color: C.ink, fontSize: 20, fontWeight: '800', marginTop: 25, marginBottom: 10 }}>Credit history</Text>
    {status?.history?.length ? <View style={{ backgroundColor: C.cell, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.sep }}>
       {status.history.map((item, index) => { const currencyMigration = Number(item.amount) === 0 && /migrat/i.test(`${item.reason} ${item.source}`); return <View key={item.id} style={{ minHeight: 66, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: index === status.history.length - 1 ? 0 : 1, borderBottomColor: C.sep }}>
        <Ionicons name={currencyMigration ? 'swap-horizontal-outline' : Number(item.amount) >= 0 ? 'add-circle-outline' : 'remove-circle-outline'} size={21} color={currencyMigration ? C.sec : Number(item.amount) >= 0 ? C.accent : C.sec} />
        <View style={{ flex: 1, paddingVertical: 10 }}><Text style={{ color: C.ink, fontSize: 14, fontWeight: '700' }}>{currencyMigration ? 'Currency migration' : item.reason}</Text><Text style={{ color: C.sec, fontSize: 12, marginTop: 3 }}>{dateLabel(item.date)}{item.source ? ` · ${item.source}` : ''}</Text></View>
        <Text style={{ color: currencyMigration ? C.sec : C.ink, fontSize: 14, fontWeight: '800' }}>{currencyMigration ? 'No balance change' : `${Number(item.amount) > 0 ? '+' : ''}${item.amount}`}</Text>
      </View>; })}
    </View> : <Text style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>{loading ? 'Loading history…' : 'No Credits activity yet.'}</Text>}

    <View style={{ height: 28 }} />
    <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => !busy && setSelected(null)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' }}>
        <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 34, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}><Coin size={40} /><Text style={{ color: C.ink, fontSize: 21, fontWeight: '800', flex: 1 }}>Confirm Credits purchase</Text></View>
          <Text accessibilityLabel={`${selected?.name || 'Credits pack'}, ${selected?.credits || 0} Credits, ${selected?.priceString || ''}`} style={{ color: C.sec, fontSize: 15, lineHeight: 22 }}>{selected?.name} · {selected?.credits} Credits · {selected?.priceString}</Text>
          <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>The store will show the final charge before you approve.</Text>
          <Btn title="Continue to store" icon="card-outline" onPress={buySelected} busy={busy} disabled={busy} testID="button-confirm-credits-purchase" />
          <Btn title="Not now" kind="plain" onPress={() => setSelected(null)} disabled={busy} />
        </View>
      </View>
    </Modal>
    </Screen>
  </SafeAreaView>;
}