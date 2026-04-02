import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FlashMessage } from '../config/message';
import { LeadService } from '../services/api/leads';

export const useCreateLeadMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: any) => {
      const res = await LeadService.createLead(data);
      return res.data;
    },
    onSuccess: () => {
      // Invalidate leads queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
};

export const useUpdateLeadOutcomeMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, data }: { leadId: string; data: any }) => {
      const res = await LeadService.updateLeadOutcome(leadId, data);
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-outcome', variables.leadId] });
    },
  });
};

export const useSubmitJobBuilderMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, payload }: { leadId: string; payload: any }) => {
      const res = await LeadService.submitJobBuilder(leadId, payload);
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['job-builder', variables.leadId] });
    },
  });
};

export const useWorkLeadMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, userId, status = null }: { leadId: string; userId: string; status?: string | null }) => 
      LeadService.workLead(leadId, userId, status),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      FlashMessage.success('Success', res.data?.message || 'Work status updated');
    },
    onError: (err: any) => {
      FlashMessage.error('Error', err?.message || 'Failed to update work status');
    }
  });
};
