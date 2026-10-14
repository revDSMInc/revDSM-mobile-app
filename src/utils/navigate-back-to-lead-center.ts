import { planBackToLeadCenter } from './back-to-lead-center';

/**
 * Go back to the Lead Center the rep came from, instead of stacking a second one.
 *
 * ⚠️ Pops when a Lead Center is already below us, so the stack stays
 * `Leads → LeadCenter` and the next back press reaches the leads list. Only when there is none
 * (opened from a push notification, or a cold deep link) does it navigate and create one.
 *
 * ⚠️ Everything is defensive on purpose: this runs on a button a rep presses at a door, and a
 * throw here would crash the app mid-deal. Any surprise from the navigator falls back to the
 * plain `navigate`, which is what the code did before and always works.
 */
export const backToLeadCenter = (navigation: any, lead: any, tab: string = 'tools'): void => {
  const fallback = () => {
    try {
      navigation?.navigate('LeadCenter', { lead, tab });
    } catch (e) {
      console.warn('[Nav] Back to Lead Center failed:', e);
    }
  };

  try {
    const routes = navigation?.getState?.()?.routes;
    const plan = planBackToLeadCenter(routes);
    if (plan.action !== 'pop') {
      fallback();
      return;
    }
    const target = routes?.[routes.length - 1 - plan.count];
    // `pop` returns to the EXISTING Lead Center, so its own params (fromMyDeals, appointment
    // state) survive - re-navigating with fresh params would quietly reset them.
    if (typeof navigation?.pop !== 'function') {
      fallback();
      return;
    }

    navigation.pop(plan.count);

    /**
     * Land on Tools, which is what "Back to Tools" promises.
     *
     * Popping restores the screen as the rep left it, so if they had switched to Job Docs before
     * opening the Deal Center they would come back to Job Docs. This sets `tab` on the Lead
     * Center route, driving the `route.params?.tab` effect there.
     *
     * ⚠️ It must target that route BY KEY. A bare `navigation.setParams` writes to the route that
     * owns this navigation object - the Deal Center we are leaving - which would silently do
     * nothing.
     *
     * ⚠️ Best-effort only, and AFTER the pop. A failure here must never cost the pop itself:
     * being on the right screen matters more than being on the right tab.
     */
    try {
      const key = target?.key;
      if (key) {
        navigation.dispatch?.({
          type: 'SET_PARAMS',
          payload: { params: { tab } },
          source: key,
        });
      }
    } catch (e) {
      console.warn('[Nav] Could not select the Tools tab:', e);
    }
  } catch (e) {
    console.warn('[Nav] Back to Lead Center fell back to navigate:', e);
    fallback();
  }
};
