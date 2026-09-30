// kws-node-shim.js: just enough of Node for sherpa-onnx's prebuilt WebAssembly to run in a browser
// worker (kws-worker.js runs this first). That build (the npm package's "nodejs" wasm) is the only
// prebuilt one with the keyword spotter, and its glue is Node-only at its core: it requires "path"
// unconditionally, and its file system (NODERAWFS) maps every file call onto Node's `fs`, refusing
// to start anywhere else. So this gives it a `process`, a `require`, a POSIX `path`, and an `fs` of
// synchronous calls over an in-memory map of the model's files (KWS_SHIM.files, filled by the worker
// from bytes the page fetched during load). Anything else a file call asks for fails as Node would
// (ENOENT, EPERM), which the glue turns into an errno.
(function () {
  const files = new Map(); // absolute path -> Uint8Array
  const fds = new Map(); // fd -> path
  let nextFd = 10;
  const err = (code, path) => Object.assign(new Error(`${code}: ${path ?? ''}`), { code });
  const norm = (p) => {
    const out = [];
    for (const s of String(p).split('/')) {
      if (!s || s === '.') continue;
      if (s === '..') out.pop();
      else out.push(s);
    }
    return `/${out.join('/')}`;
  };
  const isDir = (p) => p === '/' || [...files.keys()].some((f) => f.startsWith(`${p}/`));
  const stat = (p) => {
    const path = norm(p);
    const f = files.get(path);
    if (!f && !isDir(path)) throw err('ENOENT', path);
    const dir = !f;
    const t = new Date(0);
    return {
      dev: 1, ino: path.length * 7919 + (f ? f.length : 0), mode: dir ? 0o40555 : 0o100444, nlink: 1, uid: 0, gid: 0, rdev: 0,
      size: f ? f.length : 4096, blksize: 4096, blocks: Math.ceil((f ? f.length : 4096) / 512),
      atime: t, mtime: t, ctime: t, birthtime: t, atimeMs: 0, mtimeMs: 0, ctimeMs: 0,
      isDirectory: () => dir, isFile: () => !dir, isSymbolicLink: () => false,
    };
  };
  const denied = (name) => (p) => {
    throw err('EPERM', `${name} ${p ?? ''}`);
  };
  const text = new TextDecoder();
  const fs = {
    lstatSync: stat,
    statSync: stat,
    fstatSync: (fd) => {
      if (fd <= 2) return { ...stat('/'), mode: 0o20666, isDirectory: () => false, isFile: () => false };
      if (!fds.has(fd)) throw err('EBADF', fd);
      return stat(fds.get(fd));
    },
    openSync: (p, flags) => {
      const path = norm(p);
      if (flags & 3) throw err('EROFS', path); // write access: the model is read-only
      stat(path);
      const fd = nextFd++;
      fds.set(fd, path);
      return fd;
    },
    closeSync: (fd) => void fds.delete(fd),
    readSync: (fd, buffer, offset, length, position) => {
      const f = files.get(fds.get(fd));
      if (!f) throw err('EBADF', fd);
      const start = position ?? 0;
      const n = Math.max(0, Math.min(length, f.length - start));
      new Uint8Array(buffer.buffer, buffer.byteOffset + offset, n).set(f.subarray(start, start + n));
      return n;
    },
    writeSync: (fd, buffer, offset = 0, length = buffer.length) => {
      if (fd !== 1 && fd !== 2) throw err('EBADF', fd);
      const s = text.decode(new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length));
      (fd === 1 ? console.log : console.warn)('[kws]', s.replace(/\n$/, ''));
      return length;
    },
    readdirSync: (p) => {
      const path = norm(p), pre = path === '/' ? '/' : `${path}/`;
      return [...new Set([...files.keys()].filter((f) => f.startsWith(pre)).map((f) => f.slice(pre.length).split('/')[0]))];
    },
    readFileSync: (p) => {
      const f = files.get(norm(p));
      if (!f) throw err('ENOENT', p);
      return f;
    },
    readlinkSync: (p) => {
      throw err('EINVAL', p);
    },
    statfsSync: () => ({ bsize: 4096, blocks: 1e6, bfree: 0, bavail: 0, files: 1e6, ffree: 0, type: 0 }),
  };
  for (const name of ['chmodSync', 'chownSync', 'fchmodSync', 'fchownSync', 'ftruncateSync', 'futimesSync', 'mkdirSync', 'renameSync', 'rmdirSync', 'symlinkSync', 'truncateSync', 'unlinkSync', 'utimesSync', 'writeFileSync']) fs[name] = denied(name);
  const path = {
    isAbsolute: (p) => String(p).startsWith('/'),
    normalize: (p) => norm(p),
    dirname: (p) => norm(`${p}/..`),
    basename: (p) => String(p).split('/').filter(Boolean).pop() ?? '',
    join: (...a) => norm(a.join('/')),
  };
  path.posix = path;
  // Node's fs open flags on Linux (process.binding('constants').fs), which NODERAWFS translates to.
  const constants = {
    fs: { O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_NOCTTY: 256, O_TRUNC: 512, O_APPEND: 1024, O_NONBLOCK: 2048, O_DSYNC: 4096, O_DIRECT: 16384, O_DIRECTORY: 65536, O_NOFOLLOW: 131072, O_NOATIME: 262144, O_SYNC: 1052672 },
  };
  const g = globalThis;
  g.process = {
    versions: { node: '20.0.0' },
    argv: ['node', '/kws-glue.js'],
    env: {},
    platform: 'linux',
    exitCode: 0,
    cwd: () => '/',
    chdir: () => {},
    binding: (name) => {
      if (name === 'constants') return constants;
      throw err('ENOSYS', `process.binding(${name})`);
    },
    stdin: { fd: 0 },
  };
  g.module = { exports: {} }; // the glue and the API end with module.exports = … under Node
  g.__dirname = '/';
  g.__filename = '/kws-glue.js';
  g.require = (name) => {
    if (name === 'fs') return fs;
    if (name === 'path') return path;
    if (name === 'crypto') return { randomFillSync: (v) => g.crypto.getRandomValues(v) };
    throw err('MODULE_NOT_FOUND', name);
  };
  g.KWS_SHIM = { files, fs, path };
})();
