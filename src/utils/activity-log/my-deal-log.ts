import { logEvent } from '../../services/api/LoggerService';

/**
 * My Deals — deal-edit (addendum) activity logging (`module_type: 'my_deal'`).
 *
 * RN parity with web `src/sections/deal/components/use-deal-edit-activity-log.js`.
 * The deal-edit wizard — reached from **My Deals → a resulted deal → Edit ✏️** — is the
 * ONLY surface the web logs under `my_deal`, deliberately kept apart from the original
 * `job_builder` build so an addendum edit is queryable on its own.
 *
 * Most of the wizard's events (`step_viewed`, `step_navigation`, `field_changed`) come
 * from the embedded job builder, which `useDynamicJobBuilderActivityLog` emits under
 * `my_deal` when run in edit mode (module retargeted + the `DEAL_EDIT_META` stamp).
 * This helper covers the one event that lives OUTSIDE that embedded builder: the final
 * `addendum_submitted`, fired by the 4-step wrapper (`DynamicDealEditScreen`) when the
 * pending-signature addendum draft is sent (web `logAddendumSubmitted`).
 *
 * Fire-and-forget (mirrors the other activity-log helpers).
 */

export const MY_DEAL_MODULE = 'my_deal';

/**
 * Stamped on every `my_deal` event so a deal-edit is distinguishable from the original
 * build without changing the log shape (web `DEAL_EDIT_META` + `baseMeta.isDynamic`).
 */
export const DEAL_EDIT_META = {
  isDealEdit: true,
  editSource: 'deal_addendum',
  isDynamic: true,
} as const;

/** The addendum draft was submitted for customer signature (web `addendum_submitted`). */
export const logDealAddendumSubmitted = async (o: {
  userId: string;
  leadId?: string;
  jobBuilderId?: string;
  calculatorId?: string;
  result?: any;
  summary?: Record<string, unknown>;
}) => {
  if (!o.userId) return;
  await logEvent('submit', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MY_DEAL_MODULE,
    meta: {
      draft: true,
      ...(o.leadId ? { leadId: o.leadId } : {}),
      jobBuilderId: o.jobBuilderId || o.leadId,
      ...(o.calculatorId ? { calculatorId: o.calculatorId } : {}),
      calculatorType: 'dynamic',
      ...(o.result !== undefined && o.result !== null ? { result: o.result } : {}),
      action: 'addendum_submitted',
      ...(o.summary || {}),
      ...DEAL_EDIT_META,
    },
  });
};
