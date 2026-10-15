/**
 * Region (USA / CAN) context.
 *
 * The selected region is chosen with the header toggle in App and read by the
 * SST components, so it does not have to be threaded through every prop list.
 */

import { createContext, useContext } from 'react';
import { DEFAULT_REGION, REGION_CONFIG } from './sst-types';
import type { SSTRegion, SSTRegionConfig } from './sst-types';

const REGION_STORAGE_KEY = 'sst_region';

export const RegionContext = createContext<SSTRegion>(DEFAULT_REGION);

export function useRegion(): SSTRegion {
  return useContext(RegionContext);
}

export function useRegionConfig(): SSTRegionConfig {
  return REGION_CONFIG[useContext(RegionContext)];
}

export function loadStoredRegion(): SSTRegion {
  try {
    const v = localStorage.getItem(REGION_STORAGE_KEY);
    return v === 'can' || v === 'us' ? v : DEFAULT_REGION;
  } catch {
    return DEFAULT_REGION;
  }
}

export function storeRegion(region: SSTRegion): void {
  try {
    localStorage.setItem(REGION_STORAGE_KEY, region);
  } catch {
    // storage unavailable — region just won't persist
  }
}
