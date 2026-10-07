import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useIsOnline } from '../../hooks/useIsOnline';

export const OfflineBanner: React.FC = () => {
  const online = useIsOnline();

  if (online) return null;

  return (
    <View style={styles.bar}>
      <Icon name="cloud-off-outline" size={15} color="#7A4100" />
      <Text style={styles.text}>Offline — showing saved data. Changes will sync when you reconnect.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#FFF1C6',
  },
  text: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#7A4100',
  },
});
