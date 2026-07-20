import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';

// Catches render-time crashes so one bad component can't white-screen the whole app.
// `silent` mode renders nothing on error (used to isolate decorative pieces like the
// backdrop). Otherwise it shows the error + component stack on screen, so a crash in a
// release build is diagnosable instead of just closing the app.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, stack: '' };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ stack: (info && info.componentStack) || '' });
  }

  render() {
    if (this.state.error) {
      if (this.props.silent) return this.props.fallback || null;
      const e = this.state.error;
      const msg = (e && (e.message || e.toString())) || 'Unknown error';
      return (
        <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
          <Text style={styles.title}>⚠ The app hit an error</Text>
          <Text style={styles.label}>Message</Text>
          <Text style={styles.msg}>{String(msg)}</Text>
          {this.state.stack ? (
            <>
              <Text style={styles.label}>Where</Text>
              <Text style={styles.stack}>{String(this.state.stack).trim()}</Text>
            </>
          ) : null}
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0A0F1C' },
  content: { padding: 24, paddingTop: 72 },
  title: { color: '#F3C14A', fontSize: 20, fontWeight: '900', marginBottom: 18 },
  label: { color: '#7C8AA5', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 12, marginBottom: 4 },
  msg: { color: '#fff', fontSize: 15, lineHeight: 21 },
  stack: { color: '#9FB0C9', fontSize: 12, lineHeight: 18 },
});
