'use strict';

// Best-effort network-type check (U-2). Used ONLY to make SPECULATIVE idle prefetch frugal on cellular —
// never to gate user-requested content (the PO's rule; A-10: "check waivers from the parking lot" must work
// on cellular). Any detection failure resolves to "not cellular", so prefetch proceeds unchanged.
import * as Network from 'expo-network';
import { isCellularState } from './netClassify';

export async function isCellular() {
  try {
    return isCellularState(await Network.getNetworkStateAsync());
  } catch (e) {
    return false; // undetectable → don't restrict
  }
}
