export type ConsentFormKind = 'consent' | 'waiver';

export const consentReportType = (kind: ConsentFormKind): string =>
  kind === 'waiver' ? 'waiver_form' : 'consent_form';

export const consentFormLabel = (kind: ConsentFormKind): string =>
  kind === 'waiver' ? 'Roof waiver' : 'Consent form';

export const readGeneratedReports = (lead: any): any[] => [
  ...(lead?.generatedReports || []),
  ...(lead?.outcomeData?.generatedReports || []),
  ...(lead?.leadData?.generatedReports || []),
  ...(lead?.outcome?.generatedReports || []),
];

export const hasFiledConsentReport = (lead: any, kind: ConsentFormKind): boolean => {
  const type = consentReportType(kind);
  const keyword = type.split('_')[0].toLowerCase(); // 'consent' | 'waiver'
  return readGeneratedReports(lead).some(
    (r: any) =>
      (r?.reportType === type ||
        String(r?.reportName || '').toLowerCase().includes(keyword) ||
        String(r?.reportPath || '').toLowerCase().includes(keyword)) &&
      !r?.isReset
  );
};

export const consentSignatureName = (
  kind: ConsentFormKind,
  now: number = Date.now()
): string =>
  `${kind === 'waiver' ? 'Waiver' : 'Consent'}_signature_${now}_${Math.random()
    .toString(36)
    .slice(2, 8)}.svg`;

export const splitConsentPayload = (
  data: any
): { fields: Record<string, unknown>; signature: { uri: string; name?: string; type?: string } | null } => {
  const fields: Record<string, unknown> = {};
  let signature: { uri: string; name?: string; type?: string } | null = null;

  Object.keys(data || {}).forEach((key) => {
    const value = (data as any)[key];
    if ((key === 'file' || key === 'signature') && value?.uri) {
      signature = { uri: String(value.uri), name: value.name, type: value.type };
      return;
    }
    fields[key] = value;
  });

  return { fields, signature };
};

export const describeConsentForm = (kind: ConsentFormKind, data: any): string => {
  const who = String(data?.fullName || '').trim();
  return who ? `${consentFormLabel(kind)} — ${who}` : consentFormLabel(kind);
};
