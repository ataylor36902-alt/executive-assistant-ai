import React from 'react';
import { Linking, Text, View } from 'react-native';
import { Alert } from '../../lib/notify';
import { Btn, Screen, Section } from '../../components/ui';
import { C } from '../../lib/theme';

const CONTACT_EMAIL = 'edmitainvestmentllc@edmitainvest.com';

export default function Contact() {
  const emailSupport = () => {
    Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('URGENT: ClassScribe support')}`)
      .catch(() => Alert.alert('Could not open your mail app', `Email ${CONTACT_EMAIL} directly.`));
  };

  return (
    <Screen>
      <Section title="Support" footer="This opens your mail app. Check your message and tap Send there.">
        <View style={{ padding: 16, gap: 14 }}>
          <Text style={{ color: C.ink, fontSize: 16, lineHeight: 23 }}>
            Need help with ClassScribe? If the support chatbot cannot answer, contact us directly.
          </Text>
          <Text selectable style={{ color: C.accent, fontSize: 16, fontWeight: '700' }}>
            {CONTACT_EMAIL}
          </Text>
          <Btn title="Email urgent support" icon="mail-outline" onPress={emailSupport} testID="urgent-contact-email" />
        </View>
      </Section>
    </Screen>
  );
}