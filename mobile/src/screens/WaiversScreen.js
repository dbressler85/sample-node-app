import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import AvailabilityBadge from '../components/AvailabilityBadge';

const SORTS = [
  { key: 'value', label: 'Value' },
  { key: 'projection', label: 'Proj' },
  { key: 'trend', label: 'Trend' },
];

export default function WaiversScreen({ initialLeagueId, initialPosition }) {
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(initialLeagueId || null);
  const [segment, setSegment] = useState('board'); // 'board' | 'best' | 'pending'
  const [position, setPosition] = useState(initialPosition || null);
  const [sort, setSort] = useState('value');
  const [board, setBoard] = useState(null);
  const [best, setBest] = useState(null);
  const [pending, setPending] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [claim, setClaim] = useState(null); // {leagueId, addId}

  // Bootstrap league list.
  useEffect(() => {
    (async () => {
      try {
        const res = await api.leaguesList();
        setLeagues(res.leagues);
        setLeagueId((prev) => prev || (res.leagues[0] && res.leagues[0].leagueId));
      } catch (e) {
        setError(e.message);
        setLoading(false);
      }
    })();
  }, []);

  const loadBoard = useCallback(async () => {
    if (!leagueId) return;
    setLoading(true);
    setError(null);
    try {
      setBoard(await api.waiverBoard(leagueId, { position, sort }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [leagueId, position, sort]);

  useEffect(() => {
    if (segment === 'board') loadBoard();
  }, [segment, loadBoard]);

  useEffect(() => {
    if (segment === 'best' && !best) api.bestAvailable().then(setBest).catch((e) => setError(e.message));
    if (segment === 'pending') api.waiverPending().then(setPending).catch((e) => setError(e.message));
  }, [segment, best]);

  function refreshAll() {
    setBest(null);
    if (segment === 'board') loadBoard();
    if (segment === 'pending') api.waiverPending().then(setPending);
  }

  async function cancelClaim(cid, lid) {
    try {
      await api.cancelClaim(lid, cid);
      api.waiverPending().then(setPending);
    } catch (e) {
      Alert.alert('Could not cancel', e.message);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Waivers</Text>
      </View>

      <View style={styles.segment}>
        {[
          ['board', 'Board'],
          ['best', 'Best Available'],
          ['pending', 'Pending'],
        ].map(([k, label]) => (
          <Pressable key={k} style={[styles.seg, segment === k && styles.segActive]} onPress={() => setSegment(k)}>
            <Text style={[styles.segText, segment === k && styles.segTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {segment === 'board' ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.leagueRow} contentContainerStyle={styles.leagueRowInner}>
            {leagues.map((l) => (
              <Pressable key={l.leagueId} style={[styles.leaguePill, leagueId === l.leagueId && styles.leaguePillActive]} onPress={() => setLeagueId(l.leagueId)}>
                <Text style={[styles.leaguePillText, leagueId === l.leagueId && { color: colors.text }]} numberOfLines={1}>
                  {l.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <BoardView
            board={board}
            loading={loading}
            error={error}
            position={position}
            setPosition={setPosition}
            sort={sort}
            setSort={setSort}
            onPick={(addId) => setClaim({ leagueId, addId })}
          />
        </>
      ) : segment === 'best' ? (
        <BestView best={best} onPick={(lid, addId) => setClaim({ leagueId: lid, addId })} />
      ) : (
        <PendingView pending={pending} onCancel={cancelClaim} />
      )}

      {claim ? (
        <ClaimSheet
          leagueId={claim.leagueId}
          addId={claim.addId}
          onClose={() => setClaim(null)}
          onDone={() => {
            setClaim(null);
            refreshAll();
          }}
        />
      ) : null}
    </View>
  );
}

function BoardView({ board, loading, error, position, setPosition, sort, setSort, onPick }) {
  if (loading) return <Center><ActivityIndicator color={colors.accent} size="large" /></Center>;
  if (error) return <Center><Text style={styles.error}>{error}</Text></Center>;
  if (!board) return null;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.boardMeta}>
        <SystemBadge system={board.system} />
        {board.system === 'faab' && board.settings.faabRemaining != null ? (
          <Text style={styles.metaText}>${board.settings.faabRemaining} left</Text>
        ) : null}
        {board.system === 'fcfs' && board.settings.waiverPriority ? (
          <Text style={styles.metaText}>Priority #{board.settings.waiverPriority}</Text>
        ) : null}
        <Text style={styles.metaText}>
          Roster {board.rosterCount}/{board.settings.rosterSize}
          {board.rosterFull ? ' · FULL' : ''}
        </Text>
      </View>

      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <FilterChip label="All" active={!position} onPress={() => setPosition(null)} />
          {board.positions.map((p) => (
            <FilterChip key={p} label={p} active={position === p} onPress={() => setPosition(p)} />
          ))}
          <View style={{ width: 12 }} />
          {SORTS.map((s) => (
            <FilterChip key={s.key} label={s.label} active={sort === s.key} onPress={() => setSort(s.key)} sortStyle />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={board.freeAgents}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <FaRow p={item} onPress={() => onPick(item.id)} />}
        ListEmptyComponent={<Text style={styles.empty}>No free agents match.</Text>}
      />
    </View>
  );
}

function FaRow({ p, onPress }) {
  const posColor = positionColors[p.position] || colors.textDim;
  return (
    <Pressable style={({ pressed }) => [styles.faRow, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={[styles.posBadge, { backgroundColor: posColor + '22', borderColor: posColor }]}>
        <Text style={[styles.pos, { color: posColor }]}>{p.position}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.faNameRow}>
          <Text style={styles.faName} numberOfLines={1}>
            {p.name}
          </Text>
          <AvailabilityBadge availability={p.availability} style={{ marginLeft: 6 }} />
        </View>
        <Text style={styles.faMeta}>
          {p.team}
          {p.projection != null ? ` · proj ${p.projection}` : ''}
          {p.trend ? ` · +${(p.trend / 1000).toFixed(1)}k adds` : ''}
          {p.onWaivers ? ` · waivers ${p.clearTime || ''}` : ' · free agent'}
        </Text>
      </View>
      {p.value != null ? <Text style={styles.faValue}>{p.value}</Text> : null}
      <Text style={styles.addBtn}>+ Claim</Text>
    </Pressable>
  );
}

function BestView({ best, onPick }) {
  const [openId, setOpenId] = useState(null);
  if (!best) return <Center><ActivityIndicator color={colors.accent} size="large" /></Center>;
  return (
    <FlatList
      data={best.players}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        const posColor = positionColors[item.position] || colors.textDim;
        const open = openId === item.id;
        return (
          <View style={styles.faRowWrap}>
            <Pressable style={styles.faRow} onPress={() => setOpenId(open ? null : item.id)}>
              <View style={[styles.posBadge, { backgroundColor: posColor + '22', borderColor: posColor }]}>
                <Text style={[styles.pos, { color: posColor }]}>{item.position}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.faName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.faMeta}>
                  {item.team} · free in {item.leagueCount} league{item.leagueCount === 1 ? '' : 's'}
                  {item.trend ? ` · +${(item.trend / 1000).toFixed(1)}k adds` : ''}
                </Text>
              </View>
              {item.value != null ? <Text style={styles.faValue}>{item.value}</Text> : null}
            </Pressable>
            {open ? (
              <View style={styles.leagueChoices}>
                {item.leagues.map((l) => (
                  <Pressable key={l.leagueId} style={styles.leagueChoice} onPress={() => onPick(l.leagueId, item.id)}>
                    <Text style={styles.leagueChoiceText}>{l.name}</Text>
                    <SystemBadge system={l.system} small />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        );
      }}
    />
  );
}

function PendingView({ pending, onCancel }) {
  if (!pending) return <Center><ActivityIndicator color={colors.accent} size="large" /></Center>;
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Text style={styles.subsection}>Pending claims · {pending.summary.pending}</Text>
      {pending.pending.length === 0 ? <Text style={styles.empty}>No pending claims.</Text> : null}
      {pending.pending.map((c) => (
        <View key={`${c.leagueId}-${c.id}`} style={styles.pendRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pendAdd}>
              + {c.add ? c.add.name : '—'}
              {c.bid != null ? <Text style={styles.pendBid}>  ${c.bid}</Text> : null}
              {c.priority != null ? <Text style={styles.pendBid}>  #{c.priority}</Text> : null}
            </Text>
            {c.drop ? <Text style={styles.pendDrop}>− {c.drop.name}</Text> : null}
            <Text style={styles.pendLeague}>{c.leagueName} · {c.processTime || 'pending'}</Text>
          </View>
          <Pressable onPress={() => onCancel(c.id, c.leagueId)} hitSlop={8}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
      ))}

      {pending.results.length ? <Text style={styles.subsection}>Recent results</Text> : null}
      {pending.results.map((r, i) => (
        <View key={i} style={styles.resultRow}>
          <Text style={[styles.resultTag, { color: r.result === 'won' ? colors.good : colors.bad }]}>
            {r.result === 'won' ? 'WON' : 'LOST'}
          </Text>
          <Text style={styles.resultText} numberOfLines={1}>
            {r.add}
            {r.bid != null ? ` · $${r.bid}` : ''} · {r.leagueName}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

function ClaimSheet({ leagueId, addId, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [bench, setBench] = useState([]);
  const [dropId, setDropId] = useState(null);
  const [bid, setBid] = useState(null);
  const [changingDrop, setChangingDrop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async (overrides = {}) => {
    try {
      const body = { addId };
      const d = 'dropId' in overrides ? overrides.dropId : dropId;
      const b = 'bid' in overrides ? overrides.bid : bid;
      if (d) body.dropId = d;
      if (b != null && b !== '') body.bid = Number(b);
      const p = await api.previewClaim(leagueId, body);
      setPreview(p);
      if (bid == null && p.suggestedBid != null) setBid(String(p.suggestedBid));
      if (!dropId && p.drop) setDropId(p.drop.id);
    } catch (e) {
      setError(e.message);
    }
  }, [addId, leagueId, dropId, bid]);

  useEffect(() => {
    refresh();
    api.roster(leagueId).then((r) => setBench(r.bench || [])).catch(() => {});
  }, [leagueId, addId]);

  async function submit() {
    setBusy(true);
    try {
      const body = { addId };
      if (dropId) body.dropId = dropId;
      if (bid != null && bid !== '') body.bid = Number(bid);
      const res = await api.submitClaim(leagueId, body);
      Alert.alert('Claim submitted', `${res.submitted.add.name}${res.submitted.bid != null ? ` for $${res.submitted.bid}` : ''}.`);
      onDone();
    } catch (e) {
      Alert.alert('Could not submit', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        {!preview ? (
          <ActivityIndicator color={colors.accent} style={{ paddingVertical: 30 }} />
        ) : (
          <>
            <Text style={styles.sheetTitle}>Claim {preview.add ? preview.add.name : ''}</Text>
            <Text style={styles.sheetSub}>
              {preview.name} · <SystemInline system={preview.system} />
              {preview.immediate ? ' · adds immediately' : preview.clearTime ? ` · ${preview.clearTime}` : ''}
            </Text>

            {/* Drop */}
            <Text style={styles.fieldLabel}>{preview.dropRequired ? 'Drop (required — roster full)' : 'Drop (optional)'}</Text>
            <Pressable style={styles.dropBox} onPress={() => setChangingDrop((v) => !v)}>
              <Text style={styles.dropText}>
                {preview.drop ? `− ${preview.drop.name}${preview.drop.value != null ? ` (${preview.drop.value})` : ''}` : 'None'}
              </Text>
              <Text style={styles.change}>{changingDrop ? 'Close' : 'Change'}</Text>
            </Pressable>
            {changingDrop ? (
              <ScrollView style={{ maxHeight: 150 }}>
                {bench.map((p) => (
                  <Pressable
                    key={p.id}
                    style={styles.benchRow}
                    onPress={() => {
                      setDropId(p.id);
                      setChangingDrop(false);
                      refresh({ dropId: p.id });
                    }}
                  >
                    <Text style={styles.benchName}>{p.name} <Text style={styles.benchMeta}>{p.position} · {p.value}</Text></Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {/* Bid (faab) */}
            {preview.system === 'faab' ? (
              <>
                <Text style={styles.fieldLabel}>FAAB bid{preview.suggestedBid != null ? ` · suggested $${preview.suggestedBid}` : ''}</Text>
                <View style={styles.bidRow}>
                  <Stepper onPress={() => { const n = Math.max(0, Number(bid || 0) - 1); setBid(String(n)); refresh({ bid: n }); }} label="−" />
                  <TextInput
                    style={styles.bidInput}
                    keyboardType="number-pad"
                    value={bid == null ? '' : String(bid)}
                    onChangeText={(t) => setBid(t.replace(/[^0-9]/g, ''))}
                    onEndEditing={() => refresh({ bid: Number(bid || 0) })}
                  />
                  <Stepper onPress={() => { const n = Number(bid || 0) + 1; setBid(String(n)); refresh({ bid: n }); }} label="+" />
                  {preview.budgetAfter != null ? <Text style={styles.budgetAfter}>${preview.budgetAfter} left after</Text> : null}
                </View>
              </>
            ) : null}

            {preview.errors && preview.errors.length ? (
              <Text style={styles.sheetError}>{preview.errors.join(' ')}</Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.confirm, !preview.valid && styles.confirmOff, pressed && preview.valid && { opacity: 0.85 }]}
              onPress={submit}
              disabled={!preview.valid || busy}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>{preview.immediate ? 'Add Player' : 'Submit Claim'}</Text>}
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </>
        )}
      </Pressable>
    </Pressable>
  );
}

function Center({ children }) {
  return <View style={styles.center}>{children}</View>;
}
function FilterChip({ label, active, onPress, sortStyle }) {
  return (
    <Pressable style={[styles.filterChip, active && styles.filterChipActive, sortStyle && styles.sortChip]} onPress={onPress}>
      <Text style={[styles.filterText, active && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}
function Stepper({ onPress, label }) {
  return (
    <Pressable style={styles.stepper} onPress={onPress}>
      <Text style={styles.stepperText}>{label}</Text>
    </Pressable>
  );
}
const SYS = { faab: { label: 'FAAB', color: colors.accent }, fcfs: { label: 'FCFS', color: colors.warn }, free: { label: 'Free agent', color: colors.good } };
function SystemBadge({ system, small }) {
  const s = SYS[system] || SYS.free;
  return <Text style={[styles.sysBadge, { color: s.color, borderColor: s.color }, small && { fontSize: 9 }]}>{s.label}</Text>;
}
function SystemInline({ system }) {
  const s = SYS[system] || SYS.free;
  return <Text style={{ color: s.color, fontWeight: '800' }}>{s.label}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  segment: { flexDirection: 'row', marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3, marginBottom: 8 },
  seg: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segActive: { backgroundColor: colors.cardAlt },
  segText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  segTextActive: { color: colors.text },
  leagueRow: { maxHeight: 44, marginBottom: 4 },
  leagueRowInner: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  leaguePill: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 8, maxWidth: 180 },
  leaguePillActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  leaguePillText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  boardMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8 },
  metaText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  filterRow: { paddingLeft: 16, paddingVertical: 6 },
  filterChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 6 },
  filterChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  sortChip: { borderStyle: 'dashed' },
  filterText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 4 },
  faRowWrap: { marginBottom: 10 },
  faRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10 },
  posBadge: { width: 40, paddingVertical: 2, borderRadius: 6, borderWidth: 1, alignItems: 'center', marginRight: 10 },
  pos: { fontSize: 11, fontWeight: '800' },
  faNameRow: { flexDirection: 'row', alignItems: 'center' },
  faName: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  faMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  faValue: { color: colors.accent, fontSize: 15, fontWeight: '900', marginHorizontal: 10 },
  addBtn: { color: colors.good, fontSize: 12, fontWeight: '800' },
  leagueChoices: { marginTop: -4, marginBottom: 10, marginLeft: 12, gap: 6 },
  leagueChoice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cardAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  leagueChoiceText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  subsection: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 12, marginBottom: 8 },
  pendRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  pendAdd: { color: colors.good, fontSize: 15, fontWeight: '700' },
  pendBid: { color: colors.accent, fontWeight: '900' },
  pendDrop: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  pendLeague: { color: colors.accent, fontSize: 12, marginTop: 4, fontWeight: '600' },
  cancel: { color: colors.bad, fontSize: 13, fontWeight: '700' },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  resultTag: { fontSize: 11, fontWeight: '900', width: 46 },
  resultText: { color: colors.textDim, fontSize: 13, flex: 1 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 24 },
  error: { color: colors.bad, textAlign: 'center' },
  sysBadge: { fontSize: 10, fontWeight: '900', borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  // sheet
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderTopWidth: 1, borderColor: colors.border },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sheetSub: { color: colors.textDim, fontSize: 13, marginTop: 2, marginBottom: 8 },
  fieldLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  dropBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.cardAlt, borderRadius: 10, padding: 12 },
  dropText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  change: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  benchRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  benchName: { color: colors.text, fontSize: 14 },
  benchMeta: { color: colors.textDim, fontSize: 12 },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepper: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  stepperText: { color: colors.text, fontSize: 20, fontWeight: '900' },
  bidInput: { backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, color: colors.text, fontSize: 18, fontWeight: '800', minWidth: 70, textAlign: 'center' },
  budgetAfter: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  sheetError: { color: colors.bad, fontSize: 13, marginTop: 12 },
  confirm: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  confirmOff: { backgroundColor: colors.cardAlt },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  cancelBtn: { alignItems: 'center', paddingTop: 14 },
  cancelText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
});
