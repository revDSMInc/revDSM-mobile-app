import {
  resolveJobCardState,
  resultedActionLabel,
  humanizeStatus,
  JOB_CARD_COLORS,
} from '../../src/utils/installer-card-state';
import type { InstallerJob } from '../../src/config/types/installer';

const resultedJob = (status?: string, workflowState?: string): InstallerJob =>
  ({ _id: 'job-1', resulted: true, status, workflowState } as InstallerJob);

describe('humanizeStatus', () => {
  it.each([
    ['cantDoWork', 'Cant Do Work'],
    ['notHit', 'Not Hit'],
    ['reset', 'Reset'],
    ['inProgress', 'In Progress'],
    ['onHold', 'On Hold'],
    ['completed', 'Completed'],
  ])('renders %p as %p', (wire, expected) => {
    expect(humanizeStatus(wire)).toBe(expected);
  });

  it('handles PascalCase, in case the API ever capitalises', () => {
    expect(humanizeStatus('CantDoWork')).toBe('Cant Do Work');
  });

  it('keeps an acronym whole instead of splitting it letter by letter', () => {
    expect(humanizeStatus('HOAIssue')).toBe('HOA Issue');
  });

  it('accepts snake and kebab separators', () => {
    expect(humanizeStatus('cant_do_work')).toBe('Cant Do Work');
    expect(humanizeStatus('not-hit')).toBe('Not Hit');
  });
});

describe('resultedActionLabel', () => {
  it('prefixes the status with "Resulted - "', () => {
    expect(resultedActionLabel(resultedJob('cantDoWork', 'resulted'))).toBe(
      'Resulted - Cant Do Work!'
    );
  });

  it('reads the same when the API sends it capitalised', () => {
    expect(resultedActionLabel(resultedJob('CantDoWork', 'Resulted'))).toBe(
      'Resulted - Cant Do Work!'
    );
  });

  it.each([
    ['notHit', 'Resulted - Not Hit!'],
    ['reset', 'Resulted - Reset!'],
    ['onHold', 'Resulted - On Hold!'],
  ])('renders status %p as %p', (status, expected) => {
    expect(resultedActionLabel(resultedJob(status, 'resulted'))).toBe(expected);
  });

  it('does not append workflowState — the prefix already says it', () => {
    expect(resultedActionLabel(resultedJob('notHit', 'resulted'))).not.toContain('|');
  });

  it.each(['completed', 'Completed', ' COMPLETED '])(
    'defers to the phrase book for status %p',
    (status) => {
      expect(resultedActionLabel(resultedJob(status, 'resulted'))).toBeNull();
    }
  );

  it('drops the qualifier when the status IS "resulted"', () => {
    // "Resulted - Resulted" is noise.
    expect(resultedActionLabel(resultedJob('resulted', 'Resulted'))).toBe('Resulted!');
  });

  it('falls back to workflowState when there is no status', () => {
    expect(resultedActionLabel(resultedJob(undefined, 'cantDoWork'))).toBe(
      'Resulted - Cant Do Work!'
    );
    expect(resultedActionLabel(resultedJob(undefined, 'resulted'))).toBe('Resulted!');
  });

  it('returns null when neither field is usable', () => {
    expect(resultedActionLabel(resultedJob(undefined, undefined))).toBeNull();
    expect(resultedActionLabel(resultedJob('  ', ''))).toBeNull();
  });
});

describe('resolveJobCardState — resulted card', () => {
  it('shows the outcome instead of "Completed Appointment"', () => {
    const state = resolveJobCardState(resultedJob('cantDoWork', 'resulted'));
    expect(state.actionLabel).toBe('Resulted - Cant Do Work!');
    expect(state.key).toBe('RESULTED');
    expect(state.color).toBe(JOB_CARD_COLORS.RESULTED);
  });

  it('reads "Completed Appointment" for a completed job, not the raw fields', () => {
    const state = resolveJobCardState(resultedJob('completed', 'resulted'));
    expect(state.actionLabel).toBeUndefined();
    expect(state.actionLabelKey).toBe('installer.completedAppointment');
  });

  it('falls back to the phrase book when the API sent no outcome', () => {
    const state = resolveJobCardState(resultedJob(undefined, undefined));
    expect(state.actionLabel).toBeUndefined();
    expect(state.actionLabelKey).toBe('installer.completedAppointment');
  });

  it('does not leak the outcome text over the loading label', () => {
    // A literal label outranks the key, so it has to be cleared mid-request or the
    // card would keep reading the outcome while it fetches.
    const state = resolveJobCardState(resultedJob('cantDoWork', 'resulted'), {
      loading: true,
    });
    expect(state.actionLabel).toBeUndefined();
    expect(state.actionLabelKey).toBe('common.loading');
  });

  it('leaves live jobs on their translated action labels', () => {
    const live = { _id: 'j', status: 'inProgress', workflowState: 'resume' } as InstallerJob;
    const state = resolveJobCardState(live);
    expect(state.actionLabel).toBeUndefined();
    expect(state.actionLabelKey).toBe('installer.resumeAppointment');
  });
});
