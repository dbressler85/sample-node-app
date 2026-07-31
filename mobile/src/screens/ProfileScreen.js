import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, Linking } from 'react-native';
import Constants from 'expo-constants';
import { api } from '../api';
import { colors, rgb, glow } from '../theme';
import { displayLabel } from '../typography';
import { LEGAL } from '../config';
import { useEntitlement } from '../entitlement';
import { presentPaywall } from '../entitlement/paywallBus';
import { TopbarTitle } from '../components/Brand';
import { appAlert } from '../components/AppAlert';
import useAndroidBack from '../useAndroidBack';
import { peekResource, primeResource } from '../useCachedResource';
import NeonSign from '../components/NeonSign';
import ValueCredit from '../components/ValueCredit';
import NewsCredit from '../components/NewsCredit';

const APP_VERSION = (Constants.expoConfig && Constants.expoConfig.version) || null;

// The signed-in manager's home base — identity, not a second dashboard. A dynasty RÉSUMÉ (titles ·
// leagues · value), a TROPHY showcase, your personal activity (tags/watchlist), Pro, and the account +
// legal actions. The portfolio value TREND lives on the Portfolio screen; the outlook mix lives on Home
// + Portfolio Teams — Profile shows neither, so it stays a "who I am + my account" page.
export default function ProfileScreen({ onBack, onOpenPortfolio, onOpenSettings, onOpenHelp, onOpenTrophies, onLogout }) {
  const [me, setMe] = useState(() => { const h = peekResource('me'); return h ? h.value : null; });
  const [port, setPort] = useState(() => { const h = peekResource('portfolio'); return h ? h.value : null; });
  const [trophies, setTrophies] = useState(null);
  const [watchCount, setWatchCount] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const ent = useEntitlement();

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const load = useCallback(() => {
    api.me().then((m) => { setMe(m); primeResource('me', m); }).catch((e) => setError(e.message));
    api.portfolio().then(setPort).catch(() => {}); // read-only for the value stat; the Portfolio tab owns its cache
    api.trophies().then(setTrophies).catch(() => {});
    api.watchlist().then((w) => setWatchCount((w.players || []).length)).catch(() => {});
    setRefreshing(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const name = (me && me.username) || 'Manager';
  const initials = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'DC';
  const tags = port && port.tags;
  // "Championships" = titles only (place 1), NOT every podium finish — silver/bronze shouldn't inflate
  // the title count. Fall back to total for a pre-podium cached summary that has no `titles` field.
  const champs = trophies && trophies.summary ? (trophies.summary.titles != null ? trophies.summary.titles : trophies.summary.total) : trophies ? (trophies.trophies || []).length : null;
  const recentTrophies = trophies ? (trophies.trophies || []).slice(0, 3) : [];
  const totalValue = port && port.totals ? port.totals.rosterValue : null;
  const fmt = (n) => (n == null ? '—' : n.toLocaleString());

  const requestDeletion = () => {
    appAlert(
      'Delete your data?',
      'This emails our support team to request deletion of the data tied to your account. (Logging out already clears your session on this device.)',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Email request',
          onPress: () => Linking.openURL(`mailto:${LEGAL.supportEmail}?subject=${encodeURIComponent('Delete my Dynasty Central data')}&body=${encodeURIComponent('Please delete the data associated with my account.')}`).catch(() => {}),
        },
      ]
    );
  };
  const openUrl = (url) => Linking.openURL(url).catch(() => {});

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
        {error && !me ? (
          <Pressable onPress={() => { setError(null); load(); }} style={styles.errBanner}>
            <Text style={styles.errBannerText}>Couldn’t load your profile — tap to retry.</Text>
          </Pressable>
        ) : null}

        {/* Manager identity */}
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

        {/* Dynasty résumé — the "who I am as a manager" line. Each stat taps through. */}
        <View style={styles.statRow}>
          <StatTile value={champs == null ? '—' : String(champs)} label={champs === 1 ? 'Championship' : 'Championships'} gold onPress={onOpenTrophies} />
          <StatTile value={me ? String(me.leagues) : '—'} label="Leagues" onPress={onOpenPortfolio} />
          <StatTile value={fmt(totalValue)} label="Total value" onPress={onOpenPortfolio} />
        </View>

        {/* Trophy showcase — achievements are identity, so featured here (not buried as a link). */}
        <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} onPress={onOpenTrophies} disabled={!onOpenTrophies}>
          <View style={styles.cardHeadRow}>
            <Text style={[styles.cardTitle, displayLabel()]}>Trophy case</Text>
            {onOpenTrophies ? <Text style={styles.link}>{champs ? 'View all ›' : 'Open ›'}</Text> : null}
          </View>
          {recentTrophies.length ? (
            <View style={styles.troRow}>
              {recentTrophies.map((t) => {
                // Tint the chip by podium finish (gold / silver / bronze), defaulting to gold.
                const neon = t.place === 2 ? 'silver' : t.place === 3 ? 'bronze' : 'gold';
                const hex = t.place === 2 ? colors.silver : t.place === 3 ? colors.bronze : colors.gold;
                return (
                  <View key={t.id} style={styles.troChip}>
                    <NeonSign grade="inline" glyph="trophy" color={neon} size={14} />
                    <Text style={[styles.troYear, { color: hex }]}>{t.year}</Text>
                    <Text style={styles.troLeague} numberOfLines={1}>{t.leagueName}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.troEmpty}>{trophies ? 'No titles yet — go win one.' : 'Loading your trophy case…'}</Text>
          )}
        </Pressable>

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

        {/* Pro status / upgrade */}
        <ProStatus />

        {/* Account */}
        <View style={styles.card}>
          <ActionRow label="Settings" onPress={onOpenSettings} />
          <ActionRow label="Help & how it works" onPress={onOpenHelp} />
          {ent.reason === 'subscribed' ? <ActionRow label="Manage subscription" onPress={() => openUrl('https://play.google.com/store/account/subscriptions')} /> : null}
          <ActionRow label="Log out" onPress={onLogout} destructive last />
        </View>

        {/* Legal & data (Play requires these reachable once you charge) */}
        <View style={styles.card}>
          <ActionRow label="Terms of Service" onPress={() => openUrl(LEGAL.terms)} />
          <ActionRow label="Privacy Policy" onPress={() => openUrl(LEGAL.privacy)} />
          <ActionRow label="Delete my data" onPress={requestDeletion} last />
        </View>

        {/* Data credits (attribution) + version */}
        <View style={styles.creditsRow}>
          <ValueCredit center />
          <NewsCredit center />
        </View>
        <Text style={styles.version}>Dynasty Central{APP_VERSION ? ` · v${APP_VERSION}` : ''}</Text>

        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

function StatTile({ value, label, gold, onPress }) {
  const inner = (
    <>
      <Text style={[styles.statValue, gold && { color: colors.gold }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </>
  );
  return onPress ? (
    <Pressable style={({ pressed }) => [styles.statTile, pressed && { opacity: 0.8 }]} onPress={onPress}>{inner}</Pressable>
  ) : (
    <View style={styles.statTile}>{inner}</View>
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
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 60 },
  body: { padding: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.accent + '22', borderWidth: 1.5, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accent, fontSize: 20, fontWeight: '900', letterSpacing: 0.5 },
  name: { color: colors.text, fontSize: 20, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginTop: 2 },
  // Résumé stat row
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statTile: { flex: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center' },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  statLabel: { color: colors.textDim, fontSize: 11, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  // Trophy showcase
  troRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  troChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: `rgba(${rgb.gold},0.35)`, paddingHorizontal: 9, paddingVertical: 6, maxWidth: '100%' },
  troYear: { color: colors.gold, fontSize: 12, fontWeight: '900' },
  troLeague: { color: colors.text, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  troEmpty: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  // Pro
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
  mixRow: { flexDirection: 'row', gap: 8 },
  mix: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  mixValue: { fontSize: 22, fontWeight: '900' },
  mixLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 3 },
  actionLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  actionRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  actionText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  actionChev: { color: colors.textDim, fontSize: 18, fontWeight: '700' },
  creditsRow: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 2 },
  version: { color: colors.textDim, fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  errBanner: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.bad, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 },
  errBannerText: { color: colors.bad, fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
