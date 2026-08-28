import api from './index';

export interface JobEntry {
  id?: string;
  _id?: string;
  jobNumber: string;
  salesPrice: number;
  paymentMethod: string;
  installDate: string | null;
  soldDate: string;
  toBeDetermined: boolean;
  commission: number;
  /** Sum(qty x price.retail) from the deal center - the commission tier basis. */
  retailPrice?: number;
  /** Which configured tier paid this job, for audit. */
  commissionTierId?: string | null;
  /** Which version of the commission config paid it. */
  commissionConfigUpdatedAt?: string | null;
  customerName?: string;
  title?: string;
  isManual: boolean;
  appointmentId?: string;
  calculatorId?: string;
  leadId?: string;
  status?: 'unpaid' | 'paid' | 'cancelled' | 'bank decline';
}

class JobService {
  async getJobs(): Promise<JobEntry[]> {
    const res = await api.get<any>('/job-tracker');
    return res.data?.data || res.data || [];
  }

  async createJob(payload: JobEntry): Promise<JobEntry> {
    const res = await api.post<any>('/job-tracker', payload);
    return res.data?.data || res.data;
  }

  /**
   * The job already added to job tracker for an appointment (web parity:
   * `useGetJobsByAppointment` → `GET /job-tracker/{appointmentId}`). Returns null
   * when none exists so callers can show the "Add" vs "already added" state.
   */
  async getJobByAppointment(appointmentId: string): Promise<JobEntry | null> {
    if (!appointmentId) return null;
    const res = await api.get<any>(`/job-tracker/${appointmentId}`);
    const data = res.data?.data ?? res.data;
    if (!data) return null;
    return Array.isArray(data) ? (data[0] || null) : data;
  }

  async updateJob(id: string, payload: Partial<JobEntry>): Promise<JobEntry> {
    const res = await api.put<any>(`/job-tracker/${id}`, payload);
    return res.data?.data || res.data;
  }

  async updateStatus(id: string, status: string): Promise<JobEntry> {
    const res = await api.put<any>(`/job-tracker/${id}/status`, { status });
    return res.data?.data || res.data;
  }

  async deleteJob(id: string): Promise<void> {
    await api.delete(`/job-tracker/${id}`);
  }

  async getMonthlyStats(year: number): Promise<any> {
    const res = await api.get<any>(`/job-tracker/monthly/${year}`);
    return res.data?.data || res.data;
  }
}

export default new JobService();
