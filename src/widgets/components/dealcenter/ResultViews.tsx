import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { ModalContainer, ModalHeader } from '../LeadCenter/SharedElements';
import { paymentPlans } from '../../../utils/calculator/payment-plans';

export const demoReasons = [
  "Can't Afford",
  "Didn't Like",
  'DIY',
  'Lowes Demo',
  'Lowes Pending Sale',
  'Lowes Rehash',
  'Moving',
  'No Job',
  'No Need / Want',
  'No Snap Decision',
  'Other Projects',
  'Rental Property',
  'Rushed - No Time',
  'Shop Around',
  'Talk to Spouse',
  'Think About It',
  'Too Much Money',
  'Would Not Commit',
  'Other (Explain)',
];

export const PaymentPlanPicker = ({ selected, onSelect, onClose }: any) => (
  <ModalContainer>
    <ModalHeader title="Select Payment Plan" onClose={onClose} />
    <ScrollView className="flex-1 px-4 py-4">
      {Object.entries(paymentPlans).map(([key, plan]: any) => (
        <TouchableOpacity
          key={key}
          onPress={() => onSelect(key)}
          className={`mb-4 p-5 rounded-3xl border-2 flex-row items-center justify-between ${
            selected === key
              ? 'bg-green-500/10 border-green-500'
              : 'bg-card border-border shadow-sm'
          }`}
        >
          <View className="flex-1 pr-4">
            <Text className="text-sm font-black text-text-primary mb-1">{plan.label}</Text>
            <Text className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              {plan.desc}
            </Text>
          </View>
          {selected === key && <Ionicons name="checkmark-circle" size={24} color="#4CBB17" />}
        </TouchableOpacity>
      ))}
    </ScrollView>
  </ModalContainer>
);

export const ResultView = ({ onBack, setShowTrackerModal }: any) => (
  <ScrollView className="flex-1 bg-background" showsVerticalScrollIndicator={false}>
    <View className="px-5 pt-12 pb-32 items-center">
      <View className="w-24 h-24 bg-green-500/10 rounded-full items-center justify-center mb-8 shadow-xl shadow-green-500/10">
        <Ionicons name="checkmark-done" size={48} color="#4CBB17" />
      </View>
      <Text className="text-2xl font-black text-text-primary mb-2">Deal Secured!</Text>
      <Text className="text-sm font-bold text-text-secondary uppercase tracking-[2px] mb-12 text-center">
        Outcome Recorded Successfully
      </Text>

      <View className="w-full bg-surface p-6 rounded-[40px] border border-border mb-12">
        <Text className="text-xs font-black text-text-secondary uppercase mb-4 text-center tracking-widest">
          Next Steps
        </Text>
        <View className="gap-4">
          <View className="flex-row items-center">
            <View className="w-8 h-8 rounded-full bg-card items-center justify-center mr-4">
              <Text className="text-[10px] font-black text-text-primary">1</Text>
            </View>
            <Text className="text-[11px] font-bold text-text-secondary">
              Syncing lead status with main office...
            </Text>
          </View>
          <View className="flex-row items-center">
            <View className="w-8 h-8 rounded-full bg-card items-center justify-center mr-4">
              <Text className="text-[10px] font-black text-text-primary">2</Text>
            </View>
            <Text className="text-[11px] font-bold text-text-secondary">
              Updating appointments & contracts...
            </Text>
          </View>
        </View>
      </View>

      <View className="flex-row gap-3 w-full">
        <TouchableOpacity
          onPress={onBack}
          className="flex-1 h-12 rounded-xl items-center justify-center border-2 border-[#4CBB17]"
        >
          <Text className="text-[12px] font-black uppercase text-[#4CBB17]">Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setShowTrackerModal(true)}
          className="flex-[2] h-12 bg-[#4CBB17] rounded-xl items-center justify-center shadow-lg shadow-green-600/30"
        >
          <Text className="text-white text-[12px] font-black uppercase">
            Add This Job into Job Tracker
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  </ScrollView>
);
