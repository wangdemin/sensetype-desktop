const path = require('node:path');
const bindingLoader = require('node-gyp-build');

const binding = bindingLoader(path.join(__dirname));
module.exports = binding;
