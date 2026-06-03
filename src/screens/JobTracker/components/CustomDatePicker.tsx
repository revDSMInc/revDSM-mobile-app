import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  ScrollView,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  parseISO,
} from 'date-fns';
import { useTheme } from '../../../../src/theme/ThemeProvider';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (date: string) => void;
  initialDate?: string;
}

export const CustomDatePicker = ({ visible, onClose, onSelect, initialDate }: Props) => {
  const { colors, isDark } = useTheme();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [view, setView] = useState<'calendar' | 'month' | 'year'>('calendar');
  const selectedDate = initialDate ? parseISO(initialDate) : new Date();

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 0 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const calendarDays = eachDayOfInterval({
    start: startDate,
    end: endDate,
  });

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableWithoutFeedback onPress={onClose}>
        <View className="flex-1 bg-black/40 items-center justify-center px-6">
          <TouchableWithoutFeedback>
            <View className="w-full bg-card rounded-[32px] p-6 shadow-2xl">
              {/* Header */}
              <View className="flex-row items-center justify-between mb-8">
                <TouchableOpacity
                  className="flex-row items-center"
                  onPress={() => setView(view === 'month' ? 'calendar' : 'month')}
                >
                  <Text className="text-lg font-bold text-text-primary mr-2">
                    {format(currentMonth, 'MMMM yyyy')}
                  </Text>
                  <Feather
                    name={view === 'month' ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>

                {view === 'calendar' && (
                  <View className="flex-row items-center gap-6">
                    <TouchableOpacity
                      onPress={prevMonth}
                      disabled={isSameMonth(currentMonth, new Date())}
                      style={{ opacity: isSameMonth(currentMonth, new Date()) ? 0.3 : 1 }}
                    >
                      <Feather name="chevron-left" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={nextMonth}>
                      <Feather name="chevron-right" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {view === 'calendar' ? (
                <>
                  {/* Week Days */}
                  <View className="flex-row mb-4">
                    {weekDays.map((day) => (
                      <View key={day} className="flex-1 items-center">
                        <Text className="text-[13px] font-bold text-text-secondary">{day}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Days Grid */}
                  <View className="flex-row flex-wrap">
                    {calendarDays.map((day, i) => {
                      const isCurrentMonth = isSameMonth(day, monthStart);
                      const isSelected = isSameDay(day, selectedDate);

                      if (!isCurrentMonth) {
                        return <View key={i} className="w-[14.28%] h-10 mb-2" />;
                      }

                      return (
                        <TouchableOpacity
                          key={i}
                          onPress={() => {
                            onSelect(format(day, 'yyyy-MM-dd'));
                            onClose();
                          }}
                          className={`w-[14.28%] h-10 items-center justify-center mb-2 rounded-full`}
                        >
                          <View className={`w-10 h-10 items-center justify-center rounded-full ${isSelected ? 'bg-[#72BD00]' : ''
                            }`}>
                            <Text
                              className={`text-[13px] font-medium ${isSelected ? 'text-white' : 'text-text-primary'
                                }`}
                            >
                              {format(day, 'd')}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              ) : view === 'month' ? (
                <View className="flex-row flex-wrap justify-between gap-y-4">
                  {[
                    'Jan',
                    'Feb',
                    'Mar',
                    'Apr',
                    'May',
                    'Jun',
                    'Jul',
                    'Aug',
                    'Sep',
                    'Oct',
                    'Nov',
                    'Dec',
                  ].map((m, idx) => (
                    <TouchableOpacity
                      key={m}
                      onPress={() => {
                        const next = new Date(currentMonth);
                        next.setMonth(idx);
                        setCurrentMonth(next);
                        setView('calendar');
                      }}
                      className={`w-[23%] py-3 rounded-xl items-center ${currentMonth.getMonth() === idx ? 'bg-[#72BD00]' : 'bg-surface'
                        }`}
                    >
                      <Text
                        className={`text-xs font-bold ${currentMonth.getMonth() === idx ? 'text-white' : 'text-text-primary'
                          }`}
                      >
                        {m}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={() => setView('year')}
                    className="w-full mt-4 py-4 border-t border-border items-center"
                  >
                    <Text className="text-xs font-bold text-[#72BD00]">Change Year</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                  <View className="flex-row flex-wrap justify-between gap-y-3 pb-8">
                    {Array.from({ length: 30 }, (_, i) => new Date().getFullYear() + 5 - i).map(
                      (y) => (
                        <TouchableOpacity
                          key={y}
                          onPress={() => {
                            const next = new Date(currentMonth);
                            next.setFullYear(y);
                            setCurrentMonth(next);
                            setView('calendar');
                          }}
                          className={`w-[31%] py-3 rounded-xl items-center ${currentMonth.getFullYear() === y ? 'bg-[#72BD00]' : 'bg-surface'
                            }`}
                        >
                          <Text
                            className={`text-sm font-black ${currentMonth.getFullYear() === y ? 'text-white' : 'text-text-primary'
                              }`}
                          >
                            {y}
                          </Text>
                        </TouchableOpacity>
                      )
                    )}
                  </View>
                </ScrollView>
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
