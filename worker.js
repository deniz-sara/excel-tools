import * as XLSX from 'xlsx';
import JSZip from 'jszip';

// Helper to allow garbage collection
const yieldToEventLoop = () => new Promise(resolve => setTimeout(resolve, 0));

// FileReader is not available in workers, use standard arrayBuffer()
async function readFileAsArrayBuffer(file) {
  return await file.arrayBuffer();
}

// Helpers for custom XLSX XML generation
function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe).replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

function numToCol(num) {
  let str = '', q, r;
  while (num >= 0) {
    q = Math.floor(num / 26);
    r = num % 26;
    str = String.fromCharCode(65 + r) + str;
    num = q - 1;
  }
  return str;
}

self.onmessage = async (e) => {
  const { type, data } = e.data;

  try {
    if (type === 'merge') {
      await handleMerge(data.files);
    } else if (type === 'split') {
      await handleSplit(data.file, data.rowLimit);
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};

async function handleMerge(files) {
  let combinedData = [];
  let isFirstFile = true;

  for (let i = 0; i < files.length; i++) {
    self.postMessage({ type: 'progress', message: `${i + 1}. dosya okunuyor...` });
    await yieldToEventLoop();

    let data;
    try {
      data = await readFileAsArrayBuffer(files[i]);
    } catch(e) { throw new Error('[FILE_READ] ' + e.message); }
    
    let workbook;
    try {
      workbook = XLSX.read(data, { type: 'array' });
    } catch(e) { throw new Error('[XLSX_READ] ' + e.message); }
    
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    self.postMessage({ type: 'progress', message: `${i + 1}. dosya işleniyor...` });
    await yieldToEventLoop();

    let json;
    try {
      json = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
    } catch(e) { throw new Error('[SHEET_TO_JSON] ' + e.message); }
    
    if (json.length === 0) continue;

    try {
      if (isFirstFile) {
        const chunkSize = 50000;
        for (let j = 0; j < json.length; j += chunkSize) {
          combinedData = combinedData.concat(json.slice(j, j + chunkSize));
          await yieldToEventLoop();
        }
        isFirstFile = false;
      } else {
        const sliced = json.slice(1);
        const chunkSize = 50000;
        for (let j = 0; j < sliced.length; j += chunkSize) {
          combinedData = combinedData.concat(sliced.slice(j, j + chunkSize));
          await yieldToEventLoop();
        }
      }
    } catch(e) { throw new Error('[CONCAT] ' + e.message); }
    
    json = null;
    workbook = null;
    data = null;
    await yieldToEventLoop();
  }

  self.postMessage({ type: 'progress', message: 'Veriler XML formatına çevriliyor (Bu işlem biraz sürebilir)...' });
  await yieldToEventLoop();

  let sheetBlob;
  try {
    let blobParts = [];
    blobParts.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n<sheetData>\n`);

    let currentChunk = '';
    for (let r = 0; r < combinedData.length; r++) {
      let rowStr = `<row r="${r + 1}">`;
      let row = combinedData[r];
      for (let c = 0; c < row.length; c++) {
        let val = row[c];
        if (val !== undefined && val !== null && val !== '') {
          let type = typeof val === 'number' ? 'n' : 'inlineStr';
          let cellRef = numToCol(c) + (r + 1);
          if (type === 'n') {
            rowStr += `<c r="${cellRef}" t="n"><v>${val}</v></c>`;
          } else {
            rowStr += `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(val)}</t></is></c>`;
          }
        }
      }
      rowStr += `</row>\n`;
      currentChunk += rowStr;
      
      if (r % 10000 === 0) {
        blobParts.push(currentChunk);
        currentChunk = '';
        self.postMessage({ type: 'progress', message: `XML Oluşturuluyor: %${Math.round((r / combinedData.length) * 100)}` });
        await yieldToEventLoop();
      }
    }
    
    if (currentChunk) blobParts.push(currentChunk);
    blobParts.push(`</sheetData>\n</worksheet>`);
    
    sheetBlob = new Blob(blobParts, { type: 'application/xml' });
    blobParts = null;
  } catch(e) { throw new Error('[XML_GEN] ' + e.message); }
  
  combinedData = null; // Free memory
  await yieldToEventLoop();

  self.postMessage({ type: 'progress', message: 'Maksimum seviyede sıkıştırılıyor (Level 9)...' });
  await yieldToEventLoop();

  let compressedBlob;
  try {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n</Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n</Relationships>`);
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n  <sheets><sheet name="Birlesik" sheetId="1" r:id="rId1"/></sheets>\n</workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\n</Relationships>`);
    zip.file('xl/worksheets/sheet1.xml', sheetBlob);

    compressedBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });
  } catch(e) { throw new Error('[ZIP_GEN] ' + e.message); }
  
  self.postMessage({ type: 'done', blob: compressedBlob });
  
  self.postMessage({ type: 'done', blob: compressedBlob });
}

async function handleSplit(file, rowLimit) {
  self.postMessage({ type: 'progress', message: 'Dosya okunuyor...' });
  await yieldToEventLoop();

  const data = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(data, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  
  self.postMessage({ type: 'progress', message: 'Veriler ayrıştırılıyor...' });
  await yieldToEventLoop();

  let json = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
  if(json.length <= 1) {
    throw new Error('Seçilen dosyada bölünecek yeterli veri yok.');
  }

  const header = json[0];
  const rows = json.slice(1);
  const numFiles = Math.ceil(rows.length / rowLimit);

  const zip = new JSZip();

  for (let i = 0; i < numFiles; i++) {
    self.postMessage({ type: 'progress', message: `Parça ${i + 1}/${numFiles} oluşturuluyor...` });
    await yieldToEventLoop();

    const chunk = rows.slice(i * rowLimit, (i + 1) * rowLimit);
    const chunkWithHeader = [header, ...chunk];
    
    const newWs = XLSX.utils.aoa_to_sheet(chunkWithHeader);
    const newWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWb, newWs, "Parca");
    
    const wbout = XLSX.write(newWb, { bookType:'xlsx', type:'array', compression: true, bookSST: true });
    const fileName = `Parca_${i + 1}.xlsx`;
    zip.file(fileName, wbout);
  }

  self.postMessage({ type: 'progress', message: 'ZIP dosyası sıkıştırılıyor...' });
  await yieldToEventLoop();

  const zipBlob = await zip.generateAsync({ 
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
  
  self.postMessage({ type: 'done', blob: zipBlob });
}
