// Stub for Node's `fs` module used only by client-bundled dependencies
// (e.g. sql.js via @loaders.gl/geopackage) inside code paths gated behind
// Node-environment checks that never run in the browser. The real npm
// package named "fs" is a security-placeholder with no usable entry point,
// so bundling needs something resolvable here instead.
module.exports = {};
