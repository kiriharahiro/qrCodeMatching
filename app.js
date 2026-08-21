/**
 * QR Matching & Sync App - Controller logic (Updated with Master spreadsheet integration)
 */

// State Object
const state = {
  currentStep: 'A', // 'A', 'B', 'COMPLETED'
  valueA: null,
  valueB: null,
  isScanningPaused: false,
  scanner: null,
  history: [],
  settings: {
    gasUrl: '',
    deviceName: 'Chromebook-01',
    resetDelay: 2000, // ms
    audioFeedback: 'on'
  },
  isCameraActive: false
};

// UI Elements
const el = {
  toggleCameraBtn: document.getElementById('toggle-camera-btn'),
  resetWorkflowBtn: document.getElementById('reset-workflow-btn'),
  openSettingsBtn: document.getElementById('open-settings-btn'),
  closeSettingsBtn: document.getElementById('close-settings-btn'),
  saveSettingsBtn: document.getElementById('save-settings-btn'),
  settingsModal: document.getElementById('settings-modal'),
  
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  cameraContainer: document.getElementById('camera-container'),
  
  stepA: document.getElementById('step-A'),
  stepB: document.getElementById('step-B'),
  valA: document.getElementById('val-A'),
  valB: document.getElementById('val-B'),
  matchBanner: document.getElementById('match-status-banner'),
  
  historyList: document.getElementById('history-list'),
  historyCount: document.getElementById('history-count'),
  clearHistoryBtn: document.getElementById('clear-history-btn'),
  
  offlineBanner: document.getElementById('offline-banner'),
  
  // Result Modal elements
  resultModal: document.getElementById('result-modal'),
  resultSuccessView: document.getElementById('result-success-view'),
  resultFailureView: document.getElementById('result-failure-view'),
  resultUserName: document.getElementById('result-user-name'),
  resultThumbnail: document.getElementById('result-thumbnail'),
  imageSpinner: document.getElementById('image-loading-spinner'),
  closeResultBtn: document.getElementById('close-result-btn'),
  
  // Settings Inputs
  gasUrlInput: document.getElementById('gas-url-input'),
  deviceNameInput: document.getElementById('device-name-input'),
  resetDelaySelect: document.getElementById('reset-delay-select'),
  audioFeedbackSelect: document.getElementById('audio-feedback-select')
};

// --- Web Audio API Synth for Beeps ---
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playBeep(type) {
  if (state.settings.audioFeedback !== 'on') return;
  initAudio();
  if (!audioCtx) return;

  // Audio Context resume if suspended (browser security)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;

  if (type === 'scan') {
    // Quick tick sound
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    osc.start(now);
    osc.stop(now + 0.08);
  } else if (type === 'success') {
    // Beautiful double beep
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now); // A5
    osc.frequency.setValueAtTime(1046.5, now + 0.08); // C6
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.setValueAtTime(0.15, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    osc.start(now);
    osc.stop(now + 0.25);
  } else if (type === 'error') {
    // Low double warning buzz
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now); // A3
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.setValueAtTime(0, now + 0.1);
    gain.gain.setValueAtTime(0.2, now + 0.15);
    osc.frequency.setValueAtTime(200, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc.start(now);
    osc.stop(now + 0.35);
  }
}

// --- App Config & LocalStorage ---
function loadSettings() {
  const saved = localStorage.getItem('qr_match_settings');
  if (saved) {
    try {
      state.settings = { ...state.settings, ...JSON.parse(saved) };
    } catch (e) {
      console.error('Settings parse error, using defaults', e);
    }
  }
  // Reflect in UI
  el.gasUrlInput.value = state.settings.gasUrl || '';
  el.deviceNameInput.value = state.settings.deviceName || 'Chromebook-01';
  el.resetDelaySelect.value = state.settings.resetDelay;
  el.audioFeedbackSelect.value = state.settings.audioFeedback;
}

function saveSettings() {
  state.settings.gasUrl = el.gasUrlInput.value.trim();
  state.settings.deviceName = el.deviceNameInput.value.trim() || 'Chromebook-01';
  state.settings.resetDelay = parseInt(el.resetDelaySelect.value, 10);
  state.settings.audioFeedback = el.audioFeedbackSelect.value;
  
  localStorage.setItem('qr_match_settings', JSON.stringify(state.settings));
  hideSettings();
}

// --- History UI ---
function loadHistory() {
  const saved = localStorage.getItem('qr_match_history');
  if (saved) {
    try {
      state.history = JSON.parse(saved);
    } catch (e) {
      state.history = [];
    }
  }
  renderHistory();
}

function addHistoryItem(item) {
  state.history.unshift(item);
  // Cap at 100 entries locally to avoid memory issues
  if (state.history.length > 100) {
    state.history.pop();
  }
  localStorage.setItem('qr_match_history', JSON.stringify(state.history));
  renderHistory();
}

function renderHistory() {
  el.historyCount.textContent = `${state.history.length} 件`;
  
  if (state.history.length === 0) {
    el.historyList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
        </svg>
        <p>スキャンした履歴がここに表示されます</p>
      </div>`;
    return;
  }

  el.historyList.innerHTML = state.history.map(item => {
    const timeStr = new Date(item.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = new Date(item.timestamp).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
    const isMatch = item.isMatch;
    
    return `
      <div class="history-item">
        <div class="history-status-icon ${isMatch ? 'match' : 'unmatch'}">
          ${isMatch ? 
            `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>` : 
            `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
          }
        </div>
        <div class="history-details">
          <div class="history-details-codes">
            <div class="history-code-row">
              <span class="history-code-label">照合元:</span>
              <span class="history-code-val" title="${escapeHtml(item.valA)}">${escapeHtml(item.valA)}</span>
            </div>
            <div class="history-code-row">
              <span class="history-code-label">照合先:</span>
              <span class="history-code-val" title="${escapeHtml(item.valB)}">${escapeHtml(item.valB)}</span>
            </div>
          </div>
          <div class="history-meta">
            <span>判定: ${isMatch ? '一致' : '不一致'} | ${escapeHtml(item.deviceName || '')}</span>
          </div>
        </div>
        <div class="history-time">
          <div>${dateStr} ${timeStr}</div>
          <span class="sync-badge ${item.synced ? 'synced' : 'pending'}">
            ${item.synced ? '同期済' : '未送信'}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

function clearHistory() {
  if (confirm('すべての照合履歴を消去してもよろしいですか？（※スプレッドシートのログは消えません）')) {
    state.history = [];
    localStorage.setItem('qr_match_history', JSON.stringify(state.history));
    renderHistory();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Settings Modal Toggle ---
function showSettings() {
  el.settingsModal.classList.add('active');
}

function hideSettings() {
  el.settingsModal.classList.remove('active');
}

// --- QR Scanner Implementation ---
function initScanner() {
  // Config for Html5Qrcode
  state.scanner = new Html5Qrcode("reader");
}

function toggleCamera() {
  if (state.isCameraActive) {
    stopCamera();
  } else {
    startCamera();
  }
}

function startCamera() {
  initAudio();
  el.toggleCameraBtn.disabled = true;
  el.toggleCameraBtn.querySelector('span').textContent = '起動中...';

  // Request camera list
  Html5Qrcode.getCameras().then(devices => {
    if (devices && devices.length > 0) {
      // Prefer back camera if available, else first camera
      let cameraId = devices[0].id;
      const backCamera = devices.find(device => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('environment'));
      if (backCamera) {
        cameraId = backCamera.id;
      }

      state.scanner.start(
        cameraId,
        {
          fps: 15, // Increase scan frame rate for responsiveness
          qrbox: (width, height) => {
            // Expand the scan target box slightly (0.65 -> 0.75) to allow further capture
            const size = Math.min(width, height) * 0.75;
            return { width: size, height: size };
          },
          // Ask browser for high resolution constraints to clarify tiny dots
          videoConstraints: {
            width: { min: 640, ideal: 1280, max: 1920 },
            height: { min: 480, ideal: 720, max: 1080 },
            facingMode: "environment"
          }
        },
        onScanSuccess,
        onScanFailure
      ).then(() => {
        state.isCameraActive = true;
        el.toggleCameraBtn.disabled = false;
        el.toggleCameraBtn.classList.remove('btn-primary');
        el.toggleCameraBtn.querySelector('span').textContent = 'カメラ停止';
        el.statusDot.className = 'status-dot active';
        el.statusText.textContent = 'スキャン中';
      }).catch(err => {
        console.error('Camera startup failed', err);
        alert('カメラの起動に失敗しました。カメラ権限を確認してください。');
        resetCameraButtonState();
      });
    } else {
      alert('利用可能なカメラが見つかりません。');
      resetCameraButtonState();
    }
  }).catch(err => {
    console.error('Failed to get cameras', err);
    alert('カメラデバイスの取得に失敗しました。');
    resetCameraButtonState();
  });
}

function stopCamera() {
  if (!state.isCameraActive || !state.scanner) return;
  
  el.toggleCameraBtn.disabled = true;
  el.toggleCameraBtn.querySelector('span').textContent = '停止中...';

  state.scanner.stop().then(() => {
    state.isCameraActive = false;
    el.toggleCameraBtn.disabled = false;
    el.toggleCameraBtn.classList.add('btn-primary');
    el.toggleCameraBtn.querySelector('span').textContent = 'カメラ起動';
    el.statusDot.className = 'status-dot';
    el.statusText.textContent = 'カメラ未起動';
  }).catch(err => {
    console.error('Camera stop failed', err);
    resetCameraButtonState();
  });
}

function resetCameraButtonState() {
  el.toggleCameraBtn.disabled = false;
  el.toggleCameraBtn.classList.add('btn-primary');
  el.toggleCameraBtn.querySelector('span').textContent = 'カメラ起動';
  el.statusDot.className = 'status-dot';
  el.statusText.textContent = 'カメラ未起動';
  state.isCameraActive = false;
}

function onScanSuccess(decodedText, decodedResult) {
  if (state.isScanningPaused || state.currentStep === 'COMPLETED') return;

  // Duplicate scan check (same raw code within B workflow)
  if (state.currentStep === 'B' && state.valueA === decodedText) {
    return;
  }

  handleScannedValue(decodedText);
}

function onScanFailure(error) {
  // We ignore normal scanning frames where no QR is found
}

// --- Matching & Check-digit Handling Logic ---

/**
 * Strips the check digit (hyphen and anything after it) and normalizes case.
 * If the input is a Google Forms pre-filled URL, extracts the final 8 characters first.
 */
function cleanQrCode(code) {
  if (!code) return '';
  let cleaned = code.trim();
  
  // Extract final 8 characters if it's a URL or long string
  if (cleaned.startsWith('http') || cleaned.length > 20) {
    cleaned = cleaned.slice(-8);
  }
  
  return cleaned.split('-')[0].trim().toUpperCase();
}

/**
 * Converts Google Drive share URL to a direct downloadable image link compatible with <img>
 */
function convertDriveUrl(url) {
  if (!url) return '';
  
  // If already directly queryable or formatted, return as-is
  if (url.includes('drive.google.com/uc') || url.startsWith('data:') || url.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i)) {
    return url;
  }

  let fileId = '';
  if (url.includes('id=')) {
    const matches = url.match(/id=([^&]+)/);
    if (matches && matches[1]) {
      fileId = matches[1];
    }
  } else if (url.includes('/file/d/')) {
    const matches = url.match(/\/file\/d\/([^/]+)/);
    if (matches && matches[1]) {
      fileId = matches[1];
    }
  }
  
  if (fileId) {
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }
  
  return url;
}

function handleScannedValue(val) {
  if (state.currentStep === 'A') {
    state.valueA = val;
    el.valA.textContent = val;
    el.valA.classList.remove('placeholder');
    
    el.stepA.classList.remove('active');
    el.stepA.classList.add('completed');
    el.stepB.classList.add('active');
    
    playBeep('scan');
    state.currentStep = 'B';
    
    // Brief temporary scanning lock to prevent immediate double-read
    pauseScanning(600);
    
  } else if (state.currentStep === 'B') {
    state.valueB = val;
    el.valB.textContent = val;
    el.valB.classList.remove('placeholder');
    
    el.stepB.classList.remove('active');
    el.stepB.classList.add('completed');
    
    state.currentStep = 'COMPLETED';
    evaluateMatch();
  }
}

function pauseScanning(duration) {
  state.isScanningPaused = true;
  setTimeout(() => {
    state.isScanningPaused = false;
  }, duration);
}

// Result Modal Control
let resultAutoCloseTimer = null;

function showResultPopup(isSuccess, name, imageUrl) {
  if (resultAutoCloseTimer) clearTimeout(resultAutoCloseTimer);

  // Lock camera scanning during result overlay
  state.isScanningPaused = true;
  
  el.resultModal.classList.add('active');

  if (isSuccess) {
    el.resultSuccessView.style.display = 'flex';
    el.resultFailureView.style.display = 'none';
    el.resultUserName.textContent = name || '取得中...';

    if (imageUrl) {
      el.imageSpinner.style.display = 'block';
      el.resultThumbnail.style.display = 'none';
      
      const directUrl = convertDriveUrl(imageUrl);
      el.resultThumbnail.src = directUrl;
      
      el.resultThumbnail.onload = () => {
        el.imageSpinner.style.display = 'none';
        el.resultThumbnail.style.display = 'block';
      };
      
      el.resultThumbnail.onerror = () => {
        el.imageSpinner.style.display = 'none';
        el.resultThumbnail.style.display = 'none';
        el.resultUserName.textContent = `${name || ''} (画像の取得に失敗しました)`;
      };
    } else {
      el.imageSpinner.style.display = 'none';
      el.resultThumbnail.style.display = 'none';
      el.resultThumbnail.src = '';
    }
  } else {
    el.resultSuccessView.style.display = 'none';
    el.resultFailureView.style.display = 'flex';
  }

  // Automatic reset configuration
  if (state.settings.resetDelay > 0) {
    resultAutoCloseTimer = setTimeout(() => {
      hideResultPopup();
    }, state.settings.resetDelay);
  }
}

function hideResultPopup() {
  if (resultAutoCloseTimer) clearTimeout(resultAutoCloseTimer);

  el.resultModal.classList.remove('active');
  el.resultThumbnail.src = '';
  el.resultThumbnail.style.display = 'none';
  el.imageSpinner.style.display = 'block';
  
  // Re-enable scanning workflow
  resetWorkflow();
  state.isScanningPaused = false;
}

function evaluateMatch() {
  // Compare values after removing check digits
  const cleanA = cleanQrCode(state.valueA);
  const cleanB = cleanQrCode(state.valueB);
  const isMatch = (cleanA === cleanB);
  
  const timestamp = new Date().toISOString();
  const logItem = {
    id: 'qr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    timestamp: timestamp,
    valA: state.valueA, // Send raw to GAS so it can match check digit C column in Master Sheet
    valB: state.valueB,
    cleanKey: cleanA, // also send cleaned key
    isMatch: isMatch,
    deviceName: state.settings.deviceName,
    synced: false
  };

  if (isMatch) {
    // UI Banner success updates
    el.matchBanner.className = 'match-status-banner success';
    el.matchBanner.textContent = '一致 (MATCH SUCCESS)';
    el.cameraContainer.className = 'camera-container success';
    playBeep('success');

    // Show popup immediately in loading state
    showResultPopup(true, '作品データをスプレッドシートからロード中...', null);

    // Send payload to GAS, handling name/image response
    syncLogItem(logItem, (success, data) => {
      if (success && data) {
        // Redraw popup with real master name and image
        showResultPopup(true, data.name, data.imageUrl);
      } else {
        // Fallback display if spreadsheet write succeeded but returned empty, or request error
        showResultPopup(true, '照合完了 (お名前はシートより直接ご確認ください)', null);
      }
    });
  } else {
    // UI Banner failure updates
    el.matchBanner.className = 'match-status-banner error';
    el.matchBanner.textContent = '不一致 (MISMATCH ERROR)';
    el.cameraContainer.className = 'camera-container error';
    el.statusDot.className = 'status-dot matching-error';
    playBeep('error');

    // Show Failure fullscreen popup immediately
    showResultPopup(false);

    // Write unmatched log in background
    syncLogItem(logItem);
  }

  // Save to local logs
  addHistoryItem(logItem);
}

function resetWorkflow() {
  state.currentStep = 'A';
  state.valueA = null;
  state.valueB = null;
  state.isScanningPaused = false;

  // Reset UI classes
  el.stepA.className = 'workflow-step active';
  el.stepB.className = 'workflow-step';
  
  el.valA.textContent = 'スキャンしてください...';
  el.valA.classList.add('placeholder');
  
  el.valB.textContent = 'スキャンしてください...';
  el.valB.classList.add('placeholder');

  el.matchBanner.className = 'match-status-banner';
  el.matchBanner.textContent = '照合結果をここに表示';
  
  el.cameraContainer.className = 'camera-container';
  
  if (state.isCameraActive) {
    el.statusDot.className = 'status-dot active';
    el.statusText.textContent = 'スキャン中';
  } else {
    el.statusDot.className = 'status-dot';
    el.statusText.textContent = 'カメラ未起動';
  }
}

// --- Sync engine / GAS Communication (Updated to handle CORS-free JSONP) ---
function syncLogItem(item, callback) {
  if (!state.settings.gasUrl) {
    console.log('GAS URL is not configured. Log saved locally.');
    if (callback) callback(false, null);
    return;
  }

  // If we don't need a response (offline background resync), we can use POST no-cors
  if (!callback) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    fetch(state.settings.gasUrl, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify(item),
      signal: controller.signal
    })
    .then(() => {
      clearTimeout(timeoutId);
      markAsSynced(item.id);
    })
    .catch(err => {
      clearTimeout(timeoutId);
      console.error('Offline sync failed', err);
    });
    return;
  }

  // Real-time matching requires reading name/image. We use JSONP (GET) to bypass CORS blocks.
  const callbackName = 'gasCallback_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  
  const timeoutId = setTimeout(() => {
    // Clean up on timeout
    if (window[callbackName]) {
      delete window[callbackName];
      const scriptEl = document.getElementById(callbackName);
      if (scriptEl) scriptEl.remove();
      console.warn('GAS connection timed out (JSONP)');
      callback(false, null);
    }
  }, 10000);

  // Global callback mapping
  window[callbackName] = function(res) {
    clearTimeout(timeoutId);
    delete window[callbackName];
    const scriptEl = document.getElementById(callbackName);
    if (scriptEl) scriptEl.remove();

    if (res && res.status === 'success') {
      markAsSynced(item.id);
      updateHistoryName(item.id, res.name);
      callback(true, {
        name: res.name || '取得不能',
        imageUrl: res.imageUrl || ''
      });
    } else {
      console.warn('GAS processed with JSONP warning:', res ? res.message : 'no response');
      callback(false, null);
    }
  };

  // Dynamic script tag injection
  const script = document.createElement('script');
  script.id = callbackName;
  const encodedItem = encodeURIComponent(JSON.stringify(item));
  script.src = state.settings.gasUrl + '?callback=' + callbackName + '&data=' + encodedItem;
  
  // Script append triggers execution
  document.body.appendChild(script);
}

function markAsSynced(id) {
  const index = state.history.findIndex(item => item.id === id);
  if (index !== -1) {
    state.history[index].synced = true;
    localStorage.setItem('qr_match_history', JSON.stringify(state.history));
    renderHistory();
  }
}

function updateHistoryName(id, name) {
  if (!name) return;
  const index = state.history.findIndex(item => item.id === id);
  if (index !== -1) {
    // Save master name (Title) in details
    state.history[index].deviceName = `${name} | ${state.history[index].deviceName.split(' | ').pop()}`;
    localStorage.setItem('qr_match_history', JSON.stringify(state.history));
    renderHistory();
  }
}

// Background sync loop for offline records
function runSyncEngine() {
  if (!navigator.onLine || !state.settings.gasUrl) {
    return;
  }
  
  const unsyncedItems = state.history.filter(item => !item.synced);
  if (unsyncedItems.length === 0) return;

  console.log(`Sync engine: Found ${unsyncedItems.length} unsynced log entries. Retrying upload...`);
  
  // Sequential retry sending
  unsyncedItems.reduce((promise, item) => {
    return promise.then(() => {
      return new Promise((resolve) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        fetch(state.settings.gasUrl, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify(item),
          signal: controller.signal
        })
        .then(response => response.json())
        .then(res => {
          clearTimeout(timeoutId);
          if (res.status === 'success') {
            markAsSynced(item.id);
            updateHistoryName(item.id, res.name);
          }
          resolve();
        })
        .catch(err => {
          clearTimeout(timeoutId);
          console.error(`Resync failed for ${item.id}`, err);
          resolve();
        });
      });
    });
  }, Promise.resolve());
}

// --- Browser Network Event Listeners ---
function updateOnlineStatus() {
  if (navigator.onLine) {
    el.offlineBanner.classList.remove('active');
    runSyncEngine();
  } else {
    el.offlineBanner.classList.add('active');
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadHistory();
  initScanner();
  updateOnlineStatus();

  // Event Listeners
  el.toggleCameraBtn.addEventListener('click', toggleCamera);
  el.resetWorkflowBtn.addEventListener('click', resetWorkflow);
  
  el.openSettingsBtn.addEventListener('click', showSettings);
  el.closeSettingsBtn.addEventListener('click', hideSettings);
  el.saveSettingsBtn.addEventListener('click', saveSettings);
  
  el.clearHistoryBtn.addEventListener('click', clearHistory);
  
  // Result Modal elements
  el.closeResultBtn.addEventListener('click', hideResultPopup);
  
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  
  // Close modals when clicking outside content
  el.settingsModal.addEventListener('click', (e) => {
    if (e.target === el.settingsModal) {
      hideSettings();
    }
  });

  el.resultModal.addEventListener('click', (e) => {
    if (e.target === el.resultModal) {
      hideResultPopup();
    }
  });

  // Hotkey close handler
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (el.resultModal.classList.contains('active')) {
        hideResultPopup();
      }
      if (el.settingsModal.classList.contains('active')) {
        hideSettings();
      }
    }
  });

  // Run periodic sync verification every 30 seconds
  setInterval(runSyncEngine, 30000);
});
