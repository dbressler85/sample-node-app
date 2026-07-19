import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, StatusBar, ActivityIndicator, SafeAreaView, Platform } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import useAndroidBack from './src/useAndroidBack';
import { setAuthLostHandler } from './src/api';
import { clearAll as clearCache } from './src/cache';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import ScoresScreen from './src/screens/ScoresScreen';
import WaiversScreen from './src/screens/WaiversScreen';
import PlayersScreen from './src/screens/PlayersScreen';
import PlayerProfileScreen from './src/screens/PlayerProfileScreen';
import RosterScreen from './src/screens/RosterScreen';
import LineupsScreen from './src/screens/LineupsScreen';
import LineupEditorScreen from './src/screens/LineupEditorScreen';
import LineupWizardScreen from './src/screens/LineupWizardScreen';
import TradesScreen from './src/screens/TradesScreen';
import { loadSession, clearSession } from './src/auth';
import { colors } from './src/theme';

const TABS = [
  { key: 'home', label: 'Home', icon: '⌂' },
  { key: 'scores', label: 'Scores', icon: '◉' },
  { key: 'waivers', label: 'Waivers', icon: '⇄' },
  { key: 'players', label: 'Players', icon: '◐' },
  { key: 'lineups', label: 'Lineups', icon: '⚑' },
];

export default function App() {
  const [booting, setBooting] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState('home');
  const [overlay, setOverlay] = useState(null); // {type,league} | null
  const [waiversTarget, setWaiversTarget] = useState(null); // {leagueId, position}

  useEffect(() => {
    (async () => {
      const token = await loadSession();
      setAuthed(!!token);
      setBooting(false);
    })();
  }, []);

  // If a request finds the session dead or the backend unreachable, drop to login.
  useEffect(() => {
    setAuthLostHandler(async () => {
      await clearSession();
      await clearCache();
      setAuthed(false);
      setTab('home');
      setOverlay(null);
      setWaiversTarget(null);
    });
  }, []);

  // Android hardware back / edge-swipe: close an overlay, else return to Home,
  // else let the OS exit. (Screens with open sheets consume back first.)
  useAndroidBack(
    useCallback(() => {
      if (!authed) return false;
      if (overlay) {
        setOverlay(null);
        return true;
      }
      if (tab !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    }, [authed, overlay, tab])
  );

  async function handleLogout() {
    await clearSession();
    await clearCache();
    setAuthed(false);
    setTab('home');
    setOverlay(null);
  }

  const openRoster = (league) => setOverlay({ type: 'roster', league });
  const openLineup = (league) => setOverlay({ type: 'lineupEditor', league });
  const openWizard = (leagues, mode) => setOverlay({ type: 'lineupWizard', leagues, mode });
  const openTrades = (league) => setOverlay({ type: 'trades', league });
  const openPlayer = (playerId) => setOverlay({ type: 'playerProfile', playerId });
  const openWaivers = (target) => {
    setWaiversTarget(target || null);
    setTab('waivers');
  };

  function renderTab() {
    switch (tab) {
      case 'scores':
        return <ScoresScreen />;
      case 'waivers':
        return (
          <WaiversScreen
            key={`w-${waiversTarget ? waiversTarget.leagueId : 'all'}`}
            initialLeagueId={waiversTarget ? waiversTarget.leagueId : null}
            initialPosition={waiversTarget ? waiversTarget.position : null}
          />
        );
      case 'players':
        return <PlayersScreen onOpenPlayer={openPlayer} />;
      case 'lineups':
        return <LineupsScreen onOpenLineup={openLineup} onStartWizard={openWizard} />;
      case 'home':
      default:
        return (
          <HomeScreen
            onOpenLineup={openLineup}
            onOpenLeague={openRoster}
            onOpenWaivers={(league) => openWaivers({ leagueId: league.leagueId, position: league.position })}
            onOpenTrades={openTrades}
            onLogout={handleLogout}
          />
        );
    }
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
      return <RosterScreen league={overlay.league} onBack={() => setOverlay(null)} onOpenTrades={openTrades} />;
    }
    if (overlay && overlay.type === 'lineupEditor') {
      return <LineupEditorScreen league={overlay.league} onBack={() => setOverlay(null)} />;
    }
    if (overlay && overlay.type === 'lineupWizard') {
      return (
        <LineupWizardScreen leagues={overlay.leagues} initialMode={overlay.mode} onBack={() => setOverlay(null)} />
      );
    }
    if (overlay && overlay.type === 'trades') {
      return <TradesScreen league={overlay.league} onBack={() => setOverlay(null)} />;
    }
    if (overlay && overlay.type === 'playerProfile') {
      return <PlayerProfileScreen playerId={overlay.playerId} onBack={() => setOverlay(null)} />;
    }

    return (
      <View style={styles.flex}>
        <View style={styles.flex}>{renderTab()}</View>
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
      {TABS.map((t) => {
        const active = tab === t.key;
        return (
          <Pressable key={t.key} style={styles.tab} onPress={() => onChange(t.key)} hitSlop={6}>
            <Text style={[styles.tabIcon, { color: active ? colors.accent : colors.textDim }]}>{t.icon}</Text>
            <Text style={[styles.tabLabel, { color: active ? colors.accent : colors.textDim }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
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
  tabLabel: { fontSize: 10, fontWeight: '700' },
});
