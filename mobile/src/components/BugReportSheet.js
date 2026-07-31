import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Modal, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import NeonSign from './NeonSign';
import { appAlert } from './AppAlert';
import { toast } from './Toast';
import { collectDiagnostics } from '../bugReport';
import { useEntitlement } from '../entitlement';

// Beta bug-report sheet. The user types what happened; a diagnostics snapshot (app version, device,
// recent breadcrumbs) is attached automatically. Everything POSTs to the backend, which emails it to the
// developer — the destination address lives only in a server env var and is NEVER shown here, so the
// app can be inspected end to end without ever revealing a personal inbox.
export default function BugReportSheet({ visible, onClose, context = {} }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ent = useEntitlement();

  async function send() {
    const message = text.trim();
    if (!message) { appAlert('Add a note', 'Tell me what happened so I can track it down.'); return; }
    setSending(true);
    try {
      // Snapshot state at send time (screen, entitlement, demo) + breadcrumbs. The username is added
      // server-side from the session, so it isn't collected or spoofable here.
      const entitlement = ent ? { reason: ent.reason, isPro: !!ent.isPro } : null;
      await api.bugReport({ message, diagnostics: collectDiagnostics({ ...context, entitlement }) });
      toast('Bug report sent — thank you!');
      setText('');
      onClose();
    } catch (e) {
      appAlert('Could not send', e.message);
    } finally {
      setSending(false);
    }
  }

  function close() { if (!sending) { setText(''); onClose(); } }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.head}>
              <NeonSign glyph="bug" color="white" grade="ailing" size={26} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Report a bug</Text>
                <Text style={styles.sub}>Beta — goes straight to the developer.</Text>
              </View>
            </View>

            <Text style={styles.label}>What happened?</Text>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="What were you doing? What did you expect vs. what you saw?"
              placeholderTextColor={colors.textDim}
              multiline
              textAlignVertical="top"
              maxLength={2000}
              autoFocus
            />

            <ScrollView style={styles.diagBox} contentContainerStyle={{ padding: 10 }}>
              <Text style={styles.diagText}>
                Attached automatically: app version, device + OS, the screen you’re on, and your recent
                in-app activity — so I can reproduce it. No passwords are ever included.
              </Text>
            </ScrollView>

            <View style={styles.actions}>
              <Pressable style={[styles.act, styles.cancel]} onPress={close} disabled={sending}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable style={[styles.act, styles.send]} onPress={send} disabled={sending}>
                {sending ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.sendText}>Send report</Text>}
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', paddingHorizontal: 22 },
  sheet: { backgroundColor: colors.bg, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  title: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 12, fontWeight: '600', marginTop: 2 },
  label: { color: colors.violetText, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  input: { minHeight: 110, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, fontSize: 15, padding: 12, lineHeight: 20 },
  diagBox: { maxHeight: 88, marginTop: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  diagText: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  act: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  send: { backgroundColor: colors.accent },
  sendText: { color: colors.onAccent, fontWeight: '800', fontSize: 14 },
});
