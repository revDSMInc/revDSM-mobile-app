import {
  MAX_LOOKUP_PASSES,
  buildPhotoLogDetails,
  photoLogReady,
  removePending,
  upsertPending,
  PendingPhotoLog,
} from '../../src/utils/pending-photo-log';

const base: PendingPhotoLog = {
  id: 'p1', userId: 'u1', leadId: 'l1', categoryName: 'Roof', subcategory: 'Front',
  timestamp: '2026-10-29T10:00:00.000Z', coordinates: { latitude: 1, longitude: 2 },
  existingUrls: [], s3url: '', bucketName: '', lookups: 0,
};

describe('pending photo log', () => {
  it('waits for the image url, then is ready', () => {
    expect(photoLogReady(base)).toBe(false);
    expect(photoLogReady({ ...base, s3url: 'a/b.jpg' })).toBe(true);
  });
  it('is released without an image after the last pass, never dropped', () => {
    expect(photoLogReady({ ...base, lookups: MAX_LOOKUP_PASSES })).toBe(true);
  });
  it('keeps the capture time as occurredAt', () => {
    expect(buildPhotoLogDetails(base).meta.occurredAt).toBe(base.timestamp);
  });
  it('annotated photos use their own module/action', () => {
    const d = buildPhotoLogDetails({ ...base, subcategory: 'Front (Annotated)' });
    expect(d.module_type).toBe('annotated_photos');
    expect(d.meta.action).toBe('annotated_photo_uploaded');
  });
  it('upsert replaces by id, remove deletes', () => {
    const list = upsertPending(upsertPending([], base), { ...base, lookups: 2 });
    expect(list).toHaveLength(1);
    expect(list[0].lookups).toBe(2);
    expect(removePending(list, 'p1')).toHaveLength(0);
  });
});

import { uploadProgress, shouldShowUploadNotification } from '../../src/utils/background-upload-policy';
describe('upload notification progress', () => {
  it('fills as items finish', () => {
    expect(uploadProgress(45, 45)).toEqual({ max: 45, current: 0 });
    expect(uploadProgress(45, 30)).toEqual({ max: 45, current: 15 });
    expect(uploadProgress(45, 0)).toEqual({ max: 45, current: 45 });
  });
  it('grows the range when work is added mid-run and never goes negative', () => {
    expect(uploadProgress(10, 14)).toEqual({ max: 14, current: 0 });
    expect(uploadProgress(0, 0).max).toBe(1);
  });
  it('shows nothing at zero', () => {
    expect(shouldShowUploadNotification(0)).toBe(false);
    expect(shouldShowUploadNotification(3)).toBe(true);
  });
});
