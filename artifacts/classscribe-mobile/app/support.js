import React, { useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Section, s } from '../components/ui';
import { supportChat } from '../lib/api';
import { C } from '../lib/theme';

export default function Support() {
  const insets = useSafeAreaInsets();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);

  async function sendQuestion(textOverride) {
    const text = (typeof textOverride === 'string' ? textOverride : question).trim();
    if (!text || busy) return;
    const prior = messages.slice(-8).map(({ role, content }) => ({ role, content: content.slice(0, 800) }));
    setQuestion('');
    setMessages((current) => [...current, { role: 'user', content: text }]);
    setBusy(true);
    try {
      const result = await supportChat(text, prior);
      setMessages((current) => [...current, { role: 'assistant', content: result.answer }]);
      if (result.escalation === 'failed') setMessages((current) => [...current, {
        role: 'assistant',
        content: 'Automatic urgent delivery failed. Open Contact next to Class at the bottom of the app to email us yourself.',
      }]);
    } catch (error) {
      const reason = error?.message || 'The support service could not be reached.';
      setMessages((current) => [...current, {
        role: 'assistant',
        content: `${reason} Your question was not submitted. Open Contact next to Class at the bottom of the app to email us yourself.`,
      }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior="padding"
      keyboardVerticalOffset={88}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 20 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Section
          title="Help with ClassScribe"
          footer="This assistant is for product help, separate from study questions in Ask."
        >
          <View style={{ padding: 14, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Image
                source={require('../assets/images/einstein-help.png')}
                accessibilityLabel="Cartoon Einstein, your ClassScribe Help guide"
                style={{ width: 68, height: 80 }}
                resizeMode="contain"
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontSize: 17, fontWeight: '700' }}>Meet your Help guide</Text>
                <Text style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>
                  Ask about features, plans and their limits.
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[
                { label: 'Compare the plans', question: 'Compare the plans' },
                { label: 'ClassScribe EDU', question: 'Is ClassScribe EDU available?' },
                { label: 'ClassScribe Law', question: 'Is ClassScribe Law available?' },
                { label: 'ClassScribe Medicine', question: 'Is ClassScribe Medicine available?' },
              ].map(({ label, question }) => (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => sendQuestion(question)}
                  style={{ borderRadius: 12, backgroundColor: C.accentSoft, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}
                >
                  <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>
              ClassScribe EDU, ClassScribe Law, and ClassScribe Medicine are planned, not available yet. If Help can’t answer, it will try urgent support. You can also use Contact beside Class.
            </Text>
          </View>
        </Section>

        <Section title="iPhone: photo access is off">
          <View testID="support-photo-permissions" style={{ padding: 14, gap: 10 }}>
            <Text style={{ color: C.ink, fontSize: 15, lineHeight: 22 }}>
              “Allow access for ClassScribe in Settings” means your iPhone’s Settings app, not the Account screen inside ClassScribe.
            </Text>
            <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>
              {'1. Tap OK on the message, then open your iPhone’s Settings app.\n2. Go to Apps → ClassScribe → Photos.\n3. Choose Limited Access and select your schedule screenshot, or choose Full Access.\n4. Return to ClassScribe and tap Screenshot again.'}
            </Text>
            <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>
              On older iOS versions, ClassScribe appears directly in the main Settings list. If camera access is off, open the same ClassScribe settings and turn on Camera instead.
            </Text>
          </View>
        </Section>

        <View accessibilityLiveRegion="polite">
          {messages.map((message, index) => (
            <View
              key={`${index}-${message.role}`}
              style={{
                alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
                marginHorizontal: 16,
                marginTop: 12,
                padding: 13,
                borderRadius: 14,
                backgroundColor: message.role === 'user' ? C.accentSoft : C.cell,
              }}
            >
              <Text style={{ color: C.ink, fontSize: 15, lineHeight: 22 }}>{message.content}</Text>
            </View>
          ))}
        </View>

        <View style={{ marginHorizontal: 16, marginTop: 18, gap: 10 }}>
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder="How can we help?"
            placeholderTextColor={C.faint}
            multiline
            maxLength={1500}
            editable={!busy}
            accessibilityLabel="Support question"
            testID="support-question"
            style={[s.input, { minHeight: 96, maxHeight: 180, textAlignVertical: 'top' }]}
          />
          <Text style={{ color: C.sec, fontSize: 12, textAlign: 'right' }}>{question.length}/1500</Text>
          <Btn
            title="Send question"
            icon="arrow-up"
            onPress={() => sendQuestion()}
            busy={busy}
            disabled={!question.trim()}
            testID="support-send"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}