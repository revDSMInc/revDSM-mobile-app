import type { CocRelationshipType, CocScanFields } from '../config/types/installer';

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

const JOB_NUMBER_KEYS = [
  'jobNumber',
  'job_number',
  'jobNo',
  'job_no',
  'jobNum',
  'workOrderNumber',
];

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

const CONFIRMATION_BLOCK_KEYS = ['confirmations', 'checkboxes', 'attestations'];
const SHORT_ADULT_KEYS = ['adult', 'over18', 'is18'];
const SHORT_AUTHORIZED_KEYS = ['authorized', 'authorised'];
const SHORT_COMPLETED_KEYS = ['completed', 'complete', 'perContract'];

const isPlainObject = (value: any): boolean =>
  !!value && typeof value === 'object' && !Array.isArray(value);

interface Candidate {
  node: any;
  isConfirmationBlock: boolean;
}

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

export const toScannedDate = (raw: any): string | undefined => {
  const text = toText(raw);
  if (!text) return undefined;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;

  const parts = /^(\d{1,2})([/-])(\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[3]);
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

export const extractCocScanFields = (body: any): CocScanFields | null => {
  const candidates = collectCandidates(body);
  if (candidates.length === 0) return null;

  const confirmationBlocks = candidates.filter((c) => c.isConfirmationBlock);

  const flagged = readRelationshipFlags(candidates);
  const named = readFirst(candidates, RELATIONSHIP_KEYS, toScannedRelationship);
  const relationship = flagged ?? named?.relationship;
  const writeIn = readFirst(candidates, RELATIONSHIP_OTHER_KEYS, toText);

  const fields: CocScanFields = {
    jobNumber: readFirst(candidates, JOB_NUMBER_KEYS, toText),
    date: readFirst(candidates, DATE_KEYS, toScannedDate),
    relationship,
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
