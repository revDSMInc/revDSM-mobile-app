import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';

/**
 * Appointment management hook — web parity with `src/api/appointments.js`
 * (`useGetAppointments`, `addAppointment`, `updateAppointment`, `deleteAppointment`).
 *
 * Endpoints:
 *  - list   : GET    /appointments
 *  - create : POST   /appointments
 *  - update : PUT    /appointments/{id}
 *  - delete : DELETE /appointments/{id}
 */

export interface Appointment {
  id?: string;
  _id?: string;
  title?: string;
  address?: string;
  leadId?: string;
  selfGenLeadId?: string;
  calculatorsCount?: number;
  calculators?: any[];
  createdAt?: string;
  lastUpdate?: string;
  [key: string]: any;
}

export interface AppointmentPayload {
  title: string;
  address?: string;
  leadId?: string;
}

const APPOINTMENTS_KEY = ['appointments'];

export function useAppointments() {
  const queryClient = useQueryClient();

  const query = useQuery<Appointment[]>({
    queryKey: APPOINTMENTS_KEY,
    queryFn: async () => {
      const res = await LeadService.getAppointments();
      // Backend returns { data: [...] }
      return (res.data?.data || res.data || []) as Appointment[];
    },
    staleTime: 30000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: APPOINTMENTS_KEY });

  const createMutation = useMutation({
    mutationFn: (payload: AppointmentPayload) => LeadService.createAppointment(payload),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: AppointmentPayload }) =>
      LeadService.updateAppointment(id, payload),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => LeadService.deleteAppointment(id),
    onSuccess: invalidate,
  });

  // Newest first — web sorts by createdAt desc.
  const sortedAppointments = useMemo(() => {
    const list = query.data || [];
    return [...list].sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }, [query.data]);

  return {
    appointments: sortedAppointments,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    createAppointment: createMutation.mutateAsync,
    updateAppointment: updateMutation.mutateAsync,
    deleteAppointment: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
