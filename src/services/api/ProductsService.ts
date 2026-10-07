import { AxiosResponse } from 'axios';
import api from './index';

export const ProductsEndpoints = {
  repList: '/products-rep',
} as const;

export const ProductsService = {
  getRepProducts: (): Promise<AxiosResponse<any>> => api.get(ProductsEndpoints.repList),
};

export default ProductsService;
