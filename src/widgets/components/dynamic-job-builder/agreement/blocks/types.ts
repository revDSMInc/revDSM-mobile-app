export interface AgreementBlockProps {
  block: any;               // config block: { type, title, content, order, enabled, settings }
  customerDetails?: any;    // { name, address, phone, email, ... }
  jobDetails?: any;         // { jobNumber, officeCode, jobDisplay }
  paymentDetails?: any;     // { price, downPayment, downPaymentMethod, balance, balanceMethod, installDate, installWindow, financing... }
  jobScope?: string[];      // "Description of Work" lines
  contractorName?: string;
  formattedDate?: string;
  signatureUri?: string | null;  // captured buyer-signature image data-uri (render with <Image>)
  initialsUri?: string | null;   // captured buyer-initials image data-uri
  onRequestSignature?: () => void; // called when the user taps the signature area
  onRequestInitials?: () => void;  // called when the user taps the initials area
  leadId?: string;
  user?: any;
  logEvent?: (eventType: string, details: any) => void;
}
