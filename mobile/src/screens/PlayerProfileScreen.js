import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import AvailabilityBadge from '../components/AvailabilityBadge';
import AddAcrossSheet from '../components/AddAcrossSheet';
import TradeAcrossSheet from '../components/TradeAcrossSheet';
import { TargetIcon, AvoidIcon, WatchIcon } from '../components/PlayerActionIcons';
import useAndroidBack from '../useAndroidBack';

const RELATION = {
  rostered: { label: 'Rostered', color: colors.good },
  free: { label: 'Free agent', color: colors.accent },
  dropped: { label: 'Dropped', color: colors.textDim },
  unavailable: { label: 'Not available', color: colors.textDim },
};

function diffColor(d) {
  if (d == null) return colors.textDim;
  if (d <= 4) return colors.good;
  if (d <= 6) return colors.warn;
  return colors.bad;
}

export default function PlayerProfileScreen({ playerId, onBack, onOpenTradeDesk, onOpenTradeWizard }) {
  const [p, setP] = useState(null);
  const [error, setError] = useState(null);
  const [sheet, setSheet] = useState(null); // 'add' | 'drop' | 'trade'
  const [watched, setWatched] = useState(false);
  const [tag, setTag] = useState(null); // 'target' | 'avoid' | null

  const load = () => {
    api.playerProfile(playerId).then((prof) => { setP(prof); setWatched(!!prof.watched); setTag(prof.tag || null); }).catch((e) => setError(e.message));
  };
  useEffect(() => {
    load();
  }, [playerId]);

  // Star / unstar — optimistic, reverts on failure.
  const toggleWatch = useCallback(() => {
    const next = !watched;
    setWatched(next);
    const call = next ? api.watchAdd(playerId) : api.watchRemove(playerId);
    call.catch((e) => { setWatched(!next); Alert.alert('Could not update watchlist', e.message); });
  }, [watched, playerId]);

  // Target / Avoid — tapping the current tag clears it. Optimistic, reverts on failure.
  const applyTag = useCallback((which) => {
    const next = tag === which ? null : which;
    const prev = tag;
    setTag(next);
    api.setTag(playerId, next).catch((e) => { setTag(prev); Alert.alert('Could not update tag', e.message); });
  }, [tag, playerId]);

  // Back closes an open action sheet before leaving the profile.
  useAndroidBack(useCallback(() => {
    if (sheet) {
      setSheet(null);
      return true;
    }
    return false;
  }, [sheet]));

  if (error) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.error}>{error}</Text>
        <Pressable onPress={onBack} style={styles.backBtn}><Text style={styles.backText}>Go back</Text></Pressable>
      </View>
    );
  }
  if (!p) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const posColor = positionColors[p.position] || colors.textDim;
  const canAdd = p.actions.addLeagues.length > 0;
  const canDrop = p.actions.dropLeagues.length > 0;
  // He's a trade target wherever another team owns him.
  const tradeLeagues = p.crossLeague.filter((c) => c.relation === 'unavailable').length;
  const canTrade = tradeLeagues > 0;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Players</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Identity */}
        <View style={styles.idRow}>
          <View style={[styles.posBadge, { backgroundColor: posColor + '22', borderColor: posColor }]}>
            <Text style={[styles.pos, { color: posColor }]}>{p.position}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
              <AvailabilityBadge availability={p.availability} style={{ marginLeft: 8 }} />
            </View>
            <Text style={styles.sub}>
              {p.team}{p.age != null ? ` · age ${p.age}` : ''}{p.byeWeek ? ` · bye ${p.byeWeek}` : ''}
              {p.posRank ? ` · ${p.position}${p.posRank}` : ''}
            </Text>
          </View>
          {p.value != null ? (
            <View style={styles.valueBox}>
              <Text style={styles.valueNum}>{p.value}</Text>
              <Text style={styles.valueLabel}>market value</Text>
              {p.valueRange && p.valueRange.min !== p.valueRange.max ? (
                <Text style={styles.valueSpread}>{p.valueRange.min}–{p.valueRange.max} in leagues</Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* One control set: Target / Avoid tint your personal value (±10%); Watch tracks
            him on your watchlist. Tap an active Target/Avoid again to clear. */}
        <View style={styles.tagRow}>
          <Pressable style={[styles.tagBtn, tag === 'target' && styles.tagTargetOn]} onPress={() => applyTag('target')}>
            <TargetIcon size={17} color={tag === 'target' ? colors.good : colors.textDim} />
            <Text style={[styles.tagTxt, tag === 'target' && styles.tagTxtOn]}>Target</Text>
          </Pressable>
          <Pressable style={[styles.tagBtn, tag === 'avoid' && styles.tagAvoidOn]} onPress={() => applyTag('avoid')}>
            <AvoidIcon size={17} color={tag === 'avoid' ? colors.bad : colors.textDim} />
            <Text style={[styles.tagTxt, tag === 'avoid' && styles.tagTxtOn]}>Avoid</Text>
          </Pressable>
          <Pressable style={[styles.tagBtn, watched && styles.tagWatchOn]} onPress={toggleWatch}>
            <WatchIcon size={17} color={watched ? colors.gold : colors.textDim} filled={watched} />
            <Text style={[styles.tagTxt, watched && styles.tagTxtOn]}>Watch</Text>
          </Pressable>
        </View>

        {/* Outlook */}
        {p.outlook ? (
          <Card title="This week (projected · est.)">
            <View style={styles.bandRow}>
              <Band label="Floor" value={p.outlook.floor} />
              <Band label="Median" value={p.outlook.median} big />
              <Band label="Ceiling" value={p.outlook.ceiling} />
            </View>
          </Card>
        ) : null}

        {/* Season + game log */}
        {p.season ? (
          <Card title={`Season · ${p.season.ppg} ppg`}>
            {p.gameLog.map((g) => (
              <View key={g.week} style={styles.logRow}>
                <Text style={styles.logWeek}>Wk {g.week}</Text>
                <Text style={styles.logLine} numberOfLines={1}>{g.line}</Text>
                <Text style={styles.logPts}>{g.pts}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Schedule */}
        {p.schedule.upcoming.length ? (
          <Card title={p.schedule.avgDifficulty != null ? `Upcoming · avg difficulty ${p.schedule.avgDifficulty}` : 'Upcoming'}>
            <View style={styles.schedRow}>
              {p.schedule.upcoming.map((s) => (
                <View key={s.week} style={styles.schedCell}>
                  <Text style={styles.schedWk}>Wk {s.week}</Text>
                  <Text style={styles.schedOpp}>{s.opp}</Text>
                  {s.difficulty != null ? (
                    <View style={[styles.diffPill, { backgroundColor: diffColor(s.difficulty) + '33', borderColor: diffColor(s.difficulty) }]}>
                      <Text style={[styles.diffText, { color: diffColor(s.difficulty) }]}>{s.difficulty}</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {/* News */}
        {p.news.length ? (
          <Card title="News">
            {p.news.map((n) => (
              <Text key={n.id} style={styles.news}>• {n.headline}</Text>
            ))}
          </Card>
        ) : null}

        {/* Cross-league ownership */}
        <Card title="Across your leagues">
          {p.crossLeague.map((c) => {
            const r = RELATION[c.relation] || RELATION.unavailable;
            return (
              <View key={c.leagueId} style={styles.clRow}>
                <View style={[styles.dot, { backgroundColor: r.color }]} />
                <Text style={styles.clName} numberOfLines={1}>{c.name}</Text>
                <Text style={[styles.clRel, { color: r.color }]}>
                  {r.label}{c.bucket ? ` (${c.bucket})` : ''}
                </Text>
                {c.value != null ? <Text style={styles.clValue}>{c.value}</Text> : null}
                {c.leagueProjection != null ? <Text style={styles.clProj}>{c.leagueProjection}</Text> : null}
              </View>
            );
          })}
        </Card>

        <View style={{ height: 90 }} />
      </ScrollView>

      {/* Action bar */}
      {canAdd || canTrade || canDrop ? (
        <View style={styles.actionBar}>
          {canAdd ? (
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.accent }]} onPress={() => setSheet('add')}>
              <Text style={styles.actionText}>Add in {p.actions.addLeagues.length} league{p.actions.addLeagues.length === 1 ? '' : 's'}</Text>
            </Pressable>
          ) : null}
          {canTrade ? (
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent }]} onPress={() => setSheet('trade')}>
              <Text style={[styles.actionText, { color: colors.accent }]}>Trade for{tradeLeagues > 1 ? ` (${tradeLeagues})` : ''}</Text>
            </Pressable>
          ) : null}
          {canDrop ? (
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.bad }]} onPress={() => setSheet('drop')}>
              <Text style={[styles.actionText, { color: colors.bad }]}>Drop</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {sheet === 'add' ? <AddAcrossSheet player={p} onClose={() => setSheet(null)} onDone={() => { setSheet(null); load(); }} /> : null}
      {sheet === 'trade' ? (
        <TradeAcrossSheet
          player={p}
          onClose={() => setSheet(null)}
          onCraft={(ctx) => { setSheet(null); onOpenTradeDesk && onOpenTradeDesk(ctx); }}
          onStartWizard={(queue) => { setSheet(null); onOpenTradeWizard && onOpenTradeWizard(queue); }}
        />
      ) : null}
      {sheet === 'drop' ? <DropSheet player={p} onClose={() => setSheet(null)} onDone={() => { setSheet(null); load(); }} /> : null}
    </View>
  );
}

function Card({ title, children }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}
function Band({ label, value, big }) {
  return (
    <View style={styles.band}>
      <Text style={[styles.bandValue, big && { fontSize: 26, color: colors.text }]}>{value}</Text>
      <Text style={styles.bandLabel}>{label}</Text>
    </View>
  );
}

function DropSheet({ player, onClose, onDone }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const leagues = player.actions.dropLeagues;

  async function doDrop() {
    setBusy(true);
    try {
      const res = await api.playerDrop(player.id, [...selected]);
      Alert.alert('Dropped', `${player.name} dropped in ${res.summary.dropped} league${res.summary.dropped === 1 ? '' : 's'}.`);
      onDone();
    } catch (e) {
      Alert.alert('Could not drop', e.message);
    } finally {
      setBusy(false);
    }
  }

  // Dropping releases the player to free agency in each chosen league — hard to undo (he
  // can be claimed immediately). Require an explicit, named confirmation first.
  function submit() {
    const n = selected.size;
    const where = n === 1 ? 'this league' : `${n} leagues`;
    Alert.alert(
      `Drop ${player.name}?`,
      `This releases him to free agency in ${where}. Another team can claim him right away.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Drop from ${where}`, style: 'destructive', onPress: doDrop },
      ]
    );
  }

  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        <Text style={styles.sheetTitle}>Drop {player.name}</Text>
        <Text style={styles.sheetSub}>Choose leagues to drop him from.</Text>
        {leagues.map((l) => {
          const on = selected.has(l.leagueId);
          return (
            <Pressable
              key={l.leagueId}
              style={styles.addRow}
              onPress={() => setSelected((s) => { const n = new Set(s); n.has(l.leagueId) ? n.delete(l.leagueId) : n.add(l.leagueId); return n; })}
            >
              <View style={[styles.check, on && { backgroundColor: colors.bad, borderColor: colors.bad }]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
              <Text style={styles.addLeague}>{l.name} <Text style={styles.addMeta}>({l.bucket})</Text></Text>
            </Pressable>
          );
        })}
        <Pressable
          style={({ pressed }) => [styles.confirm, { backgroundColor: colors.bad }, (!selected.size || busy) && styles.confirmOff, pressed && selected.size && { opacity: 0.85 }]}
          onPress={submit}
          disabled={!selected.size || busy}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Drop from {selected.size} league{selected.size === 1 ? '' : 's'}</Text>}
        </Pressable>
        <Pressable style={styles.cancelBtn} onPress={onClose}><Text style={styles.cancelText}>Cancel</Text></Pressable>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  star: { color: colors.textDim, fontSize: 14, fontWeight: '800' },
  starOn: { color: colors.gold },
  body: { padding: 16 },
  idRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  posBadge: { width: 48, paddingVertical: 4, borderRadius: 8, borderWidth: 1, alignItems: 'center', marginRight: 12 },
  pos: { fontSize: 13, fontWeight: '900' },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.text, fontSize: 22, fontWeight: '900', flexShrink: 1 },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 3 },
  valueBox: { alignItems: 'center', marginLeft: 10 },
  valueNum: { color: colors.gold, fontSize: 24, fontWeight: '900' },
  valueLabel: { color: colors.textDim, fontSize: 10, fontWeight: '700' },
  valueSpread: { color: colors.gold, fontSize: 10, fontWeight: '700', marginTop: 2, maxWidth: 92, textAlign: 'center' },
  tagRow: { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 4 },
  tagBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  tagTargetOn: { borderColor: colors.good, backgroundColor: colors.good + '22' },
  tagAvoidOn: { borderColor: colors.bad, backgroundColor: colors.bad + '22' },
  tagWatchOn: { borderColor: colors.gold, backgroundColor: colors.gold + '22' },
  tagTxt: { color: colors.textDim, fontSize: 13, fontWeight: '800' },
  tagTxtOn: { color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 12 },
  cardTitle: { color: colors.textDim, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  bandRow: { flexDirection: 'row', justifyContent: 'space-around' },
  band: { alignItems: 'center' },
  bandValue: { color: colors.textDim, fontSize: 18, fontWeight: '800' },
  bandLabel: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  logWeek: { color: colors.textDim, fontSize: 12, width: 42, fontWeight: '700' },
  logLine: { color: colors.text, fontSize: 13, flex: 1 },
  logPts: { color: colors.text, fontSize: 14, fontWeight: '800', width: 44, textAlign: 'right' },
  schedRow: { flexDirection: 'row', justifyContent: 'space-around' },
  schedCell: { alignItems: 'center' },
  schedWk: { color: colors.textDim, fontSize: 11 },
  schedOpp: { color: colors.text, fontSize: 13, fontWeight: '700', marginVertical: 4 },
  diffPill: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 1 },
  diffText: { fontSize: 12, fontWeight: '900' },
  news: { color: colors.text, fontSize: 13, marginBottom: 6, lineHeight: 18 },
  clRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  clName: { color: colors.text, fontSize: 14, flex: 1 },
  clRel: { fontSize: 12, fontWeight: '700', marginRight: 10 },
  clValue: { color: colors.gold, fontSize: 13, fontWeight: '900', width: 34, textAlign: 'right' },
  clProj: { color: colors.textDim, fontSize: 13, fontWeight: '800', width: 40, textAlign: 'right' },
  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, padding: 14, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
  actionBtn: { flex: 1, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  actionText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  error: { color: colors.bad, textAlign: 'center', marginBottom: 16 },
  backBtn: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  backText: { color: colors.text, fontWeight: '600' },
  // sheets
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderTopWidth: 1, borderColor: colors.border },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sheetSub: { color: colors.textDim, fontSize: 13, marginTop: 2, marginBottom: 8 },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 14 },
  addLeague: { color: colors.text, fontSize: 15, fontWeight: '700' },
  addMeta: { color: colors.textDim, fontSize: 12, marginTop: 2, fontWeight: '500' },
  confirm: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  confirmOff: { backgroundColor: colors.cardAlt },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  tip: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 10 },
  cancelBtn: { alignItems: 'center', paddingTop: 14 },
  cancelText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
});
