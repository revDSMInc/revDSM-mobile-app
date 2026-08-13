import React from 'react';
import { View, Text } from 'react-native';

/**
 * The two status banners a deal can carry — a faithful port of web
 * `src/sections/deal/components/deal-banners.js`.
 *
 * Web renders these from `job-capture-images-view.js` (the Lead Center) gated on
 * `isDeal`, and its `lead-center-tabs.js` places them "under the tab bar and above
 * every tab" — so they are page-level status, visible on Job docs AND Tools, not
 * part of the contract card.
 *
 * ⚠️ This is NOT the same thing as `ContractDetailsCard`'s `showPendingDraft`
 * header, and neither replaces the other. That one reads `lead/v1/{id}/draft` (the
 * remote-signature draft an EditContractDetails save creates) and swaps the card's
 * own green header; this one reads `lead/v1/{id}/job-builder-drafts` (ADDENDUMS)
 * and sits above the card while its green header stays green — exactly as in the
 * web screenshot, where both bars are visible at once.
 */

const isPending = (draft: any) => String(draft?.status || '').toLowerCase() === 'pending';

interface DealBannersProps {
  lead: any;
  drafts?: any[];
}

export const DealBanners = ({ lead, drafts = [] }: DealBannersProps) => {
  const status = String(lead?.result || lead?.status || '');
  const isCancelled = status.toLowerCase() === 'cancelled';
  const pendingCount = (drafts || []).filter(isPending).length;

  if (!isCancelled && pendingCount === 0) return null;

  return (
    <View className="px-4 mb-2">
      {isCancelled && (
        <View className="bg-[#B91C1C] rounded-xl py-3 px-4 items-center justify-center mb-2">
          <Text className="text-white font-extrabold text-xs tracking-wider">JOB CANCELLED</Text>
        </View>
      )}

      {pendingCount > 0 && (
        <View className="bg-[#F4B400] rounded-xl py-3 px-4 items-center justify-center">
          <Text className="text-black font-extrabold text-xs tracking-wider text-center">
            {`PENDING ADDENDUM${pendingCount > 1 ? 'S' : ''} - AWAITING CUSTOMER SIGNATURE`}
          </Text>
          <Text className="text-black font-semibold text-[11px] text-center mt-0.5">
            {`${pendingCount} addendum${pendingCount > 1 ? 's' : ''} awaiting customer approval`}
          </Text>
        </View>
      )}
    </View>
  );
};

export default DealBanners;
