import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Image, Linking } from 'react-native';
import { appAlert } from "../components/AppAlert";
import { api } from '../api';
import { colors, positionColors, rgb } from '../theme';
import { displayLabel } from '../typography';
import AvailabilityBadge from '../components/AvailabilityBadge';
import AddAcrossSheet from '../components/AddAcrossSheet';
import TradeAcrossSheet from '../components/TradeAcrossSheet';
import TradeBaitSheet from '../components/TradeBaitSheet';
import BottomSheet from '../components/BottomSheet';
import Checkbox from '../components/Checkbox';
import { TargetIcon, AvoidIcon, WatchIcon, NeonToggle } from '../components/PlayerActionIcons';
import useAndroidBack from '../useAndroidBack';
import useCachedResource from '../useCachedResource';
import { STALE } from '../staleTiers';
import PartialNote from '../components/PartialNote';
import ValueCredit from '../components/ValueCredit';
import NewsCredit from '../components/NewsCredit';

const RELATION = {
  rostered: { label: 'Rostered', color: colors.good },
  free: { label: 'Free agent', color: colors.good },
  draftable: { label: 'Draftable', color: colors.warn }, // draft not held yet — not claimable until it is
  dropped: { label: 'Dropped', color: colors.textDim },
  unavailable: { label: 'Not available', color: colors.textDim },
};

// A round headshot with the position badge tucked in the corner. Falls back to the plain
// position badge if there's no photo URL or the image fails to load, so it never blanks.
function PlayerAvatar({ photoUrl, position, size = 54 }) {
  const [failed, setFailed] = useState(false);
  const posColor = positionColors[position] || colors.textDim;
  if (photoUrl && !failed) {
    return (
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, borderColor: posColor }]}>
        <Image
          source={{ uri: photoUrl }}
          style={{ width: size - 4, height: size - 4, borderRadius: (size - 4) / 2 }}
          onError={() => setFailed(true)}
        />
        <View style={[styles.avatarPos, { backgroundColor: posColor }]}>
          <Text style={styles.avatarPosText}>{position}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.posBadge, { backgroundColor: posColor + '22', borderColor: posColor }]}>
      <Text style={[styles.pos, { color: posColor }]}>{position}</Text>
    </View>
  );
}

// "Drafted 2020 · Rd 1, Pk 22" (round/pick optional); null when the year is unknown (undrafted).
function draftLabel(p) {
  if (!p || !p.draftYear) return null;
  if (!p.draftRound) return `Drafted ${p.draftYear}`;
  return `Drafted ${p.draftYear} · Rd ${p.draftRound}${p.draftPick ? `, Pk ${p.draftPick}` : ''}`;
}

function diffColor(d) {
  if (d == null) return colors.textDim;
  if (d <= 4) return colors.good;
  if (d <= 6) return colors.warn;
  return colors.bad;
}

function newsColor(severity) {
  if (severity === 'high') return colors.bad;
  if (severity === 'medium') return colors.warn;
  return colors.textDim;
}

// Prior-season box score: one line per category present (passing / rushing / receiving).
function PriorStatLines({ stats }) {
  const rows = [];
  if (stats.passing && (stats.passing.att || stats.passing.yds)) {
    const p = stats.passing;
    rows.push({ key: 'pass', label: 'Passing', parts: [`${p.cmp}/${p.att} cmp`, `${p.yds} yds`, `${p.td} TD`] });
  }
  if (stats.rushing && (stats.rushing.att || stats.rushing.yds)) {
    const r = stats.rushing;
    rows.push({ key: 'rush', label: 'Rushing', parts: [`${r.att} att`, `${r.yds} yds`, `${r.td} TD`] });
  }
  if (stats.receiving && (stats.receiving.rec || stats.receiving.yds)) {
    const c = stats.receiving;
    rows.push({ key: 'rec', label: 'Receiving', parts: [`${c.rec} rec`, `${c.yds} yds`, `${c.td} TD`] });
  }
  if (!rows.length) return null;
  return (
    <View style={styles.statLines}>
      {rows.map((row) => (
        <View key={row.key} style={styles.statLine}>
          <Text style={styles.statLineLabel}>{row.label}</Text>
          <Text style={styles.statLineVals}>{row.parts.join('  ·  ')}</Text>
        </View>
      ))}
    </View>
  );
}

export default function PlayerProfileScreen({ playerId, seed, onBack, onOpenTradeDesk, onOpenTradeWizard, onCompare, onStartWaiverWizard }) {
  // The cross-league profile is a heavy read (per-league value snapshots), so it runs through the
  // shared cache hook: a warm remount (reopening the same player) paints instantly from memory,
  // reloads are throttled, and a failed refresh keeps the last profile (C1/C2/C4). The key is
  // per-player, so switching players paints that player's own cached value. `reload` after an
  // add/drop reflects the action in the cross-league standing (C3). If nothing is cached yet, a
  // `seed` from the caller (name/pos/team/value) still fills the header immediately.
  // A profile's slow-movers (bio, value ~12h, prior-season stats) don't need a 45s re-check; an hour is
  // plenty, and any add/drop/tag write refreshes it on the next open.
  const { data: p, error, reload } = useCachedResource(`player:profile:${playerId}`, () => api.playerProfile(playerId), { staleMs: STALE.SLOW });
  const [sheet, setSheet] = useState(null); // 'add' | 'drop' | 'trade'
  const [watched, setWatched] = useState(false);
  const [tag, setTag] = useState(null); // 'target' | 'avoid' | null

  // Keep the personal Watch/Target/Avoid controls in step with the loaded profile — reseeded
  // whenever a fresh (or cached) profile paints. The optimistic toggles below don't touch `p`,
  // so they survive until the next real profile update reseeds these.
  useEffect(() => {
    if (p) { setWatched(!!p.watched); setTag(p.tag || null); }
  }, [p]);

  // Star / unstar — optimistic, reverts on failure.
  const toggleWatch = useCallback(() => {
    const next = !watched;
    setWatched(next);
    const call = next ? api.watchAdd(playerId) : api.watchRemove(playerId);
    call.catch((e) => { setWatched(!next); appAlert('Could not update watchlist', e.message); });
  }, [watched, playerId]);

  // Target / Avoid — tapping the current tag clears it. Optimistic, reverts on failure.
  const applyTag = useCallback((which) => {
    const next = tag === which ? null : which;
    const prev = tag;
    setTag(next);
    api.setTag(playerId, next).catch((e) => { setTag(prev); appAlert('Could not update tag', e.message); });
  }, [tag, playerId]);

  // Back closes an open action sheet before leaving the profile.
  useAndroidBack(useCallback(() => {
    if (sheet) {
      setSheet(null);
      return true;
    }
    return false;
  }, [sheet]));

  if (error && !p) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.error}>{error}</Text>
        <Pressable onPress={onBack} style={styles.backBtn}><Text style={styles.backText}>Go back</Text></Pressable>
      </View>
    );
  }
  if (!p) {
    // No cached profile yet. If the caller handed us a seed, paint the header from it and
    // spin only the body — so the tap feels instant instead of opening onto a blank screen.
    const sposColor = seed ? (positionColors[seed.position] || colors.textDim) : colors.textDim;
    return (
      <View style={styles.container}>
        <View style={styles.topbar}>
          <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Back</Text></Pressable>
        </View>
        {seed ? (
          <View style={styles.body}>
            <View style={styles.idRow}>
              <PlayerAvatar position={seed.position} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{seed.name}</Text>
                {seed.team ? <Text style={styles.sub}>{seed.team}</Text> : null}
              </View>
              {seed.value != null ? (
                <View style={styles.valueBox}>
                  <Text style={styles.valueNum}>{seed.value}</Text>
                  <Text style={styles.valueLabel}>dynasty value</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      </View>
    );
  }

  const posColor = positionColors[p.position] || colors.textDim;
  const canAdd = p.actions.addLeagues.length > 0;
  const canDrop = p.actions.dropLeagues.length > 0;
  // Shop = put him on your trade block. Available in any league you roster him (same set as Drop).
  const canShop = canDrop;
  // He's a trade target wherever another team owns him.
  const tradeLeagues = p.crossLeague.filter((c) => c.relation === 'unavailable').length;
  const canTrade = tradeLeagues > 0;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Players</Text></Pressable>
        {onCompare ? (
          <Pressable onPress={() => onCompare({ id: p.id, name: p.name })} hitSlop={10}>
            <Text style={styles.compareLink}>⚖ Compare</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Identity */}
        <View style={styles.idRow}>
          <PlayerAvatar photoUrl={p.photoUrl} position={p.position} />
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
              <AvailabilityBadge availability={p.availability} style={{ marginLeft: 8 }} />
            </View>
            <Text style={styles.sub}>
              {p.team}{p.age != null ? ` · age ${p.age}` : ''}{p.byeWeek ? ` · bye ${p.byeWeek}` : ''}
              {p.posRank ? ` · ${p.position}${p.posRank}` : ''}
            </Text>
            {draftLabel(p) ? <Text style={styles.draft}>{draftLabel(p)}</Text> : null}
          </View>
          {p.value != null ? (
            <Pressable
              style={styles.valueBox}
              hitSlop={8}
              onPress={() =>
                appAlert(
                  'Dynasty value',
                  `A player's trade value on the dynasty market, priced for each league's format — 2QB (Superflex) and PPR raise a player's worth, so the same player is valued differently in each of your leagues.\n\n${
                    p.valueRange && p.valueRange.min !== p.valueRange.max
                      ? `“${p.valueRange.min}–${p.valueRange.max} across leagues” is the spread: ${p.valueRange.min} in your lowest-valuing league, ${p.valueRange.max} in your highest. The big number is the value in the league you opened.`
                      : 'The number is this player’s value in the league you opened.'
                  }`
                )
              }
            >
              <Text style={styles.valueNum}>{p.value}</Text>
              <Text style={styles.valueLabel}>dynasty value ⓘ</Text>
              {p.valueRange && p.valueRange.min !== p.valueRange.max ? (
                <Text style={styles.valueSpread}>{p.valueRange.min}–{p.valueRange.max} across leagues</Text>
              ) : null}
            </Pressable>
          ) : null}
        </View>

        {/* Both value lenses side by side: there's no single league to pick on a profile, so show
            what this player is worth in a 1QB market vs a Superflex one (docs/DATA_SOURCES.md Q3). */}
        {p.values && (p.values['1qb'] != null || p.values.sf != null) ? (
          <View style={styles.lensValues}>
            <View style={styles.lensValCell}>
              <Text style={styles.lensValNum}>{p.values['1qb'] != null ? p.values['1qb'] : '—'}</Text>
              <Text style={styles.lensValLabel}>1QB value</Text>
            </View>
            <View style={styles.lensValDivider} />
            <View style={styles.lensValCell}>
              <Text style={styles.lensValNum}>{p.values.sf != null ? p.values.sf : '—'}</Text>
              <Text style={styles.lensValLabel}>2QB value</Text>
            </View>
          </View>
        ) : null}

        {/* Win-now (redraft) value + 30-day value momentum, both from FantasyCalc — the dynasty number
            is the future, these two are "this season" and "which way is he trending." */}
        {p.winNow != null || p.valueTrend != null ? (
          <View style={styles.lensValues}>
            <View style={styles.lensValCell}>
              <Text style={styles.lensValNum}>{p.winNow != null ? p.winNow : '—'}</Text>
              <Text style={styles.lensValLabel}>Win-now value</Text>
            </View>
            <View style={styles.lensValDivider} />
            <View style={styles.lensValCell}>
              <Text style={[styles.lensValNum, p.valueTrend > 0 ? { color: colors.good } : p.valueTrend < 0 ? { color: colors.bad } : null]}>
                {p.valueTrend != null && p.valueTrend !== 0
                  ? `${p.valueTrend > 0 ? '▲' : '▼'} ${Math.abs(p.valueTrend)}`
                  : p.valueTrend === 0 ? '◆ 0' : '—'}
              </Text>
              <Text style={styles.lensValLabel}>30-day trend</Text>
            </View>
          </View>
        ) : null}

        {/* One control set: Target / Avoid tint your personal value (±10%); Watch tracks
            him on your watchlist. Tap an active Target/Avoid again to clear. */}
        <View style={styles.tagRow}>
          <Pressable style={[styles.tagBtn, tag === 'target' && styles.tagTargetOn]} onPress={() => applyTag('target')} accessibilityRole="button" accessibilityState={{ selected: tag === 'target' }} accessibilityLabel={tag === 'target' ? 'Clear target' : 'Target this player'}>
            <NeonToggle active={tag === 'target'} triplet={rgb.good} renderGlyph={(on) => <TargetIcon size={17} color={on ? colors.good : colors.textDim} glow={on} />} />
            <Text style={[styles.tagTxt, tag === 'target' && styles.tagTxtOn]}>Target</Text>
          </Pressable>
          <Pressable style={[styles.tagBtn, tag === 'avoid' && styles.tagAvoidOn]} onPress={() => applyTag('avoid')} accessibilityRole="button" accessibilityState={{ selected: tag === 'avoid' }} accessibilityLabel={tag === 'avoid' ? 'Clear avoid' : 'Avoid this player'}>
            <NeonToggle active={tag === 'avoid'} triplet={rgb.bad} renderGlyph={(on) => <AvoidIcon size={17} color={on ? colors.bad : colors.textDim} glow={on} />} />
            <Text style={[styles.tagTxt, tag === 'avoid' && styles.tagTxtOn]}>Avoid</Text>
          </Pressable>
          <Pressable style={[styles.tagBtn, watched && styles.tagWatchOn]} onPress={toggleWatch} accessibilityRole="button" accessibilityState={{ selected: watched }} accessibilityLabel={watched ? 'Remove from watchlist' : 'Add to watchlist'}>
            <NeonToggle active={watched} triplet={rgb.watch} renderGlyph={(on) => <WatchIcon size={17} color={on ? colors.watch : colors.textDim} filled={on} glow={on} />} />
            <Text style={[styles.tagTxt, watched && styles.tagTxtOn]}>Watch</Text>
          </Pressable>
        </View>
        {/* Make the Target/Avoid ±10% effect VISIBLE, not just a code comment (usability backlog #23):
            show what the tag does to HIS value FOR YOU next to the honest market number. */}
        {tag && p.value != null ? (
          <Text style={styles.tagEffect}>
            <Text style={{ color: tag === 'target' ? colors.good : colors.bad, fontWeight: '800' }}>
              {tag === 'target' ? 'Target · +10% for you' : 'Avoid · −10% for you'}
            </Text>
            {`  →  your value ${Math.round(p.value * (tag === 'target' ? 1.1 : 0.9))} `}
            <Text style={styles.tagEffectDim}>(market {p.value})</Text>
          </Text>
        ) : null}

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

        {/* Prior season — what they actually produced last year: fantasy points, PPG, games, and the
            real box score. When we can't resolve any prior-year data we still show the card with a
            clear empty state (not a silently missing card). */}
        {p.priorSeason ? (
          <Card title={`${p.priorSeason.year} season`}>
            {p.priorSeason.points != null || p.priorSeason.games != null || p.priorSeason.stats ? (
              <>
                <View style={styles.priorRow}>
                  <View style={styles.priorCell}>
                    <Text style={styles.priorNum}>{p.priorSeason.points != null ? p.priorSeason.points : '—'}</Text>
                    <Text style={styles.priorLbl}>fantasy pts</Text>
                  </View>
                  {p.priorSeason.games ? (
                    <View style={styles.priorCell}>
                      <Text style={styles.priorNum}>{p.priorSeason.games}</Text>
                      <Text style={styles.priorLbl}>games</Text>
                    </View>
                  ) : null}
                  {p.priorSeason.ppg != null ? (
                    <View style={styles.priorCell}>
                      <Text style={styles.priorNum}>{p.priorSeason.ppg}</Text>
                      <Text style={styles.priorLbl}>ppg</Text>
                    </View>
                  ) : null}
                </View>
                {p.priorSeason.stats ? <PriorStatLines stats={p.priorSeason.stats} /> : null}
              </>
            ) : (
              <Text style={styles.priorEmpty}>No {p.priorSeason.year} stats available for this player.</Text>
            )}
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
          {/* Honesty: this map covers the leagues we could read — say so instead of implying it's all of them. */}
          <PartialNote loaded={p.leaguesLoaded} total={p.leaguesTotal} onRetry={reload} />
        </Card>

        {/* Recent news — at the bottom. Tapping a headline opens the source story. */}
        {p.news.length ? (
          <Card title="Recent news">
            {p.news.map((n) => (
              <Pressable
                key={n.id}
                disabled={!n.url}
                onPress={() => n.url && Linking.openURL(n.url).catch(() => {})}
                style={({ pressed }) => [styles.newsRow, pressed && n.url && { opacity: 0.6 }]}
              >
                <View style={[styles.newsDot, { backgroundColor: newsColor(n.severity) }]} />
                <Text style={styles.news}>
                  {n.headline}
                  {n.url ? <Text style={styles.newsLink}>  ›</Text> : null}
                </Text>
              </Pressable>
            ))}
            <NewsCredit style={{ marginTop: 6 }} />
          </Card>
        ) : null}

        <ValueCredit center style={{ marginTop: 4 }} />
        <View style={{ height: 90 }} />
      </ScrollView>

      {/* Action bar */}
      {canAdd || canTrade || canDrop ? (
        <View style={styles.actionBar}>
          {/* Shop and Drop carry the same count (both act over the leagues you roster him), so spell out
              that they're NOT the same action — one keeps him, one lets him go (usability backlog #23). */}
          {canShop && canDrop ? (
            <Text style={styles.actionHint}>Shop lists him on your trade block (he stays yours) · Drop releases him to free agency</Text>
          ) : null}
          {/* Consistent labels: Add (N) · Trade for (N) · Shop (N) · Drop (N) — each count is the number
              of your leagues that action applies to. */}
          <View style={styles.actionRow}>
            {canAdd ? (
              <Pressable style={[styles.actionBtn, { backgroundColor: colors.accent }]} onPress={() => setSheet('add')}>
                <Text style={styles.actionText}>Add ({p.actions.addLeagues.length})</Text>
              </Pressable>
            ) : null}
            {canTrade ? (
              <Pressable style={[styles.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent }]} onPress={() => setSheet('trade')}>
                <Text style={[styles.actionText, { color: colors.accent }]}>Trade for ({tradeLeagues})</Text>
              </Pressable>
            ) : null}
            {canShop ? (
              <Pressable style={[styles.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent }]} onPress={() => setSheet('bait')}>
                <Text style={[styles.actionText, { color: colors.accent }]}>Shop ({p.actions.dropLeagues.length})</Text>
              </Pressable>
            ) : null}
            {canDrop ? (
              <Pressable style={[styles.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.bad }]} onPress={() => setSheet('drop')}>
                <Text style={[styles.actionText, { color: colors.bad }]}>Drop ({p.actions.dropLeagues.length})</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Add ALWAYS routes through the waiver wizard's review step (never a silent one-tap file): a
          FAAB bid and the drop are decisions the owner must see and adjust before anything is filed —
          the same editable flow the Players/Best-Available path uses (onReview handoff). */}
      {sheet === 'add' ? (
        <AddAcrossSheet
          player={p}
          onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); reload(); }}
          onReview={onStartWaiverWizard ? (player, stubs) => { setSheet(null); onStartWaiverWizard(stubs, player.id); } : undefined}
        />
      ) : null}
      {sheet === 'trade' ? (
        <TradeAcrossSheet
          player={p}
          onClose={() => setSheet(null)}
          onCraft={(ctx) => { setSheet(null); onOpenTradeDesk && onOpenTradeDesk(ctx); }}
          onStartWizard={(queue) => { setSheet(null); onOpenTradeWizard && onOpenTradeWizard(queue); }}
        />
      ) : null}
      {sheet === 'bait' ? <TradeBaitSheet player={p} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} /> : null}
      {sheet === 'drop' ? <DropSheet player={p} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} /> : null}
    </View>
  );
}

function Card({ title, children }) {
  return (
    <View style={styles.card}>
      <Text style={[styles.cardTitle, displayLabel()]}>{title}</Text>
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
      appAlert('Dropped', `${player.name} dropped in ${res.summary.dropped} league${res.summary.dropped === 1 ? '' : 's'}.`);
      onDone();
    } catch (e) {
      appAlert('Could not drop', e.message);
    } finally {
      setBusy(false);
    }
  }

  // Dropping releases the player to free agency in each chosen league — hard to undo (he
  // can be claimed immediately). Require an explicit, named confirmation first.
  function submit() {
    const n = selected.size;
    const where = n === 1 ? 'this league' : `${n} leagues`;
    appAlert(
      `Drop ${player.name}?`,
      `This releases him to free agency in ${where}. Another team can claim him right away.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Drop from ${where}`, style: 'destructive', onPress: doDrop },
      ]
    );
  }

  return (
    <BottomSheet onClose={onClose}>
      <Text style={styles.sheetTitle}>Drop {player.name}</Text>
      <Text style={styles.sheetSub}>Choose leagues to drop him from.</Text>
      {/* Scrollable within the bounded sheet: a widely-rostered player can span many leagues without
          pushing the title off the top edge. */}
      <ScrollView style={styles.dropScroll} contentContainerStyle={styles.dropScrollContent} showsVerticalScrollIndicator>
        {leagues.map((l) => {
          const on = selected.has(l.leagueId);
          return (
            <Pressable
              key={l.leagueId}
              style={styles.addRow}
              onPress={() => setSelected((s) => { const n = new Set(s); if (n.has(l.leagueId)) n.delete(l.leagueId); else n.add(l.leagueId); return n; })}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${l.name} (${l.bucket})`}
            >
              <Checkbox checked={on} size={24} color={colors.bad} style={styles.check} />
              <Text style={styles.addLeague}>{l.name} <Text style={styles.addMeta}>({l.bucket})</Text></Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable
        style={({ pressed }) => [styles.confirm, { backgroundColor: colors.bad }, (!selected.size || busy) && styles.confirmOff, pressed && selected.size && { opacity: 0.85 }]}
        onPress={submit}
        disabled={!selected.size || busy}
      >
        {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.confirmText}>Drop from {selected.size} league{selected.size === 1 ? '' : 's'}</Text>}
      </Pressable>
      <Pressable style={styles.cancelBtn} onPress={onClose}><Text style={styles.cancelText}>Cancel</Text></Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  compareLink: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  star: { color: colors.textDim, fontSize: 14, fontWeight: '800' },
  starOn: { color: colors.gold },
  body: { padding: 16 },
  idRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  posBadge: { width: 48, paddingVertical: 4, borderRadius: 8, borderWidth: 1, alignItems: 'center', marginRight: 12 },
  pos: { fontSize: 13, fontWeight: '900' },
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, marginRight: 12, backgroundColor: colors.card },
  avatarPos: { position: 'absolute', bottom: -2, right: -2, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1, borderWidth: 2, borderColor: colors.bg },
  avatarPosText: { color: colors.onAccent, fontSize: 9, fontWeight: '900' },
  draft: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.text, fontSize: 22, fontWeight: '900', flexShrink: 1 },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 3 },
  valueBox: { alignItems: 'center', marginLeft: 10 },
  valueNum: { color: colors.gold, fontSize: 24, fontWeight: '900' },
  valueLabel: { color: colors.violetText, fontSize: 10, fontWeight: '700' },
  valueSpread: { color: colors.gold, fontSize: 10, fontWeight: '700', marginTop: 2, maxWidth: 92, textAlign: 'center' },
  lensValues: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, marginTop: 12 },
  lensValCell: { flex: 1, alignItems: 'center' },
  lensValNum: { color: colors.gold, fontSize: 20, fontWeight: '900' },
  lensValLabel: { color: colors.violetText, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  lensValDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  tagRow: { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 4 },
  tagBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  // Active = the neon glow recipe (edge + wash + iOS halo). Android ignores shadow* with no elevation,
  // so the edge + wash carry it there. (watch was wrongly on gold — gold is reserved for value.)
  tagTargetOn: { borderColor: colors.good, backgroundColor: colors.good + '22', shadowColor: colors.good, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  tagAvoidOn: { borderColor: colors.bad, backgroundColor: colors.bad + '22', shadowColor: colors.bad, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  tagWatchOn: { borderColor: colors.watch, backgroundColor: colors.watch + '22', shadowColor: colors.watch, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  tagTxt: { color: colors.textDim, fontSize: 13, fontWeight: '800' },
  // Makes the Target/Avoid ±10% personal adjustment visible next to the honest market value (#23).
  tagEffect: { color: colors.text, fontSize: 12, fontWeight: '700', marginTop: 2, marginBottom: 6 },
  tagEffectDim: { color: colors.textDim, fontWeight: '600' },
  tagTxtOn: { color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 12 },
  cardTitle: { color: colors.violetText, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
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
  news: { color: colors.text, fontSize: 13, lineHeight: 18, flex: 1 },
  newsRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  newsDot: { width: 7, height: 7, borderRadius: 4, marginTop: 5, marginRight: 8 },
  newsLink: { color: colors.accent, fontWeight: '800' },
  priorRow: { flexDirection: 'row', justifyContent: 'space-around' },
  priorCell: { alignItems: 'center', flex: 1 },
  priorNum: { color: colors.text, fontSize: 20, fontWeight: '900' },
  priorLbl: { color: colors.textDim, fontSize: 11, fontWeight: '700', marginTop: 2 },
  priorEmpty: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  statLines: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10, gap: 6 },
  statLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statLineLabel: { color: colors.textDim, fontSize: 12, fontWeight: '800', width: 76 },
  statLineVals: { color: colors.text, fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },
  clRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  clName: { color: colors.text, fontSize: 14, flex: 1 },
  clRel: { fontSize: 12, fontWeight: '700', marginRight: 10 },
  clValue: { color: colors.gold, fontSize: 13, fontWeight: '900', width: 34, textAlign: 'right' },
  clProj: { color: colors.textDim, fontSize: 13, fontWeight: '800', width: 40, textAlign: 'right' },
  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
  actionRow: { flexDirection: 'row', gap: 10 },
  // Disambiguates the same-count Shop vs Drop buttons above the bar (#23).
  actionHint: { color: colors.textDim, fontSize: 11, lineHeight: 15, fontWeight: '600', marginBottom: 8 },
  actionBtn: { flex: 1, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  actionText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  error: { color: colors.bad, textAlign: 'center', marginBottom: 16 },
  backBtn: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  backText: { color: colors.text, fontWeight: '600' },
  // Drop sheet (shell + check come from the shared BottomSheet / Checkbox primitives)
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sheetSub: { color: colors.textDim, fontSize: 13, marginTop: 2, marginBottom: 8 },
  dropScroll: { flexShrink: 1 },
  dropScrollContent: { paddingBottom: 4 },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  check: { marginRight: 12 },
  addLeague: { color: colors.text, fontSize: 15, fontWeight: '700' },
  addMeta: { color: colors.textDim, fontSize: 12, marginTop: 2, fontWeight: '500' },
  confirm: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  confirmOff: { backgroundColor: colors.cardAlt },
  confirmText: { color: colors.onAccent, fontSize: 16, fontWeight: '800' },
  tip: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 10 },
  cancelBtn: { alignItems: 'center', paddingTop: 14 },
  cancelText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
});
