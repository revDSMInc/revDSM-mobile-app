import React from 'react';
import { View, Text, Modal, StyleSheet, Pressable, ScrollView, TouchableOpacity } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {
  DealPlan,
  PayCategory,
  calcMonthly,
  planBelowMin,
  belowMinMsg,
} from '../DynamicDealCenter/hooks/useDealPricing';
import { FlashMessage } from '../../config/message';

const fmt = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;

interface Props {
  visible: boolean;
  price: number;
  plans: Record<string, DealPlan>;
  categories: PayCategory[];
  added: string[];
  onAdd: (key: string) => void;
  onClose: () => void;
  inline?: boolean;
}

export function AddPlanModal({ visible, price, plans, categories, added, onAdd, onClose, inline }: Props) {
  const body = (
    <>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', paddingHorizontal: 24 }} onPress={onClose}>
        <Pressable style={{ backgroundColor: '#fff', borderRadius: 24, overflow: 'hidden', maxHeight: '72%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', backgroundColor: '#F0FDF4' }}>
            <Text style={{ fontSize: 14, fontWeight: '900', color: '#15803D' }}>Add Monthly Plan</Text>
            <TouchableOpacity onPress={onClose} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={16} color="#919EAB" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 14 }} showsVerticalScrollIndicator={false}>
            {categories.length === 0 ? (
              <Text style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', paddingVertical: 24 }}>No financing plans available.</Text>
            ) : (
              categories.map((cat) => (
                <View key={cat.title || 'basic'} style={{ marginBottom: cat.title ? 12 : 6 }}>
                  {!!cat.title && (
                    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginBottom: 8, alignSelf: 'flex-start', backgroundColor: cat.bg }}>
                      <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase', color: cat.text }}>{cat.title}</Text>
                    </View>
                  )}
                  {cat.plans.map((key) => {
                    const plan = plans[key];
                    if (!plan || plan.type !== 'financing') return null;
                    const belowMin = planBelowMin(plans, key, price);
                    const isAdded = added.includes(key);
                    const monthly = calcMonthly(plans, price, key);
                    return (
                      <TouchableOpacity
                        key={key}
                        disabled={isAdded}
                        onPress={() => {
                          if (belowMin) { FlashMessage.warning('Payment plan', belowMinMsg(plans, key, price)); return; }
                          onAdd(key);
                        }}
                        style={{ padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8, borderColor: isAdded ? '#31D076' : '#F1F5F9', backgroundColor: isAdded ? '#F0FDF4' : belowMin ? '#F1F5F9' : '#fff', opacity: belowMin ? 0.6 : 1 }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={{ flex: 1, paddingRight: 8, fontSize: 11, fontWeight: '800', color: isAdded ? '#15803D' : '#0F172A' }}>{plan.label}</Text>
                          {isAdded ? (
                            <Ionicons name="checkmark-circle" size={18} color="#31D076" />
                          ) : monthly > 0 ? (
                            <Text style={{ fontSize: 13, fontWeight: '900', color: '#60A5FA' }}>{fmt(monthly)}/mo</Text>
                          ) : null}
                        </View>
                        {plan.minPrice && belowMin ? (
                          <Text style={{ fontSize: 9, fontWeight: '700', color: '#94A3B8', marginTop: 2 }}>Requires ${plan.minPrice.toLocaleString()}+</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </>
  );
  if (inline) return visible ? <View style={StyleSheet.absoluteFill}>{body}</View> : null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>{body}</Modal>
  );
}
