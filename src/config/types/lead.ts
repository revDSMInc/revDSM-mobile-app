export type Lead = {
  _id: string;
  leadId?: string;
  leadCode?: string;
  title?: string;
  status?: string;
  createdAt?: string;
  fullAddress?: string;
  customerName?: string; // Fallback for some views
  address?: string; // Legacy/Mapped address
  customerDetails?: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    address?: string;
  };
  leadTime?: string;
  leadDate?: string;
  leadDatetime?: string;
  installationDate?: string;
  leadType?: 'selfGen' | 'lfLead' | string;
  workflowState?: 'preview' | 'resume' | 'complete' | string;
  isSelfGen?: boolean;
  selfGen?: boolean;
  lowesLead?: boolean;
  location?: {
    type: string;
    coordinates: [number, number];
  };
  images?: any[];
  salesPhotos?: any[];
  actionlogs?: any[];
  actionCounts?: {
    lead_check_in: number;
    lead_resume: number;
    lead_review: number;
  };
  price?: number;
  isFavourite?: boolean;
  jobNumber?: string;
  salesRepName?: string;
  userName?: string;
  firstName?: string;
  lastName?: string;
  generatedReports?: Array<{
    reportType: string;
    fileUrl: string;
    createdAt?: string;
  }>;
};
