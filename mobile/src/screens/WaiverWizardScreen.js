import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { appAlert } from "../components/AppAlert";
import { useRequirePro } from '../entitlement';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import Button from '../components/Button';
import { TopbarTitle } from '../components/Brand';
import AvailabilityBadge from '../components/AvailabilityBadge';
import BidPlanRow from '../components/BidPlanRow';
import ValueDelta from '../components/ValueDelta';
import NeonSign from '../components/NeonSign';
import { toast } from '../components/Toast';
import useAndroidBack from '../useAndroidBack';

// Wizard that walks league-to-league with a suggested pickup (best add + smart
// drop + FAAB bid) pre-filled for each. The owner can swap the add from the
// shortlist, change the drop, adjust the bid, submit, and advance — or skip.
// `leagues` is a lightweight STUB queue ({ leagueId, name, system, waiverState });
// each league's full suggestion (candidates, bench, recommendation) is loaded on
// demand — the current one, plus a prefetch of the next — so the first step paints
// immediately instead of blocking on the whole N-league fan-out (was ~30s cold).
export default function WaiverWizardScreen({ leagues, seedAddId = null, onBack, onOpenPlayer }) {
  const requirePro = useRequirePro();
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState({}); // leagueId -> suggestion | { loading:true } | { error }
  const [addId, setAddId] = useState(null);
  const [dropId, setDropId] = useState(null);
  const [bid, setBid] = useState(null); // string, faab only
  const [queue, setQueue] = useState([]); // extra claims staged for THIS league (multi-add)
  const [browsing, setBrowsing] = useState(false); // candidate picker open
  const [posFilter, setPosFilter] = useState(null); // position filter in the add picker
  const [changingDrop, setChangingDrop] = useState(false); // bench picker open
  const [submitting, setSubmitting] = useState(false);
  const [submittedBusy, setSubmittedBusy] = useState(false); // delete/reorder of already-submitted claims in flight
  const [results, setResults] = useState([]); // {leagueId, name, action, add?, bid?}

  const total = leagues.length;
  const done = index >= total;
  const currentStub = index < total ? leagues[index] : null;
  const currentId = currentStub ? currentStub.leagueId : null;
  const nextId = index + 1 < total ? leagues[index + 1].leagueId : null;

  // Lazy per-league loader. `requested` guards against a double-fetch (current + prefetch can both
  // point at the same league across a re-render); `mountedRef` drops a late resolve after unmount.
  // The suggestion endpoint returns an error-SHAPED object ({ leagueId, name, error }) on a per-league
  // failure (a resolved 200, not a reject), so both that and a network reject land in `full` as `.error`.
  const requested = useRef(new Set());
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  // What was submitted THIS session, per league — drives the end Summary and lets the builder skip a
  // player you've already claimed here when it reseeds after a submit. { leagueId -> {names[], addIds:Set} }
  const sessionRef = useRef({});
  const sessionFor = (id) => {
    if (!sessionRef.current[id]) sessionRef.current[id] = { names: [], addIds: new Set() };
    return sessionRef.current[id];
  };
  const loadOne = useCallback((leagueId) => {
    if (!leagueId || requested.current.has(leagueId)) return;
    requested.current.add(leagueId);
    setFull((f) => ({ ...f, [leagueId]: { loading: true } }));
    api
      // seedAddId: when the wizard was launched from a "claim X in N leagues" hand-off, each league's
      // suggestion opens on THAT player (recommended add) with a smart drop/bid, ready to review.
      .waiverSuggestion(leagueId, seedAddId)
      .then((res) => { if (mountedRef.current) setFull((f) => ({ ...f, [leagueId]: res })); })
      .catch((e) => { if (mountedRef.current) setFull((f) => ({ ...f, [leagueId]: { error: e.message } })); });
  }, [seedAddId]);
  const retry = useCallback((leagueId) => { requested.current.delete(leagueId); loadOne(leagueId); }, [loadOne]);

  // Load the league we're on now and prefetch the next, so it's ready the moment the user advances.
  useEffect(() => {
    if (currentId) loadOne(currentId);
    if (nextId) loadOne(nextId);
  }, [currentId, nextId, loadOne]);

  const currentFull = currentId ? full[currentId] : null;
  const loadingCurrent = !!(currentFull && currentFull.loading);
  const currentError = currentFull && currentFull.error ? currentFull.error : null;
  // The fully-loaded suggestion for the current league (null while loading / on error).
  const current = currentFull && !currentFull.loading && !currentFull.error ? currentFull : null;

  // Exit the wizard on hardware back.
  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  // A loaded league with no free agents to consider and no lock to explain is nothing to act on —
  // silently advance past it (mirrors the old pre-filter, but done progressively as each loads).
  useEffect(() => {
    if (!current) return;
    if (!current.locked && (!current.candidates || current.candidates.length === 0)) {
      setIndex((i) => i + 1);
    }
  }, [current && current.leagueId]);

  // Seed the selection from each league's recommendation once its suggestion arrives.
  useEffect(() => {
    if (!current) return;
    const rec = current.recommended;
    const seedAdd = rec ? rec.add.id : current.candidates[0] ? current.candidates[0].id : null;
    setAddId(seedAdd);
    setDropId(rec && rec.drop ? rec.drop.id : null);
    setBid(rec && rec.bid != null ? String(rec.bid) : current.system === 'faab' ? String(current.minBid || 1) : null);
    setQueue([]);
    setBrowsing(false);
    setPosFilter(null);
    setChangingDrop(false);
  }, [current && current.leagueId]);

  // Positions present in this league's candidate pool, for the filter chips.
  const posOptions = useMemo(() => {
    if (!current) return [];
    const seen = [];
    for (const c of current.candidates) if (!seen.includes(c.position)) seen.push(c.position);
    return seen;
  }, [current && current.leagueId]);
  const queuedAddIds = useMemo(() => new Set(queue.map((q) => q.addId)), [queue]);
  const filteredCandidates = useMemo(
    () => (current ? current.candidates.filter((c) => (!posFilter || c.position === posFilter) && !queuedAddIds.has(c.id)) : []),
    [current && current.leagueId, posFilter, queuedAddIds]
  );

  const candById = useMemo(() => {
    const m = new Map();
    if (current) for (const c of current.candidates) m.set(c.id, c);
    return m;
  }, [current && current.leagueId]);
  // The drop can be ANY rostered player — starter or bench (you'll often drop a bye-week starting
  // DEF/K to stream). Resolve against the full roster, falling back to the droppable bench list.
  const rosterList = useMemo(() => (current ? current.roster || current.bench || [] : []), [current && current.leagueId]);
  const rosterById = useMemo(() => {
    const m = new Map();
    for (const p of rosterList) m.set(p.id, p);
    return m;
  }, [rosterList]);

  const add = addId ? candById.get(addId) : null;
  const drop = dropId ? rosterById.get(dropId) : null;
  const isFaab = current && current.system === 'faab';
  const dropRequired = !!(current && current.rosterFull);
  const bidNum = bid != null && bid !== '' ? Number(bid) : null;
  const budgetAfter = isFaab && current.faabRemaining != null && bidNum != null ? current.faabRemaining - bidNum : null;
  // Net dynasty value the claim adds to the roster: what you gain minus what you give up. The core
  // dynasty question on a waiver claim — shown side-by-side so the trade-off is obvious. Only when
  // the add carries a known value; a drop-less add is a straight gain.
  const addValue = add && add.value != null ? add.value : null;
  const dropValue = drop && drop.value != null ? drop.value : null;
  const valueDelta = addValue != null ? Math.round(addValue - (dropValue || 0)) : null;

  // Client-side gate (the backend re-validates on submit).
  const errors = [];
  if (!add) errors.push('Pick a player to add.');
  if (dropRequired && !dropId) errors.push('Your roster is full — choose a drop.');
  if (isFaab) {
    if (bidNum == null || Number.isNaN(bidNum)) errors.push('Enter a bid.');
    else if (bidNum < (current.minBid || 1)) errors.push(`Bid is below the minimum ($${current.minBid || 1}).`);
    else if (current.faabRemaining != null && bidNum > current.faabRemaining) errors.push(`Bid exceeds your budget ($${current.faabRemaining}).`);
  }
  const valid = errors.length === 0;

  // Running totals across the queue + the claim in progress (multi-add). The backend
  // re-validates the whole queue on submit; these are the live client-side hints.
  const queuedBidTotal = queue.reduce((s, q) => s + (q.bid || 0), 0);
  const addsCount = queue.length + (add ? 1 : 0);
  // Roster impact with CONTINGENCY: claims that share a drop are mutually exclusive (the drop happens
  // once), so each drop-group nets zero — only claims with NO drop actually grow the roster. Mirrors
  // the backend so the wizard doesn't block queuing two claims that drop the same player.
  const queuedDropless = queue.filter((q) => !q.dropId).length;
  const currentDropless = add && !dropId ? 1 : 0;
  const rosterAfter = current ? current.rosterCount + queuedDropless + currentDropless : 0;
  const overRoster = current && rosterAfter > current.rosterSize;
  const totalSpend = queuedBidTotal + (isFaab && bidNum ? bidNum : 0);
  const budgetLeftAll = isFaab && current && current.faabRemaining != null ? current.faabRemaining - totalSpend : null;
  const overBudget = budgetLeftAll != null && budgetLeftAll < 0;
  // Total claims we'd submit = queued + the current one (if it's complete).
  const pendingCount = queue.length + (valid ? 1 : 0);
  const canSubmit = pendingCount > 0 && !overRoster && !overBudget;

  function advance(result) {
    setResults((r) => [...r, result]);
    setIndex((i) => i + 1);
  }

  // Stash the current (valid) claim and reset the builder for another in this league.
  function addToQueue() {
    if (!valid || !add) return;
    const q = { addId, dropId: dropId || null, bid: isFaab && bidNum != null ? bidNum : null, add: { name: add.name, position: add.position, value: add.value }, drop: drop ? { name: drop.name } : null };
    const nextQueue = [...queue, q];
    setQueue(nextQueue);
    const nextAdd = current.candidates.find((c) => !nextQueue.some((x) => x.addId === c.id));
    setAddId(nextAdd ? nextAdd.id : null);
    setDropId(null);
    setBid(current.system === 'faab' ? String(current.minBid || 1) : null);
    setBrowsing(false);
    setChangingDrop(false);
    setPosFilter(null);
  }
  function removeFromQueue(id) {
    setQueue((qs) => qs.filter((q) => q.addId !== id));
  }

  // Submit the built claim(s) and STAY on this league — submitting is decoupled from advancing, so you
  // can add several claims, reorder them, then move on when ready. On success the claims land in the
  // "already submitted" strip, and the builder reseeds to the next-best add you haven't claimed yet.
  function submitClaims() {
    if (!canSubmit || !current) return;
    const claims = queue.map((q) => ({ addId: q.addId, dropId: q.dropId || undefined, bid: q.bid != null ? q.bid : undefined }));
    if (valid && add) claims.push({ addId, dropId: dropId || undefined, bid: isFaab && bidNum != null ? bidNum : undefined });
    if (!claims.length) return;
    // In an OPEN free-agency league the add executes on MFL immediately — and any claim that drops a
    // player makes that drop permanent. Gate the immediate+drop case behind a confirm (parity with the
    // Waivers ClaimSheet); queued FAAB/waiver claims process later, so they submit straight through.
    const drops = claims.filter((c) => c.dropId);
    if (current.system === 'free' && drops.length) {
      appAlert('Add now?', `This files ${claims.length} add${claims.length === 1 ? '' : 's'} that drop${drops.length === 1 ? 's' : ''} a player immediately on MyFantasyLeague. This can’t be undone from the app.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add & drop', style: 'destructive', onPress: () => doSubmitClaims(claims) },
      ]);
      return;
    }
    doSubmitClaims(claims);
  }

  async function doSubmitClaims(claims) {
    if (!requirePro('waivers.file')) return; // Pro gate (inert until enforced)
    setSubmitting(true);
    try {
      const names = [...queue.map((q) => q.add.name), ...(valid && add ? [add.name] : [])].map((n) => shortName(n));
      if (claims.length === 1) await api.submitClaim(current.leagueId, claims[0]);
      else await api.submitMultiClaim(current.leagueId, claims);
      // Record for the Summary + so the reseed skips players already claimed here.
      const s = sessionFor(current.leagueId);
      names.forEach((n) => s.names.push(n));
      claims.forEach((c) => s.addIds.add(c.addId));
      // Reseed the builder to the best candidate not yet claimed this league; clear the queue.
      const nextAdd = current.candidates.find((c) => !s.addIds.has(c.id));
      setAddId(nextAdd ? nextAdd.id : null);
      setDropId(null);
      setBid(current.system === 'faab' ? String(current.minBid || 1) : null);
      setQueue([]);
      setBrowsing(false);
      setChangingDrop(false);
      setPosFilter(null);
      toast(`Submitted ${names.length} claim${names.length === 1 ? '' : 's'} — ${current.name.split(' ')[0]}`);
      refetchCurrent(); // pull MFL's updated queue into the submitted strip (fresh ids for reorder/delete)
    } catch (e) {
      appAlert('Could not submit', e.message, null, { tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  // Silently re-pull the current league's suggestion (after a delete/reorder) so `submitted` reflects
  // MFL's new queue + fresh ids, without flashing the loading step.
  const refetchCurrent = useCallback(async () => {
    if (!currentId) return;
    try {
      const res = await api.waiverSuggestion(currentId);
      if (mountedRef.current) setFull((f) => ({ ...f, [currentId]: res }));
    } catch (e) { /* keep what we have */ }
  }, [currentId]);

  // Delete / reorder ALREADY-SUBMITTED claims. Order = MFL processing priority for contingent bids.
  async function deleteSubmitted(claimId) {
    if (submittedBusy || !currentId) return;
    setSubmittedBusy(true);
    try {
      await api.cancelClaim(currentId, claimId);
      await refetchCurrent();
    } catch (e) {
      appAlert('Could not cancel claim', e.message, null, { tone: 'error' });
    } finally {
      setSubmittedBusy(false);
    }
  }
  async function moveSubmitted(fromIdx, dir) {
    if (submittedBusy || !current || !current.submitted) return;
    const list = current.submitted;
    const toIdx = fromIdx + dir;
    if (toIdx < 0 || toIdx >= list.length) return;
    const order = list.map((c) => c.id);
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);
    setSubmittedBusy(true);
    try {
      await api.reorderClaims(currentId, order);
      await refetchCurrent();
    } catch (e) {
      appAlert('Could not reorder', e.message, null, { tone: 'error' });
    } finally {
      setSubmittedBusy(false);
    }
  }

  // Move to the next league (navigation is now separate from submitting). Records the league's outcome
  // for the Summary from what you actually submitted here this session. Works while still loading too.
  function nextLeague() {
    if (!currentStub) return;
    const s = sessionRef.current[currentStub.leagueId];
    const names = s ? s.names : [];
    const go = () => advance({
      leagueId: currentStub.leagueId,
      name: currentStub.name,
      action: names.length ? 'claimed' : 'skipped',
      add: names.join(', '),
      count: names.length,
    });
    // The builder pre-fills a recommended add, so a ready claim is sitting here even if the user never
    // submitted it. Don't let a tap on "Next league" silently drop a valid, unsubmitted claim — confirm.
    if (!names.length && pendingCount > 0) {
      appAlert('Skip without filing?', `You’ve got a claim built for ${currentStub.name} that hasn’t been submitted. Skip this league anyway?`, [
        { text: 'Keep building', style: 'cancel' },
        { text: 'Skip anyway', style: 'destructive', onPress: go },
      ]);
      return;
    }
    go();
  }
  function nextLocked() {
    if (!currentStub) return;
    advance({ leagueId: currentStub.leagueId, name: currentStub.name, action: 'locked' });
  }

  if (done) return <Summary results={results} onBack={onBack} />;
  if (!currentStub) return null;

  const rec = current ? current.recommended : null;
  // A loaded-but-empty, non-locked league is about to be auto-advanced (effect above); keep showing
  // the loading state through that beat instead of flashing an empty "pick a player" builder.
  const skipping = !!(current && !current.locked && (!current.candidates || current.candidates.length === 0));
  const showBuilder = !!current && !skipping;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Done</Text>
        </Pressable>
        <Text style={styles.progress}>League {index + 1} of {total}</Text>
        {/* Navigation lives in the bottom bar now (submitting is decoupled from moving on); spacer keeps
            the progress label centered. */}
        <View style={styles.topbarSpacer} />
      </View>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.round((index / total) * 100)}%` }]} />
      </View>

      {loadingCurrent || skipping ? (
        <View style={styles.loadingStep}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.loadingName} numberOfLines={1}>{currentStub.name}</Text>
          <Text style={styles.loadingHint}>Loading suggestions…</Text>
        </View>
      ) : currentError ? (
        <View style={styles.loadingStep}>
          <Text style={styles.errorStepTitle} numberOfLines={1}>{currentStub.name}</Text>
          <Text style={styles.errorStepBody}>{currentError}</Text>
          <Pressable style={styles.retryBtn} onPress={() => retry(currentId)}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : showBuilder ? (
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TopbarTitle numberOfLines={1}>{current.name}</TopbarTitle>
        <Text style={styles.subtitle}>
          <SystemBadge system={current.system} />
          {'  '}
          {isFaab && current.faabRemaining != null ? `$${current.faabRemaining} FAAB · ` : ''}
          Roster {current.rosterCount}/{current.rosterSize}{current.rosterFull ? ' · FULL' : ''}
        </Text>

        {/* League + team context: format (Superflex/1QB · PPR · TE-premium), my dynasty outlook, and
            average roster age — so the pickup decision is made with the league and team in view. */}
        {current.context ? (
          <View style={styles.ctxRow}>
            {current.context.format ? <Text style={[styles.ctxChip, current.context.superflex && styles.ctxChipSf]}>{current.context.format}</Text> : null}
            {current.context.outlook ? <Text style={[styles.ctxChip, styles.ctxChipOutlook]}>{current.context.outlook}</Text> : null}
            {current.context.avgAge != null ? <Text style={styles.ctxChip}>{`Avg age ${current.context.avgAge}`}</Text> : null}
          </View>
        ) : null}

        {rec ? (
          <Text style={[styles.reason, rec.upgrade && { color: colors.gold }]}>
            {rec.upgrade ? '★ ' : ''}{rec.reason}
          </Text>
        ) : null}

        {current.locked ? (
          <View style={styles.lockedPanel}>
            <View style={styles.lockedTitleRow}>
              <NeonSign glyph="lock" color="warn" grade="inline" size={16} />
              <Text style={styles.lockedTitle}>Waivers locked</Text>
            </View>
            <Text style={styles.lockedText}>{current.lockReason || 'Free agency isn’t running in this league right now.'}</Text>
          </View>
        ) : (
        <>
        {/* ALREADY SUBMITTED HERE — claims already in for this league, reconciled with MFL so a bid
            you placed on the MFL site (tagged) shows up too. Reorder (priority for contingent bids) +
            delete inline; new claims append to the bottom. */}
        {current.submitted && current.submitted.length ? (
          <View style={styles.submittedStrip}>
            <Text style={styles.submittedTitle}>
              {current.submitted.length} already submitted here{current.submitted.length > 1 ? ' · top tried first' : ''}
            </Text>
            {current.submitted.map((c, i) => (
              <View key={c.id} style={styles.submittedRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.submittedText} numberOfLines={1}>
                    {current.submitted.length > 1 ? <Text style={styles.submittedIdx}>{`${i + 1}. `}</Text> : null}
                    <Text style={styles.submittedAdd}>+ {c.add ? shortName(c.add.name) : '—'}</Text>
                    {c.add ? <Text style={styles.submittedMeta}>{`  ${[c.add.position, c.add.team].filter(Boolean).join(' · ')}`}</Text> : null}
                    {c.bid != null ? <Text style={styles.submittedBid}>{`  $${c.bid}`}</Text> : null}
                    {c.priority != null ? <Text style={styles.submittedBid}>{`  #${c.priority}`}</Text> : null}
                  </Text>
                  {c.drop ? (
                    <Text style={styles.submittedText} numberOfLines={1}>
                      <Text style={styles.submittedDrop}>− {shortName(c.drop.name)}</Text>
                      <Text style={styles.submittedMeta}>{`  ${[c.drop.position, c.drop.team].filter(Boolean).join(' · ')}`}</Text>
                    </Text>
                  ) : null}
                  {c.valueDelta != null ? (
                    <Text style={[styles.submittedDelta, { color: c.valueDelta >= 0 ? colors.good : colors.bad }]}>
                      {`net ${c.valueDelta >= 0 ? '+' : ''}${c.valueDelta} value`}
                    </Text>
                  ) : null}
                </View>
                {c.source === 'mfl' ? <Text style={styles.mflTag}>MFL</Text> : null}
                <View style={styles.submittedActions}>
                  {current.submitted.length > 1 ? (
                    <>
                      <Pressable onPress={() => moveSubmitted(i, -1)} disabled={i === 0 || submittedBusy} hitSlop={6} style={styles.reorderBtn}>
                        <Text style={[styles.reorderArrow, (i === 0 || submittedBusy) && styles.reorderArrowOff]}>▲</Text>
                      </Pressable>
                      <Pressable onPress={() => moveSubmitted(i, 1)} disabled={i === current.submitted.length - 1 || submittedBusy} hitSlop={6} style={styles.reorderBtn}>
                        <Text style={[styles.reorderArrow, (i === current.submitted.length - 1 || submittedBusy) && styles.reorderArrowOff]}>▼</Text>
                      </Pressable>
                    </>
                  ) : null}
                  <Pressable
                    onPress={() =>
                      appAlert('Cancel this claim?', `Remove your ${c.add ? shortName(c.add.name) : ''} claim from this league?`, [
                        { text: 'Keep', style: 'cancel' },
                        { text: 'Cancel claim', style: 'destructive', onPress: () => deleteSubmitted(c.id) },
                      ])
                    }
                    disabled={submittedBusy}
                    hitSlop={6}
                    style={styles.reorderBtn}
                  >
                    <Text style={[styles.submittedDelete, submittedBusy && styles.reorderArrowOff]}>✕</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* ADD */}
        <Text style={styles.fieldLabel}>Add</Text>
        {add ? (
          <PlayerLine p={add} showValue onOpenPlayer={onOpenPlayer} />
        ) : (
          <Text style={styles.noneText}>No player selected</Text>
        )}
        <Pressable style={styles.changeRow} onPress={() => setBrowsing((v) => !v)}>
          <Text style={styles.changeText}>{browsing ? 'Close' : 'Choose a different player'}</Text>
        </Pressable>
        {browsing ? (
          <View style={styles.picker}>
            {posOptions.length > 1 ? (
              <View style={styles.posChips}>
                <PosChip label="All" active={!posFilter} onPress={() => setPosFilter(null)} />
                {posOptions.map((p) => (
                  <PosChip key={p} label={p} active={posFilter === p} onPress={() => setPosFilter(p)} />
                ))}
              </View>
            ) : null}
            {filteredCandidates.map((c) => (
              <Pressable
                key={c.id}
                style={[styles.pickRow, c.id === addId && styles.pickRowOn]}
                onPress={() => { setAddId(c.id); setBrowsing(false); }}
              >
                <PlayerLine p={c} showValue compact />
              </Pressable>
            ))}
            {filteredCandidates.length === 0 ? <Text style={styles.benchName}>No {posFilter} available in this league.</Text> : null}
          </View>
        ) : null}

        {/* DROP — any rostered player is droppable (you'll often stream a bye-week starting DEF/K).
            The picker shows the whole roster grouped by position, starters labeled but selectable. */}
        <Text style={styles.fieldLabel}>{dropRequired ? 'Drop (required — roster full)' : 'Drop (optional)'}</Text>
        <Pressable style={styles.dropBox} onPress={() => setChangingDrop((v) => !v)}>
          <Text style={styles.dropText}>
            {drop ? `− ${shortName(drop.name)}${drop.value != null ? ` (${drop.value})` : ''}` : 'None'}
          </Text>
          <Text style={styles.changeText}>{changingDrop ? 'Close' : 'Change'}</Text>
        </Pressable>
        {changingDrop ? (
          <View style={styles.picker}>
            {!dropRequired ? (
              <Pressable style={styles.pickRow} onPress={() => { setDropId(null); setChangingDrop(false); }}>
                <Text style={styles.benchName}>None (add without dropping)</Text>
              </Pressable>
            ) : null}
            <RosterDropList
              roster={rosterList}
              dropId={dropId}
              onSelect={(id) => { setDropId(id); setChangingDrop(false); }}
            />
          </View>
        ) : null}

        {/* VALUE DELTA — add vs. drop dynasty value, side by side (shared with the FA ClaimSheet) */}
        {add ? <ValueDelta addValue={addValue} dropValue={dropValue} net={valueDelta} /> : null}

        {/* BID (faab) */}
        {isFaab ? (
          <>
            <Text style={styles.fieldLabel}>
              FAAB bid{rec && rec.bid != null ? ` · suggested $${rec.bid}` : ''}
            </Text>
            <View style={styles.bidRow}>
              <Stepper label="−" onPress={() => setBid(String(Math.max(0, (bidNum || 0) - 1)))} />
              <TextInput
                style={styles.bidInput}
                keyboardType="number-pad"
                value={bid == null ? '' : String(bid)}
                onChangeText={(t) => setBid(t.replace(/[^0-9]/g, ''))}
              />
              <Stepper label="+" onPress={() => setBid(String((bidNum || 0) + 1))} />
              {budgetAfter != null ? <Text style={styles.budgetAfter}>${budgetAfter} left after</Text> : null}
            </View>
            <BidPlanRow plan={rec && rec.bidPlan} current={bid} onPick={(n) => setBid(String(n))} />
          </>
        ) : null}

        {/* MULTI-ADD: stage this claim, then queue another in the same league */}
        <Pressable
          style={({ pressed }) => [styles.queueBtn, !valid && styles.queueBtnOff, pressed && valid && { opacity: 0.85 }]}
          onPress={addToQueue}
          disabled={!valid}
        >
          <Text style={[styles.queueBtnText, !valid && { color: colors.textDim }]}>+ Queue this & add another</Text>
        </Pressable>

        {queue.length ? (
          <View style={styles.queuePanel}>
            <Text style={styles.queueTitle}>Queued in {current.name.split(' ')[0]} · {queue.length}</Text>
            {queue.map((q) => (
              <View key={q.addId} style={styles.queueRow}>
                <Text style={styles.queueName} numberOfLines={1}>
                  + {shortName(q.add.name)}
                  <Text style={styles.queueMeta}>
                    {`  ${q.add.position}`}{q.drop ? ` · − ${shortName(q.drop.name)}` : ''}{q.bid != null ? ` · $${q.bid}` : ''}
                  </Text>
                </Text>
                <Pressable onPress={() => removeFromQueue(q.addId)} hitSlop={8}>
                  <Text style={styles.queueRemove}>✕</Text>
                </Pressable>
              </View>
            ))}
            <Text style={[styles.runTotals, (overRoster || overBudget) && { color: colors.bad }]}>
              {isFaab && current.faabRemaining != null ? `Bids $${totalSpend} · $${budgetLeftAll} left${overBudget ? ' — over budget!' : ''}  ·  ` : ''}
              Roster {rosterAfter}/{current.rosterSize}{overRoster ? ' — over!' : ''}
            </Text>
          </View>
        ) : null}

        {!valid && !queue.length ? <Text style={styles.errorText}>{errors[0]}</Text> : null}
        </>
        )}
      </ScrollView>
      ) : null}

      {/* Actions: SUBMIT (stay on this league — you can add + reorder several) is separate from moving
          on. The nav button advances; on the last league it's "Finish". */}
      <View style={styles.actions}>
        {loadingCurrent || skipping ? (
          <Pressable style={styles.navBtn} onPress={nextLeague}>
            <Text style={styles.navBtnText}>{index + 1 === total ? 'Finish' : 'Next league ›'}</Text>
          </Pressable>
        ) : currentError ? (
          <>
            <Pressable style={styles.navBtn} onPress={nextLeague}>
              <Text style={styles.navBtnText}>{index + 1 === total ? 'Finish' : 'Next ›'}</Text>
            </Pressable>
            <Pressable style={styles.submit} onPress={() => retry(currentId)}>
              <Text style={styles.submitText}>Retry</Text>
            </Pressable>
          </>
        ) : current && current.locked ? (
          <Pressable style={styles.submit} onPress={nextLocked}>
            <Text style={styles.submitText}>{index + 1 === total ? 'Finish' : 'Next league ›'}</Text>
          </Pressable>
        ) : showBuilder ? (
          <>
            <Pressable style={styles.navBtn} onPress={nextLeague} disabled={submitting}>
              <Text style={styles.navBtnText}>{index + 1 === total ? 'Finish' : 'Next league ›'}</Text>
            </Pressable>
            <Button
              title={current.system === 'free'
                ? (pendingCount > 1 ? `Add ${pendingCount}` : 'Add')
                : (pendingCount > 1 ? `Submit ${pendingCount}` : 'Submit claim')}
              onPress={submitClaims}
              busy={submitting}
              disabled={!canSubmit}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

// "Fields, Justin" → "Fields J." — last name + first initial, so same-surname players are
// distinguishable at a glance (the wizard used to show the last name alone).
function shortName(name) {
  const parts = String(name || '').split(',');
  const last = (parts[0] || '').trim();
  const first = (parts[1] || '').trim();
  return first ? `${last} ${first[0]}.` : last;
}
// Rostered-player meta for the drop picker: NFL team · bye · this-week projection · this-year points
// — filling the previously-empty drop card with the numbers that inform who to cut.
function teamByeLine(p) {
  return [
    p.team,
    p.bye != null ? `bye ${p.bye}` : null,
    p.projection != null ? `proj ${p.projection}` : null,
    p.seasonPoints != null ? `${p.seasonPoints} yr` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function PlayerLine({ p, showValue, compact, onOpenPlayer }) {
  const posColor = positionColors[p.position] || colors.textDim;
  const Wrap = onOpenPlayer ? Pressable : View;
  const wrapProps = onOpenPlayer ? { onPress: () => onOpenPlayer(p.id), accessibilityRole: 'button', accessibilityLabel: `Open ${p.name}` } : {};
  return (
    <Wrap style={[styles.playerLine, compact && { paddingVertical: 6 }]} {...wrapProps}>
      <View style={[styles.posBadge, { backgroundColor: posColor + '22', borderColor: posColor }]}>
        <Text style={[styles.pos, { color: posColor }]}>{p.position}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.playerName} numberOfLines={1}>{shortName(p.name)}</Text>
          <AvailabilityBadge availability={p.availability} style={{ marginLeft: 6 }} />
        </View>
        <Text style={styles.playerMeta} numberOfLines={1}>
          {[
            p.team,
            p.bye != null ? `bye ${p.bye}` : null,
            p.projection != null ? `proj ${p.projection}` : null,
            p.ownership != null ? `${p.ownership}% rost` : null,
            p.trend ? `+${(p.trend / 1000).toFixed(1)}k adds` : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {showValue && p.value != null ? <Text style={styles.playerValue}>{p.value}</Text> : null}
    </Wrap>
  );
}

// The drop picker: the WHOLE roster grouped by position (headers), starters labeled but still
// selectable (you can drop a starter — e.g. stream a bye-week DEF/K). Sorted server-side by
// position then value, so within each group your best players sit on top.
function RosterDropList({ roster, dropId, onSelect }) {
  if (!roster || !roster.length) return <Text style={styles.benchName}>No rostered players to drop.</Text>;
  let lastPos = null;
  return (
    <View>
      {roster.map((p) => {
        const header = p.position !== lastPos ? p.position : null;
        lastPos = p.position;
        return (
          <View key={p.id}>
            {header ? <Text style={styles.posGroupHeader}>{header}</Text> : null}
            <RosterRow p={p} selected={p.id === dropId} onPress={() => onSelect(p.id)} />
          </View>
        );
      })}
    </View>
  );
}

function RosterRow({ p, selected, onPress }) {
  const posColor = positionColors[p.position] || colors.textDim;
  return (
    <Pressable style={[styles.rosterRow, selected && styles.pickRowOn]} onPress={onPress}>
      <View style={[styles.posBadgeSm, { backgroundColor: posColor + '22', borderColor: posColor }]}>
        <Text style={[styles.posSm, { color: posColor }]}>{p.position}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.rosterName} numberOfLines={1}>{shortName(p.name)}</Text>
          {p.starter ? <Text style={styles.starterTag}>STARTER</Text> : null}
          <AvailabilityBadge availability={p.availability} style={{ marginLeft: 6 }} />
        </View>
        <Text style={styles.rosterMeta} numberOfLines={1}>{teamByeLine(p) || '—'}</Text>
      </View>
      {p.value != null ? <Text style={styles.rosterValue}>{p.value}</Text> : null}
    </Pressable>
  );
}

function Summary({ results, onBack }) {
  const claimed = results.filter((r) => r.action === 'claimed');
  const skipped = results.filter((r) => r.action === 'skipped');
  const totalClaims = claimed.reduce((s, r) => s + (r.count || 1), 0);
  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <Text style={styles.doneMark}>✓</Text>
        <Text style={styles.doneTitle}>
          {totalClaims ? `${totalClaims} claim${totalClaims === 1 ? '' : 's'} submitted` : 'No claims submitted'}
        </Text>
        {skipped.length ? <Text style={styles.doneSub}>{skipped.length} skipped</Text> : null}
        <View style={styles.summaryList}>
          {results.map((r) => (
            <View key={r.leagueId} style={styles.summaryRow}>
              <Text style={styles.summaryName} numberOfLines={1}>{r.name}</Text>
              {r.action === 'claimed' ? (
                <Text style={styles.summarySet} numberOfLines={1}>
                  + {r.add}{r.bid ? ` · $${r.bid}` : ''}
                </Text>
              ) : r.action === 'locked' ? (
                <View style={styles.summaryLockedRow}>
                  <NeonSign glyph="lock" color="warn" grade="inline" size={12} />
                  <Text style={styles.summaryLocked}>locked</Text>
                </View>
              ) : (
                <Text style={styles.summarySkip}>skipped</Text>
              )}
            </View>
          ))}
        </View>
        <Pressable style={styles.doneBtn} onPress={onBack}>
          <Text style={styles.doneBtnText}>Back to Waivers</Text>
        </Pressable>
      </View>
    </View>
  );
}

const SYS = { faab: { label: 'FAAB', color: colors.accent }, fcfs: { label: 'FCFS', color: colors.warn }, free: { label: 'Free agent', color: colors.good } };
function SystemBadge({ system }) {
  const s = SYS[system] || SYS.free;
  return <Text style={[styles.sysBadge, { color: s.color, borderColor: s.color }]}>{s.label}</Text>;
}
function Stepper({ onPress, label }) {
  return (
    <Pressable style={styles.stepper} onPress={onPress}>
      <Text style={styles.stepperText}>{label}</Text>
    </Pressable>
  );
}
function PosChip({ label, active, onPress }) {
  return (
    <Pressable style={[styles.posChip, active && styles.posChipOn]} onPress={onPress}>
      <Text style={[styles.posChipText, active && styles.posChipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  progress: { color: colors.text, fontSize: 14, fontWeight: '800' },
  topbarSpacer: { width: 44 },
  bar: { height: 4, backgroundColor: colors.card, marginHorizontal: 16, marginTop: 10, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: colors.accent },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  loadingStep: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  loadingName: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 16, textAlign: 'center' },
  loadingHint: { color: colors.textDim, fontSize: 13, marginTop: 6 },
  errorStepTitle: { color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  errorStepBody: { color: colors.bad, fontSize: 14, marginTop: 10, textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: 18, borderWidth: 1, borderColor: colors.accent, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 28 },
  retryText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  title: { color: colors.text, fontSize: 22, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 6 },
  reason: { color: colors.textDim, fontSize: 13, fontWeight: '700', marginTop: 8 },
  fieldLabel: { color: colors.violetText, fontSize: 12, fontWeight: '700', marginTop: 18, marginBottom: 8, letterSpacing: 0.3 },
  playerLine: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 },
  posBadge: { width: 40, paddingVertical: 2, borderRadius: 6, borderWidth: 1, alignItems: 'center', marginRight: 10 },
  pos: { fontSize: 11, fontWeight: '800' },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  playerName: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  playerMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  playerValue: { color: colors.gold, fontSize: 16, fontWeight: '900', marginLeft: 10 },
  noneText: { color: colors.textDim, fontSize: 14, fontStyle: 'italic' },
  changeRow: { paddingTop: 8 },
  changeText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  lockedPanel: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.warn, padding: 16, marginTop: 16 },
  lockedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lockedTitle: { color: colors.warn, fontSize: 15, fontWeight: '900' },
  summaryLockedRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lockedText: { color: colors.textDim, fontSize: 13, marginTop: 6, lineHeight: 18 },
  posChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  posChip: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  posChipOn: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  posChipText: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  posChipTextOn: { color: colors.text },
  summaryLocked: { color: colors.warn, fontSize: 13, fontWeight: '700' },
  picker: { marginTop: 8, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  pickRow: { paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pickRowOn: { backgroundColor: colors.cardAlt },
  benchName: { color: colors.text, fontSize: 14, paddingVertical: 12, paddingHorizontal: 4 },
  benchMeta: { color: colors.textDim, fontSize: 12 },
  // Already-submitted claims strip (reconciled with MFL).
  submittedStrip: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.accent + '55', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, marginTop: 4, marginBottom: 4 },
  submittedTitle: { color: colors.accent, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  submittedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  submittedText: { color: colors.text, fontSize: 14, marginRight: 8 },
  submittedAdd: { color: colors.text, fontWeight: '800' },
  submittedDrop: { color: colors.textDim, fontWeight: '800' },
  submittedMeta: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  submittedBid: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  submittedDelta: { fontSize: 12, fontWeight: '800', marginTop: 1 },
  submittedIdx: { color: colors.textDim, fontSize: 13, fontWeight: '800' },
  mflTag: { color: colors.accent, fontSize: 9, fontWeight: '900', borderWidth: 1, borderColor: colors.accent, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden', marginRight: 4 },
  submittedActions: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 4 },
  reorderBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  reorderArrow: { color: colors.accent, fontSize: 13, fontWeight: '900' },
  reorderArrowOff: { color: colors.border },
  submittedDelete: { color: colors.bad, fontSize: 14, fontWeight: '900' },
  // League + team context chip row (format / outlook / avg age).
  ctxRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  ctxChip: { color: colors.textDim, fontSize: 11, fontWeight: '800', borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  ctxChipSf: { color: colors.accent, borderColor: colors.accent },
  ctxChipOutlook: { color: colors.textDim, borderColor: colors.border },
  // Full-roster drop picker rows, grouped by position.
  posGroupHeader: { color: colors.violetText, fontSize: 11, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: 10, paddingTop: 10, paddingBottom: 2 },
  rosterRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  posBadgeSm: { width: 36, paddingVertical: 2, borderRadius: 6, borderWidth: 1, alignItems: 'center', marginRight: 10 },
  posSm: { fontSize: 10, fontWeight: '800' },
  rosterName: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  starterTag: { color: colors.textDim, fontSize: 9, fontWeight: '900', letterSpacing: 0.4, borderWidth: 1, borderColor: colors.border, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, marginLeft: 6, overflow: 'hidden' },
  rosterMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  rosterValue: { color: colors.gold, fontSize: 14, fontWeight: '900', marginLeft: 10 },
  dropBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14 },
  dropText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepper: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepperText: { color: colors.text, fontSize: 20, fontWeight: '900' },
  bidInput: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, color: colors.text, fontSize: 18, fontWeight: '800', minWidth: 70, textAlign: 'center' },
  budgetAfter: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  errorText: { color: colors.bad, fontSize: 13, marginTop: 16, fontWeight: '600' },
  queueBtn: { marginTop: 20, borderWidth: 1, borderColor: colors.accent, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  queueBtnOff: { borderColor: colors.border },
  queueBtnText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  queuePanel: { marginTop: 14, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 },
  queueTitle: { color: colors.violetText, fontSize: 11, fontWeight: '900', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 },
  queueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  queueName: { color: colors.text, fontSize: 14, fontWeight: '700', flex: 1, marginRight: 10 },
  queueMeta: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  queueRemove: { color: colors.textDim, fontSize: 15, fontWeight: '800' },
  runTotals: { color: colors.gold, fontSize: 12, fontWeight: '800', marginTop: 10 },
  actions: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4, gap: 12 },
  skipInline: { paddingHorizontal: 22, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  skipInlineText: { color: colors.textDim, fontSize: 15, fontWeight: '700' },
  // Secondary "Next league / Finish" nav button (submitting is a separate, primary action).
  navBtn: { paddingHorizontal: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  navBtnText: { color: colors.text, fontSize: 15, fontWeight: '800' },
  submit: { flex: 1, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitOff: { backgroundColor: colors.cardAlt },
  submitText: { color: colors.onAccent, fontSize: 16, fontWeight: '800' },
  sysBadge: { fontSize: 10, fontWeight: '900', borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  // summary
  doneMark: { color: colors.good, fontSize: 56, fontWeight: '900', marginBottom: 8 },
  doneTitle: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  doneSub: { color: colors.textDim, fontSize: 14, marginTop: 4 },
  summaryList: { alignSelf: 'stretch', marginTop: 24, marginBottom: 8 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  summaryName: { color: colors.text, fontSize: 15, fontWeight: '600', flex: 1, marginRight: 12 },
  summarySet: { color: colors.good, fontSize: 14, fontWeight: '800', flexShrink: 1 },
  summarySkip: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  doneBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 40, alignItems: 'center', marginTop: 24 },
  doneBtnText: { color: colors.onAccent, fontSize: 16, fontWeight: '800' },
});
