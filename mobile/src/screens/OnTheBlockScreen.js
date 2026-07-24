import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl, ActivityIndicator, Alert, TextInput } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import useAndroidBack from '../useAndroidBack';
import AvailabilityBadge from '../components/AvailabilityBadge';
import { peekResource, primeResource } from '../useCachedResource';

const EDITOR_KEY = 'block:editor';
const MARKET_KEY = 'block:market';
const NOTE_MAX = 120;

// Position order for listing bait assets: players by position, draft picks at the very end.
const POS_RANK = { QB: 0, RB: 1, WR: 2, TE: 3, PK: 4, K: 4, PN: 5, DEF: 6, DL: 6, LB: 6, CB: 6, S: 6 };
function assetRank(a) {
  if (a.kind === 'pick') return 99;
  return POS_RANK[a.position] != null ? POS_RANK[a.position] : 50;
}
function sortAssets(list) {
  return list.slice().sort((a, b) => assetRank(a) - assetRank(b) || (b.value || 0) - (a.value || 0));
}

// Turn a league roster (players + picks) into a flat, sorted asset list for the checklist.
function rosterAssets(roster) {
  if (!roster) return [];
  const players = [...(roster.starters || []), ...(roster.bench || []), ...(roster.ir || []), ...(roster.taxi || [])].map((p) => ({
    token: String(p.id), kind: 'player', name: p.name, position: p.position, team: p.team, age: p.age, value: p.value, availability: p.availability,
  }));
  const picks = (roster.picks || []).map((pk) => {
    const token = typeof pk === 'string' ? pk : pk.token;
    const label = typeof pk === 'string' ? pk : pk.label;
    const value = typeof pk === 'string' ? null : pk.value;
    return { token: String(token), kind: 'pick', name: label, position: 'PICK', team: null, age: null, value };
  });
  return sortAssets([...players, ...picks]);
}

function Checkbox({ on, tint }) {
  return (
    <View style={[styles.checkbox, on && { backgroundColor: tint || colors.accent, borderColor: tint || colors.accent }]}>
      {on ? <Text style={styles.checkMark}>✓</Text> : null}
    </View>
  );
}

// Centralized trade bait: MANAGE your block per league (a roster checklist + one asking price, saved
// in one shot) and browse rivals' blocks in detail (expand a league → a team → check assets → open a
// pre-filled trade). Bait is MFL-authoritative both ways.
export default function OnTheBlockScreen({ onBack, onOpenPlayer, onOpenInbox, onProposeWith }) {
  const [segment, setSegment] = useState('block'); // 'block' | 'market'
  const [editor, setEditor] = useState(() => (peekResource(EDITOR_KEY) ? peekResource(EDITOR_KEY).value : null));
  const [market, setMarket] = useState(() => (peekResource(MARKET_KEY) ? peekResource(MARKET_KEY).value : null));
  const [loading, setLoading] = useState(() => !peekResource(EDITOR_KEY));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // My Block per-league state.
  const [expanded, setExpanded] = useState(() => new Set()); // leagueIds expanded
  const [rosters, setRosters] = useState({}); // leagueId -> roster (or 'loading' / 'error')
  const [checks, setChecks] = useState({}); // leagueId -> Set of checked tokens
  const [notes, setNotes] = useState({}); // leagueId -> asking-price string
  const [savingLeague, setSavingLeague] = useState(null);

  // Market per-league/team state.
  const [mExpanded, setMExpanded] = useState(() => new Set()); // collapsed by default
  const [mChecks, setMChecks] = useState({}); // `${leagueId}:${franchiseId}` -> Set of asset tokens

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const loadEditor = useCallback(async () => {
    setError(null);
    try {
      const d = await api.blockEditor();
      setEditor(d);
      primeResource(EDITOR_KEY, d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { loadEditor(); }, [loadEditor]);

  const loadMarket = useCallback(async () => {
    setError(null);
    try {
      const m = await api.tradeMarket();
      setMarket(m);
      primeResource(MARKET_KEY, m);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, []);
  const marketOnce = useRef(false);
  useEffect(() => { if (segment === 'market' && !marketOnce.current) { marketOnce.current = true; loadMarket(); } }, [segment, loadMarket]);

  // Expand a My-Block league: seed its checked set + note from the editor, then lazy-load its roster.
  async function toggleLeague(lg) {
    const id = lg.leagueId;
    const isOpen = expanded.has(id);
    setExpanded((s) => { const n = new Set(s); if (isOpen) n.delete(id); else n.add(id); return n; });
    if (isOpen) return;
    if (!(id in checks)) setChecks((c) => ({ ...c, [id]: new Set((lg.blockTokens || []).map(String)) }));
    if (!(id in notes)) setNotes((n) => ({ ...n, [id]: lg.note || '' }));
    if (!rosters[id]) {
      setRosters((r) => ({ ...r, [id]: 'loading' }));
      try {
        const roster = await api.roster(id);
        setRosters((r) => ({ ...r, [id]: roster }));
      } catch (e) {
        setRosters((r) => ({ ...r, [id]: 'error' }));
      }
    }
  }

  function toggleCheck(leagueId, tokenId) {
    setChecks((c) => {
      const cur = new Set(c[leagueId] || []);
      if (cur.has(tokenId)) cur.delete(tokenId); else cur.add(tokenId);
      return { ...c, [leagueId]: cur };
    });
  }

  async function saveLeague(lg) {
    const id = lg.leagueId;
    setSavingLeague(id);
    try {
      const tokens = [...(checks[id] || new Set())];
      await api.saveBlock(id, tokens, (notes[id] || '').trim());
      await loadEditor();
      Alert.alert('Block saved', `${tokens.length} asset${tokens.length === 1 ? '' : 's'} shopped in ${lg.name}.`);
    } catch (e) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSavingLeague(null);
    }
  }

  function toggleMarketLeague(id) {
    setMExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleMarketAsset(key, tokenId) {
    setMChecks((c) => {
      const cur = new Set(c[key] || []);
      if (cur.has(tokenId)) cur.delete(tokenId); else cur.add(tokenId);
      return { ...c, [key]: cur };
    });
  }

  const totals = editor && editor.totals;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Trades</Text></Pressable>
        <Text style={styles.title}>On the Block</Text>
        {onOpenInbox ? <Pressable onPress={onOpenInbox} hitSlop={10}><Text style={styles.inboxLink}>Inbox ›</Text></Pressable> : <View style={{ width: 60 }} />}
      </View>
      <View style={styles.segment}>
        {[['block', 'My Block'], ['market', 'Market']].map(([k, label]) => (
          <Pressable key={k} onPress={() => setSegment(k)} style={[styles.seg, segment === k && styles.segOn]}>
            <Text style={[styles.segTxt, segment === k && styles.segTxtOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {segment === 'block' ? (
        <>
          {totals ? (
            <Text style={styles.subtitle}>
              {totals.onBlock} asset{totals.onBlock === 1 ? '' : 's'} on the block · tap a league to manage it
            </Text>
          ) : null}
          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
          ) : error && !editor ? (
            <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadEditor(); }} tintColor={colors.accent} />}
            >
              {(editor && editor.leagues || []).map((lg) => {
                const open = expanded.has(lg.leagueId);
                const roster = rosters[lg.leagueId];
                const checkSet = checks[lg.leagueId] || new Set((lg.blockTokens || []).map(String));
                return (
                  <View key={lg.leagueId} style={styles.card}>
                    <Pressable style={styles.leagueRow} onPress={() => toggleLeague(lg)}>
                      <Text style={styles.leagueName} numberOfLines={1}>{lg.name}</Text>
                      <Text style={styles.leagueCount}>{checkSet.size || lg.count || 0} on block</Text>
                      <Text style={styles.caret}>{open ? '⌄' : '›'}</Text>
                    </Pressable>

                    {open ? (
                      roster === 'loading' || !roster ? (
                        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
                      ) : roster === 'error' ? (
                        <Text style={styles.error}>Couldn’t load this roster.</Text>
                      ) : (
                        <View>
                          {rosterAssets(roster).map((a) => {
                            const on = checkSet.has(a.token);
                            return (
                              <Pressable key={a.token} style={styles.assetRow} onPress={() => toggleCheck(lg.leagueId, a.token)}>
                                <Checkbox on={on} />
                                <View style={[styles.dot, { backgroundColor: a.kind === 'pick' ? colors.accent : positionColors[a.position] || colors.textDim }]} />
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <View style={styles.nameLine}>
                                    <Text style={styles.assetName} numberOfLines={1}>{a.name}</Text>
                                    {a.availability ? <AvailabilityBadge availability={a.availability} style={{ marginLeft: 6 }} /> : null}
                                  </View>
                                  <Text style={styles.assetMeta} numberOfLines={1}>
                                    {a.kind === 'pick' ? 'Draft pick' : [a.position, a.team, a.age != null ? `${a.age}y` : null].filter(Boolean).join(' · ')}
                                  </Text>
                                </View>
                                {a.value != null ? <Text style={styles.assetVal}>{a.value}</Text> : null}
                              </Pressable>
                            );
                          })}

                          <Text style={styles.askLabel}>Asking price / target (for this whole league)</Text>
                          <TextInput
                            style={styles.askInput}
                            value={notes[lg.leagueId] != null ? notes[lg.leagueId] : lg.note}
                            onChangeText={(t) => setNotes((n) => ({ ...n, [lg.leagueId]: t.slice(0, NOTE_MAX) }))}
                            placeholder="e.g. a 1st + a young WR"
                            placeholderTextColor={colors.textDim}
                            multiline
                            maxLength={NOTE_MAX}
                          />
                          <Pressable
                            style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
                            onPress={() => saveLeague(lg)}
                            disabled={savingLeague === lg.leagueId}
                          >
                            {savingLeague === lg.leagueId ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Save block for {lg.name}</Text>}
                          </Pressable>
                        </View>
                      )
                    ) : null}
                  </View>
                );
              })}
              {editor && editor.leagues.length === 0 ? <Text style={styles.emptyText}>No leagues found.</Text> : null}
            </ScrollView>
          )}
        </>
      ) : market == null && !error ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error && !market ? (
        <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadMarket(); }} tintColor={colors.accent} />}
        >
          {(market && market.leagues || []).map((lg) => {
            const open = mExpanded.has(lg.leagueId);
            return (
              <View key={lg.leagueId} style={styles.card}>
                <Pressable style={styles.leagueRow} onPress={() => toggleMarketLeague(lg.leagueId)}>
                  <Text style={styles.leagueName} numberOfLines={1}>{lg.name}</Text>
                  <Text style={styles.leagueCount}>{lg.teamCount} team{lg.teamCount === 1 ? '' : 's'}</Text>
                  <Text style={styles.caret}>{open ? '⌄' : '›'}</Text>
                </Pressable>
                {open ? lg.teams.map((team) => {
                  const key = `${lg.leagueId}:${team.franchiseId}`;
                  const sel = mChecks[key] || new Set();
                  return (
                    <View key={team.franchiseId} style={styles.teamBlock}>
                      <View style={styles.teamHead}>
                        <Text style={styles.teamName} numberOfLines={1}>{team.name}</Text>
                        <Text style={styles.teamVal}>{team.value}</Text>
                      </View>
                      {team.note ? <Text style={styles.teamNote} numberOfLines={2}>{`Wants: ${team.note}`}</Text> : null}
                      {team.assets.map((a) => {
                        const on = sel.has(a.id);
                        return (
                          <Pressable key={a.id} style={styles.assetRow} onPress={() => toggleMarketAsset(key, a.id)}>
                            <Checkbox on={on} tint={colors.good} />
                            <View style={[styles.dot, { backgroundColor: a.kind === 'pick' ? colors.accent : positionColors[a.position] || colors.textDim }]} />
                            <Pressable
                              style={{ flex: 1, minWidth: 0 }}
                              onPress={a.kind !== 'pick' && onOpenPlayer ? () => onOpenPlayer(a.id) : () => toggleMarketAsset(key, a.id)}
                            >
                              <View style={styles.nameLine}>
                                <Text style={styles.assetName} numberOfLines={1}>{a.name}</Text>
                                {a.availability ? <AvailabilityBadge availability={a.availability} style={{ marginLeft: 6 }} /> : null}
                              </View>
                              <Text style={styles.assetMeta} numberOfLines={1}>
                                {a.kind === 'pick' ? 'Draft pick' : [a.position, a.team, a.age != null ? `${a.age}y` : null].filter(Boolean).join(' · ')}
                              </Text>
                            </Pressable>
                            {a.value != null ? <Text style={styles.assetVal}>{a.value}</Text> : null}
                          </Pressable>
                        );
                      })}
                      {sel.size && onProposeWith ? (
                        <Pressable
                          style={({ pressed }) => [styles.proposeBtn, pressed && { opacity: 0.85 }]}
                          onPress={() => onProposeWith({ leagueId: lg.leagueId, name: lg.name, partnerFranchiseId: team.franchiseId, receiveTokens: [...sel] })}
                        >
                          <Text style={styles.proposeTxt}>⇄ Propose trade for {sel.size} · {team.name}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                }) : null}
              </View>
            );
          })}
          {market && market.leagues.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No one’s shopping</Text>
              <Text style={styles.emptyText}>No other team has anything on their MFL trade bait across your leagues right now.</Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 60 },
  inboxLink: { color: colors.accent, fontSize: 14, fontWeight: '800', width: 60, textAlign: 'right' },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 6 },
  segment: { flexDirection: 'row', marginHorizontal: 16, marginTop: 10, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3 },
  seg: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segOn: { backgroundColor: colors.cardAlt },
  segTxt: { color: colors.textDim, fontSize: 13, fontWeight: '800' },
  segTxtOn: { color: colors.text },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 12 },
  leagueRow: { flexDirection: 'row', alignItems: 'center' },
  leagueName: { color: colors.text, fontSize: 14, fontWeight: '800', letterSpacing: 0.3, flex: 1, marginRight: 10, textTransform: 'uppercase' },
  leagueCount: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginRight: 10 },
  caret: { color: colors.textDim, fontSize: 18, fontWeight: '700', width: 14, textAlign: 'center' },
  assetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '900' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  assetName: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  assetMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  assetVal: { color: colors.gold, fontSize: 15, fontWeight: '900', marginLeft: 10, minWidth: 30, textAlign: 'right' },
  askLabel: { color: colors.textDim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 12, marginBottom: 6 },
  askInput: { backgroundColor: colors.cardAlt, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 15, padding: 12, minHeight: 52, textAlignVertical: 'top' },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  saveTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  teamBlock: { paddingTop: 10, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  teamHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  teamName: { color: colors.text, fontSize: 14, fontWeight: '800', flex: 1, marginRight: 10 },
  teamVal: { color: colors.gold, fontSize: 14, fontWeight: '900' },
  teamNote: { color: colors.textDim, fontSize: 12, fontStyle: 'italic', marginTop: 3, lineHeight: 16 },
  proposeBtn: { backgroundColor: colors.good, borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  proposeTxt: { color: '#04140a', fontSize: 14, fontWeight: '900' },
  error: { color: colors.bad, textAlign: 'center', paddingVertical: 12 },
  emptyWrap: { paddingTop: 60, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', paddingHorizontal: 24, lineHeight: 20 },
});
