// The plugin code uses window timers; the unit tests run in Node, so point window at the global object.
Object.assign(globalThis, { window: globalThis });
