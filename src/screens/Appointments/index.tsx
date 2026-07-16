import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuth } from '../../hooks/useAuth';
import { useAppointments, Appointment } from '../../hooks/useAppointments';
import { FlashMessage } from '../../config/message';
import { logEvent } from '../../services/api/LoggerService';
import { AppointmentCard } from './components/AppointmentCard';
import { AddAppointmentModal } from './components/AddAppointmentModal';

export default function AppointmentsPage() {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<any>();

  const {
    appointments,
    isLoading,
    isFetching,
    refetch,
    createAppointment,
    updateAppointment,
    deleteAppointment,
    isCreating,
    isUpdating,
  } = useAppointments();

  const [modalVisible, setModalVisible] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [selected, setSelected] = useState<Appointment | null>(null);

  const userId = user?._id || user?.id;

  useEffect(() => {
    if (appointments.length > 0 && userId) {
      logEvent('view', {
        user_id: userId,
        created_by: userId,
        module_type: 'appointment',
        meta: { totalAppointments: appointments.length },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments.length]);

  const openAdd = () => {
    setIsEdit(false);
    setSelected(null);
    setModalVisible(true);
  };

  const openEdit = (appointment: Appointment) => {
    setIsEdit(true);
    setSelected(appointment);
    setModalVisible(true);
  };

  const handleSubmit = useCallback(
    async (data: { title: string; address: string; leadId?: string }) => {
      try {
        if (isEdit && selected) {
          const id = (selected.id || selected._id) as string;
          const res = await updateAppointment({ id, payload: data });
          logEvent('update', {
            user_id: userId,
            created_by: userId,
            module_type: 'appointment',
            meta: {
              appointmentId: id,
              appointmentName: data.title,
              appointmentAddress: data.address,
              appointmentLeadId: data.leadId,
              action: 'appointment_updated',
            },
          });
          FlashMessage.success(
            'Appointment Updated',
            res?.data?.message || 'Changes saved successfully'
          );
        } else {
          const res = await createAppointment(data);
          logEvent('create', {
            user_id: userId,
            created_by: userId,
            module_type: 'appointment',
            meta: {
              appointmentName: data.title,
              appointmentAddress: data.address,
              appointmentLeadId: data.leadId,
              action: 'appointment_created',
            },
          });
          FlashMessage.success(
            'Appointment Created',
            res?.data?.message || 'Appointment added successfully'
          );
        }
        setModalVisible(false);
        setSelected(null);
        setIsEdit(false);
      } catch (err: any) {
        FlashMessage.error(
          'Error',
          err?.response?.data?.message || err?.message || 'Something went wrong'
        );
      }
    },
    [isEdit, selected, updateAppointment, createAppointment, userId]
  );

  const handleDelete = (appointment: Appointment) => {
    Alert.alert(
      'Delete Appointment',
      'Are you sure you want to delete this appointment?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const id = (appointment.id || appointment._id) as string;
            try {
              const res = await deleteAppointment(id);
              logEvent('delete', {
                user_id: userId,
                created_by: userId,
                module_type: 'appointment',
                meta: {
                  appointmentId: id,
                  appointmentName: appointment.title,
                  appointmentLeadId: appointment.leadId,
                  appointmentAddress: appointment.address,
                  action: 'appointment_deleted',
                },
              });
              FlashMessage.success(
                'Appointment Deleted',
                res?.data?.message || 'Appointment removed'
              );
            } catch (err: any) {
              FlashMessage.error(
                'Error',
                err?.response?.data?.message || err?.message || 'Failed to delete appointment'
              );
            }
          },
        },
      ]
    );
  };

  const todayLabel = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const headerBorder = isDark ? colors.border : '#E2E8F0';

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.background }]}
      edges={['top', 'bottom', 'left', 'right']}
    >
      {/* Header bar */}
      <View style={[styles.header, { borderBottomColor: headerBorder }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backBtn}
        >
          <Icon name="chevron-left" size={28} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Appointments</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{todayLabel}</Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.addBtn, { backgroundColor: colors.primary.main }]}
        >
          <Icon name="plus" size={18} color="#FFFFFF" />
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary.main} />
        </View>
      ) : (
        <FlatList
          data={appointments}
          keyExtractor={(item, idx) => (item.id || item._id || String(idx)) as string}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.primary.main}
            />
          }
          renderItem={({ item }) => (
            <AppointmentCard
              appointment={item}
              onEdit={() => openEdit(item)}
              onDelete={() => handleDelete(item)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="calendar-blank-outline" size={64} color={colors.textSecondary} style={{ opacity: 0.4 }} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No appointments found</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                Get started by adding your first appointment
              </Text>
            </View>
          }
        />
      )}

      <AddAppointmentModal
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setSelected(null);
          setIsEdit(false);
        }}
        onSubmit={handleSubmit}
        isEdit={isEdit}
        appointment={selected}
        submitting={isCreating || isUpdating}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '900' },
  subtitle: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 12,
  },
  addBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 16 },
  emptySub: { fontSize: 13, marginTop: 6, textAlign: 'center' },
});
