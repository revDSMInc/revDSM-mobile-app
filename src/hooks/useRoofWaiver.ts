import { useState, useMemo, useRef } from 'react';
import { PanResponder, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { FlashMessage } from '../config/message';

export const useRoofWaiver = (
  lead: any,
  onSubmit: (data: any) => void,
  onFinalUpload?: (pdfPath: string) => Promise<void>,
  onSuccess?: () => void
) => {
  const [formData, setFormData] = useState({
    firstName: lead?.customerDetails?.firstName || '',
    lastName: lead?.customerDetails?.lastName || '',
    phoneNumber: lead?.customerDetails?.phone || '',
    email: lead?.customerDetails?.email || '',
    leadId: lead?.leadId || 'N/A',
    repName: 'Firstrep',
    officeCode: '01',
    time: '12:00 AM',
    date: '05/01/2025',
    address: lead?.fullAddress || '',
    consent: false,
  });

  const [generatedPdf, setGeneratedPdf] = useState<string | null>(null);
  const [showSigPad, setShowSigPad] = useState(false);
  const [savedPaths, setSavedPaths] = useState<string[]>([]);
  const [livePaths, setLivePaths] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const currentPathRef = useRef('');

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          const path = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
          currentPathRef.current = path;
          setCurrentPath(path);
        },
        onPanResponderMove: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          const next = `${currentPathRef.current} L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
          currentPathRef.current = next;
          setCurrentPath(next);
        },
        onPanResponderRelease: () => {
          const finished = currentPathRef.current;
          if (finished) {
            setLivePaths((prev) => [...prev, finished]);
          }
          currentPathRef.current = '';
          setCurrentPath('');
        },
      }),
    []
  );

  const handleFinalSubmit = async () => {
    if (!formData.email || !formData.email.includes('@')) {
      FlashMessage.error('Validation Error', 'A valid email address is required.');
      return;
    }
    if (savedPaths.length === 0) {
      FlashMessage.error('Validation Error', 'Customer signature is required.');
      return;
    }

    try {
      const svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><svg width="500" height="200" viewBox="0 0 500 200" xmlns="http://www.w3.org/2000/svg">${savedPaths
        .map(
          (p) =>
            `<path d="${p}" stroke="black" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" />`
        )
        .join('')}</svg>`;
      const filePath = `${RNFS.CachesDirectoryPath}/waiver_sig_${Date.now()}.svg`;
      await RNFS.writeFile(filePath, svgContent, 'utf8');
      const signatureFile = {
        uri: Platform.OS === 'android' ? `file://${filePath}` : filePath,
        name: 'signature.svg',
        type: 'image/svg+xml',
      };
      const res = await onSubmit({
        fullName: `${formData.firstName} ${formData.lastName}`.trim(),
        phoneNumber: String(formData.phoneNumber),
        email: String(formData.email),
        leadId: String(lead?.leadId || ''),
        repName: String(formData.repName),
        officeCode: String(formData.officeCode),
        time: String(formData.time),
        date: String(formData.date),
        address: String(formData.address),
        type: 'digital',
        file: signatureFile,
        formType: 'roof_waiver',
        consent: 'true',
      });
      if (typeof res === 'string') {
        if (onFinalUpload) {
          await onFinalUpload(res);
        }
        if (onSuccess) {
          onSuccess();
        }
      }
    } catch (error: any) {
      FlashMessage.error(
        'Error',
        'Failed to save waiver signature: ' + (error?.message || 'Unknown error')
      );
    }
  };

  return {
    formData,
    setFormData,
    generatedPdf,
    setGeneratedPdf,
    showSigPad,
    setShowSigPad,
    savedPaths,
    setSavedPaths,
    livePaths,
    setLivePaths,
    currentPath,
    panResponder,
    handleFinalSubmit,
  };
};
