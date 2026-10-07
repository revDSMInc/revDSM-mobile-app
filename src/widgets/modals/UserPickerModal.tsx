import React, { useMemo, useState } from 'react';
import { View, Text, Modal, TextInput, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface PickableUser {
  id: string;
  name: string;
  roleName?: string;
  email?: string;
}

interface Props {
  visible: boolean;
  users: PickableUser[];
  selectedId?: string;
  title?: string;
  subtitle?: string;
  emptyText?: string;
  isLoading?: boolean;
  onSelect: (user: PickableUser) => void;
  onClose: () => void;
}

const initialsOf = (name: string) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase() || '?';

export function UserPickerModal({
  visible,
  users,
  selectedId,
  title = 'Choose a person',
  subtitle,
  emptyText = 'Nobody available',
  isLoading,
  onSelect,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 12);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        String(u.name || '').toLowerCase().includes(q) ||
        String(u.roleName || '').toLowerCase().includes(q) ||
        String(u.email || '').toLowerCase().includes(q)
    );
  }, [users, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(17,20,24,0.45)', justifyContent: 'flex-end' }}>
        {/* Tapping the scrim closes, matching every other bottom sheet here. */}
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '78%', paddingBottom: bottomPad }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0' }} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontFamily: 'PublicSans-Bold', color: '#111418' }}>{title}</Text>
              {!!subtitle && (
                <Text style={{ fontSize: 11.5, fontFamily: 'PublicSans-SemiBold', color: '#9AA1AB', marginTop: 2 }}>
                  {subtitle}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={20} color="#5B626C" />
            </TouchableOpacity>
          </View>

          {users.length > 6 && (
            <View style={{ marginHorizontal: 18, marginBottom: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E6E8EC', borderRadius: 10, paddingHorizontal: 10 }}>
              <Ionicons name="search" size={15} color="#9AA1AB" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name or role"
                placeholderTextColor="#9AA1AB"
                autoCapitalize="none"
                autoCorrect={false}
                style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 8, fontSize: 13, fontFamily: 'PublicSans-SemiBold', color: '#111418' }}
              />
            </View>
          )}

          {isLoading ? (
            <View style={{ paddingVertical: 34, alignItems: 'center' }}>
              <ActivityIndicator color="#4CBB17" />
            </View>
          ) : filtered.length === 0 ? (
            <Text style={{ paddingHorizontal: 18, paddingVertical: 26, textAlign: 'center', fontSize: 12.5, fontFamily: 'PublicSans-SemiBold', color: '#9AA1AB' }}>
              {query.trim() ? 'Nobody matches that search' : emptyText}
            </Text>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(u) => String(u.id)}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 8 }}
              renderItem={({ item }) => {
                const on = String(item.id) === String(selectedId || '');
                return (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      onSelect(item);
                      onClose();
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 18, paddingVertical: 11, backgroundColor: on ? '#F4F5F7' : 'transparent' }}
                  >
                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#E7DFFB', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 12, fontFamily: 'PublicSans-ExtraBold', color: '#6B4ECF' }}>{initialsOf(item.name)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 13.5, fontFamily: 'PublicSans-Bold', color: '#111418' }} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {!!item.roleName && (
                        <Text style={{ fontSize: 11.5, fontFamily: 'PublicSans-SemiBold', color: '#9AA1AB', marginTop: 1 }} numberOfLines={1}>
                          {item.roleName}
                        </Text>
                      )}
                    </View>
                    {on && <Ionicons name="checkmark-circle" size={19} color="#4CBB17" />}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

export default UserPickerModal;
