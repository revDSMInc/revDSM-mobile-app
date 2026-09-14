/**
 * consent-forms.ts — what a Customer Consent Form and a Roof Waiver have in common.
 *
 * The two are the same act with two names: a short form, a signature drawn on the device, a
 * multipart POST, and a PDF the SERVER renders and files as a `generatedReport` on the lead. They
 * are handled together everywhere because a rule that meant two different things on the two of
 * them — "is one already on file", above all — would show a rep a gate that disagrees with itself.
 *
 * ⚠️ The consent is not paperwork, it is the GATE: the rep may not present a quote until the
 * customer has signed one. That is why it has to work at a door with no signal, and why "is it
 * signed" must keep answering yes for a form that is signed but not yet uploaded.
 *
 * Pure and RN-free (no `react-native`, no axios, no MMKV) so every rule here is testable; the
 * screens that read them cannot be loaded under jest in this repo.
 */

export type ConsentFormKind = 'consent' | 'waiver';

/** The `reportType` the server files this form's PDF under. */
export const consentReportType = (kind: ConsentFormKind): string =>
  kind === 'waiver' ? 'waiver_form' : 'consent_form';

/** What to call it in a message to the rep. */
export const consentFormLabel = (kind: ConsentFormKind): string =>
  kind === 'waiver' ? 'Roof waiver' : 'Consent form';

/**
 * Every place a lead record hides its generated reports.
 *
 * ⚠️ FOUR shapes, and they are not interchangeable — the same lead carries reports under different
 * roots depending on which endpoint returned it. Reading only `lead.generatedReports`, which is the
 * obvious one, reports a signed consent as missing on a lead that arrived from the outcome read,
 * and the rep is asked to sign a second one in front of the customer.
 */
export const readGeneratedReports = (lead: any): any[] => [
  ...(lead?.generatedReports || []),
  ...(lead?.outcomeData?.generatedReports || []),
  ...(lead?.leadData?.generatedReports || []),
  ...(lead?.outcome?.generatedReports || []),
];

/**
 * Is a form of this kind already filed on the lead?
 *
 * The matching rule is the one `useLeadCenterModals.findReport` and the Investment Center's own
 * gate already used, kept verbatim and in one place: the exact `reportType`, or the kind's keyword
 * appearing in the report's name or path — older rows predate the typed field — and never a row
 * the office has reset.
 */
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

/**
 * Name the signature file so a queued form's own file cannot collide with another's.
 *
 * The modal writes every signature as `signature.svg` into the CACHES directory, which is fine for
 * a form that is posted immediately and forgotten. A queued one has to survive an app kill and sit
 * beside other queued signatures in one directory, so it gets a unique name on the way to storage.
 */
export const consentSignatureName = (
  kind: ConsentFormKind,
  now: number = Date.now()
): string =>
  `${kind === 'waiver' ? 'Waiver' : 'Consent'}_signature_${now}_${Math.random()
    .toString(36)
    .slice(2, 8)}.svg`;

/**
 * Split a submitted form into the fields that go in the multipart body and the signature file.
 *
 * ⚠️ The signature arrives on `file` as `{ uri, name, type }` and must NOT be stringified into the
 * body with the rest: `String({...})` is `"[object Object]"`, which posts a form whose signature is
 * that literal text — a consent record with no signature on it, filed and looking complete.
 */
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

/** A one-line description for the pending list, so a rep can tell two queued forms apart. */
export const describeConsentForm = (kind: ConsentFormKind, data: any): string => {
  const who = String(data?.fullName || '').trim();
  return who ? `${consentFormLabel(kind)} — ${who}` : consentFormLabel(kind);
};
