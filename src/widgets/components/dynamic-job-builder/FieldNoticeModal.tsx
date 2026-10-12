import React, { useCallback, useState } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { resolveAnyFieldNotice } from '../../../utils/dynamic-job-builder/engine/notice-utils';

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

// ⚠️ The popup is presented by ONE host mounted at the top of `DynamicTabRenderer`, not by a Modal inside
// each field. A Modal owned by the field died with it whenever the field's card re-mounted (a combination
// added or renumbered in My Deals) and, inside a scrolling card, iOS could fail to present it at all.
//
// The OPEN notice itself also lives at module level (`activeNotice`) until the rep dismisses it, so even if
// the whole tab re-mounts right after the pick (the host included), the new host opens it again.
type NoticeListener = (notice: NoticeContent) => void;
let noticeListener: NoticeListener | null = null;
let activeNotice: NoticeContent | null = null;

let lastPublished = { key: '', at: 0 };

/**
 * Show a notice through the mounted host. De-duplicated for 1.5 s on identical text, because a pick reaches
 * here twice by design (the field's own `onChange` AND `useFieldNoticeWatcher`, which sees the value change in
 * job state). Returns false when no host is mounted.
 */
export function publishFieldNotice(notice: NoticeContent): boolean {
  if (!noticeListener) return false;
  const key = `${notice.head}|${notice.dealsDescription}`;
  const now = Date.now();
  if (lastPublished.key === key && now - lastPublished.at < 1500) return true;
  lastPublished = { key, at: now };
  activeNotice = notice;
  noticeListener(notice);
  return true;
}

export function FieldNoticeHost() {
  const [state, setState] = useState<{ open: boolean; notice: NoticeContent | null }>(() => ({
    open: !!activeNotice,
    notice: activeNotice,
  }));

  React.useEffect(() => {
    const listener: NoticeListener = (notice) => setState({ open: true, notice });
    noticeListener = listener;
    return () => {
      if (noticeListener === listener) noticeListener = null;
    };
  }, []);

  const close = useCallback(() => {
    activeNotice = null;
    setState((prev) => ({ ...prev, open: false }));
  }, []);
  return <FieldNoticeModal notice={state.notice} open={state.open} onClose={close} />;
}

export function useFieldNotice(field: any) {
  const [state, setState] = useState<{ open: boolean; notice: NoticeContent | null }>({
    open: false,
    notice: null,
  });

  const handleValueChange = useCallback(
    (value: any) => {
      const notice = resolveAnyFieldNotice(field, value);
      if (__DEV__ && field?.notice?.enabled) {
        console.log('[FieldNotice] pick', { field: field.label || field.id, picked: value, fires: !!notice, hasHost: !!noticeListener });
      }
      if (notice) {
        // No host mounted (a field rendered outside the tab renderer) → fall back to a local modal.
        if (!publishFieldNotice(notice)) setState({ open: true, notice });
      } else if (__DEV__ && field?.notice?.enabled) {
        console.log('[FieldNotice] enabled but not fired', {
          field: field.label || field.id,
          picked: value,
          triggerValue: field.notice.triggerValue,
          hasText: !!(field.notice.head || field.notice.dealsDescription),
        });
      }
    },
    [field],
  );

  const close = useCallback(() => setState((prev) => ({ ...prev, open: false })), []);

  const noticeModal = (
    <FieldNoticeModal notice={state.notice} open={state.open} onClose={close} />
  );

  return { noticeModal, handleValueChange };
}
