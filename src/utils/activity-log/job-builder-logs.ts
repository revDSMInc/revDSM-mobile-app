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

/**
 * REVUIUX-569 - annotating an order sheet in place. Fired TWICE per annotation: a `click` when the annotator opens and an
 * `add` once the bytes are stored. The backend has registered `order_sheet_annotated` in its timeline actions (kept out of the
 * step's "add" set, so a finished Order Sheet step cannot walk back to Pending).
 */
export const logOrderSheetAnnotated = async (
  userId: string,
  leadId: string,
  stage: 'opened' | 'stored',
  extra: { documentId?: string | null; revision?: number | null; twinState?: string | null } = {},
) => {
  await logEvent(stage === 'opened' ? 'click' : 'add', {
    user_id: userId,
    created_by: userId,
    module_type: 'job_builder',
    meta: {
      draft: true,
      leadId,
      fieldName: 'orderSheet',
      fieldLabel: 'Order Sheet Annotated',
      stage,
      documentId: extra.documentId ?? null,
      revision: extra.revision ?? null,
      twinState: extra.twinState ?? null,
      action: 'order_sheet_annotated',
    },
  });
};

/** ⚠️ `add`, never `delete`: the portal's label map reads `delete` as `order_sheet_removed` and would show a reset as a removal. */
export const logOrderSheetReset = async (
  userId: string,
  leadId: string,
  extra: { documentId?: string | null } = {},
) => {
  await logEvent('add', {
    user_id: userId,
    created_by: userId,
    module_type: 'job_builder',
    meta: {
      draft: true,
      leadId,
      fieldName: 'orderSheet',
      fieldLabel: 'Order Sheet Reset',
      documentId: extra.documentId ?? null,
      action: 'order_sheet_reset',
    },
  });
};
