import React from 'react';
import { View, Text } from 'react-native';
import { AgreementBlockProps } from './types';

export default function BuyerInfoTableBlock({
  block,
  customerDetails,
  jobDetails,
  formattedDate,
}: AgreementBlockProps) {
  const rows: any[] = block?.settings?.rows || [];

  if (!rows.length) return null;

  const dataMap: Record<string, string> = {
    name: customerDetails?.name || '',
    jobNumber: jobDetails?.jobDisplay || jobDetails?.jobNumber || 'N/A',
    date: formattedDate || '',
    address: customerDetails?.address || '',
    phone: customerDetails?.phone || '',
    email: customerDetails?.email || '',
  };

  return (
    <View style={{ marginVertical: 16 }}>
      {rows.map((row: any[], rowIndex: number) => (
        <View
          key={rowIndex}
          style={{
            flexDirection: 'row',
            marginBottom: 2,
          }}
        >
          {row.map((cell: any, cellIndex: number) => (
            <React.Fragment key={`${rowIndex}-${cellIndex}`}>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: '#000',
                  paddingVertical: 4,
                  paddingHorizontal: 6,
                  backgroundColor: '#f0f0f0',
                  width: cell.width ? (`${cell.width}%` as any) : undefined,
                }}
              >
                <Text style={{ fontWeight: 'bold', fontSize: 9, color: '#000' }}>
                  {cell.label}
                </Text>
              </View>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: '#000',
                  paddingVertical: 4,
                  paddingHorizontal: 6,
                  backgroundColor: '#fff',
                  flex: 1,
                }}
              >
                <Text style={{ fontSize: 9, color: '#000' }}>
                  {dataMap[cell.key] || ''}
                </Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      ))}
    </View>
  );
}
