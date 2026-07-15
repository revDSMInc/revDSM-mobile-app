import React, { useCallback, useState } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { resolveFieldNotice } from '../../../utils/dynamic-job-builder/engine/notice-utils';

interface NoticeContent {
  head: string;
  dealsDescription: string;
}

/**
 * Controlled "Important Notice" popup for any widget (port of web
 * `field-notice-modal.js`). It renders whatever `notice` it is given and its
 * visibility is owned by `open` — it never inspects the field value itself, so it
 * can only ever open when something explicitly asks it to.
 */
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

/**
 * Wires a notice popup to a field (port of web `useFieldNotice`).
 *
 * Returns `{ noticeModal, handleValueChange }`:
 *   - Render `noticeModal` inside the widget.
 *   - Call `handleValueChange(newValue)` from the widget's onChange handler.
 *
 * The popup opens ONLY in response to `handleValueChange` — a real user
 * interaction. It is never driven by the current value on render, so an initial
 * load / DB hydration that restores a saved matching value will NOT reopen it.
 */
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
