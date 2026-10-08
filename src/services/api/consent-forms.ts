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

const buildUrl = (path: string): string =>
  `${ENV.API_URL}${path}`.replace(/\/\//g, '/').replace('https:/', 'https://');

const endpointFor = (kind: ConsentFormKind, leadId: string): string =>
  kind === 'waiver'
    ? buildUrl(`/lead/v1/${leadId}/mobile/waiver-form`)
    : buildUrl('user/consent/v1/mobile/create');

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
    }
    throw Object.assign(new Error(message), { response: { status } });
  }

  const content = await ReactNativeBlobUtil.fs.readFile(pdfPath, 'base64');
  if (!content.startsWith('JVBERi')) {
    await ReactNativeBlobUtil.fs.unlink(pdfPath).catch(() => {});
    throw new Error('Generated file is not a valid PDF.');
  }
  return pdfPath;
};

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
