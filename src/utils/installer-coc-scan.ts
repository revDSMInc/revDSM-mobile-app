/**
 * Certificate of Completion — reading a SCANNED paper certificate.
 *
 * The Paper Fallback pill scans the signed paper form and PUTs each page to
 * `installer/v1/{jobId}/images` under `phase: 'cocPaperFallback'`. The backend reads
 * the page and answers with the certificate's own values, and this file is the ONE
 * place that turns that answer into the fields the form shows — so the scan path and
 * the type-it-in path can never disagree about what a value means.
 *
 * ⚠️ Pure, with a type-only import and nothing else. `CoCFormModal` and `CoCStep` both
 * pull in React Native and are untestable under jest here (the same reason
 * `utils/addendum-drafts.ts` and `utils/inspection-photos.ts` exist), and the rules
 * below — which key is the job NUMBER and not a mongo id, what a tick means, how a
 * date is parsed — are exactly the kind that fail silently: a wrong read files the
 * wrong figures against a document the customer has already signed.
 *
 * ⚠️ **Nothing is guessed.** Keys are matched against FIXED lists, the same discipline
 * as `readDocumentGroup` in `utils/uploaded-document-refs.ts`. An unrecognised shape
 * yields `null` and the form falls back to its derived Job # / today's date — never a
 * value read off some other field that happened to sit nearby.
 */

import type { CocRelationshipType, CocScanFields } from '../config/types/installer';

/**
 * Where the certificate block can sit inside the upload response.
 *
 * Walked breadth-first from the body, so the SHALLOWEST match wins — a wrapper that
 * repeats a key deeper down cannot outrank the real one. Bounded on both depth and
 * node count so a large photo payload is never scanned exhaustively.
 */
const CONTAINER_KEYS = [
  'data',
  'coc',
  'cocForm',
  'certificate',
  'certificateOfCompletion',
  'parsed',
  'parsedData',
  'parsedFields',
  'extracted',
  'extractedData',
  'extraction',
  'ocr',
  'ocrData',
  'scan',
  'scanResult',
  'scanData',
  'result',
  'fields',
  'form',
  'formData',
  'details',
  'customer',
  'confirmations',
  'checkboxes',
  'attestations',
];

const MAX_DEPTH = 5;
const MAX_NODES = 60;

/**
 * ⚠️ `jobId` / `job_id` are deliberately ABSENT. On this endpoint the response root
 * carries the job's mongo `_id` and its `leadId`; reading either as the certificate's
 * Job # would print a 24-character id in the box the office matches the paper on.
 */
const JOB_NUMBER_KEYS = [
  'jobNumber',
  'job_number',
  'jobNo',
  'job_no',
  'jobNum',
  'workOrderNumber',
];

/**
 * ⚠️ `installDate` is NOT here. The certificate is dated when it was SIGNED, which is
 * the day the work was walked; an install date scheduled weeks earlier is a different
 * fact about the job, not the date on the paper.
 */
const DATE_KEYS = [
  'date',
  'signedDate',
  'signed_date',
  'dateSigned',
  'date_signed',
  'completionDate',
  'completion_date',
  'dateOfCompletion',
  'certificateDate',
];

const RELATIONSHIP_KEYS = [
  'relationship',
  'relationshipType',
  'relationship_type',
  'relationToHomeowner',
  'relationToHomeOwner',
  'relation_to_homeowner',
  'relationshipToHomeowner',
  'signerRelationship',
];

/**
 * The relationship as three TICK BOXES rather than a word — which is how the live
 * extraction reports it (`homeowner` / `spouse` / `other`, one of them true, with the
 * write-in on `relationToHomeowner`).
 *
 * ⚠️ At least TWO of the three must be present as booleans before any of them is read.
 * `other` on its own is far too common a key to treat as an answer to "who signed".
 */
const RELATIONSHIP_FLAGS: [string, CocRelationshipType][] = [
  ['homeowner', 'homeowner'],
  ['spouse', 'spouse'],
  ['other', 'other'],
];

const RELATIONSHIP_OTHER_KEYS = [
  'relationshipOther',
  'otherRelationship',
  'relationship_other',
  'other_relationship',
  'relationshipOtherText',
  'otherRelationshipText',
];

/**
 * The three attestations.
 *
 * ⚠️ Bare words (`adult`, `authorized`, `completed`) are read ONLY inside a
 * confirmations-shaped object. At the top level `completed` is overwhelmingly the JOB's
 * own status on this endpoint, and ticking "the installation has been completed as per
 * the contract" off the back of that would attest something nobody said.
 */
const ADULT_KEYS = [
  'is18OrOlder',
  'is18orOlder',
  'is_18_or_older',
  'age18OrOlder',
  'age_18_or_older',
  'isAdult',
  'eighteenOrOlder',
];
const AUTHORIZED_KEYS = [
  'isHomeownerOrAuthorized',
  'is_homeowner_or_authorized',
  'isAuthorizedSigner',
  'homeownerOrAuthorized',
  'isAuthorized',
];
const COMPLETED_KEYS = [
  'installationCompletedAsPerContract',
  'installation_completed_as_per_contract',
  'installationStatusCompleted',
  'installation_status_completed',
  'installedPerContract',
  'installationCompleted',
  'completedAsPerContract',
];

/** Read only from an object reached through one of these — see above. */
const CONFIRMATION_BLOCK_KEYS = ['confirmations', 'checkboxes', 'attestations'];
const SHORT_ADULT_KEYS = ['adult', 'over18', 'is18'];
const SHORT_AUTHORIZED_KEYS = ['authorized', 'authorised'];
const SHORT_COMPLETED_KEYS = ['completed', 'complete', 'perContract'];

const isPlainObject = (value: any): boolean =>
  !!value && typeof value === 'object' && !Array.isArray(value);

interface Candidate {
  node: any;
  /** True when this object was reached through a confirmations-shaped key. */
  isConfirmationBlock: boolean;
}

/**
 * Every object worth reading, shallowest first.
 *
 * Each visited node is itself a candidate — the certificate block can be the body,
 * `data`, or a `parsed` sub-object, and which one it is varies by deployment.
 */
const collectCandidates = (body: any): Candidate[] => {
  if (!isPlainObject(body)) return [];

  const out: Candidate[] = [];
  const queue: { node: any; depth: number; isConfirmationBlock: boolean }[] = [
    { node: body, depth: 0, isConfirmationBlock: false },
  ];
  const seen = new Set<any>([body]);

  while (queue.length > 0 && out.length < MAX_NODES) {
    const current = queue.shift()!;
    out.push({ node: current.node, isConfirmationBlock: current.isConfirmationBlock });
    if (current.depth >= MAX_DEPTH) continue;

    CONTAINER_KEYS.forEach((key) => {
      const child = current.node[key];
      if (isPlainObject(child) && !seen.has(child)) {
        seen.add(child);
        queue.push({
          node: child,
          depth: current.depth + 1,
          isConfirmationBlock: CONFIRMATION_BLOCK_KEYS.includes(key),
        });
      }
    });
  }

  return out;
};

/** The first candidate carrying one of `keys` with a value this file recognises. */
const readFirst = <T,>(
  candidates: Candidate[],
  keys: string[],
  coerce: (raw: any) => T | undefined
): T | undefined => {
  for (const candidate of candidates) {
    for (const key of keys) {
      if (!(key in candidate.node)) continue;
      const value = coerce(candidate.node[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
};

const toText = (raw: any): string | undefined => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const TRUE_WORDS = ['true', 'yes', 'y', '1', 'checked', 'x', 'on', 'ticked'];
const FALSE_WORDS = ['false', 'no', 'n', '0', 'unchecked', 'off', 'blank'];

/**
 * A tick box off the paper.
 *
 * Returns `undefined` — not `false` — for anything it does not recognise, so an
 * unreadable box leaves the form's own state alone rather than silently UN-ticking an
 * attestation the signer made.
 */
export const toScannedBoolean = (raw: any): boolean | undefined => {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1 ? true : raw === 0 ? false : undefined;
  if (typeof raw !== 'string') return undefined;
  const word = raw.trim().toLowerCase();
  if (TRUE_WORDS.includes(word)) return true;
  if (FALSE_WORDS.includes(word)) return false;
  return undefined;
};

const two = (n: number) => n.toString().padStart(2, '0');

/**
 * The certificate's date, as `MM/DD/YYYY` — the format the form's own date box uses.
 *
 * ⚠️ Parsed as TEXT, never through `new Date(...)`. An ISO string carries a timezone
 * offset, so building a local Date shifts the calendar day either side of midnight —
 * the trap `utils/job-change-summary.ts` records, and this is the date on a document the
 * customer has signed.
 *
 * An unrecognised format is returned VERBATIM rather than dropped: the box is read-only
 * context, and showing what the paper says beats showing today's date as if it were the
 * paper's.
 */
export const toScannedDate = (raw: any): string | undefined => {
  const text = toText(raw);
  if (!text) return undefined;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;

  const parts = /^(\d{1,2})([/-])(\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[3]);
    /**
     * ⚠️ The SEPARATOR decides the order, and it has to.
     *
     * The extraction sends the certificate's date hyphenated and DAY-first
     * (`31-8-2026`), while a slashed date is the US month-first form this app prints
     * everywhere else. A component over 12 can only be the day and settles it either
     * way; `8-3-2026` is genuinely ambiguous and follows the separator.
     */
    const dayFirst = first > 12 ? true : second > 12 ? false : parts[2] === '-';
    const month = dayFirst ? second : first;
    const day = dayFirst ? first : second;
    const year = parts[4].length === 2 ? `20${parts[4]}` : parts[4];
    return `${two(month)}/${two(day)}/${year}`;
  }

  return text;
};

const HOMEOWNER_WORDS = ['homeowner', 'home owner', 'home_owner', 'owner', 'self'];
const SPOUSE_WORDS = ['spouse', 'wife', 'husband', 'partner'];

/**
 * Who signed.
 *
 * An unrecognised answer is NOT dropped — it becomes `other` and the text itself comes
 * back as the write-in, which is exactly the line the paper has for it. Dropping it
 * would leave the certificate saying nobody signed.
 */
export const toScannedRelationship = (
  raw: any
): { relationship: CocRelationshipType; other?: string } | undefined => {
  const text = toText(raw);
  if (!text) return undefined;
  const word = text.toLowerCase();
  if (HOMEOWNER_WORDS.includes(word)) return { relationship: 'homeowner' };
  if (SPOUSE_WORDS.includes(word)) return { relationship: 'spouse' };
  if (word === 'other') return { relationship: 'other' };
  return { relationship: 'other', other: text };
};

/**
 * Which relationship box the page reported as ticked.
 *
 * Returns `undefined` when no candidate carries the trio at all, and when the trio is
 * there with nothing ticked — the paper said nobody, which the form shows by leaving
 * all three empty.
 */
const readRelationshipFlags = (candidates: Candidate[]): CocRelationshipType | undefined => {
  for (const { node } of candidates) {
    const present = RELATIONSHIP_FLAGS.filter(
      ([key]) => toScannedBoolean(node[key]) !== undefined
    );
    if (present.length < 2) continue;
    return present.find(([key]) => toScannedBoolean(node[key]) === true)?.[1];
  }
  return undefined;
};

/**
 * The certificate's fields out of the scan response, or `null` when it carries none.
 *
 * `null` is the honest answer for a backend that has not been wired up yet, or a page it
 * could not read — the caller then leaves the form exactly as it would have been, so the
 * scan path degrades to what it did before this existed rather than to an empty form.
 */
export const extractCocScanFields = (body: any): CocScanFields | null => {
  const candidates = collectCandidates(body);
  if (candidates.length === 0) return null;

  const confirmationBlocks = candidates.filter((c) => c.isConfirmationBlock);

  // The tick boxes win over the word: they ARE the boxes on the paper, and the word
  // beside them is the write-in line that only one of those boxes asks for.
  const flagged = readRelationshipFlags(candidates);
  const named = readFirst(candidates, RELATIONSHIP_KEYS, toScannedRelationship);
  const relationship = flagged ?? named?.relationship;
  const writeIn = readFirst(candidates, RELATIONSHIP_OTHER_KEYS, toText);

  const fields: CocScanFields = {
    jobNumber: readFirst(candidates, JOB_NUMBER_KEYS, toText),
    date: readFirst(candidates, DATE_KEYS, toScannedDate),
    relationship,
    // An explicit write-in wins; otherwise an unrecognised relationship falls back to
    // the word the paper carried, so `Other` is never ticked with nothing beside it.
    // Only ever set for `other` — the form's write-in line does not exist otherwise,
    // and a name left on a homeowner certificate would ride into the payload unseen.
    relationshipOther: relationship === 'other' ? writeIn ?? named?.other : undefined,
    isAdult:
      readFirst(candidates, ADULT_KEYS, toScannedBoolean) ??
      readFirst(confirmationBlocks, SHORT_ADULT_KEYS, toScannedBoolean),
    isAuthorizedSigner:
      readFirst(candidates, AUTHORIZED_KEYS, toScannedBoolean) ??
      readFirst(confirmationBlocks, SHORT_AUTHORIZED_KEYS, toScannedBoolean),
    installedPerContract:
      readFirst(candidates, COMPLETED_KEYS, toScannedBoolean) ??
      readFirst(confirmationBlocks, SHORT_COMPLETED_KEYS, toScannedBoolean),
  };

  const carriesSomething = Object.values(fields).some((value) => value !== undefined);
  return carriesSomething ? fields : null;
};
