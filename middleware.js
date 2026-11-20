/* CommonJS bundle of d3-node-middleware.ts. Vercel Node middleware require()s this file; the DNA package is ESM-only and cannot be required. */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// d3-node-middleware.ts
var d3_node_middleware_exports = {};
__export(d3_node_middleware_exports, {
  config: () => config,
  default: () => middleware
});
module.exports = __toCommonJS(d3_node_middleware_exports);

// node_modules/@logtape/logtape/dist/disposable.js
var disposeSymbol = Symbol.dispose ?? /* @__PURE__ */ Symbol.for("Symbol.dispose");
var asyncDisposeSymbol = Symbol.asyncDispose ?? /* @__PURE__ */ Symbol.for("Symbol.asyncDispose");

// node_modules/@logtape/logtape/dist/filter.js
function toFilter(filter) {
  if (typeof filter === "function") return filter;
  return getLevelFilter(filter);
}
function getLevelFilter(level) {
  const filter = createLevelFilter(level);
  levelFilters.set(filter, level);
  return filter;
}
var levelFilters = getLevelFilters();
function getLevelFilters() {
  const registry = globalThis;
  const key = /* @__PURE__ */ Symbol.for("logtape.levelFilters");
  const map = registry[key];
  if (map instanceof WeakMap) return map;
  const newMap = /* @__PURE__ */ new WeakMap();
  registry[key] = newMap;
  return newMap;
}
function createLevelFilter(level) {
  if (level == null) return () => false;
  if (level === "fatal") return (record) => record.level === "fatal";
  else if (level === "error") return (record) => record.level === "fatal" || record.level === "error";
  else if (level === "warning") return (record) => record.level === "fatal" || record.level === "error" || record.level === "warning";
  else if (level === "info") return (record) => record.level === "fatal" || record.level === "error" || record.level === "warning" || record.level === "info";
  else if (level === "debug") return (record) => record.level === "fatal" || record.level === "error" || record.level === "warning" || record.level === "info" || record.level === "debug";
  else if (level === "trace") return () => true;
  throw new TypeError(`Invalid log level: ${level}.`);
}

// node_modules/@logtape/logtape/dist/level.js
var logLevels = [
  "trace",
  "debug",
  "info",
  "warning",
  "error",
  "fatal"
];
function compareLogLevel(a, b) {
  const aIndex = logLevels.indexOf(a);
  if (aIndex < 0) throw new TypeError(`Invalid log level: ${JSON.stringify(a)}.`);
  const bIndex = logLevels.indexOf(b);
  if (bIndex < 0) throw new TypeError(`Invalid log level: ${JSON.stringify(b)}.`);
  return aIndex - bIndex;
}

// node_modules/@logtape/logtape/dist/scoped-config.js
var scopedConfigSymbol = /* @__PURE__ */ Symbol.for("logtape.scopedConfig");
var defaultScopedLogger = {
  filters: [],
  filterIds: [],
  lowestLevel: "trace",
  parentSinks: "inherit",
  sinks: [],
  sinkIds: [],
  captureSourceLocation: void 0
};
var noFilters = [];
function getCurrentScopedConfig(contextLocalStorage) {
  const store = contextLocalStorage?.getStore();
  const scopedConfig = store?.[scopedConfigSymbol];
  return isCompiledScopedConfig(scopedConfig) ? getActiveScopedConfig(scopedConfig) : void 0;
}
function scopedConfigHasSink(scopedConfig, category, level) {
  return getScopedSinkDispatchPlan(scopedConfig, category, level).kind !== "none";
}
function scopedConfigCapturesSourceLocation(scopedConfig, category) {
  if (!scopedConfig.capturesSourceLocation) return false;
  const key = categoryKey(category);
  let captures = scopedConfig.sourceLocationCaptureCache.get(key);
  if (captures == null) {
    captures = false;
    for (let length = category.length; length >= 0; length--) {
      const logger = scopedConfig.nodes.get(categoryKey(category.slice(0, length)));
      if (logger?.captureSourceLocation == null) continue;
      captures = logger.captureSourceLocation;
      break;
    }
    scopedConfig.sourceLocationCaptureCache.set(key, captures);
  }
  return captures;
}
function emitWithScopedConfig(scopedConfig, record, bypassSinks, emitToSink) {
  const plan = getScopedSinkDispatchPlan(scopedConfig, record.category, record.level);
  if (plan.kind === "none") return;
  if (!filterScopedRecord(scopedConfig, record.category, record)) return;
  if (plan.kind === "one") {
    if (!bypassSinks?.has(plan.sink)) emitToSink(plan.sink, bypassSinks);
    return;
  }
  for (const sink of plan.sinks) {
    if (bypassSinks?.has(sink)) continue;
    emitToSink(sink, bypassSinks);
  }
}
function isCompiledScopedConfig(value) {
  return value != null && typeof value === "object" && "nodes" in value;
}
function getActiveScopedConfig(scopedConfig) {
  let activeConfig = scopedConfig;
  while (activeConfig?.disposed) activeConfig = activeConfig.parent;
  return activeConfig;
}
function categoryKey(category) {
  return JSON.stringify(category);
}
function getScopedSinkDispatchPlan(scopedConfig, category, level) {
  const cacheKey = `${categoryKey(category)}:${level}`;
  let plan = scopedConfig.dispatchCache.get(cacheKey);
  if (plan == null) {
    plan = getScopedSinkDispatchPlanForPrefix(scopedConfig, category, category.length, level);
    scopedConfig.dispatchCache.set(cacheKey, plan);
  }
  return plan;
}
function getScopedSinkDispatchPlanForPrefix(scopedConfig, category, length, level) {
  const prefix = category.slice(0, length);
  const logger = scopedConfig.nodes.get(categoryKey(prefix)) ?? defaultScopedLogger;
  if (logger.lowestLevel === null || compareLogLevel(level, logger.lowestLevel) < 0) return { kind: "none" };
  const parentPlan = length > 0 && logger.parentSinks === "inherit" ? getScopedSinkDispatchPlanForPrefix(scopedConfig, category, length - 1, level) : length > 0 && logger.parentSinks === "forward" ? wrapScopedSinks(collectScopedForwardSinks(scopedConfig, category, length - 1)) : { kind: "none" };
  let firstSink;
  let sinks;
  const appendSink = (sink) => {
    if (sinks != null) sinks.push(sink);
    else if (firstSink == null) firstSink = sink;
    else sinks = [firstSink, sink];
  };
  if (parentPlan.kind === "one") appendSink(parentPlan.sink);
  else if (parentPlan.kind === "many") for (const sink of parentPlan.sinks) appendSink(sink);
  for (const sink of logger.sinks) appendSink(sink);
  if (sinks != null) return {
    kind: "many",
    sinks
  };
  if (firstSink != null) return {
    kind: "one",
    sink: firstSink
  };
  return { kind: "none" };
}
function collectScopedForwardSinks(scopedConfig, category, length) {
  const logger = scopedConfig.nodes.get(categoryKey(category.slice(0, length))) ?? defaultScopedLogger;
  const parentSinks = length > 0 && logger.parentSinks !== "override" ? collectScopedForwardSinks(scopedConfig, category, length - 1) : [];
  if (logger.sinks.length < 1) return parentSinks;
  if (parentSinks.length < 1) return logger.sinks;
  return [...parentSinks, ...logger.sinks];
}
function wrapScopedSinks(sinks) {
  if (sinks.length < 1) return { kind: "none" };
  if (sinks.length === 1) return {
    kind: "one",
    sink: sinks[0]
  };
  return {
    kind: "many",
    sinks
  };
}
function filterScopedRecord(scopedConfig, category, record) {
  const key = categoryKey(category);
  let filters = scopedConfig.filterCache.get(key);
  if (filters == null) {
    filters = getScopedFilters(scopedConfig, category);
    scopedConfig.filterCache.set(key, filters);
  }
  return filters.every((filter) => filter(record));
}
function getScopedFilters(scopedConfig, category) {
  for (let length = category.length; length >= 0; length--) {
    const logger = scopedConfig.nodes.get(categoryKey(category.slice(0, length)));
    if (logger == null || logger.filters.length < 1) continue;
    return logger.filters;
  }
  return noFilters;
}

// node_modules/@logtape/logtape/dist/source-location.js
var v8FramePrefix = "    at ";
var absoluteFilePattern = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/|\\\\)/;
var locationPattern = /^(.+):(\d+):(\d+)$/;
var rejected = /* @__PURE__ */ Symbol("rejected");
function parseSourceLocation(stack, frameIndex) {
  if (typeof stack !== "string") return void 0;
  const lines = stack.split("\n");
  if (lines[0].trim() === "Error") {
    if (lines.length < 2 || !lines[1].startsWith(v8FramePrefix)) return void 0;
    return parseV8Frame(lines[frameIndex + 1]);
  }
  if (lines[0] === "" || /^\s/.test(lines[0])) return void 0;
  return parseSpiderMonkeyFrame(lines[frameIndex]);
}
function parseV8Frame(frame) {
  if (frame == null || !frame.startsWith(v8FramePrefix)) return void 0;
  const body = frame.slice(v8FramePrefix.length);
  if (body.includes("eval at ")) return void 0;
  if (!body.endsWith(")")) return accept(parseLocation(body.startsWith("async ") ? body.slice(6) : body));
  let found;
  for (let i = body.indexOf(" ("); i >= 0; i = body.indexOf(" (", i + 1)) {
    const location = parseLocation(body.slice(i + 2, -1));
    if (location === rejected) return void 0;
    if (location == null) continue;
    if (found != null) return void 0;
    found = location;
  }
  return found;
}
function parseSpiderMonkeyFrame(frame) {
  if (frame == null) return void 0;
  const whole = parseLocation(frame);
  if (whole === rejected) return void 0;
  if (whole != null && absoluteFilePattern.test(whole.file)) return void 0;
  let found;
  for (let i = frame.indexOf("@"); i >= 0; i = frame.indexOf("@", i + 1)) {
    const location = parseLocation(frame.slice(i + 1));
    if (location === rejected) return void 0;
    if (location == null || !absoluteFilePattern.test(location.file)) continue;
    if (found != null) return void 0;
    found = location;
  }
  return found;
}
function accept(location) {
  return location === rejected ? void 0 : location;
}
function parseLocation(location) {
  const match = locationPattern.exec(location);
  if (match == null) return void 0;
  const file = match[1];
  const line = Number(match[2]);
  const column = Number(match[3]);
  if (file === "native" || file === "<anonymous>" || file === "[native code]" || file.includes("address at ") || file.includes("eval at ") || file.includes(" > eval") || file.includes(" > Function") || line < 1 || column < 1) return rejected;
  return {
    file,
    line,
    column
  };
}

// node_modules/@logtape/logtape/dist/logger.js
var lazySymbol = /* @__PURE__ */ Symbol.for("logtape.lazy");
var throttlingSummaryRecordSymbol = /* @__PURE__ */ Symbol.for("LogTape.throttlingSummaryRecord");
var immediateSinkSymbol = /* @__PURE__ */ Symbol.for("LogTape.sinkSnapshotPolicy.immediate");
var internalStringLogRecords = /* @__PURE__ */ new WeakSet();
var resolvedStringLogRecords = /* @__PURE__ */ new WeakSet();
var globalSourceLocationCapture = false;
var scopedSourceLocationCaptures = 0;
function isSourceLocationCaptureActive() {
  return globalSourceLocationCapture || scopedSourceLocationCaptures > 0;
}
function attachSourceLocation(record, sourceLocation) {
  if (sourceLocation == null) return;
  record.sourceLocation = sourceLocation;
}
function isLazy(value) {
  return value != null && typeof value === "object" && lazySymbol in value && value[lazySymbol] === true;
}
function resolveProperties(properties) {
  const resolved = {};
  for (const key in properties) {
    const value = properties[key];
    resolved[key] = isLazy(value) ? value.getter() : value;
  }
  const symbolProperties = properties;
  const symbolResolved = resolved;
  if (Object.prototype.propertyIsEnumerable.call(properties, throttlingSummaryRecordSymbol)) {
    const value = symbolProperties[throttlingSummaryRecordSymbol];
    symbolResolved[throttlingSummaryRecordSymbol] = isLazy(value) ? value.getter() : value;
  }
  return resolved;
}
function isPromiseObject(value) {
  if (value instanceof Promise) return true;
  return Object.prototype.toString.call(value) === "[object Promise]" && typeof value.then === "function";
}
function logStringMessage(logger, level, message, props, sourceLocation) {
  if (typeof props !== "function") {
    const properties = props ?? {};
    logger.log(level, message, properties, void 0, sourceLocation);
    return;
  }
  if (!logger.isEnabledFor(level)) return Promise.resolve();
  const result = props();
  if (isPromiseObject(result)) return Promise.resolve(result).then((resolvedProps) => {
    logger.log(level, message, resolvedProps, void 0, sourceLocation);
  });
  logger.log(level, message, result, void 0, sourceLocation);
}
function snapshotLogRecordProperties(record) {
  if (resolvedStringLogRecords.has(record)) return record;
  const properties = resolveProperties(record.properties);
  if (internalStringLogRecords.has(record)) {
    const snapshot = {
      category: record.category,
      level: record.level,
      get message() {
        return record.message;
      },
      rawMessage: record.rawMessage,
      timestamp: record.timestamp,
      properties
    };
    attachSourceLocation(snapshot, record.sourceLocation);
    return snapshot;
  }
  const descriptors = Object.getOwnPropertyDescriptors(record);
  descriptors.properties = {
    value: properties,
    enumerable: true,
    configurable: true
  };
  return Object.defineProperties({}, descriptors);
}
function hasEnumerableProperties(properties) {
  if (properties == null || typeof properties !== "object") return false;
  return Object.keys(properties).length > 0 || Object.prototype.propertyIsEnumerable.call(properties, throttlingSummaryRecordSymbol);
}
function shouldSnapshotForSink(sink) {
  return sink[immediateSinkSymbol] !== true;
}
function getLogger(category = []) {
  return LoggerImpl.getLogger(category);
}
var globalRootLoggerSymbol = /* @__PURE__ */ Symbol.for("logtape.rootLogger");
function isMetaLoggerCategory(category) {
  return category.length >= 2 && category[0] === "logtape" && category[1] === "meta";
}
var LoggerImpl = class LoggerImpl2 {
  parent;
  children;
  category;
  sinks;
  filters;
  contextLocalStorage;
  /**
  * Whether to capture source locations for this logger and its
  * descendants.  `undefined` inherits the setting from the parent.
  */
  sourceLocationCapture = void 0;
  #parentSinks = "inherit";
  #lowestLevel = "trace";
  #sinkPlanCache = {};
  #forwardPlanCache = void 0;
  static getLogger(category = []) {
    let rootLogger = globalRootLoggerSymbol in globalThis ? globalThis[globalRootLoggerSymbol] ?? null : null;
    if (rootLogger == null) {
      rootLogger = new LoggerImpl2(null, []);
      globalThis[globalRootLoggerSymbol] = rootLogger;
    }
    if (typeof category === "string") return rootLogger.getChild(category);
    if (category.length === 0) return rootLogger;
    return rootLogger.getChild(category);
  }
  static getNearestExistingLogger(category) {
    let logger = LoggerImpl2.getLogger();
    for (const name of category) {
      const childRef = logger.children[name];
      const child = childRef instanceof LoggerImpl2 ? childRef : childRef?.deref();
      if (child == null) break;
      logger = child;
    }
    return logger;
  }
  constructor(parent, category) {
    this.parent = parent;
    this.children = {};
    this.category = category;
    this.sinks = [];
    this.filters = [];
  }
  get parentSinks() {
    return this.#parentSinks;
  }
  set parentSinks(value) {
    if (this.#parentSinks === value) return;
    this.#parentSinks = value;
  }
  get lowestLevel() {
    return this.#lowestLevel;
  }
  set lowestLevel(value) {
    if (this.#lowestLevel === value) return;
    this.#lowestLevel = value;
  }
  getChild(subcategory) {
    const name = typeof subcategory === "string" ? subcategory : subcategory[0];
    const childRef = this.children[name];
    let child = childRef instanceof LoggerImpl2 ? childRef : childRef?.deref();
    if (child == null) {
      child = new LoggerImpl2(this, [...this.category, name]);
      this.children[name] = "WeakRef" in globalThis ? new WeakRef(child) : child;
    }
    if (typeof subcategory === "string" || subcategory.length === 1) return child;
    return child.getChild(subcategory.slice(1));
  }
  /**
  * Reset the logger.  This removes all sinks and filters from the logger.
  */
  reset() {
    while (this.sinks.length > 0) this.sinks.shift();
    this.parentSinks = "inherit";
    while (this.filters.length > 0) this.filters.shift();
    this.lowestLevel = "trace";
    this.sourceLocationCapture = void 0;
  }
  /**
  * Reset the logger and all its descendants.  This removes all sinks and
  * filters from the logger and all its descendants.
  */
  resetDescendants() {
    for (const child of Object.values(this.children)) {
      const logger = child instanceof LoggerImpl2 ? child : child.deref();
      if (logger != null) logger.resetDescendants();
    }
    this.reset();
  }
  with(properties) {
    return new LoggerCtx(this, { ...properties });
  }
  /**
  * Sets whether the global configuration enables source location capture
  * for any category.  Call this on the root logger only.
  */
  setGlobalSourceLocationCapture(enabled) {
    globalSourceLocationCapture = enabled;
  }
  /**
  * Records that a scoped configuration which enables source location
  * capture for some category became active.  Call this on the root logger
  * only, and balance it with
  * {@link LoggerImpl.releaseScopedSourceLocationCapture}.
  */
  retainScopedSourceLocationCapture() {
    scopedSourceLocationCaptures++;
  }
  /**
  * Records that a scoped configuration retained with
  * {@link LoggerImpl.retainScopedSourceLocationCapture} ended.  Call this on
  * the root logger only.
  */
  releaseScopedSourceLocationCapture() {
    if (scopedSourceLocationCaptures > 0) scopedSourceLocationCaptures--;
  }
  /**
  * Captures where user code called the public logging method that called
  * this method, if source location capture is enabled for this logger and
  * a record of the given level could be emitted.
  *
  * It must be called directly by the public logging method that user code
  * called (e.g., {@link LoggerImpl.info} or {@link LoggerCtx.info}), and
  * not in tail position, because the location is read from the third frame
  * of a stack trace constructed here: this method, the logging method, and
  * then its caller.  JavaScriptCore implements proper tail calls, so a call
  * in tail position would remove the logging method's frame.
  * @param level The log level of the record to be made.
  * @returns The source location, or `undefined` if capture is disabled, the
  *          record would certainly be dropped, or the stack trace could not
  *          be parsed.
  */
  captureSourceLocation(level) {
    if (isMetaLoggerCategory(this.category)) return void 0;
    const categoryPrefix = getCategoryPrefix();
    const scopedConfig = getCurrentScopedConfig(LoggerImpl2.getLogger().contextLocalStorage);
    if (scopedConfig != null) {
      const category = categoryPrefix.length > 0 ? [...categoryPrefix, ...this.category] : this.category;
      if (!scopedConfigHasSink(scopedConfig, category, level) || !scopedConfigCapturesSourceLocation(scopedConfig, category)) return void 0;
    } else {
      const dispatcher = this.getDispatcher(categoryPrefix);
      if (dispatcher.isCertainlyDroppedResolved(level) || !dispatcher.capturesSourceLocation()) return void 0;
    }
    try {
      return parseSourceLocation(new Error().stack, 2);
    } catch {
      return void 0;
    }
  }
  /**
  * Resolves whether this logger or the nearest ancestor that configures it
  * captures source locations.
  */
  capturesSourceLocation() {
    if (this.sourceLocationCapture != null) return this.sourceLocationCapture;
    return this.parent?.capturesSourceLocation() ?? false;
  }
  filter(record) {
    for (const filter of this.filters) if (!filter(record)) return false;
    if (this.filters.length < 1) return this.parent?.filter(record) ?? true;
    return true;
  }
  *getSinks(level) {
    const plan = this.getSinkDispatchPlan(level);
    switch (plan.kind) {
      case "none":
        return;
      case "one":
        yield plan.sink;
        return;
      case "many":
        yield* plan.sinks;
        return;
    }
  }
  getSinkDispatchPlan(level) {
    const cached = this.#sinkPlanCache[level];
    if (cached != null && this.isSinkDispatchPlanFresh(level, cached)) return cached;
    const plan = this.createSinkDispatchPlan(level, this.resolveParentPlan(level));
    this.#sinkPlanCache[level] = plan;
    return plan;
  }
  resolveParentPlan(level) {
    if (this.parent == null) return void 0;
    if (this.parentSinks === "inherit") return this.parent.getSinkDispatchPlan(level);
    if (this.parentSinks === "forward") return this.parent.getForwardSinkPlan();
    return void 0;
  }
  isSinkDispatchPlanFresh(level, plan) {
    if (plan.lowestLevel !== this.lowestLevel || plan.parentSinks !== this.parentSinks || plan.localSinks.length !== this.sinks.length) return false;
    for (let i = 0; i < plan.localSinks.length; i++) if (plan.localSinks[i] !== this.sinks[i]) return false;
    return plan.parentPlan === this.resolveParentPlan(level);
  }
  getForwardSinkPlan() {
    const cached = this.#forwardPlanCache;
    if (cached != null && this.isForwardSinkPlanFresh(cached)) return cached;
    const parentPlan = this.parent != null && this.parentSinks !== "override" ? this.parent.getForwardSinkPlan() : void 0;
    const plan = this.createForwardSinkPlan(parentPlan);
    this.#forwardPlanCache = plan;
    return plan;
  }
  isForwardSinkPlanFresh(plan) {
    if (plan.parentSinks !== this.parentSinks || plan.localSinks.length !== this.sinks.length) return false;
    for (let i = 0; i < plan.localSinks.length; i++) if (plan.localSinks[i] !== this.sinks[i]) return false;
    const parentPlan = this.parent != null && this.parentSinks !== "override" ? this.parent.getForwardSinkPlan() : void 0;
    return plan.parentPlan === parentPlan;
  }
  createForwardSinkPlan(parentPlan) {
    const localSinks = [...this.sinks];
    const sinks = parentPlan == null || parentPlan.sinks.length < 1 ? localSinks : [...parentPlan.sinks, ...localSinks];
    return {
      kind: "forward",
      localSinks,
      parentSinks: this.parentSinks,
      parentPlan,
      sinks
    };
  }
  createSinkDispatchPlan(level, parentPlan) {
    const state = {
      localSinks: [...this.sinks],
      parentSinks: this.parentSinks,
      lowestLevel: this.lowestLevel,
      parentPlan
    };
    if (state.lowestLevel === null) return {
      ...state,
      kind: "none"
    };
    if (compareLogLevel(level, state.lowestLevel) < 0) return {
      ...state,
      kind: "none"
    };
    let firstSink;
    let sinks;
    const appendSink = (sink) => {
      if (sinks != null) sinks.push(sink);
      else if (firstSink == null) firstSink = sink;
      else sinks = [firstSink, sink];
    };
    if (parentPlan != null) {
      if (parentPlan.kind === "one") firstSink = parentPlan.sink;
      else if (parentPlan.kind === "many") sinks = [...parentPlan.sinks];
      else if (parentPlan.kind === "forward") {
        if (parentPlan.sinks.length === 1) firstSink = parentPlan.sinks[0];
        else if (parentPlan.sinks.length > 1) sinks = [...parentPlan.sinks];
      }
    }
    for (const sink of state.localSinks) appendSink(sink);
    if (sinks != null) return {
      ...state,
      kind: "many",
      sinks
    };
    if (firstSink != null) return {
      ...state,
      kind: "one",
      sink: firstSink
    };
    return {
      ...state,
      kind: "none"
    };
  }
  isEnabledFor(level) {
    const categoryPrefix = isMetaLoggerCategory(this.category) ? [] : getCategoryPrefix();
    const scopedConfig = getCurrentScopedConfig(LoggerImpl2.getLogger().contextLocalStorage);
    if (scopedConfig != null) return scopedConfigHasSink(scopedConfig, categoryPrefix.length > 0 ? [...categoryPrefix, ...this.category] : this.category, level);
    return this.getDispatcher(categoryPrefix).isEnabledForResolved(level);
  }
  /**
  * Checks whether a record of the given level logged through this logger
  * would certainly be dropped without being seen by any filter or sink.
  * Logging methods use this to return before building a record.
  *
  * This assumes the context-local storage's store does not change between
  * synchronous reads within a single logging call, which holds for
  * `AsyncLocalStorage` and for the stores set up by `withContext()`,
  * `withCategoryPrefix()`, and `withConfig()`.
  * @param level The log level of the record.
  * @returns `true` if emitting such a record would have no observable
  *          effect, `false` otherwise.
  */
  isCertainlyDropped(level) {
    const categoryPrefix = isMetaLoggerCategory(this.category) ? [] : getCategoryPrefix();
    const scopedConfig = getCurrentScopedConfig(LoggerImpl2.getLogger().contextLocalStorage);
    if (scopedConfig != null) return !scopedConfigHasSink(scopedConfig, categoryPrefix.length > 0 ? [...categoryPrefix, ...this.category] : this.category, level);
    return this.getDispatcher(categoryPrefix).isCertainlyDroppedResolved(level);
  }
  /**
  * Checks whether a record of the given level dispatched by this logger,
  * without a scoped configuration, would certainly be dropped.  See
  * {@link LoggerImpl.isCertainlyDropped}.
  */
  isCertainlyDroppedResolved(level) {
    if (this.lowestLevel === null || compareLogLevel(level, this.lowestLevel) < 0) return true;
    return !this.isEnabledForResolved(level) && !this.hasEffectiveFilters();
  }
  /**
  * Resolves the logger that actually dispatches records logged through this
  * logger under the given category prefix.  It must stay in sync with
  * the dispatcher resolution in {@link LoggerImpl.emit}.
  */
  getDispatcher(categoryPrefix) {
    return categoryPrefix.length > 0 ? LoggerImpl2.getNearestExistingLogger([...categoryPrefix, ...this.category]) : this;
  }
  /**
  * Checks whether {@link LoggerImpl.filter} would run any filter, i.e.,
  * whether this logger or any of its ancestors has a filter.
  */
  hasEffectiveFilters() {
    if (this.filters.length > 0) return true;
    return this.parent?.hasEffectiveFilters() ?? false;
  }
  /**
  * Checks whether {@link LoggerImpl.getSinks} would yield any sink for
  * the given level, without building or validating sink dispatch plans.
  * It must stay in sync with {@link LoggerImpl.createSinkDispatchPlan}.
  */
  isEnabledForResolved(level) {
    if (this.lowestLevel === null || compareLogLevel(level, this.lowestLevel) < 0) return false;
    if (this.sinks.length > 0) return true;
    if (this.parent == null) return false;
    if (this.parentSinks === "inherit") return this.parent.isEnabledForResolved(level);
    if (this.parentSinks === "forward") return this.parent.hasForwardSinks();
    return false;
  }
  /**
  * Checks whether {@link LoggerImpl.getForwardSinkPlan} would collect any
  * sink, i.e., whether this logger or an ancestor up to and including the
  * nearest one whose `parentSinks` is `"override"` has local sinks.
  */
  hasForwardSinks() {
    if (this.sinks.length > 0) return true;
    return this.parent != null && this.parentSinks !== "override" && this.parent.hasForwardSinks();
  }
  emit(record, bypassSinks) {
    const hasCategory = "category" in record;
    const baseCategory = hasCategory ? record.category : this.category;
    const categoryPrefix = isMetaLoggerCategory(baseCategory) ? [] : getCategoryPrefix();
    const fullCategory = categoryPrefix.length > 0 ? [...categoryPrefix, ...baseCategory] : baseCategory;
    if (categoryPrefix.length < 1 && Object.prototype.hasOwnProperty.call(record, "category")) {
      this.emitResolved(record, bypassSinks);
      return;
    }
    const descriptors = Object.getOwnPropertyDescriptors(record);
    descriptors.category = {
      value: fullCategory,
      enumerable: true,
      configurable: true
    };
    const fullRecord = Object.defineProperties({}, descriptors);
    const dispatcher = categoryPrefix.length > 0 ? LoggerImpl2.getNearestExistingLogger(fullCategory) : this;
    dispatcher.emitResolved(fullRecord, bypassSinks);
  }
  emitResolved(record, bypassSinks) {
    const scopedConfig = getCurrentScopedConfig(LoggerImpl2.getLogger().contextLocalStorage);
    if (scopedConfig != null) {
      let snapshot$1;
      let snapshotFailed$1 = false;
      emitWithScopedConfig(scopedConfig, record, bypassSinks, (sink, activeBypassSinks) => {
        try {
          if (shouldSnapshotForSink(sink)) try {
            snapshot$1 ??= snapshotLogRecordProperties(record);
          } catch {
            snapshotFailed$1 = true;
            snapshot$1 = record;
          }
          sink(snapshot$1 ?? record);
        } catch (error) {
          const bypassSinks2 = new Set(activeBypassSinks);
          bypassSinks2.add(sink);
          metaLogger.log("fatal", "Failed to emit a log record to sink {sink}: {error}", {
            sink,
            error,
            record
          }, bypassSinks2);
        }
        if (snapshotFailed$1) snapshot$1 = record;
      });
      return;
    }
    if (this.lowestLevel === null || compareLogLevel(record.level, this.lowestLevel) < 0 || !this.filter(record)) return;
    const plan = this.getSinkDispatchPlan(record.level);
    if (plan.kind === "none") return;
    let snapshot;
    let snapshotFailed = false;
    if (plan.kind === "one") {
      const sink = plan.sink;
      if (bypassSinks?.has(sink)) return;
      try {
        if (shouldSnapshotForSink(sink)) try {
          snapshot = snapshotLogRecordProperties(record);
        } catch {
          snapshotFailed = true;
          snapshot = record;
        }
        sink(snapshot ?? record);
      } catch (error) {
        const bypassSinks2 = new Set(bypassSinks);
        bypassSinks2.add(sink);
        metaLogger.log("fatal", "Failed to emit a log record to sink {sink}: {error}", {
          sink,
          error,
          record
        }, bypassSinks2);
      }
      return;
    }
    for (const sink of plan.sinks) {
      if (bypassSinks?.has(sink)) continue;
      try {
        if (snapshot == null && !snapshotFailed && shouldSnapshotForSink(sink)) try {
          snapshot = snapshotLogRecordProperties(record);
        } catch {
          snapshotFailed = true;
          snapshot = record;
        }
        sink(snapshot ?? record);
      } catch (error) {
        const bypassSinks2 = new Set(bypassSinks);
        bypassSinks2.add(sink);
        metaLogger.log("fatal", "Failed to emit a log record to sink {sink}: {error}", {
          sink,
          error,
          record
        }, bypassSinks2);
      }
    }
  }
  log(level, rawMessage, properties, bypassSinks, sourceLocation) {
    if (this.isCertainlyDropped(level)) return;
    const implicitContext = getImplicitContextIfAny();
    if (typeof properties !== "function" && implicitContext == null && !rawMessage.includes("{") && !hasEnumerableProperties(properties)) {
      const record$1 = {
        category: this.category,
        level,
        message: [rawMessage],
        rawMessage,
        timestamp: Date.now(),
        properties: {}
      };
      attachSourceLocation(record$1, sourceLocation);
      resolvedStringLogRecords.add(record$1);
      this.emit(record$1, bypassSinks);
      return;
    }
    let cachedProps = void 0;
    let cachedMessage = void 0;
    const record = typeof properties === "function" ? {
      category: this.category,
      level,
      timestamp: Date.now(),
      get message() {
        if (cachedMessage == null) cachedMessage = parseMessageTemplate(rawMessage, this.properties);
        return cachedMessage;
      },
      rawMessage,
      get properties() {
        if (cachedProps == null) cachedProps = resolveProperties({
          ...implicitContext ?? {},
          ...properties()
        });
        return cachedProps;
      }
    } : {
      category: this.category,
      level,
      timestamp: Date.now(),
      get message() {
        if (cachedMessage == null) cachedMessage = parseMessageTemplate(rawMessage, this.properties);
        return cachedMessage;
      },
      rawMessage,
      get properties() {
        if (cachedProps == null) cachedProps = resolveProperties({
          ...implicitContext ?? {},
          ...properties
        });
        return cachedProps;
      }
    };
    attachSourceLocation(record, sourceLocation);
    internalStringLogRecords.add(record);
    this.emit(record, bypassSinks);
  }
  logLazily(level, callback, properties = {}, sourceLocation) {
    if (this.isCertainlyDropped(level)) return;
    const implicitContext = getImplicitContextIfAny();
    let rawMessage = void 0;
    let msg = void 0;
    function realizeMessage() {
      if (msg == null || rawMessage == null) {
        msg = callback((tpl, ...values) => {
          rawMessage = tpl;
          return renderMessage(tpl, values);
        });
        if (rawMessage == null) throw new TypeError("No log record was made.");
      }
      return [msg, rawMessage];
    }
    const record = {
      category: this.category,
      level,
      get message() {
        return realizeMessage()[0];
      },
      get rawMessage() {
        return realizeMessage()[1];
      },
      timestamp: Date.now(),
      properties: {
        ...implicitContext ?? {},
        ...properties
      }
    };
    attachSourceLocation(record, sourceLocation);
    this.emit(record);
  }
  logTemplate(level, messageTemplate, values, properties = {}, sourceLocation) {
    if (this.isCertainlyDropped(level)) return;
    const implicitContext = getImplicitContextIfAny();
    const record = {
      category: this.category,
      level,
      message: renderMessage(messageTemplate, values),
      rawMessage: messageTemplate,
      timestamp: Date.now(),
      properties: {
        ...implicitContext ?? {},
        ...properties
      }
    };
    attachSourceLocation(record, sourceLocation);
    this.emit(record);
  }
  trace(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.captureSourceLocation("trace") : void 0;
    if (typeof message === "string") return logStringMessage(this, "trace", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("trace", message, void 0, sourceLocation);
    else if (!Array.isArray(message)) this.log("trace", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("trace", message, values, void 0, sourceLocation);
  }
  debug(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.captureSourceLocation("debug") : void 0;
    if (typeof message === "string") return logStringMessage(this, "debug", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("debug", message, void 0, sourceLocation);
    else if (!Array.isArray(message)) this.log("debug", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("debug", message, values, void 0, sourceLocation);
  }
  info(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.captureSourceLocation("info") : void 0;
    if (typeof message === "string") return logStringMessage(this, "info", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("info", message, void 0, sourceLocation);
    else if (!Array.isArray(message)) this.log("info", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("info", message, values, void 0, sourceLocation);
  }
  logError(level, error, props, sourceLocation) {
    if (typeof props !== "function") {
      this.log(level, "{error.message}", {
        ...props,
        error
      }, void 0, sourceLocation);
      return;
    }
    if (!this.isEnabledFor(level)) return Promise.resolve();
    const result = props();
    if (result instanceof Promise) return result.then((resolved) => {
      this.log(level, "{error.message}", {
        ...resolved,
        error
      }, void 0, sourceLocation);
    });
    this.log(level, "{error.message}", {
      ...result,
      error
    }, void 0, sourceLocation);
  }
  warn(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.captureSourceLocation("warning") : void 0;
    if (message instanceof Error) return this.logError("warning", message, values[0], sourceLocation);
    else if (typeof message === "string" && values[0] instanceof Error) this.log("warning", message, { error: values[0] }, void 0, sourceLocation);
    else if (typeof message === "string") return logStringMessage(this, "warning", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("warning", message, void 0, sourceLocation);
    else if (!Array.isArray(message)) this.log("warning", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("warning", message, values, void 0, sourceLocation);
  }
  warning(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.captureSourceLocation("warning") : void 0;
    if (message instanceof Error) return this.logError("warning", message, values[0], sourceLocation);
    else if (typeof message === "string" && values[0] instanceof Error) this.log("warning", message, { error: values[0] }, void 0, sourceLocation);
    else if (typeof message === "string") return logStringMessage(this, "warning", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("warning", message, void 0, sourceLocation);
    else if (!Array.isArray(message)) this.log("warning", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("warning", message, values, void 0, sourceLocation);
  }
  error(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.captureSourceLocation("error") : void 0;
    if (message instanceof Error) return this.logError("error", message, values[0], sourceLocation);
    else if (typeof message === "string" && values[0] instanceof Error) this.log("error", message, { error: values[0] }, void 0, sourceLocation);
    else if (typeof message === "string") return logStringMessage(this, "error", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("error", message, void 0, sourceLocation);
    else if (!Array.isArray(message)) this.log("error", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("error", message, values, void 0, sourceLocation);
  }
  fatal(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.captureSourceLocation("fatal") : void 0;
    if (message instanceof Error) return this.logError("fatal", message, values[0], sourceLocation);
    else if (typeof message === "string" && values[0] instanceof Error) this.log("fatal", message, { error: values[0] }, void 0, sourceLocation);
    else if (typeof message === "string") return logStringMessage(this, "fatal", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("fatal", message, void 0, sourceLocation);
    else if (!Array.isArray(message)) this.log("fatal", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("fatal", message, values, void 0, sourceLocation);
  }
};
var LoggerCtx = class LoggerCtx2 {
  logger;
  properties;
  constructor(logger, properties) {
    this.logger = logger;
    this.properties = properties;
  }
  get category() {
    return this.logger.category;
  }
  get parent() {
    return this.logger.parent;
  }
  getChild(subcategory) {
    return this.logger.getChild(subcategory).with(this.properties);
  }
  with(properties) {
    return new LoggerCtx2(this.logger, {
      ...this.properties,
      ...properties
    });
  }
  log(level, message, properties, bypassSinks, sourceLocation) {
    if (this.logger.isCertainlyDropped(level)) return;
    const contextProps = this.properties;
    this.logger.log(level, message, typeof properties === "function" ? () => resolveProperties({
      ...contextProps,
      ...properties()
    }) : () => resolveProperties({
      ...contextProps,
      ...properties
    }), bypassSinks, sourceLocation);
  }
  logLazily(level, callback, sourceLocation) {
    if (this.logger.isCertainlyDropped(level)) return;
    this.logger.logLazily(level, callback, resolveProperties(this.properties), sourceLocation);
  }
  logTemplate(level, messageTemplate, values, sourceLocation) {
    if (this.logger.isCertainlyDropped(level)) return;
    this.logger.logTemplate(level, messageTemplate, values, resolveProperties(this.properties), sourceLocation);
  }
  emit(record) {
    const recordWithContext = {
      ...record,
      properties: resolveProperties({
        ...this.properties,
        ...record.properties
      })
    };
    this.logger.emit(recordWithContext);
  }
  isEnabledFor(level) {
    return this.logger.isEnabledFor(level);
  }
  trace(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.logger.captureSourceLocation("trace") : void 0;
    if (typeof message === "string") return logStringMessage(this, "trace", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("trace", message, sourceLocation);
    else if (!Array.isArray(message)) this.log("trace", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("trace", message, values, sourceLocation);
  }
  debug(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.logger.captureSourceLocation("debug") : void 0;
    if (typeof message === "string") return logStringMessage(this, "debug", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("debug", message, sourceLocation);
    else if (!Array.isArray(message)) this.log("debug", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("debug", message, values, sourceLocation);
  }
  info(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.logger.captureSourceLocation("info") : void 0;
    if (typeof message === "string") return logStringMessage(this, "info", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("info", message, sourceLocation);
    else if (!Array.isArray(message)) this.log("info", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("info", message, values, sourceLocation);
  }
  logError(level, error, props, sourceLocation) {
    if (typeof props !== "function") {
      this.log(level, "{error.message}", {
        ...props,
        error
      }, void 0, sourceLocation);
      return;
    }
    if (!this.isEnabledFor(level)) return Promise.resolve();
    const result = props();
    if (result instanceof Promise) return result.then((resolved) => {
      this.log(level, "{error.message}", {
        ...resolved,
        error
      }, void 0, sourceLocation);
    });
    this.log(level, "{error.message}", {
      ...result,
      error
    }, void 0, sourceLocation);
  }
  warn(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.logger.captureSourceLocation("warning") : void 0;
    if (message instanceof Error) return this.logError("warning", message, values[0], sourceLocation);
    else if (typeof message === "string" && values[0] instanceof Error) this.log("warning", message, { error: values[0] }, void 0, sourceLocation);
    else if (typeof message === "string") return logStringMessage(this, "warning", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("warning", message, sourceLocation);
    else if (!Array.isArray(message)) this.log("warning", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("warning", message, values, sourceLocation);
  }
  warning(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.logger.captureSourceLocation("warning") : void 0;
    if (message instanceof Error) return this.logError("warning", message, values[0], sourceLocation);
    else if (typeof message === "string" && values[0] instanceof Error) this.log("warning", message, { error: values[0] }, void 0, sourceLocation);
    else if (typeof message === "string") return logStringMessage(this, "warning", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("warning", message, sourceLocation);
    else if (!Array.isArray(message)) this.log("warning", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("warning", message, values, sourceLocation);
  }
  error(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.logger.captureSourceLocation("error") : void 0;
    if (message instanceof Error) return this.logError("error", message, values[0], sourceLocation);
    else if (typeof message === "string" && values[0] instanceof Error) this.log("error", message, { error: values[0] }, void 0, sourceLocation);
    else if (typeof message === "string") return logStringMessage(this, "error", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("error", message, sourceLocation);
    else if (!Array.isArray(message)) this.log("error", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("error", message, values, sourceLocation);
  }
  fatal(message, ...values) {
    const sourceLocation = isSourceLocationCaptureActive() ? this.logger.captureSourceLocation("fatal") : void 0;
    if (message instanceof Error) return this.logError("fatal", message, values[0], sourceLocation);
    else if (typeof message === "string" && values[0] instanceof Error) this.log("fatal", message, { error: values[0] }, void 0, sourceLocation);
    else if (typeof message === "string") return logStringMessage(this, "fatal", message, values[0], sourceLocation);
    else if (typeof message === "function") this.logLazily("fatal", message, sourceLocation);
    else if (!Array.isArray(message)) this.log("fatal", "{*}", message, void 0, sourceLocation);
    else this.logTemplate("fatal", message, values, sourceLocation);
  }
};
var metaLogger = LoggerImpl.getLogger(["logtape", "meta"]);
function isNestedAccess(key) {
  return key.includes(".") || key.includes("[") || key.includes("?.");
}
function getOwnProperty(obj, key) {
  if (key === "__proto__" || key === "prototype" || key === "constructor") return void 0;
  if ((typeof obj === "object" || typeof obj === "function") && obj !== null) return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : void 0;
  return void 0;
}
function parseNextSegment(path, fromIndex) {
  const len = path.length;
  let i = fromIndex;
  if (i >= len) return null;
  let segment;
  if (path[i] === "[") {
    i++;
    if (i >= len) return null;
    if (path[i] === '"' || path[i] === "'") {
      const quote = path[i];
      i++;
      let segmentStr = "";
      while (i < len && path[i] !== quote) if (path[i] === "\\") {
        i++;
        if (i < len) {
          const escapeChar2 = path[i];
          switch (escapeChar2) {
            case "n":
              segmentStr += "\n";
              break;
            case "t":
              segmentStr += "	";
              break;
            case "r":
              segmentStr += "\r";
              break;
            case "b":
              segmentStr += "\b";
              break;
            case "f":
              segmentStr += "\f";
              break;
            case "v":
              segmentStr += "\v";
              break;
            case "0":
              segmentStr += "\0";
              break;
            case "\\":
              segmentStr += "\\";
              break;
            case '"':
              segmentStr += '"';
              break;
            case "'":
              segmentStr += "'";
              break;
            case "u":
              if (i + 4 < len) {
                const hex = path.slice(i + 1, i + 5);
                const codePoint = Number.parseInt(hex, 16);
                if (!Number.isNaN(codePoint)) {
                  segmentStr += String.fromCharCode(codePoint);
                  i += 4;
                } else segmentStr += escapeChar2;
              } else segmentStr += escapeChar2;
              break;
            default:
              segmentStr += escapeChar2;
          }
          i++;
        }
      } else {
        segmentStr += path[i];
        i++;
      }
      if (i >= len) return null;
      segment = segmentStr;
      i++;
    } else {
      const startIndex = i;
      while (i < len && path[i] !== "]" && path[i] !== "'" && path[i] !== '"') i++;
      if (i >= len) return null;
      const indexStr = path.slice(startIndex, i);
      if (indexStr.length === 0) return null;
      const indexNum = Number(indexStr);
      segment = Number.isNaN(indexNum) ? indexStr : indexNum;
    }
    while (i < len && path[i] !== "]") i++;
    if (i < len) i++;
  } else {
    const startIndex = i;
    while (i < len && path[i] !== "." && path[i] !== "[" && path[i] !== "?" && path[i] !== "]") i++;
    segment = path.slice(startIndex, i);
    if (segment.length === 0) return null;
  }
  if (i < len && path[i] === ".") i++;
  return {
    segment,
    nextIndex: i
  };
}
function accessProperty(obj, segment) {
  if (typeof segment === "string") return getOwnProperty(obj, segment);
  if (Array.isArray(obj) && segment >= 0 && segment < obj.length) return obj[segment];
  return void 0;
}
function resolvePropertyPath(obj, path) {
  if (obj == null) return void 0;
  if (path.length === 0 || path.endsWith(".")) return void 0;
  let current = obj;
  let i = 0;
  const len = path.length;
  while (i < len) {
    const isOptional = path.slice(i, i + 2) === "?.";
    if (isOptional) {
      i += 2;
      if (current == null) return void 0;
    } else if (current == null) return void 0;
    const result = parseNextSegment(path, i);
    if (result === null) return void 0;
    const { segment, nextIndex } = result;
    i = nextIndex;
    current = accessProperty(current, segment);
    if (current === void 0) return void 0;
  }
  return current;
}
function parseMessageTemplate(template, properties) {
  const length = template.length;
  if (length === 0) return [""];
  if (!template.includes("{")) return [template];
  const message = [];
  let startIndex = 0;
  for (let i = 0; i < length; i++) {
    const char = template[i];
    if (char === "{") {
      const nextChar = i + 1 < length ? template[i + 1] : "";
      if (nextChar === "{") {
        i++;
        continue;
      }
      const closeIndex = template.indexOf("}", i + 1);
      if (closeIndex === -1) continue;
      const beforeText = template.slice(startIndex, i);
      message.push(beforeText.replace(/{{/g, "{").replace(/}}/g, "}"));
      const key = template.slice(i + 1, closeIndex);
      let prop;
      const trimmedKey = key.trim();
      if (trimmedKey === "*") prop = key in properties ? properties[key] : "*" in properties ? properties["*"] : properties;
      else {
        if (key !== trimmedKey) prop = key in properties ? properties[key] : properties[trimmedKey];
        else prop = properties[key];
        if (prop === void 0 && isNestedAccess(trimmedKey)) prop = resolvePropertyPath(properties, trimmedKey);
      }
      message.push(prop);
      i = closeIndex;
      startIndex = i + 1;
    } else if (char === "}" && i + 1 < length && template[i + 1] === "}") i++;
  }
  const remainingText = template.slice(startIndex);
  message.push(remainingText.replace(/{{/g, "{").replace(/}}/g, "}"));
  return message;
}
function renderMessage(template, values) {
  const args = [];
  for (let i = 0; i < template.length; i++) {
    args.push(template[i]);
    if (i < values.length) args.push(values[i]);
  }
  return args;
}

// node_modules/@logtape/logtape/dist/context.js
var categoryPrefixSymbol = /* @__PURE__ */ Symbol.for("logtape.categoryPrefix");
function getCategoryPrefix() {
  const rootLogger = LoggerImpl.getLogger();
  const store = rootLogger.contextLocalStorage?.getStore();
  if (store == null) return [];
  const prefix = store[categoryPrefixSymbol];
  return Array.isArray(prefix) ? prefix : [];
}
function getImplicitContextIfAny() {
  const rootLogger = LoggerImpl.getLogger();
  const store = rootLogger.contextLocalStorage?.getStore();
  if (store == null) return void 0;
  const keys = Object.keys(store);
  if (keys.length < 1) return void 0;
  const result = {};
  for (const key of keys) result[key] = store[key];
  return result;
}

// node_modules/@logtape/logtape/dist/sanitize.js
function escapeChar(charCode) {
  if (charCode === 10) return "\\n";
  if (charCode === 13) return "\\r";
  if (charCode === 27) return "\\x1b";
  return `\\x${charCode.toString(16).padStart(2, "0")}`;
}
function isDangerous(charCode, escapeNewlines) {
  if (charCode === 9) return false;
  if (charCode === 10 || charCode === 13) return escapeNewlines;
  if (charCode < 32 || charCode === 127) return true;
  return charCode >= 128 && charCode <= 159;
}
var sgrPattern = /^\x1b\[([0-9;:]*)m/;
var sgrReset = "\x1B[0m";
function sanitizeControlSequences(text, options = {}) {
  const preserveSgr = options.sgr !== "escape";
  const escapeNewlines = options.newlines === "escape";
  let needsWork = false;
  for (let i$1 = 0; i$1 < text.length; i$1++) {
    const charCode = text.charCodeAt(i$1);
    if (charCode === 27 || isDangerous(charCode, escapeNewlines)) {
      needsWork = true;
      break;
    }
  }
  if (!needsWork) return text;
  let result = "";
  let i = 0;
  let sgrOpen = false;
  while (i < text.length) {
    const charCode = text.charCodeAt(i);
    if (charCode === 27) {
      if (preserveSgr) {
        const sgr = sgrPattern.exec(text.slice(i));
        if (sgr != null) {
          result += sgr[0];
          sgrOpen = !isSgrReset(sgr[1]);
          i += sgr[0].length;
          continue;
        }
      }
      result += escapeChar(27);
      i++;
    } else if (isDangerous(charCode, escapeNewlines)) {
      result += escapeChar(charCode);
      i++;
    } else {
      result += text[i];
      i++;
    }
  }
  return sgrOpen ? result + sgrReset : result;
}
function isSgrReset(parameters) {
  return /^0*$/.test(parameters.replace(/[;:]/g, ""));
}
function getSanitizer(options) {
  if (options === false) return null;
  const resolved = options ?? {};
  return (text) => sanitizeControlSequences(text, resolved);
}

// node_modules/@logtape/logtape/dist/circular.js
function createCircularReplacer(inner) {
  const sources = [];
  const results = [];
  return function(key, value) {
    const result = inner === void 0 ? value : inner.call(this, key, value);
    if (typeof result !== "object" || result === null) return result;
    while (results.length > 0 && results[results.length - 1] !== this) {
      results.pop();
      sources.pop();
    }
    for (let i = 0; i < results.length; i++) if (results[i] === result || sources[i] === value) return "[Circular]";
    sources.push(value);
    results.push(result);
    return result;
  };
}
function stringifyWithoutCycles(value, replacer, space) {
  try {
    return JSON.stringify(value, replacer, space);
  } catch {
    return JSON.stringify(value, createCircularReplacer(replacer), space);
  }
}

// node_modules/@logtape/logtape/dist/util.node.js
var util_node_exports = {};
__export(util_node_exports, {
  inspect: () => inspect
});
var import_node_util = __toESM(require("node:util"), 1);
function inspect(obj, options) {
  return import_node_util.default.inspect(obj, options);
}

// node_modules/@logtape/logtape/dist/formatter.js
var levelAbbreviations = {
  "trace": "TRC",
  "debug": "DBG",
  "info": "INF",
  "warning": "WRN",
  "error": "ERR",
  "fatal": "FTL"
};
var platformInspect = typeof document !== "undefined" || typeof navigator !== "undefined" && navigator.product === "ReactNative" ? (v) => stringifyWithoutCycles(v) : "Deno" in globalThis && "inspect" in globalThis.Deno && typeof globalThis.Deno.inspect === "function" ? (v, opts) => globalThis.Deno.inspect(v, {
  strAbbreviateSize: Infinity,
  iterableLimit: Infinity,
  ...opts
}) : util_node_exports != null && "inspect" in util_node_exports && typeof inspect === "function" ? (v, opts) => inspect(v, {
  maxArrayLength: Infinity,
  maxStringLength: Infinity,
  ...opts
}) : (v) => stringifyWithoutCycles(v);
var inspect2 = (value, options) => String(platformInspect(value, options));
var utf8Encoder = new TextEncoder();
function getValueRenderer(value, sanitize, fallback) {
  if (value == null) return fallback;
  if (typeof value === "function") return (v) => value(v, inspect2);
  if (value !== "bare") throw new TypeError(`Invalid value option: ${JSON.stringify(value)}. It must be "bare" or a function.`);
  const sanitizeBare = sanitize === false ? null : getSanitizer({
    sgr: "escape",
    newlines: sanitize?.newlines ?? "escape"
  });
  return sanitizeBare == null ? (v) => typeof v === "string" ? v : fallback(v) : (v) => typeof v === "string" ? sanitizeBare(v) : fallback(v);
}
function renderMessageParts(msgParts, valueRenderer, sanitize) {
  const msgLen = msgParts.length;
  const renderPart = sanitize == null ? (part) => part : (part) => sanitize(part);
  if (msgLen === 1) return renderPart(msgParts[0]);
  if (msgLen <= 6) {
    let message = "";
    for (let i = 0; i < msgLen; i++) message += i % 2 === 0 ? renderPart(msgParts[i]) : valueRenderer(msgParts[i]);
    return message;
  }
  const parts = new Array(msgLen);
  for (let i = 0; i < msgLen; i++) parts[i] = i % 2 === 0 ? renderPart(msgParts[i]) : valueRenderer(msgParts[i]);
  return parts.join("");
}
function padZero(num) {
  return num < 10 ? `0${num}` : `${num}`;
}
function padThree(num) {
  return num < 10 ? `00${num}` : num < 100 ? `0${num}` : `${num}`;
}
var fixedOffsetPattern = /^([+-])(0\d|1\d|2[0-3]):([0-5]\d)$/;
function formatOffset(minutes, full) {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hour = padZero(Math.floor(absolute / 60));
  const minute = padZero(absolute % 60);
  if (!full && minute === "00") return `${sign}${hour}`;
  return `${sign}${hour}:${minute}`;
}
function readPartsFromFormatter(formatter, ts) {
  const parts = formatter.formatToParts(new Date(ts));
  let year = "";
  let month = "";
  let day = "";
  let hour = "";
  let minute = "";
  let second = "";
  for (const part of parts) if (part.type === "year") year = part.value;
  else if (part.type === "month") month = part.value;
  else if (part.type === "day") day = part.value;
  else if (part.type === "hour") hour = part.value;
  else if (part.type === "minute") minute = part.value;
  else if (part.type === "second") second = part.value;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second
  };
}
function getDateParts(ts, config2) {
  const d = new Date(ts);
  const ms = padThree(d.getUTCMilliseconds());
  if (config2.kind === "utc") return {
    year: `${d.getUTCFullYear()}`,
    month: padZero(d.getUTCMonth() + 1),
    day: padZero(d.getUTCDate()),
    hour: padZero(d.getUTCHours()),
    minute: padZero(d.getUTCMinutes()),
    second: padZero(d.getUTCSeconds()),
    ms,
    offsetMinutes: 0
  };
  if (config2.kind === "local") return {
    year: `${d.getFullYear()}`,
    month: padZero(d.getMonth() + 1),
    day: padZero(d.getDate()),
    hour: padZero(d.getHours()),
    minute: padZero(d.getMinutes()),
    second: padZero(d.getSeconds()),
    ms,
    offsetMinutes: -d.getTimezoneOffset()
  };
  if (config2.kind === "offset") {
    const shifted = new Date(ts + config2.minutes * 6e4);
    return {
      year: `${shifted.getUTCFullYear()}`,
      month: padZero(shifted.getUTCMonth() + 1),
      day: padZero(shifted.getUTCDate()),
      hour: padZero(shifted.getUTCHours()),
      minute: padZero(shifted.getUTCMinutes()),
      second: padZero(shifted.getUTCSeconds()),
      ms,
      offsetMinutes: config2.minutes
    };
  }
  const parts = readPartsFromFormatter(config2.formatter, ts);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second), d.getUTCMilliseconds());
  const offsetMinutes = Math.round((asUtc - ts) / 6e4);
  return {
    ...parts,
    ms,
    offsetMinutes
  };
}
function resolveTimeZone(timeZone) {
  if (typeof timeZone === "undefined") return { kind: "utc" };
  if (timeZone === null) return { kind: "local" };
  const offsetMatch = fixedOffsetPattern.exec(timeZone);
  if (offsetMatch != null) {
    const sign = offsetMatch[1] === "-" ? -1 : 1;
    const hours = Number(offsetMatch[2]);
    const minutes = Number(offsetMatch[3]);
    return {
      kind: "offset",
      minutes: sign * (hours * 60 + minutes)
    };
  }
  if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") throw new TypeError(`Invalid timeZone option: ${JSON.stringify(timeZone)}. This environment does not support IANA time zones.`);
  try {
    return {
      kind: "iana",
      formatter: new Intl.DateTimeFormat("en-CA", {
        timeZone,
        hour12: false,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })
    };
  } catch {
    throw new TypeError(`Invalid timeZone option: ${JSON.stringify(timeZone)}. Expected an IANA time zone name (e.g., "Asia/Seoul") or a fixed UTC offset string (e.g., "+09:00").`);
  }
}
function createTimestampFormatter(pattern, timeZone) {
  if (pattern === "none") return () => null;
  if (pattern === "rfc3339" && timeZone.kind === "utc") return (ts) => new Date(ts).toISOString();
  return (ts) => {
    const parts = getDateParts(ts, timeZone);
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const time = `${parts.hour}:${parts.minute}:${parts.second}.${parts.ms}`;
    const tzLong = formatOffset(parts.offsetMinutes, true);
    const tzShort = formatOffset(parts.offsetMinutes, false);
    if (pattern === "date-time-timezone") return `${date} ${time} ${tzLong}`;
    if (pattern === "date-time-tz") return `${date} ${time} ${tzShort}`;
    if (pattern === "date-time") return `${date} ${time}`;
    if (pattern === "time-timezone") return `${time} ${tzLong}`;
    if (pattern === "time-tz") return `${time} ${tzShort}`;
    if (pattern === "time") return time;
    if (pattern === "date") return date;
    return `${date}T${time}${tzLong}`;
  };
}
var levelRenderersCache = {
  ABBR: levelAbbreviations,
  abbr: {
    trace: "trc",
    debug: "dbg",
    info: "inf",
    warning: "wrn",
    error: "err",
    fatal: "ftl"
  },
  FULL: {
    trace: "TRACE",
    debug: "DEBUG",
    info: "INFO",
    warning: "WARNING",
    error: "ERROR",
    fatal: "FATAL"
  },
  full: {
    trace: "trace",
    debug: "debug",
    info: "info",
    warning: "warning",
    error: "error",
    fatal: "fatal"
  },
  L: {
    trace: "T",
    debug: "D",
    info: "I",
    warning: "W",
    error: "E",
    fatal: "F"
  },
  l: {
    trace: "t",
    debug: "d",
    info: "i",
    warning: "w",
    error: "e",
    fatal: "f"
  }
};
function getLineEndingValue(lineEnding) {
  return lineEnding === "crlf" ? "\r\n" : "\n";
}
var jsonControlPattern = /[\u007f-\u009f]/g;
function escapeJsonControlChars(json) {
  return json.replace(jsonControlPattern, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
function stringifyJsonMessageValue(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  return stringifyWithoutCycles(value, bigintReplacer);
}
function jsonReplacer(_key, value) {
  if (typeof value === "bigint") return value.toString();
  if (!(value instanceof Error)) return value;
  const serialized = {
    name: value.name,
    message: value.message
  };
  if (typeof value.stack === "string") serialized.stack = value.stack;
  const cause = value.cause;
  if (cause !== void 0) serialized.cause = cause;
  if (typeof AggregateError !== "undefined" && value instanceof AggregateError) serialized.errors = value.errors;
  for (const key of Object.keys(value)) if (!(key in serialized)) serialized[key] = value[key];
  return serialized;
}
function renderDefaultJsonLinesMessage(message) {
  const messageLength = message.length;
  if (messageLength === 1) return message[0];
  if (messageLength === 3) return message[0] + stringifyJsonMessageValue(message[1]) + message[2];
  let rendered = message[0];
  for (let i = 1; i < messageLength; i++) rendered += i & 1 ? stringifyJsonMessageValue(message[i]) : message[i];
  return rendered;
}
function stringifyJsonLinesField(key, value) {
  if (value != null && (typeof value === "object" || typeof value === "function" || typeof value === "bigint")) {
    const toJSON = value.toJSON;
    if (typeof toJSON === "function") value = toJSON.call(value, key);
  }
  return JSON.stringify(jsonReplacer(key, value), createCircularReplacer(jsonReplacer));
}
function formatDefaultJsonLinesRecord(record, lineEnding) {
  const level = record.level === "warning" ? "WARN" : record.level.toUpperCase();
  const messageJson = stringifyJsonLinesField("message", renderDefaultJsonLinesMessage(record.message));
  const propertiesJson = stringifyJsonLinesField("properties", record.properties);
  let line = `{"@timestamp":${JSON.stringify(new Date(record.timestamp).toISOString())},"level":${JSON.stringify(level)}`;
  if (messageJson !== void 0) line += `,"message":${messageJson}`;
  line += `,"logger":${JSON.stringify(record.category.join("."))}`;
  if (propertiesJson !== void 0) line += `,"properties":${propertiesJson}`;
  return escapeJsonControlChars(`${line}}`) + lineEnding;
}
function getTextFormatter(options = {}) {
  const timestampRenderer = (() => {
    const tsOption = options.timestamp;
    const timeZone = resolveTimeZone(options.timeZone);
    if (tsOption == null) return createTimestampFormatter("date-time-timezone", timeZone);
    else if (tsOption === "disabled") return createTimestampFormatter("none", timeZone);
    else if (typeof tsOption === "string" && (tsOption === "date-time-timezone" || tsOption === "date-time-tz" || tsOption === "date-time" || tsOption === "time-timezone" || tsOption === "time-tz" || tsOption === "time" || tsOption === "date" || tsOption === "rfc3339" || tsOption === "none")) return createTimestampFormatter(tsOption, timeZone);
    else return tsOption;
  })();
  const categorySeparator = options.category ?? "\xB7";
  const sanitize = getSanitizer(options.sanitize);
  const sanitizeCategory = getSanitizer(options.sanitize === false ? false : {
    ...options.sanitize,
    sgr: "escape"
  });
  const valueRenderer = getValueRenderer(options.value, options.sanitize, inspect2);
  const levelRenderer = (() => {
    const levelOption = options.level;
    if (levelOption == null || levelOption === "ABBR") return (level) => levelRenderersCache.ABBR[level];
    else if (levelOption === "abbr") return (level) => levelRenderersCache.abbr[level];
    else if (levelOption === "FULL") return (level) => levelRenderersCache.FULL[level];
    else if (levelOption === "full") return (level) => levelRenderersCache.full[level];
    else if (levelOption === "L") return (level) => levelRenderersCache.L[level];
    else if (levelOption === "l") return (level) => levelRenderersCache.l[level];
    else return levelOption;
  })();
  const lineEnding = getLineEndingValue(options.lineEnding);
  const sourceLocationRenderer = getSourceLocationRenderer(options.sourceLocation, options.sanitize === false ? null : getSanitizer({
    ...options.sanitize,
    sgr: "escape",
    newlines: "escape"
  }));
  const formatter = options.format ?? (({ timestamp, level, category, message, sourceLocation }) => `${timestamp ? `${timestamp} ` : ""}[${level}] ${category}${sourceLocation == null ? "" : ` (${sourceLocation})`}: ${message}`);
  return (record) => {
    const message = renderMessageParts(record.message, valueRenderer, sanitize);
    const timestamp = timestampRenderer(record.timestamp);
    const level = levelRenderer(record.level);
    const categoryParts = sanitizeCategory == null ? record.category : record.category.map(sanitizeCategory);
    const category = typeof categorySeparator === "function" ? categorySeparator(categoryParts) : categoryParts.join(categorySeparator);
    const values = {
      timestamp,
      level,
      category,
      message,
      record
    };
    if (sourceLocationRenderer != null) values.sourceLocation = record.sourceLocation == null ? null : sourceLocationRenderer(record.sourceLocation);
    return `${formatter(values)}${lineEnding}`;
  };
}
function getSourceLocationRenderer(option, sanitize) {
  if (option == null || option === false) return null;
  const render = option === true ? (location) => `${location.file}:${location.line}:${location.column}` : option;
  if (sanitize == null) return render;
  return (location) => sanitize(render(location));
}
var defaultTextFormatter = getTextFormatter();
var RESET = "\x1B[0m";
var ansiColors = {
  black: "\x1B[30m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  blue: "\x1B[34m",
  magenta: "\x1B[35m",
  cyan: "\x1B[36m",
  white: "\x1B[37m"
};
var ansiStyles = {
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  italic: "\x1B[3m",
  underline: "\x1B[4m",
  strikethrough: "\x1B[9m"
};
var defaultLevelColors = {
  trace: null,
  debug: "blue",
  info: "green",
  warning: "yellow",
  error: "red",
  fatal: "magenta"
};
function getAnsiColorFormatter(options = {}) {
  const format = options.format;
  const timestampStyle = typeof options.timestampStyle === "undefined" ? "dim" : options.timestampStyle;
  const timestampColor = options.timestampColor ?? null;
  const timestampPrefix = `${timestampStyle == null ? "" : ansiStyles[timestampStyle]}${timestampColor == null ? "" : ansiColors[timestampColor]}`;
  const timestampSuffix = timestampStyle == null && timestampColor == null ? "" : RESET;
  const levelStyle = typeof options.levelStyle === "undefined" ? "bold" : options.levelStyle;
  const levelColors = options.levelColors ?? defaultLevelColors;
  const categoryStyle = typeof options.categoryStyle === "undefined" ? "dim" : options.categoryStyle;
  const categoryColor = options.categoryColor ?? null;
  const categoryPrefix = `${categoryStyle == null ? "" : ansiStyles[categoryStyle]}${categoryColor == null ? "" : ansiColors[categoryColor]}`;
  const categorySuffix = categoryStyle == null && categoryColor == null ? "" : RESET;
  return getTextFormatter({
    timestamp: "date-time-tz",
    value(value, fallbackInspect) {
      return fallbackInspect(value, { colors: true });
    },
    ...options,
    ...options.value === "bare" ? { value: getValueRenderer("bare", options.sanitize, (v) => inspect2(v, { colors: true })) } : {},
    format({ timestamp, level, category, message, sourceLocation, record }) {
      const levelColor = levelColors[record.level];
      timestamp = timestamp == null ? null : `${timestampPrefix}${timestamp}${timestampSuffix}`;
      level = `${levelStyle == null ? "" : ansiStyles[levelStyle]}${levelColor == null ? "" : ansiColors[levelColor]}${level}${levelStyle == null && levelColor == null ? "" : RESET}`;
      if (format == null) return `${timestamp == null ? "" : `${timestamp} `}${level} ${categoryPrefix}${category}${sourceLocation == null ? "" : ` (${sourceLocation})`}:${categorySuffix} ${message}`;
      const values = {
        timestamp,
        level,
        category: `${categoryPrefix}${category}${categorySuffix}`,
        message,
        record
      };
      if (sourceLocation !== void 0) values.sourceLocation = sourceLocation == null ? null : `${categoryPrefix}${sourceLocation}${categorySuffix}`;
      return format(values);
    }
  });
}
var ansiColorFormatter = getAnsiColorFormatter();
function getJsonLinesFormatter(options = {}) {
  const lineEnding = getLineEndingValue(options.lineEnding);
  if (!options.categorySeparator && !options.message && !options.properties) return (record) => formatDefaultJsonLinesRecord(record, lineEnding);
  const isTemplateMessage = options.message === "template";
  const propertiesOption = options.properties ?? "nest:properties";
  let joinCategory;
  if (typeof options.categorySeparator === "function") joinCategory = options.categorySeparator;
  else {
    const separator = options.categorySeparator ?? ".";
    joinCategory = (category) => category.join(separator);
  }
  let getProperties;
  if (propertiesOption === "flatten") getProperties = (properties) => properties;
  else if (propertiesOption.startsWith("prepend:")) {
    const prefix = propertiesOption.substring(8);
    if (prefix === "") throw new TypeError(`Invalid properties option: ${JSON.stringify(propertiesOption)}. It must be of the form "prepend:<prefix>" where <prefix> is a non-empty string.`);
    getProperties = (properties) => {
      const result = {};
      for (const key in properties) result[`${prefix}${key}`] = properties[key];
      return result;
    };
  } else if (propertiesOption.startsWith("nest:")) {
    const key = propertiesOption.substring(5);
    getProperties = (properties) => ({ [key]: properties });
  } else throw new TypeError(`Invalid properties option: ${JSON.stringify(propertiesOption)}. It must be "flatten", "prepend:<prefix>", or "nest:<key>".`);
  let getMessage;
  if (isTemplateMessage) getMessage = (record) => {
    if (typeof record.rawMessage === "string") return record.rawMessage;
    let msg = "";
    for (let i = 0; i < record.rawMessage.length; i++) {
      if (i > 0) msg += "{}";
      msg += record.rawMessage[i];
    }
    return msg;
  };
  else getMessage = (record) => {
    const msgLen = record.message.length;
    if (msgLen === 1) return record.message[0];
    let msg = "";
    for (let i = 0; i < msgLen; i++) msg += i % 2 < 1 ? record.message[i] : stringifyJsonMessageValue(record.message[i]);
    return msg;
  };
  return (record) => {
    return escapeJsonControlChars(JSON.stringify({
      "@timestamp": new Date(record.timestamp).toISOString(),
      level: record.level === "warning" ? "WARN" : record.level.toUpperCase(),
      message: getMessage(record),
      logger: joinCategory(record.category),
      ...getProperties(record.properties)
    }, createCircularReplacer(jsonReplacer))) + lineEnding;
  };
}
var jsonLinesFormatter = getJsonLinesFormatter();
function renderStructuredMessage(record, template) {
  if (template) {
    if (typeof record.rawMessage === "string") return record.rawMessage;
    return record.rawMessage.join("{}");
  }
  return renderMessageParts(record.message, stringifyLogfmtValue);
}
function filterLogfmtKey(key) {
  if (key === "") return null;
  let needsEscape = false;
  for (const char of key) {
    const code = char.codePointAt(0);
    if (shouldEscapeLogfmtKeyChar(char, code)) {
      needsEscape = true;
      break;
    }
  }
  if (!needsEscape) return key;
  let result = "";
  for (const char of key) {
    const code = char.codePointAt(0);
    if (shouldEscapeLogfmtKeyChar(char, code)) result += encodeLogfmtKeyChar(char);
    else result += char;
  }
  return result;
}
function isTerminalControlCode(code) {
  return code === 127 || code >= 128 && code <= 159;
}
function shouldEscapeLogfmtKeyChar(char, code) {
  return code <= 32 || isTerminalControlCode(code) || code === 65533 || char === "=" || char === '"' || char === "%";
}
function encodeLogfmtKeyChar(char) {
  let result = "";
  for (const byte of utf8Encoder.encode(char)) result += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  return result;
}
function stringifyLogfmtValue(value) {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" || typeof value === "undefined" || typeof value === "symbol" || typeof value === "function") return String(value);
  try {
    const json = JSON.stringify(value, jsonReplacer);
    if (typeof json === "string") return unwrapJsonStringLiteral(json);
  } catch {
  }
  return inspect2(value, { colors: false });
}
function unwrapJsonStringLiteral(json) {
  if (json.startsWith('"') && json.endsWith('"')) return JSON.parse(json);
  return json;
}
function quoteLogfmtValue(value, isString) {
  let needsQuote = value === "" || isString && shouldQuoteStringLiteral(value);
  for (const char of value) {
    const code = char.codePointAt(0);
    if (shouldQuoteLogfmtValueChar(char, code)) {
      needsQuote = true;
      break;
    }
  }
  if (!needsQuote) return value;
  let quoted = "";
  for (const char of value) {
    const code = char.codePointAt(0);
    quoted += escapeLogfmtValueChar(char, code);
  }
  return `"${quoted}"`;
}
function shouldQuoteStringLiteral(value) {
  return value === "null" || value === "undefined" || value === "true" || value === "false";
}
function shouldQuoteLogfmtValueChar(char, code) {
  return code <= 32 || isTerminalControlCode(code) || code === 65533 || char === "=" || char === '"' || char === "\\";
}
function escapeLogfmtValueChar(char, code) {
  switch (char) {
    case "	":
      return "\\t";
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case '"':
      return '\\"';
    case "\\":
      return "\\\\";
    default:
      return code <= 31 || isTerminalControlCode(code) ? `\\u${code.toString(16).padStart(4, "0")}` : char;
  }
}
function formatLogfmtValue(value) {
  const stringified = stringifyLogfmtValue(value);
  return quoteLogfmtValue(stringified, typeof value === "string");
}
function pushLogfmtPair(pairs, key, value) {
  const filteredKey = filterLogfmtKey(key);
  if (filteredKey == null) return;
  pairs.push(`${filteredKey}=${formatLogfmtValue(value)}`);
}
function getLogfmtFormatter(options = {}) {
  const prependPrefix = "prepend:";
  const lineEnding = getLineEndingValue(options.lineEnding);
  const timestampRenderer = createTimestampFormatter("rfc3339", resolveTimeZone(options.timeZone));
  const isTemplateMessage = options.message === "template";
  const propertiesOption = options.properties ?? "flatten";
  let joinCategory;
  if (typeof options.categorySeparator === "function") joinCategory = options.categorySeparator;
  else {
    const separator = options.categorySeparator ?? ".";
    joinCategory = (category) => category.join(separator);
  }
  let propertyPrefix = "";
  if (propertiesOption === "flatten") propertyPrefix = "";
  else if (propertiesOption.startsWith(prependPrefix)) {
    propertyPrefix = propertiesOption.substring(prependPrefix.length);
    if (propertyPrefix === "") throw new TypeError("Invalid properties option: " + JSON.stringify(propertiesOption) + '. It must be of the form "prepend:<prefix>" where <prefix> is a non-empty string.');
  } else throw new TypeError(`Invalid properties option: ${JSON.stringify(propertiesOption)}. It must be "flatten" or "prepend:<prefix>".`);
  return (record) => {
    const pairs = [];
    pushLogfmtPair(pairs, "time", timestampRenderer(record.timestamp));
    pushLogfmtPair(pairs, "level", record.level);
    pushLogfmtPair(pairs, "logger", joinCategory(record.category));
    pushLogfmtPair(pairs, "msg", renderStructuredMessage(record, isTemplateMessage));
    for (const key in record.properties) if (Object.prototype.hasOwnProperty.call(record.properties, key)) pushLogfmtPair(pairs, `${propertyPrefix}${key}`, record.properties[key]);
    return `${pairs.join(" ")}${lineEnding}`;
  };
}
var logfmtFormatter = getLogfmtFormatter();
var logLevelStyles = {
  "trace": "background-color: gray; color: white;",
  "debug": "background-color: gray; color: white;",
  "info": "background-color: white; color: black;",
  "warning": "background-color: orange; color: black;",
  "error": "background-color: red; color: white;",
  "fatal": "background-color: maroon; color: white;"
};
function defaultConsoleFormatter(record) {
  return formatConsoleRecord(record, void 0);
}
function formatConsoleRecord(record, sourceLocation) {
  let msg = "";
  const values = [];
  for (let i = 0; i < record.message.length; i++) if (i % 2 === 0) msg += sanitizeControlSequences(record.message[i]);
  else {
    msg += "%o";
    values.push(record.message[i]);
  }
  const date = new Date(record.timestamp);
  const time = `${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}:${date.getUTCSeconds().toString().padStart(2, "0")}.${date.getUTCMilliseconds().toString().padStart(3, "0")}`;
  const category = record.category.map((c) => sanitizeControlSequences(c, { sgr: "escape" })).join("\xB7");
  if (sourceLocation == null) return [
    `%c${time} %c${levelAbbreviations[record.level]}%c %c${category} %c${msg}`,
    "color: gray;",
    logLevelStyles[record.level],
    "background-color: default;",
    "color: gray;",
    "color: default;",
    ...values
  ];
  return [
    `%c${time} %c${levelAbbreviations[record.level]}%c %c${category} (%s) %c${msg}`,
    "color: gray;",
    logLevelStyles[record.level],
    "background-color: default;",
    "color: gray;",
    sourceLocation,
    "color: default;",
    ...values
  ];
}

// node_modules/@logtape/logtape/dist/sink.js
function createSinkNotifications(sink, interval, onDrop, onError) {
  let notificationDepth = 0;
  let dropped = 0;
  let timer = null;
  function notify(callback, event) {
    notificationDepth++;
    try {
      const result = callback(event);
      if (result != null) Promise.resolve(result).catch(() => {
      });
    } catch {
    } finally {
      notificationDepth--;
    }
  }
  function reportDrops() {
    const count = dropped;
    dropped = 0;
    if (count > 0 && onDrop != null) notify(onDrop, {
      count,
      reason: "overflow"
    });
  }
  return {
    get notifying() {
      return notificationDepth > 0;
    },
    drop() {
      if (onDrop == null) return;
      dropped++;
      if (timer == null) timer = setTimeout(() => {
        timer = null;
        reportDrops();
      }, interval);
    },
    error(error, operation, defer = false) {
      if (onError == null) return;
      const event = {
        error,
        sink,
        operation
      };
      if (defer) queueMicrotask(() => notify(onError, event));
      else notify(onError, event);
    },
    dispose() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      reportDrops();
    }
  };
}
function getConsoleSink(options = {}) {
  const formatter = options.formatter ?? defaultConsoleFormatter;
  const levelMap = {
    trace: "debug",
    debug: "debug",
    info: "info",
    warning: "warn",
    error: "error",
    fatal: "error",
    ...options.levelMap ?? {}
  };
  const console2 = options.console ?? globalThis.console;
  const writeToConsole = (record, args) => {
    const method = levelMap[record.level];
    if (method === void 0) throw new TypeError(`Invalid log level: ${record.level}.`);
    if (typeof args === "string") {
      const msg = args.replace(/\r?\n$/, "");
      console2[method](msg);
    } else console2[method](...args);
  };
  const baseSink = (record) => {
    writeToConsole(record, formatter(record));
  };
  if (!options.nonBlocking) return baseSink;
  const nonBlockingConfig = options.nonBlocking === true ? {} : options.nonBlocking;
  const bufferSize = nonBlockingConfig.bufferSize ?? 100;
  const flushInterval = nonBlockingConfig.flushInterval ?? 100;
  const notifications = createSinkNotifications("console", flushInterval, nonBlockingConfig.onDrop, nonBlockingConfig.onError);
  const buffer = [];
  let flushTimer = null;
  let scheduledFlushTimer = null;
  let disposed = false;
  let flushScheduled = false;
  const maxBufferSize = bufferSize * 2;
  function flush() {
    if (buffer.length === 0) return;
    const records = buffer.splice(0);
    for (const record of records) {
      let operation = "format";
      try {
        const args = formatter(record);
        operation = "write";
        writeToConsole(record, args);
      } catch (error) {
        notifications.error(error, operation);
      }
    }
  }
  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    scheduledFlushTimer = setTimeout(() => {
      scheduledFlushTimer = null;
      flushScheduled = false;
      flush();
    }, 0);
  }
  function startFlushTimer() {
    if (flushTimer !== null || disposed) return;
    flushTimer = setInterval(() => {
      flush();
    }, flushInterval);
  }
  const nonBlockingSink = (record) => {
    if (disposed || notifications.notifying) return;
    if (buffer.length >= maxBufferSize && buffer.length > 0) {
      buffer.shift();
      notifications.drop();
    }
    buffer.push(record);
    if (buffer.length >= bufferSize) scheduleFlush();
    else if (flushTimer === null) startFlushTimer();
  };
  nonBlockingSink[disposeSymbol] = () => {
    if (disposed) return;
    disposed = true;
    if (flushTimer !== null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    if (scheduledFlushTimer !== null) {
      clearTimeout(scheduledFlushTimer);
      scheduledFlushTimer = null;
      flushScheduled = false;
    }
    notifications.dispose();
    flush();
  };
  return nonBlockingSink;
}

// node_modules/@logtape/logtape/dist/config.js
var currentConfig = null;
var activeScopedConfigCount = 0;
var globalConfigMutationInProgress = false;
var strongRefs = /* @__PURE__ */ new Set();
var installedSinks = /* @__PURE__ */ new Set();
var inspectionStateSymbol = /* @__PURE__ */ Symbol.for("logtape.inspectionState");
function getInspectionState() {
  const registry = globalThis;
  const state = registry[inspectionStateSymbol];
  if (state != null && state.loggers instanceof WeakMap) return state;
  const newState = {
    configured: false,
    loggers: /* @__PURE__ */ new WeakMap()
  };
  registry[inspectionStateSymbol] = newState;
  return newState;
}
var filterDisposables = /* @__PURE__ */ new Set();
var sinkDisposables = /* @__PURE__ */ new Set();
var asyncFilterDisposables = /* @__PURE__ */ new Set();
var asyncSinkDisposables = /* @__PURE__ */ new Set();
var unregisterDisposeHook;
function getSourceLocationRoot() {
  return LoggerImpl.getLogger();
}
function isLoggerConfigMeta(cfg) {
  const category = Array.isArray(cfg.category) ? cfg.category : [cfg.category];
  return category.length === 0 || category.length === 1 && category[0] === "logtape" || category.length === 2 && category[0] === "logtape" && category[1] === "meta";
}
function registerDisposeHook(allowAsync) {
  unregisterDisposeHook?.();
  unregisterDisposeHook = void 0;
  const handler = allowAsync ? disposeInternal : disposeSyncInternal;
  if (typeof globalThis.EdgeRuntime !== "string" && "process" in globalThis && !("Deno" in globalThis)) {
    const proc = globalThis.process;
    const onMethod = proc?.["on"];
    if (typeof onMethod === "function") {
      onMethod.call(proc, "exit", handler);
      unregisterDisposeHook = () => {
        const offMethod = proc?.["off"] ?? proc?.["removeListener"];
        if (typeof offMethod === "function") offMethod.call(proc, "exit", handler);
      };
      return;
    }
  }
  const addEventListenerMethod = globalThis.addEventListener;
  if (typeof addEventListenerMethod !== "function") return;
  const removeEventListenerMethod = globalThis.removeEventListener;
  if ("Deno" in globalThis) {
    addEventListenerMethod.call(globalThis, "unload", handler);
    if (typeof removeEventListenerMethod === "function") unregisterDisposeHook = () => {
      removeEventListenerMethod.call(globalThis, "unload", handler);
    };
  } else {
    addEventListenerMethod.call(globalThis, "pagehide", handler);
    if (typeof removeEventListenerMethod === "function") unregisterDisposeHook = () => {
      removeEventListenerMethod.call(globalThis, "pagehide", handler);
    };
  }
}
function configureSync(config2) {
  runGlobalConfigMutationSync("configureSync()", () => {
    if (currentConfig != null && !config2.reset) throw new ConfigError("Already configured; if you want to reset, turn on the reset flag.");
    if (asyncFilterDisposables.size > 0 || asyncSinkDisposables.size > 0) throw new ConfigError("Previously configured async disposables are still active. Use configure() instead or explicitly dispose them using dispose().");
    disposeSyncInternal();
    resetInternal();
    try {
      configureInternal(config2, false);
    } catch (e) {
      if (e instanceof ConfigError) {
        disposeSyncInternal();
        resetInternal();
      }
      throw e;
    }
  });
}
function configureInternal(config2, allowAsync) {
  currentConfig = config2;
  getInspectionState().configured = true;
  let metaConfigured = false;
  let capturesSourceLocation = false;
  const configuredCategories = /* @__PURE__ */ new Set();
  for (const cfg of config2.loggers) {
    if (isLoggerConfigMeta(cfg)) metaConfigured = true;
    const categoryKey2 = Array.isArray(cfg.category) ? JSON.stringify(cfg.category) : JSON.stringify([cfg.category]);
    if (configuredCategories.has(categoryKey2)) throw new ConfigError(`Duplicate logger configuration for category: ${categoryKey2}. Each category can only be configured once.`);
    configuredCategories.add(categoryKey2);
    const logger = LoggerImpl.getLogger(cfg.category);
    for (const sinkId of cfg.sinks ?? []) {
      const sink = config2.sinks[sinkId];
      if (!sink) throw new ConfigError(`Sink not found: ${sinkId}.`);
      logger.sinks.push(sink);
    }
    logger.parentSinks = cfg.parentSinks ?? "inherit";
    if (cfg.lowestLevel !== void 0) logger.lowestLevel = cfg.lowestLevel;
    if (cfg.captureSourceLocation !== void 0) {
      if (typeof cfg.captureSourceLocation !== "boolean") throw new ConfigError("Logger captureSourceLocation must be a boolean.");
      logger.sourceLocationCapture = cfg.captureSourceLocation;
      if (cfg.captureSourceLocation) capturesSourceLocation = true;
    }
    for (const filterId of cfg.filters ?? []) {
      const filter = config2.filters?.[filterId];
      if (filter === void 0) throw new ConfigError(`Filter not found: ${filterId}.`);
      logger.filters.push(toFilter(filter));
    }
    getInspectionState().loggers.set(logger, {
      sinks: [...logger.sinks],
      sinkIds: [...cfg.sinks ?? []],
      filters: [...logger.filters],
      filterIds: [...cfg.filters ?? []]
    });
    strongRefs.add(logger);
  }
  LoggerImpl.getLogger().contextLocalStorage = config2.contextLocalStorage;
  getSourceLocationRoot().setGlobalSourceLocationCapture?.(capturesSourceLocation);
  for (const sink of Object.values(config2.sinks)) {
    installedSinks.add(sink);
    if (asyncDisposeSymbol in sink) if (allowAsync) asyncSinkDisposables.add(sink);
    else throw new ConfigError("Async disposables cannot be used with configureSync().");
    if (disposeSymbol in sink) sinkDisposables.add(sink);
  }
  for (const filter of Object.values(config2.filters ?? {})) {
    if (filter == null || typeof filter === "string") continue;
    if (asyncDisposeSymbol in filter) {
      if (allowAsync) asyncFilterDisposables.add(filter);
      else throw new ConfigError("Async disposables cannot be used with configureSync().");
      asyncSinkDisposables.delete(filter);
    }
    if (disposeSymbol in filter) {
      filterDisposables.add(filter);
      sinkDisposables.delete(filter);
    }
  }
  registerDisposeHook(allowAsync);
  const meta = LoggerImpl.getLogger(["logtape", "meta"]);
  if (!metaConfigured) meta.sinks.push(getConsoleSink());
  meta.info("LogTape loggers are configured.  Note that LogTape itself uses the meta logger, which has category {metaLoggerCategory}.  The meta logger is used to log internal diagnostics such as sink exceptions.  It's recommended to configure the meta logger with a separate sink so that you can easily notice if logging itself fails or is misconfigured.  To turn off this message, configure the meta logger with higher log levels than {dismissLevel}.  See also <https://logtape.org/manual/categories#meta-logger>.", {
    metaLoggerCategory: ["logtape", "meta"],
    dismissLevel: "info"
  });
}
function resetInternal() {
  unregisterDisposeHook?.();
  unregisterDisposeHook = void 0;
  const rootLogger = LoggerImpl.getLogger([]);
  rootLogger.resetDescendants();
  getSourceLocationRoot().setGlobalSourceLocationCapture?.(false);
  delete rootLogger.contextLocalStorage;
  strongRefs.clear();
  installedSinks.clear();
  const inspectionState = getInspectionState();
  inspectionState.configured = false;
  inspectionState.loggers = /* @__PURE__ */ new WeakMap();
  currentConfig = null;
}
async function disposeInternal() {
  const errors = [];
  try {
    disposeSyncFilters();
  } catch (error) {
    errors.push(error);
  }
  try {
    await disposeAsyncFilters();
  } catch (error) {
    errors.push(error);
  }
  try {
    disposeSyncSinks();
  } catch (error) {
    errors.push(error);
  }
  try {
    await disposeAsyncSinks();
  } catch (error) {
    errors.push(error);
  }
  throwDisposeErrors(errors);
}
function disposeSyncInternal() {
  const errors = [];
  try {
    disposeSyncFilters();
  } catch (error) {
    errors.push(error);
  }
  try {
    disposeSyncSinks();
  } catch (error) {
    errors.push(error);
  }
  throwDisposeErrors(errors);
}
function runGlobalConfigMutationSync(functionName, callback) {
  assertCanMutateGlobalConfig(functionName);
  globalConfigMutationInProgress = true;
  try {
    return callback();
  } finally {
    globalConfigMutationInProgress = false;
  }
}
function assertCanMutateGlobalConfig(functionName) {
  if (globalConfigMutationInProgress) throw new ConfigError(`${functionName} cannot be called while LogTape is being reconfigured.`);
  assertNoScopedConfig(functionName);
}
function assertNoScopedConfig(functionName) {
  if (activeScopedConfigCount > 0) throw new ConfigError(`${functionName} cannot be called while a scoped configuration is active. Use nested withConfig() instead.`);
}
function disposeSyncFilters() {
  disposeSyncDisposables(filterDisposables);
}
function disposeSyncSinks() {
  disposeSyncDisposables(sinkDisposables);
}
function disposeSyncDisposables(disposables) {
  const errors = [];
  try {
    for (const disposable of disposables) try {
      disposable[disposeSymbol]();
    } catch (error) {
      errors.push(error);
    } finally {
      disposables.delete(disposable);
    }
  } finally {
    disposables.clear();
  }
  throwDisposeErrors(errors);
}
async function disposeAsyncFilters() {
  await disposeAsyncDisposables(asyncFilterDisposables);
}
async function disposeAsyncSinks() {
  await disposeAsyncDisposables(asyncSinkDisposables);
}
async function disposeAsyncDisposables(disposables) {
  const promises = [];
  try {
    for (const disposable of disposables) try {
      promises.push(Promise.resolve(disposable[asyncDisposeSymbol]()));
    } catch (error) {
      promises.push(Promise.reject(error));
    } finally {
      disposables.delete(disposable);
    }
  } finally {
    disposables.clear();
  }
  await settleDisposePromises(promises);
}
async function settleDisposePromises(promises) {
  const results = await Promise.allSettled(promises);
  throwDisposeErrors(results.filter((result) => result.status === "rejected").map((result) => result.reason));
}
function throwDisposeErrors(errors) {
  if (errors.length < 1) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, "Multiple errors occurred while disposing LogTape resources.");
}
var ConfigError = class extends Error {
  /**
  * Constructs a new configuration error.
  * @param message The error message.
  */
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
};

// node_modules/@d3-inc/d3-dna-protocol/dist/index.js
var PURPOSE_HEADERS = ["sec-purpose", "x-purpose", "purpose"];
var ANS_ARTIFACT_MAX_BASE64_LENGTH = 1398104;
var ANS_DPOP_MAX_PROOF_BYTES = 8192;
function pathOf(url) {
  const q = url.indexOf("?");
  const path = q < 0 ? url : url.slice(0, q);
  return path === "" ? "/" : path;
}
var NAMESPACE_COOKIE = /^__(?:Host|Secure)-d3[a-z]/;
var NAMESPACE_PARAM_PREFIX = "d3pay_";
var NAMESPACE_MAX_COOKIES = 8;
var NAMESPACE_MAX_TOTAL_LENGTH = 4096;
var NAMESPACE_NAME_MAX_LENGTH = 256;
function isNamespaceCookie(name) {
  return NAMESPACE_COOKIE.test(name);
}
function isNamespaceParam(name) {
  return name.startsWith(NAMESPACE_PARAM_PREFIX);
}
var PAYMENT_AUTHORIZATION_HEADER = "payment-authorization";
var PAYMENT_AUTHORIZATION_MAX_LENGTH = 4096;
var PAY_SESSION_COOKIE = "__Host-d3pay";
var PAY_SESSION_HEADER = "d3pay-session";
var PAY_SESSION_MAX_LENGTH = 64;
var PERSON_PASS_COOKIE = "__Host-d3person";
var PERSON_PASS_HEADER = "d3pay-person";
var PERSON_PASS_MAX_LENGTH = 64;
var VISITOR_ID_ZONE_COOKIE = "__Secure-d3visitor";
var VISITOR_ID_HOST_COOKIE = "__Host-d3visitor";
var PAY_HANDOFF_PARAM = "d3pay_handoff";
var HANDOFF_ID_LENGTH = 22;
var HANDOFF_SIG_LENGTH = 43;
var BASE64URL = /^[A-Za-z0-9_-]+$/;
function splitHandoffToken(token) {
  const dot = token.indexOf(".");
  if (dot !== HANDOFF_ID_LENGTH) return null;
  const id = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (signature.length !== HANDOFF_SIG_LENGTH || !BASE64URL.test(id) || !BASE64URL.test(signature)) {
    return null;
  }
  return { id, signature };
}
function paramName(pair) {
  return pair.split("=", 1)[0].replaceAll("+", " ").replace(/%[0-9A-Fa-f]{2}/g, (escape) => {
    try {
      return decodeURIComponent(escape);
    } catch {
      return escape;
    }
  });
}
function handoffFromUrl(url) {
  const query = url.indexOf("?");
  if (query === -1) return null;
  const value = new URLSearchParams(url.slice(query + 1)).get(PAY_HANDOFF_PARAM);
  return value !== null && splitHandoffToken(value) ? value : null;
}
function stripPayParams(url) {
  const query = url.indexOf("?");
  if (query === -1) return url;
  const kept = url.slice(query + 1).split("&").filter((pair) => !isNamespaceParam(paramName(pair)));
  return kept.length > 0 ? `${url.slice(0, query)}?${kept.join("&")}` : url.slice(0, query);
}
function cookieName(pair) {
  const eq = pair.indexOf("=");
  return (eq === -1 ? pair : pair.slice(0, eq)).trim();
}
function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq !== -1 && cookieName(pair) === name) return pair.slice(eq + 1).trim();
  }
  return null;
}
function readSessionCookie(cookieHeader) {
  return readCookie(cookieHeader, PAY_SESSION_COOKIE);
}
function cookiesOf(cookieHeader) {
  if (!cookieHeader) return [];
  const out = [];
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = cookieName(pair);
    if (name !== "") out.push([name, pair.slice(eq + 1).trim()]);
  }
  return out;
}
var OWN_COOKIES = [PAY_SESSION_COOKIE, PERSON_PASS_COOKIE];
var RESERVED_COOKIES = [
  ...OWN_COOKIES,
  VISITOR_ID_ZONE_COOKIE,
  VISITOR_ID_HOST_COOKIE
];
function stripCookies(cookieHeader, ours) {
  const kept = cookieHeader.split(";").map((pair) => pair.trim()).filter((pair) => pair.length > 0 && !ours(cookieName(pair)));
  return kept.length > 0 ? kept.join("; ") : null;
}
function stripOwnCookies(cookieHeader) {
  return stripCookies(cookieHeader, isNamespaceCookie);
}
function holdsOwnCookie(cookieHeader) {
  return cookieHeader.split(";").some((pair) => isNamespaceCookie(cookieName(pair.trim())));
}
var LOG_ROOT = "d3-edge";
function edgeLogger(...subcategory) {
  return getLogger([LOG_ROOT, ...subcategory]);
}
var MAX_ERROR_MESSAGE_CHARS = 512;
function clipErrorMessage(text) {
  return text.length > MAX_ERROR_MESSAGE_CHARS ? `${text.slice(0, MAX_ERROR_MESSAGE_CHARS)}\u2026` : text;
}
function errorSummary(err) {
  const summary = { name: err.name, message: clipErrorMessage(err.message) };
  return err.cause instanceof Error ? { ...summary, cause: `${err.cause.name}: ${clipErrorMessage(err.cause.message)}` } : summary;
}
function errorReplacer(_key, value) {
  return value instanceof Error ? errorSummary(value) : value;
}
function safeJson(value) {
  try {
    return JSON.stringify(value, errorReplacer) ?? String(value);
  } catch {
    return String(value);
  }
}
function formatValue(value) {
  if (value instanceof Error) {
    const { name, message, cause } = errorSummary(value);
    return cause ? `${name}: ${message} (cause: ${cause})` : `${name}: ${message}`;
  }
  return typeof value === "string" ? value : safeJson(value);
}
function edgeConsoleFormatter(record) {
  const message = record.message.map((part, i) => i % 2 === 0 ? String(part) : formatValue(part)).join("");
  const props = Object.keys(record.properties).length > 0 ? ` ${safeJson(record.properties)}` : "";
  return [`${record.category.join("\xB7")} ${message}${props}`];
}
var configured = false;
function configureEdgeLogging(lowestLevel = "info") {
  if (configured) return;
  configured = true;
  configureSync({
    reset: true,
    sinks: { console: getConsoleSink({ formatter: edgeConsoleFormatter }) },
    loggers: [
      { category: [LOG_ROOT], lowestLevel, sinks: ["console"] },
      // LogTape's own diagnostics: keep them quiet unless something breaks.
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] }
    ]
  });
}
var FORWARDS_ALL_SINCE = 2;
var CARRIES_MCP_SINCE = 3;
var FORWARDED_MAX_COOKIES = 256;
var FORWARDED_MAX_NAMES = 128;
var MCP_METHOD_HEADER = "mcp-method";
var MCP_NAME_HEADER = "mcp-name";
var MCP_DNA_KEY_HEADER = "mcp-param-dna-key";
var NEVER_FORWARDED_HEADERS = /* @__PURE__ */ new Set([
  "connection",
  "transfer-encoding",
  "content-length",
  "host",
  "authorization",
  "proxy-authorization",
  "cookie",
  MCP_DNA_KEY_HEADER,
  "x-vercel-oidc-token",
  "cf-access-jwt-assertion",
  "cf-access-client-id",
  "cf-access-client-secret"
]);
var X402_PAYMENT_HEADER_V2 = "payment-signature";
var X402_PAYMENT_HEADER_V1 = "x-payment";
var X402_PAYMENT_HEADERS = [X402_PAYMENT_HEADER_V2, X402_PAYMENT_HEADER_V1];
var DNA_CREDENTIAL_HEADERS = [
  PAYMENT_AUTHORIZATION_HEADER,
  PAY_SESSION_HEADER,
  PERSON_PASS_HEADER,
  ...X402_PAYMENT_HEADERS
];
function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
var X402_MAX_PAYMENT_HEADER_LENGTH = 4096;
var PAYMENT_HEADER_CAPS = new Map([
  ...X402_PAYMENT_HEADERS.map((name) => [name, X402_MAX_PAYMENT_HEADER_LENGTH]),
  [PAYMENT_AUTHORIZATION_HEADER, PAYMENT_AUTHORIZATION_MAX_LENGTH],
  [PAY_SESSION_HEADER, PAY_SESSION_MAX_LENGTH]
]);
var PAYMENT_HEADERS = [...PAYMENT_HEADER_CAPS.keys()];
var ORIGIN_STRIPPED_HEADERS = [
  ...PAYMENT_HEADERS,
  PERSON_PASS_HEADER,
  MCP_DNA_KEY_HEADER
];
function requestPresentsPayment(request) {
  return hasPaymentHeader(request.headers) || handoffFromUrl(request.url) !== null;
}
function hasPaymentHeader(headers) {
  const get = (name) => headers instanceof Headers ? headers.get(name) : headers[name] ?? null;
  for (const [name, cap] of PAYMENT_HEADER_CAPS) {
    const value = get(name);
    if (value !== null && value.length > 0 && value.length <= cap) return true;
  }
  const cookie = headers instanceof Headers ? readSessionCookie(headers.get("cookie")) : null;
  return cookie !== null && cookie.length > 0 && cookie.length <= PAY_SESSION_MAX_LENGTH;
}
function stripPaymentHeaders(request) {
  const cookie = request.headers.get("cookie");
  const hasCookie = cookie !== null && holdsOwnCookie(cookie);
  const url = stripPayParams(request.url);
  const hasHeader = ORIGIN_STRIPPED_HEADERS.some((name) => request.headers.has(name));
  if (!hasCookie && !hasHeader && url === request.url) return request;
  const headers = new Headers(request.headers);
  for (const name of ORIGIN_STRIPPED_HEADERS) headers.delete(name);
  if (hasCookie) {
    const kept = stripOwnCookies(cookie);
    if (kept === null) headers.delete("cookie");
    else headers.set("cookie", kept);
  }
  if (url === request.url) return new Request(request, { headers });
  const body = request.method === "GET" || request.method === "HEAD" ? void 0 : request.body;
  return new Request(url, {
    method: request.method,
    headers,
    body,
    redirect: request.redirect,
    signal: request.signal,
    // A streamed body needs it on undici, and workerd ignores it.
    ...body ? { duplex: "half" } : {}
  });
}
var DNA_ADAPTER_HEADER = "dna-adapter";
var ADAPTER_NAME_MAX_LENGTH = 64;
var SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
function isAdapterVersion(version) {
  return SEMVER.test(version);
}
function adapterNameOf(type, version) {
  if (version === void 0 || !isAdapterVersion(version)) return void 0;
  const name = `${type}:${version}`;
  return name.length <= ADAPTER_NAME_MAX_LENGTH ? name : void 0;
}
var FORWARDED_VALUE_MAX_LENGTH = 2048;
var FORWARDED_MAX_TOTAL_LENGTH = 16384;
var NO_EXCLUSIONS = { headers: [], cookies: [] };
function parseExclusionList(raw, { lowercase }) {
  const names = (raw ?? "").split(",").map((name) => name.trim()).filter((name) => name.length > 0).map((name) => lowercase ? name.toLowerCase() : name);
  return [...new Set(names)];
}
function echoedExclusions(exclude) {
  return {
    excluded: {
      headers: exclude.headers.slice(0, FORWARDED_MAX_NAMES),
      cookies: exclude.cookies.slice(0, FORWARDED_MAX_NAMES)
    },
    overflow: {
      headers: exclude.headers.length > FORWARDED_MAX_NAMES,
      cookies: exclude.cookies.length > FORWARDED_MAX_NAMES
    }
  };
}
function exclusionOverflowWarning(exclude) {
  const lines = ["headers", "cookies"].filter((kind) => exclude[kind].length > FORWARDED_MAX_NAMES).map(
    (kind) => `DNA_EXCLUDE_${kind.toUpperCase()} lists ${exclude[kind].length} names, past the ${FORWARDED_MAX_NAMES} DNA is sent: it reads any ${kind === "headers" ? "header" : "cookie"} a request lacks as kept back, and skips the rules that check one`
  );
  return lines.length > 0 ? lines.join("; ") : void 0;
}
function withheldOf(exclude, droppedUnlisted) {
  const echo = echoedExclusions(exclude);
  const unlisted = {
    headers: droppedUnlisted.headers || echo.overflow.headers,
    cookies: droppedUnlisted.cookies || echo.overflow.cookies
  };
  const hasExclusions = exclude.headers.length > 0 || exclude.cookies.length > 0;
  return {
    ...unlisted.headers || unlisted.cookies ? { droppedUnlisted: unlisted } : {},
    ...hasExclusions ? { excluded: echo.excluded } : {}
  };
}
function forwardAll(headers, exclude, namedCaps) {
  const excludedHeaders = new Set(exclude.headers);
  const excludedCookies = new Set(exclude.cookies);
  const out = {
    headers: /* @__PURE__ */ Object.create(null),
    cookies: /* @__PURE__ */ Object.create(null),
    droppedHeaders: [],
    droppedCookies: [],
    droppedUnlisted: { headers: false, cookies: false }
  };
  const pooled = [];
  headers.forEach((value, rawName) => {
    const name = rawName.toLowerCase();
    if (NEVER_FORWARDED_HEADERS.has(name) || excludedHeaders.has(name)) return;
    const cap = namedCaps.get(name);
    if (cap !== void 0) {
      if (value.length > cap) out.droppedHeaders.push(name);
      else out.headers[name] = value;
      return;
    }
    pooled.push({ kind: "header", name, value });
  });
  const seen = /* @__PURE__ */ new Set();
  const budget = { count: 0, length: 0 };
  let theirs = 0;
  for (const [name, value] of cookiesOf(headers.get("cookie"))) {
    if (OWN_COOKIES.includes(name) || excludedCookies.has(name) || seen.has(name)) continue;
    seen.add(name);
    if (isNamespaceCookie(name)) {
      keepOurs(out, name, value, budget);
      continue;
    }
    theirs += 1;
    if (theirs > FORWARDED_MAX_COOKIES) out.droppedCookies.push(name);
    else pooled.push({ kind: "cookie", name, value });
  }
  for (const candidate of withinTotal(pooled, out)) {
    if (candidate.kind === "header") out.headers[candidate.name] = candidate.value;
    else out.cookies[candidate.name] = candidate.value;
  }
  return withListedDrops(out);
}
function keepOurs(out, name, value, budget) {
  if (RESERVED_COOKIES.includes(name)) {
    if (value.length > FORWARDED_VALUE_MAX_LENGTH) out.droppedCookies.push(name);
    else out.cookies[name] = value;
    return;
  }
  if (name.length > NAMESPACE_NAME_MAX_LENGTH || budget.count >= NAMESPACE_MAX_COOKIES) return;
  const size = name.length + value.length;
  if (budget.length + size > NAMESPACE_MAX_TOTAL_LENGTH) return;
  budget.count += 1;
  budget.length += size;
  out.cookies[name] = value;
}
function withListedDrops(out) {
  return {
    ...out,
    droppedHeaders: out.droppedHeaders.slice(0, FORWARDED_MAX_NAMES),
    droppedCookies: out.droppedCookies.slice(0, FORWARDED_MAX_NAMES),
    droppedUnlisted: {
      headers: out.droppedHeaders.length > FORWARDED_MAX_NAMES,
      cookies: out.droppedCookies.length > FORWARDED_MAX_NAMES
    }
  };
}
function withinTotal(pooled, out) {
  const drop = (c) => c.kind === "header" ? out.droppedHeaders.push(c.name) : out.droppedCookies.push(c.name);
  const fitting = [];
  for (const candidate of pooled) {
    if (candidate.value.length > FORWARDED_VALUE_MAX_LENGTH) drop(candidate);
    else fitting.push(candidate);
  }
  const size = (c) => c.name.length + c.value.length;
  let total = fitting.reduce((sum, c) => sum + size(c), 0);
  if (total <= FORWARDED_MAX_TOTAL_LENGTH) return fitting;
  const longestFirst = [...fitting].sort((a, b) => size(b) - size(a));
  const dropped = /* @__PURE__ */ new Set();
  for (const candidate of longestFirst) {
    if (total <= FORWARDED_MAX_TOTAL_LENGTH) break;
    dropped.add(candidate);
    total -= size(candidate);
    drop(candidate);
  }
  return fitting.filter((c) => !dropped.has(c));
}
var log = edgeLogger("policy-client");
var REPORT_TIMEOUT_MS = 3e3;
var DEFAULT_POLICY_TIMEOUT_MS = 2e3;
var DEFAULT_PAYMENT_TIMEOUT_MS = 1e4;
function jsonHeaders(bearer) {
  const headers = { "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return headers;
}
function createHttpPolicyClient(opts, fetchImpl = fetch) {
  return {
    async getDecision(payload) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      try {
        const res = await fetchImpl(opts.url, {
          method: "POST",
          headers: {
            ...jsonHeaders(opts.bearer),
            ...opts.adapterName === void 0 ? {} : { [DNA_ADAPTER_HEADER]: opts.adapterName }
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        if (!res.ok) {
          const reason = await errorReasonOf(res);
          const detail = `policy worker HTTP ${res.status}${reason ? ` (${reason})` : ""}`;
          if (res.status === 401 || res.status === 403) {
            const hint = opts.bearer ? " \u2014 check DNA_API_KEY / key status" : "";
            log.error(`policy call rejected: ${detail}${hint}`);
          }
          throw new Error(detail);
        }
        const body = await res.json();
        if (body.action !== "pass" && body.action !== "block") {
          throw new Error("policy worker returned an invalid decision");
        }
        return body;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
async function errorReasonOf(res) {
  try {
    const body = await res.json();
    return typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}
function builtAnswerOf(response) {
  const headers = Object.fromEntries(response.headers);
  if (response.body === null) return Promise.resolve({ headers });
  return response.clone().text().then((body) => ({ headers, body }));
}
async function sendReport(report, opts, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(new URL("/v1/report", opts.url).toString(), {
      method: "POST",
      headers: jsonHeaders(opts.bearer),
      body: JSON.stringify(report),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`report endpoint HTTP ${res.status}`);
  } catch (err) {
    log.error("response report failed", { err });
  } finally {
    clearTimeout(timer);
  }
}
var DEFAULT_DNA_ENDPOINT = "https://edge-api.d3.com/v1/decision";
var log2 = edgeLogger("adapter-settings");
var warned = /* @__PURE__ */ new Set();
var ADAPTER_SETTING_NAMES = {
  apiKey: ["DNA_API_KEY", "POLICY_ADAPTER_KEY", "POLICY_SHARED_SECRET"],
  endpoint: ["DNA_ENDPOINT", "POLICY_WORKER_URL"],
  enabled: ["DNA_ENABLED"],
  failMode: ["DNA_FAIL_MODE", "FAIL_MODE"],
  timeoutMs: ["DNA_TIMEOUT_MS", "POLICY_TIMEOUT_MS"],
  paymentTimeoutMs: ["DNA_PAYMENT_TIMEOUT_MS", "POLICY_PAYMENT_TIMEOUT_MS"],
  debugLogRawPayload: ["DNA_DEBUG_LOG_RAW_PAYLOAD", "DEBUG_LOG_RAW_PAYLOAD"],
  excludeHeaders: ["DNA_EXCLUDE_HEADERS"],
  excludeCookies: ["DNA_EXCLUDE_COOKIES"]
};
function readAdapterSettings(...sources) {
  const names = ADAPTER_SETTING_NAMES;
  const read = (candidates) => firstNonEmpty(sources, candidates)?.value;
  const endpoint = firstPresent(sources, names.endpoint);
  const hasPolicyWorkerUrl = firstPresent(sources, ["POLICY_WORKER_URL"]) !== void 0;
  const apiKey = firstNonEmpty(sources, names.apiKey);
  const debugNames = hasPolicyWorkerUrl ? names.debugLogRawPayload : ["DNA_DEBUG_LOG_RAW_PAYLOAD"];
  const exclude = {
    headers: parseExclusionList(read(names.excludeHeaders), { lowercase: true }),
    cookies: parseExclusionList(read(names.excludeCookies), { lowercase: false })
  };
  const overflow = exclusionOverflowWarning(exclude);
  if (overflow !== void 0 && !warned.has(overflow)) {
    warned.add(overflow);
    log2.warn(overflow);
  }
  return {
    endpoint: dnaEndpoint({
      endpoint: endpoint?.value,
      hasDnaApiKey: apiKey?.name === "DNA_API_KEY",
      enabled: read(names.enabled)
    }),
    apiKey: apiKey?.value,
    failMode: read(names.failMode) === "closed" ? "closed" : "open",
    timeoutMs: positiveNumber(read(names.timeoutMs), DEFAULT_POLICY_TIMEOUT_MS),
    paymentTimeoutMs: positiveNumber(read(names.paymentTimeoutMs), DEFAULT_PAYMENT_TIMEOUT_MS),
    debugLogRawPayload: read(debugNames) === "true",
    exclude
  };
}
function dnaEndpoint(input) {
  if (input.enabled?.trim().toLowerCase() === "false") return void 0;
  if (input.endpoint !== void 0) return input.endpoint || void 0;
  return input.hasDnaApiKey ? DEFAULT_DNA_ENDPOINT : void 0;
}
function firstPresent(sources, names) {
  return firstMatching(sources, names, () => true);
}
function firstNonEmpty(sources, names) {
  return firstMatching(sources, names, (value) => value !== "");
}
function firstMatching(sources, names, counts) {
  for (const source of sources) {
    for (const name of names) {
      const value = source(name);
      if (value !== void 0 && counts(value)) return { name, value };
    }
  }
  return void 0;
}
function positiveNumber(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
var MCP_KEY_ARGUMENT = "dna_account_key";
var MCP_X402_PAYMENT_META = "x402/payment";
var MCP_DNA_KEY_META = "dna.d3.com/key";
var MCP_BODY_MAX_BYTES = 1048576;
var MCP_METHOD_MAX_LENGTH = 128;
var MCP_NAME_MAX_LENGTH = 256;
var PRINTABLE = /^[\x20-\x7e]+$/;
function readJsonRpcRequest(method, contentType, body) {
  if (method !== "POST" || !isJsonType(contentType)) return null;
  if (body.byteLength === 0 || body.byteLength > MCP_BODY_MAX_BYTES) return null;
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") return null;
  const id = parsed.id;
  if (id !== void 0 && id !== null && typeof id !== "string" && typeof id !== "number") return null;
  return {
    ...id === void 0 ? {} : { id },
    method: parsed.method,
    ...isRecord(parsed.params) ? { params: parsed.params } : {}
  };
}
var CREDENTIAL_KEYS = [MCP_X402_PAYMENT_META, MCP_DNA_KEY_META, MCP_KEY_ARGUMENT].flatMap((key) => {
  const quoted = JSON.stringify(key);
  return quoted.includes("/") ? [quoted, quoted.replaceAll("/", "\\/")] : [quoted];
}).map((key) => new TextEncoder().encode(key));
var JSONRPC_KEY = new TextEncoder().encode(JSON.stringify("jsonrpc"));
function namesCredential(bytes) {
  return CREDENTIAL_KEYS.some((key) => includesBytes(bytes, key));
}
function oversizedCallNamesCredential(method, contentType, body) {
  if (method !== "POST" || !isJsonType(contentType) || body.byteLength <= MCP_BODY_MAX_BYTES) return false;
  return namesCredential(new Uint8Array(body));
}
function firstValueByte(bytes) {
  let at = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? 3 : 0;
  while (at < bytes.length && (bytes[at] === 32 || bytes[at] === 9 || bytes[at] === 10 || bytes[at] === 13)) {
    at += 1;
  }
  return bytes[at];
}
function callCarriesCredential(call) {
  const params = isRecord(call.params) ? call.params : null;
  if (!params) return false;
  const meta = isRecord(params._meta) ? params._meta : null;
  if (meta && (MCP_X402_PAYMENT_META in meta || MCP_DNA_KEY_META in meta)) return true;
  return call.method === "tools/call" && isRecord(params.arguments) && MCP_KEY_ARGUMENT in params.arguments;
}
function unreadCallNamesCredential(rpc, body) {
  if (rpc !== null || body.byteLength === 0) return false;
  const bytes = new Uint8Array(body);
  const first = firstValueByte(bytes);
  if (first !== 123 && first !== 91) return false;
  if (body.byteLength <= MCP_BODY_MAX_BYTES) {
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return includesBytes(bytes, JSONRPC_KEY) && namesCredential(bytes);
    }
    const calls = (Array.isArray(parsed) ? parsed : [parsed]).filter(
      (item) => isRecord(item) && "jsonrpc" in item
    );
    return calls.some(callCarriesCredential);
  }
  return includesBytes(bytes, JSONRPC_KEY) && namesCredential(bytes);
}
function includesBytes(haystack, needle) {
  const last = haystack.length - needle.length;
  for (let at = haystack.indexOf(needle[1], 1); at !== -1 && at - 1 <= last; at = haystack.indexOf(needle[1], at + 1)) {
    const start = at - 1;
    let i = 0;
    while (i < needle.length && haystack[start + i] === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
}
function isJsonType(contentType) {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return type === "application/json" || type.endsWith("+json");
}
function mcpFactsOf(headers, rpc, excluded = []) {
  const mirror = (name) => excluded.includes(name) ? null : headers.get(name);
  const method = rpc ? bounded(rpc.method, MCP_METHOD_MAX_LENGTH) : bounded(mirror(MCP_METHOD_HEADER), MCP_METHOD_MAX_LENGTH);
  const tool = rpc ? bounded(nameInCall(rpc), MCP_NAME_MAX_LENGTH) : bounded(recordableName(mirror(MCP_NAME_HEADER) ?? void 0), MCP_NAME_MAX_LENGTH);
  if (!method && !tool) return null;
  return { ...method ? { method } : {}, ...tool ? { tool } : {}, source: rpc ? "body" : "headers" };
}
function nameInCall(rpc) {
  const params = rpc?.params;
  if (!params) return void 0;
  if (rpc.method === "resources/read") return recordableName(stringOrUndefined(params.uri));
  return rpc.method === "tools/call" || rpc.method === "prompts/get" ? stringOrUndefined(params.name) : void 0;
}
function recordableName(name) {
  if (!name) return void 0;
  return name.split(/[?#]/)[0].replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1");
}
function bounded(value, max) {
  return value && value.length <= max && PRINTABLE.test(value) ? value : void 0;
}
function liftMcpPayment(rpc) {
  const params = rpc.params;
  if (!params) return { lifted: {}, originBody: null };
  const lifted = {};
  const meta = isRecord(params._meta) ? { ...params._meta } : null;
  const args = isRecord(params.arguments) ? { ...params.arguments } : null;
  let changed = false;
  if (meta && MCP_X402_PAYMENT_META in meta) {
    const payment = meta[MCP_X402_PAYMENT_META];
    if (isRecord(payment)) lifted[X402_PAYMENT_HEADER_V2] = base64Utf8(JSON.stringify(payment));
    delete meta[MCP_X402_PAYMENT_META];
    changed = true;
  }
  if (meta && MCP_DNA_KEY_META in meta) {
    const key = stringOrUndefined(meta[MCP_DNA_KEY_META]);
    if (key) lifted[PAYMENT_AUTHORIZATION_HEADER] = `Payment ${key}`;
    delete meta[MCP_DNA_KEY_META];
    changed = true;
  }
  if (rpc.method === "tools/call" && args && MCP_KEY_ARGUMENT in args) {
    const key = stringOrUndefined(args[MCP_KEY_ARGUMENT]);
    if (key && !(PAYMENT_AUTHORIZATION_HEADER in lifted)) {
      lifted[PAYMENT_AUTHORIZATION_HEADER] = `Payment ${key}`;
    }
    delete args[MCP_KEY_ARGUMENT];
    changed = true;
  }
  if (!changed) return { lifted, originBody: null };
  const { _meta: _droppedMeta, arguments: _droppedArgs, ...rest } = params;
  const originParams = {
    ...rest,
    ...args ? { arguments: args } : {},
    ...meta && Object.keys(meta).length > 0 ? { _meta: meta } : {}
  };
  return {
    lifted,
    originBody: JSON.stringify({ jsonrpc: "2.0", ...idPart(rpc), method: rpc.method, params: originParams })
  };
}
function idPart(rpc) {
  return rpc.id === void 0 ? {} : { id: rpc.id };
}
function mcpCarriageOf(request, body, excluded = []) {
  const rpc = readJsonRpcRequest(request.method, request.headers.get("content-type"), body);
  const facts = mcpFactsOf(request.headers, rpc, excluded);
  const { lifted, originBody } = rpc ? liftMcpPayment(rpc) : { lifted: {}, originBody: null };
  const mirrored = stringOrUndefined(request.headers.get(MCP_DNA_KEY_HEADER));
  if (mirrored && !(PAYMENT_AUTHORIZATION_HEADER in lifted)) {
    lifted[PAYMENT_AUTHORIZATION_HEADER] = `Payment ${mirrored}`;
  }
  const tooLarge = oversizedCallNamesCredential(request.method, request.headers.get("content-type"), body);
  const notOneCall = !tooLarge && unreadCallNamesCredential(rpc, body);
  return {
    rpc,
    facts,
    lifted,
    originBody,
    unreadableCredential: tooLarge || notOneCall,
    ...tooLarge ? { unreadableReason: "too-large" } : {},
    ...notOneCall ? { unreadableReason: "not-one-call" } : {}
  };
}
var PAYMENT_FAMILIES = [
  X402_PAYMENT_HEADERS,
  [PAYMENT_AUTHORIZATION_HEADER]
];
function liftedPaymentToForward(sent, lifted) {
  const out = {};
  for (const family of PAYMENT_FAMILIES) {
    if (family.some((name) => sent.has(name))) continue;
    for (const name of family) if (name in lifted) out[name] = lifted[name];
  }
  return out;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringOrUndefined(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
var HEADER_SAFE_VALUE = /^[\x20-\x7e]{1,8192}$/;
var HEADER_SAFE_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
function headerSafePaymentHeaders(headers) {
  const safe = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (HEADER_SAFE_NAME.test(name) && HEADER_SAFE_VALUE.test(value)) safe[name] = value;
  }
  return safe;
}
function isRedirect(status) {
  return status >= 300 && status <= 399;
}
function paymentEdgeMode(status) {
  if (status === 402) return "payment-required";
  if (isRedirect(status)) return "payment-redirect";
  if (status === 200) return "payment-stub";
  return "fail-closed";
}
function buildPaymentResponse(payment, edgeMode, rpcId) {
  if (payment.bodyKind === "json-rpc" && rpcId !== void 0) {
    return jsonRpcResponse(payment, edgeMode, rpcId);
  }
  const status = payment.status ?? 502;
  return new Response(payment.body ?? null, {
    status,
    headers: {
      // A redirect carries no body, and a JSON type on it misleads the client that follows it.
      ...isRedirect(status) ? {} : { "content-type": "application/json; charset=utf-8" },
      "cache-control": "no-store",
      ...headerSafePaymentHeaders(payment.headers),
      "x-d3-edge": edgeMode
    }
  });
}
function jsonRpcResponse(payment, edgeMode, id) {
  let result;
  try {
    result = JSON.parse(payment.body ?? "");
  } catch {
    return buildPaymentResponse(
      { status: 502, body: JSON.stringify({ error: "payment_unavailable" }) },
      "fail-closed"
    );
  }
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headerSafePaymentHeaders(payment.headers),
      "x-d3-edge": edgeMode
    }
  });
}
var MERGED_HEADERS = /* @__PURE__ */ new Set(["access-control-expose-headers", "set-cookie"]);
function privateCacheControl(origin) {
  const directives = (origin ?? "").split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (directives.length === 0) return "private";
  const lowered = directives.map((directive) => directive.toLowerCase());
  if (lowered.includes("private") || lowered.includes("no-store")) return directives.join(", ");
  const shared = lowered.indexOf("public");
  if (shared === -1) return ["private", ...directives].join(", ");
  directives[shared] = "private";
  return directives.join(", ");
}
function withPaymentHeaders(response, payment) {
  const safe = headerSafePaymentHeaders(payment?.headers);
  if (Object.keys(safe).length === 0) return response;
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(safe)) {
    if (MERGED_HEADERS.has(name.toLowerCase()) && copy.headers.has(name)) copy.headers.append(name, value);
    else copy.headers.set(name, value);
  }
  copy.headers.set("cache-control", privateCacheControl(copy.headers.get("cache-control")));
  return copy;
}
var MCP_KEY_ARGUMENT_MEMORY_MS = 5 * 6e4;
var MCP_RESULT_MAX_BYTES = 4 * 1048576;
var MAX_DEBUG_HEADERS = 64;
var MAX_DEBUG_HEADER_LENGTH = 2048;
function debugHeadersOf(entries, excluded = []) {
  const keptBack = new Set(excluded);
  const out = {};
  let kept = 0;
  for (const [rawName, value] of entries) {
    if (kept === MAX_DEBUG_HEADERS) break;
    const name = rawName.toLowerCase();
    if (NEVER_FORWARDED_HEADERS.has(name) || keptBack.has(name)) continue;
    if (typeof value !== "string" || value.length > MAX_DEBUG_HEADER_LENGTH) continue;
    out[name] = value;
    kept += 1;
  }
  return out;
}
var ANS_HEADERS = ["x-scitt-receipt", "x-ans-status-token", "dpop"];
var ACCEPT_MAX_LENGTH = 256;
var NAVIGATION_HEADERS = ["sec-fetch-mode", "sec-fetch-dest", "upgrade-insecure-requests"];
var NAVIGATION_HEADER_MAX_LENGTH = 32;
var HINT_HEADERS = [
  "sec-ch-ua",
  "sec-ch-ua-platform",
  "sec-ch-ua-mobile",
  "accept-language"
];
var HINT_HEADER_MAX_LENGTH = 256;
var FORWARDED_HEADER_SET = 2;
var FORWARDED_HEADERS = [
  "signature",
  "signature-input",
  "signature-agent",
  "user-agent",
  "content-digest",
  "accept",
  ...NAVIGATION_HEADERS,
  ...HINT_HEADERS,
  ...PURPOSE_HEADERS,
  ...ANS_HEADERS,
  ...X402_PAYMENT_HEADERS,
  PAYMENT_AUTHORIZATION_HEADER
];
var HEADER_LENGTH_CAPS = new Map([
  ["x-scitt-receipt", ANS_ARTIFACT_MAX_BASE64_LENGTH],
  ["x-ans-status-token", ANS_ARTIFACT_MAX_BASE64_LENGTH],
  ["dpop", ANS_DPOP_MAX_PROOF_BYTES],
  ["accept", ACCEPT_MAX_LENGTH],
  ...NAVIGATION_HEADERS.map((name) => [name, NAVIGATION_HEADER_MAX_LENGTH]),
  ...HINT_HEADERS.map((name) => [name, HINT_HEADER_MAX_LENGTH]),
  ...PAYMENT_HEADER_CAPS
]);
async function extractPayload(request, opts = {}) {
  return (await extractEdgeRequest(request, opts)).payload;
}
async function extractEdgeRequest(request, opts = {}) {
  const url = new URL(request.url);
  const revision = opts.adapterSet ?? 0;
  const exclude = opts.exclude ?? NO_EXCLUSIONS;
  const forwardsAll = revision >= FORWARDS_ALL_SINCE;
  const forwarded = forwardsAll ? forwardAll(request.headers, exclude, HEADER_LENGTH_CAPS) : {
    ...allowlisted(request.headers),
    cookies: {},
    droppedCookies: [],
    droppedUnlisted: { headers: false, cookies: false }
  };
  const { headers, droppedHeaders, cookies, droppedCookies, droppedUnlisted } = forwarded;
  const cookie = request.headers.get("cookie");
  forwardCookie(headers, cookie, PAY_SESSION_COOKIE, PAY_SESSION_HEADER, PAY_SESSION_MAX_LENGTH);
  forwardCookie(headers, cookie, PERSON_PASS_COOKIE, PERSON_PASS_HEADER, PERSON_PASS_MAX_LENGTH);
  const canHaveBody = request.method !== "GET" && request.method !== "HEAD";
  const body = canHaveBody && request.body !== null ? await request.clone().arrayBuffer() : new ArrayBuffer(0);
  if (body.byteLength > 0 || "content-digest" in headers) {
    headers["content-digest"] = await sha256ContentDigest(body);
  }
  const mcp = revision >= CARRIES_MCP_SINCE ? mcpCarriageOf(request, body, exclude.headers) : null;
  for (const [name, value] of Object.entries(liftedPaymentToForward(request.headers, mcp?.lifted ?? {}))) {
    if (exclude.headers.includes(name)) continue;
    const cap = HEADER_LENGTH_CAPS.get(name);
    if (cap !== void 0 && value.length > cap) droppedHeaders.push(name);
    else headers[name] = value;
  }
  const payload = {
    ip: opts.ip,
    handshake: opts.handshake,
    network: opts.network,
    headerSet: FORWARDED_HEADER_SET,
    ...opts.adapterSet === void 0 ? {} : { adapterSet: opts.adapterSet },
    secure: url.protocol === "https:",
    ...droppedHeaders.length > 0 ? { droppedHeaders } : {},
    method: request.method,
    url: url.pathname + url.search,
    host: url.host,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    headers,
    ...forwardsAll ? { cookies } : {},
    ...droppedCookies.length > 0 ? { droppedCookies } : {},
    ...forwardsAll ? withheldOf(exclude, droppedUnlisted) : {},
    ...mcp?.facts ? { mcp: mcp.facts } : {},
    ...opts.debugHeaders ? { debugHeaders: debugHeadersOf(entriesOf(request.headers), exclude.headers) } : {}
  };
  return { payload, mcp };
}
function allowlisted(source) {
  const headers = {};
  const droppedHeaders = [];
  for (const name of FORWARDED_HEADERS) {
    const value = source.get(name);
    if (value === null) continue;
    const cap = HEADER_LENGTH_CAPS.get(name);
    if (cap !== void 0 && value.length > cap) {
      droppedHeaders.push(name);
      continue;
    }
    headers[name] = value;
  }
  return { headers, droppedHeaders };
}
function entriesOf(headers) {
  const pairs = [];
  headers.forEach((value, name) => pairs.push([name, value]));
  return pairs;
}
async function sha256ContentDigest(body) {
  const digest = await crypto.subtle.digest("SHA-256", body);
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `sha-256=:${btoa(binary)}:`;
}
function forwardCookie(headers, cookie, name, header, maxLength) {
  const value = readCookie(cookie, name);
  if (value !== null && value.length > 0 && value.length <= maxLength) headers[header] = value;
}

// node_modules/@d3-inc/d3-dna-vercel-middleware/dist/index.js
var import_functions = require("@vercel/functions");
var import_functions2 = require("@vercel/functions");
var import_functions3 = require("@vercel/functions");
var PACKED_VERSION = true ? "0.11.1" : void 0;
var MIDDLEWARE_ADAPTER_NAME = adapterNameOf("vercel-middleware", PACKED_VERSION);
var MCP_ROUTE_ADAPTER_NAME = adapterNameOf("vercel-mcp", PACKED_VERSION);
function blockResponse(decision, mode) {
  return new Response(
    JSON.stringify({
      blocked: true,
      ruleId: decision.ruleId,
      tier: decision.verdict?.tier,
      identity: decision.verdict?.identity
    }),
    {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8", "x-d3-edge": mode }
    }
  );
}
function paymentUnavailableResponse() {
  return new Response(JSON.stringify({ error: "payment_unavailable" }), {
    status: 502,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-d3-edge": "fail-closed"
    }
  });
}
function networkFactsFromVercel(request) {
  const country = (0, import_functions2.geolocation)(request).country;
  return country ? { country } : void 0;
}
function envVar(key) {
  return typeof process !== "undefined" ? process.env?.[key] : void 0;
}
function configLookup(config2) {
  const byName = {
    DNA_API_KEY: config2.apiKey,
    POLICY_ADAPTER_KEY: config2.adapterKey,
    POLICY_SHARED_SECRET: config2.sharedSecret,
    DNA_ENDPOINT: config2.endpoint,
    POLICY_WORKER_URL: config2.policyWorkerUrl,
    DNA_ENABLED: config2.enabled?.toString(),
    DNA_FAIL_MODE: config2.failMode,
    DNA_TIMEOUT_MS: config2.timeoutMs?.toString(),
    DNA_PAYMENT_TIMEOUT_MS: config2.paymentTimeoutMs?.toString(),
    DNA_DEBUG_LOG_RAW_PAYLOAD: config2.debugLogRawPayload?.toString(),
    DNA_EXCLUDE_HEADERS: listSetting(config2.excludeHeaders),
    DNA_EXCLUDE_COOKIES: listSetting(config2.excludeCookies)
  };
  return (name) => byName[name];
}
function listSetting(value) {
  return Array.isArray(value) ? value.join(",") : value;
}
function resolveConfig(config2 = {}) {
  return readAdapterSettings(configLookup(config2), envVar);
}
var log3 = edgeLogger("vercel-middleware");
function createD3Middleware(config2, deps = {}) {
  const cfg = resolveConfig(config2);
  const nextFn = deps.next ?? ((init) => (0, import_functions.next)(init));
  const rewriteFn = deps.rewrite ?? ((destination, init) => (0, import_functions.rewrite)(destination, init));
  const ipFn = deps.ipAddress ?? ((request) => (0, import_functions.ipAddress)(request));
  const waitUntilFn = deps.waitUntil ?? ((promise) => (0, import_functions.waitUntil)(promise));
  return async function d3Middleware(request) {
    if (!cfg.endpoint) {
      const clean2 = stripPaymentHeaders(request);
      const init2 = { headers: { "x-d3-edge": "disabled" }, request: { headers: clean2.headers } };
      return clean2.url === request.url ? nextFn(init2) : rewriteFn(clean2.url, init2);
    }
    const endpoint = cfg.endpoint;
    const paying = requestPresentsPayment(request);
    const client = createHttpPolicyClient(
      {
        url: endpoint,
        bearer: cfg.apiKey,
        timeoutMs: paying ? cfg.paymentTimeoutMs : cfg.timeoutMs,
        adapterName: MIDDLEWARE_ADAPTER_NAME
      },
      deps.fetchImpl
    );
    const payload = await extractPayload(request, {
      ip: ipFn(request),
      network: networkFactsFromVercel(request),
      debugHeaders: cfg.debugLogRawPayload,
      // `next()` cannot replace the body nor see the origin's answer, so the MCP carriage is
      // `withD3Mcp`'s on its own route; the forwarding is this one's.
      adapterSet: FORWARDS_ALL_SINCE,
      exclude: cfg.exclude
    });
    const requestId = crypto.randomUUID();
    payload.requestId = requestId;
    const reportOutcome = (mode, response, extra = {}) => {
      waitUntilFn(
        Promise.resolve(extra.answer).then(
          (answer) => sendReport(
            {
              requestId,
              ts: Date.now(),
              host: payload.host,
              path: pathOf(payload.url),
              method: payload.method,
              mode,
              status: extra.status,
              answer
            },
            { url: endpoint, bearer: cfg.apiKey },
            deps.fetchImpl
          )
        )
      );
      return response;
    };
    const reportBuilt = (mode, response) => reportOutcome(mode, response, {
      status: response.status,
      answer: builtAnswerOf(response).catch(() => void 0)
    });
    let decision;
    try {
      decision = await client.getDecision(payload);
    } catch (err) {
      log3.error("policy call failed", { err, paying });
      if (paying) return reportBuilt("fail-closed", paymentUnavailableResponse());
      if (cfg.failMode === "closed") {
        return reportBuilt("fail-closed", blockResponse({ action: "block", failOpen: false }, "fail-closed"));
      }
      const clean2 = stripPaymentHeaders(request);
      const init2 = { headers: { "x-d3-edge": "fail-open" }, request: { headers: clean2.headers } };
      return reportOutcome(
        "fail-open",
        clean2.url === request.url ? nextFn(init2) : rewriteFn(clean2.url, init2)
      );
    }
    if (decision.action === "block") return reportBuilt("block", blockResponse(decision, "block"));
    if (decision.payment?.status !== void 0) {
      const mode = paymentEdgeMode(decision.payment.status);
      return reportBuilt(mode, buildPaymentResponse(decision.payment, mode));
    }
    const clean = stripPaymentHeaders(request);
    const init = { headers: { "x-d3-edge": "pass" }, request: { headers: clean.headers } };
    const continued = clean.url === request.url ? nextFn(init) : rewriteFn(clean.url, init);
    return reportOutcome("pass", withPaymentHeaders(continued, decision.payment));
  };
}
var log22 = edgeLogger("vercel-mcp");
configureEdgeLogging();

// d3-node-middleware.ts
var import_functions4 = require("@vercel/functions");
var matcher = "/((?!_next/static|_next/image|favicon.ico|img/|icons/|css/|js/|vendor/|games/moon-rangers/assets/).*)";
var dna;
function failOpen(err) {
  console.error("DNA middleware failed open", err);
  try {
    return (0, import_functions4.next)({ headers: { "x-d3-edge": "fail-open" } });
  } catch (nextErr) {
    console.error("DNA middleware continuation failed", nextErr);
    return new Response(null, {
      status: 200,
      headers: {
        "x-middleware-next": "1",
        "x-d3-edge": "fail-open"
      }
    });
  }
}
async function middleware(request) {
  try {
    dna ??= createD3Middleware();
    return await dna(request);
  } catch (err) {
    return failOpen(err);
  }
}
var config = {
  matcher,
  runtime: "nodejs"
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config
});
