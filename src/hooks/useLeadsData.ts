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

  const removeLocalLead = useCallback((id: string) => {
    setLeads((prev) => prev.filter((l) => l._id !== id));
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  return { leads, loading, refresh, removeLocalLead };
}

export function useLead(leadId: string) {
  const { user } = useAuth();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLead = useCallback(async () => {
    if (!user?._id || !leadId) return;
    try {
      setLoading(true);
      // We use the workLead API without changing status to just fetch fresh data
      // or we can use a dedicated getLead API if available.
      // Based on previous logs, LeadService.workLead is used to get detail in handleActionPress
      const res = await LeadService.workLead(leadId, user._id);
      const data = res.data?.data || res.data;
      setLead(data);
    } catch (err) {
      console.error('Fetch Lead Error:', err);
    } finally {
      setLoading(false);
    }
  }, [user?._id, leadId]);

  useEffect(() => {
    fetchLead();
  }, [fetchLead]);

  return { lead, loading, refresh: fetchLead };
}
