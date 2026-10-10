// Owner page: review community uploads, publish official plugins, remove anything.
(() => {
    const { h, avatar, kb, api } = HesperSite;
    const app = document.getElementById('app');
    let me = null, tab = 'review', items = [], review = null, busy = false, note = null, prep = null, viewing = null;
    const msg = (kind, text) => ({ kind, text });

    async function load() { items = (await api('GET', '/v1/store/owner/all')).items || []; }

    async function start() {
        if (HesperSite.signedIn()) {
            try { me = await api('GET', '/v1/gh/me'); if (!me.owner) { note = msg('bad', HesperSite.say('not_owner')); me = null; } else await load(); }
            catch (e) { me = null; note = msg('bad', e.message); }
        }
        if (!me && !note && HesperSite.hashError()) note = msg('bad', HesperSite.hashError());
        draw();
    }

    async function run(fn, okText) {
        if (busy) return; busy = true; note = null; draw();
        try { await fn(); if (okText) note = msg('good', okText); await load(); }
        catch (e) { note = msg('bad', e.message); if (e.code === 'bad_session') me = null; }
        busy = false; draw();
    }

    async function openReview(item) {
        if (busy) return; busy = true; note = msg('warn', 'Downloading\u2026'); draw();
        try {
            const files = await HesperSite.download(item);
            review = { item, files, perms: permsOf(files) };
            note = null;
        } catch (e) { note = msg('bad', e.message); }
        busy = false; draw();
    }
    // Same wording as the upload page, read from the downloaded plugin.json.
    function permsOf(files) {
        let raw = {};
        try { raw = JSON.parse(new TextDecoder().decode(files.find(f => f.path === 'plugin.json').data).replace(/^\uFEFF/, '')); } catch (e) { /* shown as no permissions */ }
        const p = (raw.permissions && typeof raw.permissions === 'object') ? raw.permissions : {};
        const net = Array.isArray(p.network) ? p.network.filter(x => typeof x === 'string') : [];
        return [
            net.length ? 'Can connect to: ' + net.join(', ') : 'No network access',
            p.storage === true ? 'Keeps its own private data' : null,
            p.library === true ? 'Python code can read titles and years in the library' : null,
            p.torrent === true ? 'Can search for releases and start torrent streams' : null,
            p.favorites === true ? 'Can change Favorites' : null,
            p.providers === true ? 'Shows \u201cWatch on\u2026\u201d buttons' : null,
            p.plugins === true ? 'Can open other plugins' : null,
            files.some(f => HesperSite.extOf(f.path) === 'py') ? 'Includes Python code' : null
        ].filter(Boolean);
    }

    function viewFile(f) {
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(f.data); } catch (e) { text = '(binary file)'; }
        viewing = { path: f.path, text: text.length > 200000 ? text.slice(0, 200000) + '\n\u2026 (cut off)' : text };
        draw();
    }

    async function pickOfficial(file) {
        note = null; prep = null; draw();
        try { prep = await HesperSite.prepare(file); } catch (e) { note = msg('bad', e.message); }
        draw();
    }

    function draw() {
        const kids = [];
        if (note) kids.push(h('div', { class: 'msg ' + note.kind }, note.text));
        if (!me) {
            kids.push(h('div', { class: 'card' }, h('p', {}, 'Sign in with the GitHub account that is listed as an owner on the worker.'),
                h('button', { class: 'primary', onclick: () => HesperSite.signIn('owner') }, 'Sign in with GitHub')));
            app.replaceChildren(...kids); return;
        }
        kids.push(h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Owner: @' + me.login),
            h('button', { onclick: async () => { await HesperSite.signOut(); me = null; review = null; draw(); } }, 'Sign out')));

        if (viewing) {
            kids.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, viewing.path), h('button', { onclick: () => { viewing = null; draw(); } }, 'Close')), h('pre', {}, viewing.text)));
            app.replaceChildren(...kids); return;
        }

        if (review) {
            const it = review.item;
            kids.push(h('div', { class: 'card' },
                h('div', { class: 'head' }, avatar(it.name, true), h('div', {}, h('h2', {}, it.name),
                    h('div', { class: 'muted' }, [it.version ? 'v' + it.version : '', 'id: ' + it.id, 'uploaded by @' + it.author, kb(it.size), HesperSite.when(it.updated)].filter(Boolean).join(' \u00b7 ')))),
                it.description ? h('p', {}, it.description) : null,
                h('p', {}, h('b', {}, 'What it asks for:')), h('ul', {}, review.perms.map(p => h('li', {}, p))),
                h('p', {}, h('b', {}, 'Files (read the code before approving):')),
                h('ul', { class: 'files' }, review.files.map(f => h('li', {}, f.path + ' (' + kb(f.data.byteLength) + ')',
                    HesperSite.TEXT_EXT.indexOf(HesperSite.extOf(f.path)) >= 0 ? h('button', { onclick: () => viewFile(f) }, 'View') : null))),
                h('div', { class: 'row' },
                    h('button', { class: 'primary', disabled: busy ? 'disabled' : null, onclick: () => run(async () => { await api('POST', '/v1/store/owner/approve', { id: it.id, fp: it.fp }); review = null; }, 'Approved. It is now on the Community shelf.') }, 'Approve'),
                    h('button', { disabled: busy ? 'disabled' : null, onclick: () => { review = null; draw(); } }, 'Back'),
                    h('button', { class: 'danger', disabled: busy ? 'disabled' : null, onclick: () => run(async () => { await api('POST', '/v1/store/owner/remove', { id: it.id }); review = null; }, 'Rejected and deleted.') }, 'Reject and delete'))));
            app.replaceChildren(...kids); return;
        }

        const pending = items.filter(i => i.status === 'pending');
        const tabBtn = (id, label) => h('button', { 'aria-selected': tab === id ? 'true' : 'false', onclick: () => { tab = id; draw(); } }, label);
        kids.push(h('div', { class: 'tabs' }, tabBtn('review', 'Waiting (' + pending.length + ')'), tabBtn('live', 'In the store'), tabBtn('publish', 'Publish official')));

        if (tab === 'review') {
            if (!pending.length) kids.push(h('p', { class: 'muted' }, 'Nothing is waiting.'));
            pending.forEach(it => kids.push(h('div', { class: 'card row' },
                h('div', { class: 'ident' }, avatar(it.name), h('div', {}, h('b', {}, it.name), h('div', { class: 'muted' }, [it.version ? 'v' + it.version : '', 'by @' + it.author, kb(it.size), HesperSite.when(it.updated)].filter(Boolean).join(' \u00b7 ')))),
                h('button', { class: 'primary', disabled: busy ? 'disabled' : null, onclick: () => openReview(it) }, 'Review'))));
        } else if (tab === 'live') {
            const live = items.filter(i => i.status === 'approved');
            if (!live.length) kids.push(h('p', { class: 'muted' }, 'Nothing is published yet.'));
            live.forEach(it => kids.push(h('div', { class: 'card row' },
                h('div', { class: 'ident' }, avatar(it.name), h('div', {}, h('b', {}, it.name), ' ', h('span', { class: 'pill approved' }, it.shelf === 'official' ? 'official' : 'community'),
                    h('div', { class: 'muted' }, [it.version ? 'v' + it.version : '', 'by @' + it.author, kb(it.size)].filter(Boolean).join(' \u00b7 ')))),
                h('button', { class: 'danger', disabled: busy ? 'disabled' : null, onclick: () => { if (confirm('Take \u201c' + it.name + '\u201d out of the store?')) run(() => api('POST', '/v1/store/owner/remove', { id: it.id }), 'Removed.'); } }, 'Remove'))));
        } else {
            const input = h('input', { type: 'file', accept: '.zip,application/zip', style: 'display:none', onchange: (e) => { if (e.target.files[0]) pickOfficial(e.target.files[0]); } });
            kids.push(h('div', { class: 'card drop' }, h('div', { class: 'big-icon' }, '\ud83d\ude80'), h('p', {}, 'Publish a plugin to the PEK Official shelf. It goes live straight away. Uploading the same folder name again replaces it.'),
                input, h('button', { class: 'primary', onclick: () => input.click() }, 'Choose .zip')));
            if (prep) kids.push(h('div', { class: 'card' },
                h('h2', { style: 'margin-top:0' }, prep.name),
                h('p', { class: 'muted' }, [prep.version ? 'Version ' + prep.version : '', 'id: ' + prep.id, prep.files.length + ' files', kb(prep.total)].filter(Boolean).join(' \u00b7 ')),
                h('ul', {}, prep.permissions.map(p => h('li', {}, p))),
                prep.problems.length ? h('div', { class: 'msg bad' }, h('ul', {}, prep.problems.map(p => h('li', {}, p)))) : null,
                h('button', { class: 'primary', disabled: (busy || prep.problems.length) ? 'disabled' : null,
                    onclick: () => run(async () => { await HesperSite.upload(prep, true); prep = null; }, 'Published to the Official shelf.') }, 'Publish')));
        }
        app.replaceChildren(...kids);
    }
    start();
})();
