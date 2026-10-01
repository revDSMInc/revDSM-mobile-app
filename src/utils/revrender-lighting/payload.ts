import { Look } from './types';

/**
 * The wire payload for one lighting render.
 *
 * Matches the backend contract: renderType 'look', and nothing about mounting,
 * channel colour or time of day — those are fixed server-side under 483 and are
 * REJECTED if sent, so a future spec change cannot pass unnoticed.
 *
 * Deliberately NOT sent: prompt (the backend builds it), houseDimensions (the
 * backend reads the real pixel size off the photo, which also handles EXIF
 * rotation that a client would get wrong).
 */
export interface LookRenderPayload {
  renderType: 'look';
  houseImageUrl: string;
  houseMimeType: string;
  selections: {
    lookId: string;
    lookName: string;
    lookGroup: Look['group'];
    colors: string[];
  };
  viewLabel: string;
  leadId: string;
  jobId: string;
}

export interface PhotoContext {
  houseImageUrl: string;
  viewLabel: string;
  leadId: string;
}

export function toLookPayload(look: Look, ctx: PhotoContext): LookRenderPayload {
  return {
    renderType: 'look',
    houseImageUrl: ctx.houseImageUrl,
    houseMimeType: 'image/jpeg',
    selections: {
      lookId: look.id,
      lookName: look.name,
      // Decides whether the name may reach the image model: team, theme and
      // custom names never do — colours only, since the catalogue carries 268
      // club names plus Marvel and DC. Omitting the group makes the server
      // withhold the name, which is safe but loses seasonal art direction.
      lookGroup: look.group,
      colors: look.colors,
    },
    viewLabel: ctx.viewLabel,
    leadId: ctx.leadId,
    jobId: ctx.leadId,
  };
}

/** One queue item = one payload = one render = one job. */
export function toBatchBody(looks: Look[], ctx: PhotoContext) {
  return {
    payloads: looks.map((l) => toLookPayload(l, ctx)),
    leadId: ctx.leadId,
    jobId: ctx.leadId,
  };
}
