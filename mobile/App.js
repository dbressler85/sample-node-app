import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// BARE-METAL LAUNCH TEST (temporary). Every app screen, every native module, and every
// config plugin has been removed. This file imports NOTHING but react-native core. If this
// screen appears, the Expo runtime + EAS build + the device are all healthy and the crash
// lives in our app code or one of the native modules we strip out here — we add them back in
// groups next. If this STILL crashes at the navy flash, the fault is environmental (build
// signing, SDK/Android incompatibility, or the device) and no feature code could ever fix it.
export default function App() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>DYNASTY CENTRAL</Text>
      <Text style={styles.sub}>bare-metal launch test</Text>
      <Text style={styles.tag}>build 7 · no native modules</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0F1C', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#F3C14A', fontSize: 30, fontWeight: '800', letterSpacing: 2 },
  sub: { color: '#E7ECF5', fontSize: 16, marginTop: 12 },
  tag: { color: '#6C7A96', fontSize: 13, marginTop: 6 },
});
