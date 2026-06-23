/**
 * SST Hanger Selector — API Client
 *
 * Browser-based fetch client for:
 *   POST https://api.strongtie.com/gws/hanger-selector/hangers
 *
 * Token management via localStorage.
 *
 * CORS NOTE: SST API may block cross-origin requests from localhost or
 * Railway domains. If CORS fails, a proxy endpoint will be needed.
 */

import type { SSTPayload, SSTHangerResult, SSTAPIResponse } from './sst-types';
import { SST_API_URL } from './sst-types';

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'sst_bearer_token';

export function getSSTToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSSTToken(token: string): void {
  // Strip "Bearer " prefix if user pastes the full header value
  const clean = token.replace(/^Bearer\s+/i, '').trim();
  localStorage.setItem(TOKEN_KEY, clean);
}

export function clearSSTToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function hasSSTToken(): boolean {
  const t = getSSTToken();
  return t != null && t.length > 0;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

/**
 * Parse raw API JSON into typed SSTAPIResponse.
 *
 * Response structure (from DevTools capture):
 * {
 *   "errors": "",
 *   "status": { "code": 0, "error": false, "text": "" },
 *   "lstHangerOutput": [
 *     {
 *       "model": "LUS24",
 *       "modelSpec": "LUS24",
 *       "load": 1105,        // download capacity (lbs)
 *       "uplift": 495,       // uplift capacity (lbs)
 *       "wSize": 1.563,      // width (inches)
 *       "hSize": 3.125,      // height (inches)
 *       "bSize": 1.75,       // bearing (inches)
 *       "msrp": 0.0,
 *       "catalog": "C24106X.pdf",
 *       "modelID": "LUS24",
 *       "ici": 100,
 *       ...
 *     }
 *   ]
 * }
 */
function parseResponse(data: Record<string, unknown>): SSTAPIResponse {
  const status = (data.status as Record<string, unknown>) ?? {};
  if (status.error) {
    return {
      success: false,
      hangers: [],
      error: (status.text as string) || 'SST API returned an error',
      raw: data,
    };
  }

  const rawList = (data.lstHangerOutput as Array<Record<string, unknown>>) ?? [];
  const hangers: SSTHangerResult[] = rawList.map((h) => ({
    model: (h.model as string) || (h.modelSpec as string) || '\u2014',
    downloadLoad: (h.load as number) ?? 0,
    upliftLoad: (h.uplift as number) ?? 0,
    width: (h.wSize as number) ?? 0,
    height: (h.hSize as number) ?? 0,
    bearing: (h.bSize as number) ?? 0,
    cost: (h.msrp as number) ?? 0,
    series: (h.catalog as string) || '',
    sku: (h.modelID as string) || '',
  }));

  return { success: true, hangers, raw: data };
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/**
 * Submit a single SST payload and return parsed results.
 */
export async function submitToSST(
  payload: SSTPayload
): Promise<SSTAPIResponse> {
  const token = getSSTToken();
  if (!token) {
    return {
      success: false,
      hangers: [],
      error:
        'No SST token set. Open app.strongtie.com/hs in your browser, then copy the Bearer token from DevTools (Network tab \u2192 any XHR request \u2192 Authorization header).',
    };
  }

  try {
    const resp = await fetch(SST_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 401) {
      return {
        success: false,
        hangers: [],
        error:
          '401 Unauthorized \u2014 token expired. Get a fresh token from DevTools.',
      };
    }
    if (resp.status === 403) {
      return {
        success: false,
        hangers: [],
        error: '403 Forbidden \u2014 token does not have access.',
      };
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        success: false,
        hangers: [],
        error: `HTTP ${resp.status}: ${text.slice(0, 300)}`,
      };
    }

    const data = (await resp.json()) as Record<string, unknown>;
    return parseResponse(data);
  } catch (e: unknown) {
    const msg =
      e instanceof Error ? e.message : 'Unknown network error';

    // Detect CORS errors (browser gives opaque TypeError for blocked requests)
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      return {
        success: false,
        hangers: [],
        error:
          'Network error (likely CORS blocked). The SST API may not allow cross-origin requests from this domain. A proxy server may be needed.',
      };
    }

    return { success: false, hangers: [], error: msg };
  }
}

// ---------------------------------------------------------------------------
// Batch submit
// ---------------------------------------------------------------------------

export interface BatchResult {
  label: string;
  response: SSTAPIResponse;
}

/**
 * Submit multiple payloads sequentially with a delay between each call
 * to avoid rate limiting.
 *
 * @param items   Array of { label, payload } to submit
 * @param delayMs Delay between API calls (default 1000ms)
 * @param onProgress Callback after each item completes
 */
export async function submitBatchToSST(
  items: Array<{ label: string; payload: SSTPayload }>,
  delayMs = 1000,
  onProgress?: (completed: number, total: number) => void
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];

  for (let i = 0; i < items.length; i++) {
    const { label, payload } = items[i];
    const response = await submitToSST(payload);
    results.push({ label, response });

    onProgress?.(i + 1, items.length);

    // Delay between calls (skip after last)
    if (i < items.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
