// Regenerates data/us-zip-codes.tsv.gz, the offline table lib/zipCodes.js reads
// to turn a ZIP code into coordinates and a place name.
//
// Source: the GeoNames postal code dump for the United States,
// https://download.geonames.org/export/zip/US.zip, licensed under Creative
// Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/). The
// README credits GeoNames, as the license requires.
//
// Run with `npm run build:zip-codes` from back-end/, then commit the file. Each
// line of the output is `ZIP<TAB>latitude<TAB>longitude<TAB>Place, ST`, sorted
// by ZIP. Military (APO/FPO) codes have no state and are left out, and a ZIP
// listed twice keeps its first entry. Coordinates are rounded to 3 decimals
// (about 100 m), well inside a ZIP code's own extent.
import fs from "node:fs";
import zlib from "node:zlib";

const SOURCE_URL = "https://download.geonames.org/export/zip/US.zip";
const ENTRY_NAME = "US.txt";
const OUTPUT = new URL("../data/us-zip-codes.tsv.gz", import.meta.url);

// Reads one file out of a zip archive, which Node cannot open on its own.
function unzipEntry(archive, name) {
  const END_OF_DIRECTORY = 0x06054b50;
  let end = archive.length - 22;
  while (end >= 0 && archive.readUInt32LE(end) !== END_OF_DIRECTORY) end -= 1;
  if (end < 0) throw new Error("not a zip archive");

  const entries = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  for (let i = 0; i < entries; i += 1) {
    const method = archive.readUInt16LE(at + 10);
    const compressedSize = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const localHeader = archive.readUInt32LE(at + 42);
    const entryName = archive.toString("utf8", at + 46, at + 46 + nameLength);

    if (entryName === name) {
      const dataStart =
        localHeader + 30 + archive.readUInt16LE(localHeader + 26) + archive.readUInt16LE(localHeader + 28);
      const data = archive.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`unsupported zip compression method ${method}`);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${name} not found in the archive`);
}

async function main() {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`GET ${SOURCE_URL} answered ${res.status}`);
  const text = unzipEntry(Buffer.from(await res.arrayBuffer()), ENTRY_NAME).toString("utf8");

  const rows = new Map();
  for (const line of text.split("\n")) {
    // country, ZIP, place, state name, state code, county, county code, ..., lat, lon, accuracy
    const fields = line.split("\t");
    const [, zip, place, , state] = fields;
    const latitude = Number(fields[9]);
    const longitude = Number(fields[10]);
    if (!/^\d{5}$/.test(zip ?? "") || !place || !state || rows.has(zip)) continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || fields[9] === "") continue;

    rows.set(zip, [zip, latitude.toFixed(3), longitude.toFixed(3), `${place}, ${state}`].join("\t"));
  }

  const lines = [...rows.keys()].sort().map((zip) => rows.get(zip));
  const gzipped = zlib.gzipSync(`${lines.join("\n")}\n`, { level: 9 });
  fs.writeFileSync(OUTPUT, gzipped);
  console.log(`Wrote ${lines.length} ZIP codes (${gzipped.length} bytes) to ${OUTPUT.pathname}`);
}

main().catch((err) => {
  console.error("Failed to build the ZIP code table:", err?.message || err);
  process.exit(1);
});
