import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';
import { CustomInput } from '../../../controls/input/CustomInput';

interface Props {
  lead: any;
  onClose: () => void;
  onSubmit: (payload: any) => Promise<void>;
}

type StepState = {
  gutter: any;
  leaffilter: any;
  soffit: any;
  fascia: any;
  additional: any;
};

export default function JobBuilder({ lead, onClose, onSubmit }: Props) {
  const { colors, isDark } = useTheme();
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 6;

  const [jobState, setJobState] = useState<StepState>({
    gutter: {
      partial: '',
      color: '',
      measurements: Array(18).fill(''),
      downspoutType: '',
      downspoutColor: '',
      size: '5',
    },
    leaffilter: {
      combinations: [{ id: 1, gutterProfile: 'Standard', lfColor: '', measurements: Array(12).fill('') }],
    },
    soffit: {
      vinyl: { type: '', footage: '', color: '' },
      porch: { type: '', footage: '', color: '' },
    },
    fascia: {
      wrap: { type: '', footage: '', size: '', color: '' },
      boards: { type: '', footage: '', size: '', boardType: '' },
    },
    additional: {
      extraLabor: 0,
      extraLaborReason: '',
      fortyFootLadderNeeded: 'No',
    },
  });

  const handleNext = () => {
    if (currentStep < totalSteps) setCurrentStep(currentStep + 1);
    else handleComplete();
  };

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
    else onClose();
  };

  const handleComplete = async () => {
    await onSubmit(jobState);
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1: return <GutterSection state={jobState.gutter} onChange={(s: any) => setJobState({...jobState, gutter: s})} />;
      case 2: return <LeafFilterSection state={jobState.leaffilter} onChange={(s: any) => setJobState({...jobState, leaffilter: s})} />;
      case 3: return <SoffitSection state={jobState.soffit} onChange={(s: any) => setJobState({...jobState, soffit: s})} />;
      case 4: return <FasciaSection state={jobState.fascia} onChange={(s: any) => setJobState({...jobState, fascia: s})} />;
      case 5: return <AdditionalSection state={jobState.additional} onChange={(s: any) => setJobState({...jobState, additional: s})} />;
      case 6: return <SummarySection state={jobState} />;
      default: return null;
    }
  };

  const stepTitles = ["Gutter Details", "LeafFilter", "Soffit Specs", "Fascia Specs", "Additional", "Summary"];

  return (
    <View className="flex-1" style={{ backgroundColor: isDark ? colors.surface : colors.grey[100] }}>
      {/* Header */}
      <View className="px-6 pt-12 pb-6 border-b flex-row justify-between items-center" style={{ backgroundColor: isDark ? colors.surface : '#fff', borderBottomColor: isDark ? colors.border : colors.grey[200] }}>
        <View>
          <Text className="text-[10px] font-black tracking-widest uppercase" style={{ color: colors.primary.main }}>STEP {currentStep} OF {totalSteps}</Text>
          <Text className="text-xl font-extrabold" style={{ color: colors.text }}>{stepTitles[currentStep-1]}</Text>
        </View>
        <TouchableOpacity onPress={onClose} className="p-2 rounded-xl" style={{ backgroundColor: isDark ? 'rgba(255,86,48,0.2)' : `${colors.error.main}20` }}>
           <Text className="font-bold text-xs" style={{ color: colors.error.main }}>CANCEL</Text>
        </TouchableOpacity>
      </View>

      {/* Progress Line */}
      <View className="flex-row">
        {Array(totalSteps).fill(0).map((_, i) => (
          <View 
            key={i} 
            className="flex-1 h-1" 
            style={{ backgroundColor: i + 1 <= currentStep ? colors.primary.main : (isDark ? colors.border : colors.grey[300]) }} 
          />
        ))}
      </View>

      {/* Content */}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerClassName="p-6 pb-20">
        {renderStep()}
        <View className="h-5" />
      </ScrollView>

      {/* Footer Actions */}
      <View className="p-6 pb-12 border-t flex-row gap-4" style={{ backgroundColor: isDark ? colors.surface : '#fff', borderTopColor: isDark ? colors.border : colors.grey[200] }}>
        <TouchableOpacity 
          onPress={handleBack}
          className="flex-1 h-14 rounded-2xl items-center justify-center border"
          style={{ borderColor: isDark ? colors.border : colors.grey[300] }}
        >
          <Text className="font-black text-sm" style={{ color: colors.text }}>{currentStep === 1 ? 'EXIT' : 'BACK'}</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={handleNext}
          className="flex-[2] h-14 rounded-2xl items-center justify-center shadow-sm"
          style={{ backgroundColor: colors.primary.main }}
        >
          <Text className="text-white text-sm font-black">{currentStep === totalSteps ? 'COMPLETE & SAVE' : 'NEXT STEP'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function GutterSection({ state, onChange }: { state: any, onChange: (s: any) => void }) {
  const { colors, isDark } = useTheme();
  return (
    <View>
      <View className="p-4 rounded-3xl border mb-6" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : '#fff', borderColor: isDark ? colors.border : colors.grey[200] }}>
        <Text className="text-[10px] font-black uppercase mb-4 opacity-50" style={{ color: colors.textSecondary }}>Gutter Specifications</Text>
        <CustomInput label="Gutter Color" value={state.color} onChangeText={(v) => onChange({...state, color: v})} placeholder="e.g. White" />
        <View className="flex-row gap-3">
          <View className="flex-1"><CustomInput label="Size (in)" value={state.size} onChangeText={(v) => onChange({...state, size: v})} placeholder="5 or 6" keyboardType="numeric" /></View>
          <View className="flex-1"><CustomInput label="Downspout Type" value={state.downspoutType} onChangeText={(v) => onChange({...state, downspoutType: v})} placeholder="2x3" /></View>
        </View>
      </View>
      
      <Text className="text-[10px] font-black uppercase mb-4 ml-2 opacity-50" style={{ color: colors.textSecondary }}>Linear Feet Measurements</Text>
      <View className="flex-row flex-wrap gap-2">
        {state.measurements.map((m: string, i: number) => (
          <View key={i} className="w-[31%] mb-2">
            <TextInput 
              keyboardType="numeric"
              placeholder={`S ${i+1}`}
              placeholderTextColor={colors.textSecondary}
              value={m}
              onChangeText={(v) => {
                const newM = [...state.measurements];
                newM[i] = v;
                onChange({...state, measurements: newM});
              }}
              className="h-12 border rounded-xl px-3 text-center font-black"
              style={{ 
                color: colors.text, 
                backgroundColor: isDark ? colors.surface : '#fff',
                borderColor: isDark ? colors.border : colors.grey[300]
              }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function LeafFilterSection({ state, onChange }: { state: any, onChange: (s: any) => void }) {
  const { colors, isDark } = useTheme();
  return (
    <View>
       <Text className="text-[10px] font-black uppercase mb-4 ml-1 opacity-50" style={{ color: colors.textSecondary }}>LeafFilter Protection</Text>
       {state.combinations.map((c: any, i: number) => (
         <View key={i} className="mb-6 p-5 rounded-3xl border shadow-sm" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : '#fff', borderColor: isDark ? colors.border : colors.grey[200] }}>
            <View className="flex-row justify-between items-center mb-4">
               <Text className="text-[10px] font-black tracking-widest" style={{ color: colors.primary.main }}>CONSTRUCTION ZONE #{c.id}</Text>
               <Text className="text-[9px] font-black opacity-30" style={{ color: colors.textSecondary }}>LF SERIES</Text>
            </View>
            <CustomInput label="Gutter Profile" value={c.gutterProfile} onChangeText={(v) => {
               const newC = [...state.combinations];
               newC[i] = { ...c, gutterProfile: v };
               onChange({...state, combinations: newC});
            }} />
            <CustomInput label="Color Match" value={c.lfColor} onChangeText={(v) => {
               const newC = [...state.combinations];
               newC[i] = { ...c, lfColor: v };
               onChange({...state, combinations: newC});
            }} />
         </View>
       ))}
    </View>
  );
}

function SoffitSection({ state, onChange }: { state: any, onChange: (s: any) => void }) {
  const { colors, isDark } = useTheme();
  return (
    <View>
      <View className="p-5 rounded-3xl border mb-6" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : '#fff', borderColor: isDark ? colors.border : colors.grey[200] }}>
        <Text className="text-[10px] font-black uppercase mb-4 opacity-50" style={{ color: colors.textSecondary }}>Vinyl Soffit</Text>
        <CustomInput label="Material Type" value={state.vinyl.type} onChangeText={(v) => onChange({...state, vinyl: {...state.vinyl, type: v}})} />
        <CustomInput label="Total Footage" value={state.vinyl.footage} onChangeText={(v) => onChange({...state, vinyl: {...state.vinyl, footage: v}})} keyboardType="numeric" />
        <CustomInput label="Color" value={state.vinyl.color} onChangeText={(v) => onChange({...state, vinyl: {...state.vinyl, color: v}})} />
      </View>
      <View className="p-5 rounded-3xl border" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : '#fff', borderColor: isDark ? colors.border : colors.grey[200] }}>
        <Text className="text-[10px] font-black uppercase mb-4 opacity-50" style={{ color: colors.textSecondary }}>Porch Soffit</Text>
        <CustomInput label="Type" value={state.porch.type} onChangeText={(v) => onChange({...state, porch: {...state.porch, type: v}})} />
        <CustomInput label="Footage" value={state.porch.footage} onChangeText={(v) => onChange({...state, porch: {...state.porch, footage: v}})} keyboardType="numeric" />
      </View>
    </View>
  );
}

function FasciaSection({ state, onChange }: { state: any, onChange: (s: any) => void }) {
  const { colors, isDark } = useTheme();
  return (
    <View>
      <View className="p-5 rounded-3xl border mb-6" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : '#fff', borderColor: isDark ? colors.border : colors.grey[200] }}>
        <Text className="text-[10px] font-black uppercase mb-4 opacity-50" style={{ color: colors.textSecondary }}>Fascia Wrap (Aluminum)</Text>
        <CustomInput label="Wrap Type" value={state.wrap.type} onChangeText={(v) => onChange({...state, wrap: {...state.wrap, type: v}})} />
        <View className="flex-row gap-3">
          <View className="flex-1"><CustomInput label="Size" value={state.wrap.size} onChangeText={(v) => onChange({...state, wrap: {...state.wrap, size: v}})} /></View>
          <View className="flex-1"><CustomInput label="Color" value={state.wrap.color} onChangeText={(v) => onChange({...state, wrap: {...state.wrap, color: v}})} /></View>
        </View>
      </View>
      <View className="p-5 rounded-3xl border" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : '#fff', borderColor: isDark ? colors.border : colors.grey[200] }}>
        <Text className="text-[10px] font-black uppercase mb-4 opacity-50" style={{ color: colors.textSecondary }}>Fascia Boards (Wood)</Text>
        <CustomInput label="Board Type" value={state.boards.type} onChangeText={(v) => onChange({...state, boards: {...state.boards, boardType: v}})} />
        <CustomInput label="Footage" value={state.boards.footage} onChangeText={(v) => onChange({...state, boards: {...state.boards, footage: v}})} keyboardType="numeric" />
      </View>
    </View>
  );
}

function AdditionalSection({ state, onChange }: { state: any, onChange: (s: any) => void }) {
  const { colors, isDark } = useTheme();
  return (
    <View>
       <View className="p-5 rounded-3xl border mb-6" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : '#fff', borderColor: isDark ? colors.border : colors.grey[200] }}>
          <Text className="text-[10px] font-black uppercase mb-4 opacity-50" style={{ color: colors.textSecondary }}>Labor & Misc</Text>
          <CustomInput label="Extra Labor Cost ($)" value={state.extraLabor.toString()} onChangeText={(v) => onChange({...state, extraLabor: parseFloat(v) || 0})} keyboardType="numeric" />
          <CustomInput label="Reason for Extra Labor" value={state.extraLaborReason} onChangeText={(v) => onChange({...state, extraLaborReason: v})} multiline placeholder="Explain why extra labor is needed..." />
       </View>
       <View className="p-5 rounded-3xl border" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : '#fff', borderColor: isDark ? colors.border : colors.grey[200] }}>
          <Text className="text-[10px] font-black uppercase mb-4 opacity-50" style={{ color: colors.textSecondary }}>Height Safety</Text>
          <View className="flex-row justify-between items-center">
             <Text className="font-bold text-[13px]" style={{ color: colors.text }}>40' Ladder Required?</Text>
             <TouchableOpacity 
                onPress={() => onChange({...state, fortyFootLadderNeeded: state.fortyFootLadderNeeded === 'Yes' ? 'No' : 'Yes'})}
                className="px-6 py-2.5 rounded-xl shadow-sm"
                style={{ backgroundColor: state.fortyFootLadderNeeded === 'Yes' ? colors.primary.main : (isDark ? colors.border : colors.grey[200]) }}
             >
                <Text className="font-black text-[10px] tracking-widest" style={{ color: state.fortyFootLadderNeeded === 'Yes' ? '#fff' : colors.textSecondary }}>{state.fortyFootLadderNeeded.toUpperCase()}</Text>
             </TouchableOpacity>
          </View>
       </View>
    </View>
  );
}

function SummarySection({ state }: { state: StepState }) {
  const { colors, isDark } = useTheme();
  return (
    <View>
       <View className="p-6 rounded-[32px] border shadow-sm mb-6" style={{ backgroundColor: isDark ? colors.surface : '#fff', borderColor: isDark ? colors.border : colors.grey[200] }}>
          <Text className="text-lg font-black mb-6" style={{ color: colors.text }}>Project Summary</Text>
          
          <SummaryGroup title="GUTTER" data={[
            { label: 'Color', value: state.gutter.color || 'None' },
            { label: 'Size', value: `${state.gutter.size}"` },
            { label: 'Downspout', value: state.gutter.downspoutType || 'None' }
          ]} />

          <SummaryGroup title="PROTECTION" data={[
            { label: 'LeafFilter', value: `${state.leaffilter.combinations.length} Units` },
            { label: 'LF Color', value: state.leaffilter.combinations[0]?.lfColor || 'None' }
          ]} />

          <SummaryGroup title="FINANCIALS" data={[
            { label: 'Extra Labor', value: `$${state.additional.extraLabor}` }
          ]} />

          <View className="mt-4 p-4 rounded-2xl" style={{ backgroundColor: isDark ? 'rgba(255,171,0,0.1)' : `${colors.warning.main}15` }}>
             <Text className="text-[10px] font-black uppercase mb-1 tracking-widest" style={{ color: colors.warning.main }}>Verification Notice</Text>
             <Text className="text-[11px] leading-4 opacity-80" style={{ color: colors.warning.dark }}>Please verify all measurements and colors before completing. This will be used for the final contract.</Text>
          </View>
       </View>
    </View>
  );
}

function SummaryGroup({ title, data }: { title: string, data: any[] }) {
  const { colors } = useTheme();
  return (
    <View className="mb-6">
       <Text className="text-[10px] font-black tracking-[2px] mb-4 opacity-40 uppercase" style={{ color: colors.primary.main }}>{title} System</Text>
       {data.map((item, idx) => (
         <View key={idx} className="flex-row justify-between mb-2.5">
            <Text className="text-[13px] font-bold opacity-60" style={{ color: colors.textSecondary }}>{item.label}</Text>
            <Text className="text-[13px] font-black" style={{ color: colors.text }}>{item.value}</Text>
         </View>
       ))}
    </View>
  );
}
