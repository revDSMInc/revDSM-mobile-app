import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import type { Lead } from '../../../../config/types/lead';

const CARD_COLORS: Record<string, string> = {
  ACTIVE: '#FF6B35',    // Orange
  PROGRESS: '#6FCF97',  // Green 
  OFFSITE: '#9E9E9E',   // Gray
  UPCOMING: '#2196F3',  // Blue
};

interface LeadCardProps {
  lead: Lead;
  colors: any;
  isDark: boolean;
  isTomorrow?: boolean;
  isArchived?: boolean;
  onPress?: () => void;
  onActionPress?: () => void;
  actionLoading?: boolean;
}

export function LeadCard({ 
  lead, 
  colors, 
  isDark, 
  isTomorrow, 
  isArchived, 
  onPress, 
  onActionPress,
  actionLoading 
}: LeadCardProps) {
  
  const isSelfGen = !!(lead.isSelfGen || lead.selfGen || lead.leadType?.includes('self'));
  const isInRange = true; 

  const getScheduledDateTime = () => {
    if (!lead.leadTime || !lead.leadDate) return null;
    try {
      const timeStr = lead.leadTime.toLowerCase().trim();
      const isPM = timeStr.includes('pm');
      const timeMatch = timeStr.match(/(\d+)/);
      if (!timeMatch) return null;
      let hours = parseInt(timeMatch[1], 10);
      if (isPM && hours !== 12) hours += 12;
      else if (!isPM && hours === 12) hours = 0;
      const baseDate = new Date(lead.leadDate);
      return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hours, 0, 0);
    } catch { return null; }
  };

  const isWithinTimeWindow = () => {
    const scheduled = getScheduledDateTime();
    if (!scheduled) return true;
    const now = new Date().getTime();
    return now >= scheduled.getTime() - (15 * 60 * 1000) && now <= scheduled.getTime() + (60 * 60 * 1000);
  };

  const isBeforeTimeWindow = () => {
    const scheduled = getScheduledDateTime();
    if (!scheduled) return false;
    return new Date().getTime() < scheduled.getTime() - (15 * 60 * 1000);
  };

  const getStatusInfo = () => {
    if (isTomorrow) return { status: 'UPCOMING', color: CARD_COLORS.UPCOMING, buttonText: 'Preview Appointment', disabled: true, label: 'UPCOMING' };
    if (isArchived) return { status: 'OFFSITE', color: CARD_COLORS.OFFSITE, buttonText: 'Review Appointment', disabled: false, label: 'ARCHIVED' };
    
    if (isBeforeTimeWindow() && !isSelfGen) return { status: 'UPCOMING', color: CARD_COLORS.UPCOMING, buttonText: 'Preview Appointment', disabled: true, label: 'UPCOMING' };
    if (lead.workflowState === 'resume') return { status: 'PROGRESS', color: CARD_COLORS.PROGRESS, buttonText: 'Resume Appointment', disabled: false, label: 'IN PROGRESS' };
    if (isInRange && (isSelfGen || isWithinTimeWindow())) return { status: 'ACTIVE', color: CARD_COLORS.ACTIVE, buttonText: 'Start Appointment', disabled: false, label: 'ON-SITE' };
    
    return { status: 'OFFSITE', color: CARD_COLORS.OFFSITE, buttonText: 'Review Appointment', disabled: false, label: 'OFF-SITE' };
  };

  const statusInfo = getStatusInfo();
  const contactName = `${lead.customerDetails?.firstName || ''} ${lead.customerDetails?.lastName || ''}`.trim() || 'No Name';
  const address = lead.fullAddress || lead.customerDetails?.address || 'No Address';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className="rounded-2xl p-4 mb-4 border-l-[6px] shadow-sm"
      style={{ 
        backgroundColor: isDark ? colors.surface : colors.card, 
        borderLeftColor: statusInfo.color,
        borderColor: statusInfo.color,
        borderWidth: 1
      }}
    >
      <View className="flex-row justify-between mb-3">
        <View className="flex-1">
          <Text className="text-base font-bold" style={{ color: colors.text }}>{contactName}</Text>
          <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>ID: {lead.leadId || lead._id.slice(-6).toUpperCase()}</Text>
        </View>
        <View 
          className="px-2 py-1 rounded-md border" 
          style={{ backgroundColor: statusInfo.color + (isDark ? '20' : '15'), borderColor: statusInfo.color }}
        >
          <Text className="text-[10px] font-extrabold" style={{ color: statusInfo.color }}>{statusInfo.label}</Text>
        </View>
      </View>

      <View className="mb-4">
        <Text className="text-[13px] leading-5" style={{ color: colors.textSecondary }} numberOfLines={2}>📍 {address}</Text>
      </View>

      <View className="flex-row justify-between items-center pt-3 border-t border-[#919EAB30]">
        <View>
          <Text className="text-[9px] font-extrabold" style={{ color: colors.textSecondary }}>TIME</Text>
          <Text className="text-[13px] font-semibold" style={{ color: colors.text }}>{lead.leadTime || (isSelfGen ? 'Self Gen' : 'N/A')}</Text>
        </View>
        <TouchableOpacity 
          disabled={statusInfo.disabled || actionLoading}
          onPress={(e: any) => {
            e.stopPropagation();
            onActionPress?.();
          }}
          className="px-3 py-2 rounded-lg min-w-[120px] items-center"
          style={{ backgroundColor: statusInfo.disabled ? colors.textSecondary + '40' : statusInfo.color }}
        >
          {actionLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-white text-[11px] font-bold">{statusInfo.buttonText}</Text>
          )}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}
