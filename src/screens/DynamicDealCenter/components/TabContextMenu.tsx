import React, { forwardRef, memo, useImperativeHandle, useState } from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { isTabEmpty, type GateTab } from '../../../utils/calculator-tab-gate';

export interface TabContextMenuHandle {
  open: (tabIndex: number) => void;
}

interface Props {
  tabs: (GateTab & { id: string; title: string })[];
  onDuplicateTab?: (id: string) => void;
  onDeleteRequest?: (id: string, name: string) => void;
}

const ROW = { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12 } as const;

// The tab's three-dot / long-press menu. It owns its OWN open state and is opened through a ref, so tapping the dots
// re-renders only this tiny component. Holding the state in `CalculatorView` re-rendered that whole screen (every
// tab, the field list, the footer) before the menu could paint, which is the delay the rep saw. `animationType`
// is `none` for the same reason: a fade would add its duration to an already-late menu.
function TabContextMenuBase({ tabs, onDuplicateTab, onDeleteRequest }: Props, ref: React.Ref<TabContextMenuHandle>) {
  const [idx, setIdx] = useState<number | null>(null);
  useImperativeHandle(ref, () => ({ open: (i: number) => setIdx(i) }), []);

  const tab = idx !== null ? tabs[idx] : null;
  const canDuplicate = Boolean(tab && !isTabEmpty(tab));
  const close = () => setIdx(null);

  return (
    <Modal transparent visible={idx !== null} animationType="none" onRequestClose={close}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.2)' }} onPress={close}>
        <View style={{ position: 'absolute', bottom: 90, left: 20, right: 20, backgroundColor: '#fff', borderRadius: 16, padding: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 10 }}>
          {onDuplicateTab && tab && (
            <TouchableOpacity
              onPress={() => { onDuplicateTab(tab.id); close(); }}
              accessibilityState={{ disabled: !canDuplicate }}
              style={[ROW, !canDuplicate && { opacity: 0.4 }]}
            >
              <Feather name="copy" size={18} color="#637381" />
              <Text style={{ marginLeft: 12, fontSize: 14, fontWeight: '600', color: '#1C252E' }}>Duplicate</Text>
            </TouchableOpacity>
          )}
          {onDeleteRequest && tab && tabs.length > 1 && (
            <TouchableOpacity onPress={() => { onDeleteRequest(tab.id, tab.title); close(); }} style={ROW}>
              <Feather name="trash-2" size={18} color="#FF5630" />
              <Text style={{ marginLeft: 12, fontSize: 14, fontWeight: '600', color: '#FF5630' }}>Delete</Text>
            </TouchableOpacity>
          )}
          <View style={{ height: 1, backgroundColor: '#F1F5F9', marginVertical: 4 }} />
          <TouchableOpacity onPress={close} style={ROW}>
            <Feather name="x" size={18} color="#919EAB" />
            <Text style={{ marginLeft: 12, fontSize: 14, fontWeight: '600', color: '#919EAB' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}

export const TabContextMenu = memo(forwardRef(TabContextMenuBase));
