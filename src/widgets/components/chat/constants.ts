export const STATUS_CONFIG: any = {
  sale: { label: 'Sale', color: '#10b981', textColor: '#fff' },
  notResulted: { label: 'Not Resulted', color: '#eab308', textColor: '#000' },
  demoNoSale: { label: 'Demo No Sale', color: '#eab308', textColor: '#000' },
  noDemo: { label: 'No Demo', color: '#eab308', textColor: '#000' },
  demo: { label: 'Demo', color: '#eab308', textColor: '#fff' },
  reset: { label: 'Reset', color: '#94a3b8', textColor: '#fff' },
  scheduled: { label: 'Scheduled', color: '#3b82f6', textColor: '#fff' },
  inprogress: { label: 'In Progress', color: '#3b82f6', textColor: '#fff' },
  inProgress: { label: 'In Progress', color: '#3b82f6', textColor: '#fff' },
  completed: { label: 'Completed', color: '#10b981', textColor: '#fff' },
  cancelled: { label: 'Cancelled', color: '#ef4444', textColor: '#fff' },
  onHold: { label: 'On Hold', color: '#f59e0b', textColor: '#fff' },
  selfGenerated: { label: 'Self Generated', color: '#919EAB', textColor: '#fff' },
  lfLead: { label: 'Issued Lead', color: '#4CBB17', textColor: '#fff' },
  lf: { label: 'Issued Lead', color: '#4CBB17', textColor: '#fff' },
  issued: { label: 'Issued Lead', color: '#4CBB17', textColor: '#fff' },
  confirmedIssued: { label: 'Issued Lead', color: '#4CBB17', textColor: '#fff' },
  notHit: { label: 'Not Hit', color: '#919EAB', textColor: '#fff' },
};

export const LEAD_TYPE_BADGE = {
  issued: { label: 'Issued Lead', color: '#4CBB17', textColor: '#FFFFFF' },
  selfGenerated: { label: 'Self Generated', color: '#919EAB', textColor: '#FFFFFF' },
} as const;
