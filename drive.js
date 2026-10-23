(function () {
  'use strict';
  const API = 'https://www.googleapis.com/drive/v3/files';
  let token = '', expires = 0, busy = false, again = false, timer, repo, writer, notify = () => {}, onMerge = () => {};
  let status = 'Sauvegarde sur cet appareil';
  const connected = () => !!token && Date.now() < expires;
  const setStatus = value => { status = value; notify(value); };
  async function request(url, options = {}) {
    if (!connected()) throw new Error('Reconnecte Google Drive pour synchroniser.');
    const response = await fetch(url, { ...options, headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) } });
    if (response.status === 401) { token = ''; throw new Error('La connexion Google a expiré. Reconnecte Drive.'); }
    if (!response.ok) throw new Error('Drive n’a pas pu enregistrer les données (' + response.status + '). Elles restent sur cet appareil.');
    return response;
  }
  async function list(query) {
    const files = []; let pageToken = '';
    do {
      const params = new URLSearchParams({ q: query, fields: 'nextPageToken,files(id,name,appProperties)', pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
      const body = await (await request(API + '?' + params)).json(); files.push(...body.files); pageToken = body.nextPageToken || '';
    } while (pageToken);
    return files;
  }
  async function sync() {
    if (!connected()) { setStatus('Sauvegarde sur cet appareil · Drive déconnecté'); return; }
    if (busy) { again = true; return; }
    busy = true; setStatus('Synchronisation Drive…');
    const run = async () => {
    try {
      const app = CONFIG.DRIVE_APP;
      const files = await list("trashed = false and mimeType != 'application/vnd.google-apps.folder' and appProperties has { key='application' and value='" + app + "' }");
      for (const file of files) {
        const raw = await (await request(API + '/' + encodeURIComponent(file.id) + '?alt=media')).json();
        repo.mergeRemote(raw);
      }
      onMerge();
      // One snapshot per device: concurrent devices never overwrite each other's files.
      const own = files.find(file => file.appProperties && (file.appProperties.writer || file.appProperties.device) === writer);
      const data = JSON.stringify(repo.state);
      if (own) {
        await request('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(own.id) + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: data });
      } else {
        let folders = await list("trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='application' and value='" + app + "' }");
        let folder = folders[0];
        if (!folder) folder = await (await request(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: CONFIG.DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder', appProperties: { application: app } }) })).json();
        const metadata = { name: 'revisions-' + writer + '.json', parents: [folder.id], appProperties: { application: app, device: repo.deviceId, writer } };
        const boundary = 'hep_revisions_' + HEPStore.uuid().replace(/-/g, '');
        const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + data + '\r\n--' + boundary + '--';
        await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
      }
      setStatus(repo.warning || 'Synchronisé avec Drive · ' + new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' }));
    } catch (error) { setStatus(error.message); }
    finally { busy = false; if (again) { again = false; schedule(); } }
    };
    // The lock covers the complete pull/merge/push cycle across tabs.
    if (navigator.locks) await navigator.locks.request(CONFIG.DRIVE_APP + '-sync', run);
    else await run(); // Without Web Locks each tab writes its own separate snapshot.
  }
  function schedule() {
    if (connected()) { setStatus('Enregistré sur cet appareil · synchronisation en attente…'); clearTimeout(timer); timer = setTimeout(sync, 1400); }
    else setStatus('Sauvegarde sur cet appareil · Drive déconnecté');
  }
  async function connect() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) throw new Error('La connexion Google est indisponible. Vérifie la connexion et réessaie.');
    if (!CONFIG.GOOGLE_CLIENT_ID) throw new Error('La connexion Drive n’est pas configurée.');
    await new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({ client_id: CONFIG.GOOGLE_CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.file',
        callback: response => {
          if (response.error || !response.access_token) { reject(new Error('Connexion Google annulée ou refusée.')); return; }
          token = response.access_token; expires = Date.now() + (Number(response.expires_in) || 3600) * 1000 - 60000; resolve();
        }, error_callback: () => reject(new Error('Connexion Google annulée.')) });
      client.requestAccessToken({ prompt: '' });
    });
    await sync();
  }
  window.HEPDrive = { init(repository, listener, merged) { repo = repository; writer = navigator.locks ? repo.deviceId : repo.deviceId + '-' + HEPStore.uuid(); notify = listener; onMerge = merged; }, connect, sync, schedule, connected, status: () => connected() || !status.startsWith('Synchronisé') ? status : 'Sauvegarde sur cet appareil · Drive déconnecté',
    disconnect() { clearTimeout(timer); token = ''; expires = 0; setStatus('Sauvegarde sur cet appareil · Drive déconnecté'); } };
}());
