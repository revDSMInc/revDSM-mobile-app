import { useState, useMemo, useRef, useEffect } from 'react';
import { PanResponder, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { FlashMessage } from '../config/message';
import { launchImageLibrary } from 'react-native-image-picker';
import { useUploadPaperConsentOCRMutation } from './useLeadMutation';
import { formatUSPhoneNumber } from '../utils/phone-util';

const normalizeOcrDate = (input: string) => {
  if (!input) return '';
  const s = String(input).trim().replace(/[-.]/g, '/');
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const mm = String(parseInt(m[1], 10)).padStart(2, '0');
    const dd = String(parseInt(m[2], 10)).padStart(2, '0');
    const y = m[3];
    const yyyy = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
    return `${mm}/${dd}/${yyyy}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }
  return s;
};

export const useRoofWaiver = (
  lead: any,
  onSubmit: (data: any) => void,
  onFinalUpload?: (pdfPath: string) => Promise<void>,
  onSuccess?: () => void,
  prefilledData?: any
) => {
  const [formData, setFormData] = useState({
    firstName: prefilledData?.firstName ?? lead?.customerDetails?.firstName ?? '',
    lastName: prefilledData?.lastName ?? lead?.customerDetails?.lastName ?? '',
    phoneNumber: prefilledData?.phoneNumber ?? lead?.customerDetails?.phone ?? '',
    email: prefilledData?.email ?? lead?.customerDetails?.email ?? '',
    leadId: prefilledData?.leadId ?? lead?.leadId ?? 'N/A',
    repName: 'Firstrep',
    officeCode: '01',
    time: '12:00 AM',
    date: prefilledData?.date ?? '05/01/2025',
    address: lead?.fullAddress || '',
    consent: false,
  });

  const [generatedPdf, setGeneratedPdf] = useState<string | null>(null);
  const [showSigPad, setShowSigPad] = useState(false);
  const [savedPaths, setSavedPaths] = useState<string[]>([]);
  const [livePaths, setLivePaths] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const currentPathRef = useRef('');
  const [submissionType, setSubmissionType] = useState<'digital' | 'paper'>(
    prefilledData ? 'paper' : 'digital'
  );

  useEffect(() => {
    if (prefilledData) {
      setFormData((prev) => ({
        ...prev,
        firstName: prefilledData.firstName ?? prev.firstName,
        lastName: prefilledData.lastName ?? prev.lastName,
        phoneNumber: prefilledData.phoneNumber ?? prev.phoneNumber,
        email: prefilledData.email ?? prev.email,
        leadId: prefilledData.leadId ?? prev.leadId,
        date: prefilledData.date ?? prev.date,
      }));
      setSubmissionType('paper');
    }
  }, [prefilledData]);

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
        type: submissionType,
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

  const clearSig = () => {
    setLivePaths([]);
    setCurrentPath('');
    currentPathRef.current = '';
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
    submissionType,
    setSubmissionType,
    clearSig,
  };
};
