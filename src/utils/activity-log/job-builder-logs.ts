import { logEvent } from '../../services/api/LoggerService';

export const logAppointmentScheduled = async (
  userId: string,
  leadId: string,
  data: {
    date?: string;
    timeWindow?: string | null;
    reason?: string | null;
    customerName?: string;
  },
) => {
  await logEvent('change', {
    user_id: userId,
    created_by: userId,
    module_type: 'job_builder',
    meta: {
      draft: true,
      leadId,
      date: data.date,
      timeWindow: data.timeWindow || null,
      isTBD: data.date === 'TBD',
      tbdReason: data.reason || null,
      customerName: data.customerName,
      action: 'appointment_scheduled',
    },
  });
};

export const logAgreementGenerated = async (userId: string, leadId: string) => {
  await logEvent('add', {
    user_id: userId,
    created_by: userId,
    module_type: 'job_builder',
    meta: {
      draft: true,
      leadId,
      action: 'agreement_generated',
    },
  });
};

export const logAgreementUploaded = async (
  userId: string,
  leadId: string,
  documentCount: number,
) => {
  await logEvent('add', {
    user_id: userId,
    created_by: userId,
    module_type: 'job_builder',
    meta: {
      draft: true,
      leadId,
      documentCount,
      action: 'agreement_uploaded',
    },
  });
};

/**
 * Agreement SIGNED — the portal's Forever Record "Agreement" milestone renders a
 * "Signed" row only for `action: 'agreement_signed'` on a `module_type: 'job_builder'`
 * log (LeadLifecycleTimeline / log-item routing). `signMethod` distinguishes an
 * in-person signature from a remotely (web-link) signed one for anyone reading meta.
 */
export const logAgreementSigned = async (
  userId: string,
  leadId: string,
  signMethod: 'in_person' | 'remote' = 'in_person',
) => {
  await logEvent('add', {
    user_id: userId,
    created_by: userId,
    module_type: 'job_builder',
    meta: {
      draft: true,
      leadId,
      signMethod,
      action: 'agreement_signed',
    },
  });
};

export const logOrderSheetUploaded = async (
  userId: string,
  leadId: string,
  documentCount: number,
) => {
  await logEvent('add', {
    user_id: userId,
    created_by: userId,
    module_type: 'job_builder',
    meta: {
      draft: true,
      leadId,
      documentCount,
      action: 'order_sheet_uploaded',
    },
  });
};
