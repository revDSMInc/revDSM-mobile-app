import {
  appointmentPhotoSendLabel,
  isAnnotatedSalesPhoto,
} from '../../src/utils/appointment-photo-labels';

// REVUIUX-563: annotated appointment photos must be recognisable in the Messages picker.

describe('isAnnotatedSalesPhoto', () => {
  it('recognises an annotated copy by its subcategory suffix', () => {
    expect(isAnnotatedSalesPhoto({ subcategory: 'Front (Annotated)' })).toBe(true);
    expect(isAnnotatedSalesPhoto({ subcategory: 'Order Sheet (Annotated)' })).toBe(true);
  });

  it('is case insensitive, as the suffix is written by several call sites', () => {
    expect(isAnnotatedSalesPhoto({ subcategory: 'Front (annotated)' })).toBe(true);
    expect(isAnnotatedSalesPhoto({ subcategory: 'Front (ANNOTATED)' })).toBe(true);
  });

  it('leaves the clean original alone', () => {
    expect(isAnnotatedSalesPhoto({ subcategory: 'Front' })).toBe(false);
    expect(isAnnotatedSalesPhoto({ subcategory: '' })).toBe(false);
    expect(isAnnotatedSalesPhoto({})).toBe(false);
    expect(isAnnotatedSalesPhoto(null)).toBe(false);
    expect(isAnnotatedSalesPhoto(undefined)).toBe(false);
  });
});

describe('appointmentPhotoSendLabel', () => {
  // The recipient sees only this text - there is no badge in the message bubble.
  it('marks an annotated photo in the label that is sent', () => {
    expect(appointmentPhotoSendLabel({ subcategory: 'Front (Annotated)' }, 'Front')).toBe(
      'Front (Annotated)'
    );
  });

  it('leaves a clean photo label untouched', () => {
    expect(appointmentPhotoSendLabel({ subcategory: 'Front' }, 'Front')).toBe('Front');
  });

  it('does not double up a suffix the resolved label already carries', () => {
    expect(
      appointmentPhotoSendLabel({ subcategory: 'Front (Annotated)' }, 'Front (Annotated)')
    ).toBe('Front (Annotated)');
  });

  it('still says something when the slot has no resolvable name', () => {
    expect(appointmentPhotoSendLabel({ subcategory: '(Annotated)' }, '')).toBe('Annotated');
    expect(appointmentPhotoSendLabel({ subcategory: 'Front' }, '')).toBe('');
  });
});
