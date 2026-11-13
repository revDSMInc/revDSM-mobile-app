import * as fs from 'fs';
import * as path from 'path';

describe('Android deep link revapp://leads/123', () => {
  it('registers a VIEW intent-filter for the revapp scheme on MainActivity', () => {
    const manifest = fs.readFileSync(
      path.join(__dirname, '..', 'android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toMatch(/android:name="android\.intent\.action\.VIEW"/);
    expect(manifest).toMatch(/android:scheme="revapp"/);
  });
});
