import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { api } from '../api';
import { colors, rgb, glow } from '../theme';
import { displayLabel } from '../typography';
import { useEntitlement } from '../entitlement';
import { presentPaywall } from '../entitlement/paywallBus';
import { TopbarTitle } from '../components/Brand';
import useAndroidBack from '../useAndroidBack';
import { peekResource, primeResource } from '../useCachedResource';
import Sparkline from '../components/Sparkline';
import NeonSign from '../components/NeonSign';

// The signed-in manager's home base: who you are, your portfolio at a glance, the shape of
// your leagues (outlook mix), your personal activity (tags / watchlist), and the account
// actions. Identity loads instantly from /api/me; the value + outlook + activity fill in from
// the (client-cached) portfolio and watchlist reads, so the card is never blank while loading.
export default function ProfileScreen({ onBack, onOpenPortfolio, onOpenSettings, onOpenHelp, onOpenPlayer, onOpenTrophies, onLogout }) {
  // Seed identity (+ the portfolio glance) from cache so re-opening Profile — an overlay that unmounts
  // on back — paints the card instantly instead of a full-screen spinner. `me` gates the screen.
  const [me, setMe] = useState(() => { const h = peekResource('me'); return h ? h.value : null; });
  const [port, setPort] = useState(() => { const h = peekResource('portfolio'); return h ? h.value : null; });
  const [watchCount, setWatchCount] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const load = useCallback(() => {
    api.me().then((m) => { setMe(m); primeResource('me', m); }).catch((e) => setError(e.message));
    api.portfolio().then(setPort).catch(() => {}); // read-only for the glance; the Portfolio tab owns its cache
    api.watchlist().then((w) => setWatchCount((w.players || []).length)).catch(() => {});
    setRefreshing(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // NEVER gate the whole screen on the /api/me read — the account actions (esp. Log out) need no data
  // and must be on-screen and tappable the instant Profile opens, even on a cold/slow backend. Identity
  // and the portfolio glance fill in as they arrive; a failed /api/me shows an inline retry, not a wall.
  const name = (me && me.username) || 'Manager';
  const initials = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'DC';
  const mix = port && port.outlookMix;
  const tags = port && port.tags;
  const change = port && port.change;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Hub</Text></Pressable>
        <TopbarTitle>Profile</TopbarTitle>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        {/* Inline, non-blocking: if identity failed to load, offer a retry without hiding the actions. */}
        {error && !me ? (
          <Pressable onPress={() => { setError(null); load(); }} style={styles.errBanner}>
            <Text style={styles.errBannerText}>Couldn’t load your profile — tap to retry.</Text>
          </Pressable>
        ) : null}

        {/* Manager card — identity fills in from /api/me; a placeholder holds the layout until it lands. */}
        <View style={styles.card}>
          <View style={styles.idRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{me ? initials : '·'}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              <Text style={styles.sub}>{me ? `${me.leagues} league${me.leagues === 1 ? '' : 's'} · ${me.season} season` : 'Loading your profile…'}</Text>
            </View>
            {me && me.demoMode ? <View style={styles.demoPill}><Text style={styles.demoPillText}>DEMO</Text></View> : null}
          </View>
        </View>

        {/* Portfolio snapshot — taps through to the full Portfolio. */}
        <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} onPress={onOpenPortfolio}>
          <View style={styles.cardHeadRow}>
            <Text style={[styles.cardTitle, displayLabel()]}>Portfolio</Text>
            <Text style={styles.link}>View ›</Text>
          </View>
          {port ? (
            <>
              <Text style={styles.total}>{port.totals.rosterValue.toLocaleString()}</Text>
              {/* Partial load → the total is only some of your leagues; hide the trend + sparkline
                  (same apples-to-apples rule as the Portfolio screen) and say so. */}
              {port.totals.partial ? (
                <Text style={styles.changeFlat}>{port.totals.teams} of {port.totals.leagues} leagues · pull to refresh</Text>
              ) : change ? (
                <Text style={[styles.change, { color: change.absolute === 0 ? colors.textDim : change.absolute > 0 ? colors.good : colors.bad }]}>
                  {change.absolute >= 0 ? '▲' : '▼'} {change.absolute >= 0 ? '+' : '−'}{Math.abs(change.absolute).toLocaleString()} ({change.absolute >= 0 ? '+' : '−'}{Math.abs(change.pct)}%) · {change.days}d
                </Text>
              ) : <Text style={styles.changeFlat}>total dynasty value</Text>}
              {!port.totals.partial && port.history && port.history.length >= 2 ? (
                <View style={styles.spark}>
                  <Sparkline
                    data={port.history.map((h) => h.value)}
                    width={260}
                    height={44}
                    color={!change || change.absolute >= 0 ? colors.good : colors.bad}
                  />
                </View>
              ) : null}
            </>
          ) : (
            <ActivityIndicator color={colors.textDim} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
          )}
        </Pressable>

        {/* League outlook mix */}
        {mix ? (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, displayLabel()]}>Your leagues</Text>
            <View style={styles.mixRow}>
              <Mix label="Win-now" value={mix.winNow} color={colors.warn} />
              <Mix label="Ascending" value={mix.ascending} color={colors.good} />
              <Mix label="Balanced" value={mix.balanced} color={colors.textDim} />
              <Mix label="Rebuilding" value={mix.rebuilding} color={colors.textDim} />
            </View>
          </View>
        ) : null}

        {/* Personal activity */}
        {tags || watchCount != null ? (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, displayLabel()]}>Your activity</Text>
            <View style={styles.mixRow}>
              <Mix label="Targets" value={tags ? tags.targets : 0} color={colors.good} />
              <Mix label="Avoids" value={tags ? tags.avoids : 0} color={colors.bad} />
              <Mix label="Watching" value={watchCount != null ? watchCount : 0} color={colors.textDim} />
            </View>
          </View>
        ) : null}

        {/* Pro status / upgrade — gold = value. Trial shows days left; free nudges to Pro. */}
        <ProStatus />

        {/* Account actions */}
        <View style={styles.card}>
          {onOpenTrophies ? <ActionRow label="Trophy Case" icon={{ glyph: 'trophy', color: 'gold' }} onPress={onOpenTrophies} /> : null}
          <ActionRow label="Settings" onPress={onOpenSettings} />
          <ActionRow label="Help & how it works" onPress={onOpenHelp} />
          <ActionRow label="Log out" onPress={onLogout} destructive last />
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

function ProStatus() {
  const { isPro, reason, trial } = useEntitlement();
  const active = reason === 'subscribed' || reason === 'comped';
  const status =
    reason === 'comped'
      ? 'Unlocked — full access'
      : reason === 'subscribed'
        ? 'Active — thanks for supporting the app'
        : reason === 'trial'
          ? `Free trial · ${trial.daysLeft} day${trial.daysLeft === 1 ? '' : 's'} left`
          : 'Act across all your leagues from one place';
  const cta = active ? 'Details ›' : isPro ? 'View ›' : 'Go Pro ›';
  return (
    <Pressable
      onPress={() => presentPaywall({ source: 'profile' })}
      style={({ pressed }) => [styles.card, styles.proCard, glow(rgb.gold, { edge: 0.5, wash: 0.1, halo: 0.3, radius: 14 }), pressed && { opacity: 0.85 }]}
    >
      <View style={styles.proRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.proTitle}>Dynasty Central <Text style={styles.proWord}>PRO</Text></Text>
          <Text style={styles.proSub}>{status}</Text>
        </View>
        <Text style={styles.proCta}>{cta}</Text>
      </View>
    </Pressable>
  );
}

function Mix({ label, value, color }) {
  return (
    <View style={styles.mix}>
      <Text style={[styles.mixValue, { color }]}>{value}</Text>
      <Text style={styles.mixLabel}>{label}</Text>
    </View>
  );
}

function ActionRow({ label, onPress, destructive, last, icon }) {
  return (
    <Pressable style={({ pressed }) => [styles.actionRow, !last && styles.actionRowBorder, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={styles.actionLeft}>
        {icon ? <NeonSign grade="inline" glyph={icon.glyph} color={icon.color} size={15} /> : null}
        <Text style={[styles.actionText, destructive && { color: colors.bad }]}>{label}</Text>
      </View>
      {!destructive ? <Text style={styles.actionChev}>›</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 60 },
  title: { color: colors.text, fontSize: 17, fontWeight: '900' },
  body: { padding: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.accent + '22', borderWidth: 1.5, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accent, fontSize: 20, fontWeight: '900', letterSpacing: 0.5 },
  name: { color: colors.text, fontSize: 20, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginTop: 2 },
  proCard: { paddingVertical: 14 },
  proRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  proTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  proWord: { color: colors.gold, fontWeight: '900', letterSpacing: 0.6 },
  proSub: { color: colors.textDim, fontSize: 12, fontWeight: '600', marginTop: 3 },
  proCta: { color: colors.gold, fontSize: 14, fontWeight: '800' },
  demoPill: { backgroundColor: colors.accent + '22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  demoPillText: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colors.violetText, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  link: { color: colors.accent, fontSize: 13, fontWeight: '700', marginBottom: 10 },
  total: { color: colors.gold, fontSize: 32, fontWeight: '900', letterSpacing: -0.5 },
  change: { fontSize: 14, fontWeight: '900', marginTop: 3 },
  changeFlat: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginTop: 3 },
  spark: { marginTop: 10, marginHorizontal: -2 },
  mixRow: { flexDirection: 'row', gap: 8 },
  mix: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  mixValue: { fontSize: 22, fontWeight: '900' },
  mixLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 3 },
  actionLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  actionRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  actionText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  actionChev: { color: colors.textDim, fontSize: 18, fontWeight: '700' },
  errBanner: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.bad, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 },
  errBannerText: { color: colors.bad, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  error: { color: colors.bad, textAlign: 'center', marginBottom: 14 },
  retry: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: colors.border },
  retryText: { color: colors.text, fontWeight: '700' },
});
