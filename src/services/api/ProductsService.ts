import { AxiosResponse } from 'axios';
import api from './index';

/**
 * ProductsService — the company's published product list.
 *
 * Mirrors the web reference (`src/api/products-rep.js` + `endpoints.productsRep.list`):
 *   GET /products-rep  ->  { data: [{ name, ... }, ...] }
 *
 * Company-scoped (resolved from the JWT). Deliberately separate from the
 * calculator-form-schemas fetch, which returns the same products joined to their
 * full schemas and pricing — far more than customer-facing copy needs. Use this
 * when you only need to say what the company installs.
 */
export const ProductsEndpoints = {
  repList: '/products-rep',
} as const;

export const ProductsService = {
  getRepProducts: (): Promise<AxiosResponse<any>> => api.get(ProductsEndpoints.repList),
};

export default ProductsService;
