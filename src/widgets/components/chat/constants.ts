// Status chip config, kept 1:1 with web `chat-threads/chat-thread-item.js`
// `STATUS_CONFIG` so the Recent-Leads card shows the exact same badges (e.g. a
// `lf`/`lfLead` lead renders a black "LF LEAD" chip). Any unmapped status falls
// back to `notResulted`, matching web.
export const STATUS_CONFIG: any = {
  sale: { label: 'Sale', color: '#10B981', textColor: '#fff' },
  notResulted: { label: 'Not Resulted', color: '#EAB308', textColor: '#000' },
  demoNoSale: { label: 'Demo No Sale', color: '#EAB308', textColor: '#000' },
  noDemo: { label: 'No Demo', color: '#EAB308', textColor: '#000' },
  demo: { label: 'Demo', color: '#EAB308', textColor: '#fff' },
  reset: { label: 'Reset', color: '#94A3B8', textColor: '#fff' },
  scheduled: { label: 'Scheduled', color: '#3B82F6', textColor: '#fff' },
  inprogress: { label: 'In Progress', color: '#3B82F6', textColor: '#fff' },
  inProgress: { label: 'In Progress', color: '#3B82F6', textColor: '#fff' },
  completed: { label: 'Completed', color: '#10B981', textColor: '#fff' },
  cancelled: { label: 'Cancelled', color: '#EF4444', textColor: '#fff' },
  onHold: { label: 'On Hold', color: '#F59E0B', textColor: '#fff' },
  selfGenerated: { label: 'Self Generated', color: '#000000', textColor: '#fff' },
  lfLead: { label: 'LF Lead', color: '#000000', textColor: '#fff' },
  lf: { label: 'LF Lead', color: '#000000', textColor: '#fff' },
  notHit: { label: 'Not Hit', color: '#000000', textColor: '#fff' },
};

export const LEAD_TYPE_BADGE = {
  issued: { label: 'Issued Lead', color: '#4CBB17', textColor: '#FFFFFF' },
  selfGenerated: { label: 'Self Generated', color: '#919EAB', textColor: '#FFFFFF' },
} as const;
