// Exercise the real panel handlers and effects with controlled API replies/timers.
// This small hook host follows the dependency/effect lifecycle without a browser;
// it does not substitute for visual or end-to-end validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../components/toolbar/video-subtitles-tool.tsx'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function panel({ operation = 'generate_subtitles', readOnly = false, state = 'EM_PROCESSAMENTO' } = {}) {
  const original = { start: 1, end: 3, text: 'Original' };
  const generated = { start: 4, end: 6, text: 'Proposta IA' };
  let stored = [original];
  let version = 0;
  let latest = { tarefaId: 'task-1', imageId: 'video-1', operation, estado: state, progresso: 30 };
  let currentImage = { _id: 'video-1', name: 'video.mp4', url: '/video.mp4', mediaMetadata: { duration: 30 } };
  let response;
  const slots = [];
  let cursor = 0;
  let effects = [];
  const intervals = new Map();
  const writes = [];
  const downloads = [];
  const posts = [];
  const project = { _id: 'project-1', version: 0 };
  const session = { token: 'test-token', user: { _id: 'owner-1' } };
  const trim = { videoPlayerRef: { current: null }, setVideoSourceOverride() {}, setVideoSubtitlePreview() {} };
  const toast = () => {};
  const client = { invalidateQueries() {}, setQueriesData() {} };
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ||= { current: initial };
    },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !depsEqual(slots[index].deps, deps)) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !depsEqual(slots[index].deps, deps)) {
        const previous = slots[index];
        slots[index] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  };
  const api = {
    async get(url, options) {
      if (url.endsWith('/subtitles')) return { data: { segments: stored, projectVersion: version, subtitlesUpdatedAt: null } };
      if (url.endsWith('/latest')) return { data: { tarefa: latest?.operation === options.params.operation ? latest : null } };
      if (response) return response.promise;
      return { data: latest };
    },
    async put(url, body) {
      writes.push({ url, body });
      stored = body.segments;
      return { data: { segments: stored, projectVersion: ++version } };
    },
    async post(url) { posts.push(url); return { data: { tarefaId: 'task-2', estado: 'EM_FILA' } }; },
  };
  const modules = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    '@tanstack/react-query': { useQueryClient: () => client },
    'next/navigation': { useSearchParams: () => ({ get: () => null }) },
    '@/providers/project-provider': {
      useCurrentImage: () => currentImage, useProjectInfo: () => project,
      useCanEditProject: () => !readOnly, useVideoTrim: () => trim,
      useProjectVideoPolicy: () => ({ policy: { userType: 'premium' } }),
    },
    '@/providers/session-provider': { useSession: () => session },
    '@/hooks/use-toast': { useToast: () => ({ toast }) },
    '@/lib/axios': { api },
    '@/lib/subtitle-files': { downloadSubtitles: (segments, format) => downloads.push({ segments, format }) },
    '../project-page/project-video-policy-status': { default: 'ProjectVideoPolicyStatus' },
  };
  const context = {
    exports: {}, crypto: { randomUUID }, Event: class {}, window: { dispatchEvent() {} },
    setInterval(fn) { const id = randomUUID(); intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    require(name) {
      if (modules[name]) return modules[name];
      if (name.startsWith('../ui/')) return new Proxy({}, { get: (_, key) => key });
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(code, context, { filename: 'video-subtitles-tool.tsx' });
  let tree;
  function render() {
    cursor = 0;
    tree = context.exports.VideoSubtitlesPanel({ disabled: false });
    const pending = effects; effects = [];
    pending.forEach(run => run());
  }
  async function settle() {
    for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); render(); }
  }
  function walk(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(walk);
    return [node, ...walk(node.props?.children)];
  }
  const nodes = () => walk(tree);
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join('');
    return node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
  }
  function button(label) {
    const result = nodes().find(node => node.type === 'Button' && text(node).includes(label));
    assert.ok(result, `Missing button: ${label}`);
    return result;
  }
  render();
  return {
    settle, render, nodes, button, writes, downloads, posts,
    textarea: () => nodes().find(node => node.type === 'textarea'),
    async edit(value) {
      assert.equal(this.textarea().props.disabled, false);
      this.textarea().props.onChange({ target: { value } }); render();
    },
    async click(label) {
      const node = button(label); assert.equal(Boolean(node.props.disabled), false, `${label} disabled`);
      await node.props.onClick(); await settle();
    },
    async tick() { [...intervals.values()].forEach(fn => fn()); await settle(); },
    complete() { latest = { ...latest, estado: 'CONCLUIDA', segments: [generated] }; },
    finish(state) { latest = { ...latest, estado: state }; },
    delayPoll() { response = deferred(); return response; },
    changeVideo() { currentImage = { ...currentImage, _id: 'video-2' }; render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

for (const operation of ['generate_subtitles', 'subtitles', 'trim', 'concat']) {
  test(`RN7: manual editing, saving and SRT/WebVTT export remain available during ${operation}`, async () => {
    const host = panel({ operation });
    try {
      await host.settle();
      await host.edit('Manual durante processamento');
      assert.equal(host.button('Adicionar legenda').props.disabled, false);
      assert.ok(host.nodes().filter(n => n.type === 'Input').every(n => !n.props.disabled));
      assert.ok(host.nodes().filter(n => n.props?.['aria-label']?.startsWith('Apagar legenda')).every(n => !n.props.disabled));
      await host.click('Guardar');
      assert.equal(host.writes[0].body.segments[0].text, 'Manual durante processamento');
      assert.equal(host.button('Descarregar legendas').props.disabled, false);
      for (const format of ['SRT (.srt)', 'WebVTT (.vtt)']) {
        const item = host.nodes().find(n => n.type === 'DropdownMenuItem' && n.props.children === format);
        item.props.onSelect();
      }
      assert.deepEqual(host.downloads.map(d => d.format), ['srt', 'vtt']);
      assert.equal(host.downloads[0].segments[0].text, 'Manual durante processamento');
      if (operation === 'generate_subtitles' || operation === 'subtitles') {
        assert.equal(host.button(operation === 'generate_subtitles' ? 'A gerar proposta…' : 'Gerar automaticamente').props.disabled, true);
        assert.equal(host.button('Incorporar no vídeo').props.disabled, true);
      }
      assert.equal(host.posts.length, 0, 'manual actions do not start processing tasks');
    } finally { host.unmount(); }
  });
}

test('RN7: completing generation preserves manual edits and saves until explicit proposal selection', async () => {
  const host = panel();
  try {
    await host.settle();
    await host.edit('Manual guardada'); await host.click('Guardar');
    await host.edit('Alteração ainda por guardar');
    host.complete(); await host.tick();
    assert.equal(host.textarea().props.value, 'Alteração ainda por guardar');
    assert.equal(host.writes.length, 1);
    await host.click('Substituir edição pela proposta');
    assert.equal(host.textarea().props.value, 'Proposta IA');
    assert.equal(host.writes.length, 1, 'applying a proposal must not save it');
    await host.click('Guardar');
    assert.equal(host.writes[1].body.segments[0].text, 'Proposta IA');
  } finally { host.unmount(); }
});

for (const state of ['FALHADA', 'CANCELADA']) {
  test(`RN7: ${state} preserves the manual draft`, async () => {
    const host = panel();
    try {
      await host.settle(); await host.edit('Manual preservada');
      host.finish(state); await host.tick();
      assert.equal(host.textarea().props.value, 'Manual preservada');
      assert.equal(host.writes.length, 0);
    } finally { host.unmount(); }
  });
}

test('a late poll reply from the previous video cannot replace the current editor', async () => {
  const host = panel();
  try {
    await host.settle();
    const pending = host.delayPoll();
    await host.tick();
    host.changeVideo(); await host.settle();
    pending.resolve({ data: { tarefaId: 'task-1', operation: 'generate_subtitles', estado: 'CONCLUIDA', segments: [{ start: 1, end: 2, text: 'Vídeo anterior' }] } });
    await host.settle();
    assert.equal(host.textarea().props.value, 'Original');
    assert.equal(host.nodes().some(n => n.type === 'Button' && String(n.props.children).includes('Substituir edição')), false);
  } finally { host.unmount(); }
});

test('read-only access still blocks manual changes, saving, exporting and processing', async () => {
  const host = panel({ readOnly: true, operation: 'subtitles' });
  try {
    await host.settle();
    assert.equal(host.textarea().props.disabled, true);
    for (const label of ['Adicionar legenda', 'Guardar', 'Descarregar legendas', 'Incorporar no vídeo', 'Gerar automaticamente']) {
      assert.equal(host.button(label).props.disabled, true, label);
    }
  } finally { host.unmount(); }
});
