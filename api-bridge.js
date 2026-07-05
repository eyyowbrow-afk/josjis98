// ═══════════════════════════════════════════════════════════════
// JOSJIS98 API BRIDGE
// Menghubungkan localStorage frontend dengan backend server
// ═══════════════════════════════════════════════════════════════
// Script ini HARUS dimuat SEBELUM kode utama index.html/admin.html
// Cara kerjanya:
// 1. Saat halaman dimuat, ambil data dari server (synchronous XHR)
// 2. Populate localStorage dengan data dari server
// 3. Hook localStorage.setItem untuk sinkronasi perubahan ke server
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const SERVER_URL = window.location.origin;
  const DEBUG = false;

  function log(...args) {
    if (DEBUG) console.log('[API-Bridge]', ...args);
  }

  // ── 1. FETCH INITIAL DATA FROM SERVER ──
  // Gunakan synchronous XHR agar data tersedia sebelum kode utama jalan
  let serverAvailable = false;
  // Flag untuk mencegah write-back loop saat inisialisasi
  window.__BRIDGE_INITIALIZING = true;

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', SERVER_URL + '/api/init', false); // synchronous
    xhr.timeout = 5000;
    xhr.send();

    if (xhr.status === 200) {
      const data = JSON.parse(xhr.responseText);
      log('Data fetched from server');

      // Populate localStorage with server data
      // Gunakan original setItem selama inisialisasi untuk menghindari write-back
      const origSetItem = Storage.prototype.setItem;
      
      if (data.users) {
        origSetItem.call(localStorage, 'josjis98_users', JSON.stringify(data.users));
        log('Users loaded:', Object.keys(data.users).length);
      }
      if (data.deposits) {
        origSetItem.call(localStorage, 'josjis98_deposits', JSON.stringify(data.deposits));
        log('Deposits loaded:', data.deposits.length);
      }
      if (data.withdraws) {
        origSetItem.call(localStorage, 'josjis98_withdraws', JSON.stringify(data.withdraws));
        log('Withdraws loaded:', data.withdraws.length);
      }
      if (data.codes) {
        origSetItem.call(localStorage, 'josjis98_custom_codes', JSON.stringify(data.codes));
        log('Codes loaded:', Object.keys(data.codes).length);
      }
      if (data.bank) {
        origSetItem.call(localStorage, 'josjis98_bank', JSON.stringify(data.bank));
      }

      serverAvailable = true;
      log('✅ Server connected successfully');
    }
  } catch (e) {
    console.warn('[API-Bridge] ⚠️ Server tidak tersedia. Menggunakan localStorage lokal.');
    console.warn('[API-Bridge] Jalankan server: cd backend && npm install && npm start');
  } finally {
  }

  // Hapus flag SYNCHRONOUSLY sebelum hook dipasang
  // (tidak pakai setTimeout untuk mencegah race condition)
  window.__BRIDGE_INITIALIZING = false;

  // ── 2. HOOK localStorage.setItem UNTUK SYNC KE SERVER ──
  if (serverAvailable) {
    const originalSetItem = Storage.prototype.setItem;

    // Queue untuk mengirim data (debounce)
    const syncQueue = {};
    let syncTimer = null;

    function queueSync(key, value) {
      syncQueue[key] = value;
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        flushSync();
      }, 500); // debounce 500ms
    }

    function flushSync() {
      const keys = Object.keys(syncQueue);
      if (keys.length === 0) return;

      keys.forEach(key => {
        const value = syncQueue[key];
        try {
          const parsed = JSON.parse(value);

          if (key === 'josjis98_users') {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', SERVER_URL + '/api/sync/users', false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(parsed));
            log('Users synced to server');
          }
          else if (key === 'josjis98_deposits') {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', SERVER_URL + '/api/sync/deposits', false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(parsed));
            log('Deposits synced to server');
          }
          else if (key === 'josjis98_withdraws') {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', SERVER_URL + '/api/sync/withdraws', false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(parsed));
            log('Withdraws synced to server');
          }
          else if (key === 'josjis98_custom_codes') {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', SERVER_URL + '/api/sync/codes', false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(parsed));
            log('Codes synced to server');
          }
        } catch(e) {
          console.warn('[API-Bridge] Failed to sync', key, e.message);
        }
      });

      // Clear queue
      Object.keys(syncQueue).forEach(k => delete syncQueue[k]);
    }

    // Override setItem
    Storage.prototype.setItem = function(key, value) {
      // Call original
      originalSetItem.call(this, key, value);

      // Jangan sync jika masih dalam proses inisialisasi (mencegah write-back loop)
      if (window.__BRIDGE_INITIALIZING) {
        return;
      }

      // Sync to server for specific keys
      if (key.startsWith('josjis98_')) {
        queueSync(key, value);
      }
    };

    // Also sync periodically every 30 seconds
    setInterval(() => {
      if (Object.keys(syncQueue).length > 0) {
        flushSync();
      }
    }, 30000);

    log('✅ API Bridge active - syncing to', SERVER_URL);
  }

  // ── 3. Sediakan fungsi helper untuk cek koneksi server ──
  window.__serverAvailable = serverAvailable;

})();
