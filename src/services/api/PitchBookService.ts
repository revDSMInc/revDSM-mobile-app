import { AxiosResponse } from 'axios';
import api from './index';

export const PitchBookEndpoints = {
  salesRep: '/pitch-books/sales-rep',
  salesRepDetail: (bookId: string) => `/pitch-books/sales-rep/${encodeURIComponent(bookId)}`,
} as const;

export const PitchBookService = {
  getPitchBooks: (documentType?: string): Promise<AxiosResponse<any>> =>
    api.get(
      documentType
        ? `${PitchBookEndpoints.salesRep}?documentType=${encodeURIComponent(documentType)}`
        : PitchBookEndpoints.salesRep
    ),

  getPitchBook: (bookId: string): Promise<AxiosResponse<any>> =>
    api.get(PitchBookEndpoints.salesRepDetail(bookId)),
};

export default PitchBookService;
