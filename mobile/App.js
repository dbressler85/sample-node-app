import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, StatusBar, ActivityIndicator, SafeAreaView, Platform, Dimensions, Animated, Easing } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import useAndroidBack from './src/useAndroidBack';
import { api, setAuthLostHandler } from './src/api';
import { registerForPush, unregisterPush } from './src/push';
import { clearAll as clearCache } from './src/cache';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import LeaguesScreen from './src/screens/LeaguesScreen';
import PortfolioScreen from './src/screens/PortfolioScreen';
import SettingsScreen from './src/screens/SettingsScreen';
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
import OnTheBlockScreen from './src/screens/OnTheBlockScreen';
import DraftScreen from './src/screens/DraftScreen';
import DraftHubScreen from './src/screens/DraftHubScreen';
import OnDeckScreen from './src/screens/OnDeckScreen';
import { loadSession, clearSession } from './src/auth';
import { loadDisplayFont } from './src/typography';
import PressableScale from './src/components/PressableScale';
import FieldBackdrop from './src/components/FieldBackdrop';
import { colors } from './src/theme';

// On phones that draw edge-to-edge (the app content extends under the system navigation
// bar), the tab bar would otherwise sit beneath the gesture pill / nav buttons and be
// impossible to see or tap. We detect that case (screen height == window height on
// Android) and add clearance. When the OS already insets the window above its bars,
// screen != window and no extra padding is needed.
function androidNavClearance() {
  if (Platform.OS !== 'android') return 6;
  const win = Dimensions.get('window');
  const scr = Dimensions.get('screen');
  const edgeToEdge = Math.abs(scr.height - win.height) < 2;
  return edgeToEdge ? 26 : 8;
}

const TABS = [
  { key: 'home', label: 'Home', icon: '⌂' },
  { key: 'scores', label: 'Scores', icon: '◉' },
  { key: 'lineups', label: 'Lineups', icon: '⚑' },
  { key: 'waivers', label: 'Waivers', icon: '⇄' },
  { key: 'trades', label: 'Trades', icon: '⇌' },
  { key: 'players', label: 'Players', icon: '◐' },
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

  // Login → Home handoff: the login lockup flies up and fades, then the app flies in.
  // `enter` starts hidden and plays every time the app first shows the authed UI —
  // whether from a live login or a restored session on cold boot — so opening the app
  // always has the fly-in moment (not just right after typing a password).
  const enter = useRef(new Animated.Value(0)).current;
  const leave = useRef(new Animated.Value(0)).current;

  // Fly the authed app in whenever we transition into it (login OR restored session).
  useEffect(() => {
    if (authed && !booting) {
      enter.setValue(0);
      Animated.timing(enter, { toValue: 1, duration: 560, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [authed, booting, enter]);

  function handleLoggedIn(info) {
    if (info && typeof info.demoMode === 'boolean') setDemoMode(info.demoMode);
    // Fly the login lockup up and out, then swap to the app (the effect above flies it in).
    Animated.timing(leave, { toValue: 1, duration: 380, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      setAuthed(true);
      leave.setValue(0);
    });
  }

  const overlay = overlayStack[overlayStack.length - 1] || null;
  const pushOverlay = (o) => setOverlayStack((s) => [...s, o]);
  const popOverlay = () => setOverlayStack((s) => s.slice(0, -1));

  useEffect(() => {
    (async () => {
      // Load the display face and the session in parallel; the font load can't hang the
      // splash (it races an internal timeout) and never blocks past ~2s.
      const token = await loadSession();
      setAuthed(!!token);
      if (token) api.health().then((h) => setDemoMode(!!h.demoMode)).catch(() => {});
      await loadDisplayFont();
      setBooting(false);
    })();
  }, []);

  // Register this device for push once authenticated (after login and on a
  // restored session). Defensive: no-ops if push isn't available/granted.
  useEffect(() => {
    if (authed) registerForPush();
  }, [authed]);

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
    await unregisterPush(); // stop notifications for this device (needs the live session)
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
  const openTrades = (league, initialTab, seed) => pushOverlay({ type: 'trades', league, initialTab, seed });
  const openTradeInbox = () => pushOverlay({ type: 'tradeInbox' });
  const openBlock = () => pushOverlay({ type: 'block' });
  const openDraft = (league) => pushOverlay({ type: 'draft', league });
  const openDraftHub = () => pushOverlay({ type: 'draftHub' });
  const openLeagues = () => pushOverlay({ type: 'leagues' });
  const openPortfolio = () => pushOverlay({ type: 'portfolio' });
  const openSettings = () => pushOverlay({ type: 'settings' });
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
            onOpenPlayer={openPlayer}
          />
        );
      case 'players':
        return <PlayersScreen onOpenPlayer={openPlayer} />;
      case 'trades':
        return (
          <TradeInboxScreen
            onOpenLeague={openTrades}
            onProposeInLeague={(league) => openTrades(league, 'propose')}
            onOpenBlock={openBlock}
            onCounter={(ctx) => openTrades({ leagueId: ctx.leagueId, name: ctx.name }, 'propose', { counterOfferId: ctx.offerId })}
            onOpenPlayer={openPlayer}
          />
        );
      case 'lineups':
        return <LineupsScreen onOpenLineup={openLineup} onStartWizard={openWizard} />;
      case 'home':
      default:
        return (
          <HomeScreen
            demoMode={demoMode}
            onOpenLineup={openLineup}
            onOpenLeague={openRoster}
            onOpenLeagues={openLeagues}
            onOpenPortfolio={openPortfolio}
            onOpenWaivers={(league) => openWaivers({ leagueId: league.leagueId, position: league.position })}
            onOpenTrades={openTrades}
            onOpenTradeInbox={() => setTab('trades')}
            onOpenDraft={openDraft}
            onOpenDraftHub={openDraftHub}
            onOpenOnDeck={openOnDeck}
            onOpenPlayer={openPlayer}
            onOpenSettings={openSettings}
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
      const leaveStyle = {
        opacity: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [
          { translateY: leave.interpolate({ inputRange: [0, 1], outputRange: [0, -70] }) },
          { scale: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] }) },
        ],
      };
      return (
        <Animated.View style={[styles.flex, leaveStyle]}>
          <LoginScreen onLoggedIn={handleLoggedIn} />
        </Animated.View>
      );
    }

    if (overlay && overlay.type === 'roster') {
      return <RosterScreen league={overlay.league} onBack={popOverlay} onOpenTrades={openTrades} onOpenDraft={openDraft} onOpenPlayer={openPlayer} />;
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
      return <WaiverWizardScreen leagues={overlay.leagues} onBack={popOverlay} onOpenPlayer={openPlayer} />;
    }
    if (overlay && overlay.type === 'trades') {
      return <TradesScreen league={overlay.league} initialTab={overlay.initialTab} seed={overlay.seed} onBack={popOverlay} onOpenPlayer={openPlayer} />;
    }
    if (overlay && overlay.type === 'tradeInbox') {
      return (
        <TradeInboxScreen
          onBack={popOverlay}
          onOpenLeague={openTrades}
          onProposeInLeague={(league) => openTrades(league, 'propose')}
          onOpenBlock={openBlock}
          onCounter={(ctx) => openTrades({ leagueId: ctx.leagueId, name: ctx.name }, 'propose', { counterOfferId: ctx.offerId })}
          onOpenPlayer={openPlayer}
        />
      );
    }
    if (overlay && overlay.type === 'block') {
      return (
        <OnTheBlockScreen
          onBack={popOverlay}
          onShopLeague={(league) => openTrades(league, 'propose')}
          onShopPlayer={({ leagueId, name, sendPlayerId, partnerFranchiseId }) => openTrades({ leagueId, name }, 'propose', { sendPlayerId, partnerFranchiseId })}
          onOpenPlayer={openPlayer}
        />
      );
    }
    if (overlay && overlay.type === 'draft') {
      return <DraftScreen league={overlay.league} onBack={popOverlay} onOpenPlayer={openPlayer} />;
    }
    if (overlay && overlay.type === 'draftHub') {
      return <DraftHubScreen onBack={popOverlay} onOpenDraft={openDraft} />;
    }
    if (overlay && overlay.type === 'leagues') {
      return <LeaguesScreen onBack={popOverlay} onOpenLeague={openRoster} onOpenDraftHub={openDraftHub} />;
    }
    if (overlay && overlay.type === 'portfolio') {
      return <PortfolioScreen onBack={popOverlay} onOpenPlayer={openPlayer} onOpenLeague={openRoster} />;
    }
    if (overlay && overlay.type === 'settings') {
      return <SettingsScreen onBack={popOverlay} />;
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
      return (
        <PlayerProfileScreen
          playerId={overlay.playerId}
          onBack={popOverlay}
          onOpenTradeDesk={(ctx) => openTrades({ leagueId: ctx.leagueId, name: ctx.name }, 'propose', { targetPlayerId: ctx.targetPlayerId, partnerFranchiseId: ctx.partnerFranchiseId })}
        />
      );
    }

    return (
      <View style={styles.flex}>
        <View style={styles.flex}>{renderTab()}</View>
        <TabBar tab={tab} onChange={setTab} />
      </View>
    );
  }

  // The gold-over-navy field sits behind the whole app; screens render on transparent
  // containers so it shows through, with opaque cards floating on top. Login draws its
  // own hero-intensity backdrop over this one.
  // The app flies in after login; identity transform once settled (enter=1), so
  // ordinary navigation isn't animated.
  const enterStyle = authed
    ? {
        opacity: enter.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
        transform: [
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [90, 0] }) },
          { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
        ],
      }
    : null;

  return (
    <View style={styles.root}>
      <FieldBackdrop />
      <SafeAreaView style={styles.safe}>
        <ExpoStatusBar style="light" />
        {Platform.OS === 'android' ? <StatusBar translucent backgroundColor="transparent" barStyle="light-content" /> : null}
        <Animated.View style={[styles.flex, enterStyle]}>{render()}</Animated.View>
      </SafeAreaView>
    </View>
  );
}

function TabBar({ tab, onChange }) {
  return (
    <View style={[styles.tabbar, { paddingBottom: androidNavClearance() }]}>
      {TABS.map((t) => {
        const active = tab === t.key;
        return (
          <PressableScale
            key={t.key}
            pressableStyle={styles.tab}
            style={styles.tabInner}
            onPress={() => onChange(t.key)}
            hitSlop={6}
            dip={0.88}
          >
            <Text style={[styles.tabIcon, { color: active ? colors.accent : colors.textDim }]}>{t.icon}</Text>
            <Text style={[styles.tabLabel, { color: active ? colors.accent : colors.textDim }]}>{t.label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // SafeAreaView only insets on iOS; on Android the (translucent) status bar would
  // otherwise overlap the top of every screen (search box, tab menus). Pad the root
  // by the Android status-bar height so all content clears the OS ribbon.
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: 'transparent', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabbar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    // Solid, slightly lifted from the backdrop so the bar reads as a distinct surface.
    backgroundColor: '#0C1424',
    paddingTop: 8,
  },
  tab: { flex: 1 },
  tabInner: { alignItems: 'center', paddingVertical: 2 },
  tabIcon: { fontSize: 18, marginBottom: 2 },
  tabLabel: { fontSize: 10, fontWeight: '700' },
});
