/**
 * The on-screen angle of the Footsteps map's blue heading cone (REVUIUX-593).
 *
 * The compass gives degrees clockwise from true NORTH, but the cone is a React Native view drawn
 * over the map, so `rotate` is measured from the top of the SCREEN. The two only agree while north
 * is up. Once the map is rotated by `mapBearing`, north on screen has moved by `-mapBearing`.
 *
 * Client: *"I'm literally spinning the map but the blue vision is moving too and I'm not moving my
 * phone at all"*. On screen the cone stayed still while the ground turned under it, so it pointed
 * at a different building.
 *
 * Returns degrees in [0, 360). Pure and RN-free so it can be tested here (CLAUDE.md section 6).
 */
export const coneRotationDeg = (heading: number | null | undefined, mapBearing: number): number => {
  const h = Number(heading);
  const b = Number(mapBearing);
  const angle = (Number.isFinite(h) ? h : 0) - (Number.isFinite(b) ? b : 0);
  return ((angle % 360) + 360) % 360;
};
