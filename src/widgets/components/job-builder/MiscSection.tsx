import React from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface MiscSectionProps {
  jobState: any;
  onUpdate: (section: string, field: string, value: any) => void;
  calculatorData: any;
}

export const MiscSection = ({ jobState, onUpdate, calculatorData }: MiscSectionProps) => {
  const { colors, isDark } = useTheme();
  const data = jobState.additional || {
    extraLabor: 0,
    numberOfScreenPulls: 0,
    extraLaborReason: '',
    cutAndRemoveShingleOverhang: '',
    dripEdgeFlashingFootage: '',
    fortyFootLadderNeeded: '',
    requireHarnessWork: '',
    needWalkboards: '',
  };

  // Sync from calculatorData
  React.useEffect(() => {
    const calcLabor = parseFloat(calculatorData?.extraLabor || 0);
    const calcScreens = parseFloat(calculatorData?.screens || 0);

    if (
      calcLabor !== parseFloat(data.extraLabor) ||
      calcScreens !== parseFloat(data.numberOfScreenPulls)
    ) {
      onUpdate('additional', '', {
        ...data,
        extraLabor: calcLabor,
        numberOfScreenPulls: calcScreens,
      });
    }
  }, [calculatorData?.extraLabor, calculatorData?.screens]);

  const handleUpdate = (field: string, value: any) => {
    onUpdate('additional', field, value);
  };

  const isAnyFieldEmpty = () => {
    // Reason required if labor > 0
    if (parseFloat(data.extraLabor) > 0 && !data.extraLaborReason) return true;
    return false;
  };

  const renderWarning = (message: string) => (
    <View className="flex-row items-center bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
      <Icon name="alert" size={18} color="#D97706" />
      <Text className="text-[11px] font-black text-amber-700 ml-2 uppercase tracking-tight">
        {message}
      </Text>
    </View>
  );

  const renderLockedField = (label: string, value: string) => (
    <View className="mb-6">
      <View className="border border-slate-200 rounded-xl px-4 py-3 bg-white flex-row justify-between items-center">
        <View className="absolute -top-2 left-3 bg-white px-1">
          <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {label}
          </Text>
        </View>
        <Text className="text-sm font-black text-slate-500">{value}</Text>
        <Icon name="lock" size={18} color="#919eab" />
      </View>
      <Text className="text-[9px] font-bold text-slate-400 mt-1 ml-1 uppercase">
        Locked from Job Summary
      </Text>
    </View>
  );

  const renderInput = (label: string, field: string, placeholder = '', isNumeric = false) => (
    <View className="mb-4 bg-white border border-slate-200 rounded-xl px-4 py-2">
      <View className="absolute -top-2 left-3 bg-white px-1 z-10">
        <Text className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
          {label}
        </Text>
      </View>
      <TextInput
        value={String(data[field] || '')}
        onChangeText={(v) => handleUpdate(field, v)}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        keyboardType={isNumeric ? 'numeric' : 'default'}
        className="h-10 text-slate-900 font-black text-xs p-0"
      />
    </View>
  );

  const renderYesNo = (label: string, field: string) => (
    <View className="mb-6 p-4 bg-white border border-slate-100 rounded-xl">
      <Text className="text-[11px] font-black text-slate-900 mb-4 uppercase tracking-tight">
        {label}
      </Text>
      <View className="flex-row gap-4">
        {['Yes', 'No'].map((opt) => (
          <TouchableOpacity
            key={opt}
            onPress={() => handleUpdate(field, opt)}
            className={`flex-1 h-12 rounded-lg items-center justify-center border-2 ${
              data[field] === opt
                ? 'bg-emerald-500 border-emerald-500'
                : 'bg-white border-slate-100'
            }`}
          >
            <Text
              className={`font-black uppercase text-[12px] tracking-widest ${
                data[field] === opt ? 'text-white' : 'text-slate-900'
              }`}
            >
              {opt}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {data[field] && (
        <View className="flex-row items-center mt-3 ml-1">
          <Icon name="check" size={14} color="#10B981" />
          <Text className="text-[10px] font-black text-emerald-500 ml-1 uppercase">
            {data[field]}
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View className="px-5 py-5 pb-24 bg-white">
        {/* Sync'd Fields (Locked) */}
        {renderLockedField('Extra labor', `${data.extraLabor} Extra Labors`)}
        {renderLockedField('Number of Screen Pulls', `${data.numberOfScreenPulls} Screen Pulls`)}

        {/* Reason Section */}
        {parseFloat(data.extraLabor) > 0 && (
          <View
            className={`mb-6 p-6 rounded-xl border ${
              !data.extraLaborReason ? 'border-amber-500' : 'border-slate-100'
            } bg-white`}
          >
            {!data.extraLaborReason && (
              <View className="flex-row items-center mb-2">
                <Icon name="alert" size={16} color="#f59e0b" />
                <Text className="text-[11px] font-black text-amber-600 ml-2 uppercase">
                  Incomplete- Reason Required
                </Text>
              </View>
            )}
            <Text
              className={`text-sm font-black mb-4 ${
                !data.extraLaborReason ? 'text-amber-500' : 'text-slate-900'
              }`}
            >
              Why is there additional labor?{' '}
              {!data.extraLaborReason && <Icon name="alert" size={14} color="#f59e0b" />}{' '}
              {!data.extraLaborReason && 'Required'}
            </Text>
            <View className="bg-slate-50 border border-slate-100 rounded-lg p-3 min-h-[100px]">
              <TextInput
                value={data.extraLaborReason}
                onChangeText={(v) => handleUpdate('extraLaborReason', v)}
                placeholder="Enter reason for additional labor...."
                multiline
                className="text-xs font-medium text-slate-900"
              />
            </View>
          </View>
        )}

        {/* Project Details */}
        {renderInput(
          'Cut And Remove Shingle Oveernhang',
          'cutAndRemoveShingleOverhang',
          'Enter cut and remove shingle overhang...'
        )}
        {renderInput(
          'Footage Of Drip Edge/Flashing',
          'dripEdgeFlashingFootage',
          'Footage Of Drip Edge/Flashing',
          true
        )}
        {renderInput(
          'Is a Forty Foot Ladder Needed',
          'fortyFootLadderNeeded',
          'Enter is a Forty Foot Ladder Needed...'
        )}

        {/* Yes/No Toggles */}
        {renderYesNo('Does This install Require Harness Work', 'requireHarnessWork')}
        {renderYesNo('Does This install Need Walkboards', 'needWalkboards')}
      </View>
    </ScrollView>
  );
};
