import {
  classifyCreateOutcome,
  isSuccessfulCreate,
  messageOfError,
  resolveRetryDecision,
} from '../../src/utils/offline-lead-queue';

// The exact answer the server gives when a Lead ID is already taken in the company.
const SERVER_BODY = {
  code: 400,
  message: 'A lead with leadId "414144" already exists in this company. LeadId must be unique.',
  data: {},
};

// What `normalizeApiError` hands the form for an HTTP 400 carrying that body.
const rejection = { ...SERVER_BODY, httpStatus: 400 };

describe('creating a lead with a Lead ID that is already in use', () => {
  it("is recognised as a duplicate and carries the server's own message", () => {
    expect(classifyCreateOutcome(rejection)).toBe('duplicate');
    expect(messageOfError(rejection)).toBe(SERVER_BODY.message);
  });

  it('is never reported as a success - even when it arrives as an HTTP 200 body', () => {
    expect(isSuccessfulCreate(SERVER_BODY)).toBe(false);
    expect(isSuccessfulCreate({ code: 400, message: 'Something else', data: {} })).toBe(false);
    expect(isSuccessfulCreate({ code: 200, message: 'Lead created', data: { lead: { _id: 'x' } } })).toBe(true);
  });

  it('a body-coded failure with no duplicate wording is still a rejection, not an ambiguous maybe-saved', () => {
    // Shape thrown by `useCreateLeadMutation` for a body code >= 400 on an HTTP 200.
    expect(classifyCreateOutcome({ code: 422, message: 'Phone is invalid', httpStatus: 422 })).toBe('rejected');
  });

  it("the QUEUE still treats a duplicate on a replay of an Issued lead as 'done' - only the form's first attempt is a conflict", () => {
    const issued = { leadType: 'lfLead', lfLeadId: '414144' };
    expect(resolveRetryDecision('duplicate', issued)).toBe('done');
    expect(resolveRetryDecision('duplicate', { leadType: 'selfGen' })).toBe('needs-review');
  });
});
