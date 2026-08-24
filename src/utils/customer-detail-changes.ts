import { formatUSPhoneNumber } from './phone-util';

/**
 * Activity-log rules for the Lead Center's **Edit Customer Details** modal.
 *
 * Pure and RN-free, for the reason `utils/addendum-drafts.ts` and
 * `utils/inspection-photos.ts` exist: the only consumer (`screens/LeadCenter/index.tsx`)
 * pulls in React Native and is untestable under jest here, and the one thing that can be
 * SILENTLY wrong — reporting a field as changed when the rep never touched it — leaves no
 * trace anywhere except a wrong row on the portal timeline.
 */

/** Web `edit-customer-modal.js` sends every customer field under this one category. */
export const CUSTOMER_FIELD_CATEGORY = 'customer';
export const CUSTOMER_FIELD_CHANGED_ACTION = 'customer field changed';

export interface CustomerFieldChange {
  fieldLabel: string;
  fieldName: string;
  fieldValue: string;
  fieldCategory: string;
  oldValue: string;
  newValue: string;
  action: string;
}

export interface CustomerFieldValues {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  address?: string;
}

/**
 * The two ids every `customer_details` event carries.
 *
 * ⚠️ `customerId` is the CUSTOMER record's id, a DIFFERENT document from the lead (the
 * ticket's payload shows `…3a94` vs `…3a97`). `handleCustomerSubmit` falls back to the
 * lead id when building the PATCH url; that fallback must NOT leak in here, because the
 * portal joins on this id. Web reads `customerData._id` with no fallback at all, so a
 * lead carrying no customer record reports `null` rather than the wrong record.
 */
export function resolveCustomerLogIds(lead: any): { customerId: string | null; leadId: any } {
  return {
    customerId: lead?.customerDetails?._id || lead?.customerDetails?.id || null,
    leadId: lead?._id || lead?.id,
  };
}

/**
 * Web's five tracked fields, in its own order — see `trackFieldChange`'s call sites.
 * Co-buyers are NOT tracked on web either (they only flip `hasUnsavedChanges`).
 *
 * ⚠️ Each `read` must reproduce EXACTLY how `EditCustomerModal` seeds that field, or an
 * untouched value reports a phantom change:
 *  • `phone` is stored raw or E.164 (`4438784937` / `+14438784937`) and the modal seeds it
 *    through `formatUSPhoneNumber`, so comparing against the STORED string would report a
 *    phone edit on every single save. (Same trap the modal's own length validation hit.)
 *  • `address` falls back to `lead.fullAddress`, which is the modal's own fallback.
 */
const TRACKED_FIELDS: Array<{
  fieldName: keyof CustomerFieldValues;
  fieldLabel: string;
  read: (customer: any, lead: any) => string;
}> = [
  { fieldName: 'firstName', fieldLabel: 'First Name', read: (c) => c?.firstName || '' },
  { fieldName: 'lastName', fieldLabel: 'Last Name', read: (c) => c?.lastName || '' },
  { fieldName: 'phone', fieldLabel: 'Phone Number', read: (c) => formatUSPhoneNumber(c?.phone || '') },
  { fieldName: 'email', fieldLabel: 'Email', read: (c) => c?.email || '' },
  { fieldName: 'address', fieldLabel: 'Address', read: (c, lead) => c?.address || lead?.fullAddress || '' },
];

/**
 * One log row per field the rep actually altered, ready to drop into `logEvent`'s `meta`.
 *
 * ⚠️ Derived at SAVE time by diffing the submitted payload against the record — a
 * deliberate divergence from web, and the requested one. Web debounces each keystroke
 * (`useDebounce(changedValue, 2000)`) from inside the modal, so a web row can describe an
 * edit the rep then abandoned; a row built here only ever describes a change that
 * PERSISTED.
 *
 * ⚠️ Pass the PRE-SAVE lead. `handleCustomerSubmit` calls this after its optimistic
 * `setLead`, which is safe because a state setter does not mutate the closure's binding —
 * but a future caller that re-reads the lead from the cache first would diff a record
 * against itself and log nothing.
 */
/**
 * ⚠️ NO LONGER WIRED — kept for reference only.
 *
 * The per-field `change` rows are now emitted by `EditCustomerModal`'s own DEBOUNCED
 * tracker as the rep types (web parity), not derived from the saved payload. Re-wiring
 * this into `handleCustomerSubmit` would put every edit on the timeline TWICE.
 */
export function buildCustomerFieldChanges(lead: any, next: CustomerFieldValues): CustomerFieldChange[] {
  const customer = lead?.customerDetails || {};
  const changes: CustomerFieldChange[] = [];

  TRACKED_FIELDS.forEach(({ fieldName, fieldLabel, read }) => {
    const oldValue = String(read(customer, lead) ?? '');
    const newValue = String(next?.[fieldName] ?? '');
    if (oldValue === newValue) return;
    changes.push({
      fieldLabel,
      fieldName,
      fieldValue: newValue,
      fieldCategory: CUSTOMER_FIELD_CATEGORY,
      oldValue,
      newValue,
      action: CUSTOMER_FIELD_CHANGED_ACTION,
    });
  });

  return changes;
}
