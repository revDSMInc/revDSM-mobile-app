import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { recordError } from '../../services/crashReporting';

type State = { failed: boolean };

/**
 * Root render-error boundary. A render exception reports to Crashlytics (non-fatal) and shows a recoverable screen instead
 * of a white screen / app kill. Plain RN views only: it must render even when the theme/redux providers are what broke.
 */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    recordError(error, 'render-error', { componentStack: info?.componentStack?.slice(0, 800) });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>The error has been reported. Your saved work is safe.</Text>
        <TouchableOpacity style={styles.btn} onPress={() => this.setState({ failed: false })}>
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0E2A1C' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  body: { color: '#cfe3d6', fontSize: 14, textAlign: 'center', marginBottom: 20 },
  btn: { backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#0E2A1C', fontWeight: '700' },
});
