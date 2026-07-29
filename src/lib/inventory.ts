/**
 * Hanger Inventory — parse HangerInventory.xml from SST/dealer systems.
 *
 * XML structure:
 *   <HangerInventoryXml>
 *     <InventoryList>
 *       <Inventory Key="..." MaterialName="LUS24" IsSpecialOrder="false" Price="0.89" IsUnavailable="false" />
 *       ...
 *     </InventoryList>
 *   </HangerInventoryXml>
 *
 * A model is considered "in stock" when:
 *   - IsUnavailable = false
 *   - MaterialName matches the hanger model (case-insensitive, trimmed)
 *
 * Note: the same MaterialName can appear multiple times (different Keys / prices).
 * We treat the model as in-stock if ANY entry for it is available.
 */

export interface InventoryItem {
  key: string;
  materialName: string;
  isSpecialOrder: boolean;
  price: number;
  isUnavailable: boolean;
}

export interface ParsedInventory {
  items: InventoryItem[];
  /** Set of normalised model names that are in stock (IsUnavailable=false) */
  inStockSet: Set<string>;
}

/** Normalise a model name for comparison: uppercase + collapse whitespace */
function normalise(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Parse a HangerInventory XML string and return a ParsedInventory.
 * Throws if the XML is malformed or not a HangerInventoryXml document.
 */
export function parseInventoryXml(xmlText: string): ParsedInventory {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`Invalid XML: ${parseError.textContent?.slice(0, 200)}`);
  }

  const root = doc.documentElement;
  if (root.tagName !== 'HangerInventoryXml') {
    throw new Error(`Unexpected root element <${root.tagName}>. Expected <HangerInventoryXml>.`);
  }

  const nodes = Array.from(doc.querySelectorAll('InventoryList > Inventory'));
  if (nodes.length === 0) {
    throw new Error('No <Inventory> entries found in the file.');
  }

  const items: InventoryItem[] = nodes.map((el) => ({
    key: el.getAttribute('Key') ?? '',
    materialName: el.getAttribute('MaterialName') ?? '',
    isSpecialOrder: el.getAttribute('IsSpecialOrder')?.toLowerCase() === 'true',
    price: parseFloat(el.getAttribute('Price') ?? '0') || 0,
    isUnavailable: el.getAttribute('IsUnavailable')?.toLowerCase() === 'true',
  }));

  const inStockSet = new Set<string>(
    items
      .filter((item) => !item.isUnavailable && item.materialName.trim() !== '')
      .map((item) => normalise(item.materialName))
  );

  return { items, inStockSet };
}

/**
 * Check whether a hanger model is in stock.
 * Handles models like "LUS24" matching inventory entry "LUS24".
 */
export function isInStock(model: string, inventory: ParsedInventory | null): boolean {
  if (!inventory) return false;
  return inventory.inStockSet.has(normalise(model));
}

/**
 * Read a File object and parse it as HangerInventory XML.
 */
export async function loadInventoryFile(file: File): Promise<ParsedInventory> {
  const text = await file.text();
  return parseInventoryXml(text);
}
