/**
 * consent-forms.ts — the ONE implementation of "post a signed consent form or roof waiver".
 *
 * Extracted from `useSubmitDigitalConsentMutation` / `useSubmitRoofWaiverMutation` so the online
 * path and the offline queue send byte-identical bodies. They must: this is a legal form, and two
 * copies of a multipart builder drifting apart would file two differently-shaped records for the
 * same act, with nothing on the device to say which one a given lead got.
 *
 * ⚠️ THE PDF IS RENDERED BY THE SERVER — that is the whole reason the offline story here is a QUEUE
 * and not a device-side render like the agreement. This endpoint answers with `application/pdf`,
 * so with no signal there is no document to produce, show, or file. What the rep signs at the door
 * is captured; the PDF exists from the moment it uploads.
 *
 * The pure rules (which report type, is one already filed, how the payload splits) live in
 * `utils/consent-forms.ts`, which is testable; this file binds the native uploader.
 */

import ReactNativeBlobUtil from 'react-native-blob-util';
import { Platform } from 'react-native';
import { Storage } from '../../utils/storage';
import { ENV } from '../../config/env';
import { LeadService } from './leads';
import {
  consentReportType,
  splitConsentPayload,
  type ConsentFormKind,
} from '../../utils/consent-forms';

/**
 * ⚠️ Reproduced verbatim from the two mutations, collapsing a double slash and then repairing the
 * one in `https://`. `ENV.API_URL` may or may not carry a trailing slash and the waiver path starts
 * with one, so without this a deployment configured either way posts to a 404.
 */
const buildUrl = (path: string): string =>
  `${ENV.API_URL}${path}`.replace(/\/\//g, '/').replace('https:/', 'https://');

const endpointFor = (kind: ConsentFormKind, leadId: string): string =>
  kind === 'waiver'
    ? buildUrl(`/lead/v1/${leadId}/mobile/waiver-form`)
    : buildUrl('user/consent/v1/mobile/create');

/**
 * Submit the form and return the local path of the PDF the server rendered.
 *
 * Throws on any non-2xx, or on a 200 whose body is not actually a PDF — the endpoint answers some
 * failures with a JSON error at status 200, so a resolved fetch is not proof the form was filed.
 */
export const submitConsentForm = async ({
  kind,
  leadId,
  payload,
}: {
  kind: ConsentFormKind;
  leadId: string;
  payload: Record<string, any>;
}): Promise<string> => {
  const token = Storage.getItem('accessToken');
  const { fields, signature } = splitConsentPayload(payload);

  const body: any[] = Object.keys(fields).map((key) => ({
    name: key,
    data: String(fields[key]),
  }));
  if (signature?.uri) {
    body.push({
      name: 'file',
      filename: signature.name || 'signature.svg',
      type: signature.type || 'image/svg+xml',
      data: ReactNativeBlobUtil.wrap(signature.uri.replace('file://', '')),
    });
  }

  const fetchConfig = {
    fileCache: true,
    appendExt: 'pdf',
    timeout: 120000,
    path: `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${kind}_${Date.now()}.pdf`,
  };

  const res = await ReactNativeBlobUtil.config(fetchConfig).fetch(
    'POST',
    endpointFor(kind, leadId),
    {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'multipart/form-data',
      Accept: 'application/pdf',
    },
    body
  );

  const pdfPath = res.path() || fetchConfig.path;
  const status = res.info().status;

  if (status >= 400) {
    const errorText = await ReactNativeBlobUtil.fs.readFile(pdfPath, 'utf8');
    await ReactNativeBlobUtil.fs.unlink(pdfPath).catch(() => {});
    let message = `Server Error (${status}): ${errorText.substring(0, 100)}`;
    try {
      const parsed = JSON.parse(errorText);
      message = parsed.message || parsed.error || `Server Error: ${status}`;
    } catch {
      /* not JSON — keep the raw excerpt, it is what the server actually said */
    }
    throw Object.assign(new Error(message), { response: { status } });
  }

  // `JVBERi` is base64 for `%PDF` — the cheapest proof the body is the document and not a
  // JSON error the endpoint answered with a 200.
  const content = await ReactNativeBlobUtil.fs.readFile(pdfPath, 'base64');
  if (!content.startsWith('JVBERi')) {
    await ReactNativeBlobUtil.fs.unlink(pdfPath).catch(() => {});
    throw new Error('Generated file is not a valid PDF.');
  }
  return pdfPath;
};

/**
 * File the rendered PDF as a `generatedReport` on the lead — the row every "is it signed?" check
 * in the app reads. Without it the form is submitted and the gate still says unsigned.
 */
export const finalizeConsentUpload = async ({
  leadId,
  pdfPath,
  kind,
}: {
  leadId: string;
  pdfPath: string;
  kind: ConsentFormKind;
}): Promise<void> => {
  // ⚠️ The waiver endpoint (`/mobile/waiver-form`) already files its own generatedReport
  // ("Roof Waiver - {name}"), which `hasFiledConsentReport` matches on "waiver". Uploading the
  // PDF again put every waiver on the Reports tab twice (REVDSM-1293). Consent still needs
  // this upload: its endpoint files nothing.
  if (kind === 'waiver') return;

  const reportType = consentReportType(kind);
  const formData = new FormData();
  formData.append('leadId', leadId);
  formData.append('reportType', reportType);
  formData.append('file', {
    uri:
      Platform.OS === 'android'
        ? pdfPath.startsWith('file://')
          ? pdfPath
          : `file://${pdfPath}`
        : pdfPath,
    name: `${reportType}.pdf`,
    type: 'application/pdf',
  } as any);

  await LeadService.uploadGeneratedReport(formData);
};
