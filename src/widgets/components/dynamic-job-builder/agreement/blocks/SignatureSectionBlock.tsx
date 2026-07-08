import React from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { AgreementBlockProps } from './types';

// Web uses a cursive font for the typed (non-canvas) signature. RN has no bundled
// cursive font here, so we approximate with italic styling.
const SIGNATURE_TEXT_STYLE = {
  fontSize: 20,
  fontStyle: 'italic' as const,
  color: '#2c3e50',
};

interface SignatureRowProps {
  label: string;
  printedName?: string;
  showCanvas: boolean;
  formattedDate?: string;
  signatureUri?: string | null;
  onRequestSignature?: () => void;
}

// Faithful port of the web `SignatureRow` sub-component.
// Three cells: Print Name (40%), Signature (40%), Date (20%).
function SignatureRow({
  label,
  printedName,
  showCanvas,
  formattedDate,
  signatureUri,
  onRequestSignature,
}: SignatureRowProps) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {/* Print Name cell */}
      <View style={{ flex: 2, padding: 8, alignItems: 'center' }}>
        <Text style={{ fontWeight: 'bold', fontSize: 10, marginBottom: 8, color: '#000' }}>
          {label}
        </Text>
        <View
          style={{
            borderBottomWidth: 1,
            borderColor: '#000',
            height: 30,
            width: '100%',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingBottom: 2,
            marginBottom: 5,
          }}
        >
          <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#000' }}>{printedName}</Text>
        </View>
        <Text style={{ fontSize: 8, color: '#666' }}>Print Name</Text>
      </View>

      {/* Signature cell */}
      <View style={{ flex: 2, padding: 8, alignItems: 'center' }}>
        {showCanvas ? (
          signatureUri ? (
            <View
              style={{
                borderBottomWidth: 1,
                borderColor: '#000',
                width: '100%',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingBottom: 2,
                marginBottom: 5,
              }}
            >
              <Image
                source={{ uri: signatureUri }}
                style={{ width: 200, height: 60, resizeMode: 'contain' }}
              />
            </View>
          ) : (
            <TouchableOpacity
              onPress={onRequestSignature}
              style={{
                borderWidth: 1,
                borderColor: '#000',
                height: 40,
                width: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 5,
              }}
            >
              <Text style={{ fontSize: 9, color: '#666' }}>Tap to sign</Text>
            </TouchableOpacity>
          )
        ) : (
          <View
            style={{
              height: 40,
              width: '100%',
              borderBottomWidth: 1,
              borderColor: '#000',
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingBottom: 2,
              marginBottom: 5,
            }}
          >
            <Text style={SIGNATURE_TEXT_STYLE}>{printedName}</Text>
          </View>
        )}
        <Text style={{ fontSize: 8, color: '#666' }}>Signature</Text>
      </View>

      {/* Date cell */}
      <View style={{ flex: 1, padding: 8, alignItems: 'center' }}>
        <View
          style={{
            borderBottomWidth: 1,
            borderColor: '#000',
            height: 30,
            width: '100%',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingBottom: 2,
            marginBottom: 5,
          }}
        >
          <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#000' }}>{formattedDate}</Text>
        </View>
        <Text style={{ fontSize: 8, color: '#666' }}>Date</Text>
      </View>
    </View>
  );
}

// Faithful port of web `blocks/signature-section-block.js`.
// Contractor / Buyer / Co-Buyer signature rows + optional initials label.
// Both contractor and buyer rows share the same captured buyer signature (as in web).
export default function SignatureSectionBlock({
  block,
  customerDetails,
  contractorName,
  formattedDate,
  signatureUri,
  onRequestSignature,
}: AgreementBlockProps) {
  const settings = block?.settings || {};
  const showContractor = settings.showContractor !== false;
  const showBuyer = settings.showBuyer !== false;
  const showCoBuyer = settings.showCoBuyer || false;
  const showInitials = settings.showInitials || false;

  const buyerSignature = settings.buyerSignature || {};
  const contractorSignature = settings.contractorSignature || {};

  return (
    <View style={{ marginVertical: 16, width: '100%' }}>
      {showContractor && (
        <View style={{ marginBottom: 15 }}>
          <SignatureRow
            label={settings.contractorLabel || 'CONTRACTOR'}
            printedName={contractorName}
            showCanvas={contractorSignature.showCanvas || false}
            formattedDate={formattedDate}
            signatureUri={signatureUri}
            onRequestSignature={onRequestSignature}
          />
        </View>
      )}

      {showBuyer && (
        <View style={{ marginBottom: 15 }}>
          <SignatureRow
            label={settings.buyerLabel || 'Buyers'}
            printedName={customerDetails?.name}
            showCanvas={buyerSignature.showCanvas !== false}
            formattedDate={formattedDate}
            signatureUri={signatureUri}
            onRequestSignature={onRequestSignature}
          />
        </View>
      )}

      {showCoBuyer && (
        <View style={{ marginBottom: 15, flexDirection: 'row' }}>
          <View style={{ flex: 2, padding: 8, alignItems: 'center' }}>
            <Text style={{ fontWeight: 'bold', fontSize: 10, marginBottom: 8, color: '#000' }}>
              Co-Buyer
            </Text>
            <View style={{ borderBottomWidth: 1, borderColor: '#000', height: 30, width: '100%' }} />
            <Text style={{ fontSize: 8, color: '#666' }}>Print Name</Text>
          </View>
          <View style={{ flex: 2, padding: 8, alignItems: 'center' }}>
            <View style={{ borderBottomWidth: 1, borderColor: '#000', height: 40, width: '100%' }} />
            <Text style={{ fontSize: 8, color: '#666' }}>Signature</Text>
          </View>
          <View style={{ flex: 1, padding: 8, alignItems: 'center' }}>
            <View style={{ borderBottomWidth: 1, borderColor: '#000', height: 30, width: '100%' }} />
            <Text style={{ fontSize: 8, color: '#666' }}>Date</Text>
          </View>
        </View>
      )}

      {showInitials && settings.initialsLabel && (
        <View style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#000' }}>
            {settings.initialsLabel}
          </Text>
        </View>
      )}
    </View>
  );
}
