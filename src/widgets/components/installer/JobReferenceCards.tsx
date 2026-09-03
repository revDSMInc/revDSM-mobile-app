import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../i18n/LanguageProvider';
import { productColor } from '../../../constants/installer';
import { formatCurrency } from '../../../utils/currency';
import { ProductScopeCard } from './ProductScopeCard';
import type { ContractDetails, JobPacket, SoldProduct } from '../../../config/types/installer';

// Same output as the old `toLocaleString('en-US')` call, minus the dependency on the
// engine shipping Intl data — see `utils/currency`.
const currency = (n?: number) => formatCurrency(n);

interface Props {
  packet?: JobPacket;
  contract?: ContractDetails;
  products?: SoldProduct[];
  onViewPacket?: () => void;
  /** True while the packet's signed URL is being fetched. */
  packetLoading?: boolean;
}

/**
 * Read-only job reference: packet, contract and sold products.
 *
 * Installers get visibility, not edit rights — scope changes go through the
 * discrepancy flow in Verify Job Scope, so nothing here is interactive beyond
 * opening the packet.
 */
export function JobReferenceCards({
  packet,
  contract,
  products = [],
  onViewPacket,
  packetLoading,
}: Props) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const surface = isDark ? colors.surface : '#F4F6F8';

  // `id` is the stable React key — the label changes with the language, so keying on it
  // would remount every row on a switch.
  const contractRows = [
    { id: 'contract', k: t('installer.contract'), v: currency(contract?.contractPrice) },
    {
      id: 'down',
      k: t('installer.downPayment'),
      v: currency(contract?.downPayment),
      sub: contract?.downPaymentMethod,
    },
    {
      id: 'balance',
      k: t('installer.remainingBalance'),
      v: currency(contract?.remainingBalance),
      sub: contract?.balanceMethod,
    },
    { id: 'loan', k: t('installer.loanAuth'), v: contract?.loanAuth || 'N/A', accent: true },
  ];

  return (
    <>
      {/* Packet */}
      {!!packet && (
        <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: surface }}>
          <Text className="text-base font-black mb-2" style={{ color: colors.text }}>
            {t('installer.jobPacket')}
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
                className="text-sm font-bold"
                style={{ color: colors.text }}
              >
                {packet.fileName}
              </Text>
              {!!packet.pages && (
                <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
                  {t('installer.pages', { count: packet.pages })}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={onViewPacket}
              disabled={packetLoading}
              className="rounded-lg px-3.5 py-2 items-center justify-center"
              style={{ backgroundColor: colors.primary.main, minWidth: 58 }}
            >
              {packetLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white text-xs font-bold">{t('installer.view')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Contract */}
      {!!contract && (
        <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: surface }}>
          <Text className="text-base font-black mb-1.5" style={{ color: colors.text }}>
            {t('installer.contractDetails')}
          </Text>
          {contractRows.map((r, i) => (
            <View
              key={r.id}
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
            {t('installer.products')}
          </Text>
          {products.map((p, idx) => (
            <ProductScopeCard
              key={p.id}
              product={p}
              accent={productColor(idx, p.color, p.name)}
            />
          ))}
        </View>
      )}
    </>
  );
}
