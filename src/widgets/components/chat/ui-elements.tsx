import React from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/Ionicons';
import { format } from 'date-fns';

export const StatusChip = ({ label, count, active, onPress, specialMode }: any) => {
  const { colors, isDark } = useTheme();

  // Web-parity special modes for 'All' and 'Today'
  const getSpecialStyles = () => {
    if (!active)
      return {
        bg: isDark ? 'bg-slate-800/40' : 'bg-slate-100',
        text: 'opacity-40',
        border: 'border-transparent',
      };
    if (specialMode === 'all')
      return { bg: 'bg-blue-600', text: 'text-white', border: 'border-blue-400' };
    if (specialMode === 'today')
      return { bg: 'bg-emerald-600', text: 'text-white', border: 'border-emerald-400' };
    return { bg: colors.primary.main, text: 'text-white', border: 'border-primary' };
  };

  const styles = getSpecialStyles();

  return (
    <TouchableOpacity
      onPress={onPress}
      className={`px-4 py-2.0 rounded-2xl flex-row items-center border mr-2 ${styles.bg} ${styles.border}`}
    >
      {specialMode === 'today' && active && (
        <Icon name="flash" size={10} color="white" style={{ marginRight: 4 }} />
      )}
      <Text className={`text-[10px] font-black uppercase tracking-widest ${styles.text}`}>
        {label}
      </Text>
      {count > 0 && (
        <View className="ml-2 w-4 h-4 rounded-full bg-white/20 items-center justify-center">
          <Text className="text-[8px] font-black text-white">{count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

export const ThreadItem = ({ item, onPress, currentUserId }: any) => {
  const { colors, isDark } = useTheme();
  const lastMsg = item.lastMessage || {};
  const unreadCount = item.unreadCount || 0;
  const isChannel = !!item.channelType;

  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center px-6 py-5 border-b"
      style={{
        borderBottomColor: isDark ? '#1C1C1E' : '#F4F6F8',
        backgroundColor: isDark ? colors.background : '#fff',
      }}
    >
      <View className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 items-center justify-center mr-4">
        {isChannel ? <Text className="text-2xl">📢</Text> : <Text className="text-2xl">👤</Text>}
        {unreadCount > 0 && (
          <View className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 border-2 border-white dark:border-slate-900 items-center justify-center">
            <Text className="text-[10px] font-black text-white">{unreadCount}</Text>
          </View>
        )}
      </View>

      <View className="flex-1">
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-sm font-black" style={{ color: colors.text }}>
            {item.customerName || item.title || 'Discussion'}
          </Text>
          {lastMsg.createdAt && (
            <Text className="text-[10px] font-black opacity-30" style={{ color: colors.text }}>
              {format(new Date(lastMsg.createdAt), 'h:mm a')}
            </Text>
          )}
        </View>
        <Text
          className="text-xs opacity-50 font-bold"
          style={{ color: colors.text }}
          numberOfLines={1}
        >
          {lastMsg.senderId === currentUserId ? 'You: ' : ''}
          {lastMsg.message || 'No messages yet...'}
        </Text>
      </View>
    </TouchableOpacity>
  );
};
