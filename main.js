import './style.css';
import { createIcons, FileSpreadsheet, Combine, SplitSquareVertical, X } from 'lucide';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

// Initialize Lucide icons
createIcons({
  icons: {
    FileSpreadsheet,
    Combine,
    SplitSquareVertical,
    X
  }
});

// App State
let mergeFiles = [];
let splitFile = null;

// DOM Elements
const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Tabs Logic
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
  });
});

// --- MERGE LOGIC ---
const mergeUploadArea = document.getElementById('merge-upload-area');
const mergeInput = document.getElementById('merge-files');
const mergeFileList = document.getElementById('merge-file-list');
const mergeBtn = document.getElementById('merge-btn');

mergeInput.addEventListener('change', (e) => {
  const newFiles = Array.from(e.target.files);
  mergeFiles = [...mergeFiles, ...newFiles];
  updateMergeUI();
  e.target.value = ''; // Reset input
});

function updateMergeUI() {
  mergeFileList.innerHTML = '';
  mergeFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-item-name">${file.name}</span>
      <button class="file-item-remove" data-index="${index}">
        <i data-lucide="x"></i>
      </button>
    `;
    mergeFileList.appendChild(item);
  });
  
  createIcons({ icons: { X } });
  
  document.querySelectorAll('.file-item-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      mergeFiles.splice(idx, 1);
      updateMergeUI();
    });
  });

  mergeBtn.disabled = mergeFiles.length < 2;
}

// Drag & Drop
['dragover', 'dragleave', 'drop'].forEach(evt => {
  mergeUploadArea.addEventListener(evt, (e) => {
    e.preventDefault();
    if(evt === 'dragover') mergeUploadArea.classList.add('dragover');
    else mergeUploadArea.classList.remove('dragover');
  });
});

mergeUploadArea.addEventListener('drop', (e) => {
  const newFiles = Array.from(e.dataTransfer.files).filter(f => 
    f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv')
  );
  mergeFiles = [...mergeFiles, ...newFiles];
  updateMergeUI();
});

mergeBtn.addEventListener('click', async () => {
  showLoading('Oluşturuluyor, lütfen bekleyin...');
  
  // Use setTimeout to allow UI to update to show loading spinner before main thread blocks
  setTimeout(async () => {
    try {
      let combinedData = [];
      let isFirstFile = true;

      for (const file of mergeFiles) {
        const data = await readFileAsArrayBuffer(file);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
        
        if (json.length === 0) continue;

        if (isFirstFile) {
          combinedData = combinedData.concat(json);
          isFirstFile = false;
        } else {
          // Skip header row
          combinedData = combinedData.concat(json.slice(1));
        }
      }

      const newWs = XLSX.utils.aoa_to_sheet(combinedData);
      const newWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(newWb, newWs, "Birlesik");
      
      XLSX.writeFile(newWb, "Birlestirilmis_Excel.xlsx", { compression: true, bookSST: true });
    } catch (err) {
      alert('Birleştirme sırasında hata oluştu: ' + err.message);
    } finally {
      hideLoading();
    }
  }, 100);
});

// --- SPLIT LOGIC ---
const splitUploadArea = document.getElementById('split-upload-area');
const splitInput = document.getElementById('split-file');
const splitFileInfo = document.getElementById('split-file-info');
const splitRowsInput = document.getElementById('split-rows');
const splitBtn = document.getElementById('split-btn');

splitInput.addEventListener('change', (e) => {
  if(e.target.files.length > 0) processSplitFile(e.target.files[0]);
});

// Drag & Drop
['dragover', 'dragleave', 'drop'].forEach(evt => {
  splitUploadArea.addEventListener(evt, (e) => {
    e.preventDefault();
    if(evt === 'dragover') splitUploadArea.classList.add('dragover');
    else splitUploadArea.classList.remove('dragover');
  });
});

splitUploadArea.addEventListener('drop', (e) => {
  if(e.dataTransfer.files.length > 0) {
    const f = e.dataTransfer.files[0];
    if(f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv')) {
      processSplitFile(f);
    }
  }
});

function processSplitFile(file) {
  splitFile = file;
  splitFileInfo.textContent = `Seçili Dosya: ${file.name}`;
  splitFileInfo.style.display = 'block';
  splitBtn.disabled = false;
}

splitBtn.addEventListener('click', async () => {
  const rowLimit = parseInt(splitRowsInput.value);
  if (!rowLimit || rowLimit < 1) {
    alert('Lütfen geçerli bir satır sayısı girin.');
    return;
  }

  showLoading('Dosya bölünüyor ve ZIP oluşturuluyor...');
  
  setTimeout(async () => {
    try {
      const data = await readFileAsArrayBuffer(splitFile);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
      if(json.length <= 1) {
        alert('Seçilen dosyada bölünecek yeterli veri yok.');
        hideLoading();
        return;
      }

      const header = json[0];
      const rows = json.slice(1);
      
      const numFiles = Math.ceil(rows.length / rowLimit);

      const zip = new JSZip();

      for (let i = 0; i < numFiles; i++) {
        const chunk = rows.slice(i * rowLimit, (i + 1) * rowLimit);
        const chunkWithHeader = [header, ...chunk];
        
        const newWs = XLSX.utils.aoa_to_sheet(chunkWithHeader);
        const newWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWb, newWs, "Parca");
        
        const wbout = XLSX.write(newWb, { bookType:'xlsx', type:'array', compression: true, bookSST: true });
        const fileName = `Parca_${i + 1}.xlsx`;
        zip.file(fileName, wbout);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Bolunmus_${splitFile.name}.zip`;
      a.click();
      URL.revokeObjectURL(url);

    } catch (err) {
      alert('Bölme sırasında hata oluştu: ' + err.message);
    } finally {
      hideLoading();
    }
  }, 100);
});

// --- HELPERS ---
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('Dosya okunamadı.'));
    reader.readAsArrayBuffer(file);
  });
}

function showLoading(text) {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}
