import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { api } from '../api';
import { saveSession } from '../auth';
import { colors } from '../theme';
import HubMark from '../components/HubMark';

export default function LoginScreen({ onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Ask the backend whether it's in demo mode, so the hint is honest in a live
  // deploy instead of always claiming any credentials work.
  const [demoMode, setDemoMode] = useState(null); // null = unknown yet

  useEffect(() => {
    api.health().then((h) => setDemoMode(!!h.demoMode)).catch(() => setDemoMode(null));
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { token, demoMode } = await api.login(username.trim(), password);
      await saveSession(token);
      onLoggedIn({ demoMode });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <View style={styles.lockup}>
          <HubMark size={72} />
        </View>
        <Text style={styles.brandTop}>DYNASTY</Text>
        <Text style={styles.brandMain}>Central</Text>
        <Text style={styles.tagline}>Your dynasty, one command.</Text>

        {demoMode ? (
          <View style={styles.demoPill}>
            <Text style={styles.demoPillText}>DEMO MODE</Text>
          </View>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="MFL username"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="MFL password"
          placeholderTextColor={colors.textDim}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }, busy && { opacity: 0.6 }]}
          onPress={submit}
          disabled={busy}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log in</Text>}
        </Pressable>

        <Text style={styles.hint}>
          {demoMode
            ? 'Demo mode — any username/password works. '
            : 'Enter your MyFantasyLeague username and password. '}
          Your credentials go only to your own backend, which logs into MFL on your behalf.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
  inner: { padding: 28 },
  lockup: { alignItems: 'center', marginBottom: 18 },
  brandTop: { color: colors.textDim, fontSize: 13, fontWeight: '700', letterSpacing: 5, textAlign: 'center', marginLeft: 5 },
  brandMain: { color: colors.text, fontSize: 40, fontWeight: '900', textAlign: 'center', letterSpacing: -1, marginTop: 2 },
  tagline: { color: colors.textDim, fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 32 },
  demoPill: { alignSelf: 'center', borderWidth: 1, borderColor: colors.gold, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 18 },
  demoPillText: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: colors.bad, marginBottom: 8 },
  hint: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
