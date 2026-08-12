import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal } from 'react-native';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { LeadService } from '../../../services/api/leads';
import { ModalContainer, ModalHeader } from '../LeadCenter/SharedElements';
import {
  JobChangeSummary,
  SummaryRow,
  buildJobChangeSummary,
} from '../../../utils/job-change-summary';

/**
 * The proposed / declined addendum's before-and-after (spec §4.2).
 *
 * Reads `GET /lead/v1/job-builder-draft/{draftId}/public` — the SAME payload the
 * customer's own consent page renders, which is the point: staff see exactly the
 * before/after the customer was asked to sign. The endpoint needs no auth.
 *
 * ⚠️ All of the diffing lives in `utils/job-change-summary.ts`, not here — the
 * four formatting rules there exist because the two sides of a draft are written
 * by different screens and a naive comparison reports unchanged values as
 * changes.
 */

interface Props {
  visible: boolean;
  draftId: string | null;
  onClose: () => void;
  /** Approved ⇒ PDF, always. Handed back up so one PDF fetch guard serves both entry points. */
  onOpenPdf: (draftId: string) => void;
  pdfLoading?: boolean;
}

function DiffRow({ row, colors }: { row: SummaryRow; colors: any }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingVertical: 7,
        gap: 12,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textSecondary, flex: 1 }}>
        {row.label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexShrink: 1,
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          gap: 5,
          maxWidth: '58%',
        }}
      >
        <Text style={{ fontSize: 12, color: '#DC2626', textDecorationLine: 'line-through' }}>
          {row.from}
        </Text>
        <Text style={{ fontSize: 12, color: '#94A3B8' }}>⟶</Text>
        <Text style={{ fontSize: 12, color: '#15803D', fontWeight: '800' }}>{row.to}</Text>
      </View>
    </View>
  );
}

export const JobChangeDetailsModal = ({ visible, draftId, onClose, onOpenPdf, pdfLoading }: Props) => {
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<JobChangeSummary | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await LeadService.getDraftSummary(id);
      const body = res?.data;
      const data = body?.data || body || null;
      if (!data) throw new Error('Empty response');
      setSummary(buildJobChangeSummary(data));
    } catch (err: any) {
      // 404 means the draft was hard-deleted — show a state, don't crash the card.
      const status = err?.response?.status;
      setError(
        status === 404
          ? 'This addendum is no longer available.'
          : 'Couldn’t load these job changes. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible && draftId) load(draftId);
    if (!visible) {
      setSummary(null);
      setError(null);
    }
  }, [visible, draftId, load]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <ModalContainer>
        <ModalHeader title="Job Changes" subtitle="Proposed to the customer" onClose={onClose} />

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color="#16A34A" />
            <Text style={{ marginTop: 12, fontSize: 12, fontWeight: '700', color: colors.textSecondary }}>
              Loading job changes…
            </Text>
          </View>
        ) : error ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <MCIcon name="alert-circle-outline" size={40} color="#F59E0B" />
            <Text
              style={{
                marginTop: 12,
                fontSize: 13,
                fontWeight: '700',
                color: colors.text,
                textAlign: 'center',
              }}
            >
              {error}
            </Text>
            {!!draftId && (
              <TouchableOpacity
                onPress={() => load(draftId)}
                style={{
                  marginTop: 16,
                  paddingHorizontal: 20,
                  paddingVertical: 9,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: '#16A34A',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: '#16A34A' }}>Try Again</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : summary?.isAccepted ? (
          // The customer signed after the card was posted. Approved ⇒ PDF, always —
          // the signed document is the record, so the change rows are suppressed.
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: '#16A34A',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MCIcon name="check-bold" size={30} color="#FFFFFF" />
            </View>
            <Text
              style={{ marginTop: 14, fontSize: 15, fontWeight: '900', color: colors.text, textAlign: 'center' }}
            >
              Customer approved these changes
            </Text>
            <Text
              style={{
                marginTop: 6,
                fontSize: 12,
                fontWeight: '600',
                color: colors.textSecondary,
                textAlign: 'center',
              }}
            >
              The signed addendum is the record of what was agreed.
            </Text>
            <TouchableOpacity
              onPress={() => draftId && onOpenPdf(draftId)}
              disabled={!!pdfLoading}
              style={{
                marginTop: 20,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 22,
                paddingVertical: 12,
                borderRadius: 999,
                backgroundColor: '#16A34A',
                opacity: pdfLoading ? 0.6 : 1,
              }}
            >
              {pdfLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <MCIcon name="file-pdf-box" size={18} color="#FFFFFF" />
              )}
              <Text style={{ fontSize: 13, fontWeight: '800', color: '#FFFFFF' }}>
                Open signed addendum PDF
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            {summary?.isDeclined && (
              <View
                style={{
                  backgroundColor: isDark ? '#7F1D1D' : '#FEE2E2',
                  borderRadius: 10,
                  padding: 10,
                  marginBottom: 14,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: isDark ? '#FECACA' : '#B91C1C' }}>
                  The customer declined these changes.
                </Text>
              </View>
            )}

            {summary?.hasChanges ? (
              summary.groups.map((group) => (
                <View
                  key={group.key}
                  style={{
                    backgroundColor: colors.card,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: isDark ? colors.border : '#E2E8F0',
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    marginBottom: 12,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '900',
                      color: colors.textSecondary,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      marginBottom: 4,
                    }}
                  >
                    {group.title}
                  </Text>
                  {group.rows.map((row) => (
                    <DiffRow key={row.key} row={row} colors={colors} />
                  ))}
                </View>
              ))
            ) : (
              <Text
                style={{
                  textAlign: 'center',
                  color: colors.textSecondary,
                  fontSize: 13,
                  fontWeight: '600',
                  paddingVertical: 40,
                }}
              >
                No changes detected
              </Text>
            )}
          </ScrollView>
        )}
      </ModalContainer>
    </Modal>
  );
};
