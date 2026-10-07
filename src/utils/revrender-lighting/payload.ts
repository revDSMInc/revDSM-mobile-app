import { Look } from './types';

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
      lookGroup: look.group,
      colors: look.colors,
    },
    viewLabel: ctx.viewLabel,
    leadId: ctx.leadId,
    jobId: ctx.leadId,
  };
}

export function toBatchBody(looks: Look[], ctx: PhotoContext) {
  return {
    payloads: looks.map((l) => toLookPayload(l, ctx)),
    leadId: ctx.leadId,
    jobId: ctx.leadId,
  };
}
