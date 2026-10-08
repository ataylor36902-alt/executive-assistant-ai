import React, { useEffect, useId, useState } from 'react';
import { ActivityIndicator, InputAccessoryView, Keyboard, Platform, Pressable, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth, useClerk, useSignIn, useSignUp, useSSO, useUser } from '@clerk/expo';
import { useSignInWithApple } from '@clerk/expo/apple';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { KeyboardAwareScrollViewCompat } from './KeyboardAwareScrollViewCompat';
import { Btn, s } from './ui';
import { C } from '../lib/theme';
import { clerkPublishableKey } from '../lib/clerk-config';
import { canContinueFromSignIn } from '../lib/required-auth';
import {
  APPLE_UNAVAILABLE_COPY,
  appleErrorMessage,
  appleStrategyAvailability,
  appleUnavailableMessage,
  appleSignInMode,
  isAppleStrategyUnavailableError,
  shouldUseMobileOAuthRedirect,
} from '../lib/apple-auth';
import { sendPasswordResetCode, verifyPasswordResetCode, savePasswordReset, resendPasswordResetCode } from '../lib/password-reset';
import { ageBandFromBirthMonthYear } from '../lib/age-band';

WebBrowser.maybeCompleteAuthSession();

function errorText(error) {
  const detail = error?.errors?.[0] || error?.error?.errors?.[0];
  return detail?.longMessage || detail?.message || error?.message || 'Sign-in could not be completed. Please try again.';
}

function LinkButton({ title, onPress, align = 'center' }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ alignSelf: align === 'right' ? 'flex-end' : 'center', padding: 6 }}>
      <Text style={{ color: C.accent, fontSize: 15, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

function AuthTextInput({ accessoryID, onSubmitEditing, ...props }) {
  return (
    <TextInput
      {...props}
      {...(Platform.OS === 'ios' ? { inputAccessoryViewID: accessoryID } : {})}
      returnKeyType="done"
      blurOnSubmit
      onSubmitEditing={(event) => {
        Keyboard.dismiss();
        onSubmitEditing?.(event);
      }}
    />
  );
}

function SignInContent({ onContinue, continueLabel, signedOutContinueLabel, required, recoverOnly, notice }) {
  const { user, isSignedIn } = useUser();
  const clerk = useClerk();
  const { signOut } = clerk;
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startSSOFlow } = useSSO();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const [mode, setMode] = useState(required && !recoverOnly ? 'signup' : 'choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetNotice, setResetNotice] = useState('');
  const [resetCodeReady, setResetCodeReady] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [taskBlocked, setTaskBlocked] = useState(false);
  const [birthMonth, setBirthMonth] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [ageBand, setAgeBand] = useState('');
  const [socialAgeStrategy, setSocialAgeStrategy] = useState('');
  const accessoryID = `auth-keyboard-done-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  const appleEnabled = appleStrategyAvailability(clerk.__internal_environment?.userSettings?.socialProviderStrategies);
  const birthEntryReady = ageBandFromBirthMonthYear(birthMonth, birthYear) !== 'invalid' && /^\d{4}$/.test(birthYear);

  function changeBirthMonth(value) {
    setBirthMonth(value);
    // Wait for two month digits so entering "12" is not interrupted at "1".
    if (Platform.OS !== 'web' && /^\d{2}$/.test(value) && /^\d{4}$/.test(birthYear) && ageBandFromBirthMonthYear(value, birthYear) !== 'invalid') {
      Keyboard.dismiss();
    }
  }

  function changeBirthYear(value) {
    setBirthYear(value);
    if (Platform.OS !== 'web' && /^\d{4}$/.test(value) && ageBandFromBirthMonthYear(birthMonth, value) !== 'invalid') {
      Keyboard.dismiss();
    }
  }

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);

  useEffect(() => {
    Keyboard.dismiss();
  }, [mode]);

  function changeMode(next) {
    Keyboard.dismiss();
    setError('');
    setResetNotice('');
    if (next !== 'signup' && next !== 'social-age') {
      setBirthMonth('');
      setBirthYear('');
      setAgeBand('');
    }
    setMode(next);
  }

  function requestSocialAge(strategy) {
    if (busy) return;
    setSocialAgeStrategy(strategy);
    setBirthMonth('');
    setBirthYear('');
    setAgeBand('');
    setError('');
    setMode('social-age');
  }

  async function requireSignupAge() {
    const band = ageBandFromBirthMonthYear(birthMonth, birthYear);
    if (band === 'invalid') {
      setError('Enter your birth month and year before creating an account.');
      return '';
    }
    if (band === 'under13') {
      setError('You must be at least 13 to create a ClassScribe account. No account or library was created.');
      return '';
    }
    setAgeBand(band);
    // Save only the minimum age band; the month/year values remain in component state.
    await AsyncStorage.setItem('cs_privacy_ageband_pending', band);
    return band;
  }

  function openReset() {
    if (busy) return;
    setPassword('');
    setCode('');
    setResetCodeReady(false);
    changeMode('reset-email');
  }

  const finish = ({ session }) => {
    if (session?.currentTask) {
      setTaskBlocked(true);
      setError(required
        ? 'Your account needs another setup step. Sign out here, finish that step in a web browser, then try again.'
        : 'Your account needs another setup step. Sign out here, finish that step in a web browser, then try again. Your library remains available with its sync code.');
      return;
    }
    setTaskBlocked(false);
    setError('');
    setPassword('');
    setNewPassword('');
    setCode('');
    onContinue({ fromAuth: true });
  };

  async function completeSignIn() {
    const result = await signIn.finalize({ navigate: finish });
    if (result?.error) throw result.error;
  }

  async function completeSignUp() {
    const result = await signUp.finalize({ navigate: finish });
    if (result?.error) throw result.error;
  }

  async function startReset() {
    Keyboard.dismiss();
    if (!email.trim()) {
      setError('Enter your email address to receive a reset code.');
      return;
    }
    setBusy('reset-send');
    setError('');
    setResetNotice('');
    setPassword('');
    setNewPassword('');
    setCode('');
    setResetCodeReady(false);
    // Show the code entry step before waiting for the network. Email delivery
    // can precede completion of the SDK request on a slow mobile connection.
    setMode('reset-code');
    try {
      await sendPasswordResetCode(signIn, email.trim());
      setResetCodeReady(true);
      setTaskBlocked(false);
      setResetNotice('A reset code was sent. Check your email.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  async function verifyResetCode() {
    if (busy || !resetCodeReady) return;
    Keyboard.dismiss();
    if (!code.trim()) {
      setError('Enter the reset code sent to your email.');
      return;
    }
    setBusy('reset-verify');
    setError('');
    setResetNotice('');
    try {
      await verifyPasswordResetCode(signIn, code.trim());
      setMode('reset-password');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  async function submitResetPassword() {
    Keyboard.dismiss();
    if (!newPassword) {
      setError('Enter a new password.');
      return;
    }
    setBusy('reset-password');
    setError('');
    try {
      const status = await savePasswordReset(signIn, newPassword);
      setNewPassword('');
      setCode('');
      if (status === 'complete') {
        await completeSignIn();
      } else if (status === 'needs_second_factor' || status === 'needs_client_trust') {
        if (!signIn.supportedSecondFactors?.some((factor) => factor.strategy === 'email_code')) {
          setTaskBlocked(true);
          setMode('signin');
          setError('Your password was changed, but this account needs another verification method to sign in. Return to sign-in and use your new password.');
          return;
        }
        setTaskBlocked(true);
        setMode('mfa');
        const sent = await signIn.mfa.sendEmailCode();
        if (sent?.error) throw sent.error;
        setResetNotice('Password changed. Enter the additional sign-in code sent to your email.');
      } else {
        setTaskBlocked(true);
        setMode('signin');
        setError(`Your password was changed, but sign-in needs another step (${signIn.status || 'incomplete'}). Return to sign-in and use your new password.`);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  async function resendResetCode() {
    setBusy('reset-resend');
    setError('');
    setResetNotice('');
    try {
      await resendPasswordResetCode(signIn);
      setCode('');
      setResetNotice('A new reset code was sent. Check your email.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  async function cancelReset() {
    if (busy) return;
    const cleared = await signIn.reset();
    setCode('');
    setResetCodeReady(false);
    setNewPassword('');
    setPassword('');
    setTaskBlocked(false);
    changeMode('signin');
    if (cleared?.error) setError(errorText(cleared.error));
  }

  async function social(strategy, approvedAgeBand = '') {
    const newAccountAgeBand = approvedAgeBand || (mode === 'signup' ? await requireSignupAge() : '');
    if ((mode === 'signup' || mode === 'social-age') && !newAccountAgeBand) return;
    setBusy(strategy);
    setError('');
    try {
      if (strategy === 'oauth_apple' && appleEnabled === false) {
        setError(appleUnavailableMessage(null, errorText));
        return;
      }
      if (strategy === 'oauth_apple' && appleSignInMode(Platform.OS, isExpoGo) === 'native') {
        const { createdSessionId, setActive, signIn: attempt, signUp: registration } = await startAppleAuthenticationFlow(
          newAccountAgeBand ? { unsafeMetadata: { ageBand: newAccountAgeBand } } : undefined,
        );
        if (!createdSessionId || !setActive) {
          const status = attempt?.status || registration?.status;
          setTaskBlocked(!!status);
          setError(status
            ? `Additional verification is needed (${status}). No library was changed. Finish setup in a browser, then try again.`
            : 'Apple did not complete sign-in. No account or library was changed. Try Apple again or use email instead.');
          return;
        }
        setTaskBlocked(false);
        const activated = await setActive({ session: createdSessionId, navigate: finish });
        if (activated?.error) throw activated.error;
        return;
      }
      const { createdSessionId, setActive, signIn: attempt, signUp: registration } = await startSSOFlow({
        strategy,
        ...(newAccountAgeBand ? { unsafeMetadata: { ageBand: newAccountAgeBand } } : {}),
        redirectUrl: shouldUseMobileOAuthRedirect(Platform.OS, strategy, isExpoGo)
          ? AuthSession.makeRedirectUri({ scheme: 'classscribe-mobile' })
          : undefined,
      });
      if (!createdSessionId || !setActive) {
        const status = attempt?.status || registration?.status;
        setTaskBlocked(!!status);
        setError(status
          ? `Additional verification is needed (${status}). No library was changed. Reset account sign-in and try another method, or finish setup in a browser.`
          : 'Sign-in was not completed. No library was changed. Try Apple or Google again, or use email instead.');
        return;
      }
      setTaskBlocked(false);
      const activated = await setActive({ session: createdSessionId, navigate: finish });
      if (activated?.error) throw activated.error;
    } catch (e) {
      setTaskBlocked(false);
      const message = strategy === 'oauth_apple'
        ? appleEnabled === false || isAppleStrategyUnavailableError(e)
          ? appleUnavailableMessage(e, errorText)
          : appleErrorMessage(e, errorText)
        : errorText(e);
      setError(`${message} Try again or use email instead.`);
    } finally {
      setBusy('');
    }
  }

  async function emailSubmit() {
    Keyboard.dismiss();
    if (!email.trim() || !password) {
      setError('Enter your email address and password.');
      return;
    }
    const newAccountAgeBand = mode === 'signup' ? await requireSignupAge() : '';
    if (mode === 'signup' && !newAccountAgeBand) return;
    setBusy('email');
    setError('');
    try {
      if (mode === 'signup') {
        const result = await signUp.password({
          emailAddress: email.trim(),
          password,
          unsafeMetadata: { ageBand: newAccountAgeBand },
        });
        if (result?.error) throw result.error;
        if (signUp.status === 'complete') {
          await completeSignUp();
        } else {
          const sent = await signUp.verifications.sendEmailCode();
          if (sent?.error) throw sent.error;
          setTaskBlocked(true);
          changeMode('verify');
        }
      } else {
        const result = await signIn.password({ emailAddress: email.trim(), password });
        if (result?.error) throw result.error;
        if (signIn.status === 'complete') {
          await completeSignIn();
        } else if (signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') {
          if (!signIn.supportedSecondFactors?.some((factor) => factor.strategy === 'email_code')) {
            setTaskBlocked(true);
            setError('This account needs another verification method that is not available in the app.');
            return;
          }
          const sent = await signIn.mfa.sendEmailCode();
          if (sent?.error) throw sent.error;
          setTaskBlocked(true);
          changeMode('mfa');
        } else {
          setTaskBlocked(true);
          setError(`Sign-in needs another step (${signIn.status || 'incomplete'}). No library was changed.`);
        }
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  async function continueSocialAfterAgeCheck() {
    const band = await requireSignupAge();
    if (!band || !socialAgeStrategy) return;
    await social(socialAgeStrategy, band);
  }

  async function verify() {
    Keyboard.dismiss();
    if (!code.trim()) {
      setError('Enter the code sent to your email.');
      return;
    }
    setBusy('verify');
    setError('');
    try {
      if (mode === 'mfa') {
        const result = await signIn.mfa.verifyEmailCode({ code: code.trim() });
        if (result?.error) throw result.error;
        if (signIn.status === 'complete') await completeSignIn();
        else setError('Verification is not complete. Check the code and try again.');
      } else {
        const result = await signUp.verifications.verifyEmailCode({ code: code.trim() });
        if (result?.error) throw result.error;
        if (signUp.status === 'complete') await completeSignUp();
        else setError('Account setup needs another step. Complete it on the web before signing in here.');
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  async function resend() {
    setBusy('resend');
    setError('');
    try {
      const result = mode === 'mfa' ? await signIn.mfa.sendEmailCode() : await signUp.verifications.sendEmailCode();
      if (result?.error) throw result.error;
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  async function leaveAccount() {
    Keyboard.dismiss();
    setBusy('signout');
    setError('');
    try {
      await signOut();
      setTaskBlocked(false);
      changeMode(required && !recoverOnly ? 'signup' : 'choose');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <View style={{ gap: 12 }}>
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={accessoryID}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 18, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.cell, borderTopWidth: 1, borderTopColor: C.line }}>
            {!isSignedIn && (mode === 'social-age' || mode === 'signup') ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={mode === 'social-age' ? 'Continue after age check' : 'Submit account details'}
                accessibilityState={{ disabled: !!busy || !birthEntryReady }}
                testID="birthdate-keyboard-submit"
                disabled={!!busy || !birthEntryReady}
                onPress={() => {
                  if (busy || !birthEntryReady) return;
                  Keyboard.dismiss();
                  if (mode === 'social-age') return continueSocialAfterAgeCheck();
                  return emailSubmit();
                }}
                style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', opacity: busy || !birthEntryReady ? 0.45 : 1 }}
              >
                <Text style={{ color: C.accent, fontSize: 16, fontWeight: '700' }}>{mode === 'social-age' ? 'Continue' : 'Submit'}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={() => Keyboard.dismiss()} hitSlop={8}>
              <Text style={{ color: C.accent, fontSize: 16, fontWeight: '600' }}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
      {isSignedIn ? (
        <View style={{ backgroundColor: C.cell, borderRadius: 14, padding: 16, gap: 10 }}>
          <Text style={{ color: C.ink, fontSize: 17, fontWeight: '700' }}>Signed in to your account</Text>
          <Text style={{ color: C.sec, fontSize: 14 }}>{user?.primaryEmailAddress?.emailAddress || user?.fullName || 'ClassScribe account'}</Text>
          <Text style={{ color: C.sec, fontSize: 14 }}>{required && !recoverOnly ? 'Continue to set up your ClassScribe library.' : 'Your private sync code also opens your library. Signing out here will not remove it.'}</Text>
          <Btn title="Sign out of account" kind="secondary" small busy={busy === 'signout'} onPress={leaveAccount} />
        </View>
      ) : mode === 'social-age' ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: C.ink, fontSize: 22, fontWeight: '700' }}>Age check before social sign-in</Text>
          <Text style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>Apple or Google could create a new account. Enter your birth month and year first; ClassScribe saves only your age range, never your date of birth.</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <AuthTextInput accessoryID={accessoryID} value={birthMonth} onChangeText={changeBirthMonth} keyboardType="number-pad" maxLength={2} placeholder="Birth month (1–12)" placeholderTextColor={C.faint} style={[s.input, { flex: 1 }]} accessibilityLabel="Birth month" />
            <AuthTextInput accessoryID={accessoryID} value={birthYear} onChangeText={changeBirthYear} keyboardType="number-pad" maxLength={4} placeholder="Birth year" placeholderTextColor={C.faint} style={[s.input, { flex: 1 }]} accessibilityLabel="Birth year" />
          </View>
          {ageBand === '13-17' ? <Text style={{ color: C.sec, fontSize: 13 }}>High school privacy defaults apply: class sharing stays off and public profiles are not enabled.</Text> : null}
          <Btn title={`Continue with ${socialAgeStrategy === 'oauth_apple' ? 'Apple' : 'Google'}`} kind={socialAgeStrategy === 'oauth_apple' ? 'dark' : 'secondary'} icon={socialAgeStrategy === 'oauth_apple' ? 'logo-apple' : 'logo-google'} busy={!!busy} disabled={!!busy} onPress={continueSocialAfterAgeCheck} />
          <LinkButton title="Back to sign in options" onPress={() => changeMode('choose')} />
        </View>
      ) : mode === 'choose' ? (
        <>
          <Text style={{ color: C.ink, fontSize: 22, fontWeight: '700' }}>Sign in</Text>
          {appleEnabled === false && Platform.OS !== 'ios'
            ? <Text accessibilityLiveRegion="polite" style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>{APPLE_UNAVAILABLE_COPY}</Text>
            : <Btn title="Continue with Apple" kind="dark" icon="logo-apple" busy={busy === 'oauth_apple'} disabled={!!busy} onPress={() => requestSocialAge('oauth_apple')} testID="apple-sign-in" />}
          {Platform.OS === 'ios' && isExpoGo ? <Text accessibilityLiveRegion="polite" style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>Native Apple sign-in requires an installed iOS build. Expo Go uses Clerk’s secure browser sign-in instead.</Text> : null}
          <Btn title="Continue with Google" kind="secondary" icon="logo-google" busy={busy === 'oauth_google'} disabled={!!busy} onPress={() => requestSocialAge('oauth_google')} />
           <Btn title={required && !recoverOnly ? 'Continue with email' : 'Use email and password'} kind="secondary" icon="mail-outline" onPress={() => changeMode('signin')} />
           <LinkButton title="Forgot password?" onPress={openReset} />
          {!recoverOnly ? <LinkButton title="New here? Create an account" onPress={() => changeMode('signup')} /> : null}
        </>
      ) : mode === 'signin' || mode === 'signup' ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: C.ink, fontSize: 22, fontWeight: '700' }}>{mode === 'signin' ? 'Sign in with email' : 'Create an account'}</Text>
          {mode === 'signup' ? <>
            <Text style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>Enter your birth month and year. ClassScribe saves only your age range, not your date of birth.</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <AuthTextInput accessoryID={accessoryID} value={birthMonth} onChangeText={changeBirthMonth} keyboardType="number-pad" maxLength={2} placeholder="Birth month (1–12)" placeholderTextColor={C.faint} style={[s.input, { flex: 1 }]} accessibilityLabel="Birth month" />
              <AuthTextInput accessoryID={accessoryID} value={birthYear} onChangeText={changeBirthYear} keyboardType="number-pad" maxLength={4} placeholder="Birth year" placeholderTextColor={C.faint} style={[s.input, { flex: 1 }]} accessibilityLabel="Birth year" />
            </View>
            {ageBand === '13-17' ? <Text style={{ color: C.sec, fontSize: 13 }}>High school privacy defaults will apply. Class sharing stays off and public profiles are not enabled.</Text> : null}
            <Btn title="Continue with Apple" kind="dark" icon="logo-apple" busy={busy === 'oauth_apple'} disabled={!!busy} onPress={() => social('oauth_apple')} />
            <Btn title="Continue with Google" kind="secondary" icon="logo-google" busy={busy === 'oauth_google'} disabled={!!busy} onPress={() => social('oauth_google')} />
          </> : null}
          <Text style={s.label}>Email address</Text>
           <AuthTextInput accessoryID={accessoryID} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" placeholder="you@school.edu" placeholderTextColor={C.faint} style={s.input} />
          <Text style={s.label}>Password</Text>
           <View style={{ position: 'relative', justifyContent: 'center' }}>
              <AuthTextInput
                accessoryID={accessoryID}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                secureTextEntry={!showPassword}
                autoComplete={mode === 'signup' ? 'off' : 'current-password'}
                textContentType={mode === 'signup' ? 'none' : 'password'}
                placeholder={mode === 'signup' ? 'Choose your password' : 'Password'}
                placeholderTextColor={C.faint}
                style={[s.input, { paddingRight: 50 }]}
              />
             <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={() => setShowPassword((visible) => !visible)} style={{ position: 'absolute', right: 4, padding: 12 }}>
               <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={C.sec} />
             </Pressable>
           </View>
           {mode === 'signin' ? <LinkButton title="Forgot password?" align="right" onPress={openReset} /> : <LinkButton title="Forgot your password? Reset it" align="right" onPress={openReset} />}
          <Btn title={mode === 'signin' ? 'Sign in' : 'Create account'} busy={busy === 'email'} disabled={!!busy} onPress={emailSubmit} />
           {!recoverOnly ? <LinkButton title={mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'} onPress={() => changeMode(mode === 'signin' ? 'signup' : 'signin')} /> : null}
          {mode === 'signin' ? <LinkButton title="Other sign-in options" onPress={() => changeMode('choose')} /> : null}
          {mode === 'signup' ? <View nativeID="clerk-captcha" /> : null}
        </View>
      ) : mode === 'reset-email' ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: C.ink, fontSize: 22, fontWeight: '700' }}>Reset your password</Text>
          <Text style={{ color: C.sec, fontSize: 14 }}>Enter your account email address and we’ll send you a reset code.</Text>
          <Text style={s.label}>Email address</Text>
           <AuthTextInput accessoryID={accessoryID} testID="reset-email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" placeholder="you@school.edu" placeholderTextColor={C.faint} style={s.input} />
          <Btn title="Send reset code" busy={busy === 'reset-send'} disabled={!!busy} onPress={startReset} />
          <LinkButton title="Back to sign in" onPress={() => { if (!busy) changeMode('signin'); }} />
        </View>
      ) : mode === 'reset-code' ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: C.ink, fontSize: 22, fontWeight: '700' }}>Check your email</Text>
          <Text style={{ color: C.sec, fontSize: 14 }}>Enter the password reset code from your email for {email.trim()}.</Text>
          <Text style={s.label}>Password reset code</Text>
          <AuthTextInput accessoryID={accessoryID} testID="reset-code" accessibilityLabel="Password reset code" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" autoCapitalize="none" autoCorrect={false} placeholder="Reset code" placeholderTextColor={C.faint} style={[s.input, { minHeight: 52, borderWidth: 1, borderColor: C.sep }]} />
          {busy === 'reset-send' ? <Text accessibilityLiveRegion="polite" style={{ color: C.sec, fontSize: 14 }}>Requesting your code… You can enter it here when it arrives. Verification becomes available when the request completes.</Text> : null}
          <Btn title="Verify reset code" busy={busy === 'reset-verify'} disabled={!!busy || !resetCodeReady} onPress={verifyResetCode} />
          <LinkButton title={busy === 'reset-resend' || busy === 'reset-send' ? 'Sending…' : resetCodeReady ? 'Send a new code' : 'Retry sending reset code'} onPress={() => { if (!busy) void (resetCodeReady ? resendResetCode() : startReset()); }} />
           <LinkButton title="Back to sign in" onPress={cancelReset} />
        </View>
      ) : mode === 'reset-password' ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: C.ink, fontSize: 22, fontWeight: '700' }}>Set a new password</Text>
          <Text style={{ color: C.sec, fontSize: 14 }}>Your email is verified. Choose a new password for your account.</Text>
          <Text style={s.label}>New password</Text>
           <View style={{ position: 'relative', justifyContent: 'center' }}>
              <AuthTextInput
                accessoryID={accessoryID}
                testID="reset-new-password"
                value={newPassword}
                onChangeText={setNewPassword}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                secureTextEntry={!showNewPassword}
                autoComplete="off"
                textContentType="none"
                placeholder="Choose your password"
                placeholderTextColor={C.faint}
                style={[s.input, { paddingRight: 50 }]}
              />
             <Pressable accessibilityRole="button" accessibilityLabel={showNewPassword ? 'Hide new password' : 'Show new password'} onPress={() => setShowNewPassword((visible) => !visible)} style={{ position: 'absolute', right: 4, padding: 12 }}>
               <Ionicons name={showNewPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={C.sec} />
             </Pressable>
           </View>
          <Btn title="Save new password" busy={busy === 'reset-password'} disabled={!!busy} onPress={submitResetPassword} />
           <LinkButton title="Back to sign in" onPress={cancelReset} />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={{ color: C.ink, fontSize: 22, fontWeight: '700' }}>Check your email</Text>
          <Text style={{ color: C.sec, fontSize: 14 }}>Enter the verification code sent to {email}.</Text>
           <AuthTextInput accessoryID={accessoryID} value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" placeholder="Verification code" placeholderTextColor={C.faint} style={s.input} />
          <Btn title="Verify email" busy={busy === 'verify'} disabled={!!busy} onPress={verify} />
          <LinkButton title={busy === 'resend' ? 'Sending…' : 'Send a new code'} onPress={resend} />
          <LinkButton title="Start over" onPress={() => changeMode(required && !recoverOnly ? 'signup' : 'choose')} />
          {mode === 'verify' ? <View nativeID="clerk-captcha" /> : null}
        </View>
      )}
      {error ? <Text accessibilityLiveRegion="polite" style={{ color: C.rec, fontSize: 14, lineHeight: 20 }}>{error}</Text> : null}
      {resetNotice ? <Text accessibilityLiveRegion="polite" style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>{resetNotice}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={{ color: C.rec, fontSize: 14, lineHeight: 20 }}>{notice}</Text> : null}
      {taskBlocked && !['reset-email', 'reset-code', 'reset-password'].includes(mode) ? <Btn title="Reset account sign-in" kind="secondary" busy={busy === 'signout'} onPress={leaveAccount} /> : null}
      {canContinueFromSignIn({ required, isSignedIn, taskBlocked, verificationPending: ['verify', 'mfa', 'reset-email', 'reset-code', 'reset-password'].includes(mode) }) ? <Btn title={isSignedIn ? (continueLabel || 'Continue to library') : signedOutContinueLabel} kind="plain" onPress={() => { Keyboard.dismiss(); onContinue(); }} /> : null}
    </View>
  );
}

function ConfiguredSignIn(props) {
  const { isLoaded } = useAuth();
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (isLoaded) return;
    const timeout = setTimeout(() => setStalled(true), 10000);
    return () => clearTimeout(timeout);
  }, [isLoaded]);

  if (isLoaded) return <SignInContent {...props} />;
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      {!stalled ? <ActivityIndicator color={C.accent} /> : null}
      <Text accessibilityLiveRegion="polite" style={{ textAlign: 'center', color: stalled ? C.rec : C.sec, fontSize: 14, lineHeight: 20 }}>
        {stalled
          ? 'Account sign-in could not load. Check your connection and reopen ClassScribe. If this continues, contact support.'
          : 'Checking account sign-in…'}
      </Text>
    </View>
  );
}

export function OptionalSignIn({ onContinue, continueLabel = 'Return to library', signedOutContinueLabel = 'Return to library', hero, required = false, recoverOnly = false, notice = '' }) {
  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ flexGrow: 1, padding: 20, paddingBottom: 56, gap: 14 }}
      bottomOffset={120}
      keyboardShouldPersistTaps="handled"
      {...(Platform.OS !== 'web' ? { keyboardDismissMode: Platform.OS === 'ios' ? 'interactive' : 'on-drag' } : {})}
    >
      {hero}
      <Text style={{ textAlign: 'center', color: C.sec, fontSize: 14, lineHeight: 20 }}>
        {recoverOnly
          ? 'Sign in with the account you linked after creating your library. You can also use your private sync code instead.'
          : required
            ? 'Create or sign in to a ClassScribe account before setting up your library.'
            : 'Account sign-in is optional after you create a library. Your private sync code still opens it on another device.'}
      </Text>
      {!clerkPublishableKey ? (
        <>
          <Text style={{ color: C.rec, textAlign: 'center' }}>{required ? 'Account sign-in is unavailable on this build. Contact the app owner for help.' : 'Account sign-in is unavailable because this app has no Clerk publishable key.'}</Text>
          {!required ? <Btn title={signedOutContinueLabel} kind="plain" onPress={onContinue} /> : null}
        </>
      ) : (
        <ConfiguredSignIn
          onContinue={onContinue}
          continueLabel={continueLabel}
          signedOutContinueLabel={signedOutContinueLabel}
          required={required}
          recoverOnly={recoverOnly}
          notice={notice}
        />
      )}
    </KeyboardAwareScrollViewCompat>
  );
}