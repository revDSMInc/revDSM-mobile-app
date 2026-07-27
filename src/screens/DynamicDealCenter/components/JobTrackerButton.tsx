import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import JobService, { JobEntry } from '../../../services/api/JobService';
import { AddEditJobModal } from '../../JobTracker/components/AddEditJobModal';
import { FlashMessage } from '../../../config/message';
import { logEvent } from '../../../services/api/LoggerService';
import { useAuth } from '../../../hooks/useAuth';

/**
 * "Add This Job to Job Tracker" button for the dynamic deal center — a port of the
 * web `JobTrackerButton` (`src/sections/job-tracker/components/job-tracker-button.js`),
 * rendered under the Job Summary in the editable calculator view. It looks up whether
 * a job already exists for the appointment (`GET /job-tracker/{appointmentId}`) and
 * shows either the green **Add** button (opens the shared `AddEditJobModal` seeded
 * with the calculator's appointment/calculator/title/price/payment method) or, when
 * one already exists, a red **remove** button plus **Go to Job Tracker**.
 */
export function JobTrackerButton({
  appointmentId,
  calculatorId,
  title,
  endPrice,
  paymentMethod,
  isLowesLead = false,
}: {
  appointmentId?: string;
  calculatorId?: string;
  title?: string;
  endPrice?: number;
  paymentMethod?: string;
  isLowesLead?: boolean;
}) {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [existingJob, setExistingJob] = useState<JobEntry | null>(null);
  const [checking, setChecking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const refreshExisting = useCallback(async () => {
    if (!appointmentId) { setExistingJob(null); return; }
    setChecking(true);
    try {
      const job = await JobService.getJobByAppointment(appointmentId);
      setExistingJob(job);
    } catch {
      // A missing/empty job tracker entry is a normal 404 — treat as "none".
      setExistingJob(null);
    } finally {
      setChecking(false);
    }
  }, [appointmentId]);

  useEffect(() => { refreshExisting(); }, [refreshExisting]);

  const handleAddClick = useCallback(() => {
    const userId = user?._id || user?.id;
    if (userId) {
      logEvent('JobTracker_Add_Clicked', {
        user_id: userId,
        created_by: userId,
        module_type: 'job_tracker',
        meta: { appointmentId, calculatorId, action: 'add_job_clicked' },
      });
    }
    setModalOpen(true);
  }, [user, appointmentId, calculatorId]);

  const handleRemove = useCallback(() => {
    const jobId = existingJob?.id || existingJob?._id;
    if (!jobId) return;
    Alert.alert(
      'Remove existing job',
      `Are you sure you want to remove the existing job for "${existingJob?.title || 'calculator'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await JobService.deleteJob(jobId);
              FlashMessage.success('Job Tracker', 'Job deleted successfully');
              await refreshExisting();
            } catch {
              FlashMessage.error('Job Tracker', 'Failed to delete job');
            } finally {
              setRemoving(false);
            }
          },
        },
      ]
    );
  }, [existingJob, refreshExisting]);

  // The seed passed to the shared modal — a calculator-originated (non-manual) job.
  const seedJob: Partial<JobEntry> = {
    appointmentId,
    calculatorId,
    title,
    salesPrice: endPrice || 0,
    paymentMethod: paymentMethod || 'check',
    isManual: false,
  };

  return (
    <View style={{ marginTop: 4, marginBottom: 24 }}>
      {checking ? (
        <View style={{ height: 52, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#4CBB17" />
        </View>
      ) : existingJob ? (
        <View style={{ gap: 12 }}>
          <TouchableOpacity
            onPress={handleRemove}
            disabled={removing}
            activeOpacity={0.8}
            style={{ height: 52, borderRadius: 14, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, opacity: removing ? 0.6 : 1 }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13, textAlign: 'center' }}>
              {removing
                ? 'Removing…'
                : `${existingJob?.title || 'Calculator'} has already been added to job tracker. Tap to remove.`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('JobTracker')}
            activeOpacity={0.8}
            style={{ height: 52, borderRadius: 14, backgroundColor: '#4CBB17', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15, marginRight: 6 }}>Go to Job Tracker</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          onPress={handleAddClick}
          activeOpacity={0.8}
          style={{ height: 52, borderRadius: 14, backgroundColor: '#4CBB17', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: '#16a34a', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}
        >
          <Ionicons name="add-circle-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Add This Job to Job Tracker</Text>
        </TouchableOpacity>
      )}

      <AddEditJobModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => { setModalOpen(false); refreshExisting(); }}
        job={seedJob as JobEntry}
        isLowesLead={isLowesLead}
      />
    </View>
  );
}
