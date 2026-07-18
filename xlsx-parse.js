// Self-contained .xlsx parser for the browser.
// Unzips with DecompressionStream('deflate-raw'), reads the XML, and normalizes
// known column headers into canonical metric arrays: [[isoDate, value], ...].
// Produces the SAME shape as sample-data.js: { fileName, metrics }.
(function () {
  function readU16(b, o) { return b[o] | (b[o + 1] << 8); }
  function readU32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }

  async function unzip(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) { if (readU32(buf, i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('Not a valid .xlsx file (no ZIP end record found).');
    const count = readU16(buf, eocd + 10);
    let p = readU32(buf, eocd + 16);
    const files = {};
    for (let i = 0; i < count; i++) {
      const method = readU16(buf, p + 10);
      const compSize = readU32(buf, p + 20);
      const nameLen = readU16(buf, p + 28);
      const extraLen = readU16(buf, p + 30);
      const commentLen = readU16(buf, p + 32);
      const lho = readU32(buf, p + 42);
      const name = new TextDecoder().decode(buf.slice(p + 46, p + 46 + nameLen));
      const lnameLen = readU16(buf, lho + 26);
      const lextraLen = readU16(buf, lho + 28);
      const start = lho + 30 + lnameLen + lextraLen;
      const comp = buf.slice(start, start + compSize);
      files[name] = method === 0 ? comp : await inflateRaw(comp);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  function canon(h) {
    const s = (h || '').toString().toLowerCase().trim();
    if (!s) return null;
    if (s.indexOf('date') === 0) return 'date';
    if (s.indexOf('trend') >= 0) return 'trend';
    if (s.indexOf('weight') >= 0) return 'weight';
    if (s.indexOf('fat percent') >= 0 || s.indexOf('body fat') >= 0 || s.indexOf('fat %') >= 0 || s.indexOf('bodyfat') >= 0) return 'bodyfat';
    if (s.indexOf('calorie') >= 0 || s.indexOf('energy') >= 0) return 'calories';
    if (s.indexOf('protein') >= 0) return 'protein';
    if (s.indexOf('carb') >= 0) return 'carbs';
    if (s.indexOf('fat') === 0 || s.indexOf('fat (g)') >= 0) return 'fat';
    if (s.indexOf('expenditure') >= 0 || s.indexOf('tdee') >= 0 || s.indexOf('maintenance') >= 0) return 'expenditure';
    return null;
  }

  function excelDate(serial) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  // accept either an excel serial number, or an ISO/parseable date string
  function toIso(v) {
    if (typeof v === 'number' && isFinite(v)) {
      if (v > 1 && v < 80000) return excelDate(v); // plausible excel serial
      return null;
    }
    const s = ('' + v).trim();
    const t = Date.parse(s);
    if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
    return null;
  }

  function colLetter(ref) { const m = ref.match(/^[A-Z]+/); return m ? m[0] : null; }

  function parseSheet(xml, shared) {
    const headerByCol = {};
    const rows = [];
    const rowMatches = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
    for (const r of rowMatches) {
      const rn = parseInt((r.match(/<row r="(\d+)"/) || [])[1] || '0', 10);
      const cm = r.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
      const cells = {};
      for (const c of cm) {
        const ref = (c.match(/r="([A-Z]+\d+)"/) || [])[1];
        if (!ref) continue;
        const col = colLetter(ref);
        const isStr = /t="s"/.test(c);
        const isInline = /t="(inlineStr|str)"/.test(c);
        let val = null;
        const vm = c.match(/<v>([\s\S]*?)<\/v>/);
        const im = c.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        if (isStr && vm) val = shared[parseInt(vm[1], 10)];
        else if (isInline && im) val = im[1];
        else if (vm) { const n = parseFloat(vm[1]); val = isNaN(n) ? vm[1] : n; }
        if (val != null) cells[col] = val;
      }
      if (rn === 1 || (rows.length === 0 && Object.keys(headerByCol).length === 0 && hasText(cells))) {
        for (const k in cells) headerByCol[k] = cells[k];
      } else {
        rows.push(cells);
      }
    }
    return { headerByCol, rows };
  }
  function hasText(cells) { for (const k in cells) if (typeof cells[k] === 'string') return true; return false; }

  function decode(files, name) {
    if (!files[name]) return '';
    return new TextDecoder().decode(files[name]);
  }

  async function parseXlsxBuffer(arrayBuffer, fileName) {
    const buf = new Uint8Array(arrayBuffer);
    const files = await unzip(buf);

    // shared strings
    const shared = [];
    const ssx = decode(files, 'xl/sharedStrings.xml');
    if (ssx) {
      for (const m of ssx.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        const t = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('');
        shared.push(t);
      }
    }

    // sheet order
    const wbRels = decode(files, 'xl/_rels/workbook.xml.rels');
    const relMap = {};
    for (const m of wbRels.matchAll(/Id="([^"]+)"[^>]*?Target="([^"]+)"/g)) relMap[m[1]] = m[2];
    const wb = decode(files, 'xl/workbook.xml');
    const sheets = [];
    for (const m of wb.matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)) {
      sheets.push({ name: m[1].replace(/&amp;/g, '&'), target: relMap[m[2]] });
    }
    // fallback: just grab any worksheet files
    if (!sheets.length) {
      for (const n in files) if (/^xl\/worksheets\/sheet\d+\.xml$/.test(n)) sheets.push({ name: n, target: n.replace('xl/', '') });
    }

    const metrics = { weight: [], trend: [], bodyfat: [], calories: [], protein: [], carbs: [], fat: [], expenditure: [] };
    const seen = {}; for (const k in metrics) seen[k] = {};

    for (const sh of sheets) {
      if (!sh.target) continue;
      const tgt = 'xl/' + sh.target.replace(/^\//, '').replace(/^\.\//, '');
      const xml = decode(files, tgt);
      if (!xml) continue;
      const { headerByCol, rows } = parseSheet(xml, shared);
      let dateCol = null;
      const colMeta = {};
      for (const col in headerByCol) {
        const k = canon(headerByCol[col]);
        if (k === 'date' && !dateCol) dateCol = col;
        else if (k && k !== 'date') colMeta[col] = k;
      }
      if (!dateCol) continue;
      for (const row of rows) {
        const iso = toIso(row[dateCol]);
        if (!iso) continue;
        for (const col in colMeta) {
          const k = colMeta[col];
          let v = row[col];
          if (v == null) continue;
          if (typeof v !== 'number') { const n = parseFloat(v); if (isNaN(n)) continue; v = n; }
          if (v === 0 && k !== 'bodyfat') continue; // 0 == not-logged pad day
          if (seen[k][iso]) continue;
          seen[k][iso] = 1;
          metrics[k].push([iso, v]);
        }
      }
    }
    for (const k in metrics) metrics[k].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const total = Object.values(metrics).reduce((s, a) => s + a.length, 0);
    if (!total) throw new Error('No recognizable tracking columns found. Expected columns like Date, Weight, Calories, Expenditure, etc.');
    return { fileName: fileName || 'upload.xlsx', metrics };
  }

  window.parseXlsxFile = async function (fileOrBuffer, fileName) {
    let ab, name = fileName;
    if (fileOrBuffer instanceof ArrayBuffer) ab = fileOrBuffer;
    else if (fileOrBuffer && fileOrBuffer.arrayBuffer) { ab = await fileOrBuffer.arrayBuffer(); name = name || fileOrBuffer.name; }
    else throw new Error('parseXlsxFile expects a File/Blob or ArrayBuffer.');
    return parseXlsxBuffer(ab, name);
  };
})();
