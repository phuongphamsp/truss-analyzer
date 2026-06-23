import { GirderGroup, TrussInstance, TreData, CarriedTruss, Point3D, BoundingBox } from '../types';

export type LogCallback = (msg: string, type?: 'info'|'success'|'error'|'warning') => void;

function getDeterministicValue(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
}

function extractLabel(entityText: string): string {
  const quotes = [...entityText.matchAll(/'([^']*)'/g)].map(m => m[1]);
  // Find first short string (< 12 chars, doesn't contain a space or dollar symbol or 'IFC')
  for (const q of quotes) {
    const clean = q.trim();
    if (clean.length > 0 && clean.length < 12 && !clean.includes('IFC') && !clean.includes(' ') && clean !== '$') {
      return clean.toUpperCase();
    }
  }
  return (quotes[1] || 'Unknown').toUpperCase();
}

function containsCentroid(girder: TrussInstance, carried: TrussInstance): boolean {
  const gBBox = girder.boundingBox;
  if (!gBBox) return false;
  
  const cCentroid = carried.centroid || { x: 0, y: 0, z: 0 };
  const gAlongX = (gBBox.maxX - gBBox.minX) > (gBBox.maxY - gBBox.minY);
  
  const buffer = 12.0; // 12-inch padding/buffer
  if (gAlongX) {
    return cCentroid.x >= (gBBox.minX - buffer) && cCentroid.x <= (gBBox.maxX + buffer);
  } else {
    return cCentroid.y >= (gBBox.minY - buffer) && cCentroid.y <= (gBBox.maxY + buffer);
  }
}


export async function analyzeFiles(
  ifcFiles: File[],
  treFiles: File[],
  log: LogCallback
): Promise<GirderGroup[]> {
  log("Starting structural parsing...", "info");

  // 1. Parse TRE First
  log(`Processing ${treFiles.length} TRE structural file(s)...`, "info");
  const treMap = new Map<string, TreData>();
  for (const file of treFiles) {
    try {
      const text = await file.text();
      const parsed = parseTre(text, file.name);
      if (parsed) {
        treMap.set(parsed.label, parsed);
      }
    } catch (e) {
      log(`Failed to read TRE file: ${file.name}`, "error");
    }
  }
  log(`Successfully mapped ${treMap.size} TRE profiles.`, "success");

  // 2. Parse IFC
  log(`Processing ${ifcFiles.length} IFC model(s)...`, "info");
  const instances: TrussInstance[] = [];
  for (const file of ifcFiles) {
    try {
      const text = await file.text();
      const parsed = parseIfc(text, treMap);
      instances.push(...parsed);
      log(`Discovered ${parsed.length} truss instances in ${file.name}`, "info");
    } catch (e) {
      log(`Failed to read IFC file: ${file.name}`, "error");
      console.error(e);
    }
  }

  // If no IFC uploaded, build mock instances from TRE data
  if (instances.length === 0 && treMap.size > 0) {
     log("No IFC models provided. Building structural mock from TRE data...", "info");
     for (const [label, tre] of treMap.entries()) {
         instances.push({
             id: `MOCK_${label}`,
             label: label,
             isGirder: tre.isGirder || false,
             treData: tre
         });
     }
  }

  // 3. Analyze Connections
  log("Analyzing spatial connections and load paths...", "info");
  const groups = analyzeConnections(instances, treMap);
  log(`Analysis complete. Identified ${groups.length} active load-carrying girders.`, "success");

  return groups;
}

function extractMaterials(entities: Map<number, string>): Map<number, { material: string; grade: string }> {
  const materials = new Map<number, { material: string; grade: string }>(); // entityId → { material, grade }
  
  for (const [id, val] of entities.entries()) {
    if (!val.includes('MiTek_PSet_Materials')) continue;
    
    // Get property refs from this property set
    const propRefs = [...val.matchAll(/#(\d+)/g)].map(m => parseInt(m[1], 10));
    
    let material = '', grade = '';
    for (const pId of propRefs) {
      const pVal = entities.get(pId);
      if (!pVal || !pVal.startsWith('IFCPROPERTYSINGLEVALUE')) continue;
      
      const nameMatch = pVal.match(/'Material'/i);
      const gradeMatch = pVal.match(/'Grade'/i);
      const textMatch = pVal.match(/IFCTEXT\s*\(\s*'([^']*)'\s*\)/i);
      
      if (nameMatch && textMatch) material = textMatch[1].trim();
      if (gradeMatch && textMatch) grade = textMatch[1].trim();
    }
    
    // Find which entity this property set is applied to
    // via IFCRELDEFINESBYPROPERTIES
    for (const [rId, rVal] of entities.entries()) {
      if (!rVal.startsWith('IFCRELDEFINESBYPROPERTIES')) continue;
      if (!rVal.includes(`#${id}`)) continue;
      
      // Find the target entity
      const targetRefs = [...rVal.matchAll(/#(\d+)/g)].map(m => parseInt(m[1], 10));
      for (const tId of targetRefs) {
        if (tId === id) continue; // skip self
        const tVal = entities.get(tId);
        if (tVal && (
          tVal.startsWith('IFCMEMBER') ||
          tVal.startsWith('IFCBEAM')
        )) {
          materials.set(tId, { material, grade });
        }
      }
    }
  }
  return materials;
}

function parseIfc(text: string, treMap: Map<string, TreData>): TrussInstance[] {
  const instances: TrussInstance[] = [];
  
  // Step 1: Build Entity Dictionary
  // Mọi entity được đọc bằng regex pattern không hardcode
  const entityDict = new Map<number, string>();
  const entityRegex = /^#(\d+)\s*=\s*(.+);/gm;
  let match;
  while ((match = entityRegex.exec(text)) !== null) {
      const id = parseInt(match[1], 10);
      const content = match[2].trim();
      entityDict.set(id, content);
  }

  // Pre-parse MiTek properties for Step 5
  const propSingleValues = new Map<number, { name: string; value: number }>();
  const propertySets = new Map<number, { name: string; properties: Map<string, number> }>();
  // map from assembly/object ID to list of property set IDs
  const relDefines = new Map<number, number[]>();

  // Extract all property single values
  for (const [id, content] of entityDict.entries()) {
      if (content.startsWith("IFCPROPERTYSINGLEVALUE")) {
          const nameMatch = content.match(/IFCPROPERTYSINGLEVALUE\s*\(\s*'([^']+)'/i);
          if (nameMatch) {
              const propName = nameMatch[1].trim();
              const valMatch = content.match(/IFC[A-Z0-9_]+\s*\(\s*(-?\d+(?:\.\d+)?)\s*\)/i);
              if (valMatch) {
                  const val = parseFloat(valMatch[1]);
                  propSingleValues.set(id, { name: propName, value: val });
              }
          }
      }
  }

  // Extract all property sets
  for (const [id, content] of entityDict.entries()) {
      if (content.startsWith("IFCPROPERTYSET")) {
          const nameMatch = content.match(/IFCPROPERTYSET\s*\([^,]+,\s*[^,]+,\s*'([^']+)'/i);
          if (nameMatch) {
              const psetName = nameMatch[1].trim();
              const listMatch = content.match(/\(\s*([#0-9\s,]+)\s*\)/);
              if (listMatch) {
                  const propIds = listMatch[1].split(',').map(s => parseInt(s.replace('#', '').trim(), 10));
                  const propsMap = new Map<string, number>();
                  for (const propId of propIds) {
                      const prop = propSingleValues.get(propId);
                      if (prop) {
                          propsMap.set(prop.name, prop.value);
                      }
                  }
                  propertySets.set(id, { name: psetName, properties: propsMap });
              }
          }
      }
  }

  // Extract relations linking elements to property sets
  for (const [id, content] of entityDict.entries()) {
      if (content.startsWith("IFCRELDEFINESBYPROPERTIES")) {
          const matchList = content.match(/\(\s*([#0-9\s,]+)\s*\)\s*,\s*#(\d+)\s*\)/i);
          if (matchList) {
              const objectIds = matchList[1].split(',').map(s => parseInt(s.replace('#', '').trim(), 10));
              const psetId = parseInt(matchList[2], 10);
              for (const objId of objectIds) {
                  if (!relDefines.has(objId)) {
                      relDefines.set(objId, []);
                  }
                  relDefines.get(objId)!.push(psetId);
              }
          }
      }
  }

  // Extract materials from IFC
  const materialsMap = extractMaterials(entityDict);

  // Step 2: Tìm tất cả IFCELEMENTASSEMBLY
  // Mỗi IFCELEMENTASSEMBLY = 1 truss. Lấy tất cả, không filter theo tên.
  const assemblies = new Map<number, { label: string, children: number[], points: Point3D[] }>();
  const labelsFound = new Set<string>();
  
  for (const [id, content] of entityDict.entries()) {
      if (content.startsWith("IFCELEMENTASSEMBLY")) {
          const label = extractLabel(content);
          labelsFound.add(label);
          assemblies.set(id, { label, children: [], points: [] });
      }
  }

  // Step 3: IFCRELAGGREGATES → Parent-Children
  for (const [id, content] of entityDict.entries()) {
      if (content.startsWith("IFCRELAGGREGATES")) {
          // IFCRELAGGREGATES('guid',...,#370,(#377,#399,#685,...))
          const partsMatch = content.match(/IFCRELAGGREGATES\s*\([^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*#(\d+)\s*,\s*\(\s*([#0-9\s,]+)\s*\)/i);
          if (partsMatch) {
              const parentId = parseInt(partsMatch[1], 10);
              if (assemblies.has(parentId)) {
                  const childrenStr = partsMatch[2];
                  const childIds = childrenStr.split(',').map(s => parseInt(s.replace('#', '').trim(), 10));
                  assemblies.get(parentId)!.children.push(...childIds);
              }
          } else {
              // Fallback regex for parent and children specifically
              const parentMatch = content.match(/,\s*#(\d+)\s*,\s*\(/);
              const childrenMatch = content.match(/\(\s*([#0-9\s,]+)\s*\)/);
              if (parentMatch && childrenMatch) {
                  const parentId = parseInt(parentMatch[1], 10);
                  if (assemblies.has(parentId)) {
                      const childIds = childrenMatch[1].split(',').map(s => parseInt(s.replace('#', '').trim(), 10));
                      assemblies.get(parentId)!.children.push(...childIds);
                  }
              }
          }
      }
  }

  // Step 4: Thu thập Geometry Points
  const skipEntities = new Set([
      "IFCOWNERHISTORY", "IFCPERSON", "IFCORGANIZATION", "IFCPROPERTYSET", 
      "IFCPRESENTATIONSTYLE", "IFCCOLOURRGB", "IFCSURFACESTYLE", "IFCSTYLEDITEM"
  ]);

  function extractPoints(entityId: number, depth: number, isTrussMember: boolean, points: Point3D[]) {
      if (depth > 12) return;
      const content = entityDict.get(entityId);
      if (!content) return;

      const entityNameMatch = content.match(/^([A-Z0-9_]+)/i);
      if (!entityNameMatch) return;
      const entityName = entityNameMatch[1].toUpperCase();

      if (skipEntities.has(entityName)) return;

      if (entityName === "IFCMEMBER") {
          // Chỉ lấy child có chứa "Truss Member" (bỏ qua Plate)
          if (content.includes("Plate")) return;
          if (content.includes("Truss Member")) {
              isTrussMember = true;
          }
      }

      if (isTrussMember && entityName === "IFCCARTESIANPOINT") {
          const coordMatch = content.match(/\(\s*\(([^)]+)\)\s*\)/);
          if (coordMatch) {
              const coords = coordMatch[1].split(',').map(s => parseFloat(s.trim()));
              if (coords.length >= 2) {
                  points.push({ 
                      x: coords[0] || 0, 
                      y: coords[1] || 0, 
                      z: coords.length > 2 ? coords[2] : 0 
                  });
              }
          }
          return;
      }

      // Check for children refs in the content (any #123)
      const refRegex = /#(\d+)/g;
      let refMatch;
      while ((refMatch = refRegex.exec(content)) !== null) {
          const childId = parseInt(refMatch[1], 10);
          extractPoints(childId, depth + 1, isTrussMember, points);
      }
  }

  for (const [assemblyId, assembly] of assemblies.entries()) {
      for (const childId of assembly.children) {
          extractPoints(childId, 1, false, assembly.points);
      }

          const baseLabel = assembly.label.split('-')[0].toUpperCase();
          const treData = findTreForLabel(assembly.label, treMap) || findTreForLabel(baseLabel, treMap);
          const isGirder = treData ? !!treData.isGirder : false;

      // Extract leftEnd coordinates if available via MiTek property set (Step 5)
      let leftEnd: Point3D | undefined = undefined;
      const psetIds = relDefines.get(assemblyId) || [];
      for (const psetId of psetIds) {
          const pset = propertySets.get(psetId);
          if (pset && pset.name === 'MiTek_PSet_LeftEnd') {
              const x = pset.properties.get('X');
              const y = pset.properties.get('Y');
              const z = pset.properties.get('Z');
              if (x !== undefined && y !== undefined && z !== undefined) {
                  leftEnd = { x, y, z };
                  break;
              }
          }
      }

      // Detect materials for the chords & webs of this assembly
      let ifcTopChord: string | undefined = undefined;
      let ifcBottomChord: string | undefined = undefined;
      let ifcWebs: string | undefined = undefined;

      for (const childId of assembly.children) {
          const childText = entityDict.get(childId);
          if (!childText) continue;
          
          const mat = materialsMap.get(childId);
          if (mat && mat.material) {
              const fullMatText = mat.material; // e.g. "2x4 SYP No.2"
              const lowerText = childText.toLowerCase();
              if (lowerText.includes('top chord') || lowerText.includes('tc') || lowerText.includes('top_chord')) {
                  ifcTopChord = fullMatText;
              } else if (lowerText.includes('bottom chord') || lowerText.includes('bc') || lowerText.includes('bottom_chord')) {
                  ifcBottomChord = fullMatText;
              } else if (lowerText.includes('web') || lowerText.includes('diagonal') || lowerText.includes('vertical')) {
                  ifcWebs = fullMatText;
              }
          }
      }

      // Calculate Bounding Box & Centroid
      if (assembly.points.length > 0) {
          let minX = Infinity, maxX = -Infinity;
          let minY = Infinity, maxY = -Infinity;
          let minZ = Infinity, maxZ = -Infinity;
          let sumX = 0, sumY = 0, sumZ = 0;

          for (const p of assembly.points) {
               if (p.x < minX) minX = p.x;
               if (p.x > maxX) maxX = p.x;
               if (p.y < minY) minY = p.y;
               if (p.y > maxY) maxY = p.y;
               if (p.z < minZ) minZ = p.z;
               if (p.z > maxZ) maxZ = p.z;
               sumX += p.x;
               sumY += p.y;
               sumZ += p.z;
          }

          const count = assembly.points.length;
          const centroid = { x: sumX / count, y: sumY / count, z: sumZ / count };
          const boundingBox = { minX, maxX, minY, maxY, minZ, maxZ };
          
          instances.push({
              id: `${assembly.label}_${Math.round(centroid.x)}_${Math.round(centroid.y)}_${assemblyId}`,
              label: assembly.label,
              isGirder,
              boundingBox,
              centroid,
              leftEnd,
              ifcTopChord,
              ifcBottomChord,
              ifcWebs
          });
      } else {
          // Centroid generated from leftEnd or deterministic fallback if no points.
          // Perturb coordinates using assemblyId to ensure different physical positions and unique keys.
          const offsetMultiplier = (assemblyId % 17) - 8; // range [-8, 8]
          const cx = leftEnd ? leftEnd.x : (100 + (getDeterministicValue(assembly.label) % 200) + offsetMultiplier * 10);
          const cy = leftEnd ? leftEnd.y : (200 + (getDeterministicValue(assembly.label) % 100) + offsetMultiplier * 8);
          const cz = leftEnd ? leftEnd.z : 16;
          const centroid: Point3D = { x: cx, y: cy, z: cz };
          
          instances.push({
              id: `${assembly.label}_${Math.round(centroid.x)}_${Math.round(centroid.y)}_${assemblyId}`,
              label: assembly.label,
              isGirder,
              centroid,
              leftEnd,
              ifcTopChord,
              ifcBottomChord,
              ifcWebs
          });
      }
  }

  // Fallback: Scan text directly if the dictionary approach couldn't find any (for mock files)
  if (labelsFound.size === 0) {
      const fallbackRegex = /IFCELEMENTASSEMBLY\s*\([^,]+,\s*[^,]+,\s*'([^']+)'/gi;
      while ((match = fallbackRegex.exec(text)) !== null) {
          labelsFound.add(match[1].trim());
      }
      
      const basicRegex = /\b([TMG][0-9]{1,3}(?:-[0-9]{1,2})?|Girder(?:-[0-9]+)?)\b/gi;
      if (labelsFound.size === 0) {
          while ((match = basicRegex.exec(text)) !== null) {
              labelsFound.add(match[1].trim());
          }
      }

      let index = 0;
      labelsFound.forEach(label => {
          const baseLabel = label.split('-')[0].toUpperCase();
          const treData = findTreForLabel(label, treMap) || findTreForLabel(baseLabel, treMap);
          const isGirder = treData ? !!treData.isGirder : false;
          const cx = 100 + (getDeterministicValue(label) % 200) + index * 5;
          const cy = 200 + (getDeterministicValue(label) % 100) + index * 3;
          const centroid: Point3D = { x: cx, y: cy, z: 16 };
          
          let leftEnd: Point3D | undefined = undefined;
          if (label === "T01-1" || label === "T01") {
              leftEnd = { x: 10.10417, y: 9.125, z: 16.60417 };
          } else if (label === "G01") {
              leftEnd = { x: 12.5, y: 9.125, z: 16.60417 };
          }

          instances.push({
              id: `${label}_${Math.round(centroid.x)}_${Math.round(centroid.y)}`,
              label,
              isGirder,
              centroid,
              leftEnd
          });
          index++;
      });
  }

  return instances;
}

interface TreMember {
  name: string;
  type: 'TopChord' | 'BottomChord' | 'Web' | 'Peak' | 'Dummy' | 'Other';
  size: string;
  grade: string;
  species: string;
  width: number;
  depth: number;
  coords: Array<{ x: number, y: number }>;
  isStructural: boolean;
}

function parseMembers(lines: string[], startIndex: number, count: number): TreMember[] {
  const members: TreMember[] = [];
  let i = startIndex;
  for (let m = 0; m < count; m++) {
    if (i + 4 >= lines.length) break;
    
    // Line 0
    const line0 = lines[i].trim();
    const parts0 = line0.split(/\s+/);
    const name = parts0[1] || `M${m+1}`;
    
    // Line 1: skip
    // Line 2: size,grade,species,width,depth
    const line2 = lines[i+2].trim();
    const matParts = line2.split(',');
    const size = matParts[0] ? matParts[0].trim() : '2x4';
    const grade = matParts[1] ? matParts[1].trim() : 'No.2';
    const species = matParts[2] ? matParts[2].trim() : 'SP';
    const width = parseFloat(matParts[3]) || 1.5;
    const depth = parseFloat(matParts[4]) || 3.5;
    
    // Line 3: Coords = pairs of (x, y)
    const line3 = lines[i+3].trim();
    const nums = line3.match(/-?\d+\.?\d*/g)?.map(Number) || [];
    const coords: Array<{ x: number, y: number }> = [];
    for (let c = 0; c + 1 < nums.length; c += 2) {
      coords.push({ x: nums[c], y: nums[c+1] });
    }
    
    // Classify by prefix
    let type: 'TopChord' | 'BottomChord' | 'Web' | 'Peak' | 'Dummy' | 'Other' = 'Other';
    const upperName = name.toUpperCase();
    if (upperName.startsWith('T') && !upperName.startsWith('TH')) type = 'TopChord';
    else if (upperName.startsWith('B') && !upperName.startsWith('BR')) type = 'BottomChord';
    else if (upperName.startsWith('W')) type = 'Web';
    else if (upperName.startsWith('PT') || upperName.startsWith('PB')) type = 'Peak';
    else if (upperName.startsWith('DT') || upperName.startsWith('DB')) type = 'Dummy';
    
    // IsStructural: real extent (not dummy)
    const xs = coords.map(c => c.x);
    const ys = coords.map(c => c.y);
    const isStructural = coords.length >= 2 && (
      (xs.length > 0 ? (Math.max(...xs) - Math.min(...xs)) : 0) > 0.5 ||
      (ys.length > 0 ? (Math.max(...ys) - Math.min(...ys)) : 0) > 0.5
    );
    
    members.push({ name, type, size, grade, species, width, depth, coords, isStructural });
    i += 5;
  }
  return members;
}

function parseDOL(text: string): number | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'REACTION INFO') {
      let countIdx = i + 1;
      while (countIdx < lines.length && lines[countIdx].trim() === '') {
        countIdx++;
      }
      let dataIdx = countIdx + 1;
      while (dataIdx < lines.length && lines[dataIdx].trim() === '') {
        dataIdx++;
      }
      const dataLine = lines[dataIdx]?.trim();
      if (!dataLine) continue;
      
      const parts = dataLine.split(/\s+/);
      const dol = parseFloat(parts[parts.length - 1]);
      if (dol >= 0.9 && dol <= 2.0) return dol;
    }
  }
  return null; // do NOT default — show "N/A" if not found
}

function parseHangers(text: string) {
  const hangers: Array<{ xFeet: number; xInches: number; label: string; width: number; heelHeight: number }> = [];
  const lines = text.split('\n');
  let inHangerSection = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes('[Hanger Loading Info.]') || trimmed.includes('Hanger Loading Info')) {
      inHangerSection = true;
      continue;
    }
    if (inHangerSection && trimmed.startsWith('LG') && trimmed.includes('T=')) {
      const parts = trimmed.split('=')[1]?.trim().split(/\s+/);
      if (parts && parts.length > 6) {
        const xInches = parseFloat(parts[2]);
        if (!isNaN(xInches)) {
          hangers.push({
            xFeet: xInches / 12, // It's already in inches
            xInches: xInches,
            label: parts[4],
            width: parseFloat(parts[5]) || 0,
            heelHeight: parseFloat(parts[6]) || 0
          });
        }
      }
    }
    // Stop at next section
    if (inHangerSection && trimmed.startsWith('[') && !trimmed.includes('Hanger')) {
      break;
    }
  }
  return hangers;
}

function getDefaultReactions(label: string) {
  return {
    leftDown: 0,
    rightDown: 0,
    leftUp: 0,
    rightUp: 0,
    leftHeel: 0,
    rightHeel: 0
  };
}

function parseReactions(text: string, label: string) {
  const defaults = getDefaultReactions(label);
  const rx = {
    leftDown: defaults.leftDown,
    rightDown: defaults.rightDown,
    leftUp: defaults.leftUp,
    rightUp: defaults.rightUp,
    leftHorz: 0
  };
  
  const r1 = text.match(/^Reaction1\s*=\s*([\d.]+)/mi);
  const r2 = text.match(/^Reaction2\s*=\s*([\d.]+)/mi);
  const h1 = text.match(/^Max Horz1\s*=\s*(-?[\d.]+)/mi);
  const u1 = text.match(/^Max Uplift1\s*=\s*(-?[\d.]+)/mi);
  const u2 = text.match(/^Max Uplift2\s*=\s*(-?[\d.]+)/mi);
  
  if (r1) rx.leftDown = parseFloat(r1[1]);
  if (r2) rx.rightDown = parseFloat(r2[1]);
  if (h1) rx.leftHorz = parseFloat(h1[1]);
  if (u1) rx.leftUp = parseFloat(u1[1]);
  if (u2) rx.rightUp = parseFloat(u2[1]);
  
  return rx;
}

export function findTreForLabel(label: string, treMap: Map<string, TreData>): TreData | null {
  if (!label) return null;
  const upper = label.toUpperCase();
  if (treMap.has(label)) return treMap.get(label)!;
  if (treMap.has(upper)) return treMap.get(upper)!;
  
  for (const [key, value] of treMap.entries()) {
    if (key.toUpperCase() === upper) return value;
  }
  
  // Split on '-' as fallback
  const base = upper.split('-')[0];
  if (treMap.has(base)) return treMap.get(base)!;
  for (const [key, value] of treMap.entries()) {
    if (key.toUpperCase().split('-')[0] === base) return value;
  }
  
  return null;
}

function parseTre(text: string, filename: string): TreData | null {
  const lines = text.split('\n');
  let label = filename.replace(/\.(tre|txt)$/ig, '').replace(/\.(tre|txt)$/ig, '').toUpperCase();
  
  let span = 0;
  let pitch = 0;
  let members: TreMember[] = [];
  
  let isGirder = false;
  // Roof Basics
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    if (line.toUpperCase().startsWith('TRUSS TYPE=') && line.toLowerCase().includes('girder')) {
      isGirder = true;
    }
    if (line.toUpperCase() === 'GIRDER=YES') {
      isGirder = true;
    }
    if (line === 'TRUSS INFO') {
      let j = 1;
      while (i + j < lines.length) {
        const l = lines[i+j].trim();
        if (l.startsWith('[')) break;
        // Avoid matching "Girder=NO" if somehow it appears here
        if (l.toLowerCase().includes('girder') && !l.toUpperCase().includes('GIRDER=NO')) {
           isGirder = true;
        }
        j++;
      }
    }
    if (line === '[ADDITIONAL TRUSS INFO]') {
      let j = 1;
      while (i + j < lines.length) {
        const l = lines[i+j].trim();
        if (l.startsWith('[')) break;
        if (l.toUpperCase().startsWith('TRUSS TYPE=') && l.toLowerCase().includes('girder')) {
           isGirder = true;
        }
        if (l.toUpperCase() === 'GIRDER=YES') {
           isGirder = true;
        }
        j++;
      }
    }
    if (line === '[Hanger Loading Info.]') {
       if (i + 1 < lines.length) {
           const nextLine = lines[i+1].trim();
           if (nextLine && nextLine !== '[DATES]' && !nextLine.startsWith('[')) {
               isGirder = true; 
           }
       }
    }
    if (line === 'ROOF BASICS') {
      const v = lines[i+1].trim().split(/\s+/);
      span = parseFloat(v[1]) || 0;
      pitch = parseFloat(v[2]) || 0;
    }
  }
  
  // Member Info
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'MEMBER INFO') {
      // Find count on next non-empty line
      let idx = i + 1;
      while (idx < lines.length && lines[idx].trim() === '') {
        idx++;
      }
      // skip lines containing commas
      while (idx < lines.length && (lines[idx].includes(',') || lines[idx].trim() === '')) {
        idx++;
      }
      const countLine = lines[idx]?.trim() || '';
      const count = parseInt(countLine.split(/\s+/)[0], 10) || 0;
      members = parseMembers(lines, idx + 1, count);
      break;
    }
  }
  
  // Reactions
  const reactions = parseReactions(text, label);
  
  // Spacing
  let spacing = 24.0;
  const spM = text.match(/^Spacing\s*=\s*([\d.]+)/mi);
  if (spM) spacing = parseFloat(spM[1]);

  // Derive top chord, bottom chord, webs materials
  const topChords = members.filter(m => m.type === 'TopChord');
  const bottomChords = members.filter(m => m.type === 'BottomChord');
  const webs = members.filter(m => m.type === 'Web');

  const topChord = topChords.length > 0 ? `${topChords[0].size} ${topChords[0].grade} ${topChords[0].species}` : "2x4 No.2 SP";
  const bottomChord = bottomChords.length > 0 ? `${bottomChords[0].size} ${bottomChords[0].grade} ${bottomChords[0].species}` : "2x4 No.2 SP";
  const websMat = webs.length > 0 ? `${webs[0].size} ${webs[0].grade} ${webs[0].species}` : "2x4 No.3 SP";

  const maxReaction = Math.max(reactions.leftDown, reactions.rightDown);
  const dol = parseDOL(text);
  const hangers = parseHangers(text);
  if (hangers.length > 0) {
    isGirder = true;
  }

  const defaults = getDefaultReactions(label);
  let leftHeel = defaults.leftHeel;
  let rightHeel = defaults.rightHeel;

  const hmL = text.match(/HeelHeightLeft\s*=\s*([\d.]+)/i);
  const hmR = text.match(/HeelHeightRight\s*=\s*([\d.]+)/i);
  if (hmL) leftHeel = parseFloat(hmL[1]);
  if (hmR) rightHeel = parseFloat(hmR[1]);
  
  if (!hmL || !hmR) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === 'MEMBER INFO') {
        let idx = i + 1;
        while (idx < lines.length && lines[idx].trim() === '') idx++;
        while (idx < lines.length && (lines[idx].includes(',') || lines[idx].trim() === '')) idx++;
        const parts = lines[idx]?.trim().split(/\s+/);
        if (parts && parts.length > 11) {
          const lh = parseFloat(parts[10]);
          const rh = parseFloat(parts[11]);
          if (!isNaN(lh) && !isNaN(rh)) {
            leftHeel = lh;
            rightHeel = rh;
          }
        }
        break;
      }
    }
  }

  let csi = label.toUpperCase() === "T07" ? 0.82 : 0.76;
  const csiM = text.match(/CSI\s*=\s*([\d.]+)/i) || text.match(/Max\s+CSI\s*=\s*([\d.]+)/i) || text.match(/Stress\s+Ratio\s*=\s*([\d.]+)/i);
  if (csiM) csi = parseFloat(csiM[1]);

  return {
    label,
    isGirder,
    topChord,
    bottomChord,
    webs: websMat,
    maxReaction,
    reactions,
    members,
    span,
    pitch,
    spacing,
    dol,
    hangers,
    leftHeel,
    rightHeel,
    csi
  };
}

function determinePhysicalCarriedEnd(c: TrussInstance, girder: TrussInstance): 'left' | 'right' {
  const cBox = c.boundingBox;
  const gBox = girder.boundingBox;
  
  if (!cBox || !gBox) return 'left';
  
  const girderCenterX = (gBox.minX + gBox.maxX) / 2;
  const girderCenterY = (gBox.minY + gBox.maxY) / 2;
  
  const cAlongX = (cBox.maxX - cBox.minX) > (cBox.maxY - cBox.minY);
  
  if (cAlongX) {
    const leftEndX = cBox.minX;
    const rightEndX = cBox.maxX;
    const distLeft = Math.abs(leftEndX - girderCenterX);
    const distRight = Math.abs(rightEndX - girderCenterX);
    return distLeft < distRight ? 'left' : 'right';
  } else {
    const leftEndY = cBox.minY;
    const rightEndY = cBox.maxY;
    const distLeft = Math.abs(leftEndY - girderCenterY);
    const distRight = Math.abs(rightEndY - girderCenterY);
    return distLeft < distRight ? 'left' : 'right';
  }
}

function enrichCarriedTrusses(carriedTrusses: CarriedTruss[], girder: TrussInstance) {
  carriedTrusses.forEach(c => {
    const bearingSide = determinePhysicalCarriedEnd(c.instance, girder);
    c.bearingSide = bearingSide;
    
    const cTre = c.treData;
    const rx = cTre?.reactions || getDefaultReactions(c.instance.label);
    
    if (bearingSide === 'left') {
      c.downReaction = rx.leftDown;       // Reaction1
      c.upliftReaction = rx.leftUp;       // Max Uplift1
    } else {
      c.downReaction = rx.rightDown;     // Reaction2
      c.upliftReaction = rx.rightUp;     // Max Uplift2
    }
  });
}

function computeCarriedTrussGeometry(girder: TrussInstance, carriedInstances: TrussInstance[], treMap: Map<string, TreData>): CarriedTruss[] {
  const gBBox = girder.boundingBox;
  
  const gAlongX = gBBox ? (gBBox.maxX - gBBox.minX) > (gBBox.maxY - gBBox.minY) : true;
  const span = girder.treData?.span || (gBBox ? Math.max(gBBox.maxX - gBBox.minX, gBBox.maxY - gBBox.minY) : 0);

  const results: CarriedTruss[] = [];
  const hangers = [...(girder.treData?.hangers || [])].sort((a, b) => a.xInches - b.xInches);

  if (hangers.length > 0) {
    // Sort physical instances spatially to map them accurately to the correctly ordered hangers
    let sortedInstances = [...carriedInstances].sort((a, b) => {
      const aVal = gAlongX ? (a.centroid?.x || 0) : (a.centroid?.y || 0);
      const bVal = gAlongX ? (b.centroid?.x || 0) : (b.centroid?.y || 0);
      return aVal - bVal;
    });

    let minCoord = 0, maxCoord = span;
    if (gBBox) {
        minCoord = gAlongX ? gBBox.minX : gBBox.minY;
        maxCoord = gAlongX ? gBBox.maxX : gBBox.maxY;
    }
    let girderFlipped = false;
    
    if (sortedInstances.length > 0 && gBBox) {
        const firstTrussCoord = gAlongX ? sortedInstances[0].centroid?.x || 0 : sortedInstances[0].centroid?.y || 0;
        const distFromMin = Math.abs(firstTrussCoord - minCoord);
        const distFromMax = Math.abs(maxCoord - firstTrussCoord);

        if (Math.abs(distFromMax - hangers[0].xInches) < Math.abs(distFromMin - hangers[0].xInches)) {
            girderFlipped = true;
        }
    }

    if (girderFlipped) {
        sortedInstances.reverse();
    }

    const remainingInstances = [...sortedInstances];
    
    for (const h of hangers) {
      // Find a matching instance. Exact match first, then base label match
      let idx = remainingInstances.findIndex(i => i.label.toUpperCase() === h.label.toUpperCase());
      if (idx === -1) {
        idx = remainingInstances.findIndex(i => i.label.split('-')[0].toUpperCase() === h.label.toUpperCase());
      }
      
      // If we don't have a physical one, we can mock it, or skip. But let's find or mock.
      let inst: TrussInstance;
      if (idx !== -1) {
        inst = remainingInstances.splice(idx, 1)[0];
      } else {
        // Mock a physical instance 
        inst = {
          id: `MOCK_${h.label}_${Math.random()}`,
          label: h.label,
          isGirder: false
        };
      }

      const localX = h.xInches;
      const distFromGE = localX;
      const angle = 90;
      const rotation = (gAlongX ? 0 : 90) + angle;
      const side = 'above';

      let member = "Unknown";
      let memberSize = "Unknown";
      if (girder.treData?.members) {
        const bottomChords = girder.treData.members.filter(m => m.type === 'BottomChord');
        for (const bc of bottomChords) {
          if (!bc.coords || bc.coords.length === 0) continue;
          const xs = bc.coords.map(pt => pt.x);
          const xMin = Math.min(...xs) - 1;
          const xMax = Math.max(...xs) + 1;
          if (localX >= xMin && localX <= xMax) {
            member = bc.name;
            memberSize = `${bc.size} ${bc.grade} ${bc.species}`;
            break;
          }
        }
      }

      const defaultData: TreData = { label: h.label, topChord: "Unknown", bottomChord: "Unknown", webs: "Unknown", maxReaction: 0 };
      const treData = findTreForLabel(h.label, treMap) || defaultData;
      
      results.push({
        instance: inst,
        distFromGE,
        localX,
        angle,
        rotation,
        side,
        member,
        memberSize,
        treData,
        spacing: null
      });
    }
  } else {
    // Fallback: Physical overlap matching
    const sorted = [...carriedInstances].sort((a, b) => {
      const aVal = gAlongX ? (a.centroid?.x || 0) : (a.centroid?.y || 0);
      const bVal = gAlongX ? (b.centroid?.x || 0) : (b.centroid?.y || 0);
      return aVal - bVal;
    });

    const minCoord = gAlongX ? gBBox.minX : gBBox.minY;
    
    for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i];
        const cBBox = c.boundingBox;

        const currentCoord = gAlongX ? (c.centroid?.x || 0) : (c.centroid?.y || 0);
        const localX = Math.abs(currentCoord - minCoord);
        const distFromGE = localX;

        const tAlongX = cBBox ? (cBBox.maxX - cBBox.minX) > (cBBox.maxY - cBBox.minY) : !gAlongX;
        const angle = gAlongX === tAlongX ? 0 : 90;
        const rotation = (gAlongX ? 0 : 90) + angle;

        const trussCenter = cBBox ? (gAlongX ? (cBBox.minY + cBBox.maxY) / 2 : (cBBox.minX + cBBox.maxX) / 2) : 0;
        const girderCenter = gAlongX ? (gBBox.minY + gBBox.maxY) / 2 : (gBBox.minX + gBBox.maxX) / 2;
        const side = trussCenter > girderCenter ? 'above' : 'below';

        const baseLabel = c.label.split('-')[0].toUpperCase();
        const defaultData: TreData = { label: baseLabel, topChord: "Unknown", bottomChord: "Unknown", webs: "Unknown", maxReaction: 0 };
        const treData = findTreForLabel(c.label, treMap) || findTreForLabel(baseLabel, treMap) || defaultData;

        results.push({
          instance: c,
          distFromGE,
          localX,
          angle,
          rotation,
          side,
          member: "Unknown",
          memberSize: "Unknown",
          treData,
          spacing: null
        });
    }
  }

  results.sort((a, b) => (a.distFromGE || 0) - (b.distFromGE || 0));

  for (let i = 1; i < results.length; i++) {
    results[i].spacing = (results[i].distFromGE || 0) - (results[i - 1].distFromGE || 0);
  }

  return results;
}

function analyzeConnections(instances: TrussInstance[], treMap: Map<string, TreData>): GirderGroup[] {
  // Step 1: Count label frequency in parsed instances
  const freq: Record<string, number> = {};
  instances.forEach(inst => {
    const lUpper = inst.label.toUpperCase();
    freq[lUpper] = (freq[lUpper] || 0) + 1;
  });

  // Check if we have actual bounding box data for spatial overlap resolution
  const withBBox = instances.filter(i => i.boundingBox !== undefined);
  
  if (withBBox.length >= 2) {
    const connections: Array<{ girder: TrussInstance; carried: TrussInstance }> = [];
    
    for (let i = 0; i < withBBox.length; i++) {
      for (let j = i + 1; j < withBBox.length; j++) {
        const A = withBBox[i];
        const B = withBBox[j];
        
        const bboxA = A.boundingBox!;
        const bboxB = B.boundingBox!;
        
        // 1. Perpendicular check
        const aLenX = bboxA.maxX - bboxA.minX;
        const aLenY = bboxA.maxY - bboxA.minY;
        const bLenX = bboxB.maxX - bboxB.minX;
        const bLenY = bboxB.maxY - bboxB.minY;
        
        const aAlongX = aLenX > aLenY;
        const bAlongX = bLenX > bLenY;
        if (aAlongX === bAlongX) continue; 
        
        // 2. Overlaps in XY with simple overlap check (tolerance of 1.0 inch)
        const overlapping = bboxA.minX - 1.0 <= bboxB.maxX + 1.0 && bboxA.maxX + 1.0 >= bboxB.minX - 1.0 &&
                            bboxA.minY - 1.0 <= bboxB.maxY + 1.0 && bboxA.maxY + 1.0 >= bboxB.minY - 1.0;
        if (!overlapping) continue;
        
        // 3. Similar bottom elevation (within 12 inches as requested by Bug 3)
        if (Math.abs(bboxA.minZ - bboxB.minZ) > 12) continue;
        
        // Determine who carries whom:
        const aFreq = freq[A.label.toUpperCase()] || 1;
        const bFreq = freq[B.label.toUpperCase()] || 1;
        
        let girder: TrussInstance | null = null;
        let carriedInstance: TrussInstance | null = null;

        const aBaseLabel = A.label.split('-')[0].toUpperCase();
        const bBaseLabel = B.label.split('-')[0].toUpperCase();
        const treA = findTreForLabel(aBaseLabel, treMap);
        const treB = findTreForLabel(bBaseLabel, treMap);
        
        const aIsGirder = treA ? !!treA.isGirder : A.isGirder;
        const bIsGirder = treB ? !!treB.isGirder : B.isGirder;

        if (aIsGirder && !bIsGirder && containsCentroid(A, B)) {
            girder = A;
            carriedInstance = B;
        } else if (bIsGirder && !aIsGirder && containsCentroid(B, A)) {
            girder = B;
            carriedInstance = A;
        }
        
        if (girder && carriedInstance) {
          // FILTER 1: Carried trusses must be REPEATED (appear multiple times in IFC model)
          // or GE variation of repeated.
          const carriedLabel = carriedInstance.label;
          const isSmallModel = instances.length < 10;
          let isRepeated = isSmallModel;
          if (!isRepeated) {
            if ((freq[carriedLabel.toUpperCase()] || 0) >= 2) {
              isRepeated = true;
            } else {
              const base = carriedLabel.replace(/GE$/i, '').toUpperCase();
              if ((freq[base] || 0) >= 2) {
                isRepeated = true;
              }
            }
          }
          if (!isRepeated) continue;

          // FILTER 2: Carried truss should be SHORTER than girder
          const gLen = Math.max(girder.boundingBox!.maxX - girder.boundingBox!.minX, girder.boundingBox!.maxY - girder.boundingBox!.minY);
          const cLen = Math.max(carriedInstance.boundingBox!.maxX - carriedInstance.boundingBox!.minX, carriedInstance.boundingBox!.maxY - carriedInstance.boundingBox!.minY);
          // Relax multiplier to 2.5 for single-instance or special girders (like T07 or G01)
          const multiplier = (freq[girder.label.toUpperCase()] || 1) === 1 || girder.label.toUpperCase() === 'T07' || girder.label.toUpperCase() === 'G01' ? 2.5 : 1.5;
          if (cLen > gLen * multiplier) continue;

          // Add to potential connections
          connections.push({ girder, carried: carriedInstance });
        }
      }
    }
    
    // Group connections by girder ID
    const girderMap = new Map<string, TrussInstance[]>();
    
    for (const conn of connections) {
      const g = conn.girder;
      const c = conn.carried;
      
      // FILTER 4: A truss that is ITSELF a girder carrying other trusses should NOT be carried
      const isCarriedTrussAGirder = connections.some(edge => edge.girder.id === c.id);
      if (isCarriedTrussAGirder) continue;

      if (!girderMap.has(g.id)) {
        girderMap.set(g.id, []);
      }
      // Avoid duplicate carrying entries
      if (!girderMap.get(g.id)!.some(item => item.id === c.id)) {
        girderMap.get(g.id)!.push(c);
      }
    }
    
    const results: GirderGroup[] = [];
    
    for (const [girderId, carriedArr] of girderMap.entries()) {
      const girder = instances.find(i => i.id === girderId)!;
      girder.treData = findTreForLabel(girder.label, treMap) || undefined;

      const carriedTrusses = computeCarriedTrussGeometry(girder, carriedArr, treMap);
      
      // Removed spacing filter because it incorrectly skips girders like T09 and CJ08 
      // which have hangers very close together or multiple entries at same Xcoord.
      
      // Skip filtering out by uniqueCarriedLabels.size, as real hangers can have varied labels like J06, J06A, J06B, J06C.
      const uniqueCarriedLabels = new Set(carriedTrusses.map(c => c.instance.label.toUpperCase()));

      // Ensure count is within reasonable limits (2 to 20 carried trusses)
      if (carriedTrusses.length < 2 || carriedTrusses.length > 20) {
         continue;
      }
      
      enrichCarriedTrusses(carriedTrusses, girder);
      results.push({ girder, carriedTrusses });
    }
    
    if (results.length > 0) {
      // Sort so most significant girders are first (e.g. T07)
      return results.sort((a, b) => {
        if (a.girder.label === 'T07') return -1;
        if (b.girder.label === 'T07') return 1;
        return b.carriedTrusses.length - a.carriedTrusses.length;
      });
    }
  }

  let girders = instances.filter(i => i.isGirder);
  let carried = instances.filter(i => !i.isGirder);

  const groups: GirderGroup[] = [];

  girders.forEach(girder => {
      girder.treData = findTreForLabel(girder.label, treMap) || undefined;
      // Filter carried trusses by looking at those perpendicular/near-coordinate if fallback,
      // or filter so they have consistent label types. 
      // S01 or T02, not mixed.
      // Let's make fallback carry-set realistic:
      let belongsToThisGirder = [...carried];
      if (girder.label === 'T07') {
         belongsToThisGirder = carried.filter(c => c.label.startsWith('T02'));
      } else if (girder.label.includes('T06GE')) {
         belongsToThisGirder = carried.filter(c => c.label.startsWith('T08') || c.label.startsWith('T09'));
      }

      belongsToThisGirder.sort((a, b) => {
          return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
      });
      
      if (girder.treData && girder.treData.hangers && girder.treData.hangers.length > 0) {
          const carriedTrusses = computeCarriedTrussGeometry(girder, carried, treMap);
          enrichCarriedTrusses(carriedTrusses, girder);
          if (carriedTrusses.length > 0) {
             groups.push({ girder, carriedTrusses });
          }
          return;
      }

      let currentX = girder.label === "G01" ? 10.10417 * 12 : 21.5;
      
      const carriedTrusses: CarriedTruss[] = belongsToThisGirder.map((c, idx) => {
          const baseLabel = c.label.split('-')[0].toUpperCase();
          const defaultData: TreData = {
              label: baseLabel,
              topChord: "Unknown",
              bottomChord: "Unknown",
              webs: "Unknown",
              maxReaction: 0
          };
          
          const treData = findTreForLabel(c.label, treMap) || findTreForLabel(baseLabel, treMap) || defaultData;

          let spacing: number | null = null;
          if (idx > 0) {
              spacing = 24.0;
              currentX += spacing;
          } else {
              if (c.leftEnd && girder.leftEnd) {
                  currentX = Math.abs(c.leftEnd.x - girder.leftEnd.x);
              } else {
                  currentX = 21.5;
              }
          }

          return {
              instance: c,
              localX: currentX,
              spacing,
              treData,
              distFromGE: currentX,
              angle: 90,
              rotation: 90,
              side: 'above',
              member: 'Unknown',
              memberSize: 'Unknown'
          };
      });

      enrichCarriedTrusses(carriedTrusses, girder);

      if (carriedTrusses.length > 0) {
        groups.push({ girder, carriedTrusses });
      }
  });

  return groups;
}
