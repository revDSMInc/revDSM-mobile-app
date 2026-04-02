import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AuthService } from '../services/api/auth';
import { useAuth } from './useAuth';

export const useUpdateProfileMutation = () => {
  const { refreshUser } = useAuth();

  return useMutation({
    mutationFn: async (data: any) => {
      const res = await AuthService.updateProfile(data);
      return res.data;
    },
    onSuccess: async () => {
      await refreshUser();
    },
  });
};

export const useToggle2FAMutation = () => {
  return useMutation({
    mutationFn: async ({ enabled, method }: { enabled: boolean; method: string }) => {
      if (enabled) {
        const res = await AuthService.disableTfa();
        return res.data;
      } else {
        const res = await AuthService.setupTfa(method);
        return res.data;
      }
    },
  });
};
