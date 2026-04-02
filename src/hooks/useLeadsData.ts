import { useState, useCallback, useEffect } from 'react';
import { LeadService } from '../services/api/leads';
import { useAuth } from './useAuth';
import type { Lead } from '../config/types/lead';

export function useLeadsData(params?: { status?: string; period?: string }) {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeads = useCallback(async () => {
    if (!user?._id) return;
    try {
      setLoading(true);
      const res = await LeadService.getSalesLeads(user._id, params);
      const data = res.data?.data?.leads || res.data?.data;
      setLeads(Array.isArray(data) ? data : []);
    } catch {
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [user?._id, JSON.stringify(params)]);

  const refresh = useCallback(() => fetchLeads(), [fetchLeads]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  return { leads, loading, refresh };
}
