import {
  isTransportCopy,
  scrubTransportCopy,
  shouldShowTransportToast,
  TRANSPORT_FALLBACK,
  TRANSPORT_TITLE,
} from '../../src/utils/transport-error-copy';

describe('isTransportCopy', () => {
  /** ⚠️ The exact string the client photographed. */
  it('catches the axios timeout verbatim', () => {
    expect(isTransportCopy('timeout of 15000ms exceeded')).toBe(true);
  });

  it('catches the other transport spellings', () => {
    [
      'Network Error',
      'Network request failed',
      'socket hang up',
      'ECONNABORTED',
      'connect ETIMEDOUT 10.0.0.1:443',
      'Unable to resolve host "demo-api.revdsm.com"',
      'Request failed with status code 502',
    ].forEach((t) => expect(isTransportCopy(t)).toBe(true));
  });

  it('catches any raw millisecond count', () => {
    expect(isTransportCopy('gave up after 8000 ms')).toBe(true);
  });

  /** ⚠️ A real server answer must survive untouched - it is the only useful thing we get. */
  it('leaves what the SERVER said alone', () => {
    [
      'Valid lead id is required',
      'This deal has already been submitted',
      'Please build and confirm all rollouts first.',
      'Signature is required before sending',
    ].forEach((t) => expect(isTransportCopy(t)).toBe(false));
  });

  it('is safe on empty input', () => {
    expect(isTransportCopy('')).toBe(false);
    expect(isTransportCopy(null)).toBe(false);
    expect(isTransportCopy(undefined)).toBe(false);
  });
});

describe('scrubTransportCopy', () => {
  /** The screenshot: title "Error", description the raw axios string. */
  it('rewrites the toast the client complained about', () => {
    expect(
      scrubTransportCopy({ title: 'Error', description: 'timeout of 15000ms exceeded' })
    ).toEqual({ title: TRANSPORT_TITLE, description: TRANSPORT_FALLBACK });
  });

  /**
   * ⚠️ A caller that named the ACTION keeps its title. That word is the only thing telling the
   * rep WHICH thing failed, and this module has no way to know it.
   */
  it('keeps an informative title and replaces only the junk description', () => {
    expect(
      scrubTransportCopy({ title: 'Could not upload photo', description: 'Network Error' })
    ).toEqual({ title: 'Could not upload photo', description: TRANSPORT_FALLBACK });
  });

  it('replaces a generic title whatever its casing', () => {
    ['Error', 'error', 'Failed', 'Oops', ''].forEach((title) => {
      expect(
        scrubTransportCopy({ title, description: 'timeout of 15000ms exceeded' }).title
      ).toBe(TRANSPORT_TITLE);
    });
  });

  /** ⚠️ The whole point: a real rejection is passed through unchanged. */
  it('does not touch a real server message', () => {
    const copy = { title: 'Error', description: 'Valid lead id is required' };
    expect(scrubTransportCopy(copy)).toEqual(copy);
  });

  it('does not touch success or info copy', () => {
    const copy = { title: 'Saved', description: 'Deal submitted' };
    expect(scrubTransportCopy(copy)).toEqual(copy);
  });

  it('returns the SAME object when nothing changed, so emit can skip the rebuild', () => {
    const copy = { title: 'Saved', description: 'Deal submitted' };
    expect(scrubTransportCopy(copy)).toBe(copy);
  });

  it('handles transport wording that arrived in the title', () => {
    expect(
      scrubTransportCopy({ title: 'timeout of 15000ms exceeded', description: '' })
    ).toEqual({ title: TRANSPORT_TITLE, description: TRANSPORT_FALLBACK });
  });

  /** ⚠️ Never show a millisecond count or an errno to a rep, under any title. */
  it('leaves no machine wording on screen', () => {
    const out = scrubTransportCopy({ title: 'Error', description: 'timeout of 15000ms exceeded' });
    expect(`${out.title} ${out.description}`).not.toMatch(/\d+\s*ms|timeout|ECONN|axios/i);
  });
});


/**
 * Client: *"we already showing the offline banner so why we need to show this? it looks to the
 * user something bad on the app"*. A red card about the connection is alarm without an action.
 */
describe('shouldShowTransportToast', () => {
  /**
   * ⚠️ UNCONDITIONAL. This was first gated on the connection strip being visible, which failed
   * twice: the strip lives in `MainHeader` and not every screen renders one (the Lead Center in
   * the client's screenshot does not), and even where it does the status LAGS the first failure
   * by `FAILURES_BEFORE_LEAVING_ONLINE` + `MIN_DWELL_MS`, so the check ran while the state still
   * said `online`. No banner state is consulted any more.
   */
  it('never shows the axios timeout, whatever the connection state', () => {
    expect(shouldShowTransportToast({ title: 'Error', description: 'timeout of 15000ms exceeded' }))
      .toBe(false);
  });

  it('never shows any transport wording', () => {
    [
      'Network Error',
      'Network request failed',
      'socket hang up',
      'connect ETIMEDOUT 10.0.0.1:443',
    ].forEach((description) =>
      expect(shouldShowTransportToast({ title: 'Error', description })).toBe(false)
    );
  });

  it('suppresses transport wording that arrived in the title', () => {
    expect(shouldShowTransportToast({ title: 'Network Error', description: '' })).toBe(false);
  });

  /**
   * ⚠️ The line that keeps this safe. The strip says nothing about what the SERVER rejected, so
   * swallowing a real answer would hide something the rep must act on.
   */
  it('ALWAYS shows what the server actually said', () => {
    [
      'This deal has already been submitted',
      'Valid lead id is required',
      'Signature is required before sending',
    ].forEach((description) =>
      expect(shouldShowTransportToast({ title: 'Error', description })).toBe(true)
    );
  });

  it('lets success and info through untouched', () => {
    expect(shouldShowTransportToast({ title: 'Saved', description: 'Deal submitted' })).toBe(true);
  });
});
