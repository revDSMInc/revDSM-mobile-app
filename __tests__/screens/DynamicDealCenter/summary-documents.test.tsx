/**
 * Dynamic Job Builder summary — agreement / order-sheet documents.
 *
 * Regression (rep report): "when i add the pdf it says saved successfully, but when
 * i come back to the same screen no pdf is showing — and it never shows on web".
 *
 * Web keeps its documents ON THE JOB STATE (`jobState.agreements` as
 * `[{ files: [...] }]`, see `dynamic-job-builder.js#handleAgreementDocumentsChange`),
 * which the storage serializer passes through (`ROOT_PASSTHROUGH_KEYS`) so the draft
 * carries them across a reopen — and so the summary can render them
 * (`existingAgreements={jobState?.agreements}`). Mobile instead CLEARED that key after
 * uploading and relied on the calculator-scoped outcome echoing the document rows,
 * which it does not reliably do. These tests pin the web behaviour.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

let scannerProps: any = null;

jest.mock('react-native-fs', () => ({ readFile: jest.fn().mockResolvedValue('BASE64BODY') }));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../src/hooks/useAuth', () => ({ useAuth: () => ({ user: { _id: 'u1' } }) }));
jest.mock('../../../src/services/api/LoggerService', () => ({ logEvent: jest.fn() }));
jest.mock('../../../src/utils/jpeg-to-pdf', () => ({ convertJpegToPdf: (b: string) => b }));
jest.mock('../../../src/widgets/modals/PdfPreviewModal', () => ({ PdfPreviewModal: () => null }));
jest.mock('../../../src/widgets/modals/job-builder/AppointmentSchedulerModal', () => ({
  AppointmentSchedulerModal: () => null,
}));
jest.mock('../../../src/widgets/components/dynamic-job-builder/agreement/DynamicAgreementDialog', () => ({
  DynamicAgreementDialog: () => null,
}));
jest.mock('../../../src/widgets/modals/job-builder/DocumentScannerModal', () => ({
  DocumentScannerModal: (props: any) => {
    scannerProps = props;
    return null;
  },
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

const {
  SummaryFinalizeCards,
} = require('../../../src/widgets/components/dynamic-job-builder/agreement/SummaryFinalizeCards');

// A document row as the server returns it once uploaded, resolved to a signed URL
// (the shape `utils/outcome-documents.ts#resolveOutcomeDocRows` produces).
const serverDoc = {
  id: 'doc1',
  serverId: 'doc1',
  name: 'agreement_1.pdf',
  url: 'https://s3/signed/agreement_1.pdf',
  uri: 'https://s3/signed/agreement_1.pdf',
  contentType: 'application/pdf',
  filePath: 'leads/l1/agreement_1.pdf',
  bucketName: 'bucket',
  documentType: 'agreement',
  isNew: false,
};

function render(overrides: any = {}) {
  const onUpdateRootState = jest.fn();
  const setResolvedDocuments = jest.fn();
  const onUploadDocs = jest.fn().mockResolvedValue([serverDoc]);
  const props = {
    leadId: 'l1',
    isSale: true,
    customerName: 'Jane Doe',
    scheduleTime: { date: '2026-07-22', timeWindow: '8:00 AM - 12:00 PM' },
    agreements: [],
    orderSheets: [],
    onUpdateRootState,
    resolvedDocuments: { agreements: [], orderSheets: [] },
    setResolvedDocuments,
    onUploadDocs,
    ...overrides,
  };
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<SummaryFinalizeCards {...props} />);
  });
  return { tree: tree!, onUpdateRootState, setResolvedDocuments, onUploadDocs };
}

/**
 * Open the AGREEMENTS scanner: the header pencil once the card holds documents,
 * else its "Add Document" button. The card must be opened for a category before
 * `onSave` means anything — the modal is shared with the order-sheet card.
 */
function openAgreementScanner(tree: ReactTestRenderer.ReactTestRenderer) {
  const pressable = (n: any) => typeof n.props?.onPress === 'function';
  const header = tree.root.findAll(
    (n: any) => n.type === 'Text' && n.props.children === 'Agreements',
  )[0];
  // Walk up from the title to the nearest ancestor holding a button — the section
  // header's pencil when documents exist. (Composite wrappers sit between the host
  // nodes, so this cannot be a fixed number of `.parent` hops.)
  let ancestor: any = header.parent;
  let headerButtons: any[] = [];
  while (ancestor && !headerButtons.length) {
    headerButtons = ancestor.findAll(pressable, { deep: true });
    if (!headerButtons.length) ancestor = ancestor.parent;
  }
  const isEditPencil = ancestor && !ancestor.findAll(
    (n: any) => n.type === 'Text' && n.props.children === 'Add Document',
  ).length;
  if (headerButtons.length && isEditPencil) {
    act(() => headerButtons[0].props.onPress());
  } else {
    const label = tree.root.findAll(
      (n: any) => n.type === 'Text' && n.props.children === 'Add Document',
    )[0];
    let node: any = label.parent;
    while (node && !pressable(node)) node = node.parent;
    act(() => node.props.onPress());
  }
  if (scannerProps?.title !== 'Scan Agreement') {
    throw new Error(`expected the agreement scanner, got: ${scannerProps?.title}`);
  }
}

const renderedDocNames = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType('Text' as any)
    .map((n) => n.props.children)
    .filter((c) => typeof c === 'string' && c.endsWith('.pdf'));

beforeEach(() => {
  scannerProps = null;
});

test('an uploaded document is recorded on the job state, not cleared from it', async () => {
  const { tree, onUpdateRootState, onUploadDocs } = render();
  openAgreementScanner(tree);

  // The scanner returns one freshly captured page.
  await act(async () => {
    await scannerProps.onSave([{ uri: 'file:///tmp/scan.jpg', isNew: true, name: 'scan.jpg' }]);
  });

  expect(onUploadDocs).toHaveBeenCalledWith('agreement', [
    expect.objectContaining({ documentType: 'agreement', isNew: true }),
  ]);
  // The web-shaped group — this is what the draft save persists and what web reads.
  expect(onUpdateRootState).toHaveBeenLastCalledWith('agreements', [{ files: [serverDoc] }]);
});

test('a document held only on the job state renders (a web-attached agreement)', () => {
  const { tree } = render({ agreements: [{ files: [serverDoc] }] });
  expect(renderedDocNames(tree)).toEqual(['agreement_1.pdf']);
});

test('the same document in both sources is listed once', () => {
  const { tree } = render({
    agreements: [{ files: [serverDoc] }],
    resolvedDocuments: { agreements: [serverDoc], orderSheets: [] },
  });
  expect(renderedDocNames(tree)).toEqual(['agreement_1.pdf']);
});

test('removing a document prunes the job-state copy immediately', async () => {
  const { tree, onUpdateRootState } = render({ agreements: [{ files: [serverDoc] }] });
  openAgreementScanner(tree);

  // Rep crosses the page out in the scanner, then taps Update → an empty set comes back.
  await act(async () => {
    await scannerProps.onSave([]);
  });

  expect(onUpdateRootState).toHaveBeenCalledWith('agreements', []);
});

test('a failed upload leaves the job state untouched', async () => {
  const onUploadDocs = jest.fn().mockResolvedValue(null);
  const { tree, onUpdateRootState } = render({ onUploadDocs });
  openAgreementScanner(tree);

  await act(async () => {
    await scannerProps.onSave([{ uri: 'file:///tmp/scan.jpg', isNew: true, name: 'scan.jpg' }]);
  });

  // Only the (no-op) removal pass ran; nothing was committed as saved.
  expect(onUpdateRootState).not.toHaveBeenCalledWith('agreements', [{ files: [serverDoc] }]);
});
