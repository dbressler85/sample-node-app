import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, StatusBar, ActivityIndicator, SafeAreaView, Platform } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import useAndroidBack from './src/useAndroidBack';
import { api, setAuthLostHandler } from './src/api';
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
import WaiverWizardScreen from './src/screens/WaiverWizardScreen';
import TradesScreen from './src/screens/TradesScreen';
import TradeInboxScreen from './src/screens/TradeInboxScreen';
import DraftScreen from './src/screens/DraftScreen';
import DraftHubScreen from './src/screens/DraftHubScreen';
import OnDeckScreen from './src/screens/OnDeckScreen';
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
  const [demoMode, setDemoMode] = useState(false);
  const [tab, setTab] = useState('home');
  // Overlays form a stack so back returns to the previous screen (e.g. Trades or
  // Draft opened from a roster returns to that roster, not Home).
  const [overlayStack, setOverlayStack] = useState([]);
  const [waiversTarget, setWaiversTarget] = useState(null); // {leagueId, position}

  const overlay = overlayStack[overlayStack.length - 1] || null;
  const pushOverlay = (o) => setOverlayStack((s) => [...s, o]);
  const popOverlay = () => setOverlayStack((s) => s.slice(0, -1));

  useEffect(() => {
    (async () => {
      const token = await loadSession();
      setAuthed(!!token);
      if (token) api.health().then((h) => setDemoMode(!!h.demoMode)).catch(() => {});
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
      setOverlayStack([]);
      setWaiversTarget(null);
    });
  }, []);

  // Android hardware back / edge-swipe: close an overlay, else return to Home,
  // else let the OS exit. (Screens with open sheets consume back first.)
  useAndroidBack(
    useCallback(() => {
      if (!authed) return false;
      if (overlay) {
        popOverlay();
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
    setOverlayStack([]);
  }

  const openRoster = (league) => pushOverlay({ type: 'roster', league });
  const openLineup = (league) => pushOverlay({ type: 'lineupEditor', league });
  const openWizard = (leagues, mode) => pushOverlay({ type: 'lineupWizard', leagues, mode });
  const openWaiverWizard = (leagues) => pushOverlay({ type: 'waiverWizard', leagues });
  const openTrades = (league) => pushOverlay({ type: 'trades', league });
  const openTradeInbox = () => pushOverlay({ type: 'tradeInbox' });
  const openDraft = (league) => pushOverlay({ type: 'draft', league });
  const openDraftHub = () => pushOverlay({ type: 'draftHub' });
  const openOnDeck = () => pushOverlay({ type: 'onDeck' });
  const openPlayer = (playerId) => pushOverlay({ type: 'playerProfile', playerId });
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
            onStartWizard={openWaiverWizard}
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
            demoMode={demoMode}
            onOpenLineup={openLineup}
            onOpenLeague={openRoster}
            onOpenWaivers={(league) => openWaivers({ leagueId: league.leagueId, position: league.position })}
            onOpenTrades={openTrades}
            onOpenTradeInbox={openTradeInbox}
            onOpenDraft={openDraft}
            onOpenDraftHub={openDraftHub}
            onOpenOnDeck={openOnDeck}
            onOpenPlayer={openPlayer}
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
    if (!authed) {
      return (
        <LoginScreen
          onLoggedIn={(info) => {
            if (info && typeof info.demoMode === 'boolean') setDemoMode(info.demoMode);
            setAuthed(true);
          }}
        />
      );
    }

    if (overlay && overlay.type === 'roster') {
      return <RosterScreen league={overlay.league} onBack={popOverlay} onOpenTrades={openTrades} onOpenDraft={openDraft} />;
    }
    if (overlay && overlay.type === 'lineupEditor') {
      return <LineupEditorScreen league={overlay.league} onBack={popOverlay} />;
    }
    if (overlay && overlay.type === 'lineupWizard') {
      return (
        <LineupWizardScreen leagues={overlay.leagues} initialMode={overlay.mode} onBack={popOverlay} />
      );
    }
    if (overlay && overlay.type === 'waiverWizard') {
      return <WaiverWizardScreen leagues={overlay.leagues} onBack={popOverlay} />;
    }
    if (overlay && overlay.type === 'trades') {
      return <TradesScreen league={overlay.league} onBack={popOverlay} />;
    }
    if (overlay && overlay.type === 'tradeInbox') {
      return <TradeInboxScreen onBack={popOverlay} onOpenLeague={openTrades} />;
    }
    if (overlay && overlay.type === 'draft') {
      return <DraftScreen league={overlay.league} onBack={popOverlay} />;
    }
    if (overlay && overlay.type === 'draftHub') {
      return <DraftHubScreen onBack={popOverlay} onOpenDraft={openDraft} />;
    }
    if (overlay && overlay.type === 'onDeck') {
      return (
        <OnDeckScreen
          onBack={popOverlay}
          onOpenLineup={openLineup}
          onOpenDraft={openDraft}
          onOpenWaivers={(league) => openWaivers({ leagueId: league.leagueId })}
        />
      );
    }
    if (overlay && overlay.type === 'playerProfile') {
      return <PlayerProfileScreen playerId={overlay.playerId} onBack={popOverlay} />;
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
