import React from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { AgreementBlockProps } from './types';

// Local, faithful copy of web `src/utils/format-time.js` formatDate — no mobile equivalent exists.
function formatDate(dateString: any): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

const cellStyle = {
  borderWidth: 1,
  borderColor: '#000',
  padding: 8,
} as const;

// Faithful port of web `blocks/pricing-table-block.js`.
// Contract price / start date / down payment / balance rows, optional CC + financing
// note, and (in web) an initials SignaturePad. On mobile the initials pad is replaced
// by an <Image> (when captured) or a "Tap to initial" area (onRequestInitials).
export default function PricingTableBlock({
  block,
  paymentDetails,
  initialsUri,
  onRequestInitials,
}: AgreementBlockProps) {
  const settings = block?.settings || {};

  return (
    <View style={{ marginVertical: 16 }}>
      {/* PRICING TABLE */}
      <View
        style={{
          borderWidth: 1,
          borderColor: '#000',
          marginBottom: 10,
        }}
      >
        {/* Row A: Contract Price + Approximate Start Date */}
        <View style={{ flexDirection: 'row' }}>
          <View style={[cellStyle, { flex: 1 }]}>
            <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#000' }}>
              A. Contract Price
            </Text>
          </View>
          <View style={[cellStyle, { flex: 1 }]}>
            <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#000' }}>
              {paymentDetails?.price}
            </Text>
          </View>
          <View style={[cellStyle, { flex: 1 }]}>
            <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#000' }}>
              Approximate Start Date
            </Text>
          </View>
          <View style={[cellStyle, { flex: 1 }]}>
            <Text style={{ fontSize: 10, color: '#000' }}>
              {formatDate(paymentDetails?.installDate) || 'TBD'}{' '}
              {paymentDetails?.installWindow ? `(${paymentDetails.installWindow})` : ''}
            </Text>
          </View>
        </View>

        {/* Down Payment row */}
        {settings.showDownPayment !== false && (
          <View style={{ flexDirection: 'row' }}>
            <View style={[cellStyle, { flex: 1 }]}>
              <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#000' }}>
                {settings.downPaymentLabel || 'Down Payment'} (
                {paymentDetails?.downPaymentMethod || 'N/A'})
              </Text>
            </View>
            <View style={[cellStyle, { flex: 1 }]}>
              <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#000' }}>
                {paymentDetails?.downPayment || '$0.00'}
              </Text>
            </View>
            <View style={[cellStyle, { flex: 2 }]}>
              <Text style={{ fontSize: 10, color: '#000' }}>Payment due upon completion</Text>
            </View>
          </View>
        )}

        {/* Balance row */}
        {settings.showBalance !== false && (
          <View style={{ flexDirection: 'row' }}>
            <View style={[cellStyle, { flex: 1 }]}>
              <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#000' }}>
                {settings.balanceLabel || 'Unpaid Balance'} (
                {paymentDetails?.balanceMethod || 'N/A'})
              </Text>
            </View>
            <View style={[cellStyle, { flex: 1 }]}>
              <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#000' }}>
                {paymentDetails?.balance || '$0.00'}
              </Text>
            </View>
            <View style={[cellStyle, { flex: 1 }]}>
              <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#000' }}>
                (6-digit auth) Plan#
              </Text>
            </View>
            <View style={[cellStyle, { flex: 1 }]}>
              {!!paymentDetails?.authNumber && (
                <Text style={{ fontSize: 10, color: '#000' }}>Auth: {paymentDetails.authNumber}</Text>
              )}
              {!!paymentDetails?.planNumber && (
                <Text style={{ fontSize: 10, color: '#000' }}>Plan: {paymentDetails.planNumber}</Text>
              )}
              {!!paymentDetails?.greenskyAppId && (
                <Text style={{ fontSize: 10, color: '#000' }}>
                  GS App ID: {paymentDetails.greenskyAppId}
                </Text>
              )}
              {!!paymentDetails?.greenskyShoppingPass && (
                <Text style={{ fontSize: 10, color: '#000' }}>
                  GS Pass: {paymentDetails.greenskyShoppingPass}
                </Text>
              )}
              {!!paymentDetails?.safeIdRecordNumber && (
                <Text style={{ fontSize: 10, color: '#000' }}>
                  Safe ID: {paymentDetails.safeIdRecordNumber}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Credit card last-4 row (colSpan 4) */}
        {settings.showCreditCardFields && paymentDetails?.ccLast4 && (
          <View style={{ flexDirection: 'row' }}>
            <View style={[cellStyle, { flex: 1 }]}>
              <Text style={{ fontSize: 9, color: '#000' }}>
                Last 4 digits CC: {paymentDetails.ccLast4}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Financing note */}
      {settings.showFinancingNote && paymentDetails?.financingNote && (
        <View style={{ marginVertical: 10 }}>
          <Text style={{ fontSize: 10, fontStyle: 'italic', fontWeight: 'bold', color: '#000' }}>
            {paymentDetails.financingNote}
          </Text>
        </View>
      )}

      {/* Initials area */}
      {settings.showInitials && (
        <View
          style={{
            marginVertical: 12,
            flexDirection: 'row',
            alignItems: 'flex-end',
            flexWrap: 'nowrap',
          }}
        >
          <View style={{ flexShrink: 1, marginRight: 8 }}>
            <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#000' }}>
              {settings.initialsLabel ||
                'For electronic payment of credit card, or financing, unpaid balance will be processed upon installation.'}
            </Text>
          </View>

          {settings?.initialsCanvas?.showCanvas && (
            <View style={{ width: 120, flexShrink: 0 }}>
              {initialsUri ? (
                <View
                  style={{
                    borderBottomWidth: 1,
                    borderColor: '#000',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    paddingBottom: 2,
                  }}
                >
                  <Image
                    source={{ uri: initialsUri }}
                    style={{ width: 200, height: 60, resizeMode: 'contain' }}
                  />
                </View>
              ) : (
                <TouchableOpacity
                  onPress={onRequestInitials}
                  style={{
                    borderWidth: 1,
                    borderColor: '#000',
                    height: 32,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 9, color: '#666' }}>Tap to initial</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
