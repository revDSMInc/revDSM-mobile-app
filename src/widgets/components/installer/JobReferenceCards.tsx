import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { productColor } from '../../../constants/installer';
import type { ContractDetails, JobPacket, SoldProduct } from '../../../config/types/installer';

const currency = (n?: number) =>
  typeof n === 'number' ? `$${n.toLocaleString('en-US')}` : 'N/A';

interface Props {
  packet?: JobPacket;
  contract?: ContractDetails;
  products?: SoldProduct[];
  onViewPacket?: () => void;
}

/**
 * Read-only job reference: packet, contract and sold products.
 *
 * Installers get visibility, not edit rights — scope changes go through the
 * discrepancy flow in Verify Job Scope, so nothing here is interactive beyond
 * opening the packet.
 */
export function JobReferenceCards({ packet, contract, products = [], onViewPacket }: Props) {
  const { colors, isDark } = useTheme();
  const surface = isDark ? colors.surface : '#F4F6F8';

  const contractRows = [
    { k: 'CONTRACT', v: currency(contract?.contractPrice) },
    { k: 'DOWN PAYMENT', v: currency(contract?.downPayment), sub: contract?.downPaymentMethod },
    {
      k: 'REMAINING BALANCE',
      v: currency(contract?.remainingBalance),
      sub: contract?.balanceMethod,
    },
    { k: 'LOAN AUTH', v: contract?.loanAuth || 'N/A', accent: true },
  ];

  return (
    <>
      {/* Packet */}
      {!!packet && (
        <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: surface }}>
          <Text className="text-base font-black mb-2" style={{ color: colors.text }}>
            Job Packet
          </Text>
          <View
            className="flex-row items-center rounded-xl p-2.5 border"
            style={{ backgroundColor: colors.background, borderColor: colors.border }}
          >
            <View
              className="items-center justify-center rounded-md mr-2.5"
              style={{ width: 34, height: 40, backgroundColor: colors.error.main }}
            >
              <Text className="text-white text-[10px] font-black">PDF</Text>
            </View>
            <View className="flex-1">
              <Text
                numberOfLines={1}
                className="text-[13px] font-bold"
                style={{ color: colors.text }}
              >
                {packet.fileName}
              </Text>
              {!!packet.pages && (
                <Text className="text-[11px] font-semibold" style={{ color: colors.textSecondary }}>
                  {packet.pages} pages
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={onViewPacket}
              className="rounded-lg px-3.5 py-2"
              style={{ backgroundColor: colors.primary.main }}
            >
              <Text className="text-white text-xs font-bold">View</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Contract */}
      {!!contract && (
        <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: surface }}>
          <Text className="text-base font-black mb-1.5" style={{ color: colors.text }}>
            Contract Details
          </Text>
          {contractRows.map((r, i) => (
            <View
              key={r.k}
              className="flex-row justify-between items-start py-2.5"
              style={{
                borderBottomWidth: i < contractRows.length - 1 ? 1 : 0,
                borderBottomColor: colors.border,
              }}
            >
              <Text
                className="text-xs font-bold tracking-wide"
                style={{ color: colors.textSecondary }}
              >
                {r.k}
              </Text>
              <View className="items-end">
                <Text
                  className="text-base font-black"
                  style={{ color: r.accent ? colors.primary.main : colors.text }}
                >
                  {r.v}
                </Text>
                {!!r.sub && (
                  <Text
                    className="text-[11px] font-bold tracking-wide"
                    style={{ color: colors.textSecondary }}
                  >
                    {r.sub}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Products */}
      {products.length > 0 && (
        <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: surface }}>
          <Text className="text-base font-black mb-2" style={{ color: colors.text }}>
            Products
          </Text>
          {products.map((p, idx) => {
            const accent = productColor(idx, p.color);
            return (
              <View
                key={p.id}
                className="rounded-xl p-2.5 mb-2 border"
                style={{ backgroundColor: accent + '10', borderColor: accent }}
              >
                <View className="flex-row items-center mb-1">
                  <Icon name="package-variant-closed" size={14} color={accent} />
                  <Text className="ml-1.5 text-sm font-bold" style={{ color: colors.text }}>
                    {p.name}
                  </Text>
                </View>
                {p.lines.map((line, lineIdx) => (
                  <View key={`${p.id}-${lineIdx}`} className="flex-row items-start mb-1">
                    <View
                      className="rounded-full mt-1.5 mr-2"
                      style={{ width: 6, height: 6, backgroundColor: accent }}
                    />
                    <Text
                      className="flex-1 text-xs font-semibold leading-5"
                      style={{ color: colors.text }}
                    >
                      {line}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      )}
    </>
  );
}
