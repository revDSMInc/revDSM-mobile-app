import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import io, { Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../../../hooks/useAuth';
import { useTheme } from '../../../../theme/ThemeProvider';
import { ENV } from '../../../../config/env';

interface Props {
  onNavigate?: (route: any) => void;
}

export function ChatThreadsManager({ onNavigate }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);

  const [totalUnread, setTotalUnread] = useState(0);

  useEffect(() => {
    if (!user) return;

    let socket: Socket;
    const initSocket = async () => {
      try {
        const token = await AsyncStorage.getItem('accessToken');
        socket = io(ENV.API_URL, { auth: { token } });
        socketRef.current = socket;

        socket.on('connect', () => {
          socket.emit('get-all-lead-chats', { page: 1, limit: 1 }); // Just need counts
        });

        socket.on('all-lead-chats-response', (data: any) => {
          if (data) {
            setTotalUnread(data.totalUnreadCount || 0);
          }
        });
      } catch (err) {}
    };

    initSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.off('all-lead-chats-response');
        socketRef.current.disconnect();
      }
    };
  }, [user]);

  return (
    <TouchableOpacity
      onPress={() => onNavigate?.('ChatThreads')}
      style={[styles.chatBtn, { backgroundColor: 'rgba(145, 158, 171, 0.12)' }]}
    >
      <Text className="text-xl">💬</Text>
      {totalUnread > 0 && (
        <View style={[styles.badge, { backgroundColor: colors.primary.main }]}>
          <Text style={styles.badgeText}>{totalUnread > 99 ? '99+' : totalUnread}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chatBtn: {
    marginRight: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
  },
});
