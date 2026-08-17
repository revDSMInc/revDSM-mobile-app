import React from 'react';
import { View, Text } from 'react-native';

/**
 * Page-level deal status — adapted from web `src/sections/deal/components/deal-banners.js`.
 *
 * Web renders it from `job-capture-images-view.js` (its Lead Center) gated on `isDeal`,
 * and `lead-center-tabs.js` places it "under the tab bar and above every tab", so it is
 * page-level status visible on Job docs AND Tools rather than part of the contract card.
 *
 * ⚠️ **DELIBERATE DIVERGENCE: web's pending-addendum bar is NOT rendered here.**
 * Web shows two independent indicators for one fact — this bar AND the Contract Details
 * card's own amber header — and on mobile that read as saying the same thing twice in
 * half a screen. Requested design decision: ONE pending indicator, and it is the card
 * header (`ContractDetailsCard`), which already carries the exact amber →
 * `✓ SALE - LEAD RESULTED` green transition the customer's approval flips. See
 * `hasPendingDraft` in `utils/addendum-drafts.ts` for what drives it.
 *
 * The cancelled bar stays: nothing else on the screen reports it, and a cancelled deal
 * would otherwise still show a green "LEAD RESULTED" header.
 */

interface DealBannersProps {
  lead: any;
}

export const DealBanners = ({ lead }: DealBannersProps) => {
  const status = String(lead?.result || lead?.status || '');
  const isCancelled = status.toLowerCase() === 'cancelled';

  if (!isCancelled) return null;

  return (
    <View className="px-4 mb-2" style={{ marginTop: 6 }}>
      <View className="bg-[#B91C1C] rounded-xl py-3 px-4 items-center justify-center">
        <Text className="text-white font-extrabold text-xs tracking-wider">JOB CANCELLED</Text>
      </View>
    </View>
  );
};

export default DealBanners;
