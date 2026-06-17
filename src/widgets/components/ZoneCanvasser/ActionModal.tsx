import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
  Modal,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { format, startOfDay, isBefore } from 'date-fns';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  ACTION_TITLES,
  PREFERRED_TIMES,
  SELECT_ITEMS,
} from '../../../utils/zone-canvasser-status';
import type { ActionSubmitData } from '../../../types/zone-canvasser';
import { OverlayModal } from './OverlayModal';

type Props = {
  visible: boolean;
  actionType: string;
  address: string;
  onSubmit: (data: ActionSubmitData) => void | Promise<void>;
  onCancel: () => void;
};

function getTodayStart(): Date {
  return startOfDay(new Date());
}

function clampToMinDate(date: Date, minDate: Date): Date {
  const normalized = startOfDay(date);
  return isBefore(normalized, minDate) ? minDate : normalized;
}

export function ActionModal({ visible, actionType, address, onSubmit, onCancel }: Props) {
  const todayStart = useMemo(() => getTodayStart(), [visible]);

  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [followupDate, setFollowupDate] = useState(getTodayStart);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [preferredTime, setPreferredTime] = useState('');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isGoBack = actionType === 'go_back';
  const isInterestedNoTime = actionType === 'interested_no_time';
  const title = ACTION_TITLES[actionType] || 'Action';

  useEffect(() => {
    if (visible) {
      setNote('');
      setName('');
      setFollowupDate(getTodayStart());
      setPreferredTime('');
      setSelectedItems([]);
      setShowDatePicker(false);
      setShowTimeDropdown(false);
      setSubmitting(false);
    }
  }, [visible, actionType]);

  const handleItemToggle = (item: string) => {
    setSelectedItems((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  };

  const handleDateFieldPress = useCallback(() => {
    setShowTimeDropdown(false);
    setShowDatePicker((v) => !v);
  }, []);

  const handleDateChange = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      if (Platform.OS === 'android') {
        setShowDatePicker(false);
        if (event.type === 'dismissed' || !date) return;
        setFollowupDate(clampToMinDate(date, todayStart));
        return;
      }
      if (date) {
        setFollowupDate(clampToMinDate(date, todayStart));
      }
    },
    [todayStart]
  );

  const handleFormSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit({
        note,
        ...(isInterestedNoTime && {
          name,
          followupDate: followupDate.toISOString(),
          prefferedTime: preferredTime,
          selectedItems,
        }),
        ...(isGoBack && {
          followupDate: followupDate.toISOString(),
          prefferedTime: preferredTime,
        }),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OverlayModal visible={visible} onRequestClose={onCancel}>
      <View className="w-[90%] max-h-[85%] rounded-xl overflow-hidden bg-white">
        <View className="flex-row justify-between items-center px-5 pt-5 pb-3">
          <Text className="text-xl font-semibold text-slate-800">{title}</Text>
          <TouchableOpacity onPress={onCancel}>
            <MaterialCommunityIcons name="close" size={24} color="#64748b" />
          </TouchableOpacity>
        </View>

        <ScrollView
          className="flex-grow-0"
          style={{ maxHeight: 420 }}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
        >
          {isInterestedNoTime && (
            <View className="flex-row gap-2 mb-4">
              <View className="flex-1">
                <Text className="text-xs font-semibold text-slate-800 mb-1.5">Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Enter Name"
                  className="h-12 border border-slate-200 rounded-lg px-3 text-slate-800"
                />
              </View>
              <View className="flex-1">
                <FollowUpDateField
                  label="Date"
                  value={followupDate}
                  open={showDatePicker}
                  onPress={handleDateFieldPress}
                  onChange={handleDateChange}
                  onClose={() => setShowDatePicker(false)}
                  minimumDate={todayStart}
                />
              </View>
            </View>
          )}

          {isGoBack && (
            <View className="mb-4 gap-3">
              <FollowUpDateField
                label="Follow Up Date"
                value={followupDate}
                open={showDatePicker}
                onPress={handleDateFieldPress}
                onChange={handleDateChange}
                onClose={() => setShowDatePicker(false)}
                minimumDate={todayStart}
              />
              <TimeSelect
                value={preferredTime}
                open={showTimeDropdown}
                onToggle={() => {
                  setShowDatePicker(false);
                  setShowTimeDropdown((v) => !v);
                }}
                onSelect={(t) => {
                  setPreferredTime(t);
                  setShowTimeDropdown(false);
                }}
              />
            </View>
          )}

          {isInterestedNoTime && (
            <View className="mb-4">
              <TimeSelect
                value={preferredTime}
                open={showTimeDropdown}
                onToggle={() => {
                  setShowDatePicker(false);
                  setShowTimeDropdown((v) => !v);
                }}
                onSelect={(t) => {
                  setPreferredTime(t);
                  setShowTimeDropdown(false);
                }}
              />
            </View>
          )}

          <View className="mb-4">
            <Text className="text-xs font-semibold text-slate-800 mb-1.5">Address</Text>
            <TextInput
              value={address}
              editable={false}
              className="h-12 border border-slate-200 rounded-lg px-3 bg-neutral-100 text-slate-600"
            />
          </View>

          <View className="mb-4">
            <Text className="text-xs font-semibold text-slate-800 mb-1.5">Note</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Enter additional notes..."
              multiline
              numberOfLines={3}
              className="min-h-[80px] border border-slate-200 rounded-lg px-3 py-2 text-slate-800"
              textAlignVertical="top"
            />
          </View>

          {isInterestedNoTime && (
            <View className="mb-4">
              <Text className="text-[15px] font-bold text-slate-800 mb-2">Select Item</Text>
              <View className="flex-row flex-wrap gap-2">
                {SELECT_ITEMS.map((item) => (
                  <TouchableOpacity
                    key={item}
                    onPress={() => handleItemToggle(item)}
                    className={`px-3 py-2 rounded-full border ${
                      selectedItems.includes(item)
                        ? 'bg-slate-800 border-slate-800'
                        : 'border-slate-200'
                    }`}
                  >
                    <Text
                      className={`text-xs ${
                        selectedItems.includes(item) ? 'text-white' : 'text-slate-800'
                      }`}
                    >
                      {item}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        <View className="flex-row justify-end gap-3 p-5 border-t border-slate-100">
          <TouchableOpacity
            onPress={onCancel}
            disabled={submitting}
            className="px-6 py-3 rounded-lg border border-slate-200"
          >
            <Text className="text-slate-800 font-semibold">Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleFormSubmit}
            disabled={submitting}
            className="px-6 py-3 rounded-lg bg-slate-800"
          >
            <Text className="text-white font-bold">
              {submitting ? 'Submitting...' : 'Submit'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={followupDate}
          mode="date"
          minimumDate={todayStart}
          onChange={handleDateChange}
        />
      )}
    </OverlayModal>
  );
}

function FollowUpDateField({
  label,
  value,
  open,
  onPress,
  onChange,
  onClose,
  minimumDate,
}: {
  label: string;
  value: Date;
  open: boolean;
  onPress: () => void;
  onChange: (event: DateTimePickerEvent, date?: Date) => void;
  onClose: () => void;
  minimumDate: Date;
}) {
  return (
    <View>
      <Text className="text-xs font-semibold text-slate-800 mb-1.5">{label}</Text>
      <TouchableOpacity
        onPress={onPress}
        className="h-12 border border-slate-200 rounded-lg px-3 flex-row items-center justify-between"
      >
        <Text className="text-slate-800">{format(value, 'MM/dd/yyyy')}</Text>
        <MaterialCommunityIcons name="calendar" size={18} color="#64748b" />
      </TouchableOpacity>

      {open && Platform.OS === 'ios' && (
        <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 20 }}
            activeOpacity={1}
            onPress={onClose}
          >
            <TouchableOpacity activeOpacity={1} className="w-full bg-white rounded-2xl overflow-hidden shadow-2xl p-4">
              <DateTimePicker
                value={value}
                mode="date"
                display="inline"
                minimumDate={minimumDate}
                themeVariant="light"
                onChange={onChange}
              />
              <TouchableOpacity
                onPress={onClose}
                className="mt-4 py-3 rounded-xl items-center bg-slate-800"
              >
                <Text className="text-white font-semibold text-sm">Done</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

function TimeSelect({
  value,
  open,
  onToggle,
  onSelect,
}: {
  value: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (t: string) => void;
}) {
  return (
    <View className="z-10">
      <Text className="text-xs font-semibold text-slate-800 mb-1.5">Preferred Time</Text>
      <TouchableOpacity
        onPress={onToggle}
        className="h-12 border border-slate-200 rounded-lg px-3 flex-row items-center justify-between bg-white"
      >
        <Text className={`text-slate-800 ${!value ? 'text-slate-400' : ''}`}>
          {value || 'Select time'}
        </Text>
        <MaterialCommunityIcons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={20}
          color="#64748b"
        />
      </TouchableOpacity>

      {open && (
        <View className="mt-1 border border-slate-200 rounded-lg bg-white overflow-hidden">
          <ScrollView
            style={{ maxHeight: 200 }}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            {PREFERRED_TIMES.map((time, index) => (
              <TouchableOpacity
                key={time}
                onPress={() => onSelect(time)}
                className={`px-4 py-3.5 ${
                  value === time ? 'bg-slate-100' : 'bg-white'
                } ${index < PREFERRED_TIMES.length - 1 ? 'border-b border-slate-100' : ''}`}
              >
                <Text
                  className={`text-slate-800 text-sm ${
                    value === time ? 'font-semibold' : 'font-normal'
                  }`}
                >
                  {time}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
