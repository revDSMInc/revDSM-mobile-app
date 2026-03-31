import { useState, useCallback, useEffect } from 'react';
import axiosInstance, { endpoints } from '../../../shared/api/axios';
import { useAuth } from '../../../shared/hooks/useAuth';
import type { Lead } from '../../../entities/lead/model/types';

export function useLeadsData() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeads = useCallback(async () => {
    if (!user?._id) return;
    try {
      setLoading(true);
      const url = endpoints.leads.salesPortal(user._id);
      const res = await axiosInstance.get(url);
      const data = res?.data?.data;
      setLeads(Array.isArray(data) ? data : []);
    } catch {
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [user?._id]);

  const refresh = useCallback(() => fetchLeads(), [fetchLeads]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  return { leads, loading, refresh };
}
