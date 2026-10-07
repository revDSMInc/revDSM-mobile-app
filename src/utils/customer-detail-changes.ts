import { formatUSPhoneNumber } from './phone-util';

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

export function resolveCustomerLogIds(lead: any): { customerId: string | null; leadId: any } {
  return {
    customerId: lead?.customerDetails?._id || lead?.customerDetails?.id || null,
    leadId: lead?._id || lead?.id,
  };
}

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
