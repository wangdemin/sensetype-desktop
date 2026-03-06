// Native global keyboard hook with event swallowing (Win/mac).
// Loads compiled addon via node-gyp-build.
const path = require('path');
const bindingLoader = require('node-gyp-build');
const moduleDir = path.join(__dirname);

function isDebugEnabled() {
  const v = process.env.SENSETYPE_KEYHOOK_DEBUG;
  return !!(v && v !== '0');
}

// Debug: show which .node file node-gyp-build resolved.
try {
  if (typeof bindingLoader.resolve === 'function') {
    const resolved = bindingLoader.resolve(moduleDir);
    if (isDebugEnabled()) console.log('[sensetype-keyhook] node-gyp-build resolved:', resolved);
  }
} catch {
  // ignore
}

const binding = bindingLoader(moduleDir);

// Debug: show which .node file is loaded (helps diagnose "rebuild but not effective")
try {
  const loaded = Object.keys(require.cache || {}).filter((p) => p.endsWith('.node'));
  if (isDebugEnabled())
    console.log('[sensetype-keyhook] loaded .node candidates:', loaded.slice(-5));
} catch {
  // ignore
}

module.exports = binding;
