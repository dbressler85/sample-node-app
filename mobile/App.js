import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, StatusBar, ActivityIndicator, SafeAreaView, Platform } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import RosterScreen from './src/screens/RosterScreen';
import LineupsScreen from './src/screens/LineupsScreen';
import LineupEditorScreen from './src/screens/LineupEditorScreen';
import { loadSession, clearSession } from './src/auth';
import { colors } from './src/theme';

// Lightweight navigation held in state — two bottom tabs (Dashboard, Lineups)
// with full-screen overlays pushed on top (roster, lineup editor).
export default function App() {
  const [booting, setBooting] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState('dashboard'); // 'dashboard' | 'lineups'
  const [overlay, setOverlay] = useState(null); // {type,league} | null

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
    setTab('dashboard');
    setOverlay(null);
  }

  function render() {
    if (booting) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      );
    }
    if (!authed) return <LoginScreen onLoggedIn={() => setAuthed(true)} />;

    if (overlay && overlay.type === 'roster') {
      return <RosterScreen league={overlay.league} onBack={() => setOverlay(null)} />;
    }
    if (overlay && overlay.type === 'lineupEditor') {
      return <LineupEditorScreen league={overlay.league} onBack={() => setOverlay(null)} />;
    }

    return (
      <View style={styles.flex}>
        <View style={styles.flex}>
          {tab === 'dashboard' ? (
            <DashboardScreen
              onOpenLeague={(league) => setOverlay({ type: 'roster', league })}
              onLogout={handleLogout}
            />
          ) : (
            <LineupsScreen onOpenLineup={(league) => setOverlay({ type: 'lineupEditor', league })} />
          )}
        </View>
        <TabBar tab={tab} onChange={setTab} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ExpoStatusBar style="light" />
      {Platform.OS === 'android' ? <StatusBar backgroundColor={colors.bg} barStyle="light-content" /> : null}
      {render()}
    </SafeAreaView>
  );
}

function TabBar({ tab, onChange }) {
  return (
    <View style={styles.tabbar}>
      <Tab label="Dashboard" icon="▦" active={tab === 'dashboard'} onPress={() => onChange('dashboard')} />
      <Tab label="Lineups" icon="⚑" active={tab === 'lineups'} onPress={() => onChange('lineups')} />
    </View>
  );
}

function Tab({ label, icon, active, onPress }) {
  return (
    <Pressable style={styles.tab} onPress={onPress} hitSlop={8}>
      <Text style={[styles.tabIcon, { color: active ? colors.accent : colors.textDim }]}>{icon}</Text>
      <Text style={[styles.tabLabel, { color: active ? colors.accent : colors.textDim }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabbar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingBottom: Platform.OS === 'ios' ? 4 : 8,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center' },
  tabIcon: { fontSize: 18, marginBottom: 2 },
  tabLabel: { fontSize: 11, fontWeight: '700' },
});
