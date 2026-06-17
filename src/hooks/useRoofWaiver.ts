import { useState, useMemo, useRef, useEffect } from 'react';
import { PanResponder, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { FlashMessage as GlobalFlashMessage } from '../config/message';
import { formatUSPhoneNumber } from '../utils/phone-util';
import { useAuth } from './useAuth';
import RNFlashMessage from 'react-native-flash-message';

const formatLeadTime = (leadTime: string) => {
  if (!leadTime || leadTime === 'N/A') return '';
  const timeStr = leadTime.toLowerCase().trim();
  const isPM = timeStr.includes('pm');
  const timeMatch = timeStr.match(/(\d+)/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    return `${displayHours.toString().padStart(2, '0')}:00 ${period}`;
  }
  return leadTime;
};

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
  onClose?: () => void,
  prefilledData?: any,
  flashRef?: React.RefObject<RNFlashMessage | null>
) => {
  const { user } = useAuth();

  const FlashMessage = {
    success: (title: string, description: string = '') => {
      if (flashRef?.current) {
        flashRef.current.showMessage({
          message: title,
          description,
          type: 'success',
          icon: 'success',
          duration: 3000,
          floating: true,
          style: { zIndex: 9999, elevation: 9999 },
        });
      } else {
        GlobalFlashMessage.success(title, description);
      }
    },
    error: (title: string, description: string = 'Something went wrong') => {
      if (flashRef?.current) {
        flashRef.current.showMessage({
          message: title,
          description,
          type: 'danger',
          icon: 'danger',
          duration: 4000,
          floating: true,
          style: { zIndex: 9999, elevation: 9999 },
        });
      } else {
        GlobalFlashMessage.error(title, description);
      }
    },
    show: (title: string, description: string = '', type: any = 'info') => {
      if (flashRef?.current) {
        flashRef.current.showMessage({
          message: title,
          description,
          type,
          icon: type,
          duration: 3000,
          floating: true,
          style: { zIndex: 9999, elevation: 9999 },
        });
      } else {
        GlobalFlashMessage.show(title, description, type);
      }
    },
  };

  const getInitialRepName = () => {
    return prefilledData?.repName ?? (user ? `${user.firstName} ${user.lastName}`.trim() : 'Firstrep');
  };

  const getInitialTime = () => {
    const rawTime = prefilledData?.time ?? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return rawTime.replace(/\u202f/g, ' ').replace(/\s+/g, ' ');
  };

  const getInitialDate = () => {
    if (prefilledData?.date) {
      const dateStr = prefilledData.date;
      if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
          const [yyyy, mm, dd] = parts;
          return `${mm}/${dd}/${yyyy}`;
        }
      } else if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const [part1, part2, part3] = parts;
          if (parseInt(part1, 10) > 12) {
            // It is DD/MM/YYYY, convert to MM/DD/YYYY
            return `${part2}/${part1}/${part3}`;
          } else {
            // Already MM/DD/YYYY or ambiguous
            return `${part1}/${part2}/${part3}`;
          }
        }
      }
      return prefilledData.date;
    }
    const targetDate = new Date();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const yyyy = targetDate.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  };

  const getInitialOfficeCode = () => {
    if (prefilledData?.officeCode) return prefilledData.officeCode;
    if (!user) return '01';
    if (user.officeCode) return user.officeCode;
    if (Array.isArray(user.office) && user.office[0]?.code) return user.office[0].code;
    if (user.office && typeof user.office === 'object') {
      if (user.office.code) return user.office.code;
      if (user.office.officeCode) return user.office.officeCode;
    }
    if (Array.isArray(user.office) && user.office[0]?.officeCode) return user.office[0].officeCode;
    if (user.officeId) return user.officeId;
    return '01';
  };

  const [formData, setFormData] = useState({
    firstName: prefilledData?.firstName ?? lead?.customerDetails?.firstName ?? '',
    lastName: prefilledData?.lastName ?? lead?.customerDetails?.lastName ?? '',
    phoneNumber: formatUSPhoneNumber(prefilledData?.phoneNumber ?? lead?.customerDetails?.phone ?? ''),
    email: prefilledData?.email ?? lead?.customerDetails?.email ?? '',
    leadId: prefilledData?.leadId ?? lead?.leadId ?? 'N/A',
    repName: getInitialRepName(),
    officeCode: getInitialOfficeCode(),
    time: getInitialTime(),
    date: getInitialDate(),
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
    if (user) {
      setFormData((prev) => ({
        ...prev,
        repName: prefilledData?.repName ?? `${user.firstName} ${user.lastName}`.trim(),
        officeCode: prefilledData?.officeCode ?? (() => {
          if (user.officeCode) return user.officeCode;
          if (Array.isArray(user.office) && user.office[0]?.code) return user.office[0].code;
          if (user.office && typeof user.office === 'object') {
            if (user.office.code) return user.office.code;
            if (user.office.officeCode) return user.office.officeCode;
          }
          if (Array.isArray(user.office) && user.office[0]?.officeCode) return user.office[0].officeCode;
          if (user.officeId) return user.officeId;
          return '01';
        })(),
      }));
    }
  }, [user, prefilledData]);

  useEffect(() => {
    if (prefilledData) {
      setFormData((prev) => ({
        ...prev,
        firstName: prefilledData.firstName ?? prev.firstName,
        lastName: prefilledData.lastName ?? prev.lastName,
        phoneNumber: formatUSPhoneNumber(prefilledData.phoneNumber ?? prev.phoneNumber),
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
    if (!formData.firstName || !formData.firstName.trim()) {
      FlashMessage.error('Validation Error', 'First name is required.');
      return;
    }
    if (!formData.phoneNumber || !formData.phoneNumber.replace(/\D/g, '')) {
      FlashMessage.error('Validation Error', 'Phone number is required.');
      return;
    }
    if (!formData.email || !formData.email.includes('@')) {
      FlashMessage.error('Validation Error', 'A valid email address is required.');
      return;
    }
    if (savedPaths.length === 0) {
      FlashMessage.error('Validation Error', 'Customer signature is required.');
      return;
    }

    try {
      // Use dynamic viewBox width/height matching the recorded layout coordinates to prevent clipping
      const svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><svg width="500" height="260" viewBox="0 0 320 260" xmlns="http://www.w3.org/2000/svg">${savedPaths
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
      const formatDateToYmd = (dateStr: string) => {
        if (!dateStr) return '';
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const [mm, dd, yyyy] = parts;
          return `${yyyy}-${mm}-${dd}`;
        }
        return dateStr;
      };

      const rawPhone = String(formData.phoneNumber).replace(/\D/g, '');
      const finalPhone = rawPhone.length === 11 && rawPhone.startsWith('1') ? rawPhone.slice(1) : rawPhone;

      const res = await onSubmit({
        fullName: `${formData.firstName} ${formData.lastName}`.trim(),
        phoneNumber: finalPhone,
        email: String(formData.email),
        leadId: String(lead?.leadId || ''),
        repName: String(formData.repName),
        officeCode: String(formData.officeCode),
        time: String(formData.time),
        date: formatDateToYmd(String(formData.date)),
        address: String(formData.address),
        type: submissionType,
        file: signatureFile,
      });
      if (typeof res === 'string') {
        if (onFinalUpload) {
          await onFinalUpload(res);
        }
        if (onClose) {
          onClose();
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
