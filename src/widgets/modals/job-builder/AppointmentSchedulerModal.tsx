import React, { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, TextInput, Platform } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { format, addDays } from 'date-fns';

interface AppointmentSchedulerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (data: any) => void;
  customerName: string;
}

export const AppointmentSchedulerModal = ({
  visible,
  onClose,
  onConfirm,
  customerName,
}: AppointmentSchedulerModalProps) => {
  const { colors, isDark } = useTheme();
  const [selectedDate, setSelectedDate] = useState<Date | 'TBD'>(new Date());
  const [selectedWindow, setSelectedWindow] = useState('AM (8-12)');
  const [tbdReason, setTbdReason] = useState('');

  const windows = ['AM (8-12)', 'PM (12-4)', 'Evening (4-8)'];

  // Generate next 14 days
  const dates = Array.from({ length: 14 }).map((_, i) => addDays(new Date(), i));

  const handleConfirm = () => {
    if (selectedDate === 'TBD') {
      onConfirm({
        date: 'TBD',
        reason: tbdReason,
        customerName,
      });
    } else {
      onConfirm({
        date: format(selectedDate, 'PP'),
        timeWindow: selectedWindow,
        customerName,
      });
    }
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 bg-black/60 justify-end">
        <View
          className="bg-white rounded-t-[40px] p-8 pb-12"
          style={{ backgroundColor: isDark ? colors.surface : '#FFFFFF' }}
        >
          <View className="flex-row justify-between items-center mb-8">
            <View>
              <Text className="text-xl font-black text-slate-900 uppercase">
                Schedule Appointment
              </Text>
              <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                Required for Agreement Generation
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              className="w-10 h-10 rounded-full bg-slate-50 items-center justify-center"
            >
              <Icon name="close" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Date Picker */}
            <Text className="text-[10px] font-black text-slate-400 uppercase tracking-[2px] mb-4 ml-1">
              Select Install Date
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-8">
              <TouchableOpacity
                onPress={() => setSelectedDate('TBD')}
                className={`w-20 h-24 rounded-3xl items-center justify-center border mr-3 ${
                  selectedDate === 'TBD'
                    ? 'bg-slate-900 border-slate-900'
                    : 'bg-white border-slate-100'
                }`}
              >
                <Icon
                  name="help-circle-outline"
                  size={24}
                  color={selectedDate === 'TBD' ? 'white' : '#64748b'}
                />
                <Text
                  className={`text-[10px] font-black uppercase mt-2 ${
                    selectedDate === 'TBD' ? 'text-white' : 'text-slate-600'
                  }`}
                >
                  TBD
                </Text>
              </TouchableOpacity>

              {dates.map((date, i) => {
                const isSelected =
                  selectedDate !== 'TBD' && format(selectedDate, 'PP') === format(date, 'PP');
                return (
                  <TouchableOpacity
                    key={i}
                    onPress={() => setSelectedDate(date)}
                    className={`w-20 h-24 rounded-3xl items-center justify-center border mr-3 ${
                      isSelected ? 'bg-slate-900 border-slate-900' : 'bg-white border-slate-100'
                    }`}
                  >
                    <Text
                      className={`text-[10px] font-bold uppercase ${
                        isSelected ? 'text-slate-400' : 'text-slate-400'
                      }`}
                    >
                      {format(date, 'EEE')}
                    </Text>
                    <Text
                      className={`text-xl font-black mt-1 ${
                        isSelected ? 'text-white' : 'text-slate-900'
                      }`}
                    >
                      {format(date, 'd')}
                    </Text>
                    <Text
                      className={`text-[10px] font-bold uppercase mt-1 ${
                        isSelected ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {format(date, 'MMM')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {selectedDate === 'TBD' ? (
              <View className="mb-8">
                <Text className="text-[10px] font-black text-slate-400 uppercase tracking-[2px] mb-4 ml-1">
                  Reason for TBD
                </Text>
                <TextInput
                  value={tbdReason}
                  onChangeText={setTbdReason}
                  multiline
                  placeholder="Explain why date is not set..."
                  className="bg-slate-50 p-5 rounded-3xl font-bold text-slate-900 border border-slate-100"
                  style={{ height: 120, textAlignVertical: 'top' }}
                />
              </View>
            ) : (
              <View className="mb-8">
                <Text className="text-[10px] font-black text-slate-400 uppercase tracking-[2px] mb-4 ml-1">
                  Time Window
                </Text>
                <View className="gap-3">
                  {windows.map((w) => (
                    <TouchableOpacity
                      key={w}
                      onPress={() => setSelectedWindow(w)}
                      className={`h-16 px-6 rounded-2xl flex-row items-center border ${
                        selectedWindow === w
                          ? 'bg-slate-900 border-slate-900'
                          : 'bg-white border-slate-100'
                      }`}
                    >
                      <View
                        className={`w-5 h-5 rounded-full border-2 items-center justify-center mr-4 ${
                          selectedWindow === w ? 'border-white' : 'border-slate-200'
                        }`}
                      >
                        {selectedWindow === w && (
                          <View className="w-2.5 h-2.5 rounded-full bg-white" />
                        )}
                      </View>
                      <Text
                        className={`font-black uppercase text-xs ${
                          selectedWindow === w ? 'text-white' : 'text-slate-700'
                        }`}
                      >
                        {w}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <TouchableOpacity
              onPress={handleConfirm}
              disabled={selectedDate === 'TBD' && !tbdReason.trim()}
              className={`h-16 rounded-3xl items-center justify-center shadow-lg ${
                selectedDate === 'TBD' && !tbdReason.trim()
                  ? 'bg-slate-200 shadow-none'
                  : 'bg-green-500 shadow-green-500/30'
              }`}
            >
              <Text
                className={`font-black uppercase tracking-widest ${
                  selectedDate === 'TBD' && !tbdReason.trim() ? 'text-slate-400' : 'text-white'
                }`}
              >
                Confirm Schedule
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
