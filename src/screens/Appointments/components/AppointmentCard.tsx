import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { Appointment } from '../../../hooks/useAppointments';

interface AppointmentCardProps {
  appointment: Appointment;
  onEdit: () => void;
  onDelete: () => void;
}

// Port of web `CalculatorAppointmentCard.js`.
export const AppointmentCard: React.FC<AppointmentCardProps> = ({
  appointment,
  onEdit,
  onDelete,
}) => {
  const { colors, isDark } = useTheme();

  const title = appointment?.title || 'N/A';
  const displayName = title !== 'N/A' ? title.slice(0, 1).toUpperCase() + title.slice(1) : 'N/A';
  const calculatorsCount = appointment?.calculatorsCount || 0;

  const lastEdited = appointment?.lastUpdate || appointment?.createdAt;
  const lastEditedLabel = lastEdited
    ? new Date(lastEdited).toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    : 'N/A';

  const cardBg = isDark ? colors.card : '#FFFFFF';
  const borderColor = isDark ? colors.border : '#E2E8F0';
  const labelColor = isDark ? colors.textSecondary : '#637381';
  const valueColor = isDark ? '#FFFFFF' : '#1C252E';

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
      {/* Header: calculators chip + actions */}
      <View style={styles.headerRow}>
        <View style={[styles.chip, { backgroundColor: colors.primary.main }]}>
          <Text style={styles.chipText}>{calculatorsCount} Calculators</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            onPress={onDelete}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.iconBtn}
          >
            <Icon name="delete" size={20} color="#FF5630" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onEdit}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.iconBtn}
          >
            <Icon name="pencil" size={20} color={colors.primary.main} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Name + Lead Id */}
      <View style={styles.detailRow}>
        <View style={styles.detailCol}>
          <Text style={[styles.detailLabel, { color: labelColor }]}>Name</Text>
          <Text style={[styles.detailValue, { color: valueColor }]} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
        <View style={styles.detailCol}>
          <Text style={[styles.detailLabel, { color: labelColor }]}>Lead Id</Text>
          <Text style={[styles.detailValue, { color: valueColor }]} numberOfLines={1}>
            {appointment?.leadId || 'N/A'}
          </Text>
        </View>
      </View>

      {/* Address */}
      {!!appointment?.address && (
        <View style={{ marginTop: 12 }}>
          <Text style={[styles.detailLabel, { color: labelColor }]}>Address</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
            <Icon name="map-marker-outline" size={14} color={labelColor} style={{ marginTop: 2 }} />
            <Text style={[styles.detailValue, { color: valueColor, flex: 1 }]} numberOfLines={2}>
              {appointment.address}
            </Text>
          </View>
        </View>
      )}

      {/* Last Edited */}
      <View style={{ marginTop: 12 }}>
        <Text style={[styles.detailLabel, { color: labelColor }]}>Last Edited</Text>
        <Text style={[styles.detailValue, { color: valueColor }]}>{lastEditedLabel}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  chipText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  actions: { flexDirection: 'row', gap: 8 },
  iconBtn: { padding: 4 },
  detailRow: { flexDirection: 'row', gap: 12 },
  detailCol: { flex: 1 },
  detailLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  detailValue: { fontSize: 14, fontWeight: '700' },
});
