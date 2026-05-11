import React from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface MiscSectionProps {
  jobState: any;
  onUpdate: (section: string, field: string, value: any) => void;
  calculatorData: any;
  onValidationError?: (error: string) => void;
}

export const MiscSection = ({
  jobState,
  onUpdate,
  calculatorData,
  onValidationError,
}: MiscSectionProps) => {
  const n = (v: any) => parseFloat(v) || 0;
  const getCalcVal = (key: string) => {
    if (!calculatorData) return 0;
    const lowerKey = key.toLowerCase();
    
    const findInObj = (obj: any) => {
      if (!obj || typeof obj !== 'object') return 0;
      const k = Object.keys(obj).find(ok => ok.toLowerCase() === lowerKey || ok.toLowerCase() === key.toLowerCase().replace('labor', 'labour'));
      return k ? n(obj[k]) : 0;
    };

    return findInObj(calculatorData.inputs) || 
           findInObj(calculatorData.extras) || 
           findInObj(calculatorData) || 
           findInObj(calculatorData.additional) ||
           0;
  };

  const extraLaborVal = getCalcVal('extraLabor');
  const screenPullsVal = getCalcVal('screens');

  const data = {
    extraLabor: extraLaborVal,
    numberOfScreenPulls: screenPullsVal,
    extraLaborReason: '',
    cutAndRemoveShingleOverhang: '',
    dripEdgeFlashingFootage: '',
    fortyFootLadderNeeded: '',
    requireHarnessWork: '',
    needWalkboards: '',
    ...(jobState.additional || {}),
  };


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
              data[field] === opt ? 'border-[#22C55E]' : 'bg-white border-slate-100'
            }`}
            style={data[field] === opt ? { backgroundColor: '#22C55E' } : {}}
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
          <Icon name="check" size={14} color="#22C55E" />
          <Text className="text-[10px] font-black ml-1 uppercase" style={{ color: '#22C55E' }}>
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
        {renderLockedField('Extra labor', `${extraLaborVal} Extra Labors`)}
        {renderLockedField('Number of Screen Pulls', `${screenPullsVal} Screen Pulls`)}

        {/* Reason Section - Always visible, amber if required but missing */}
        {/* Separate Warning Area - Does not wrap the input to maintain structure */}
        {extraLaborVal > 0 && !data.extraLaborReason?.trim() && (
          <View className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 flex-row items-center">
            <Icon name="alert-circle" size={18} color="#D97706" />
            <Text className="text-[10px] font-black text-amber-700 ml-2 uppercase tracking-widest">
              INCOMPLETE - Reason Required
            </Text>
          </View>
        )}

        <View
          className={`mb-6 p-6 rounded-2xl border ${
            extraLaborVal > 0 && !data.extraLaborReason?.trim()
              ? 'border-amber-400 bg-amber-50/20'
              : 'border-slate-100 bg-white'
          }`}
        >
          <Text
            className={`text-[10px] font-black mb-4 uppercase tracking-widest ${
              extraLaborVal > 0 && !data.extraLaborReason?.trim()
                ? 'text-amber-600'
                : 'text-slate-400'
            }`}
          >
            Why is there additional labor?{' '}
            {extraLaborVal > 0 && !data.extraLaborReason?.trim() && '⚠️ Required'}
          </Text>
          <View
            className={`rounded-xl p-3 min-h-[100px] border ${
              extraLaborVal > 0 && !data.extraLaborReason?.trim()
                ? 'border-amber-200 bg-white'
                : 'border-slate-50 bg-slate-50'
            }`}
          >
            <TextInput
              key="reason-input-stable"
              value={data.extraLaborReason}
              onChangeText={(v) => handleUpdate('extraLaborReason', v)}
              placeholder="Enter reason for additional labor..."
              placeholderTextColor={
                extraLaborVal > 0 && !data.extraLaborReason?.trim() ? '#D97706' : '#94a3b8'
              }
              multiline
              className="text-xs font-bold text-slate-900 leading-4"
            />
          </View>
        </View>

        {/* Project Details */}
        {renderInput(
          'Cut And Remove Shingle Overhang',
          'cutAndRemoveShingleOverhang',
          'Enter cut and remove shingle overhang...'
        )}
        {renderInput(
          'Footage Of Drip Edge/Flashing',
          'dripEdgeFlashingFootage',
          'Enter footage of drip edge/flashing...',
          true
        )}
        {renderInput(
          'Is A Forty Foot Ladder Needed',
          'fortyFootLadderNeeded',
          'Enter if a forty foot ladder is needed...'
        )}

        {/* Yes/No Toggles */}
        {renderYesNo('Does This Install Require Harness Work', 'requireHarnessWork')}
        {renderYesNo('Does This Install Need Walkboards', 'needWalkboards')}
      </View>
    </ScrollView>
  );
};
