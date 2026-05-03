import './style.css';
import { createIcons, FileSpreadsheet, Combine, SplitSquareVertical, X, Download } from 'lucide';

// Initialize Web Worker
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

// Initialize Lucide icons
createIcons({
  icons: {
    FileSpreadsheet,
    Combine,
    SplitSquareVertical,
    X,
    Download
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
const mergeDownloadBtn = document.getElementById('merge-download-btn');

mergeInput.addEventListener('change', (e) => {
  const newFiles = Array.from(e.target.files);
  mergeFiles = [...mergeFiles, ...newFiles];
  mergeDownloadBtn.style.display = 'none'; // Hide download btn when new files selected
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
      mergeDownloadBtn.style.display = 'none'; // Hide download btn when files removed
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
  mergeDownloadBtn.style.display = 'none'; // Hide download btn on drop
  updateMergeUI();
});

mergeBtn.addEventListener('click', () => {
  showLoading('İşlem arka planda başlatılıyor...');
  mergeDownloadBtn.style.display = 'none';

  // Listen to worker messages for this operation
  const onMessage = (e) => {
    const { type, message, blob } = e.data;
    if (type === 'progress') {
      showLoading(message);
    } else if (type === 'done') {
      worker.removeEventListener('message', onMessage);
      hideLoading();
      
      const url = URL.createObjectURL(blob);
      mergeDownloadBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = "Birlestirilmis_Excel.xlsx";
        a.click();
      };
      
      mergeDownloadBtn.style.display = 'flex';
      createIcons({ icons: { Download } });
    } else if (type === 'error') {
      worker.removeEventListener('message', onMessage);
      hideLoading();
      alert('Birleştirme sırasında hata oluştu: ' + message);
    }
  };

  worker.addEventListener('message', onMessage);
  worker.postMessage({ type: 'merge', data: { files: mergeFiles } });
});

// --- SPLIT LOGIC ---
const splitUploadArea = document.getElementById('split-upload-area');
const splitInput = document.getElementById('split-file');
const splitFileInfo = document.getElementById('split-file-info');
const splitRowsInput = document.getElementById('split-rows');
const splitBtn = document.getElementById('split-btn');
const splitDownloadBtn = document.getElementById('split-download-btn');

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
  splitDownloadBtn.style.display = 'none'; // Hide download btn when new file selected
}

splitBtn.addEventListener('click', () => {
  const rowLimit = parseInt(splitRowsInput.value);
  if (!rowLimit || rowLimit < 1) {
    alert('Lütfen geçerli bir satır sayısı girin.');
    return;
  }

  showLoading('İşlem arka planda başlatılıyor...');
  splitDownloadBtn.style.display = 'none';
  
  const onMessage = (e) => {
    const { type, message, blob } = e.data;
    if (type === 'progress') {
      showLoading(message);
    } else if (type === 'done') {
      worker.removeEventListener('message', onMessage);
      hideLoading();
      
      const url = URL.createObjectURL(blob);
      splitDownloadBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `Bolunmus_${splitFile.name}.zip`;
        a.click();
      };
      
      splitDownloadBtn.style.display = 'flex';
      createIcons({ icons: { Download } });
    } else if (type === 'error') {
      worker.removeEventListener('message', onMessage);
      hideLoading();
      alert('Bölme sırasında hata oluştu: ' + message);
    }
  };

  worker.addEventListener('message', onMessage);
  worker.postMessage({ type: 'split', data: { file: splitFile, rowLimit } });
});



function showLoading(text) {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}


