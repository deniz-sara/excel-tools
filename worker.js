import * as XLSX from 'xlsx';
import JSZip from 'jszip';

// Helper to allow garbage collection
const yieldToEventLoop = () => new Promise(resolve => setTimeout(resolve, 0));

// FileReader is not available in workers, use standard arrayBuffer()
async function readFileAsArrayBuffer(file) {
  return await file.arrayBuffer();
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

    const data = await readFileAsArrayBuffer(files[i]);
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    self.postMessage({ type: 'progress', message: `${i + 1}. dosya işleniyor...` });
    await yieldToEventLoop();

    let json = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
    
    if (json.length === 0) continue;

    if (isFirstFile) {
      // Chunk the concatenation to save memory
      const chunkSize = 50000;
      for (let j = 0; j < json.length; j += chunkSize) {
        combinedData = combinedData.concat(json.slice(j, j + chunkSize));
        await yieldToEventLoop();
      }
      isFirstFile = false;
    } else {
      // Skip header row
      const sliced = json.slice(1);
      const chunkSize = 50000;
      for (let j = 0; j < sliced.length; j += chunkSize) {
        combinedData = combinedData.concat(sliced.slice(j, j + chunkSize));
        await yieldToEventLoop();
      }
    }
    
    // Clear variables to free memory early
    json = null;
    await yieldToEventLoop();
  }

  self.postMessage({ type: 'progress', message: 'Veriler birleştiriliyor...' });
  await yieldToEventLoop();

  const newWs = XLSX.utils.aoa_to_sheet(combinedData);
  combinedData = null; // Free memory
  await yieldToEventLoop();

  const newWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWb, newWs, "Birlesik");
  
  self.postMessage({ type: 'progress', message: 'Excel dosyası oluşturuluyor...' });
  await yieldToEventLoop();

  const wbout = XLSX.write(newWb, { bookType: 'xlsx', type: 'array', bookSST: true });
  
  self.postMessage({ type: 'progress', message: 'Maksimum seviyede sıkıştırılıyor (Level 9)...' });
  await yieldToEventLoop();

  const zip = await JSZip.loadAsync(wbout);
  const compressedBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
  
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
