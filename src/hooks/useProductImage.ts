import { useState, useCallback } from 'react';
import { LeadService } from '../services/api/leads';

export const useProductImage = (defaultProductName = 'gutter') => {
  const [image, setImage] = useState<{ color: string; imageUrl: string }>({
    color: '',
    imageUrl: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);

  const fetchProductImage = useCallback(
    async (colorCode: string, productNameOverride?: string) => {
      if (!colorCode) return;

      try {
        setLoading(true);
        setError(null);

        const productName = productNameOverride || defaultProductName;
        const response = await LeadService.getProductImage(productName, colorCode);

        const products = response?.data?.data?.products || [];
        const product = products.find((p: any) => p.colorCode === colorCode);

        if (!product?.bucketName || !product?.imagePath) {
          setImage({ color: colorCode, imageUrl: '' });
          return;
        }

        // Get secure link
        const secureResponse = await LeadService.getSecureUrls([
          {
            bucketName: product.bucketName,
            filePath: product.imagePath,
          },
        ]);

        const secureUrl = secureResponse?.data?.data?.[0]?.secureUrl || '';
        setImage({ color: colorCode, imageUrl: secureUrl });
      } catch (err) {
        console.error('[useProductImage] Failed:', err);
        setError(err);
        setImage({ color: '', imageUrl: '' });
      } finally {
        setLoading(false);
      }
    },
    [defaultProductName]
  );

  return {
    image,
    loading,
    error,
    fetchProductImage,
  };
};
