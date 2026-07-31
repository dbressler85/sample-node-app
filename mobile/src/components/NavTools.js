import React, { createContext, useContext } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import NeonSign from './NeonSign';

// The persistent nav-tool cluster carried on EVERY main tab's header: Bug (beta report), Settings, and
// Profile — as neon signs. Profile + Settings are blue and steady (grade "inline"); the beta Bug sign is
// a white tube that perpetually flickers (grade "ailing"), so it reads as the temporary, of-the-moment
// beta affordance. Handlers come from context (NavToolsProvider in App.js) so a screen just drops in
// <NavTools/> without threading three callbacks through its props.

const NavToolsContext = createContext({ openProfile: null, openSettings: null, openBugReport: null });
export function NavToolsProvider({ value, children }) {
  return <NavToolsContext.Provider value={value}>{children}</NavToolsContext.Provider>;
}
export function useNavTools() {
  return useContext(NavToolsContext);
}

function ToolButton({ onPress, label, glyph, color, grade }) {
  if (!onPress) return null;
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} style={styles.btn}>
      <NeonSign glyph={glyph} color={color} grade={grade} size={22} />
    </Pressable>
  );
}

// `active` = this tab is the visible one. The bug sign flickers (an "ailing" Animated.loop that never
// stops) ONLY on the active tab — under keep-alive every tab stays mounted, and native-driven loops
// don't pause for a hidden view, so a per-tab ailing loop would leave up to six perpetual animations
// running forever. Off the active tab the bug renders steady (no loop). Reduce-motion already collapses
// the loop to a settled tube regardless.
export default function NavTools({ active = true }) {
  const { openProfile, openSettings, openBugReport } = useNavTools();
  return (
    <View style={styles.row}>
      <ToolButton onPress={openBugReport} label="Report a bug" glyph="bug" color="white" grade={active ? 'ailing' : 'inline'} />
      <ToolButton onPress={openSettings} label="Settings" glyph="settings" color="accent" grade="inline" />
      <ToolButton onPress={openProfile} label="Profile" glyph="person" color="accent" grade="inline" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  btn: { padding: 2 },
});
