/**
 * CreateChannelModal — mobile port of the web `create-channel-dialog.js`.
 *
 * Lets a user create a new team channel: pick one of the six fixed channel types
 * (each carrying its own icon/color/description/restrictedPosting default), enter a
 * name + optional description, and toggle restricted posting. On submit it builds the
 * SAME payload the web dialog builds and hands it to `onCreate`, which the caller wires
 * to `ChatService.createChannel` (socket `create-team-channel`).
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import { useAuth } from '../../../hooks/useAuth';
import { FlashMessage } from '../../../config/message';

// Channel types and configs strictly mirror the web Implementation Guide
// (`src/components/team-channels/constants.js` / `create-channel-dialog.js`).
export const CHANNEL_TYPES = [
  { value: 'announcements', label: 'Announcements', icon: '📢', color: '#FF6B6B', description: 'Management announcements', restrictedPosting: true },
  { value: 'sales-wins', label: 'Sales Wins', icon: '🎉', color: '#51CF66', description: 'Celebrate deal closures', restrictedPosting: false },
  { value: 'general', label: 'General', icon: '💬', color: '#748FFC', description: 'Open team discussion', restrictedPosting: false },
  { value: 'files', label: 'Files', icon: '📁', color: '#339AF0', description: 'Company resources', restrictedPosting: true },
  { value: 'commission-sheets', label: 'Commission Sheets', icon: '💰', color: '#FFC107', description: 'Commission reports & earnings', restrictedPosting: true },
  { value: 'questions', label: 'Questions', icon: '❓', color: '#9775FA', description: 'Q&A and knowledge building', restrictedPosting: false },
] as const;

type ChannelType = (typeof CHANNEL_TYPES)[number];

interface CreateChannelModalProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (channelData: any) => void;
}

export default function CreateChannelModal({ visible, onClose, onCreate }: CreateChannelModalProps) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();

  const [title, setTitle] = useState('');
  const [channelType, setChannelType] = useState<string>('general');
  const [description, setDescription] = useState('');
  const [restrictedPosting, setRestrictedPosting] = useState(false);
  const [creating, setCreating] = useState(false);

  const selectedType: ChannelType =
    CHANNEL_TYPES.find((t) => t.value === channelType) || CHANNEL_TYPES[2];

  const resetForm = () => {
    setTitle('');
    setChannelType('general');
    setDescription('');
    setRestrictedPosting(false);
    setCreating(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSelectType = (type: ChannelType) => {
    setChannelType(type.value);
    // Follow web: selecting a type applies its default restrictedPosting + description hint.
    setRestrictedPosting(type.restrictedPosting);
  };

  const handleCreate = () => {
    if (!title.trim()) {
      FlashMessage.warning('Please enter a channel name');
      return;
    }
    setCreating(true);
    try {
      const channelData = {
        chatType: 'channel', // Important for backend mapping (web parity)
        name: title.trim(),
        title: title.trim(),
        channelType: selectedType.value,
        description: description.trim() || selectedType.description,
        createdBy: user?.id || user?._id,
        companyId: user?.companyId,
        channelConfig: {
          icon: selectedType.icon,
          color: selectedType.color,
          description: description.trim() || selectedType.description,
          restrictedPosting,
        },
      };

      onCreate(channelData);
      FlashMessage.info('Creation request sent!');

      setTimeout(() => {
        resetForm();
        onClose();
      }, 400);
    } catch (err) {
      console.error('[CreateChannelModal] creation error:', err);
      FlashMessage.error('Failed to initiate creation');
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <TouchableOpacity
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)' }}
            activeOpacity={1}
            onPress={handleClose}
          />
          <View
            className="mx-5 rounded-3xl overflow-hidden"
            style={{ backgroundColor: colors.card, maxHeight: '85%' }}
          >
            {/* Header */}
            <View
              className="px-5 py-4 flex-row items-center justify-between border-b"
              style={{ borderColor: colors.border }}
            >
              <Text className="text-lg font-black" style={{ color: colors.text }}>
                Create New Team Channel
              </Text>
              <TouchableOpacity onPress={handleClose} className="w-8 h-8 items-center justify-center">
                <Icon name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={{ padding: 20 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Channel Name */}
              <Text className="text-xs font-bold mb-2" style={{ color: colors.textSecondary }}>
                CHANNEL NAME
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g., marketing-team"
                placeholderTextColor={'#919EAB'}
                autoFocus
                className="h-12 px-4 rounded-xl border text-sm mb-5"
                style={{ backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }}
              />

              {/* Channel Type */}
              <Text className="text-xs font-bold mb-2" style={{ color: colors.textSecondary }}>
                CHANNEL TYPE
              </Text>
              <View className="mb-5">
                {CHANNEL_TYPES.map((type) => {
                  const active = channelType === type.value;
                  return (
                    <TouchableOpacity
                      key={type.value}
                      onPress={() => handleSelectType(type)}
                      activeOpacity={0.8}
                      className="flex-row items-center px-3 py-3 rounded-xl mb-2 border"
                      style={{
                        backgroundColor: active ? `${type.color}22` : colors.surface,
                        borderColor: active ? type.color : colors.border,
                      }}
                    >
                      <View
                        className="w-10 h-10 rounded-lg items-center justify-center mr-3"
                        style={{ backgroundColor: `${type.color}22` }}
                      >
                        <Text style={{ fontSize: 18 }}>{type.icon}</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-bold" style={{ color: colors.text }}>
                          {type.label}
                        </Text>
                        <Text className="text-[11px] mt-0.5" style={{ color: colors.textSecondary }} numberOfLines={1}>
                          {type.description}
                        </Text>
                      </View>
                      {active && <Icon name="checkmark-circle" size={22} color={type.color} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Description */}
              <Text className="text-xs font-bold mb-2" style={{ color: colors.textSecondary }}>
                DESCRIPTION (OPTIONAL)
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder={selectedType.description}
                placeholderTextColor={'#919EAB'}
                multiline
                numberOfLines={2}
                className="px-4 py-3 rounded-xl border text-sm mb-5"
                style={{
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.text,
                  minHeight: 64,
                  textAlignVertical: 'top',
                }}
              />

              {/* Restricted Posting */}
              <View
                className="flex-row items-center justify-between px-4 py-3 rounded-xl border mb-2"
                style={{ backgroundColor: colors.surface, borderColor: colors.border }}
              >
                <View className="flex-1 mr-3">
                  <Text className="text-sm font-bold" style={{ color: colors.text }}>
                    Restricted Posting
                  </Text>
                  <Text className="text-[11px] mt-0.5" style={{ color: colors.textSecondary }}>
                    Only managers can post in this channel
                  </Text>
                </View>
                <Switch
                  value={restrictedPosting}
                  onValueChange={setRestrictedPosting}
                  trackColor={{ false: '#767577', true: colors.primary.main }}
                  thumbColor={'#fff'}
                />
              </View>
            </ScrollView>

            {/* Actions */}
            <View
              className="px-5 py-4 flex-row items-center justify-end border-t"
              style={{ borderColor: colors.border }}
            >
              <TouchableOpacity onPress={handleClose} className="px-5 py-3 mr-2">
                <Text className="text-sm font-bold" style={{ color: colors.textSecondary }}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreate}
                disabled={!title.trim() || creating}
                className="px-6 py-3 rounded-xl"
                style={{
                  backgroundColor: !title.trim() || creating ? (isDark ? '#374151' : '#E5E7EB') : colors.primary.main,
                }}
              >
                <Text
                  className="text-sm font-bold"
                  style={{ color: !title.trim() || creating ? colors.textSecondary : '#fff' }}
                >
                  {creating ? 'Creating...' : 'Create Channel'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
