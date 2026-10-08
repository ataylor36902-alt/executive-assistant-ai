import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Btn, Screen } from './ui';
import { useBillingStatus } from '../lib/billing';
import { useStore } from '../lib/store';
import { C } from '../lib/theme';
import { requiredExamFeaturePlan } from '../lib/study-scope';

const TIER = { free: 0, student: 1, pro: 2 };

export function useExamFeatureAccess(feature, finalsMode = false) {
  const st = useStore();
  const billing = useBillingStatus(st.status.uid);
  const requiredPlan = requiredExamFeaturePlan(feature, finalsMode);
  const allowed = !billing.loading && !!billing.status && TIER[billing.status.plan] >= TIER[requiredPlan];
  return { ...billing, allowed, requiredPlan };
}

export function ExamFeatureAccessNotice({ billing, requiredPlan, loadingText = 'Checking your library plan…', embedded = false }) {
  const { status, loading, error, refresh } = billing;
  const unavailable = !loading && !status;
  const tierName = requiredPlan === 'pro' ? 'Pro' : 'Student or Pro';
  const panel = (
    <View style={{ margin: 16, marginTop: 22, padding: 20, borderRadius: 16, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, gap: 12 }}>
        <Text style={{ color: C.ink, fontSize: 21, fontWeight: '800' }}>
          {loading ? 'Checking access' : unavailable ? 'Plan could not be confirmed' : `${tierName} feature`}
        </Text>
        <Text accessibilityRole={error ? 'alert' : undefined} style={{ color: error ? C.warn : C.sec, fontSize: 15, lineHeight: 22 }}>
          {loading
            ? loadingText
            : unavailable
              ? `${error || 'Your library plan is unavailable.'} Paid exam tools stay locked until the server confirms access.`
              : requiredPlan === 'pro'
                ? 'Finals Mode and advanced tutor modes (Teach me and Weak areas) require ClassScribe Pro.'
                : 'Study guides, flashcards, and quizzes require ClassScribe Student or Pro. Your notes and recordings are still available.'}
        </Text>
        {unavailable ? <Btn title="Check plan again" kind="secondary" onPress={refresh} /> : null}
        <Btn title={unavailable ? 'View plans' : `View ${requiredPlan === 'pro' ? 'Pro' : 'Student and Pro'} plans`} icon="arrow-up-circle-outline" onPress={() => router.push('/plans')} />
    </View>
  );
  return embedded ? panel : <Screen>{panel}</Screen>;
}