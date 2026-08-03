import React from 'react';
import { AgreementBlockProps } from './types';
import TitleBlock from './TitleBlock';
import ParagraphBlock from './ParagraphBlock';
import BuyerInfoTableBlock from './BuyerInfoTableBlock';
import WorkDescriptionBlock from './WorkDescriptionBlock';
import PricingTableBlock from './PricingTableBlock';
import TermsBlock from './TermsBlock';
import SignatureSectionBlock from './SignatureSectionBlock';

export type { AgreementBlockProps } from './types';

export {
  TitleBlock,
  ParagraphBlock,
  BuyerInfoTableBlock,
  WorkDescriptionBlock,
  PricingTableBlock,
  TermsBlock,
  SignatureSectionBlock,
};

export const BLOCK_RENDERERS: Record<string, React.ComponentType<AgreementBlockProps>> = {
  title: TitleBlock,
  paragraph: ParagraphBlock,
  'buyer-info-table': BuyerInfoTableBlock,
  'work-description': WorkDescriptionBlock,
  'pricing-table': PricingTableBlock,
  terms: TermsBlock,
  'signature-section': SignatureSectionBlock,
};
