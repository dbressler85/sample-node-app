import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, positionColors } from '../theme';

// Side-by-side trade view: what YOU give on the left, what you get on the right, mirrored so
// the two rosters read as a direct comparison instead of a stacked list. Shared by the trade
// inbox (a real incoming offer) and the desk builder recap (your live selection), so the same
// treatment shows whether you're reviewing an offer or constructing one.
//
// Each side is sectioned: roster players first, then draft picks grouped by year (this year,
// then each subsequent year), with a thin divider between sections so a long package doesn't
// read as one endless list. Picks sort by year → round → pick within their year.

const isPick = (a) => a.kind === 'pick' || a.position === 'PICK';
const isFaab = (a) => a.kind === 'faab' || a.position === 'FAAB';

// "Love, Josh" -> "J. Love"; a single-token name is left as-is.
function initialLast(name) {
  const parts = String(name).split(',');
  const last = (parts[0] || '').trim();
  const first = (parts[1] || '').trim();
  return first ? `${first[0]}. ${last}` : last;
}

// Parse a pick label ("2026 1.11" known slot, or "2027 1st" future) into sortable parts plus a
// short label with the year stripped (the year lives in the section header instead).
function parsePick(name) {
  const s = String(name).trim();
  const ym = s.match(/(\d{4})/);
  const year = ym ? parseInt(ym[1], 10) : 9999;
  const slot = s.match(/(\d+)\.(\d+)/); // round.pick, e.g. 1.11
  let round;
  let pick;
  if (slot) { round = parseInt(slot[1], 10); pick = parseInt(slot[2], 10); }
  else { const rm = s.match(/(\d+)\s*(?:st|nd|rd|th)/i); round = rm ? parseInt(rm[1], 10) : 99; pick = 9999; }
  const short = (ym ? s.replace(ym[1], '') : s).trim() || s;
  return { year, round, pick, short };
}

// Split a side into roster players (original order) and pick groups (by year, sorted within).
function organize(assets) {
  const players = [];
  const picks = [];
  for (const a of assets || []) (isPick(a) ? picks : players).push(a);
  const parsed = picks
    .map((a) => ({ a, ...parsePick(a.name) }))
    .sort((x, y) => x.year - y.year || x.round - y.round || x.pick - y.pick);
  const groups = [];
  for (const p of parsed) {
    let g = groups[groups.length - 1];
    if (!g || g.year !== p.year) { g = { year: p.year, picks: [] }; groups.push(g); }
    g.picks.push(p);
  }
  return { players, groups };
}

// A roster player: "J. Love" with "QB · GB · 85" beneath (position · team · value). FAAB
// (blind-bidding budget) reads as its own thing — "$20 FAAB" with a gold dot, never tappable.
function PlayerRow({ asset, right, onOpenPlayer }) {
  const faab = isFaab(asset);
  const tappable = onOpenPlayer && !isPick(asset) && !faab;
  const Row = tappable ? Pressable : View;
  const rowProps = tappable ? { onPress: () => onOpenPlayer(asset.id) } : {};
  const name = faab ? asset.name : initialLast(asset.name);
  const meta = faab
    ? `budget${asset.value != null ? ` · ${asset.value}` : ''}`
    : [asset.position, asset.team].filter(Boolean).join(' · ') + (asset.value != null ? ` · ${asset.value}` : '');
  return (
    <Row style={[styles.colRow, right && { flexDirection: 'row-reverse' }]} {...rowProps}>
      <View style={[styles.dot, { backgroundColor: faab ? colors.gold : (positionColors[asset.position] || colors.textDim) }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.colName, right && styles.alignRight]} numberOfLines={1}>{name}</Text>
        <Text style={[styles.colMeta, right && styles.alignRight]} numberOfLines={1}>{meta}</Text>
      </View>
    </Row>
  );
}

// A pick within its year group: short slot label ("1.11" / "1st") + dynasty value.
function PickRow({ entry, right }) {
  const { a, short } = entry;
  return (
    <View style={[styles.colRow, right && { flexDirection: 'row-reverse' }]}>
      <View style={[styles.dot, { backgroundColor: colors.textDim }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.colName, right && styles.alignRight]} numberOfLines={1}>{short}</Text>
        <Text style={[styles.colMeta, right && styles.alignRight]} numberOfLines={1}>{a.value != null ? `val ${a.value}` : 'pick'}</Text>
      </View>
    </View>
  );
}

function Col({ label, assets, total, onOpenPlayer, align }) {
  const right = align === 'right';
  const { players, groups } = organize(assets);
  const empty = !players.length && !groups.length;
  return (
    <View style={styles.col}>
      <Text style={[styles.colLabel, right && styles.alignRight]}>{label}{total != null ? ` · ${total}` : ''}</Text>
      {empty ? <Text style={[styles.colEmpty, right && styles.alignRight]}>—</Text> : null}
      {players.map((a) => <PlayerRow key={a.id} asset={a} right={right} onOpenPlayer={onOpenPlayer} />)}
      {groups.map((g, gi) => (
        <View key={g.year}>
          {/* Divider between roster→picks and between each pick year. */}
          {(players.length || gi > 0) ? <View style={styles.sectionDiv} /> : null}
          <Text style={[styles.sectionCap, right && styles.alignRight]}>{g.year} picks</Text>
          {g.picks.map((entry) => <PickRow key={entry.a.id} entry={entry} right={right} />)}
        </View>
      ))}
    </View>
  );
}

export default function TradeColumns({ give, get, giveTotal, getTotal, giveLabel = 'You give', getLabel = 'You get', onOpenPlayer }) {
  return (
    <View style={styles.columns}>
      <Col label={giveLabel} assets={give} total={giveTotal} onOpenPlayer={onOpenPlayer} />
      <View style={styles.divider} />
      <Col label={getLabel} assets={get} total={getTotal} onOpenPlayer={onOpenPlayer} align="right" />
    </View>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 8 },
  col: { flex: 1 },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.border, marginHorizontal: 10 },
  colLabel: { color: colors.textDim, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  colRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  colName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  colMeta: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  colEmpty: { color: colors.textDim, fontSize: 13 },
  alignRight: { textAlign: 'right' },
  // Section break between roster, this-year picks, and each subsequent year.
  sectionDiv: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 6 },
  sectionCap: { color: colors.textDim, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.8, marginBottom: 2 },
});
