import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  Switch,
  Alert,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import { demoReasons } from '../../components/dealcenter/ResultViews';
import { paymentPlans } from '../../../utils/calculator/payment-plans';
import {
  getOutcomeDownPaymentMethods,
  getRolloutPaymentCategories,
  isPlanBelowMinPrice,
  getBelowMinMessage,
} from '../../../utils/calculator/lowes-payment-util';
import RNFlashMessage from 'react-native-flash-message';
import { useRef } from 'react';

interface OutcomeModalProps {
  visible: boolean;
  onClose: () => void;
  outcomeForm: any;
  setOutcomeForm: (val: any) => void;
  outcomeStatus: 'demo' | 'sale' | null;
  handleStatusSelect: (status: 'demo' | 'sale') => void;
  calculators: any[];
  activeIdx: number;
  setActiveIdx: (idx: number) => void;
  refreshCalculators: () => void;
  results: any;
  handleFinishOutcome: () => void;
  onReset?: () => void;
  onResetJobBuilder?: () => void;
  loading?: boolean;
  isJobBuilderSubmitted?: boolean;
  lead?: any;
}

const oneLegOptions = ['No', 'MR', 'MRS'];

export const OutcomeModal: React.FC<OutcomeModalProps> = ({
  visible,
  onClose,
  outcomeForm,
  setOutcomeForm,
  outcomeStatus,
  handleStatusSelect,
  calculators,
  activeIdx,
  setActiveIdx,
  refreshCalculators,
  results,
  handleFinishOutcome,
  onReset,
  onResetJobBuilder,
  loading,
  isJobBuilderSubmitted,
  lead,
}) => {
  const { colors } = useTheme();
  const isLowesLead = lead?.lowesLead === true;
  const contractPrice = Number(
    String(outcomeForm.originalContractPrice || '0').replace(/[^0-9.]/g, '')
  );
  const downPaymentMethods = getOutcomeDownPaymentMethods(isLowesLead);
  const [expanded, setExpanded] = useState<string | null>(null);
  const flashRef = useRef<any>(null);
  const scrollRef = useRef<ScrollView>(null);

  const toggleExpand = (key: string) => {
    const isExpanding = expanded !== key;
    setExpanded(isExpanding ? key : null);

    if (isExpanding) {
      // Small delay to allow the dropdown to render before scrolling
      setTimeout(() => {
        // This is a simple approximation. In a real app we'd use onLayout.
        // For now, we scroll based on common field positions.
        const scrollPositions: Record<string, number> = {
          oneLeg: 0,
          result: 60,
          reason: 120,
          dpMethod: 300,
          balMethod: 400,
          calc: 600,
        };
        if (scrollPositions[key] !== undefined) {
          scrollRef.current?.scrollTo({ y: scrollPositions[key], animated: true });
        }
      }, 100);
    }
  };

  const renderField = (
    label: string,
    value: string,
    onPress?: () => void,
    icon: string = 'chevron-down',
    isExpanded: boolean = false,
    textTransform?: 'capitalize' | 'none',
    zIndex: number = 0,
    disabled: boolean = false,
    isError: boolean = false
  ) => (
    <View className="mb-5 relative" style={{ zIndex }}>
      <View className="absolute -top-2 left-3 z-10 px-1 bg-white">
        <Text className={`text-[10px] font-semibold ${isError ? 'text-[#EF4444]' : 'text-black'}  tracking-[0.5px]`}>{label}</Text>
      </View>
      <TouchableOpacity
        className={`flex-row items-center border rounded-lg px-[14px] py-3 min-h-[48px] ${
          isError ? 'border-[#EF4444]' : isExpanded ? 'border-[#1C252E]' : 'border-[#919EAB33]'
        } ${disabled ? 'bg-[#F4F6F8]' : 'bg-white'}`}
        onPress={disabled ? undefined : onPress}
        activeOpacity={disabled ? 1 : 0.7}
      >
        <Text
          className={`flex-1 text-[13px] font-semibold p-0 ${
            disabled ? 'text-[#919EAB]' : value ? 'text-[#1C252E]' : 'text-[#919EAB]'
          } ${textTransform === 'capitalize' ? 'capitalize' : ''}`}
        >
          {value || `Select ${label}`}
        </Text>
        <Ionicons
          name={disabled ? 'lock-closed' : isExpanded ? 'chevron-up' : icon}
          size={18}
          color="#919EAB"
        />
      </TouchableOpacity>
    </View>
  );

  const renderInput = (
    label: string,
    value: string,
    key: string,
    editable: boolean = true,
    keyboardType: 'default' | 'numeric' = 'default',
    onChange?: (t: string) => void
  ) => (
    <View className="mb-5 relative">
      <View className="absolute -top-2 left-3 z-10 px-1 bg-white">
        <Text className="text-[10px] font-semibold text-black  tracking-[0.5px]">{label}</Text>
      </View>
      <View className="flex-row items-center border border-[#919EAB33] rounded-lg px-[14px] py-3 min-h-[48px] bg-white">
        <Text
          className={`text-[13px] font-bold mr-1 ${editable ? 'text-[#1C252E]' : 'text-[#919EAB]'}`}
        >
          $
        </Text>
        <TextInput
          value={value}
          editable={editable}
          keyboardType={keyboardType}
          onChangeText={onChange}
          className={`flex-1 text-[13px] font-semibold p-0 ${
            editable ? 'text-[#1C252E]' : 'text-[#919EAB]'
          }`}
        />
      </View>
    </View>
  );

  const renderTextField = (
    label: string,
    value: string,
    onChange: (t: string) => void,
    placeholder?: string,
    multiline: boolean = false
  ) => (
    <View className="mb-5 relative">
      <View className="absolute -top-2 left-3 z-10 px-1 bg-white">
        <Text className="text-[10px] font-semibold text-black  tracking-[0.5px]">{label}</Text>
      </View>
      <View
        className={`border border-[#919EAB33] rounded-lg px-[14px] py-3 bg-white ${
          multiline ? 'min-h-[80px]' : 'min-h-[48px]'
        }`}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          className="flex-1 text-[13px] font-semibold p-0 text-[#1C252E]"
        />
      </View>
    </View>
  );

  // Group results by category for tags
  const categories = Array.from(new Set((results?.items || []).map((item: any) => item.category)));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View className="flex-1 bg-black/50 justify-center px-4">
          <View className="bg-white rounded-2xl shadow-2xl max-h-[85%] overflow-hidden">
            {/* Header */}
            <View
              className="px-5 py-[18px] flex-row items-center justify-between"
              style={{ backgroundColor: colors.primary.main }}
            >
              <View className="flex-row items-center">
                <Text className="text-base font-semibold text-white">Result Lead</Text>
                {onReset && (
                  <TouchableOpacity
                    onPress={onReset}
                    className="flex-row items-center bg-white/15 px-2 py-1 rounded-md ml-3"
                  >
                    <Ionicons name="refresh" size={14} color="white" />
                    <Text className="text-white text-[10px] font-bold ml-1 ">Reset</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity onPress={onClose} className="p-1">
                <Ionicons name="close" size={20} color="white" />
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={scrollRef}
              className="px-5 pt-6"
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 100 }} // Space for dropdowns at bottom
            >
              <View>
                {/* One Leg Dropdown Overlay */}
                <View className="z-[100]">
                  {renderField(
                    'One Leg',
                    outcomeForm.oneLeg,
                    () => toggleExpand('oneLeg'),
                    'chevron-down',
                    expanded === 'oneLeg',
                    'none',
                    100
                  )}
                  {expanded === 'oneLeg' && (
                    <View className="border border-[#1C252E] rounded-lg bg-[#F8FAFC] shadow-sm mt-1 mb-4 overflow-hidden">
                      {oneLegOptions.map((opt) => (
                        <TouchableOpacity
                          key={opt}
                          className={`px-4 py-3 flex-row items-center justify-between border-b border-[#919EAB14] ${
                            outcomeForm.oneLeg === opt ? 'rounded-lg bg-[#F4F6F8]' : ''
                          }`}
                          onPress={() => {
                            setOutcomeForm({ ...outcomeForm, oneLeg: opt });
                            setExpanded(null);
                          }}
                        >
                          <Text
                            className={`text-[13px] font-semibold ${
                              outcomeForm.oneLeg === opt ? 'text-[#1C252E]' : 'text-[#637381]'
                            }`}
                          >
                            {opt}
                          </Text>
                          {outcomeForm.oneLeg === opt && (
                            <Ionicons name="checkmark" size={16} color="#1C252E" />
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                {/* Result Dropdown Overlay */}
                <View className="z-[90]">
                  {renderField(
                    'Result',
                    outcomeStatus || '',
                    () => toggleExpand('result'),
                    'chevron-down',
                    expanded === 'result',
                    'capitalize',
                    90
                  )}
                  {expanded === 'result' && (
                    <View className="border border-[#1C252E] rounded-lg bg-[#F8FAFC] shadow-sm mt-1 mb-4 overflow-hidden">
                      {['Demo', 'Sale'].map((opt) => (
                        <TouchableOpacity
                          key={opt}
                          className={`px-4 py-3 flex-row items-center justify-between border-b border-[#919EAB14] ${
                            outcomeStatus === opt.toLowerCase() ? 'rounded-lg bg-[#F4F6F8]' : ''
                          }`}
                          onPress={() => {
                            handleStatusSelect(opt.toLowerCase() as any);
                            setExpanded(null);
                          }}
                        >
                          <Text
                            className={`text-[13px] font-semibold ${
                              outcomeStatus === opt.toLowerCase()
                                ? 'text-[#1C252E]'
                                : 'text-[#637381]'
                            }`}
                          >
                            {opt}
                          </Text>
                          {outcomeStatus === opt.toLowerCase() && (
                            <Ionicons name="checkmark" size={16} color="#1C252E" />
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                {outcomeStatus === 'demo' && (
                  <>
                    <View className="z-[85]">
                      {renderField(
                        'Reason for Demo',
                        outcomeForm.reason,
                        () => toggleExpand('reason'),
                        'chevron-down',
                        expanded === 'reason',
                        'none',
                        85
                      )}
                      {expanded === 'reason' && (
                        <View className="border border-[#1C252E] rounded-lg bg-[#F8FAFC] shadow-sm mt-1 mb-4 overflow-hidden">
                          <View>
                            {demoReasons.map((opt) => (
                              <TouchableOpacity
                                key={opt}
                                className={`px-4 py-3 flex-row items-center justify-between border-b border-[#919EAB14] ${
                                  outcomeForm.reason === opt ? 'rounded-lg bg-[#F4F6F8]' : ''
                                }`}
                                onPress={() => {
                                  setOutcomeForm({ ...outcomeForm, reason: opt });
                                  setExpanded(null);
                                }}
                              >
                                <Text
                                  className={`text-[13px] font-semibold ${
                                    outcomeForm.reason === opt ? 'text-[#1C252E]' : 'text-[#637381]'
                                  }`}
                                >
                                  {opt}
                                </Text>
                                {outcomeForm.reason === opt && (
                                  <Ionicons name="checkmark" size={16} color="#1C252E" />
                                )}
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      )}
                    </View>

                    {outcomeForm.reason === 'Other (Explain)' &&
                      renderTextField(
                        'Explain Reason',
                        outcomeForm.reasonExplanation || '',
                        (t) => setOutcomeForm({ ...outcomeForm, reasonExplanation: t }),
                        'Enter details...',
                        true
                      )}

                    {renderInput(
                      'Last Price Quoted',
                      outcomeForm.lastPriceQuoted,
                      'lastPriceQuoted',
                      false
                    )}
                  </>
                )}

                {outcomeStatus === 'sale' && (
                  <>
                    {renderInput(
                      'Original Contract Price',
                      outcomeForm.originalContractPrice,
                      'originalContractPrice',
                      false
                    )}

                    <View className="flex-col z-[80] border border-[#919EAB33] rounded-lg px-3 pt-3 mb-3">
                      <View className="flex-1">
                        {renderInput(
                          'Down Payment',
                          outcomeForm.downPayment,
                          'downPayment',
                          true,
                          'numeric',
                          (t) => {
                            const dp = Number(t) || 0;
                            const cp = Number(outcomeForm.originalContractPrice) || 0;
                            setOutcomeForm({
                              ...outcomeForm,
                              downPayment: t,
                              balance: (cp - dp).toFixed(0),
                            });
                          }
                        )}
                      </View>
                      <View className="flex-1 z-[81]">
                        {renderField(
                          'Payment Method',
                          downPaymentMethods.find((m) => m.value === outcomeForm.downPaymentMethod)
                            ?.label || '',
                          () => toggleExpand('dpMethod'),
                          'chevron-down',
                          expanded === 'dpMethod',
                          'none',
                          81
                        )}
                        {expanded === 'dpMethod' && (
                          <View className="border border-[#1C252E] rounded-lg bg-[#F8FAFC] shadow-sm mt-1 mb-4 overflow-hidden">
                            {downPaymentMethods.map((m) => (
                              <TouchableOpacity
                                key={m.value}
                                className={`px-4 py-3 flex-row items-center justify-between border-b border-[#919EAB14] ${
                                  outcomeForm.downPaymentMethod === m.value
                                    ? 'rounded-lg bg-[#F4F6F8]'
                                    : ''
                                }`}
                                onPress={() => {
                                  setOutcomeForm({ ...outcomeForm, downPaymentMethod: m.value });
                                  setExpanded(null);
                                }}
                              >
                                <Text
                                  className={`text-[13px] font-semibold ${
                                    outcomeForm.downPaymentMethod === m.value
                                      ? 'text-[#1C252E]'
                                      : 'text-[#637381]'
                                  }`}
                                >
                                  {m.label}
                                </Text>
                                {outcomeForm.downPaymentMethod === m.value && (
                                  <Ionicons name="checkmark" size={16} color="#1C252E" />
                                )}
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                      </View>
                    </View>

                    <View className="flex-col z-[70] border border-[#919EAB33] rounded-lg px-3 pt-3 mb-3">
                      <View className="flex-1">
                        {renderInput('Balance', outcomeForm.balance, 'balance', false)}
                      </View>
                      <View className="flex-1 z-[71]">
                        {renderField(
                          'Payment Method',
                          paymentPlans[outcomeForm.balancePaymentMethod]?.label || '',
                          () => toggleExpand('balMethod'),
                          'chevron-down',
                          expanded === 'balMethod',
                          'none',
                          71
                        )}
                        {expanded === 'balMethod' && (
                          <View className="border border-[#1C252E] rounded-lg bg-[#F8FAFC] shadow-sm mt-1 mb-4 overflow-hidden">
                            {getRolloutPaymentCategories(isLowesLead).map((cat) => (
                              <View key={cat.title}>
                                <View className={`${cat.bg} px-4 py-1.5`}>
                                  <Text className="text-[11px] font-bold text-black uppercase">
                                    {cat.title}
                                  </Text>
                                </View>
                                {cat.plans.map((key) => {
                                  const plan = paymentPlans[key];
                                  if (!plan) return null;
                                  const belowMin = isPlanBelowMinPrice(key, contractPrice);
                                  return (
                                    <TouchableOpacity
                                      key={key}
                                      className={`px-4 py-3 flex-row items-center justify-between border-b border-[#919EAB14] ${
                                        outcomeForm.balancePaymentMethod === key
                                          ? 'rounded-lg bg-[#F4F6F8]'
                                          : belowMin
                                          ? 'opacity-50'
                                          : ''
                                      }`}
                                      onPress={() => {
                                        if (belowMin) {
                                          Alert.alert(
                                            'Payment plan',
                                            getBelowMinMessage(key, contractPrice)
                                          );
                                          return;
                                        }
                                        setOutcomeForm({
                                          ...outcomeForm,
                                          balancePaymentMethod: key,
                                        });
                                        setExpanded(null);
                                      }}
                                    >
                                      <View className="flex-1">
                                        <Text
                                          className={`text-[13px] font-semibold ${
                                            outcomeForm.balancePaymentMethod === key
                                              ? 'text-[#1C252E]'
                                              : 'text-[#637381]'
                                          }`}
                                        >
                                          {plan.label}
                                        </Text>
                                        {belowMin && (
                                          <Text className="text-[10px] text-red-500">
                                            Requires ${plan.minPrice?.toLocaleString()}+
                                          </Text>
                                        )}
                                      </View>
                                      {outcomeForm.balancePaymentMethod === key && (
                                        <Ionicons name="checkmark" size={16} color="#1C252E" />
                                      )}
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    </View>
 

                  </>
                )}

                {/* Calculator Dropdown Overlay */}
                <View className="z-[60]">
                  <View className="flex-row justify-between items-center mb-2.5 mt-1">
                    <Text className="text-[10px] font-extrabold text-[#1C252E]  tracking-[0.5px]">
                      Associated LF Calculator
                    </Text>
                    <TouchableOpacity
                      onPress={refreshCalculators}
                      className="flex-row items-center"
                    >
                      <Ionicons name="refresh" size={13} color="#637381" />
                      <Text className="text-[9px] font-bold text-[#637381] ml-1 ">Refresh</Text>
                    </TouchableOpacity>
                  </View>
                  {renderField(
                    'Calculator',
                    calculators[activeIdx]?.name || '',
                    () => toggleExpand('calc'),
                    'chevron-down',
                    expanded === 'calc',
                    'none',
                    60,
                    !!outcomeStatus
                  )}
                  {expanded === 'calc' && (
                    <View className="border border-[#1C252E] rounded-lg bg-[#F8FAFC] shadow-sm mt-1 mb-4 overflow-hidden">
                      <View>
                        {calculators.map((c, i) => (
                          <TouchableOpacity
                            key={c._id || i}
                            className={`px-4 py-3 flex-row items-center justify-between border-b border-[#919EAB14] ${
                              activeIdx === i ? 'rounded-lg bg-[#F4F6F8]' : ''
                            }`}
                            onPress={() => {
                              setActiveIdx(i);
                              setExpanded(null);
                            }}
                          >
                            <Text
                              className={`text-[13px] font-semibold ${
                                activeIdx === i ? 'text-[#1C252E]' : 'text-[#637381]'
                              }`}
                            >
                              {c.name}
                            </Text>
                            {activeIdx === i && (
                              <Ionicons name="checkmark" size={16} color="#1C252E" />
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </View>

                {/* Modern Job Summary Section */}
                <View className="bg-[#F7F6FD] rounded-2xl p-4 mt-2 border border-[#E8E6F8]">
                  {/* Summary Header */}
                  <View className="flex-row justify-between items-center mb-4">
                    <View className="flex-row items-center">
                      <View className="w-7 h-7 rounded-lg bg-[#F0EFFF] items-center justify-center mr-2.5">
                        <Ionicons name="clipboard" size={16} color={colors.primary.main} />
                      </View>
                      <Text className="text-sm font-bold text-[#1C252E]">Job Summary</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View className="bg-[#E5D9FF] px-3 py-1.5 rounded-lg">
                        <Text className="text-[12px] font-extrabold text-[#6B46C1]">
                          {(results?.items || []).length} Item
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Categories Tags */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
                    {categories.map((cat: any) => {
                      const catConfig: Record<string, { icon: string; color: string; bg: string }> = {
                        Gutters:             { icon: 'home',                    color: '#3182CE', bg: '#EBF8FF' },
                        LeafFilter:          { icon: 'leaf',                    color: '#38A169', bg: '#E6FFFA' },
                        Soffit:              { icon: 'construct',               color: '#00B8D9', bg: '#E0F8FB' },
                        Fascia:              { icon: 'layers',                  color: '#8E33FF', bg: '#F2E8FF' },
                        Lighting:            { icon: 'bulb',                    color: '#FFAB00', bg: '#FFF8E6' },
                        'Additional Services': { icon: 'add-circle',           color: '#FFAB00', bg: '#FFF8E6' },
                        Miscellaneous:       { icon: 'ellipsis-horizontal-circle', color: '#637381', bg: '#F4F6F8' },
                      };
                      const cfg = catConfig[cat] || { icon: 'list', color: '#637381', bg: '#F4F6F8' };
                      return (
                        <View
                          key={cat}
                          className="flex-row items-center px-3 py-1.5 rounded-lg mr-2"
                          style={{ backgroundColor: cfg.bg }}
                        >
                          <Ionicons
                            name={cfg.icon}
                            size={12}
                            color={cfg.color}
                            style={{ marginRight: 6 }}
                          />
                          <Text
                            className="text-[12px] font-bold"
                            style={{ color: cfg.color }}
                          >
                            {cat}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>

                  {/* Items List */}
                  <View className="gap-2">
                    {(results?.items || [])
                      .filter((item: any) => {
                        if (outcomeStatus === 'demo') {
                          return item.category !== 'Agreement' && !item.label?.toLowerCase().includes('agreement');
                        }
                        return true;
                      })
                      .map((item: any, idx: number) => {
                        const itemCatConfig: Record<string, { icon: string; iconColor: string; bg: string }> = {
                          Gutters:             { icon: 'home',                    iconColor: '#00B8D9', bg: '#E1F5FE' },
                          LeafFilter:          { icon: 'leaf',                    iconColor: '#22C55E', bg: '#E8F5E9' },
                          Soffit:              { icon: 'construct',               iconColor: '#00B8D9', bg: '#E1F5FE' },
                          Fascia:              { icon: 'layers',                  iconColor: '#8E33FF', bg: '#F2E8FF' },
                          Lighting:            { icon: 'bulb',                    iconColor: '#FFAB00', bg: '#FFF8E6' },
                          'Additional Services': { icon: 'add-circle',           iconColor: '#FFAB00', bg: '#FFF8E6' },
                          Miscellaneous:       { icon: 'ellipsis-horizontal-circle', iconColor: '#637381', bg: '#F4F6F8' },
                        };
                        const cfg = itemCatConfig[item.category] || { icon: 'list', iconColor: '#637381', bg: '#F4F6F8' };
                        return (
                          <View key={idx} className="bg-white rounded-lg p-3 flex-row items-center">
                            <View
                              className="w-7 h-7 rounded-full items-center justify-center mr-3"
                              style={{ backgroundColor: cfg.bg }}
                            >
                              <Ionicons
                                name={cfg.icon}
                                size={14}
                                color={cfg.iconColor}
                              />
                            </View>
                            <Text
                              className="text-[13px] font-bold text-[#1C252E] flex-1"
                              numberOfLines={1}
                            >
                              {item.value}' {item.label}
                            </Text>
                          </View>
                        );
                      })}
                  </View>
                </View>

                <View className="flex-row gap-3 mt-6">
                  <TouchableOpacity
                    onPress={() =>
                      setOutcomeForm({ ...outcomeForm, versatile: !outcomeForm.versatile })
                    }
                    className="flex-1 h-11 rounded-lg items-center justify-center"
                    style={{
                      backgroundColor: '#FFAB00',
                    }}
                  >
                    <Text className="font-bold text-[11px] " style={{ color: '#212B36' }}>
                      Versatile
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() =>
                      setOutcomeForm({ ...outcomeForm, pineapple: !outcomeForm.pineapple })
                    }
                    className="flex-1 h-11 rounded-lg items-center justify-center"
                    style={{
                      backgroundColor: '#FFAB00',
                    }}
                  >
                    <Text className="font-bold text-[11px] " style={{ color: '#212B36' }}>
                      Pineapple
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>

            {/* Fixed Bottom Button */}
            <View className="px-5 pb-5 pt-2 border-t border-[#919EAB14]">
              <TouchableOpacity
                onPress={handleFinishOutcome}
                disabled={
                  !outcomeStatus || 
                  (outcomeStatus === 'demo' && (!outcomeForm.reason || (outcomeForm.reason === 'Other (Explain)' && !outcomeForm.reasonExplanation?.trim())))
                }
                className="h-12 rounded-xl items-center justify-center"
                style={{
                  backgroundColor: !outcomeStatus || 
                    (outcomeStatus === 'demo' && (!outcomeForm.reason || (outcomeForm.reason === 'Other (Explain)' && !outcomeForm.reasonExplanation?.trim())))
                    ? '#919EAB' 
                    : colors.primary.main,
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-white font-bold text-sm tracking-[0.5px]">
                    {outcomeStatus === 'sale' ? (isJobBuilderSubmitted ? 'Build Job' : 'Build Job') : 'Build Job'}
                  </Text>
                )}
              </TouchableOpacity>

              {outcomeStatus === 'sale' && isJobBuilderSubmitted && (
                <TouchableOpacity
                  onPress={onResetJobBuilder}
                  className="h-12 mt-3 rounded-xl items-center justify-center border border-[#EF4444]"
                >
                  <Text className="text-[#EF4444] font-bold text-sm tracking-[0.5px]">
                    Reset Job Builder
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <RNFlashMessage ref={flashRef} position="top" canRegisterAsDefault={false} />
          </View>

          {loading && (
            <View
              className="absolute inset-0 bg-white/95 items-center justify-center z-[2000]"
              style={{ elevation: 20 }}
            >
              <ActivityIndicator size="large" color="#00B8D9" />
              <View className="items-center mt-6">
                <Text className="text-[#1C252E] font-black text-xl  tracking-tighter">
                  Preparing Job Builder
                </Text>
                <View className="flex-row items-center mt-2 bg-blue-50 px-3 py-1 rounded-full">
                  <ActivityIndicator
                    size="small"
                    color="#00B8D9"
                    style={{ transform: [{ scale: 0.8 }] }}
                  />
                  <Text className="text-[#00B8D9] text-[10px] font-black  ml-2 tracking-widest">
                    Optimizing Allocation
                  </Text>
                </View>
              </View>
              {/* ... (loading text) */}
            </View>
          )}


        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export const LoadingOverlay = ({
  visible,
  message = 'Preparing Job Builder...',
}: {
  visible: boolean;
  message?: string;
}) => (
  <Modal transparent visible={visible} animationType="fade">
    <View className="flex-1 bg-black/60 items-center justify-center">
      <View className="bg-white p-8 rounded-[32px] items-center shadow-2xl">
        <ActivityIndicator size="large" color="#00B8D9" />
        <Text className="mt-4 text-[#1C252E] font-bold text-base">{message}</Text>
        <Text className="mt-1 text-[#919EAB] text-xs font-medium">Almost there</Text>
      </View>
    </View>
  </Modal>
);
