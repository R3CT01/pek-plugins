// Shared code for the upload page (index.html) and the owner page (owner.html).
// Works in plain browsers, no build step. Everything shown on screen is built with textContent,
// never innerHTML, so nothing a plugin author writes can inject markup into these pages.

const HesperSite = (() => {
    const KEY = 'hesper_gh_token';
    const CHUNK = 400000;                    // characters per upload piece (the worker's limit)
    const MAX_FILES = 200, MAX_FILE = 2 * 1024 * 1024, MAX_TOTAL = 8 * 1024 * 1024, MAX_PY = 200 * 1024;
    const OK_EXT = ['js', 'json', 'css', 'md', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'py'];
    const TEXT_EXT = ['js', 'json', 'css', 'md', 'txt', 'py'];
    const RESERVED_HOST = 'hesper-tmdb.aquariusibeats.workers.dev';   // official-only (the app refuses it anyway)

    const MESSAGES = {
        expired: 'The sign-in took too long. Please try again.',
        denied: 'GitHub sign-in was cancelled.',
        github: 'GitHub did not answer. Please try again.',
        blocked: 'This GitHub account cannot upload plugins.',
        too_new: 'This GitHub account is too new to upload plugins. Please try again in a few days.',
        not_owner: 'This GitHub account is not an owner of the store.',
        bad_session: 'Your sign-in ran out. Please sign in again.',
        forbidden: 'Only the store owner can do that.',
        id_taken: 'Another plugin already uses that id. Rename the plugin folder in your zip and try again.',
        store_quota: 'You already have 10 plugins in the store. Remove one first.',
        rate_limited: 'Too many uploads for now. Please try again later.',
        too_large: 'That plugin is too large (limit 8 MB).',
        not_found: 'That plugin is no longer in the store.',
        offline: "Couldn't reach the store. Check your connection.",
        github_not_configured: 'The store owner has not finished setting up GitHub sign-in yet.',
        site_not_configured: 'The store owner has not finished setting up the site address yet.'
    };
    const say = (code) => MESSAGES[code] || 'The store gave an unexpected answer.';

    // ---------------- sign-in ----------------
    let token = '';
    try { token = sessionStorage.getItem(KEY) || ''; } catch (e) { /* kept in memory only */ }
    let hashError = '';
    (function readHash() {                       // the worker sends people back here with #token=... or #error=...
        const h = new URLSearchParams(location.hash.replace(/^#/, ''));
        if (h.get('token')) { token = h.get('token'); try { sessionStorage.setItem(KEY, token); } catch (e) { /* memory only */ } }
        if (h.get('error')) hashError = say(h.get('error'));
        if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    })();

    const signIn = (ret) => { location.href = HESPER_WORKER + '/v1/gh/login?ret=' + (ret === 'owner' ? 'owner' : 'upload'); };
    const signedIn = () => !!token;
    async function signOut() {
        try { await api('POST', '/v1/gh/logout'); } catch (e) { /* the token is dropped below either way */ }
        token = ''; try { sessionStorage.removeItem(KEY); } catch (e) { /* nothing to remove */ }
    }

    async function api(method, path, body) {
        const headers = {};
        if (token) headers.Authorization = 'Bearer ' + token;
        if (body) headers['Content-Type'] = 'application/json';
        let res;
        try { res = await fetch(HESPER_WORKER + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
        catch (e) { throw new Error(say('offline')); }
        let data = null;
        try { data = await res.json(); } catch (e) { /* not JSON */ }
        if (res.status === 401) { token = ''; try { sessionStorage.removeItem(KEY); } catch (e) { /* ok */ } }
        if (!res.ok || !data || data.ok === false) {
            const err = new Error(say(data && data.error));
            err.code = (data && data.error) || String(res.status);
            throw err;
        }
        return data;
    }

    // ---------------- bundle format (must match the app: plugin_store.js) ----------------
    function toB64(bytes) {
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
    }
    function fromB64(b64) {
        const bin = atob(b64), out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    function fingerprint(str) {
        let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
            h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
            h2 ^= h2 >>> 13;
        }
        return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + (h2 >>> 0).toString(16)).slice(-8);
    }
    function pack(files) {
        const sorted = files.slice().sort((a, b) => (a.path < b.path ? -1 : 1));
        let raw = 0;
        const list = sorted.map(f => { raw += f.data.byteLength; return { p: f.path, d: toB64(f.data) }; });
        const bundle = JSON.stringify({ v: 1, files: list });
        return { bundle, fp: fingerprint(bundle), raw };
    }

    // ---------------- reading and checking a plugin .zip ----------------
    const slug = (t) => String(t || '').toLowerCase().replace(/\.zip$/, '').replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
    const extOf = (p) => { const n = p.split('/').pop(); const i = n.lastIndexOf('.'); return i < 0 ? '' : n.slice(i + 1).toLowerCase(); };
    const isJunk = (p) => p.split('/').some(x => x.charAt(0) === '.' || x.toLowerCase() === '__macosx');

    // Returns { id, name, version, author, description, permissions: [...], files, total, problems: [...] }
    async function prepare(file) {
        const problems = [];
        if (!file) throw new Error('No file chosen.');
        if (file.size > 10 * 1024 * 1024) throw new Error('That file is too large to be a plugin (limit 8 MB).');
        let entries;
        try { entries = await HesperZip.read(await file.arrayBuffer()); }
        catch (e) { throw new Error('That is not a readable .zip file (' + ((e && e.message) || 'unknown error') + ').'); }
        entries = entries.filter(e => !isJunk(e.path));
        if (!entries.length) throw new Error('The zip is empty.');
        const has = (p) => entries.some(e => e.path === p);
        let prefix = '', folder = '';
        if (!has('plugin.json')) {
            const tops = new Set(entries.map(e => e.path.split('/')[0]));
            if (tops.size === 1) {
                const top = Array.from(tops)[0];
                if (entries.every(e => e.path.indexOf(top + '/') === 0) && has(top + '/plugin.json')) { prefix = top + '/'; folder = top; }
            }
        }
        if (!has(prefix + 'plugin.json')) throw new Error('plugin.json was not found. It must be at the top of the zip, or inside one folder.');
        if (has(prefix + 'skin.json')) throw new Error('This zip has a skin.json. Skins are not accepted here, only plugins.');
        const files = entries.map(e => ({ path: e.path.slice(prefix.length), data: e.data }));
        if (!files.some(f => f.path === 'ui.js')) problems.push('ui.js is missing.');

        let raw;
        try { raw = JSON.parse(new TextDecoder('utf-8').decode(files.find(f => f.path === 'plugin.json').data).replace(/^\uFEFF/, '')); }
        catch (e) { throw new Error('plugin.json is not valid JSON.'); }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('plugin.json must be a JSON object.');

        // Same limits the app's server enforces when installing.
        if (files.length > MAX_FILES) problems.push('Too many files (limit ' + MAX_FILES + ').');
        let total = 0; const seen = new Set();
        files.forEach(f => {
            total += f.data.byteLength;
            const parts = f.path.split('/');
            if (f.path.length > 120 || parts.length > 6 || parts.some(x => !x || x === '.' || x === '..' || x.charAt(0) === '.' || x.length > 64 || /[\\:*?"<>|\u0000-\u001f]/.test(x) || /[. ]$/.test(x))) problems.push('Bad file name: ' + f.path);
            if (seen.has(f.path.toLowerCase())) problems.push('Same file twice: ' + f.path);
            seen.add(f.path.toLowerCase());
            const ext = extOf(f.path);
            if (OK_EXT.indexOf(ext) < 0) problems.push('File type not allowed: ' + f.path);
            if (f.data.byteLength > MAX_FILE) problems.push(f.path + ' is over 2 MB.');
            if (ext === 'py' && f.data.byteLength > MAX_PY) problems.push(f.path + ' is over 200 KB.');
        });
        if (total > MAX_TOTAL) problems.push('The plugin is over 8 MB in total.');
        const manifestText = new TextDecoder('utf-8').decode(files.find(f => f.path === 'plugin.json').data).toLowerCase();
        if (manifestText.indexOf(RESERVED_HOST) >= 0) problems.push('That network host is reserved for PEK\u2019s official plugins.');

        const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
        const perm = (raw.permissions && typeof raw.permissions === 'object') ? raw.permissions : {};
        const id = slug(folder) || slug(raw.name) || slug(file.name) || 'plugin';
        const network = Array.isArray(perm.network) ? perm.network.filter(x => typeof x === 'string').slice(0, 20) : [];
        const permissions = [
            network.length ? 'Can connect to: ' + network.join(', ') : 'No network access',
            perm.storage === true ? 'Keeps its own private data' : null,
            perm.library === true ? 'Python code can read titles and years in the library' : null,
            perm.torrent === true ? 'Can search for releases and start torrent streams' : null,
            perm.favorites === true ? 'Can change Favorites' : null,
            perm.providers === true ? 'Shows \u201cWatch on\u2026\u201d buttons' : null,
            perm.plugins === true ? 'Can open other plugins' : null,
            files.some(f => extOf(f.path) === 'py') ? 'Includes Python code (runs after a restart, only if it passes the app\u2019s safety scan)' : null
        ].filter(Boolean);
        return { id, name: str(raw.name, 80) || id, version: str(raw.version, 40), author: str(raw.author, 80),
                 description: str(raw.description, 200), permissions, files, total, problems };
    }

    // ---------------- uploading and downloading ----------------
    // owner = true publishes to the Official shelf (owner accounts only); otherwise it goes to Community, pending approval.
    async function upload(prep, owner, onProgress) {
        const packed = pack(prep.files);
        const total = Math.max(1, Math.ceil(packed.bundle.length / CHUNK));
        const base = owner ? '/v1/store/owner/' : '/v1/store/';
        for (let i = 0; i < total; i++) {
            if (onProgress) onProgress(i, total);
            await api('POST', base + 'chunk', { id: prep.id, fp: packed.fp, index: i, total, data: packed.bundle.slice(i * CHUNK, (i + 1) * CHUNK) });
        }
        return api('POST', owner ? base + 'commit' : base + 'submit', {
            id: prep.id, fp: packed.fp, total, size: packed.raw,
            name: prep.name, version: prep.version, author: prep.author, description: prep.description
        });
    }

    async function download(item) {                // owner-only: also works for pending items
        const parts = [];
        for (let i = 0; i < item.chunks; i++) {
            parts.push((await api('GET', '/v1/store/owner/chunk?id=' + encodeURIComponent(item.id) + '&fp=' + item.fp + '&i=' + i)).data);
        }
        const bundle = parts.join('');
        if (fingerprint(bundle) !== item.fp) throw new Error('The download was damaged. Try again.');
        return JSON.parse(bundle).files.map(f => ({ path: f.p, data: fromB64(f.d) }));
    }

    // ---------------- tiny DOM helpers ----------------
    function h(tag, attrs, ...kids) {
        const el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(k => {
            if (k === 'class') el.className = attrs[k];
            else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), attrs[k]);
            else if (attrs[k] != null && attrs[k] !== false) el.setAttribute(k, attrs[k]);   // null/false = leave the attribute off
        });
        kids.flat().forEach(c => { if (c != null && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return el;
    }
    const avatar = (name, big) => h('div', { class: 'avatar' + (big ? ' big' : '') }, (String(name || '?').trim().charAt(0) || '?').toUpperCase());
    const kb = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    const when = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

    return { api, signIn, signOut, signedIn, hashError: () => hashError, say, prepare, upload, download, h, avatar, kb, when, extOf, TEXT_EXT, pack };
})();
