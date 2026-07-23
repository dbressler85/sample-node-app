import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, StatusBar, ActivityIndicator, SafeAreaView, Platform, Dimensions, Animated, Easing } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import useAndroidBack from './src/useAndroidBack';
import { api, setAuthLostHandler } from './src/api';
import { registerForPush, unregisterPush } from './src/push';
import { clearAll as clearCache } from './src/cache';
import { prefetchOtherTabs } from './src/prefetch';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen, { resetHomeCache } from './src/screens/HomeScreen';
import { clearResourceCache } from './src/useCachedResource';
import LeaguesScreen from './src/screens/LeaguesScreen';
import LeagueScreen from './src/screens/LeagueScreen';
import PortfolioScreen from './src/screens/PortfolioScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import HelpScreen from './src/screens/HelpScreen';
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
import TradeWizardScreen from './src/screens/TradeWizardScreen';
import OnTheBlockScreen from './src/screens/OnTheBlockScreen';
import DraftScreen from './src/screens/DraftScreen';
import DraftHubScreen from './src/screens/DraftHubScreen';
import OnDeckScreen from './src/screens/OnDeckScreen';
import { loadSession, clearSession } from './src/auth';
import { loadDisplayFont, fonts } from './src/typography';
import PressableScale from './src/components/PressableScale';
import FieldBackdrop from './src/components/FieldBackdrop';
import { NavHubIcon, NavPersonIcon, NavTradesIcon, NavWaiversIcon, NavLineupsIcon, NavGoalPostIcon } from './src/components/NavIcons';
import { CelebrationHost } from './src/components/Celebrate';
import ErrorBoundary from './src/components/ErrorBoundary';
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
  { key: 'home', label: 'Hub', Icon: NavHubIcon },
  { key: 'players', label: 'Players', Icon: NavPersonIcon },
  { key: 'trades', label: 'Trades', Icon: NavTradesIcon },
  { key: 'waivers', label: 'Waivers', Icon: NavWaiversIcon },
  { key: 'lineups', label: 'Lineups', Icon: NavLineupsIcon },
  { key: 'scores', label: 'Scores', Icon: NavGoalPostIcon },
];

export default function App() {
  const [booting, setBooting] = useState(true);
  const [, bumpFont] = useState(0); // re-render trigger when a slow first-load font finally lands
  const [authed, setAuthed] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [tab, setTab] = useState('home');
  // Overlays form a stack so back returns to the previous screen (e.g. Trades or
  // Draft opened from a roster returns to that roster, not Home).
  const [overlayStack, setOverlayStack] = useState([]);
  const [waiversTarget, setWaiversTarget] = useState(null); // {leagueId, position}
  // Keep-alive tabs: each tab is MOUNTED the first time it's visited and kept mounted (hidden)
  // afterward, so switching tabs preserves scroll + in-progress state (UX_GUARDRAILS C7) — not just
  // returning from an overlay. Lazy so we never eagerly mount all six (and their fetches) at once.
  const [visited, setVisited] = useState(() => new Set(['home']));
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab]);

  // Login → Home handoff in two beats: the login lockup accelerates up and away, then the
  // app "falls" into place and settles with a spring. `drop` rests at 1 (fully settled), so
  // every ordinary render and a restored-session cold launch shows the app in its final
  // position — only an explicit login knocks it to 0 and springs it back. The entrance can
  // therefore never strand the app off-screen or blank (the failure mode a prior opacity
  // fade risked); with expo-updates and its bundle-rollback gone, motion is safe again.
  const leave = useRef(new Animated.Value(0)).current;
  const drop = useRef(new Animated.Value(1)).current;

  // Directional tab slide: switching to a tab further right in the bar slides the new
  // content in from the right; further left, from the left. Two plain drivers (offset +
  // fade) that rest at the identity (0 / 1), so any render that doesn't switch tabs is a
  // no-op and the content can never strand off-screen. Native-driven, purely cosmetic.
  const tabSlide = useRef(new Animated.Value(0)).current;
  const tabFade = useRef(new Animated.Value(1)).current;
  const tabScale = useRef(new Animated.Value(1)).current;
  const prevTabRef = useRef(tab);
  useEffect(() => {
    const order = TABS.map((t) => t.key);
    const from = order.indexOf(prevTabRef.current);
    const to = order.indexOf(tab);
    prevTabRef.current = tab;
    if (from === -1 || to === -1 || from === to) return;
    const dir = to > from ? 1 : -1; // right in the bar → enter from the right
    // A little longer + a touch of slide and scale so the switch is felt, not just seen.
    tabSlide.setValue(dir * 80);
    tabFade.setValue(0.15);
    tabScale.setValue(0.98);
    Animated.parallel([
      Animated.timing(tabSlide, { toValue: 0, duration: 430, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(tabFade, { toValue: 1, duration: 430, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(tabScale, { toValue: 1, useNativeDriver: true, friction: 7, tension: 60 }),
    ]).start();
  }, [tab, tabSlide, tabFade, tabScale]);

  function handleLoggedIn(info) {
    if (info && typeof info.demoMode === 'boolean') setDemoMode(info.demoMode);
    // Beat 1: login accelerates up and out — slower and further, so it clearly departs.
    Animated.timing(leave, { toValue: 1, duration: 760, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      // Beat 2: reveal the app lifted above its resting spot, then let it fall in and settle.
      // A weightier fall: lower tension so it descends slower with real momentum, higher
      // friction so it lands firm instead of bouncing — a heavy object settling, not a ball.
      drop.setValue(0);
      setAuthed(true);
      leave.setValue(0);
      Animated.spring(drop, { toValue: 1, useNativeDriver: true, friction: 8, tension: 38 }).start();
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
      // Don't hold the splash on the display font (~2.2s worst case). Give it a brief head start
      // so the common CACHED load applies before the first paint with no swap, then paint on
      // session resolve. If it's a slow first-ever download, keep loading in the background and
      // bump a re-render when it lands so the face still applies this session (a one-time swap
      // only on that first launch, per UX_GUARDRAILS C9).
      await loadDisplayFont(500);
      setBooting(false);
      if (!fonts.ready) loadDisplayFont().then(() => { if (fonts.ready) bumpFont((n) => n + 1); });
    })();
  }, []);

  // Register this device for push once authenticated (after login and on a
  // restored session). Defensive: no-ops if push isn't available/granted.
  useEffect(() => {
    if (authed) registerForPush();
  }, [authed]);

  // Idle prefetch: once a tab settles, give the screen the user actually opened a head
  // start, then quietly warm the OTHER tabs' caches in the background so switching to
  // them (especially the slow cross-league Trades read) paints instantly. Deferred and
  // sequential so it never competes with the active screen's own load; re-armed on each
  // tab change and cancelled if they switch again before it fires.
  useEffect(() => {
    if (!authed || booting || overlayStack.length) return undefined;
    const t = setTimeout(() => { prefetchOtherTabs(tab); }, 1800);
    return () => clearTimeout(t);
  }, [authed, booting, tab, overlayStack.length]);

  // If a request finds the session dead or the backend unreachable, drop to login.
  useEffect(() => {
    setAuthLostHandler(async () => {
      await clearSession();
      await clearCache();
      resetHomeCache();
      clearResourceCache();
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
    resetHomeCache();
    clearResourceCache();
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
  const openLeagueHub = (league) => pushOverlay({ type: 'league', league });
  const openPortfolio = () => pushOverlay({ type: 'portfolio' });
  const openProfile = () => pushOverlay({ type: 'profile' });
  const openSettings = () => pushOverlay({ type: 'settings' });
  const openHelp = () => pushOverlay({ type: 'help' });
  const openOnDeck = () => pushOverlay({ type: 'onDeck' });
  // A `seed` (name/pos/team/value the caller already has) lets the profile paint its header
  // instantly instead of a blank spinner while the heavy cross-league read resolves.
  const openPlayer = (playerId, seed) => pushOverlay({ type: 'playerProfile', playerId, seed });
  const openTradeWizard = (queue) => pushOverlay({ type: 'tradeWizard', queue });
  const openWaivers = (target) => {
    setWaiversTarget(target || null);
    setOverlayStack([]); // if invoked from an overlay (e.g. the lineup editor's "Fill on waivers"), leave it
    setTab('waivers');
  };

  function renderTabContent(key, active) {
    switch (key) {
      case 'scores':
        return <ScoresScreen active={active} onOpenLineup={openLineup} />;
      case 'waivers':
        return (
          <WaiversScreen
            key={`w-${waiversTarget ? waiversTarget.leagueId : 'all'}`}
            active={active}
            initialLeagueId={waiversTarget ? waiversTarget.leagueId : null}
            initialPosition={waiversTarget ? waiversTarget.position : null}
            onStartWizard={openWaiverWizard}
            onOpenPlayer={openPlayer}
            onOpenLineup={openLineup}
          />
        );
      case 'players':
        return <PlayersScreen active={active} onOpenPlayer={openPlayer} />;
      case 'trades':
        return (
          <TradeInboxScreen
            active={active}
            onOpenLeague={openTrades}
            onProposeInLeague={(league) => openTrades(league, 'propose')}
            onOpenBlock={openBlock}
            onCounter={(ctx) => openTrades({ leagueId: ctx.leagueId, name: ctx.name }, 'propose', { counterOfferId: ctx.offerId })}
            onManualCounter={(ctx) => openTrades({ leagueId: ctx.leagueId, name: ctx.name }, 'propose', { partnerFranchiseId: ctx.partnerFranchiseId })}
            onOpenPlayer={openPlayer}
          />
        );
      case 'lineups':
        return <LineupsScreen active={active} onOpenLineup={openLineup} onStartWizard={openWizard} />;
      case 'home':
      default:
        return (
          <HomeScreen
            active={active}
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
            onOpenProfile={openProfile}
            onLogout={handleLogout}
          />
        );
    }
  }

  // One overlay descriptor -> its screen. Extracted so the render can stack the WHOLE overlay
  // list on top of a persistent tab layer (below) instead of returning one overlay INSTEAD of the
  // tabs. Same screens/props as before — only the layering changed.
  function renderOverlay(o) {
    switch (o.type) {
      case 'roster':
        return <RosterScreen league={o.league} onBack={popOverlay} onOpenTrades={openTrades} onOpenDraft={openDraft} onOpenPlayer={openPlayer} />;
      case 'lineupEditor':
        return <LineupEditorScreen league={o.league} onBack={popOverlay} onOpenWaivers={openWaivers} />;
      case 'lineupWizard':
        return <LineupWizardScreen leagues={o.leagues} initialMode={o.mode} onBack={popOverlay} />;
      case 'waiverWizard':
        return <WaiverWizardScreen leagues={o.leagues} onBack={popOverlay} onOpenPlayer={openPlayer} />;
      case 'trades':
        return <TradesScreen league={o.league} initialTab={o.initialTab} seed={o.seed} onBack={popOverlay} onOpenPlayer={openPlayer} />;
      case 'tradeInbox':
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
      case 'block':
        return (
          <OnTheBlockScreen
            onBack={popOverlay}
            onShopLeague={(league) => openTrades(league, 'propose')}
            onShopPlayer={({ leagueId, name, sendPlayerId, partnerFranchiseId }) => openTrades({ leagueId, name }, 'propose', { sendPlayerId, partnerFranchiseId })}
            onOpenPlayer={openPlayer}
            onOpenInbox={() => { popOverlay(); setTab('trades'); }}
          />
        );
      case 'draft':
        return <DraftScreen league={o.league} demoMode={demoMode} onBack={popOverlay} onOpenPlayer={openPlayer} onOpenTrades={openTrades} />;
      case 'draftHub':
        return <DraftHubScreen onBack={popOverlay} onOpenDraft={openDraft} />;
      case 'leagues':
        return <LeaguesScreen onBack={popOverlay} onOpenLeague={openLeagueHub} onOpenDraftHub={openDraftHub} />;
      case 'league':
        return <LeagueScreen league={o.league} onBack={popOverlay} onOpenPlayer={openPlayer} />;
      case 'portfolio':
        return <PortfolioScreen onBack={popOverlay} onOpenPlayer={openPlayer} onOpenLeague={openRoster} />;
      case 'profile':
        return (
          <ProfileScreen
            onBack={popOverlay}
            onOpenPortfolio={openPortfolio}
            onOpenSettings={openSettings}
            onOpenHelp={openHelp}
            onOpenPlayer={openPlayer}
            onLogout={handleLogout}
          />
        );
      case 'settings':
        return <SettingsScreen onBack={popOverlay} onOpenHelp={openHelp} onLogout={handleLogout} />;
      case 'help':
        return <HelpScreen onBack={popOverlay} />;
      case 'onDeck':
        return (
          <OnDeckScreen
            onBack={popOverlay}
            onOpenLineup={openLineup}
            onOpenDraft={openDraft}
            onOpenWaivers={(league) => openWaivers({ leagueId: league.leagueId })}
          />
        );
      case 'playerProfile':
        return (
          <PlayerProfileScreen
            playerId={o.playerId}
            seed={o.seed}
            onBack={popOverlay}
            onOpenTradeDesk={(ctx) => openTrades({ leagueId: ctx.leagueId, name: ctx.name }, 'propose', { targetPlayerId: ctx.targetPlayerId, partnerFranchiseId: ctx.partnerFranchiseId })}
            onOpenTradeWizard={openTradeWizard}
          />
        );
      case 'tradeWizard':
        return <TradeWizardScreen queue={o.queue} onExit={popOverlay} onOpenPlayer={openPlayer} />;
      default:
        return null;
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
        opacity: leave.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.3, 0] }),
        transform: [
          { translateY: leave.interpolate({ inputRange: [0, 1], outputRange: [0, -160] }) },
          { scale: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] }) },
        ],
      };
      return (
        <Animated.View style={[styles.flex, leaveStyle]}>
          <LoginScreen onLoggedIn={handleLoggedIn} />
        </Animated.View>
      );
    }

    // The tab layer is ALWAYS mounted; overlays stack ON TOP of it (each in a full-screen layer
    // with its own backdrop so it occludes what's below). Nothing unmounts on navigation — the
    // tab you left, and every overlay beneath the current one, keep their scroll and in-progress
    // state, so a back returns to exactly what you had (UX_GUARDRAILS C2/C7). This replaces the
    // old "return the overlay INSTEAD of the tabs", the root cause the cache layer worked around.
    return (
      <View style={styles.flex}>
        <View style={styles.flex}>
          {/* Content region (flex:1 above the bar). Each visited tab is a persistent absolute-fill
              layer; only the active one is displayed (the rest stay mounted via display:none, so
              their scroll/state survive a tab switch). The active layer rides the switch animation. */}
          <View style={styles.flex}>
            {TABS.filter((t) => visited.has(t.key)).map((t) => {
              const active = t.key === tab;
              const content = renderTabContent(t.key, active);
              return (
                <View key={t.key} style={[StyleSheet.absoluteFill, !active && styles.hiddenLayer]} pointerEvents={active ? 'auto' : 'none'}>
                  {active ? (
                    <Animated.View style={[styles.flex, { opacity: tabFade, transform: [{ translateX: tabSlide }, { scale: tabScale }] }]}>
                      {content}
                    </Animated.View>
                  ) : (
                    content
                  )}
                </View>
              );
            })}
          </View>
          <TabBar tab={tab} onChange={setTab} />
        </View>
        {overlayStack.map((o, i) => (
          <View key={i} style={StyleSheet.absoluteFill}>
            <ErrorBoundary silent>
              <FieldBackdrop />
            </ErrorBoundary>
            <View style={styles.flex}>{renderOverlay(o)}</View>
          </View>
        ))}
      </View>
    );
  }

  // The app content falls onto the static backdrop: it starts lifted and slightly enlarged,
  // then drops to rest. At drop=1 (the resting default) this is the identity transform, so it
  // only ever animates right after login and is a no-op on every other render.
  const dropStyle = {
    opacity: drop.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
    transform: [
      { translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-124, 0] }) },
      { scale: drop.interpolate({ inputRange: [0, 1], outputRange: [1.09, 1] }) },
    ],
  };

  // The gold-over-navy field sits behind the whole app; screens render on transparent
  // containers so it shows through, with opaque cards floating on top. Login draws its
  // own hero-intensity backdrop over this one.
  return (
    <View style={styles.root}>
      {/* The backdrop is decorative — if it ever throws (e.g. an SVG quirk on a device),
          isolate it so the app still runs instead of white-screening. */}
      <ErrorBoundary silent>
        <FieldBackdrop />
      </ErrorBoundary>
      <SafeAreaView style={styles.safe}>
        <ExpoStatusBar style="light" />
        {Platform.OS === 'android' ? <StatusBar translucent backgroundColor="transparent" barStyle="light-content" /> : null}
        {/* Any render crash shows its message on screen instead of closing the app. The
            authed content rides the fall-in transform; login/boot render plainly (login has
            its own fly-away). */}
        <ErrorBoundary>
          {authed && !booting ? (
            <Animated.View style={[styles.flex, dropStyle]}>{render()}</Animated.View>
          ) : (
            render()
          )}
        </ErrorBoundary>
      </SafeAreaView>
      {/* Celebration/commiseration overlay — decorative, isolated so a stray animation
          can never take the app down. */}
      <ErrorBoundary silent>
        <CelebrationHost />
      </ErrorBoundary>
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
            {/* Every icon sits in an identical fixed-height, centered box so the glyph tabs
                (Hub/Trades/…) and the SVG tabs (Players/Scores) share one baseline — and the
                labels below line up across all six. */}
            <View style={styles.tabIconBox}>
              {t.Icon ? (
                <t.Icon size={20} color={active ? colors.accent : colors.textDim} />
              ) : (
                <Text style={[styles.tabIcon, { color: active ? colors.accent : colors.textDim }]}>{t.icon}</Text>
              )}
            </View>
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
  hiddenLayer: { display: 'none' }, // keep-alive: mounted but not laid out / painted
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
  // Uniform icon box: same height for glyph and SVG tabs, centered, so labels align.
  tabIconBox: { height: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  tabIcon: { fontSize: 19, lineHeight: 22, includeFontPadding: false, textAlignVertical: 'center' },
  tabLabel: { fontSize: 10, fontWeight: '700', includeFontPadding: false, textAlign: 'center' },
});
