import { coneRotationDeg } from '../../src/utils/zone-heading';

describe('coneRotationDeg - the cone keeps pointing at the same place on the ground', () => {
  it('is the compass heading while north is up', () => {
    expect(coneRotationDeg(45, 0)).toBe(45);
  });

  it('takes off the map rotation', () => {
    expect(coneRotationDeg(45, 30)).toBe(15);
  });

  it('points at screen top when the map is rotated to match the phone', () => {
    expect(coneRotationDeg(120, 120)).toBe(0);
  });

  it('wraps below zero', () => {
    expect(coneRotationDeg(10, 30)).toBe(340);
  });

  it('wraps at a full turn', () => {
    expect(coneRotationDeg(350, 350 - 360)).toBe(0);
    expect(coneRotationDeg(360, 0)).toBe(0);
  });

  it('spinning the map a full turn lands back on the same angle', () => {
    expect(coneRotationDeg(45, 360)).toBe(coneRotationDeg(45, 0));
  });

  it('is safe on missing values', () => {
    expect(coneRotationDeg(null, 0)).toBe(0);
    expect(coneRotationDeg(45, NaN)).toBe(45);
  });
});
