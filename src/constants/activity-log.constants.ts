export const LOG_ACTIONS = {
  VIEW: 'view',
  OPEN: 'open',
  CLOSE: 'close',
  CLICK: 'click',
  SELECT: 'select',
  TOGGLE: 'toggle',
  NAVIGATE: 'navigate',
  ADD: 'add',
  CREATE: 'create',
  UPDATE: 'update',
  CHANGE: 'change',
  DELETE: 'delete',
  SUBMIT: 'submit',
  SAVE: 'save',
  START: 'start',
  PAUSE: 'pause',
  PREVIEW: 'preview',
  SEND: 'send',
  RESET: 'reset',
  APPLY: 'apply',
} as const;

export type LogAction = (typeof LOG_ACTIONS)[keyof typeof LOG_ACTIONS];

export const INSTALLER_MODULES = {
  DASHBOARD: 'installer_dashboard',
  JOB_CHECK_IN: 'job_check_in',
  JOB_SESSION: 'job_session',
  JOB_RESUME: 'job_resume',
  JOB: 'installer_job',
  RESULT: 'installer_result',
} as const;

export type InstallerModule = (typeof INSTALLER_MODULES)[keyof typeof INSTALLER_MODULES];

export const INSTALLER_STEP_MODULES = {
  pickup: 'pickup',
  pec: 'pre_existing_conditions',
  pre: 'pre_install_photos',
  measure: 'verify_jobs',
  post: 'post_install_photos',
  coc: 'coc',
  return: 'return',
} as const;

export type InstallerStepModule =
  (typeof INSTALLER_STEP_MODULES)[keyof typeof INSTALLER_STEP_MODULES];

export const SYSTEM_MODULE = 'system';

export const INVESTMENT_CENTER_MODULE = 'investment_center';

export const RESULT_LEAD_MODULE = 'result_lead';

export const FUNDING_MODULE = 'funding';

export const FUNDING_SOURCES = {
  REHASH: 'rehash',
  SALE: 'sale',
  MY_DEALS: 'my_deals',
} as const;

export type FundingSource = (typeof FUNDING_SOURCES)[keyof typeof FUNDING_SOURCES];
