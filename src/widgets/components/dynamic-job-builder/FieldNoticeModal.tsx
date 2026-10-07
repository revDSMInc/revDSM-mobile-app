import React, { useCallback, useState } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { resolveFieldNotice } from '../../../utils/dynamic-job-builder/engine/notice-utils';

interface NoticeContent {
  head: string;
  dealsDescription: string;
}

export function FieldNoticeModal({
  notice,
  open,
  onClose,
}: {
  notice: NoticeContent | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!notice) return null;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 items-center justify-center px-8">
        <View className="w-full bg-white rounded-3xl p-6">
          <View className="flex-row items-start justify-between mb-3">
            <Text className="text-[16px] font-black text-slate-900 flex-1 pr-2">
              {notice.head || 'Important Notice'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          {!!notice.dealsDescription && (
            <Text className="text-[13px] text-slate-500 leading-5 mb-5">
              {notice.dealsDescription}
            </Text>
          )}

          <View className="items-end">
            <TouchableOpacity
              onPress={onClose}
              className="rounded-xl px-6 py-2.5"
              style={{ backgroundColor: '#22C55E' }}
            >
              <Text className="text-white text-[13px] font-black">OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function useFieldNotice(field: any) {
  const [state, setState] = useState<{ open: boolean; notice: NoticeContent | null }>({
    open: false,
    notice: null,
  });

  const handleValueChange = useCallback(
    (value: any) => {
      const notice = resolveFieldNotice(field, value);
      if (notice) setState({ open: true, notice });
    },
    [field],
  );

  const close = useCallback(() => setState((prev) => ({ ...prev, open: false })), []);

  const noticeModal = (
    <FieldNoticeModal notice={state.notice} open={state.open} onClose={close} />
  );

  return { noticeModal, handleValueChange };
}
