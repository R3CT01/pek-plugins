// Upload page: sign in with GitHub, pick a plugin .zip, check it, send it for review.
(() => {
    const { h, avatar, kb, api, say } = HesperSite;
    const app = document.getElementById('app');
    let me = null, prep = null, busy = false, note = null, mine = [];

    const msg = (kind, text) => ({ kind, text });

    async function start() {
        if (HesperSite.signedIn()) {
            try { me = await api('GET', '/v1/gh/me'); mine = (await api('GET', '/v1/store/mine')).items || []; }
            catch (e) { me = null; note = msg('bad', e.message); }
        }
        if (!me && HesperSite.hashError()) note = msg('bad', HesperSite.hashError());
        draw();
    }

    async function choose(file) {
        note = null; prep = null; draw();
        try { prep = await HesperSite.prepare(file); } catch (e) { note = msg('bad', e.message); }
        draw();
    }

    async function send() {
        if (!prep || busy || prep.problems.length) return;
        busy = true; note = msg('warn', 'Uploading\u2026'); draw();
        try {
            await HesperSite.upload(prep, false, (i, n) => { note = msg('warn', 'Uploading\u2026 part ' + (i + 1) + ' of ' + n); draw(); });
            note = msg('good', '\u201c' + prep.name + '\u201d was sent. It shows up in the store after the owner approves it.');
            prep = null;
            mine = (await api('GET', '/v1/store/mine')).items || [];
        } catch (e) { note = msg('bad', e.message); if (e.code === 'bad_session') me = null; }
        busy = false; draw();
    }

    async function remove(item) {
        if (busy) return; busy = true; draw();
        try { await api('POST', '/v1/store/remove', { id: item.id }); mine = (await api('GET', '/v1/store/mine')).items || []; note = msg('good', 'Removed.'); }
        catch (e) { note = msg('bad', e.message); }
        busy = false; draw();
    }

    function draw() {
        const kids = [];
        if (note) kids.push(h('div', { class: 'msg ' + note.kind }, note.text));

        if (!me) {
            kids.push(h('div', { class: 'card' },
                h('p', {}, 'Sign in with GitHub to upload. We only learn your GitHub username and never get access to your repositories.'),
                h('button', { class: 'primary', onclick: () => HesperSite.signIn('upload') }, 'Sign in with GitHub')));
            app.replaceChildren(...kids); return;
        }

        kids.push(h('div', { class: 'row' },
            h('span', { class: 'muted' }, 'Signed in as @' + me.login),
            h('button', { onclick: async () => { await HesperSite.signOut(); me = null; prep = null; note = null; draw(); } }, 'Sign out')));

        const input = h('input', { type: 'file', accept: '.zip,application/zip', style: 'display:none', onchange: (e) => { if (e.target.files[0]) choose(e.target.files[0]); } });
        const drop = h('div', { class: 'card drop' },
            h('div', { class: 'big-icon' }, '\ud83d\udce6'),
            h('p', {}, h('b', {}, 'Drop your plugin .zip here')),
            h('p', { class: 'muted' }, 'It needs plugin.json and ui.js, at the top of the zip or inside one folder. The folder name becomes the plugin id.'),
            input, h('button', { class: 'primary', onclick: () => input.click(), disabled: busy ? 'disabled' : null }, 'Choose .zip'));
        ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f && !busy) choose(f); });
        kids.push(drop);

        if (prep) {
            kids.push(h('div', { class: 'card' },
                h('div', { class: 'head' }, avatar(prep.name, true), h('div', {}, h('h2', {}, prep.name),
                    h('div', { class: 'muted' }, [prep.version ? 'Version ' + prep.version : '', 'id: ' + prep.id, prep.files.length + ' files', kb(prep.total)].filter(Boolean).join(' \u00b7 ')))),
                prep.description ? h('p', {}, prep.description) : null,
                h('p', {}, h('b', {}, 'What it asks for:')),
                h('ul', {}, prep.permissions.map(p => h('li', {}, p))),
                prep.problems.length ? h('div', { class: 'msg bad' }, h('b', {}, 'Fix these first:'), h('ul', {}, prep.problems.map(p => h('li', {}, p)))) : null,
                h('p', { class: 'muted' }, 'The owner sees this same list when reviewing, and PEK shows it again to every person who installs the plugin.'),
                h('button', { class: 'primary', onclick: send, disabled: (busy || prep.problems.length) ? 'disabled' : null }, 'Send for review')));
        }

        if (mine.length) {
            kids.push(h('h2', {}, 'Your plugins'));
            mine.forEach(it => kids.push(h('div', { class: 'card row' },
                h('div', { class: 'ident' }, avatar(it.name), h('div', {}, h('b', {}, it.name), ' ', h('span', { class: 'pill ' + it.status }, it.status === 'approved' ? 'live' : 'waiting for review'),
                    h('div', { class: 'muted' }, [it.version ? 'v' + it.version : '', it.shelf === 'official' ? 'official' : 'community', HesperSite.when(it.updated)].filter(Boolean).join(' \u00b7 ')))),
                h('button', { class: 'danger', onclick: () => remove(it), disabled: busy ? 'disabled' : null }, 'Remove'))));
            kids.push(h('p', { class: 'muted' }, 'To update a plugin, upload the new zip with the same folder name. It goes back to waiting for review.'));
        }
        app.replaceChildren(...kids);
    }
    start();
})();
