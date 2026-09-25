'use client';

import { listUnifiedAssets } from '../assets';
import type { AssetRepository } from './types';

/** Asset metadata boundary; physical media remains resolved by storageKey. */
export const assetRepository: AssetRepository = {
  list: listUnifiedAssets,
};
