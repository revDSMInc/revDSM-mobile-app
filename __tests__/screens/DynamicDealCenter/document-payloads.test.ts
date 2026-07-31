/**
 * Top-level `agreements` / `orderSheets` for the job-builder submit.
 *
 * Web parity: `sections/deal-center/components/TabbedCalculator.js`, `action ===
 * 'complete'` — every file on `jobState.agreements` / `.orderSheets` is converted to a
 * base64 PDF and sent as `{ name: '', file, type }` alongside the serialized jobState,
 * and on a non-Sale result the agreements are filed AS ORDER SHEETS. Mobile was
 * sending neither key.
 */
jest.mock('react-native-fs', () => ({ readFile: jest.fn().mockResolvedValue('LOCALPDFBASE64') }));
jest.mock('../../../src/utils/jpeg-to-pdf', () => ({
  convertJpegToPdf: (b: string) => `PDF(${b})`,
}));
jest.mock('../../../src/services/api/leads', () => ({
  LeadService: { downloadOutcomeDocuments: jest.fn() },
}));

const { buildDocumentPayloads } = require('../../../src/screens/DynamicDealCenter/utils/document-payloads');
const { LeadService } = require('../../../src/services/api/leads');

const generatedPdf = {
  name: 'Agreement_SPN/A_1784721386743.pdf',
  uri: 'file:///Users/apple/Library/Developer/CoreSimulator/agreement_signed.pdf',
  contentType: 'application/pdf',
  documentType: 'agreement',
  isNew: false,
};

beforeEach(() => jest.clearAllMocks());

test('a locally stored PDF is sent as a base64 payload in web shape', async () => {
  LeadService.downloadOutcomeDocuments.mockResolvedValue({ data: { data: {} } });
  const out = await buildDocumentPayloads({
    agreements: [{ files: [generatedPdf] }],
    orderSheets: [],
    leadId: 'l1',
    isSale: true,
  });

  expect(out.agreements).toEqual([
    { name: '', file: 'data:application/pdf;base64,LOCALPDFBASE64', type: 'agreement' },
  ]);
  expect(out.orderSheets).toEqual([]);
});

test('no round-trip when every category is covered locally', async () => {
  await buildDocumentPayloads({
    agreements: [{ files: [generatedPdf] }],
    orderSheets: [{ files: [{ ...generatedPdf, documentType: 'orderSheet' }] }],
    leadId: 'l1',
    isSale: true,
  });

  expect(LeadService.downloadOutcomeDocuments).not.toHaveBeenCalled();
});

test('a scanned image is converted to a PDF first (web generatePdfFromImages)', async () => {
  const out = await buildDocumentPayloads({
    agreements: [{ files: [{ name: 'scan.jpg', url: 'data:image/jpeg;base64,JPEGBYTES' }] }],
    leadId: 'l1',
    isSale: true,
  });

  expect(out.agreements).toEqual([
    { name: '', file: 'data:application/pdf;base64,PDF(JPEGBYTES)', type: 'agreement' },
  ]);
});

test('on a DEMO the agreements are submitted as order sheets', async () => {
  const out = await buildDocumentPayloads({
    agreements: [{ files: [generatedPdf] }],
    leadId: 'l1',
    isSale: false,
  });

  expect(out.agreements).toEqual([]);
  expect(out.orderSheets).toEqual([
    { name: '', file: 'data:application/pdf;base64,LOCALPDFBASE64', type: 'orderSheet' },
  ]);
});

test('a server-backed row pulls its bytes from downloadOutcomeDocuments', async () => {
  LeadService.downloadOutcomeDocuments.mockResolvedValue({
    data: {
      data: {
        agreements: [
          { _id: 'doc1', base64Data: 'SERVERPDF', fileData: { contentType: 'application/pdf' } },
        ],
        orderSheets: [],
      },
    },
  });

  const out = await buildDocumentPayloads({
    agreements: [{ files: [{ serverId: 'doc1', name: 'a.pdf', url: 'https://s3/signed/a.pdf' }] }],
    leadId: 'l1',
    isSale: true,
  });

  expect(LeadService.downloadOutcomeDocuments).toHaveBeenCalledWith('l1');
  expect(out.agreements).toEqual([
    { name: '', file: 'data:application/pdf;base64,SERVERPDF', type: 'agreement' },
  ]);
});

test('an unreadable document is dropped, not sent as null', async () => {
  LeadService.downloadOutcomeDocuments.mockResolvedValue({ data: { data: {} } });

  const out = await buildDocumentPayloads({
    agreements: [{ files: [{ serverId: 'missing', url: 'https://s3/gone.pdf' }, generatedPdf] }],
    leadId: 'l1',
    isSale: true,
  });

  expect(out.agreements).toHaveLength(1);
  expect(out.agreements[0].file).toBe('data:application/pdf;base64,LOCALPDFBASE64');
});

test('no documents anywhere → both keys present and empty (web always sends them)', async () => {
  LeadService.downloadOutcomeDocuments.mockResolvedValue({ data: { data: {} } });
  const out = await buildDocumentPayloads({ agreements: [], orderSheets: [], leadId: 'l1', isSale: true });
  expect(out).toEqual({ agreements: [], orderSheets: [] });
});

// The submit shipped `agreements: []` while the PDF sat on the server: mobile files
// the document at ADD time, so the copy on jobState is only a mirror — and any hiccup
// recording it (failed read-back, a builder reopened on a draft older than the upload)
// emptied the payload. The stored documents are the source of truth.
test('an empty job state falls back to the documents already stored on the lead', async () => {
  LeadService.downloadOutcomeDocuments.mockResolvedValue({
    data: {
      data: {
        agreements: [
          { _id: 'doc1', name: 'Agreement_STN-4471.pdf', base64Data: 'STOREDPDF', fileData: { contentType: 'application/pdf' } },
        ],
        orderSheets: [],
      },
    },
  });

  const out = await buildDocumentPayloads({ agreements: [], orderSheets: [], leadId: 'l1', isSale: true });

  expect(out.agreements).toEqual([
    { name: '', file: 'data:application/pdf;base64,STOREDPDF', type: 'agreement' },
  ]);
});

test('the stored fallback also respects the DEMO → order-sheet rule', async () => {
  LeadService.downloadOutcomeDocuments.mockResolvedValue({
    data: {
      data: {
        agreements: [{ _id: 'doc1', base64Data: 'STOREDPDF', fileData: { contentType: 'application/pdf' } }],
        orderSheets: [],
      },
    },
  });

  const out = await buildDocumentPayloads({ agreements: [], leadId: 'l1', isSale: false });

  expect(out.agreements).toEqual([]);
  expect(out.orderSheets).toEqual([
    { name: '', file: 'data:application/pdf;base64,STOREDPDF', type: 'orderSheet' },
  ]);
});

// The sign endpoint files its own row, so a generated agreement is never uploaded and
// must not be re-sent here either — that produced two identical 67 KB "Agreement"
// cards on the lead. Crucially the stored fallback must ALSO stay out of the way: we
// already know a copy exists, and re-sending it is what duplicates it.
test('a system-generated agreement is not re-sent, and does not trigger the stored fallback', async () => {
  LeadService.downloadOutcomeDocuments.mockResolvedValue({
    data: {
      data: {
        agreements: [{ _id: 'doc1', base64Data: 'STOREDPDF', fileData: { contentType: 'application/pdf' } }],
        orderSheets: [],
      },
    },
  });

  const out = await buildDocumentPayloads({
    agreements: [{ files: [{ ...generatedPdf, isSystemGenerated: true }] }],
    leadId: 'l1',
    isSale: true,
  });

  expect(out.agreements).toEqual([]);
  expect(out.orderSheets).toEqual([]);
});

test('a scanned agreement alongside a generated one still sends exactly the scanned copy', async () => {
  LeadService.downloadOutcomeDocuments.mockResolvedValue({ data: { data: {} } });

  const out = await buildDocumentPayloads({
    agreements: [
      { files: [{ ...generatedPdf, isSystemGenerated: true }, { name: 'scan.jpg', url: 'data:image/jpeg;base64,JPEGBYTES' }] },
    ],
    leadId: 'l1',
    isSale: true,
  });

  expect(out.agreements).toEqual([
    { name: '', file: 'data:application/pdf;base64,PDF(JPEGBYTES)', type: 'agreement' },
  ]);
});

test('a populated job state wins over the stored list (no double-send)', async () => {
  LeadService.downloadOutcomeDocuments.mockResolvedValue({
    data: {
      data: {
        agreements: [{ _id: 'doc1', base64Data: 'STOREDPDF', fileData: { contentType: 'application/pdf' } }],
        orderSheets: [],
      },
    },
  });

  const out = await buildDocumentPayloads({
    agreements: [{ files: [generatedPdf] }],
    leadId: 'l1',
    isSale: true,
  });

  expect(out.agreements).toEqual([
    { name: '', file: 'data:application/pdf;base64,LOCALPDFBASE64', type: 'agreement' },
  ]);
});
