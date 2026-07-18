import React, { useEffect, useState } from 'react';
import { View, StyleSheet, StatusBar, ActivityIndicator, SafeAreaView, Platform } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import RosterScreen from './src/screens/RosterScreen';
import { loadSession, clearSession } from './src/auth';
import { colors } from './src/theme';

// Lightweight screen router held in state — no navigation library needed for
// this three-screen MVP. Screens: 'login' | 'dashboard' | 'roster'.
export default function App() {
  const [booting, setBooting] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [screen, setScreen] = useState('dashboard');
  const [activeLeague, setActiveLeague] = useState(null);

  useEffect(() => {
    (async () => {
      const token = await loadSession();
      setAuthed(!!token);
      setBooting(false);
    })();
  }, []);

  async function handleLogout() {
    await clearSession();
    setAuthed(false);
    setScreen('dashboard');
    setActiveLeague(null);
  }

  function openLeague(league) {
    setActiveLeague(league);
    setScreen('roster');
  }

  let body;
  if (booting) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  } else if (!authed) {
    body = <LoginScreen onLoggedIn={() => setAuthed(true)} />;
  } else if (screen === 'roster' && activeLeague) {
    body = <RosterScreen league={activeLeague} onBack={() => setScreen('dashboard')} />;
  } else {
    body = <DashboardScreen onOpenLeague={openLeague} onLogout={handleLogout} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ExpoStatusBar style="light" />
      {Platform.OS === 'android' ? <StatusBar backgroundColor={colors.bg} barStyle="light-content" /> : null}
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
