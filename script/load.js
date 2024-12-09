import path from "path";
import fs from "fs";
import process$2 from "node:process";
import require$$0$1 from "assert";
import require$$2 from "events";
import readline from "node:readline";
import require$$0$2 from "stream";
import require$$0$3 from "buffer";
import require$$1 from "util";

var commonjsGlobal =
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
    ? window
    : typeof global !== "undefined"
    ? global
    : typeof self !== "undefined"
    ? self
    : {};

function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default")
    ? x["default"]
    : x;
}

class Node {
  constructor(value) {
    this.value = value;
    this.children = new Map();
  }

  addChild(value) {
    if (!this.children.has(value)) {
      const newNode = new Node(value);
      this.children.set(value, newNode);
      return newNode;
    }
    return this.children.get(value);
  }
}

class RenderTableEntry {
  constructor(value, depth, isLastChild) {
    this.value = value;
    this.depth = depth;
    this.isLastChild = isLastChild;
  }
}

function parseTree(filePaths, options) {
  const PATH_SEPARATOR = options.pathSeparator;
  const roots = new Map();

  // Parse into tree
  let pathElements, rootElement, node;
  for (const path of filePaths) {
    pathElements = path.split(PATH_SEPARATOR);
    rootElement = pathElements.shift();
    node = roots.get(rootElement);
    if (node == null) {
      node = new Node(rootElement);
      roots.set(rootElement, node);
    }
    for (const pathElement of pathElements) {
      node = node.addChild(pathElement);
    }
  }
  return builderRenderTable(roots, PATH_SEPARATOR);
}

function builderRenderTable(roots, pathSeparator) {
  let renderTable = [];
  let toVisit = [...roots.values()];

  let nodeDepths = new Map(); // Now deep nodes are
  let lastNodes = new Set([toVisit[toVisit.length - 1]]); // Nodes that are the last child

  while (toVisit.length > 0) {
    let currentNode = toVisit.shift();

    let nodeDepth = nodeDepths.get(currentNode) || 0;

    // Compress nodes with one child
    while (currentNode.children.size === 1) {
      let childNode = currentNode.children.values().next().value;
      currentNode.value += `${pathSeparator}${childNode.value}`;
      currentNode.children = childNode.children;
    }

    let children = [...currentNode.children.values()];
    if (children.length > 0) {
      for (const child of children) {
        nodeDepths.set(child, nodeDepth + 1);
      }
      lastNodes.add(children[children.length - 1]);
      toVisit = children.concat(toVisit);
    }

    renderTable.push(
      new RenderTableEntry(
        currentNode.value,
        nodeDepth,
        lastNodes.has(currentNode)
      )
    );
  }
  return renderTable;
}

function printTree(renderTable, options) {
  let outputString = "";
  let activeColumns = []; // Columns we are currently rendering because they are open
  for (const tableEntry of renderTable) {
    // Root node
    if (tableEntry.depth === 0) {
      outputString += tableEntry.value;
    } else {
      // Indent to the correct column
      for (let column = 1; column < tableEntry.depth; column++) {
        if (activeColumns[column]) {
          outputString += options.sequences.vertical;
        } else {
          outputString += options.sequences.emptyColumn;
        }
      }
      outputString += tableEntry.isLastChild
        ? options.sequences.endTee
        : options.sequences.throughTee;
      outputString += " " + tableEntry.value;
    }
    outputString +=
      tableEntry === renderTable[renderTable.length - 1] ? "" : "\n";
    activeColumns[tableEntry.depth] = !tableEntry.isLastChild;
  }
  return outputString;
}

const DEFAULT_OPTIONS = {
  pathSeparator: "/",
  sequences: {
    throughTee: "├──",
    endTee: "└──",
    vertical: "|  ",
    emptyColumn: "   ",
  },
};

function prettyFileTree(files) {
  if (!files || typeof files[Symbol.iterator] !== "function") {
    return "";
  }
  return printTree(parseTree(files, DEFAULT_OPTIONS), DEFAULT_OPTIONS);
}

var prettyFileTree_1 = prettyFileTree;

var createFileTree = /*@__PURE__*/ getDefaultExportFromCjs(prettyFileTree_1);

/**
 * @typedef Module
 * @property {string} name
 * @property {string} path
 * @property {string|undefined} content
 */

/**
 * @param {Module[]} project
 * @returns {[string, Module[]]}
 */
function createExecutableFromProject(project) {
  const getModFnName = (name) => name.replace(/\./g, "_").replace(/^_/, "");
  /** @type {Module[]} */
  const contents = [];

  // filter out repeated modules with different import names
  // and construct the executable Lua code
  // (the main file content is handled separately)
  for (let i = 0; i < project.length - 1; i++) {
    const mod = project[i];

    const existing = contents.find((m) => m.path === mod.path);
    const moduleContent =
      (!existing &&
        `-- module: "${mod.name}"\nlocal function _loaded_mod_${getModFnName(
          mod.name
        )}()\n${mod.content}\nend\n`) ||
      "";
    const requireMapper = `\n_G.package.loaded["${
      mod.name
    }"] = _loaded_mod_${getModFnName(existing?.name || mod.name)}()`;

    contents.push({
      ...mod,
      content: moduleContent + requireMapper,
    });
  }

  // finally, add the main file
  contents.push(project[project.length - 1]);

  return [
    contents.reduce((acc, con) => acc + "\n\n" + con.content, ""),
    contents,
  ];
}

/**
 * Create the project structure from the main file's content
 * @param {string} mainFile
 * @return {Module[]}
 */
function createProjectStructure(mainFile) {
  const sorted = [];
  const cwd = path.dirname(mainFile);

  // checks if the sorted module list already includes a node
  const isSorted = (node) =>
    sorted.find((sortedNode) => sortedNode.path === node.path);

  // recursive dfs algorithm
  function dfs(currentNode) {
    const unvisitedChildNodes = exploreNodes(currentNode, cwd).filter(
      (node) => !isSorted(node)
    );

    for (let i = 0; i < unvisitedChildNodes.length; i++) {
      dfs(unvisitedChildNodes[i]);
    }

    if (!isSorted(currentNode)) sorted.push(currentNode);
  }

  // run DFS from the main file
  dfs({ path: mainFile });

  return sorted.filter(
    // modules that were not read don't exist locally
    // aos assumes that these modules have already been
    // loaded into the process, or they're default modules
    (mod) => mod.content !== undefined
  );
}

/**
 * Find child nodes for a node (a module)
 * @param {Module} node Parent node
 * @param {string} cwd Project root dir
 * @return {Module[]}
 */
function exploreNodes(node, cwd) {
  if (!fs.existsSync(node.path)) return [];

  // set content
  node.content = fs.readFileSync(node.path, "utf-8");

  // Don't include requires that are commented (start with --)
  const requirePattern =
    /(?<!^.*--.*)(?<=(require( *)(\n*)(\()?( *)("|'))).*(?=("|'))/gm;
  const requiredModules =
    node.content.match(requirePattern)?.map((mod) => {
      return {
        name: mod,
        path: path.join(cwd, mod.replace(/\./g, "/") + ".lua"),
        content: undefined,
      };
    }) || [];

  return requiredModules;
}

const ANSI_BACKGROUND_OFFSET = 10;

const wrapAnsi16 =
  (offset = 0) =>
  (code) =>
    `\u001B[${code + offset}m`;

const wrapAnsi256 =
  (offset = 0) =>
  (code) =>
    `\u001B[${38 + offset};5;${code}m`;

const wrapAnsi16m =
  (offset = 0) =>
  (red, green, blue) =>
    `\u001B[${38 + offset};2;${red};${green};${blue}m`;

const styles$1 = {
  modifier: {
    reset: [0, 0],
    // 21 isn't widely supported and 22 does the same thing
    bold: [1, 22],
    dim: [2, 22],
    italic: [3, 23],
    underline: [4, 24],
    overline: [53, 55],
    inverse: [7, 27],
    hidden: [8, 28],
    strikethrough: [9, 29],
  },
  color: {
    black: [30, 39],
    red: [31, 39],
    green: [32, 39],
    yellow: [33, 39],
    blue: [34, 39],
    magenta: [35, 39],
    cyan: [36, 39],
    white: [37, 39],

    // Bright color
    blackBright: [90, 39],
    gray: [90, 39], // Alias of `blackBright`
    grey: [90, 39], // Alias of `blackBright`
    redBright: [91, 39],
    greenBright: [92, 39],
    yellowBright: [93, 39],
    blueBright: [94, 39],
    magentaBright: [95, 39],
    cyanBright: [96, 39],
    whiteBright: [97, 39],
  },
  bgColor: {
    bgBlack: [40, 49],
    bgRed: [41, 49],
    bgGreen: [42, 49],
    bgYellow: [43, 49],
    bgBlue: [44, 49],
    bgMagenta: [45, 49],
    bgCyan: [46, 49],
    bgWhite: [47, 49],

    // Bright color
    bgBlackBright: [100, 49],
    bgGray: [100, 49], // Alias of `bgBlackBright`
    bgGrey: [100, 49], // Alias of `bgBlackBright`
    bgRedBright: [101, 49],
    bgGreenBright: [102, 49],
    bgYellowBright: [103, 49],
    bgBlueBright: [104, 49],
    bgMagentaBright: [105, 49],
    bgCyanBright: [106, 49],
    bgWhiteBright: [107, 49],
  },
};

Object.keys(styles$1.modifier);
const foregroundColorNames = Object.keys(styles$1.color);
const backgroundColorNames = Object.keys(styles$1.bgColor);
[...foregroundColorNames, ...backgroundColorNames];

function assembleStyles() {
  const codes = new Map();

  for (const [groupName, group] of Object.entries(styles$1)) {
    for (const [styleName, style] of Object.entries(group)) {
      styles$1[styleName] = {
        open: `\u001B[${style[0]}m`,
        close: `\u001B[${style[1]}m`,
      };

      group[styleName] = styles$1[styleName];

      codes.set(style[0], style[1]);
    }

    Object.defineProperty(styles$1, groupName, {
      value: group,
      enumerable: false,
    });
  }

  Object.defineProperty(styles$1, "codes", {
    value: codes,
    enumerable: false,
  });

  styles$1.color.close = "\u001B[39m";
  styles$1.bgColor.close = "\u001B[49m";

  styles$1.color.ansi = wrapAnsi16();
  styles$1.color.ansi256 = wrapAnsi256();
  styles$1.color.ansi16m = wrapAnsi16m();
  styles$1.bgColor.ansi = wrapAnsi16(ANSI_BACKGROUND_OFFSET);
  styles$1.bgColor.ansi256 = wrapAnsi256(ANSI_BACKGROUND_OFFSET);
  styles$1.bgColor.ansi16m = wrapAnsi16m(ANSI_BACKGROUND_OFFSET);

  // From https://github.com/Qix-/color-convert/blob/3f0e0d4e92e235796ccb17f6e85c72094a651f49/conversions.js
  Object.defineProperties(styles$1, {
    rgbToAnsi256: {
      value(red, green, blue) {
        // We use the extended greyscale palette here, with the exception of
        // black and white. normal palette only has 4 greyscale shades.
        if (red === green && green === blue) {
          if (red < 8) {
            return 16;
          }

          if (red > 248) {
            return 231;
          }

          return Math.round(((red - 8) / 247) * 24) + 232;
        }

        return (
          16 +
          36 * Math.round((red / 255) * 5) +
          6 * Math.round((green / 255) * 5) +
          Math.round((blue / 255) * 5)
        );
      },
      enumerable: false,
    },
    hexToRgb: {
      value(hex) {
        const matches = /[a-f\d]{6}|[a-f\d]{3}/i.exec(hex.toString(16));
        if (!matches) {
          return [0, 0, 0];
        }

        let [colorString] = matches;

        if (colorString.length === 3) {
          colorString = [...colorString]
            .map((character) => character + character)
            .join("");
        }

        const integer = Number.parseInt(colorString, 16);

        return [
          /* eslint-disable no-bitwise */
          (integer >> 16) & 0xff,
          (integer >> 8) & 0xff,
          integer & 0xff,
          /* eslint-enable no-bitwise */
        ];
      },
      enumerable: false,
    },
    hexToAnsi256: {
      value: (hex) => styles$1.rgbToAnsi256(...styles$1.hexToRgb(hex)),
      enumerable: false,
    },
    ansi256ToAnsi: {
      value(code) {
        if (code < 8) {
          return 30 + code;
        }

        if (code < 16) {
          return 90 + (code - 8);
        }

        let red;
        let green;
        let blue;

        if (code >= 232) {
          red = ((code - 232) * 10 + 8) / 255;
          green = red;
          blue = red;
        } else {
          code -= 16;

          const remainder = code % 36;

          red = Math.floor(code / 36) / 5;
          green = Math.floor(remainder / 6) / 5;
          blue = (remainder % 6) / 5;
        }

        const value = Math.max(red, green, blue) * 2;

        if (value === 0) {
          return 30;
        }

        // eslint-disable-next-line no-bitwise
        let result =
          30 +
          ((Math.round(blue) << 2) |
            (Math.round(green) << 1) |
            Math.round(red));

        if (value === 2) {
          result += 60;
        }

        return result;
      },
      enumerable: false,
    },
    rgbToAnsi: {
      value: (red, green, blue) =>
        styles$1.ansi256ToAnsi(styles$1.rgbToAnsi256(red, green, blue)),
      enumerable: false,
    },
    hexToAnsi: {
      value: (hex) => styles$1.ansi256ToAnsi(styles$1.hexToAnsi256(hex)),
      enumerable: false,
    },
  });

  return styles$1;
}

const ansiStyles = assembleStyles();

/* eslint-env browser */

const level = (() => {
  return 0;
})();

const colorSupport = level !== 0 && {
  level,
  hasBasic: true,
  has256: level >= 2,
  has16m: level >= 3,
};

const supportsColor = {
  stdout: colorSupport,
  stderr: colorSupport,
};

// TODO: When targeting Node.js 16, use `String.prototype.replaceAll`.
function stringReplaceAll(string, substring, replacer) {
  let index = string.indexOf(substring);
  if (index === -1) {
    return string;
  }

  const substringLength = substring.length;
  let endIndex = 0;
  let returnValue = "";
  do {
    returnValue += string.slice(endIndex, index) + substring + replacer;
    endIndex = index + substringLength;
    index = string.indexOf(substring, endIndex);
  } while (index !== -1);

  returnValue += string.slice(endIndex);
  return returnValue;
}

function stringEncaseCRLFWithFirstIndex(string, prefix, postfix, index) {
  let endIndex = 0;
  let returnValue = "";
  do {
    const gotCR = string[index - 1] === "\r";
    returnValue +=
      string.slice(endIndex, gotCR ? index - 1 : index) +
      prefix +
      (gotCR ? "\r\n" : "\n") +
      postfix;
    endIndex = index + 1;
    index = string.indexOf("\n", endIndex);
  } while (index !== -1);

  returnValue += string.slice(endIndex);
  return returnValue;
}

const { stdout: stdoutColor, stderr: stderrColor } = supportsColor;

const GENERATOR = Symbol("GENERATOR");
const STYLER = Symbol("STYLER");
const IS_EMPTY = Symbol("IS_EMPTY");

// `supportsColor.level` → `ansiStyles.color[name]` mapping
const levelMapping = ["ansi", "ansi", "ansi256", "ansi16m"];

const styles = Object.create(null);

const applyOptions = (object, options = {}) => {
  if (
    options.level &&
    !(
      Number.isInteger(options.level) &&
      options.level >= 0 &&
      options.level <= 3
    )
  ) {
    throw new Error("The `level` option should be an integer from 0 to 3");
  }

  // Detect level if not set manually
  const colorLevel = stdoutColor ? stdoutColor.level : 0;
  object.level = options.level === undefined ? colorLevel : options.level;
};

const chalkFactory = (options) => {
  const chalk = (...strings) => strings.join(" ");
  applyOptions(chalk, options);

  Object.setPrototypeOf(chalk, createChalk.prototype);

  return chalk;
};

function createChalk(options) {
  return chalkFactory(options);
}

Object.setPrototypeOf(createChalk.prototype, Function.prototype);

for (const [styleName, style] of Object.entries(ansiStyles)) {
  styles[styleName] = {
    get() {
      const builder = createBuilder(
        this,
        createStyler(style.open, style.close, this[STYLER]),
        this[IS_EMPTY]
      );
      Object.defineProperty(this, styleName, { value: builder });
      return builder;
    },
  };
}

styles.visible = {
  get() {
    const builder = createBuilder(this, this[STYLER], true);
    Object.defineProperty(this, "visible", { value: builder });
    return builder;
  },
};

const getModelAnsi = (model, level, type, ...arguments_) => {
  if (model === "rgb") {
    if (level === "ansi16m") {
      return ansiStyles[type].ansi16m(...arguments_);
    }

    if (level === "ansi256") {
      return ansiStyles[type].ansi256(ansiStyles.rgbToAnsi256(...arguments_));
    }

    return ansiStyles[type].ansi(ansiStyles.rgbToAnsi(...arguments_));
  }

  if (model === "hex") {
    return getModelAnsi(
      "rgb",
      level,
      type,
      ...ansiStyles.hexToRgb(...arguments_)
    );
  }

  return ansiStyles[type][model](...arguments_);
};

const usedModels = ["rgb", "hex", "ansi256"];

for (const model of usedModels) {
  styles[model] = {
    get() {
      const { level } = this;
      return function (...arguments_) {
        const styler = createStyler(
          getModelAnsi(model, levelMapping[level], "color", ...arguments_),
          ansiStyles.color.close,
          this[STYLER]
        );
        return createBuilder(this, styler, this[IS_EMPTY]);
      };
    },
  };

  const bgModel = "bg" + model[0].toUpperCase() + model.slice(1);
  styles[bgModel] = {
    get() {
      const { level } = this;
      return function (...arguments_) {
        const styler = createStyler(
          getModelAnsi(model, levelMapping[level], "bgColor", ...arguments_),
          ansiStyles.bgColor.close,
          this[STYLER]
        );
        return createBuilder(this, styler, this[IS_EMPTY]);
      };
    },
  };
}

const proto = Object.defineProperties(() => {}, {
  ...styles,
  level: {
    enumerable: true,
    get() {
      return this[GENERATOR].level;
    },
    set(level) {
      this[GENERATOR].level = level;
    },
  },
});

const createStyler = (open, close, parent) => {
  let openAll;
  let closeAll;
  if (parent === undefined) {
    openAll = open;
    closeAll = close;
  } else {
    openAll = parent.openAll + open;
    closeAll = close + parent.closeAll;
  }

  return {
    open,
    close,
    openAll,
    closeAll,
    parent,
  };
};

const createBuilder = (self, _styler, _isEmpty) => {
  // Single argument is hot path, implicit coercion is faster than anything
  // eslint-disable-next-line no-implicit-coercion
  const builder = (...arguments_) =>
    applyStyle(
      builder,
      arguments_.length === 1 ? "" + arguments_[0] : arguments_.join(" ")
    );

  // We alter the prototype because we must return a function, but there is
  // no way to create a function with a different prototype
  Object.setPrototypeOf(builder, proto);

  builder[GENERATOR] = self;
  builder[STYLER] = _styler;
  builder[IS_EMPTY] = _isEmpty;

  return builder;
};

const applyStyle = (self, string) => {
  if (self.level <= 0 || !string) {
    return self[IS_EMPTY] ? "" : string;
  }

  let styler = self[STYLER];

  if (styler === undefined) {
    return string;
  }

  const { openAll, closeAll } = styler;
  if (string.includes("\u001B")) {
    while (styler !== undefined) {
      // Replace any instances already present with a re-opening code
      // otherwise only the part of the string until said closing code
      // will be colored, and the rest will simply be 'plain'.
      string = stringReplaceAll(string, styler.close, styler.open);

      styler = styler.parent;
    }
  }

  // We can move both next actions out of loop, because remaining actions in loop won't have
  // any/visible effect on parts we add here. Close the styling before a linebreak and reopen
  // after next line to fix a bleed issue on macOS: https://github.com/chalk/chalk/pull/92
  const lfIndex = string.indexOf("\n");
  if (lfIndex !== -1) {
    string = stringEncaseCRLFWithFirstIndex(string, closeAll, openAll, lfIndex);
  }

  return openAll + string + closeAll;
};

Object.defineProperties(createChalk.prototype, styles);

const chalk = createChalk();
createChalk({ level: stderrColor ? stderrColor.level : 0 });

var onetime$2 = { exports: {} };

var mimicFn$2 = { exports: {} };

const mimicFn$1 = (to, from) => {
  for (const prop of Reflect.ownKeys(from)) {
    Object.defineProperty(
      to,
      prop,
      Object.getOwnPropertyDescriptor(from, prop)
    );
  }

  return to;
};

mimicFn$2.exports = mimicFn$1;
// TODO: Remove this for the next major release
mimicFn$2.exports.default = mimicFn$1;

var mimicFnExports = mimicFn$2.exports;

const mimicFn = mimicFnExports;

const calledFunctions = new WeakMap();

const onetime = (function_, options = {}) => {
  if (typeof function_ !== "function") {
    throw new TypeError("Expected a function");
  }

  let returnValue;
  let callCount = 0;
  const functionName = function_.displayName || function_.name || "<anonymous>";

  const onetime = function (...arguments_) {
    calledFunctions.set(onetime, ++callCount);

    if (callCount === 1) {
      returnValue = function_.apply(this, arguments_);
      function_ = null;
    } else if (options.throw === true) {
      throw new Error(`Function \`${functionName}\` can only be called once`);
    }

    return returnValue;
  };

  mimicFn(onetime, function_);
  calledFunctions.set(onetime, callCount);

  return onetime;
};

onetime$2.exports = onetime;
// TODO: Remove this for the next major release
onetime$2.exports.default = onetime;

onetime$2.exports.callCount = (function_) => {
  if (!calledFunctions.has(function_)) {
    throw new Error(
      `The given function \`${function_.name}\` is not wrapped by the \`onetime\` package`
    );
  }

  return calledFunctions.get(function_);
};

var onetimeExports = onetime$2.exports;
var onetime$1 = /*@__PURE__*/ getDefaultExportFromCjs(onetimeExports);

var signalExit$1 = { exports: {} };

var signals$1 = { exports: {} };

var hasRequiredSignals;

function requireSignals() {
  if (hasRequiredSignals) return signals$1.exports;
  hasRequiredSignals = 1;
  (function (module) {
    // This is not the set of all possible signals.
    //
    // It IS, however, the set of all signals that trigger
    // an exit on either Linux or BSD systems.  Linux is a
    // superset of the signal names supported on BSD, and
    // the unknown signals just fail to register, so we can
    // catch that easily enough.
    //
    // Don't bother with SIGKILL.  It's uncatchable, which
    // means that we can't fire any callbacks anyway.
    //
    // If a user does happen to register a handler on a non-
    // fatal signal like SIGWINCH or something, and then
    // exit, it'll end up firing `process.emit('exit')`, so
    // the handler will be fired anyway.
    //
    // SIGBUS, SIGFPE, SIGSEGV and SIGILL, when not raised
    // artificially, inherently leave the process in a
    // state from which it is not safe to try and enter JS
    // listeners.
    module.exports = ["SIGABRT", "SIGALRM", "SIGHUP", "SIGINT", "SIGTERM"];

    if (process.platform !== "win32") {
      module.exports.push(
        "SIGVTALRM",
        "SIGXCPU",
        "SIGXFSZ",
        "SIGUSR2",
        "SIGTRAP",
        "SIGSYS",
        "SIGQUIT",
        "SIGIOT"
        // should detect profiler and enable/disable accordingly.
        // see #21
        // 'SIGPROF'
      );
    }

    if (process.platform === "linux") {
      module.exports.push(
        "SIGIO",
        "SIGPOLL",
        "SIGPWR",
        "SIGSTKFLT",
        "SIGUNUSED"
      );
    }
  })(signals$1);
  return signals$1.exports;
}

// Note: since nyc uses this module to output coverage, any lines
// that are in the direct sync flow of nyc's outputCoverage are
// ignored, since we can never get coverage for them.
// grab a reference to node's real process object right away
var process$1 = commonjsGlobal.process;

const processOk = function (process) {
  return (
    process &&
    typeof process === "object" &&
    typeof process.removeListener === "function" &&
    typeof process.emit === "function" &&
    typeof process.reallyExit === "function" &&
    typeof process.listeners === "function" &&
    typeof process.kill === "function" &&
    typeof process.pid === "number" &&
    typeof process.on === "function"
  );
};

// some kind of non-node environment, just no-op
/* istanbul ignore if */
if (!processOk(process$1)) {
  signalExit$1.exports = function () {
    return function () {};
  };
} else {
  var assert = require$$0$1;
  var signals = requireSignals();
  var isWin = /^win/i.test(process$1.platform);

  var EE = require$$2;
  /* istanbul ignore if */
  if (typeof EE !== "function") {
    EE = EE.EventEmitter;
  }

  var emitter;
  if (process$1.__signal_exit_emitter__) {
    emitter = process$1.__signal_exit_emitter__;
  } else {
    emitter = process$1.__signal_exit_emitter__ = new EE();
    emitter.count = 0;
    emitter.emitted = {};
  }

  // Because this emitter is a global, we have to check to see if a
  // previous version of this library failed to enable infinite listeners.
  // I know what you're about to say.  But literally everything about
  // signal-exit is a compromise with evil.  Get used to it.
  if (!emitter.infinite) {
    emitter.setMaxListeners(Infinity);
    emitter.infinite = true;
  }

  signalExit$1.exports = function (cb, opts) {
    /* istanbul ignore if */
    if (!processOk(commonjsGlobal.process)) {
      return function () {};
    }
    assert.equal(
      typeof cb,
      "function",
      "a callback must be provided for exit handler"
    );

    if (loaded === false) {
      load$1();
    }

    var ev = "exit";
    if (opts && opts.alwaysLast) {
      ev = "afterexit";
    }

    var remove = function () {
      emitter.removeListener(ev, cb);
      if (
        emitter.listeners("exit").length === 0 &&
        emitter.listeners("afterexit").length === 0
      ) {
        unload();
      }
    };
    emitter.on(ev, cb);

    return remove;
  };

  var unload = function unload() {
    if (!loaded || !processOk(commonjsGlobal.process)) {
      return;
    }
    loaded = false;

    signals.forEach(function (sig) {
      try {
        process$1.removeListener(sig, sigListeners[sig]);
      } catch (er) {}
    });
    process$1.emit = originalProcessEmit;
    process$1.reallyExit = originalProcessReallyExit;
    emitter.count -= 1;
  };
  signalExit$1.exports.unload = unload;

  var emit = function emit(event, code, signal) {
    /* istanbul ignore if */
    if (emitter.emitted[event]) {
      return;
    }
    emitter.emitted[event] = true;
    emitter.emit(event, code, signal);
  };

  // { <signal>: <listener fn>, ... }
  var sigListeners = {};
  signals.forEach(function (sig) {
    sigListeners[sig] = function listener() {
      /* istanbul ignore if */
      if (!processOk(commonjsGlobal.process)) {
        return;
      }
      // If there are no other listeners, an exit is coming!
      // Simplest way: remove us and then re-send the signal.
      // We know that this will kill the process, so we can
      // safely emit now.
      var listeners = process$1.listeners(sig);
      if (listeners.length === emitter.count) {
        unload();
        emit("exit", null, sig);
        /* istanbul ignore next */
        emit("afterexit", null, sig);
        /* istanbul ignore next */
        if (isWin && sig === "SIGHUP") {
          // "SIGHUP" throws an `ENOSYS` error on Windows,
          // so use a supported signal instead
          sig = "SIGINT";
        }
        /* istanbul ignore next */
        process$1.kill(process$1.pid, sig);
      }
    };
  });

  signalExit$1.exports.signals = function () {
    return signals;
  };

  var loaded = false;

  var load$1 = function load() {
    if (loaded || !processOk(commonjsGlobal.process)) {
      return;
    }
    loaded = true;

    // This is the number of onSignalExit's that are in play.
    // It's important so that we can count the correct number of
    // listeners on signals, and don't wait for the other one to
    // handle it instead of us.
    emitter.count += 1;

    signals = signals.filter(function (sig) {
      try {
        process$1.on(sig, sigListeners[sig]);
        return true;
      } catch (er) {
        return false;
      }
    });

    process$1.emit = processEmit;
    process$1.reallyExit = processReallyExit;
  };
  signalExit$1.exports.load = load$1;

  var originalProcessReallyExit = process$1.reallyExit;
  var processReallyExit = function processReallyExit(code) {
    /* istanbul ignore if */
    if (!processOk(commonjsGlobal.process)) {
      return;
    }
    process$1.exitCode = code || /* istanbul ignore next */ 0;
    emit("exit", process$1.exitCode, null);
    /* istanbul ignore next */
    emit("afterexit", process$1.exitCode, null);
    /* istanbul ignore next */
    originalProcessReallyExit.call(process$1, process$1.exitCode);
  };

  var originalProcessEmit = process$1.emit;
  var processEmit = function processEmit(ev, arg) {
    if (ev === "exit" && processOk(commonjsGlobal.process)) {
      /* istanbul ignore else */
      if (arg !== undefined) {
        process$1.exitCode = arg;
      }
      var ret = originalProcessEmit.apply(this, arguments);
      /* istanbul ignore next */
      emit("exit", process$1.exitCode, null);
      /* istanbul ignore next */
      emit("afterexit", process$1.exitCode, null);
      /* istanbul ignore next */
      return ret;
    } else {
      return originalProcessEmit.apply(this, arguments);
    }
  };
}

var signalExitExports = signalExit$1.exports;
var signalExit = /*@__PURE__*/ getDefaultExportFromCjs(signalExitExports);

const restoreCursor = onetime$1(() => {
  signalExit(
    () => {
      process$2.stderr.write("\u001B[?25h");
    },
    { alwaysLast: true }
  );
});

let isHidden = false;

const cliCursor = {};

cliCursor.show = (writableStream = process$2.stderr) => {
  if (!writableStream.isTTY) {
    return;
  }

  isHidden = false;
  writableStream.write("\u001B[?25h");
};

cliCursor.hide = (writableStream = process$2.stderr) => {
  if (!writableStream.isTTY) {
    return;
  }

  restoreCursor();
  isHidden = true;
  writableStream.write("\u001B[?25l");
};

cliCursor.toggle = (force, writableStream) => {
  if (force !== undefined) {
    isHidden = force;
  }

  if (isHidden) {
    cliCursor.show(writableStream);
  } else {
    cliCursor.hide(writableStream);
  }
};

var dots = {
  interval: 80,
  frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
};
var dots2 = {
  interval: 80,
  frames: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
};
var dots3 = {
  interval: 80,
  frames: ["⠋", "⠙", "⠚", "⠞", "⠖", "⠦", "⠴", "⠲", "⠳", "⠓"],
};
var dots4 = {
  interval: 80,
  frames: [
    "⠄",
    "⠆",
    "⠇",
    "⠋",
    "⠙",
    "⠸",
    "⠰",
    "⠠",
    "⠰",
    "⠸",
    "⠙",
    "⠋",
    "⠇",
    "⠆",
  ],
};
var dots5 = {
  interval: 80,
  frames: [
    "⠋",
    "⠙",
    "⠚",
    "⠒",
    "⠂",
    "⠂",
    "⠒",
    "⠲",
    "⠴",
    "⠦",
    "⠖",
    "⠒",
    "⠐",
    "⠐",
    "⠒",
    "⠓",
    "⠋",
  ],
};
var dots6 = {
  interval: 80,
  frames: [
    "⠁",
    "⠉",
    "⠙",
    "⠚",
    "⠒",
    "⠂",
    "⠂",
    "⠒",
    "⠲",
    "⠴",
    "⠤",
    "⠄",
    "⠄",
    "⠤",
    "⠴",
    "⠲",
    "⠒",
    "⠂",
    "⠂",
    "⠒",
    "⠚",
    "⠙",
    "⠉",
    "⠁",
  ],
};
var dots7 = {
  interval: 80,
  frames: [
    "⠈",
    "⠉",
    "⠋",
    "⠓",
    "⠒",
    "⠐",
    "⠐",
    "⠒",
    "⠖",
    "⠦",
    "⠤",
    "⠠",
    "⠠",
    "⠤",
    "⠦",
    "⠖",
    "⠒",
    "⠐",
    "⠐",
    "⠒",
    "⠓",
    "⠋",
    "⠉",
    "⠈",
  ],
};
var dots8 = {
  interval: 80,
  frames: [
    "⠁",
    "⠁",
    "⠉",
    "⠙",
    "⠚",
    "⠒",
    "⠂",
    "⠂",
    "⠒",
    "⠲",
    "⠴",
    "⠤",
    "⠄",
    "⠄",
    "⠤",
    "⠠",
    "⠠",
    "⠤",
    "⠦",
    "⠖",
    "⠒",
    "⠐",
    "⠐",
    "⠒",
    "⠓",
    "⠋",
    "⠉",
    "⠈",
    "⠈",
  ],
};
var dots9 = {
  interval: 80,
  frames: ["⢹", "⢺", "⢼", "⣸", "⣇", "⡧", "⡗", "⡏"],
};
var dots10 = {
  interval: 80,
  frames: ["⢄", "⢂", "⢁", "⡁", "⡈", "⡐", "⡠"],
};
var dots11 = {
  interval: 100,
  frames: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"],
};
var dots12 = {
  interval: 80,
  frames: [
    "⢀⠀",
    "⡀⠀",
    "⠄⠀",
    "⢂⠀",
    "⡂⠀",
    "⠅⠀",
    "⢃⠀",
    "⡃⠀",
    "⠍⠀",
    "⢋⠀",
    "⡋⠀",
    "⠍⠁",
    "⢋⠁",
    "⡋⠁",
    "⠍⠉",
    "⠋⠉",
    "⠋⠉",
    "⠉⠙",
    "⠉⠙",
    "⠉⠩",
    "⠈⢙",
    "⠈⡙",
    "⢈⠩",
    "⡀⢙",
    "⠄⡙",
    "⢂⠩",
    "⡂⢘",
    "⠅⡘",
    "⢃⠨",
    "⡃⢐",
    "⠍⡐",
    "⢋⠠",
    "⡋⢀",
    "⠍⡁",
    "⢋⠁",
    "⡋⠁",
    "⠍⠉",
    "⠋⠉",
    "⠋⠉",
    "⠉⠙",
    "⠉⠙",
    "⠉⠩",
    "⠈⢙",
    "⠈⡙",
    "⠈⠩",
    "⠀⢙",
    "⠀⡙",
    "⠀⠩",
    "⠀⢘",
    "⠀⡘",
    "⠀⠨",
    "⠀⢐",
    "⠀⡐",
    "⠀⠠",
    "⠀⢀",
    "⠀⡀",
  ],
};
var dots13 = {
  interval: 80,
  frames: ["⣼", "⣹", "⢻", "⠿", "⡟", "⣏", "⣧", "⣶"],
};
var dots8Bit = {
  interval: 80,
  frames: [
    "⠀",
    "⠁",
    "⠂",
    "⠃",
    "⠄",
    "⠅",
    "⠆",
    "⠇",
    "⡀",
    "⡁",
    "⡂",
    "⡃",
    "⡄",
    "⡅",
    "⡆",
    "⡇",
    "⠈",
    "⠉",
    "⠊",
    "⠋",
    "⠌",
    "⠍",
    "⠎",
    "⠏",
    "⡈",
    "⡉",
    "⡊",
    "⡋",
    "⡌",
    "⡍",
    "⡎",
    "⡏",
    "⠐",
    "⠑",
    "⠒",
    "⠓",
    "⠔",
    "⠕",
    "⠖",
    "⠗",
    "⡐",
    "⡑",
    "⡒",
    "⡓",
    "⡔",
    "⡕",
    "⡖",
    "⡗",
    "⠘",
    "⠙",
    "⠚",
    "⠛",
    "⠜",
    "⠝",
    "⠞",
    "⠟",
    "⡘",
    "⡙",
    "⡚",
    "⡛",
    "⡜",
    "⡝",
    "⡞",
    "⡟",
    "⠠",
    "⠡",
    "⠢",
    "⠣",
    "⠤",
    "⠥",
    "⠦",
    "⠧",
    "⡠",
    "⡡",
    "⡢",
    "⡣",
    "⡤",
    "⡥",
    "⡦",
    "⡧",
    "⠨",
    "⠩",
    "⠪",
    "⠫",
    "⠬",
    "⠭",
    "⠮",
    "⠯",
    "⡨",
    "⡩",
    "⡪",
    "⡫",
    "⡬",
    "⡭",
    "⡮",
    "⡯",
    "⠰",
    "⠱",
    "⠲",
    "⠳",
    "⠴",
    "⠵",
    "⠶",
    "⠷",
    "⡰",
    "⡱",
    "⡲",
    "⡳",
    "⡴",
    "⡵",
    "⡶",
    "⡷",
    "⠸",
    "⠹",
    "⠺",
    "⠻",
    "⠼",
    "⠽",
    "⠾",
    "⠿",
    "⡸",
    "⡹",
    "⡺",
    "⡻",
    "⡼",
    "⡽",
    "⡾",
    "⡿",
    "⢀",
    "⢁",
    "⢂",
    "⢃",
    "⢄",
    "⢅",
    "⢆",
    "⢇",
    "⣀",
    "⣁",
    "⣂",
    "⣃",
    "⣄",
    "⣅",
    "⣆",
    "⣇",
    "⢈",
    "⢉",
    "⢊",
    "⢋",
    "⢌",
    "⢍",
    "⢎",
    "⢏",
    "⣈",
    "⣉",
    "⣊",
    "⣋",
    "⣌",
    "⣍",
    "⣎",
    "⣏",
    "⢐",
    "⢑",
    "⢒",
    "⢓",
    "⢔",
    "⢕",
    "⢖",
    "⢗",
    "⣐",
    "⣑",
    "⣒",
    "⣓",
    "⣔",
    "⣕",
    "⣖",
    "⣗",
    "⢘",
    "⢙",
    "⢚",
    "⢛",
    "⢜",
    "⢝",
    "⢞",
    "⢟",
    "⣘",
    "⣙",
    "⣚",
    "⣛",
    "⣜",
    "⣝",
    "⣞",
    "⣟",
    "⢠",
    "⢡",
    "⢢",
    "⢣",
    "⢤",
    "⢥",
    "⢦",
    "⢧",
    "⣠",
    "⣡",
    "⣢",
    "⣣",
    "⣤",
    "⣥",
    "⣦",
    "⣧",
    "⢨",
    "⢩",
    "⢪",
    "⢫",
    "⢬",
    "⢭",
    "⢮",
    "⢯",
    "⣨",
    "⣩",
    "⣪",
    "⣫",
    "⣬",
    "⣭",
    "⣮",
    "⣯",
    "⢰",
    "⢱",
    "⢲",
    "⢳",
    "⢴",
    "⢵",
    "⢶",
    "⢷",
    "⣰",
    "⣱",
    "⣲",
    "⣳",
    "⣴",
    "⣵",
    "⣶",
    "⣷",
    "⢸",
    "⢹",
    "⢺",
    "⢻",
    "⢼",
    "⢽",
    "⢾",
    "⢿",
    "⣸",
    "⣹",
    "⣺",
    "⣻",
    "⣼",
    "⣽",
    "⣾",
    "⣿",
  ],
};
var sand = {
  interval: 80,
  frames: [
    "⠁",
    "⠂",
    "⠄",
    "⡀",
    "⡈",
    "⡐",
    "⡠",
    "⣀",
    "⣁",
    "⣂",
    "⣄",
    "⣌",
    "⣔",
    "⣤",
    "⣥",
    "⣦",
    "⣮",
    "⣶",
    "⣷",
    "⣿",
    "⡿",
    "⠿",
    "⢟",
    "⠟",
    "⡛",
    "⠛",
    "⠫",
    "⢋",
    "⠋",
    "⠍",
    "⡉",
    "⠉",
    "⠑",
    "⠡",
    "⢁",
  ],
};
var line = {
  interval: 130,
  frames: ["-", "\\", "|", "/"],
};
var line2 = {
  interval: 100,
  frames: ["⠂", "-", "–", "—", "–", "-"],
};
var pipe = {
  interval: 100,
  frames: ["┤", "┘", "┴", "└", "├", "┌", "┬", "┐"],
};
var simpleDots = {
  interval: 400,
  frames: [".  ", ".. ", "...", "   "],
};
var simpleDotsScrolling = {
  interval: 200,
  frames: [".  ", ".. ", "...", " ..", "  .", "   "],
};
var star = {
  interval: 70,
  frames: ["✶", "✸", "✹", "✺", "✹", "✷"],
};
var star2 = {
  interval: 80,
  frames: ["+", "x", "*"],
};
var flip = {
  interval: 70,
  frames: ["_", "_", "_", "-", "`", "`", "'", "´", "-", "_", "_", "_"],
};
var hamburger = {
  interval: 100,
  frames: ["☱", "☲", "☴"],
};
var growVertical = {
  interval: 120,
  frames: ["▁", "▃", "▄", "▅", "▆", "▇", "▆", "▅", "▄", "▃"],
};
var growHorizontal = {
  interval: 120,
  frames: ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "▊", "▋", "▌", "▍", "▎"],
};
var balloon = {
  interval: 140,
  frames: [" ", ".", "o", "O", "@", "*", " "],
};
var balloon2 = {
  interval: 120,
  frames: [".", "o", "O", "°", "O", "o", "."],
};
var noise = {
  interval: 100,
  frames: ["▓", "▒", "░"],
};
var bounce = {
  interval: 120,
  frames: ["⠁", "⠂", "⠄", "⠂"],
};
var boxBounce = {
  interval: 120,
  frames: ["▖", "▘", "▝", "▗"],
};
var boxBounce2 = {
  interval: 100,
  frames: ["▌", "▀", "▐", "▄"],
};
var triangle = {
  interval: 50,
  frames: ["◢", "◣", "◤", "◥"],
};
var binary = {
  interval: 80,
  frames: [
    "010010",
    "001100",
    "100101",
    "111010",
    "111101",
    "010111",
    "101011",
    "111000",
    "110011",
    "110101",
  ],
};
var arc = {
  interval: 100,
  frames: ["◜", "◠", "◝", "◞", "◡", "◟"],
};
var circle = {
  interval: 120,
  frames: ["◡", "⊙", "◠"],
};
var squareCorners = {
  interval: 180,
  frames: ["◰", "◳", "◲", "◱"],
};
var circleQuarters = {
  interval: 120,
  frames: ["◴", "◷", "◶", "◵"],
};
var circleHalves = {
  interval: 50,
  frames: ["◐", "◓", "◑", "◒"],
};
var squish = {
  interval: 100,
  frames: ["╫", "╪"],
};
var toggle = {
  interval: 250,
  frames: ["⊶", "⊷"],
};
var toggle2 = {
  interval: 80,
  frames: ["▫", "▪"],
};
var toggle3 = {
  interval: 120,
  frames: ["□", "■"],
};
var toggle4 = {
  interval: 100,
  frames: ["■", "□", "▪", "▫"],
};
var toggle5 = {
  interval: 100,
  frames: ["▮", "▯"],
};
var toggle6 = {
  interval: 300,
  frames: ["ဝ", "၀"],
};
var toggle7 = {
  interval: 80,
  frames: ["⦾", "⦿"],
};
var toggle8 = {
  interval: 100,
  frames: ["◍", "◌"],
};
var toggle9 = {
  interval: 100,
  frames: ["◉", "◎"],
};
var toggle10 = {
  interval: 100,
  frames: ["㊂", "㊀", "㊁"],
};
var toggle11 = {
  interval: 50,
  frames: ["⧇", "⧆"],
};
var toggle12 = {
  interval: 120,
  frames: ["☗", "☖"],
};
var toggle13 = {
  interval: 80,
  frames: ["=", "*", "-"],
};
var arrow = {
  interval: 100,
  frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
};
var arrow2 = {
  interval: 80,
  frames: ["⬆️ ", "↗️ ", "➡️ ", "↘️ ", "⬇️ ", "↙️ ", "⬅️ ", "↖️ "],
};
var arrow3 = {
  interval: 120,
  frames: ["▹▹▹▹▹", "▸▹▹▹▹", "▹▸▹▹▹", "▹▹▸▹▹", "▹▹▹▸▹", "▹▹▹▹▸"],
};
var bouncingBar = {
  interval: 80,
  frames: [
    "[    ]",
    "[=   ]",
    "[==  ]",
    "[=== ]",
    "[====]",
    "[ ===]",
    "[  ==]",
    "[   =]",
    "[    ]",
    "[   =]",
    "[  ==]",
    "[ ===]",
    "[====]",
    "[=== ]",
    "[==  ]",
    "[=   ]",
  ],
};
var bouncingBall = {
  interval: 80,
  frames: [
    "( ●    )",
    "(  ●   )",
    "(   ●  )",
    "(    ● )",
    "(     ●)",
    "(    ● )",
    "(   ●  )",
    "(  ●   )",
    "( ●    )",
    "(●     )",
  ],
};
var smiley = {
  interval: 200,
  frames: ["😄 ", "😝 "],
};
var monkey = {
  interval: 300,
  frames: ["🙈 ", "🙈 ", "🙉 ", "🙊 "],
};
var hearts = {
  interval: 100,
  frames: ["💛 ", "💙 ", "💜 ", "💚 ", "❤️ "],
};
var clock = {
  interval: 100,
  frames: [
    "🕛 ",
    "🕐 ",
    "🕑 ",
    "🕒 ",
    "🕓 ",
    "🕔 ",
    "🕕 ",
    "🕖 ",
    "🕗 ",
    "🕘 ",
    "🕙 ",
    "🕚 ",
  ],
};
var earth = {
  interval: 180,
  frames: ["🌍 ", "🌎 ", "🌏 "],
};
var material = {
  interval: 17,
  frames: [
    "█▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁",
    "██▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁",
    "███▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁",
    "████▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁",
    "██████▁▁▁▁▁▁▁▁▁▁▁▁▁▁",
    "██████▁▁▁▁▁▁▁▁▁▁▁▁▁▁",
    "███████▁▁▁▁▁▁▁▁▁▁▁▁▁",
    "████████▁▁▁▁▁▁▁▁▁▁▁▁",
    "█████████▁▁▁▁▁▁▁▁▁▁▁",
    "█████████▁▁▁▁▁▁▁▁▁▁▁",
    "██████████▁▁▁▁▁▁▁▁▁▁",
    "███████████▁▁▁▁▁▁▁▁▁",
    "█████████████▁▁▁▁▁▁▁",
    "██████████████▁▁▁▁▁▁",
    "██████████████▁▁▁▁▁▁",
    "▁██████████████▁▁▁▁▁",
    "▁██████████████▁▁▁▁▁",
    "▁██████████████▁▁▁▁▁",
    "▁▁██████████████▁▁▁▁",
    "▁▁▁██████████████▁▁▁",
    "▁▁▁▁█████████████▁▁▁",
    "▁▁▁▁██████████████▁▁",
    "▁▁▁▁██████████████▁▁",
    "▁▁▁▁▁██████████████▁",
    "▁▁▁▁▁██████████████▁",
    "▁▁▁▁▁██████████████▁",
    "▁▁▁▁▁▁██████████████",
    "▁▁▁▁▁▁██████████████",
    "▁▁▁▁▁▁▁█████████████",
    "▁▁▁▁▁▁▁█████████████",
    "▁▁▁▁▁▁▁▁████████████",
    "▁▁▁▁▁▁▁▁████████████",
    "▁▁▁▁▁▁▁▁▁███████████",
    "▁▁▁▁▁▁▁▁▁███████████",
    "▁▁▁▁▁▁▁▁▁▁██████████",
    "▁▁▁▁▁▁▁▁▁▁██████████",
    "▁▁▁▁▁▁▁▁▁▁▁▁████████",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁███████",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁██████",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁█████",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁█████",
    "█▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁████",
    "██▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁███",
    "██▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁███",
    "███▁▁▁▁▁▁▁▁▁▁▁▁▁▁███",
    "████▁▁▁▁▁▁▁▁▁▁▁▁▁▁██",
    "█████▁▁▁▁▁▁▁▁▁▁▁▁▁▁█",
    "█████▁▁▁▁▁▁▁▁▁▁▁▁▁▁█",
    "██████▁▁▁▁▁▁▁▁▁▁▁▁▁█",
    "████████▁▁▁▁▁▁▁▁▁▁▁▁",
    "█████████▁▁▁▁▁▁▁▁▁▁▁",
    "█████████▁▁▁▁▁▁▁▁▁▁▁",
    "█████████▁▁▁▁▁▁▁▁▁▁▁",
    "█████████▁▁▁▁▁▁▁▁▁▁▁",
    "███████████▁▁▁▁▁▁▁▁▁",
    "████████████▁▁▁▁▁▁▁▁",
    "████████████▁▁▁▁▁▁▁▁",
    "██████████████▁▁▁▁▁▁",
    "██████████████▁▁▁▁▁▁",
    "▁██████████████▁▁▁▁▁",
    "▁██████████████▁▁▁▁▁",
    "▁▁▁█████████████▁▁▁▁",
    "▁▁▁▁▁████████████▁▁▁",
    "▁▁▁▁▁████████████▁▁▁",
    "▁▁▁▁▁▁███████████▁▁▁",
    "▁▁▁▁▁▁▁▁█████████▁▁▁",
    "▁▁▁▁▁▁▁▁█████████▁▁▁",
    "▁▁▁▁▁▁▁▁▁█████████▁▁",
    "▁▁▁▁▁▁▁▁▁█████████▁▁",
    "▁▁▁▁▁▁▁▁▁▁█████████▁",
    "▁▁▁▁▁▁▁▁▁▁▁████████▁",
    "▁▁▁▁▁▁▁▁▁▁▁████████▁",
    "▁▁▁▁▁▁▁▁▁▁▁▁███████▁",
    "▁▁▁▁▁▁▁▁▁▁▁▁███████▁",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁███████",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁███████",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁█████",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁████",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁████",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁████",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁███",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁███",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁██",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁██",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁██",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁█",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁█",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁█",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁",
    "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁",
  ],
};
var moon = {
  interval: 80,
  frames: ["🌑 ", "🌒 ", "🌓 ", "🌔 ", "🌕 ", "🌖 ", "🌗 ", "🌘 "],
};
var runner = {
  interval: 140,
  frames: ["🚶 ", "🏃 "],
};
var pong = {
  interval: 80,
  frames: [
    "▐⠂       ▌",
    "▐⠈       ▌",
    "▐ ⠂      ▌",
    "▐ ⠠      ▌",
    "▐  ⡀     ▌",
    "▐  ⠠     ▌",
    "▐   ⠂    ▌",
    "▐   ⠈    ▌",
    "▐    ⠂   ▌",
    "▐    ⠠   ▌",
    "▐     ⡀  ▌",
    "▐     ⠠  ▌",
    "▐      ⠂ ▌",
    "▐      ⠈ ▌",
    "▐       ⠂▌",
    "▐       ⠠▌",
    "▐       ⡀▌",
    "▐      ⠠ ▌",
    "▐      ⠂ ▌",
    "▐     ⠈  ▌",
    "▐     ⠂  ▌",
    "▐    ⠠   ▌",
    "▐    ⡀   ▌",
    "▐   ⠠    ▌",
    "▐   ⠂    ▌",
    "▐  ⠈     ▌",
    "▐  ⠂     ▌",
    "▐ ⠠      ▌",
    "▐ ⡀      ▌",
    "▐⠠       ▌",
  ],
};
var shark = {
  interval: 120,
  frames: [
    "▐|\\____________▌",
    "▐_|\\___________▌",
    "▐__|\\__________▌",
    "▐___|\\_________▌",
    "▐____|\\________▌",
    "▐_____|\\_______▌",
    "▐______|\\______▌",
    "▐_______|\\_____▌",
    "▐________|\\____▌",
    "▐_________|\\___▌",
    "▐__________|\\__▌",
    "▐___________|\\_▌",
    "▐____________|\\▌",
    "▐____________/|▌",
    "▐___________/|_▌",
    "▐__________/|__▌",
    "▐_________/|___▌",
    "▐________/|____▌",
    "▐_______/|_____▌",
    "▐______/|______▌",
    "▐_____/|_______▌",
    "▐____/|________▌",
    "▐___/|_________▌",
    "▐__/|__________▌",
    "▐_/|___________▌",
    "▐/|____________▌",
  ],
};
var dqpb = {
  interval: 100,
  frames: ["d", "q", "p", "b"],
};
var weather = {
  interval: 100,
  frames: [
    "☀️ ",
    "☀️ ",
    "☀️ ",
    "🌤 ",
    "⛅️ ",
    "🌥 ",
    "☁️ ",
    "🌧 ",
    "🌨 ",
    "🌧 ",
    "🌨 ",
    "🌧 ",
    "🌨 ",
    "⛈ ",
    "🌨 ",
    "🌧 ",
    "🌨 ",
    "☁️ ",
    "🌥 ",
    "⛅️ ",
    "🌤 ",
    "☀️ ",
    "☀️ ",
  ],
};
var christmas = {
  interval: 400,
  frames: ["🌲", "🎄"],
};
var grenade = {
  interval: 80,
  frames: [
    "،  ",
    "′  ",
    " ´ ",
    " ‾ ",
    "  ⸌",
    "  ⸊",
    "  |",
    "  ⁎",
    "  ⁕",
    " ෴ ",
    "  ⁓",
    "   ",
    "   ",
    "   ",
  ],
};
var point = {
  interval: 125,
  frames: ["∙∙∙", "●∙∙", "∙●∙", "∙∙●", "∙∙∙"],
};
var layer = {
  interval: 150,
  frames: ["-", "=", "≡"],
};
var betaWave = {
  interval: 80,
  frames: [
    "ρββββββ",
    "βρβββββ",
    "ββρββββ",
    "βββρβββ",
    "ββββρββ",
    "βββββρβ",
    "ββββββρ",
  ],
};
var fingerDance = {
  interval: 160,
  frames: ["🤘 ", "🤟 ", "🖖 ", "✋ ", "🤚 ", "👆 "],
};
var fistBump = {
  interval: 80,
  frames: [
    "🤜　　　　🤛 ",
    "🤜　　　　🤛 ",
    "🤜　　　　🤛 ",
    "　🤜　　🤛　 ",
    "　　🤜🤛　　 ",
    "　🤜✨🤛　　 ",
    "🤜　✨　🤛　 ",
  ],
};
var soccerHeader = {
  interval: 80,
  frames: [
    " 🧑⚽️       🧑 ",
    "🧑  ⚽️      🧑 ",
    "🧑   ⚽️     🧑 ",
    "🧑    ⚽️    🧑 ",
    "🧑     ⚽️   🧑 ",
    "🧑      ⚽️  🧑 ",
    "🧑       ⚽️🧑  ",
    "🧑      ⚽️  🧑 ",
    "🧑     ⚽️   🧑 ",
    "🧑    ⚽️    🧑 ",
    "🧑   ⚽️     🧑 ",
    "🧑  ⚽️      🧑 ",
  ],
};
var mindblown = {
  interval: 160,
  frames: [
    "😐 ",
    "😐 ",
    "😮 ",
    "😮 ",
    "😦 ",
    "😦 ",
    "😧 ",
    "😧 ",
    "🤯 ",
    "💥 ",
    "✨ ",
    "　 ",
    "　 ",
    "　 ",
  ],
};
var speaker = {
  interval: 160,
  frames: ["🔈 ", "🔉 ", "🔊 ", "🔉 "],
};
var orangePulse = {
  interval: 100,
  frames: ["🔸 ", "🔶 ", "🟠 ", "🟠 ", "🔶 "],
};
var bluePulse = {
  interval: 100,
  frames: ["🔹 ", "🔷 ", "🔵 ", "🔵 ", "🔷 "],
};
var orangeBluePulse = {
  interval: 100,
  frames: [
    "🔸 ",
    "🔶 ",
    "🟠 ",
    "🟠 ",
    "🔶 ",
    "🔹 ",
    "🔷 ",
    "🔵 ",
    "🔵 ",
    "🔷 ",
  ],
};
var timeTravel = {
  interval: 100,
  frames: [
    "🕛 ",
    "🕚 ",
    "🕙 ",
    "🕘 ",
    "🕗 ",
    "🕖 ",
    "🕕 ",
    "🕔 ",
    "🕓 ",
    "🕒 ",
    "🕑 ",
    "🕐 ",
  ],
};
var aesthetic = {
  interval: 80,
  frames: [
    "▰▱▱▱▱▱▱",
    "▰▰▱▱▱▱▱",
    "▰▰▰▱▱▱▱",
    "▰▰▰▰▱▱▱",
    "▰▰▰▰▰▱▱",
    "▰▰▰▰▰▰▱",
    "▰▰▰▰▰▰▰",
    "▰▱▱▱▱▱▱",
  ],
};
var dwarfFortress = {
  interval: 80,
  frames: [
    " ██████£££  ",
    "☺██████£££  ",
    "☺██████£££  ",
    "☺▓█████£££  ",
    "☺▓█████£££  ",
    "☺▒█████£££  ",
    "☺▒█████£££  ",
    "☺░█████£££  ",
    "☺░█████£££  ",
    "☺ █████£££  ",
    " ☺█████£££  ",
    " ☺█████£££  ",
    " ☺▓████£££  ",
    " ☺▓████£££  ",
    " ☺▒████£££  ",
    " ☺▒████£££  ",
    " ☺░████£££  ",
    " ☺░████£££  ",
    " ☺ ████£££  ",
    "  ☺████£££  ",
    "  ☺████£££  ",
    "  ☺▓███£££  ",
    "  ☺▓███£££  ",
    "  ☺▒███£££  ",
    "  ☺▒███£££  ",
    "  ☺░███£££  ",
    "  ☺░███£££  ",
    "  ☺ ███£££  ",
    "   ☺███£££  ",
    "   ☺███£££  ",
    "   ☺▓██£££  ",
    "   ☺▓██£££  ",
    "   ☺▒██£££  ",
    "   ☺▒██£££  ",
    "   ☺░██£££  ",
    "   ☺░██£££  ",
    "   ☺ ██£££  ",
    "    ☺██£££  ",
    "    ☺██£££  ",
    "    ☺▓█£££  ",
    "    ☺▓█£££  ",
    "    ☺▒█£££  ",
    "    ☺▒█£££  ",
    "    ☺░█£££  ",
    "    ☺░█£££  ",
    "    ☺ █£££  ",
    "     ☺█£££  ",
    "     ☺█£££  ",
    "     ☺▓£££  ",
    "     ☺▓£££  ",
    "     ☺▒£££  ",
    "     ☺▒£££  ",
    "     ☺░£££  ",
    "     ☺░£££  ",
    "     ☺ £££  ",
    "      ☺£££  ",
    "      ☺£££  ",
    "      ☺▓££  ",
    "      ☺▓££  ",
    "      ☺▒££  ",
    "      ☺▒££  ",
    "      ☺░££  ",
    "      ☺░££  ",
    "      ☺ ££  ",
    "       ☺££  ",
    "       ☺££  ",
    "       ☺▓£  ",
    "       ☺▓£  ",
    "       ☺▒£  ",
    "       ☺▒£  ",
    "       ☺░£  ",
    "       ☺░£  ",
    "       ☺ £  ",
    "        ☺£  ",
    "        ☺£  ",
    "        ☺▓  ",
    "        ☺▓  ",
    "        ☺▒  ",
    "        ☺▒  ",
    "        ☺░  ",
    "        ☺░  ",
    "        ☺   ",
    "        ☺  &",
    "        ☺ ☼&",
    "       ☺ ☼ &",
    "       ☺☼  &",
    "      ☺☼  & ",
    "      ‼   & ",
    "     ☺   &  ",
    "    ‼    &  ",
    "   ☺    &   ",
    "  ‼     &   ",
    " ☺     &    ",
    "‼      &    ",
    "      &     ",
    "      &     ",
    "     &   ░  ",
    "     &   ▒  ",
    "    &    ▓  ",
    "    &    £  ",
    "   &    ░£  ",
    "   &    ▒£  ",
    "  &     ▓£  ",
    "  &     ££  ",
    " &     ░££  ",
    " &     ▒££  ",
    "&      ▓££  ",
    "&      £££  ",
    "      ░£££  ",
    "      ▒£££  ",
    "      ▓£££  ",
    "      █£££  ",
    "     ░█£££  ",
    "     ▒█£££  ",
    "     ▓█£££  ",
    "     ██£££  ",
    "    ░██£££  ",
    "    ▒██£££  ",
    "    ▓██£££  ",
    "    ███£££  ",
    "   ░███£££  ",
    "   ▒███£££  ",
    "   ▓███£££  ",
    "   ████£££  ",
    "  ░████£££  ",
    "  ▒████£££  ",
    "  ▓████£££  ",
    "  █████£££  ",
    " ░█████£££  ",
    " ▒█████£££  ",
    " ▓█████£££  ",
    " ██████£££  ",
    " ██████£££  ",
  ],
};
var require$$0 = {
  dots: dots,
  dots2: dots2,
  dots3: dots3,
  dots4: dots4,
  dots5: dots5,
  dots6: dots6,
  dots7: dots7,
  dots8: dots8,
  dots9: dots9,
  dots10: dots10,
  dots11: dots11,
  dots12: dots12,
  dots13: dots13,
  dots8Bit: dots8Bit,
  sand: sand,
  line: line,
  line2: line2,
  pipe: pipe,
  simpleDots: simpleDots,
  simpleDotsScrolling: simpleDotsScrolling,
  star: star,
  star2: star2,
  flip: flip,
  hamburger: hamburger,
  growVertical: growVertical,
  growHorizontal: growHorizontal,
  balloon: balloon,
  balloon2: balloon2,
  noise: noise,
  bounce: bounce,
  boxBounce: boxBounce,
  boxBounce2: boxBounce2,
  triangle: triangle,
  binary: binary,
  arc: arc,
  circle: circle,
  squareCorners: squareCorners,
  circleQuarters: circleQuarters,
  circleHalves: circleHalves,
  squish: squish,
  toggle: toggle,
  toggle2: toggle2,
  toggle3: toggle3,
  toggle4: toggle4,
  toggle5: toggle5,
  toggle6: toggle6,
  toggle7: toggle7,
  toggle8: toggle8,
  toggle9: toggle9,
  toggle10: toggle10,
  toggle11: toggle11,
  toggle12: toggle12,
  toggle13: toggle13,
  arrow: arrow,
  arrow2: arrow2,
  arrow3: arrow3,
  bouncingBar: bouncingBar,
  bouncingBall: bouncingBall,
  smiley: smiley,
  monkey: monkey,
  hearts: hearts,
  clock: clock,
  earth: earth,
  material: material,
  moon: moon,
  runner: runner,
  pong: pong,
  shark: shark,
  dqpb: dqpb,
  weather: weather,
  christmas: christmas,
  grenade: grenade,
  point: point,
  layer: layer,
  betaWave: betaWave,
  fingerDance: fingerDance,
  fistBump: fistBump,
  soccerHeader: soccerHeader,
  mindblown: mindblown,
  speaker: speaker,
  orangePulse: orangePulse,
  bluePulse: bluePulse,
  orangeBluePulse: orangeBluePulse,
  timeTravel: timeTravel,
  aesthetic: aesthetic,
  dwarfFortress: dwarfFortress,
};

const spinners = Object.assign({}, require$$0); // eslint-disable-line import/extensions

const spinnersList = Object.keys(spinners);

Object.defineProperty(spinners, "random", {
  get() {
    const randomIndex = Math.floor(Math.random() * spinnersList.length);
    const spinnerName = spinnersList[randomIndex];
    return spinners[spinnerName];
  },
});

var cliSpinners = spinners;

var cliSpinners$1 = /*@__PURE__*/ getDefaultExportFromCjs(cliSpinners);

const logSymbols = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "❌️",
};

function ansiRegex({ onlyFirst = false } = {}) {
  const pattern = [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))",
  ].join("|");

  return new RegExp(pattern, onlyFirst ? undefined : "g");
}

const regex = ansiRegex();

function stripAnsi(string) {
  if (typeof string !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
  }

  // Even though the regex is global, we don't need to reset the `.lastIndex`
  // because unlike `.exec()` and `.test()`, `.replace()` does it automatically
  // and doing it manually has a performance penalty.
  return string.replace(regex, "");
}

var eastasianwidth = { exports: {} };

(function (module) {
  var eaw = {};

  {
    module.exports = eaw;
  }

  eaw.eastAsianWidth = function (character) {
    var x = character.charCodeAt(0);
    var y = character.length == 2 ? character.charCodeAt(1) : 0;
    var codePoint = x;
    if (0xd800 <= x && x <= 0xdbff && 0xdc00 <= y && y <= 0xdfff) {
      x &= 0x3ff;
      y &= 0x3ff;
      codePoint = (x << 10) | y;
      codePoint += 0x10000;
    }

    if (
      0x3000 == codePoint ||
      (0xff01 <= codePoint && codePoint <= 0xff60) ||
      (0xffe0 <= codePoint && codePoint <= 0xffe6)
    ) {
      return "F";
    }
    if (
      0x20a9 == codePoint ||
      (0xff61 <= codePoint && codePoint <= 0xffbe) ||
      (0xffc2 <= codePoint && codePoint <= 0xffc7) ||
      (0xffca <= codePoint && codePoint <= 0xffcf) ||
      (0xffd2 <= codePoint && codePoint <= 0xffd7) ||
      (0xffda <= codePoint && codePoint <= 0xffdc) ||
      (0xffe8 <= codePoint && codePoint <= 0xffee)
    ) {
      return "H";
    }
    if (
      (0x1100 <= codePoint && codePoint <= 0x115f) ||
      (0x11a3 <= codePoint && codePoint <= 0x11a7) ||
      (0x11fa <= codePoint && codePoint <= 0x11ff) ||
      (0x2329 <= codePoint && codePoint <= 0x232a) ||
      (0x2e80 <= codePoint && codePoint <= 0x2e99) ||
      (0x2e9b <= codePoint && codePoint <= 0x2ef3) ||
      (0x2f00 <= codePoint && codePoint <= 0x2fd5) ||
      (0x2ff0 <= codePoint && codePoint <= 0x2ffb) ||
      (0x3001 <= codePoint && codePoint <= 0x303e) ||
      (0x3041 <= codePoint && codePoint <= 0x3096) ||
      (0x3099 <= codePoint && codePoint <= 0x30ff) ||
      (0x3105 <= codePoint && codePoint <= 0x312d) ||
      (0x3131 <= codePoint && codePoint <= 0x318e) ||
      (0x3190 <= codePoint && codePoint <= 0x31ba) ||
      (0x31c0 <= codePoint && codePoint <= 0x31e3) ||
      (0x31f0 <= codePoint && codePoint <= 0x321e) ||
      (0x3220 <= codePoint && codePoint <= 0x3247) ||
      (0x3250 <= codePoint && codePoint <= 0x32fe) ||
      (0x3300 <= codePoint && codePoint <= 0x4dbf) ||
      (0x4e00 <= codePoint && codePoint <= 0xa48c) ||
      (0xa490 <= codePoint && codePoint <= 0xa4c6) ||
      (0xa960 <= codePoint && codePoint <= 0xa97c) ||
      (0xac00 <= codePoint && codePoint <= 0xd7a3) ||
      (0xd7b0 <= codePoint && codePoint <= 0xd7c6) ||
      (0xd7cb <= codePoint && codePoint <= 0xd7fb) ||
      (0xf900 <= codePoint && codePoint <= 0xfaff) ||
      (0xfe10 <= codePoint && codePoint <= 0xfe19) ||
      (0xfe30 <= codePoint && codePoint <= 0xfe52) ||
      (0xfe54 <= codePoint && codePoint <= 0xfe66) ||
      (0xfe68 <= codePoint && codePoint <= 0xfe6b) ||
      (0x1b000 <= codePoint && codePoint <= 0x1b001) ||
      (0x1f200 <= codePoint && codePoint <= 0x1f202) ||
      (0x1f210 <= codePoint && codePoint <= 0x1f23a) ||
      (0x1f240 <= codePoint && codePoint <= 0x1f248) ||
      (0x1f250 <= codePoint && codePoint <= 0x1f251) ||
      (0x20000 <= codePoint && codePoint <= 0x2f73f) ||
      (0x2b740 <= codePoint && codePoint <= 0x2fffd) ||
      (0x30000 <= codePoint && codePoint <= 0x3fffd)
    ) {
      return "W";
    }
    if (
      (0x0020 <= codePoint && codePoint <= 0x007e) ||
      (0x00a2 <= codePoint && codePoint <= 0x00a3) ||
      (0x00a5 <= codePoint && codePoint <= 0x00a6) ||
      0x00ac == codePoint ||
      0x00af == codePoint ||
      (0x27e6 <= codePoint && codePoint <= 0x27ed) ||
      (0x2985 <= codePoint && codePoint <= 0x2986)
    ) {
      return "Na";
    }
    if (
      0x00a1 == codePoint ||
      0x00a4 == codePoint ||
      (0x00a7 <= codePoint && codePoint <= 0x00a8) ||
      0x00aa == codePoint ||
      (0x00ad <= codePoint && codePoint <= 0x00ae) ||
      (0x00b0 <= codePoint && codePoint <= 0x00b4) ||
      (0x00b6 <= codePoint && codePoint <= 0x00ba) ||
      (0x00bc <= codePoint && codePoint <= 0x00bf) ||
      0x00c6 == codePoint ||
      0x00d0 == codePoint ||
      (0x00d7 <= codePoint && codePoint <= 0x00d8) ||
      (0x00de <= codePoint && codePoint <= 0x00e1) ||
      0x00e6 == codePoint ||
      (0x00e8 <= codePoint && codePoint <= 0x00ea) ||
      (0x00ec <= codePoint && codePoint <= 0x00ed) ||
      0x00f0 == codePoint ||
      (0x00f2 <= codePoint && codePoint <= 0x00f3) ||
      (0x00f7 <= codePoint && codePoint <= 0x00fa) ||
      0x00fc == codePoint ||
      0x00fe == codePoint ||
      0x0101 == codePoint ||
      0x0111 == codePoint ||
      0x0113 == codePoint ||
      0x011b == codePoint ||
      (0x0126 <= codePoint && codePoint <= 0x0127) ||
      0x012b == codePoint ||
      (0x0131 <= codePoint && codePoint <= 0x0133) ||
      0x0138 == codePoint ||
      (0x013f <= codePoint && codePoint <= 0x0142) ||
      0x0144 == codePoint ||
      (0x0148 <= codePoint && codePoint <= 0x014b) ||
      0x014d == codePoint ||
      (0x0152 <= codePoint && codePoint <= 0x0153) ||
      (0x0166 <= codePoint && codePoint <= 0x0167) ||
      0x016b == codePoint ||
      0x01ce == codePoint ||
      0x01d0 == codePoint ||
      0x01d2 == codePoint ||
      0x01d4 == codePoint ||
      0x01d6 == codePoint ||
      0x01d8 == codePoint ||
      0x01da == codePoint ||
      0x01dc == codePoint ||
      0x0251 == codePoint ||
      0x0261 == codePoint ||
      0x02c4 == codePoint ||
      0x02c7 == codePoint ||
      (0x02c9 <= codePoint && codePoint <= 0x02cb) ||
      0x02cd == codePoint ||
      0x02d0 == codePoint ||
      (0x02d8 <= codePoint && codePoint <= 0x02db) ||
      0x02dd == codePoint ||
      0x02df == codePoint ||
      (0x0300 <= codePoint && codePoint <= 0x036f) ||
      (0x0391 <= codePoint && codePoint <= 0x03a1) ||
      (0x03a3 <= codePoint && codePoint <= 0x03a9) ||
      (0x03b1 <= codePoint && codePoint <= 0x03c1) ||
      (0x03c3 <= codePoint && codePoint <= 0x03c9) ||
      0x0401 == codePoint ||
      (0x0410 <= codePoint && codePoint <= 0x044f) ||
      0x0451 == codePoint ||
      0x2010 == codePoint ||
      (0x2013 <= codePoint && codePoint <= 0x2016) ||
      (0x2018 <= codePoint && codePoint <= 0x2019) ||
      (0x201c <= codePoint && codePoint <= 0x201d) ||
      (0x2020 <= codePoint && codePoint <= 0x2022) ||
      (0x2024 <= codePoint && codePoint <= 0x2027) ||
      0x2030 == codePoint ||
      (0x2032 <= codePoint && codePoint <= 0x2033) ||
      0x2035 == codePoint ||
      0x203b == codePoint ||
      0x203e == codePoint ||
      0x2074 == codePoint ||
      0x207f == codePoint ||
      (0x2081 <= codePoint && codePoint <= 0x2084) ||
      0x20ac == codePoint ||
      0x2103 == codePoint ||
      0x2105 == codePoint ||
      0x2109 == codePoint ||
      0x2113 == codePoint ||
      0x2116 == codePoint ||
      (0x2121 <= codePoint && codePoint <= 0x2122) ||
      0x2126 == codePoint ||
      0x212b == codePoint ||
      (0x2153 <= codePoint && codePoint <= 0x2154) ||
      (0x215b <= codePoint && codePoint <= 0x215e) ||
      (0x2160 <= codePoint && codePoint <= 0x216b) ||
      (0x2170 <= codePoint && codePoint <= 0x2179) ||
      0x2189 == codePoint ||
      (0x2190 <= codePoint && codePoint <= 0x2199) ||
      (0x21b8 <= codePoint && codePoint <= 0x21b9) ||
      0x21d2 == codePoint ||
      0x21d4 == codePoint ||
      0x21e7 == codePoint ||
      0x2200 == codePoint ||
      (0x2202 <= codePoint && codePoint <= 0x2203) ||
      (0x2207 <= codePoint && codePoint <= 0x2208) ||
      0x220b == codePoint ||
      0x220f == codePoint ||
      0x2211 == codePoint ||
      0x2215 == codePoint ||
      0x221a == codePoint ||
      (0x221d <= codePoint && codePoint <= 0x2220) ||
      0x2223 == codePoint ||
      0x2225 == codePoint ||
      (0x2227 <= codePoint && codePoint <= 0x222c) ||
      0x222e == codePoint ||
      (0x2234 <= codePoint && codePoint <= 0x2237) ||
      (0x223c <= codePoint && codePoint <= 0x223d) ||
      0x2248 == codePoint ||
      0x224c == codePoint ||
      0x2252 == codePoint ||
      (0x2260 <= codePoint && codePoint <= 0x2261) ||
      (0x2264 <= codePoint && codePoint <= 0x2267) ||
      (0x226a <= codePoint && codePoint <= 0x226b) ||
      (0x226e <= codePoint && codePoint <= 0x226f) ||
      (0x2282 <= codePoint && codePoint <= 0x2283) ||
      (0x2286 <= codePoint && codePoint <= 0x2287) ||
      0x2295 == codePoint ||
      0x2299 == codePoint ||
      0x22a5 == codePoint ||
      0x22bf == codePoint ||
      0x2312 == codePoint ||
      (0x2460 <= codePoint && codePoint <= 0x24e9) ||
      (0x24eb <= codePoint && codePoint <= 0x254b) ||
      (0x2550 <= codePoint && codePoint <= 0x2573) ||
      (0x2580 <= codePoint && codePoint <= 0x258f) ||
      (0x2592 <= codePoint && codePoint <= 0x2595) ||
      (0x25a0 <= codePoint && codePoint <= 0x25a1) ||
      (0x25a3 <= codePoint && codePoint <= 0x25a9) ||
      (0x25b2 <= codePoint && codePoint <= 0x25b3) ||
      (0x25b6 <= codePoint && codePoint <= 0x25b7) ||
      (0x25bc <= codePoint && codePoint <= 0x25bd) ||
      (0x25c0 <= codePoint && codePoint <= 0x25c1) ||
      (0x25c6 <= codePoint && codePoint <= 0x25c8) ||
      0x25cb == codePoint ||
      (0x25ce <= codePoint && codePoint <= 0x25d1) ||
      (0x25e2 <= codePoint && codePoint <= 0x25e5) ||
      0x25ef == codePoint ||
      (0x2605 <= codePoint && codePoint <= 0x2606) ||
      0x2609 == codePoint ||
      (0x260e <= codePoint && codePoint <= 0x260f) ||
      (0x2614 <= codePoint && codePoint <= 0x2615) ||
      0x261c == codePoint ||
      0x261e == codePoint ||
      0x2640 == codePoint ||
      0x2642 == codePoint ||
      (0x2660 <= codePoint && codePoint <= 0x2661) ||
      (0x2663 <= codePoint && codePoint <= 0x2665) ||
      (0x2667 <= codePoint && codePoint <= 0x266a) ||
      (0x266c <= codePoint && codePoint <= 0x266d) ||
      0x266f == codePoint ||
      (0x269e <= codePoint && codePoint <= 0x269f) ||
      (0x26be <= codePoint && codePoint <= 0x26bf) ||
      (0x26c4 <= codePoint && codePoint <= 0x26cd) ||
      (0x26cf <= codePoint && codePoint <= 0x26e1) ||
      0x26e3 == codePoint ||
      (0x26e8 <= codePoint && codePoint <= 0x26ff) ||
      0x273d == codePoint ||
      0x2757 == codePoint ||
      (0x2776 <= codePoint && codePoint <= 0x277f) ||
      (0x2b55 <= codePoint && codePoint <= 0x2b59) ||
      (0x3248 <= codePoint && codePoint <= 0x324f) ||
      (0xe000 <= codePoint && codePoint <= 0xf8ff) ||
      (0xfe00 <= codePoint && codePoint <= 0xfe0f) ||
      0xfffd == codePoint ||
      (0x1f100 <= codePoint && codePoint <= 0x1f10a) ||
      (0x1f110 <= codePoint && codePoint <= 0x1f12d) ||
      (0x1f130 <= codePoint && codePoint <= 0x1f169) ||
      (0x1f170 <= codePoint && codePoint <= 0x1f19a) ||
      (0xe0100 <= codePoint && codePoint <= 0xe01ef) ||
      (0xf0000 <= codePoint && codePoint <= 0xffffd) ||
      (0x100000 <= codePoint && codePoint <= 0x10fffd)
    ) {
      return "A";
    }

    return "N";
  };

  eaw.characterLength = function (character) {
    var code = this.eastAsianWidth(character);
    if (code == "F" || code == "W" || code == "A") {
      return 2;
    } else {
      return 1;
    }
  };

  // Split a string considering surrogate-pairs.
  function stringToArray(string) {
    return (
      string.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF]/g) || []
    );
  }

  eaw.length = function (string) {
    var characters = stringToArray(string);
    var len = 0;
    for (var i = 0; i < characters.length; i++) {
      len = len + this.characterLength(characters[i]);
    }
    return len;
  };

  eaw.slice = function (text, start, end) {
    textLen = eaw.length(text);
    start = start ? start : 0;
    end = end ? end : 1;
    if (start < 0) {
      start = textLen + start;
    }
    if (end < 0) {
      end = textLen + end;
    }
    var result = "";
    var eawLen = 0;
    var chars = stringToArray(text);
    for (var i = 0; i < chars.length; i++) {
      var char = chars[i];
      var charLen = eaw.length(char);
      if (eawLen >= start - (charLen == 2 ? 1 : 0)) {
        if (eawLen + charLen <= end) {
          result += char;
        } else {
          break;
        }
      }
      eawLen += charLen;
    }
    return result;
  };
})(eastasianwidth);

var eastasianwidthExports = eastasianwidth.exports;
var eastAsianWidth = /*@__PURE__*/ getDefaultExportFromCjs(
  eastasianwidthExports
);

var emojiRegex = () => {
  // https://mths.be/emoji
  return /[#*0-9]\uFE0F?\u20E3|[\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23ED-\u23EF\u23F1\u23F2\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692\u2694-\u2697\u2699\u269B\u269C\u26A0\u26A7\u26AA\u26B0\u26B1\u26BD\u26BE\u26C4\u26C8\u26CF\u26D1\u26E9\u26F0-\u26F5\u26F7\u26F8\u26FA\u2702\u2708\u2709\u270F\u2712\u2714\u2716\u271D\u2721\u2733\u2734\u2744\u2747\u2757\u2763\u27A1\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B55\u3030\u303D\u3297\u3299]\uFE0F?|[\u261D\u270C\u270D](?:\uFE0F|\uD83C[\uDFFB-\uDFFF])?|[\u270A\u270B](?:\uD83C[\uDFFB-\uDFFF])?|[\u23E9-\u23EC\u23F0\u23F3\u25FD\u2693\u26A1\u26AB\u26C5\u26CE\u26D4\u26EA\u26FD\u2705\u2728\u274C\u274E\u2753-\u2755\u2795-\u2797\u27B0\u27BF\u2B50]|\u26D3\uFE0F?(?:\u200D\uD83D\uDCA5)?|\u26F9(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|\u2764\uFE0F?(?:\u200D(?:\uD83D\uDD25|\uD83E\uDE79))?|\uD83C(?:[\uDC04\uDD70\uDD71\uDD7E\uDD7F\uDE02\uDE37\uDF21\uDF24-\uDF2C\uDF36\uDF7D\uDF96\uDF97\uDF99-\uDF9B\uDF9E\uDF9F\uDFCD\uDFCE\uDFD4-\uDFDF\uDFF5\uDFF7]\uFE0F?|[\uDF85\uDFC2\uDFC7](?:\uD83C[\uDFFB-\uDFFF])?|[\uDFC4\uDFCA](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDFCB\uDFCC](?:\uFE0F|\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDCCF\uDD8E\uDD91-\uDD9A\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF43\uDF45-\uDF4A\uDF4C-\uDF7C\uDF7E-\uDF84\uDF86-\uDF93\uDFA0-\uDFC1\uDFC5\uDFC6\uDFC8\uDFC9\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF8-\uDFFF]|\uDDE6\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF]|\uDDE7\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF]|\uDDE8\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF5\uDDF7\uDDFA-\uDDFF]|\uDDE9\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF]|\uDDEA\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA]|\uDDEB\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7]|\uDDEC\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE]|\uDDED\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA]|\uDDEE\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9]|\uDDEF\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5]|\uDDF0\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF]|\uDDF1\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE]|\uDDF2\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF]|\uDDF3\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF]|\uDDF4\uD83C\uDDF2|\uDDF5\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE]|\uDDF6\uD83C\uDDE6|\uDDF7\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC]|\uDDF8\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF]|\uDDF9\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF]|\uDDFA\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF]|\uDDFB\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA]|\uDDFC\uD83C[\uDDEB\uDDF8]|\uDDFD\uD83C\uDDF0|\uDDFE\uD83C[\uDDEA\uDDF9]|\uDDFF\uD83C[\uDDE6\uDDF2\uDDFC]|\uDF44(?:\u200D\uD83D\uDFEB)?|\uDF4B(?:\u200D\uD83D\uDFE9)?|\uDFC3(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?|\uDFF3\uFE0F?(?:\u200D(?:\u26A7\uFE0F?|\uD83C\uDF08))?|\uDFF4(?:\u200D\u2620\uFE0F?|\uDB40\uDC67\uDB40\uDC62\uDB40(?:\uDC65\uDB40\uDC6E\uDB40\uDC67|\uDC73\uDB40\uDC63\uDB40\uDC74|\uDC77\uDB40\uDC6C\uDB40\uDC73)\uDB40\uDC7F)?)|\uD83D(?:[\uDC3F\uDCFD\uDD49\uDD4A\uDD6F\uDD70\uDD73\uDD76-\uDD79\uDD87\uDD8A-\uDD8D\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA\uDECB\uDECD-\uDECF\uDEE0-\uDEE5\uDEE9\uDEF0\uDEF3]\uFE0F?|[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC](?:\uD83C[\uDFFB-\uDFFF])?|[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4\uDEB5](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDD74\uDD90](?:\uFE0F|\uD83C[\uDFFB-\uDFFF])?|[\uDC00-\uDC07\uDC09-\uDC14\uDC16-\uDC25\uDC27-\uDC3A\uDC3C-\uDC3E\uDC40\uDC44\uDC45\uDC51-\uDC65\uDC6A\uDC79-\uDC7B\uDC7D-\uDC80\uDC84\uDC88-\uDC8E\uDC90\uDC92-\uDCA9\uDCAB-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDDA4\uDDFB-\uDE2D\uDE2F-\uDE34\uDE37-\uDE41\uDE43\uDE44\uDE48-\uDE4A\uDE80-\uDEA2\uDEA4-\uDEB3\uDEB7-\uDEBF\uDEC1-\uDEC5\uDED0-\uDED2\uDED5-\uDED7\uDEDC-\uDEDF\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB\uDFF0]|\uDC08(?:\u200D\u2B1B)?|\uDC15(?:\u200D\uD83E\uDDBA)?|\uDC26(?:\u200D(?:\u2B1B|\uD83D\uDD25))?|\uDC3B(?:\u200D\u2744\uFE0F?)?|\uDC41\uFE0F?(?:\u200D\uD83D\uDDE8\uFE0F?)?|\uDC68(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDC68\uDC69]\u200D\uD83D(?:\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?)|[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?)|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D\uDC68\uD83C[\uDFFC-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFD-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFD\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFE])))?))?|\uDC69(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?[\uDC68\uDC69]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?|\uDC69\u200D\uD83D(?:\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?))|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFC-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB\uDFFD-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB-\uDFFD\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB-\uDFFE])))?))?|\uDC6F(?:\u200D[\u2640\u2642]\uFE0F?)?|\uDD75(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|\uDE2E(?:\u200D\uD83D\uDCA8)?|\uDE35(?:\u200D\uD83D\uDCAB)?|\uDE36(?:\u200D\uD83C\uDF2B\uFE0F?)?|\uDE42(?:\u200D[\u2194\u2195]\uFE0F?)?|\uDEB6(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?)|\uD83E(?:[\uDD0C\uDD0F\uDD18-\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5\uDEC3-\uDEC5\uDEF0\uDEF2-\uDEF8](?:\uD83C[\uDFFB-\uDFFF])?|[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD\uDDCF\uDDD4\uDDD6-\uDDDD](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDDDE\uDDDF](?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDD0D\uDD0E\uDD10-\uDD17\uDD20-\uDD25\uDD27-\uDD2F\uDD3A\uDD3F-\uDD45\uDD47-\uDD76\uDD78-\uDDB4\uDDB7\uDDBA\uDDBC-\uDDCC\uDDD0\uDDE0-\uDDFF\uDE70-\uDE7C\uDE80-\uDE88\uDE90-\uDEBD\uDEBF-\uDEC2\uDECE-\uDEDB\uDEE0-\uDEE8]|\uDD3C(?:\u200D[\u2640\u2642]\uFE0F?|\uD83C[\uDFFB-\uDFFF])?|\uDDCE(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?|\uDDD1(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83E\uDDD1|\uDDD1\u200D\uD83E\uDDD2(?:\u200D\uD83E\uDDD2)?|\uDDD2(?:\u200D\uD83E\uDDD2)?))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF])))?))?|\uDEF1(?:\uD83C(?:\uDFFB(?:\u200D\uD83E\uDEF2\uD83C[\uDFFC-\uDFFF])?|\uDFFC(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB\uDFFD-\uDFFF])?|\uDFFD(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])?|\uDFFE(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB-\uDFFD\uDFFF])?|\uDFFF(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB-\uDFFE])?))?)/g;
};

function stringWidth(string, options) {
  if (typeof string !== "string" || string.length === 0) {
    return 0;
  }

  options = {
    ambiguousIsNarrow: true,
    countAnsiEscapeCodes: false,
    ...options,
  };

  if (!options.countAnsiEscapeCodes) {
    string = stripAnsi(string);
  }

  if (string.length === 0) {
    return 0;
  }

  const ambiguousCharacterWidth = options.ambiguousIsNarrow ? 1 : 2;
  let width = 0;

  for (const { segment: character } of new Intl.Segmenter().segment(string)) {
    const codePoint = character.codePointAt(0);

    // Ignore control characters
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      continue;
    }

    // Ignore combining characters
    if (codePoint >= 0x3_00 && codePoint <= 0x3_6f) {
      continue;
    }

    if (emojiRegex().test(character)) {
      width += 2;
      continue;
    }

    const code = eastAsianWidth.eastAsianWidth(character);
    switch (code) {
      case "F":
      case "W": {
        width += 2;
        break;
      }

      case "A": {
        width += ambiguousCharacterWidth;
        break;
      }

      default: {
        width += 1;
      }
    }
  }

  return width;
}

function isInteractive({ stream = process.stdout } = {}) {
  return Boolean(
    stream &&
      stream.isTTY &&
      process.env.TERM !== "dumb" &&
      !("CI" in process.env)
  );
}

function isUnicodeSupported() {
  if (process$2.platform !== "win32") {
    return process$2.env.TERM !== "linux"; // Linux console (kernel)
  }

  return (
    Boolean(process$2.env.CI) ||
    Boolean(process$2.env.WT_SESSION) || // Windows Terminal
    Boolean(process$2.env.TERMINUS_SUBLIME) || // Terminus (<0.2.27)
    process$2.env.ConEmuTask === "{cmd::Cmder}" || // ConEmu and cmder
    process$2.env.TERM_PROGRAM === "Terminus-Sublime" ||
    process$2.env.TERM_PROGRAM === "vscode" ||
    process$2.env.TERM === "xterm-256color" ||
    process$2.env.TERM === "alacritty" ||
    process$2.env.TERMINAL_EMULATOR === "JetBrains-JediTerm"
  );
}

var bl = { exports: {} };

var readable = { exports: {} };

var stream;
var hasRequiredStream;

function requireStream() {
  if (hasRequiredStream) return stream;
  hasRequiredStream = 1;
  stream = require$$0$2;
  return stream;
}

var buffer_list;
var hasRequiredBuffer_list;

function requireBuffer_list() {
  if (hasRequiredBuffer_list) return buffer_list;
  hasRequiredBuffer_list = 1;

  function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object);
      enumerableOnly &&
        (symbols = symbols.filter(function (sym) {
          return Object.getOwnPropertyDescriptor(object, sym).enumerable;
        })),
        keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {};
      i % 2
        ? ownKeys(Object(source), !0).forEach(function (key) {
            _defineProperty(target, key, source[key]);
          })
        : Object.getOwnPropertyDescriptors
        ? Object.defineProperties(
            target,
            Object.getOwnPropertyDescriptors(source)
          )
        : ownKeys(Object(source)).forEach(function (key) {
            Object.defineProperty(
              target,
              key,
              Object.getOwnPropertyDescriptor(source, key)
            );
          });
    }
    return target;
  }
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value: value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }
  function _defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor);
    }
  }
  function _createClass(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps);
    Object.defineProperty(Constructor, "prototype", { writable: false });
    return Constructor;
  }
  function _toPropertyKey(arg) {
    var key = _toPrimitive(arg, "string");
    return typeof key === "symbol" ? key : String(key);
  }
  function _toPrimitive(input, hint) {
    if (typeof input !== "object" || input === null) return input;
    var prim = input[Symbol.toPrimitive];
    if (prim !== undefined) {
      var res = prim.call(input, hint || "default");
      if (typeof res !== "object") return res;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (hint === "string" ? String : Number)(input);
  }
  var _require = require$$0$3,
    Buffer = _require.Buffer;
  var _require2 = require$$1,
    inspect = _require2.inspect;
  var custom = (inspect && inspect.custom) || "inspect";
  function copyBuffer(src, target, offset) {
    Buffer.prototype.copy.call(src, target, offset);
  }
  buffer_list = /*#__PURE__*/ (function () {
    function BufferList() {
      _classCallCheck(this, BufferList);
      this.head = null;
      this.tail = null;
      this.length = 0;
    }
    _createClass(BufferList, [
      {
        key: "push",
        value: function push(v) {
          var entry = {
            data: v,
            next: null,
          };
          if (this.length > 0) this.tail.next = entry;
          else this.head = entry;
          this.tail = entry;
          ++this.length;
        },
      },
      {
        key: "unshift",
        value: function unshift(v) {
          var entry = {
            data: v,
            next: this.head,
          };
          if (this.length === 0) this.tail = entry;
          this.head = entry;
          ++this.length;
        },
      },
      {
        key: "shift",
        value: function shift() {
          if (this.length === 0) return;
          var ret = this.head.data;
          if (this.length === 1) this.head = this.tail = null;
          else this.head = this.head.next;
          --this.length;
          return ret;
        },
      },
      {
        key: "clear",
        value: function clear() {
          this.head = this.tail = null;
          this.length = 0;
        },
      },
      {
        key: "join",
        value: function join(s) {
          if (this.length === 0) return "";
          var p = this.head;
          var ret = "" + p.data;
          while ((p = p.next)) ret += s + p.data;
          return ret;
        },
      },
      {
        key: "concat",
        value: function concat(n) {
          if (this.length === 0) return Buffer.alloc(0);
          var ret = Buffer.allocUnsafe(n >>> 0);
          var p = this.head;
          var i = 0;
          while (p) {
            copyBuffer(p.data, ret, i);
            i += p.data.length;
            p = p.next;
          }
          return ret;
        },

        // Consumes a specified amount of bytes or characters from the buffered data.
      },
      {
        key: "consume",
        value: function consume(n, hasStrings) {
          var ret;
          if (n < this.head.data.length) {
            // `slice` is the same for buffers and strings.
            ret = this.head.data.slice(0, n);
            this.head.data = this.head.data.slice(n);
          } else if (n === this.head.data.length) {
            // First chunk is a perfect match.
            ret = this.shift();
          } else {
            // Result spans more than one buffer.
            ret = hasStrings ? this._getString(n) : this._getBuffer(n);
          }
          return ret;
        },
      },
      {
        key: "first",
        value: function first() {
          return this.head.data;
        },

        // Consumes a specified amount of characters from the buffered data.
      },
      {
        key: "_getString",
        value: function _getString(n) {
          var p = this.head;
          var c = 1;
          var ret = p.data;
          n -= ret.length;
          while ((p = p.next)) {
            var str = p.data;
            var nb = n > str.length ? str.length : n;
            if (nb === str.length) ret += str;
            else ret += str.slice(0, n);
            n -= nb;
            if (n === 0) {
              if (nb === str.length) {
                ++c;
                if (p.next) this.head = p.next;
                else this.head = this.tail = null;
              } else {
                this.head = p;
                p.data = str.slice(nb);
              }
              break;
            }
            ++c;
          }
          this.length -= c;
          return ret;
        },

        // Consumes a specified amount of bytes from the buffered data.
      },
      {
        key: "_getBuffer",
        value: function _getBuffer(n) {
          var ret = Buffer.allocUnsafe(n);
          var p = this.head;
          var c = 1;
          p.data.copy(ret);
          n -= p.data.length;
          while ((p = p.next)) {
            var buf = p.data;
            var nb = n > buf.length ? buf.length : n;
            buf.copy(ret, ret.length - n, 0, nb);
            n -= nb;
            if (n === 0) {
              if (nb === buf.length) {
                ++c;
                if (p.next) this.head = p.next;
                else this.head = this.tail = null;
              } else {
                this.head = p;
                p.data = buf.slice(nb);
              }
              break;
            }
            ++c;
          }
          this.length -= c;
          return ret;
        },

        // Make sure the linked list only shows the minimal necessary information.
      },
      {
        key: custom,
        value: function value(_, options) {
          return inspect(
            this,
            _objectSpread(
              _objectSpread({}, options),
              {},
              {
                // Only inspect one level.
                depth: 0,
                // It should not recurse.
                customInspect: false,
              }
            )
          );
        },
      },
    ]);
    return BufferList;
  })();
  return buffer_list;
}

var destroy_1;
var hasRequiredDestroy;

function requireDestroy() {
  if (hasRequiredDestroy) return destroy_1;
  hasRequiredDestroy = 1;

  // undocumented cb() API, needed for core, not for public API
  function destroy(err, cb) {
    var _this = this;
    var readableDestroyed =
      this._readableState && this._readableState.destroyed;
    var writableDestroyed =
      this._writableState && this._writableState.destroyed;
    if (readableDestroyed || writableDestroyed) {
      if (cb) {
        cb(err);
      } else if (err) {
        if (!this._writableState) {
          process.nextTick(emitErrorNT, this, err);
        } else if (!this._writableState.errorEmitted) {
          this._writableState.errorEmitted = true;
          process.nextTick(emitErrorNT, this, err);
        }
      }
      return this;
    }

    // we set destroyed to true before firing error callbacks in order
    // to make it re-entrance safe in case destroy() is called within callbacks

    if (this._readableState) {
      this._readableState.destroyed = true;
    }

    // if this is a duplex stream mark the writable part as destroyed as well
    if (this._writableState) {
      this._writableState.destroyed = true;
    }
    this._destroy(err || null, function (err) {
      if (!cb && err) {
        if (!_this._writableState) {
          process.nextTick(emitErrorAndCloseNT, _this, err);
        } else if (!_this._writableState.errorEmitted) {
          _this._writableState.errorEmitted = true;
          process.nextTick(emitErrorAndCloseNT, _this, err);
        } else {
          process.nextTick(emitCloseNT, _this);
        }
      } else if (cb) {
        process.nextTick(emitCloseNT, _this);
        cb(err);
      } else {
        process.nextTick(emitCloseNT, _this);
      }
    });
    return this;
  }
  function emitErrorAndCloseNT(self, err) {
    emitErrorNT(self, err);
    emitCloseNT(self);
  }
  function emitCloseNT(self) {
    if (self._writableState && !self._writableState.emitClose) return;
    if (self._readableState && !self._readableState.emitClose) return;
    self.emit("close");
  }
  function undestroy() {
    if (this._readableState) {
      this._readableState.destroyed = false;
      this._readableState.reading = false;
      this._readableState.ended = false;
      this._readableState.endEmitted = false;
    }
    if (this._writableState) {
      this._writableState.destroyed = false;
      this._writableState.ended = false;
      this._writableState.ending = false;
      this._writableState.finalCalled = false;
      this._writableState.prefinished = false;
      this._writableState.finished = false;
      this._writableState.errorEmitted = false;
    }
  }
  function emitErrorNT(self, err) {
    self.emit("error", err);
  }
  function errorOrDestroy(stream, err) {
    // We have tests that rely on errors being emitted
    // in the same tick, so changing this is semver major.
    // For now when you opt-in to autoDestroy we allow
    // the error to be emitted nextTick. In a future
    // semver major update we should change the default to this.

    var rState = stream._readableState;
    var wState = stream._writableState;
    if ((rState && rState.autoDestroy) || (wState && wState.autoDestroy))
      stream.destroy(err);
    else stream.emit("error", err);
  }
  destroy_1 = {
    destroy: destroy,
    undestroy: undestroy,
    errorOrDestroy: errorOrDestroy,
  };
  return destroy_1;
}

var errors = {};

var hasRequiredErrors;

function requireErrors() {
  if (hasRequiredErrors) return errors;
  hasRequiredErrors = 1;

  const codes = {};

  function createErrorType(code, message, Base) {
    if (!Base) {
      Base = Error;
    }

    function getMessage(arg1, arg2, arg3) {
      if (typeof message === "string") {
        return message;
      } else {
        return message(arg1, arg2, arg3);
      }
    }

    class NodeError extends Base {
      constructor(arg1, arg2, arg3) {
        super(getMessage(arg1, arg2, arg3));
      }
    }

    NodeError.prototype.name = Base.name;
    NodeError.prototype.code = code;

    codes[code] = NodeError;
  }

  // https://github.com/nodejs/node/blob/v10.8.0/lib/internal/errors.js
  function oneOf(expected, thing) {
    if (Array.isArray(expected)) {
      const len = expected.length;
      expected = expected.map((i) => String(i));
      if (len > 2) {
        return (
          `one of ${thing} ${expected.slice(0, len - 1).join(", ")}, or ` +
          expected[len - 1]
        );
      } else if (len === 2) {
        return `one of ${thing} ${expected[0]} or ${expected[1]}`;
      } else {
        return `of ${thing} ${expected[0]}`;
      }
    } else {
      return `of ${thing} ${String(expected)}`;
    }
  }

  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/startsWith
  function startsWith(str, search, pos) {
    return str.substr(0, search.length) === search;
  }

  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/endsWith
  function endsWith(str, search, this_len) {
    if (this_len === undefined || this_len > str.length) {
      this_len = str.length;
    }
    return str.substring(this_len - search.length, this_len) === search;
  }

  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/includes
  function includes(str, search, start) {
    if (typeof start !== "number") {
      start = 0;
    }

    if (start + search.length > str.length) {
      return false;
    } else {
      return str.indexOf(search, start) !== -1;
    }
  }

  createErrorType(
    "ERR_INVALID_OPT_VALUE",
    function (name, value) {
      return 'The value "' + value + '" is invalid for option "' + name + '"';
    },
    TypeError
  );
  createErrorType(
    "ERR_INVALID_ARG_TYPE",
    function (name, expected, actual) {
      // determiner: 'must be' or 'must not be'
      let determiner;
      if (typeof expected === "string" && startsWith(expected, "not ")) {
        determiner = "must not be";
        expected = expected.replace(/^not /, "");
      } else {
        determiner = "must be";
      }

      let msg;
      if (endsWith(name, " argument")) {
        // For cases like 'first argument'
        msg = `The ${name} ${determiner} ${oneOf(expected, "type")}`;
      } else {
        const type = includes(name, ".") ? "property" : "argument";
        msg = `The "${name}" ${type} ${determiner} ${oneOf(expected, "type")}`;
      }

      msg += `. Received type ${typeof actual}`;
      return msg;
    },
    TypeError
  );
  createErrorType("ERR_STREAM_PUSH_AFTER_EOF", "stream.push() after EOF");
  createErrorType("ERR_METHOD_NOT_IMPLEMENTED", function (name) {
    return "The " + name + " method is not implemented";
  });
  createErrorType("ERR_STREAM_PREMATURE_CLOSE", "Premature close");
  createErrorType("ERR_STREAM_DESTROYED", function (name) {
    return "Cannot call " + name + " after a stream was destroyed";
  });
  createErrorType("ERR_MULTIPLE_CALLBACK", "Callback called multiple times");
  createErrorType("ERR_STREAM_CANNOT_PIPE", "Cannot pipe, not readable");
  createErrorType("ERR_STREAM_WRITE_AFTER_END", "write after end");
  createErrorType(
    "ERR_STREAM_NULL_VALUES",
    "May not write null values to stream",
    TypeError
  );
  createErrorType(
    "ERR_UNKNOWN_ENCODING",
    function (arg) {
      return "Unknown encoding: " + arg;
    },
    TypeError
  );
  createErrorType(
    "ERR_STREAM_UNSHIFT_AFTER_END_EVENT",
    "stream.unshift() after end event"
  );

  errors.codes = codes;
  return errors;
}

var state;
var hasRequiredState;

function requireState() {
  if (hasRequiredState) return state;
  hasRequiredState = 1;

  var ERR_INVALID_OPT_VALUE = requireErrors().codes.ERR_INVALID_OPT_VALUE;
  function highWaterMarkFrom(options, isDuplex, duplexKey) {
    return options.highWaterMark != null
      ? options.highWaterMark
      : isDuplex
      ? options[duplexKey]
      : null;
  }
  function getHighWaterMark(state, options, duplexKey, isDuplex) {
    var hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
    if (hwm != null) {
      if (!(isFinite(hwm) && Math.floor(hwm) === hwm) || hwm < 0) {
        var name = isDuplex ? duplexKey : "highWaterMark";
        throw new ERR_INVALID_OPT_VALUE(name, hwm);
      }
      return Math.floor(hwm);
    }

    // Default value
    return state.objectMode ? 16 : 16 * 1024;
  }
  state = {
    getHighWaterMark: getHighWaterMark,
  };
  return state;
}

var inherits$1 = { exports: {} };

var inherits_browser = { exports: {} };

var hasRequiredInherits_browser;

function requireInherits_browser() {
  if (hasRequiredInherits_browser) return inherits_browser.exports;
  hasRequiredInherits_browser = 1;
  if (typeof Object.create === "function") {
    // implementation from standard node.js 'util' module
    inherits_browser.exports = function inherits(ctor, superCtor) {
      if (superCtor) {
        ctor.super_ = superCtor;
        ctor.prototype = Object.create(superCtor.prototype, {
          constructor: {
            value: ctor,
            enumerable: false,
            writable: true,
            configurable: true,
          },
        });
      }
    };
  } else {
    // old school shim for old browsers
    inherits_browser.exports = function inherits(ctor, superCtor) {
      if (superCtor) {
        ctor.super_ = superCtor;
        var TempCtor = function () {};
        TempCtor.prototype = superCtor.prototype;
        ctor.prototype = new TempCtor();
        ctor.prototype.constructor = ctor;
      }
    };
  }
  return inherits_browser.exports;
}

try {
  var util = require("util");
  /* istanbul ignore next */
  if (typeof util.inherits !== "function") throw "";
  inherits$1.exports = util.inherits;
} catch (e) {
  /* istanbul ignore next */
  inherits$1.exports = requireInherits_browser();
}

var inheritsExports = inherits$1.exports;

var node;
var hasRequiredNode;

function requireNode() {
  if (hasRequiredNode) return node;
  hasRequiredNode = 1;
  /**
   * For Node.js, simply re-export the core `util.deprecate` function.
   */

  node = require$$1.deprecate;
  return node;
}

var _stream_writable;
var hasRequired_stream_writable;

function require_stream_writable() {
  if (hasRequired_stream_writable) return _stream_writable;
  hasRequired_stream_writable = 1;

  _stream_writable = Writable;

  // It seems a linked list but it is not
  // there will be only 2 of these for each stream
  function CorkedRequest(state) {
    var _this = this;
    this.next = null;
    this.entry = null;
    this.finish = function () {
      onCorkedFinish(_this, state);
    };
  }
  /* </replacement> */

  /*<replacement>*/
  var Duplex;
  /*</replacement>*/

  Writable.WritableState = WritableState;

  /*<replacement>*/
  var internalUtil = {
    deprecate: requireNode(),
  };
  /*</replacement>*/

  /*<replacement>*/
  var Stream = requireStream();
  /*</replacement>*/

  var Buffer = require$$0$3.Buffer;
  var OurUint8Array =
    (typeof commonjsGlobal !== "undefined"
      ? commonjsGlobal
      : typeof window !== "undefined"
      ? window
      : typeof self !== "undefined"
      ? self
      : {}
    ).Uint8Array || function () {};
  function _uint8ArrayToBuffer(chunk) {
    return Buffer.from(chunk);
  }
  function _isUint8Array(obj) {
    return Buffer.isBuffer(obj) || obj instanceof OurUint8Array;
  }
  var destroyImpl = requireDestroy();
  var _require = requireState(),
    getHighWaterMark = _require.getHighWaterMark;
  var _require$codes = requireErrors().codes,
    ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE,
    ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED,
    ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK,
    ERR_STREAM_CANNOT_PIPE = _require$codes.ERR_STREAM_CANNOT_PIPE,
    ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED,
    ERR_STREAM_NULL_VALUES = _require$codes.ERR_STREAM_NULL_VALUES,
    ERR_STREAM_WRITE_AFTER_END = _require$codes.ERR_STREAM_WRITE_AFTER_END,
    ERR_UNKNOWN_ENCODING = _require$codes.ERR_UNKNOWN_ENCODING;
  var errorOrDestroy = destroyImpl.errorOrDestroy;
  inheritsExports(Writable, Stream);
  function nop() {}
  function WritableState(options, stream, isDuplex) {
    Duplex = Duplex || require_stream_duplex();
    options = options || {};

    // Duplex streams are both readable and writable, but share
    // the same options object.
    // However, some cases require setting options to different
    // values for the readable and the writable sides of the duplex stream,
    // e.g. options.readableObjectMode vs. options.writableObjectMode, etc.
    if (typeof isDuplex !== "boolean") isDuplex = stream instanceof Duplex;

    // object stream flag to indicate whether or not this stream
    // contains buffers or objects.
    this.objectMode = !!options.objectMode;
    if (isDuplex)
      this.objectMode = this.objectMode || !!options.writableObjectMode;

    // the point at which write() starts returning false
    // Note: 0 is a valid value, means that we always return false if
    // the entire buffer is not flushed immediately on write()
    this.highWaterMark = getHighWaterMark(
      this,
      options,
      "writableHighWaterMark",
      isDuplex
    );

    // if _final has been called
    this.finalCalled = false;

    // drain event flag.
    this.needDrain = false;
    // at the start of calling end()
    this.ending = false;
    // when end() has been called, and returned
    this.ended = false;
    // when 'finish' is emitted
    this.finished = false;

    // has it been destroyed
    this.destroyed = false;

    // should we decode strings into buffers before passing to _write?
    // this is here so that some node-core streams can optimize string
    // handling at a lower level.
    var noDecode = options.decodeStrings === false;
    this.decodeStrings = !noDecode;

    // Crypto is kind of old and crusty.  Historically, its default string
    // encoding is 'binary' so we have to make this configurable.
    // Everything else in the universe uses 'utf8', though.
    this.defaultEncoding = options.defaultEncoding || "utf8";

    // not an actual buffer we keep track of, but a measurement
    // of how much we're waiting to get pushed to some underlying
    // socket or file.
    this.length = 0;

    // a flag to see when we're in the middle of a write.
    this.writing = false;

    // when true all writes will be buffered until .uncork() call
    this.corked = 0;

    // a flag to be able to tell if the onwrite cb is called immediately,
    // or on a later tick.  We set this to true at first, because any
    // actions that shouldn't happen until "later" should generally also
    // not happen before the first write call.
    this.sync = true;

    // a flag to know if we're processing previously buffered items, which
    // may call the _write() callback in the same tick, so that we don't
    // end up in an overlapped onwrite situation.
    this.bufferProcessing = false;

    // the callback that's passed to _write(chunk,cb)
    this.onwrite = function (er) {
      onwrite(stream, er);
    };

    // the callback that the user supplies to write(chunk,encoding,cb)
    this.writecb = null;

    // the amount that is being written when _write is called.
    this.writelen = 0;
    this.bufferedRequest = null;
    this.lastBufferedRequest = null;

    // number of pending user-supplied write callbacks
    // this must be 0 before 'finish' can be emitted
    this.pendingcb = 0;

    // emit prefinish if the only thing we're waiting for is _write cbs
    // This is relevant for synchronous Transform streams
    this.prefinished = false;

    // True if the error was already emitted and should not be thrown again
    this.errorEmitted = false;

    // Should close be emitted on destroy. Defaults to true.
    this.emitClose = options.emitClose !== false;

    // Should .destroy() be called after 'finish' (and potentially 'end')
    this.autoDestroy = !!options.autoDestroy;

    // count buffered requests
    this.bufferedRequestCount = 0;

    // allocate the first CorkedRequest, there is always
    // one allocated and free to use, and we maintain at most two
    this.corkedRequestsFree = new CorkedRequest(this);
  }
  WritableState.prototype.getBuffer = function getBuffer() {
    var current = this.bufferedRequest;
    var out = [];
    while (current) {
      out.push(current);
      current = current.next;
    }
    return out;
  };
  (function () {
    try {
      Object.defineProperty(WritableState.prototype, "buffer", {
        get: internalUtil.deprecate(
          function writableStateBufferGetter() {
            return this.getBuffer();
          },
          "_writableState.buffer is deprecated. Use _writableState.getBuffer " +
            "instead.",
          "DEP0003"
        ),
      });
    } catch (_) {}
  })();

  // Test _writableState for inheritance to account for Duplex streams,
  // whose prototype chain only points to Readable.
  var realHasInstance;
  if (
    typeof Symbol === "function" &&
    Symbol.hasInstance &&
    typeof Function.prototype[Symbol.hasInstance] === "function"
  ) {
    realHasInstance = Function.prototype[Symbol.hasInstance];
    Object.defineProperty(Writable, Symbol.hasInstance, {
      value: function value(object) {
        if (realHasInstance.call(this, object)) return true;
        if (this !== Writable) return false;
        return object && object._writableState instanceof WritableState;
      },
    });
  } else {
    realHasInstance = function realHasInstance(object) {
      return object instanceof this;
    };
  }
  function Writable(options) {
    Duplex = Duplex || require_stream_duplex();

    // Writable ctor is applied to Duplexes, too.
    // `realHasInstance` is necessary because using plain `instanceof`
    // would return false, as no `_writableState` property is attached.

    // Trying to use the custom `instanceof` for Writable here will also break the
    // Node.js LazyTransform implementation, which has a non-trivial getter for
    // `_writableState` that would lead to infinite recursion.

    // Checking for a Stream.Duplex instance is faster here instead of inside
    // the WritableState constructor, at least with V8 6.5
    var isDuplex = this instanceof Duplex;
    if (!isDuplex && !realHasInstance.call(Writable, this))
      return new Writable(options);
    this._writableState = new WritableState(options, this, isDuplex);

    // legacy.
    this.writable = true;
    if (options) {
      if (typeof options.write === "function") this._write = options.write;
      if (typeof options.writev === "function") this._writev = options.writev;
      if (typeof options.destroy === "function")
        this._destroy = options.destroy;
      if (typeof options.final === "function") this._final = options.final;
    }
    Stream.call(this);
  }

  // Otherwise people can pipe Writable streams, which is just wrong.
  Writable.prototype.pipe = function () {
    errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE());
  };
  function writeAfterEnd(stream, cb) {
    var er = new ERR_STREAM_WRITE_AFTER_END();
    // TODO: defer error events consistently everywhere, not just the cb
    errorOrDestroy(stream, er);
    process.nextTick(cb, er);
  }

  // Checks that a user-supplied chunk is valid, especially for the particular
  // mode the stream is in. Currently this means that `null` is never accepted
  // and undefined/non-string values are only allowed in object mode.
  function validChunk(stream, state, chunk, cb) {
    var er;
    if (chunk === null) {
      er = new ERR_STREAM_NULL_VALUES();
    } else if (typeof chunk !== "string" && !state.objectMode) {
      er = new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer"], chunk);
    }
    if (er) {
      errorOrDestroy(stream, er);
      process.nextTick(cb, er);
      return false;
    }
    return true;
  }
  Writable.prototype.write = function (chunk, encoding, cb) {
    var state = this._writableState;
    var ret = false;
    var isBuf = !state.objectMode && _isUint8Array(chunk);
    if (isBuf && !Buffer.isBuffer(chunk)) {
      chunk = _uint8ArrayToBuffer(chunk);
    }
    if (typeof encoding === "function") {
      cb = encoding;
      encoding = null;
    }
    if (isBuf) encoding = "buffer";
    else if (!encoding) encoding = state.defaultEncoding;
    if (typeof cb !== "function") cb = nop;
    if (state.ending) writeAfterEnd(this, cb);
    else if (isBuf || validChunk(this, state, chunk, cb)) {
      state.pendingcb++;
      ret = writeOrBuffer(this, state, isBuf, chunk, encoding, cb);
    }
    return ret;
  };
  Writable.prototype.cork = function () {
    this._writableState.corked++;
  };
  Writable.prototype.uncork = function () {
    var state = this._writableState;
    if (state.corked) {
      state.corked--;
      if (
        !state.writing &&
        !state.corked &&
        !state.bufferProcessing &&
        state.bufferedRequest
      )
        clearBuffer(this, state);
    }
  };
  Writable.prototype.setDefaultEncoding = function setDefaultEncoding(
    encoding
  ) {
    // node::ParseEncoding() requires lower case.
    if (typeof encoding === "string") encoding = encoding.toLowerCase();
    if (
      !(
        [
          "hex",
          "utf8",
          "utf-8",
          "ascii",
          "binary",
          "base64",
          "ucs2",
          "ucs-2",
          "utf16le",
          "utf-16le",
          "raw",
        ].indexOf((encoding + "").toLowerCase()) > -1
      )
    )
      throw new ERR_UNKNOWN_ENCODING(encoding);
    this._writableState.defaultEncoding = encoding;
    return this;
  };
  Object.defineProperty(Writable.prototype, "writableBuffer", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._writableState && this._writableState.getBuffer();
    },
  });
  function decodeChunk(state, chunk, encoding) {
    if (
      !state.objectMode &&
      state.decodeStrings !== false &&
      typeof chunk === "string"
    ) {
      chunk = Buffer.from(chunk, encoding);
    }
    return chunk;
  }
  Object.defineProperty(Writable.prototype, "writableHighWaterMark", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._writableState.highWaterMark;
    },
  });

  // if we're already writing something, then just put this
  // in the queue, and wait our turn.  Otherwise, call _write
  // If we return false, then we need a drain event, so set that flag.
  function writeOrBuffer(stream, state, isBuf, chunk, encoding, cb) {
    if (!isBuf) {
      var newChunk = decodeChunk(state, chunk, encoding);
      if (chunk !== newChunk) {
        isBuf = true;
        encoding = "buffer";
        chunk = newChunk;
      }
    }
    var len = state.objectMode ? 1 : chunk.length;
    state.length += len;
    var ret = state.length < state.highWaterMark;
    // we must ensure that previous needDrain will not be reset to false.
    if (!ret) state.needDrain = true;
    if (state.writing || state.corked) {
      var last = state.lastBufferedRequest;
      state.lastBufferedRequest = {
        chunk: chunk,
        encoding: encoding,
        isBuf: isBuf,
        callback: cb,
        next: null,
      };
      if (last) {
        last.next = state.lastBufferedRequest;
      } else {
        state.bufferedRequest = state.lastBufferedRequest;
      }
      state.bufferedRequestCount += 1;
    } else {
      doWrite(stream, state, false, len, chunk, encoding, cb);
    }
    return ret;
  }
  function doWrite(stream, state, writev, len, chunk, encoding, cb) {
    state.writelen = len;
    state.writecb = cb;
    state.writing = true;
    state.sync = true;
    if (state.destroyed) state.onwrite(new ERR_STREAM_DESTROYED("write"));
    else if (writev) stream._writev(chunk, state.onwrite);
    else stream._write(chunk, encoding, state.onwrite);
    state.sync = false;
  }
  function onwriteError(stream, state, sync, er, cb) {
    --state.pendingcb;
    if (sync) {
      // defer the callback if we are being called synchronously
      // to avoid piling up things on the stack
      process.nextTick(cb, er);
      // this can emit finish, and it will always happen
      // after error
      process.nextTick(finishMaybe, stream, state);
      stream._writableState.errorEmitted = true;
      errorOrDestroy(stream, er);
    } else {
      // the caller expect this to happen before if
      // it is async
      cb(er);
      stream._writableState.errorEmitted = true;
      errorOrDestroy(stream, er);
      // this can emit finish, but finish must
      // always follow error
      finishMaybe(stream, state);
    }
  }
  function onwriteStateUpdate(state) {
    state.writing = false;
    state.writecb = null;
    state.length -= state.writelen;
    state.writelen = 0;
  }
  function onwrite(stream, er) {
    var state = stream._writableState;
    var sync = state.sync;
    var cb = state.writecb;
    if (typeof cb !== "function") throw new ERR_MULTIPLE_CALLBACK();
    onwriteStateUpdate(state);
    if (er) onwriteError(stream, state, sync, er, cb);
    else {
      // Check if we're actually ready to finish, but don't emit yet
      var finished = needFinish(state) || stream.destroyed;
      if (
        !finished &&
        !state.corked &&
        !state.bufferProcessing &&
        state.bufferedRequest
      ) {
        clearBuffer(stream, state);
      }
      if (sync) {
        process.nextTick(afterWrite, stream, state, finished, cb);
      } else {
        afterWrite(stream, state, finished, cb);
      }
    }
  }
  function afterWrite(stream, state, finished, cb) {
    if (!finished) onwriteDrain(stream, state);
    state.pendingcb--;
    cb();
    finishMaybe(stream, state);
  }

  // Must force callback to be called on nextTick, so that we don't
  // emit 'drain' before the write() consumer gets the 'false' return
  // value, and has a chance to attach a 'drain' listener.
  function onwriteDrain(stream, state) {
    if (state.length === 0 && state.needDrain) {
      state.needDrain = false;
      stream.emit("drain");
    }
  }

  // if there's something in the buffer waiting, then process it
  function clearBuffer(stream, state) {
    state.bufferProcessing = true;
    var entry = state.bufferedRequest;
    if (stream._writev && entry && entry.next) {
      // Fast case, write everything using _writev()
      var l = state.bufferedRequestCount;
      var buffer = new Array(l);
      var holder = state.corkedRequestsFree;
      holder.entry = entry;
      var count = 0;
      var allBuffers = true;
      while (entry) {
        buffer[count] = entry;
        if (!entry.isBuf) allBuffers = false;
        entry = entry.next;
        count += 1;
      }
      buffer.allBuffers = allBuffers;
      doWrite(stream, state, true, state.length, buffer, "", holder.finish);

      // doWrite is almost always async, defer these to save a bit of time
      // as the hot path ends with doWrite
      state.pendingcb++;
      state.lastBufferedRequest = null;
      if (holder.next) {
        state.corkedRequestsFree = holder.next;
        holder.next = null;
      } else {
        state.corkedRequestsFree = new CorkedRequest(state);
      }
      state.bufferedRequestCount = 0;
    } else {
      // Slow case, write chunks one-by-one
      while (entry) {
        var chunk = entry.chunk;
        var encoding = entry.encoding;
        var cb = entry.callback;
        var len = state.objectMode ? 1 : chunk.length;
        doWrite(stream, state, false, len, chunk, encoding, cb);
        entry = entry.next;
        state.bufferedRequestCount--;
        // if we didn't call the onwrite immediately, then
        // it means that we need to wait until it does.
        // also, that means that the chunk and cb are currently
        // being processed, so move the buffer counter past them.
        if (state.writing) {
          break;
        }
      }
      if (entry === null) state.lastBufferedRequest = null;
    }
    state.bufferedRequest = entry;
    state.bufferProcessing = false;
  }
  Writable.prototype._write = function (chunk, encoding, cb) {
    cb(new ERR_METHOD_NOT_IMPLEMENTED("_write()"));
  };
  Writable.prototype._writev = null;
  Writable.prototype.end = function (chunk, encoding, cb) {
    var state = this._writableState;
    if (typeof chunk === "function") {
      cb = chunk;
      chunk = null;
      encoding = null;
    } else if (typeof encoding === "function") {
      cb = encoding;
      encoding = null;
    }
    if (chunk !== null && chunk !== undefined) this.write(chunk, encoding);

    // .end() fully uncorks
    if (state.corked) {
      state.corked = 1;
      this.uncork();
    }

    // ignore unnecessary end() calls.
    if (!state.ending) endWritable(this, state, cb);
    return this;
  };
  Object.defineProperty(Writable.prototype, "writableLength", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._writableState.length;
    },
  });
  function needFinish(state) {
    return (
      state.ending &&
      state.length === 0 &&
      state.bufferedRequest === null &&
      !state.finished &&
      !state.writing
    );
  }
  function callFinal(stream, state) {
    stream._final(function (err) {
      state.pendingcb--;
      if (err) {
        errorOrDestroy(stream, err);
      }
      state.prefinished = true;
      stream.emit("prefinish");
      finishMaybe(stream, state);
    });
  }
  function prefinish(stream, state) {
    if (!state.prefinished && !state.finalCalled) {
      if (typeof stream._final === "function" && !state.destroyed) {
        state.pendingcb++;
        state.finalCalled = true;
        process.nextTick(callFinal, stream, state);
      } else {
        state.prefinished = true;
        stream.emit("prefinish");
      }
    }
  }
  function finishMaybe(stream, state) {
    var need = needFinish(state);
    if (need) {
      prefinish(stream, state);
      if (state.pendingcb === 0) {
        state.finished = true;
        stream.emit("finish");
        if (state.autoDestroy) {
          // In case of duplex streams we need a way to detect
          // if the readable side is ready for autoDestroy as well
          var rState = stream._readableState;
          if (!rState || (rState.autoDestroy && rState.endEmitted)) {
            stream.destroy();
          }
        }
      }
    }
    return need;
  }
  function endWritable(stream, state, cb) {
    state.ending = true;
    finishMaybe(stream, state);
    if (cb) {
      if (state.finished) process.nextTick(cb);
      else stream.once("finish", cb);
    }
    state.ended = true;
    stream.writable = false;
  }
  function onCorkedFinish(corkReq, state, err) {
    var entry = corkReq.entry;
    corkReq.entry = null;
    while (entry) {
      var cb = entry.callback;
      state.pendingcb--;
      cb(err);
      entry = entry.next;
    }

    // reuse the free corkReq.
    state.corkedRequestsFree.next = corkReq;
  }
  Object.defineProperty(Writable.prototype, "destroyed", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      if (this._writableState === undefined) {
        return false;
      }
      return this._writableState.destroyed;
    },
    set: function set(value) {
      // we ignore the value if the stream
      // has not been initialized yet
      if (!this._writableState) {
        return;
      }

      // backward compatibility, the user is explicitly
      // managing destroyed
      this._writableState.destroyed = value;
    },
  });
  Writable.prototype.destroy = destroyImpl.destroy;
  Writable.prototype._undestroy = destroyImpl.undestroy;
  Writable.prototype._destroy = function (err, cb) {
    cb(err);
  };
  return _stream_writable;
}

var _stream_duplex;
var hasRequired_stream_duplex;

function require_stream_duplex() {
  if (hasRequired_stream_duplex) return _stream_duplex;
  hasRequired_stream_duplex = 1;

  /*<replacement>*/
  var objectKeys =
    Object.keys ||
    function (obj) {
      var keys = [];
      for (var key in obj) keys.push(key);
      return keys;
    };
  /*</replacement>*/

  _stream_duplex = Duplex;
  var Readable = require_stream_readable();
  var Writable = require_stream_writable();
  inheritsExports(Duplex, Readable);
  {
    // Allow the keys array to be GC'ed.
    var keys = objectKeys(Writable.prototype);
    for (var v = 0; v < keys.length; v++) {
      var method = keys[v];
      if (!Duplex.prototype[method])
        Duplex.prototype[method] = Writable.prototype[method];
    }
  }
  function Duplex(options) {
    if (!(this instanceof Duplex)) return new Duplex(options);
    Readable.call(this, options);
    Writable.call(this, options);
    this.allowHalfOpen = true;
    if (options) {
      if (options.readable === false) this.readable = false;
      if (options.writable === false) this.writable = false;
      if (options.allowHalfOpen === false) {
        this.allowHalfOpen = false;
        this.once("end", onend);
      }
    }
  }
  Object.defineProperty(Duplex.prototype, "writableHighWaterMark", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._writableState.highWaterMark;
    },
  });
  Object.defineProperty(Duplex.prototype, "writableBuffer", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._writableState && this._writableState.getBuffer();
    },
  });
  Object.defineProperty(Duplex.prototype, "writableLength", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._writableState.length;
    },
  });

  // the no-half-open enforcer
  function onend() {
    // If the writable side ended, then we're ok.
    if (this._writableState.ended) return;

    // no more data can be written.
    // But allow more writes to happen in this tick.
    process.nextTick(onEndNT, this);
  }
  function onEndNT(self) {
    self.end();
  }
  Object.defineProperty(Duplex.prototype, "destroyed", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      if (
        this._readableState === undefined ||
        this._writableState === undefined
      ) {
        return false;
      }
      return this._readableState.destroyed && this._writableState.destroyed;
    },
    set: function set(value) {
      // we ignore the value if the stream
      // has not been initialized yet
      if (
        this._readableState === undefined ||
        this._writableState === undefined
      ) {
        return;
      }

      // backward compatibility, the user is explicitly
      // managing destroyed
      this._readableState.destroyed = value;
      this._writableState.destroyed = value;
    },
  });
  return _stream_duplex;
}

var string_decoder = {};

var safeBuffer = { exports: {} };

/*! safe-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */

var hasRequiredSafeBuffer;

function requireSafeBuffer() {
  if (hasRequiredSafeBuffer) return safeBuffer.exports;
  hasRequiredSafeBuffer = 1;
  (function (module, exports) {
    /* eslint-disable node/no-deprecated-api */
    var buffer = require$$0$3;
    var Buffer = buffer.Buffer;

    // alternative to using Object.keys for old browsers
    function copyProps(src, dst) {
      for (var key in src) {
        dst[key] = src[key];
      }
    }
    if (
      Buffer.from &&
      Buffer.alloc &&
      Buffer.allocUnsafe &&
      Buffer.allocUnsafeSlow
    ) {
      module.exports = buffer;
    } else {
      // Copy properties from require('buffer')
      copyProps(buffer, exports);
      exports.Buffer = SafeBuffer;
    }

    function SafeBuffer(arg, encodingOrOffset, length) {
      return Buffer(arg, encodingOrOffset, length);
    }

    SafeBuffer.prototype = Object.create(Buffer.prototype);

    // Copy static methods from Buffer
    copyProps(Buffer, SafeBuffer);

    SafeBuffer.from = function (arg, encodingOrOffset, length) {
      if (typeof arg === "number") {
        throw new TypeError("Argument must not be a number");
      }
      return Buffer(arg, encodingOrOffset, length);
    };

    SafeBuffer.alloc = function (size, fill, encoding) {
      if (typeof size !== "number") {
        throw new TypeError("Argument must be a number");
      }
      var buf = Buffer(size);
      if (fill !== undefined) {
        if (typeof encoding === "string") {
          buf.fill(fill, encoding);
        } else {
          buf.fill(fill);
        }
      } else {
        buf.fill(0);
      }
      return buf;
    };

    SafeBuffer.allocUnsafe = function (size) {
      if (typeof size !== "number") {
        throw new TypeError("Argument must be a number");
      }
      return Buffer(size);
    };

    SafeBuffer.allocUnsafeSlow = function (size) {
      if (typeof size !== "number") {
        throw new TypeError("Argument must be a number");
      }
      return buffer.SlowBuffer(size);
    };
  })(safeBuffer, safeBuffer.exports);
  return safeBuffer.exports;
}

var hasRequiredString_decoder;

function requireString_decoder() {
  if (hasRequiredString_decoder) return string_decoder;
  hasRequiredString_decoder = 1;

  /*<replacement>*/

  var Buffer = requireSafeBuffer().Buffer;
  /*</replacement>*/

  var isEncoding =
    Buffer.isEncoding ||
    function (encoding) {
      encoding = "" + encoding;
      switch (encoding && encoding.toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
        case "raw":
          return true;
        default:
          return false;
      }
    };

  function _normalizeEncoding(enc) {
    if (!enc) return "utf8";
    var retried;
    while (true) {
      switch (enc) {
        case "utf8":
        case "utf-8":
          return "utf8";
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return "utf16le";
        case "latin1":
        case "binary":
          return "latin1";
        case "base64":
        case "ascii":
        case "hex":
          return enc;
        default:
          if (retried) return; // undefined
          enc = ("" + enc).toLowerCase();
          retried = true;
      }
    }
  }
  // Do not cache `Buffer.isEncoding` when checking encoding names as some
  // modules monkey-patch it to support additional encodings
  function normalizeEncoding(enc) {
    var nenc = _normalizeEncoding(enc);
    if (
      typeof nenc !== "string" &&
      (Buffer.isEncoding === isEncoding || !isEncoding(enc))
    )
      throw new Error("Unknown encoding: " + enc);
    return nenc || enc;
  }

  // StringDecoder provides an interface for efficiently splitting a series of
  // buffers into a series of JS strings without breaking apart multi-byte
  // characters.
  string_decoder.StringDecoder = StringDecoder;
  function StringDecoder(encoding) {
    this.encoding = normalizeEncoding(encoding);
    var nb;
    switch (this.encoding) {
      case "utf16le":
        this.text = utf16Text;
        this.end = utf16End;
        nb = 4;
        break;
      case "utf8":
        this.fillLast = utf8FillLast;
        nb = 4;
        break;
      case "base64":
        this.text = base64Text;
        this.end = base64End;
        nb = 3;
        break;
      default:
        this.write = simpleWrite;
        this.end = simpleEnd;
        return;
    }
    this.lastNeed = 0;
    this.lastTotal = 0;
    this.lastChar = Buffer.allocUnsafe(nb);
  }

  StringDecoder.prototype.write = function (buf) {
    if (buf.length === 0) return "";
    var r;
    var i;
    if (this.lastNeed) {
      r = this.fillLast(buf);
      if (r === undefined) return "";
      i = this.lastNeed;
      this.lastNeed = 0;
    } else {
      i = 0;
    }
    if (i < buf.length) return r ? r + this.text(buf, i) : this.text(buf, i);
    return r || "";
  };

  StringDecoder.prototype.end = utf8End;

  // Returns only complete characters in a Buffer
  StringDecoder.prototype.text = utf8Text;

  // Attempts to complete a partial non-UTF-8 character using bytes from a Buffer
  StringDecoder.prototype.fillLast = function (buf) {
    if (this.lastNeed <= buf.length) {
      buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
      return this.lastChar.toString(this.encoding, 0, this.lastTotal);
    }
    buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);
    this.lastNeed -= buf.length;
  };

  // Checks the type of a UTF-8 byte, whether it's ASCII, a leading byte, or a
  // continuation byte. If an invalid byte is detected, -2 is returned.
  function utf8CheckByte(byte) {
    if (byte <= 0x7f) return 0;
    else if (byte >> 5 === 0x06) return 2;
    else if (byte >> 4 === 0x0e) return 3;
    else if (byte >> 3 === 0x1e) return 4;
    return byte >> 6 === 0x02 ? -1 : -2;
  }

  // Checks at most 3 bytes at the end of a Buffer in order to detect an
  // incomplete multi-byte UTF-8 character. The total number of bytes (2, 3, or 4)
  // needed to complete the UTF-8 character (if applicable) are returned.
  function utf8CheckIncomplete(self, buf, i) {
    var j = buf.length - 1;
    if (j < i) return 0;
    var nb = utf8CheckByte(buf[j]);
    if (nb >= 0) {
      if (nb > 0) self.lastNeed = nb - 1;
      return nb;
    }
    if (--j < i || nb === -2) return 0;
    nb = utf8CheckByte(buf[j]);
    if (nb >= 0) {
      if (nb > 0) self.lastNeed = nb - 2;
      return nb;
    }
    if (--j < i || nb === -2) return 0;
    nb = utf8CheckByte(buf[j]);
    if (nb >= 0) {
      if (nb > 0) {
        if (nb === 2) nb = 0;
        else self.lastNeed = nb - 3;
      }
      return nb;
    }
    return 0;
  }

  // Validates as many continuation bytes for a multi-byte UTF-8 character as
  // needed or are available. If we see a non-continuation byte where we expect
  // one, we "replace" the validated continuation bytes we've seen so far with
  // a single UTF-8 replacement character ('\ufffd'), to match v8's UTF-8 decoding
  // behavior. The continuation byte check is included three times in the case
  // where all of the continuation bytes for a character exist in the same buffer.
  // It is also done this way as a slight performance increase instead of using a
  // loop.
  function utf8CheckExtraBytes(self, buf, p) {
    if ((buf[0] & 0xc0) !== 0x80) {
      self.lastNeed = 0;
      return "\ufffd";
    }
    if (self.lastNeed > 1 && buf.length > 1) {
      if ((buf[1] & 0xc0) !== 0x80) {
        self.lastNeed = 1;
        return "\ufffd";
      }
      if (self.lastNeed > 2 && buf.length > 2) {
        if ((buf[2] & 0xc0) !== 0x80) {
          self.lastNeed = 2;
          return "\ufffd";
        }
      }
    }
  }

  // Attempts to complete a multi-byte UTF-8 character using bytes from a Buffer.
  function utf8FillLast(buf) {
    var p = this.lastTotal - this.lastNeed;
    var r = utf8CheckExtraBytes(this, buf);
    if (r !== undefined) return r;
    if (this.lastNeed <= buf.length) {
      buf.copy(this.lastChar, p, 0, this.lastNeed);
      return this.lastChar.toString(this.encoding, 0, this.lastTotal);
    }
    buf.copy(this.lastChar, p, 0, buf.length);
    this.lastNeed -= buf.length;
  }

  // Returns all complete UTF-8 characters in a Buffer. If the Buffer ended on a
  // partial character, the character's bytes are buffered until the required
  // number of bytes are available.
  function utf8Text(buf, i) {
    var total = utf8CheckIncomplete(this, buf, i);
    if (!this.lastNeed) return buf.toString("utf8", i);
    this.lastTotal = total;
    var end = buf.length - (total - this.lastNeed);
    buf.copy(this.lastChar, 0, end);
    return buf.toString("utf8", i, end);
  }

  // For UTF-8, a replacement character is added when ending on a partial
  // character.
  function utf8End(buf) {
    var r = buf && buf.length ? this.write(buf) : "";
    if (this.lastNeed) return r + "\ufffd";
    return r;
  }

  // UTF-16LE typically needs two bytes per character, but even if we have an even
  // number of bytes available, we need to check if we end on a leading/high
  // surrogate. In that case, we need to wait for the next two bytes in order to
  // decode the last character properly.
  function utf16Text(buf, i) {
    if ((buf.length - i) % 2 === 0) {
      var r = buf.toString("utf16le", i);
      if (r) {
        var c = r.charCodeAt(r.length - 1);
        if (c >= 0xd800 && c <= 0xdbff) {
          this.lastNeed = 2;
          this.lastTotal = 4;
          this.lastChar[0] = buf[buf.length - 2];
          this.lastChar[1] = buf[buf.length - 1];
          return r.slice(0, -1);
        }
      }
      return r;
    }
    this.lastNeed = 1;
    this.lastTotal = 2;
    this.lastChar[0] = buf[buf.length - 1];
    return buf.toString("utf16le", i, buf.length - 1);
  }

  // For UTF-16LE we do not explicitly append special replacement characters if we
  // end on a partial character, we simply let v8 handle that.
  function utf16End(buf) {
    var r = buf && buf.length ? this.write(buf) : "";
    if (this.lastNeed) {
      var end = this.lastTotal - this.lastNeed;
      return r + this.lastChar.toString("utf16le", 0, end);
    }
    return r;
  }

  function base64Text(buf, i) {
    var n = (buf.length - i) % 3;
    if (n === 0) return buf.toString("base64", i);
    this.lastNeed = 3 - n;
    this.lastTotal = 3;
    if (n === 1) {
      this.lastChar[0] = buf[buf.length - 1];
    } else {
      this.lastChar[0] = buf[buf.length - 2];
      this.lastChar[1] = buf[buf.length - 1];
    }
    return buf.toString("base64", i, buf.length - n);
  }

  function base64End(buf) {
    var r = buf && buf.length ? this.write(buf) : "";
    if (this.lastNeed)
      return r + this.lastChar.toString("base64", 0, 3 - this.lastNeed);
    return r;
  }

  // Pass bytes on through for single-byte encodings (e.g. ascii, latin1, hex)
  function simpleWrite(buf) {
    return buf.toString(this.encoding);
  }

  function simpleEnd(buf) {
    return buf && buf.length ? this.write(buf) : "";
  }
  return string_decoder;
}

var endOfStream;
var hasRequiredEndOfStream;

function requireEndOfStream() {
  if (hasRequiredEndOfStream) return endOfStream;
  hasRequiredEndOfStream = 1;

  var ERR_STREAM_PREMATURE_CLOSE =
    requireErrors().codes.ERR_STREAM_PREMATURE_CLOSE;
  function once(callback) {
    var called = false;
    return function () {
      if (called) return;
      called = true;
      for (
        var _len = arguments.length, args = new Array(_len), _key = 0;
        _key < _len;
        _key++
      ) {
        args[_key] = arguments[_key];
      }
      callback.apply(this, args);
    };
  }
  function noop() {}
  function isRequest(stream) {
    return stream.setHeader && typeof stream.abort === "function";
  }
  function eos(stream, opts, callback) {
    if (typeof opts === "function") return eos(stream, null, opts);
    if (!opts) opts = {};
    callback = once(callback || noop);
    var readable =
      opts.readable || (opts.readable !== false && stream.readable);
    var writable =
      opts.writable || (opts.writable !== false && stream.writable);
    var onlegacyfinish = function onlegacyfinish() {
      if (!stream.writable) onfinish();
    };
    var writableEnded = stream._writableState && stream._writableState.finished;
    var onfinish = function onfinish() {
      writable = false;
      writableEnded = true;
      if (!readable) callback.call(stream);
    };
    var readableEnded =
      stream._readableState && stream._readableState.endEmitted;
    var onend = function onend() {
      readable = false;
      readableEnded = true;
      if (!writable) callback.call(stream);
    };
    var onerror = function onerror(err) {
      callback.call(stream, err);
    };
    var onclose = function onclose() {
      var err;
      if (readable && !readableEnded) {
        if (!stream._readableState || !stream._readableState.ended)
          err = new ERR_STREAM_PREMATURE_CLOSE();
        return callback.call(stream, err);
      }
      if (writable && !writableEnded) {
        if (!stream._writableState || !stream._writableState.ended)
          err = new ERR_STREAM_PREMATURE_CLOSE();
        return callback.call(stream, err);
      }
    };
    var onrequest = function onrequest() {
      stream.req.on("finish", onfinish);
    };
    if (isRequest(stream)) {
      stream.on("complete", onfinish);
      stream.on("abort", onclose);
      if (stream.req) onrequest();
      else stream.on("request", onrequest);
    } else if (writable && !stream._writableState) {
      // legacy streams
      stream.on("end", onlegacyfinish);
      stream.on("close", onlegacyfinish);
    }
    stream.on("end", onend);
    stream.on("finish", onfinish);
    if (opts.error !== false) stream.on("error", onerror);
    stream.on("close", onclose);
    return function () {
      stream.removeListener("complete", onfinish);
      stream.removeListener("abort", onclose);
      stream.removeListener("request", onrequest);
      if (stream.req) stream.req.removeListener("finish", onfinish);
      stream.removeListener("end", onlegacyfinish);
      stream.removeListener("close", onlegacyfinish);
      stream.removeListener("finish", onfinish);
      stream.removeListener("end", onend);
      stream.removeListener("error", onerror);
      stream.removeListener("close", onclose);
    };
  }
  endOfStream = eos;
  return endOfStream;
}

var async_iterator;
var hasRequiredAsync_iterator;

function requireAsync_iterator() {
  if (hasRequiredAsync_iterator) return async_iterator;
  hasRequiredAsync_iterator = 1;

  var _Object$setPrototypeO;
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value: value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _toPropertyKey(arg) {
    var key = _toPrimitive(arg, "string");
    return typeof key === "symbol" ? key : String(key);
  }
  function _toPrimitive(input, hint) {
    if (typeof input !== "object" || input === null) return input;
    var prim = input[Symbol.toPrimitive];
    if (prim !== undefined) {
      var res = prim.call(input, hint || "default");
      if (typeof res !== "object") return res;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (hint === "string" ? String : Number)(input);
  }
  var finished = requireEndOfStream();
  var kLastResolve = Symbol("lastResolve");
  var kLastReject = Symbol("lastReject");
  var kError = Symbol("error");
  var kEnded = Symbol("ended");
  var kLastPromise = Symbol("lastPromise");
  var kHandlePromise = Symbol("handlePromise");
  var kStream = Symbol("stream");
  function createIterResult(value, done) {
    return {
      value: value,
      done: done,
    };
  }
  function readAndResolve(iter) {
    var resolve = iter[kLastResolve];
    if (resolve !== null) {
      var data = iter[kStream].read();
      // we defer if data is null
      // we can be expecting either 'end' or
      // 'error'
      if (data !== null) {
        iter[kLastPromise] = null;
        iter[kLastResolve] = null;
        iter[kLastReject] = null;
        resolve(createIterResult(data, false));
      }
    }
  }
  function onReadable(iter) {
    // we wait for the next tick, because it might
    // emit an error with process.nextTick
    process.nextTick(readAndResolve, iter);
  }
  function wrapForNext(lastPromise, iter) {
    return function (resolve, reject) {
      lastPromise.then(function () {
        if (iter[kEnded]) {
          resolve(createIterResult(undefined, true));
          return;
        }
        iter[kHandlePromise](resolve, reject);
      }, reject);
    };
  }
  var AsyncIteratorPrototype = Object.getPrototypeOf(function () {});
  var ReadableStreamAsyncIteratorPrototype = Object.setPrototypeOf(
    ((_Object$setPrototypeO = {
      get stream() {
        return this[kStream];
      },
      next: function next() {
        var _this = this;
        // if we have detected an error in the meanwhile
        // reject straight away
        var error = this[kError];
        if (error !== null) {
          return Promise.reject(error);
        }
        if (this[kEnded]) {
          return Promise.resolve(createIterResult(undefined, true));
        }
        if (this[kStream].destroyed) {
          // We need to defer via nextTick because if .destroy(err) is
          // called, the error will be emitted via nextTick, and
          // we cannot guarantee that there is no error lingering around
          // waiting to be emitted.
          return new Promise(function (resolve, reject) {
            process.nextTick(function () {
              if (_this[kError]) {
                reject(_this[kError]);
              } else {
                resolve(createIterResult(undefined, true));
              }
            });
          });
        }

        // if we have multiple next() calls
        // we will wait for the previous Promise to finish
        // this logic is optimized to support for await loops,
        // where next() is only called once at a time
        var lastPromise = this[kLastPromise];
        var promise;
        if (lastPromise) {
          promise = new Promise(wrapForNext(lastPromise, this));
        } else {
          // fast path needed to support multiple this.push()
          // without triggering the next() queue
          var data = this[kStream].read();
          if (data !== null) {
            return Promise.resolve(createIterResult(data, false));
          }
          promise = new Promise(this[kHandlePromise]);
        }
        this[kLastPromise] = promise;
        return promise;
      },
    }),
    _defineProperty(_Object$setPrototypeO, Symbol.asyncIterator, function () {
      return this;
    }),
    _defineProperty(_Object$setPrototypeO, "return", function _return() {
      var _this2 = this;
      // destroy(err, cb) is a private API
      // we can guarantee we have that here, because we control the
      // Readable class this is attached to
      return new Promise(function (resolve, reject) {
        _this2[kStream].destroy(null, function (err) {
          if (err) {
            reject(err);
            return;
          }
          resolve(createIterResult(undefined, true));
        });
      });
    }),
    _Object$setPrototypeO),
    AsyncIteratorPrototype
  );
  var createReadableStreamAsyncIterator =
    function createReadableStreamAsyncIterator(stream) {
      var _Object$create;
      var iterator = Object.create(
        ReadableStreamAsyncIteratorPrototype,
        ((_Object$create = {}),
        _defineProperty(_Object$create, kStream, {
          value: stream,
          writable: true,
        }),
        _defineProperty(_Object$create, kLastResolve, {
          value: null,
          writable: true,
        }),
        _defineProperty(_Object$create, kLastReject, {
          value: null,
          writable: true,
        }),
        _defineProperty(_Object$create, kError, {
          value: null,
          writable: true,
        }),
        _defineProperty(_Object$create, kEnded, {
          value: stream._readableState.endEmitted,
          writable: true,
        }),
        _defineProperty(_Object$create, kHandlePromise, {
          value: function value(resolve, reject) {
            var data = iterator[kStream].read();
            if (data) {
              iterator[kLastPromise] = null;
              iterator[kLastResolve] = null;
              iterator[kLastReject] = null;
              resolve(createIterResult(data, false));
            } else {
              iterator[kLastResolve] = resolve;
              iterator[kLastReject] = reject;
            }
          },
          writable: true,
        }),
        _Object$create)
      );
      iterator[kLastPromise] = null;
      finished(stream, function (err) {
        if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
          var reject = iterator[kLastReject];
          // reject if we are waiting for data in the Promise
          // returned by next() and store the error
          if (reject !== null) {
            iterator[kLastPromise] = null;
            iterator[kLastResolve] = null;
            iterator[kLastReject] = null;
            reject(err);
          }
          iterator[kError] = err;
          return;
        }
        var resolve = iterator[kLastResolve];
        if (resolve !== null) {
          iterator[kLastPromise] = null;
          iterator[kLastResolve] = null;
          iterator[kLastReject] = null;
          resolve(createIterResult(undefined, true));
        }
        iterator[kEnded] = true;
      });
      stream.on("readable", onReadable.bind(null, iterator));
      return iterator;
    };
  async_iterator = createReadableStreamAsyncIterator;
  return async_iterator;
}

var from_1;
var hasRequiredFrom;

function requireFrom() {
  if (hasRequiredFrom) return from_1;
  hasRequiredFrom = 1;

  function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
    try {
      var info = gen[key](arg);
      var value = info.value;
    } catch (error) {
      reject(error);
      return;
    }
    if (info.done) {
      resolve(value);
    } else {
      Promise.resolve(value).then(_next, _throw);
    }
  }
  function _asyncToGenerator(fn) {
    return function () {
      var self = this,
        args = arguments;
      return new Promise(function (resolve, reject) {
        var gen = fn.apply(self, args);
        function _next(value) {
          asyncGeneratorStep(
            gen,
            resolve,
            reject,
            _next,
            _throw,
            "next",
            value
          );
        }
        function _throw(err) {
          asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
        }
        _next(undefined);
      });
    };
  }
  function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object);
      enumerableOnly &&
        (symbols = symbols.filter(function (sym) {
          return Object.getOwnPropertyDescriptor(object, sym).enumerable;
        })),
        keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {};
      i % 2
        ? ownKeys(Object(source), !0).forEach(function (key) {
            _defineProperty(target, key, source[key]);
          })
        : Object.getOwnPropertyDescriptors
        ? Object.defineProperties(
            target,
            Object.getOwnPropertyDescriptors(source)
          )
        : ownKeys(Object(source)).forEach(function (key) {
            Object.defineProperty(
              target,
              key,
              Object.getOwnPropertyDescriptor(source, key)
            );
          });
    }
    return target;
  }
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value: value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _toPropertyKey(arg) {
    var key = _toPrimitive(arg, "string");
    return typeof key === "symbol" ? key : String(key);
  }
  function _toPrimitive(input, hint) {
    if (typeof input !== "object" || input === null) return input;
    var prim = input[Symbol.toPrimitive];
    if (prim !== undefined) {
      var res = prim.call(input, hint || "default");
      if (typeof res !== "object") return res;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (hint === "string" ? String : Number)(input);
  }
  var ERR_INVALID_ARG_TYPE = requireErrors().codes.ERR_INVALID_ARG_TYPE;
  function from(Readable, iterable, opts) {
    var iterator;
    if (iterable && typeof iterable.next === "function") {
      iterator = iterable;
    } else if (iterable && iterable[Symbol.asyncIterator])
      iterator = iterable[Symbol.asyncIterator]();
    else if (iterable && iterable[Symbol.iterator])
      iterator = iterable[Symbol.iterator]();
    else throw new ERR_INVALID_ARG_TYPE("iterable", ["Iterable"], iterable);
    var readable = new Readable(
      _objectSpread(
        {
          objectMode: true,
        },
        opts
      )
    );
    // Reading boolean to protect against _read
    // being called before last iteration completion.
    var reading = false;
    readable._read = function () {
      if (!reading) {
        reading = true;
        next();
      }
    };
    function next() {
      return _next2.apply(this, arguments);
    }
    function _next2() {
      _next2 = _asyncToGenerator(function* () {
        try {
          var _yield$iterator$next = yield iterator.next(),
            value = _yield$iterator$next.value,
            done = _yield$iterator$next.done;
          if (done) {
            readable.push(null);
          } else if (readable.push(yield value)) {
            next();
          } else {
            reading = false;
          }
        } catch (err) {
          readable.destroy(err);
        }
      });
      return _next2.apply(this, arguments);
    }
    return readable;
  }
  from_1 = from;
  return from_1;
}

var _stream_readable;
var hasRequired_stream_readable;

function require_stream_readable() {
  if (hasRequired_stream_readable) return _stream_readable;
  hasRequired_stream_readable = 1;

  _stream_readable = Readable;

  /*<replacement>*/
  var Duplex;
  /*</replacement>*/

  Readable.ReadableState = ReadableState;

  /*<replacement>*/
  require$$2.EventEmitter;
  var EElistenerCount = function EElistenerCount(emitter, type) {
    return emitter.listeners(type).length;
  };
  /*</replacement>*/

  /*<replacement>*/
  var Stream = requireStream();
  /*</replacement>*/

  var Buffer = require$$0$3.Buffer;
  var OurUint8Array =
    (typeof commonjsGlobal !== "undefined"
      ? commonjsGlobal
      : typeof window !== "undefined"
      ? window
      : typeof self !== "undefined"
      ? self
      : {}
    ).Uint8Array || function () {};
  function _uint8ArrayToBuffer(chunk) {
    return Buffer.from(chunk);
  }
  function _isUint8Array(obj) {
    return Buffer.isBuffer(obj) || obj instanceof OurUint8Array;
  }

  /*<replacement>*/
  var debugUtil = require$$1;
  var debug;
  if (debugUtil && debugUtil.debuglog) {
    debug = debugUtil.debuglog("stream");
  } else {
    debug = function debug() {};
  }
  /*</replacement>*/

  var BufferList = requireBuffer_list();
  var destroyImpl = requireDestroy();
  var _require = requireState(),
    getHighWaterMark = _require.getHighWaterMark;
  var _require$codes = requireErrors().codes,
    ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE,
    ERR_STREAM_PUSH_AFTER_EOF = _require$codes.ERR_STREAM_PUSH_AFTER_EOF,
    ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED,
    ERR_STREAM_UNSHIFT_AFTER_END_EVENT =
      _require$codes.ERR_STREAM_UNSHIFT_AFTER_END_EVENT;

  // Lazy loaded to improve the startup performance.
  var StringDecoder;
  var createReadableStreamAsyncIterator;
  var from;
  inheritsExports(Readable, Stream);
  var errorOrDestroy = destroyImpl.errorOrDestroy;
  var kProxyEvents = ["error", "close", "destroy", "pause", "resume"];
  function prependListener(emitter, event, fn) {
    // Sadly this is not cacheable as some libraries bundle their own
    // event emitter implementation with them.
    if (typeof emitter.prependListener === "function")
      return emitter.prependListener(event, fn);

    // This is a hack to make sure that our error handler is attached before any
    // userland ones.  NEVER DO THIS. This is here only because this code needs
    // to continue to work with older versions of Node.js that do not include
    // the prependListener() method. The goal is to eventually remove this hack.
    if (!emitter._events || !emitter._events[event]) emitter.on(event, fn);
    else if (Array.isArray(emitter._events[event]))
      emitter._events[event].unshift(fn);
    else emitter._events[event] = [fn, emitter._events[event]];
  }
  function ReadableState(options, stream, isDuplex) {
    Duplex = Duplex || require_stream_duplex();
    options = options || {};

    // Duplex streams are both readable and writable, but share
    // the same options object.
    // However, some cases require setting options to different
    // values for the readable and the writable sides of the duplex stream.
    // These options can be provided separately as readableXXX and writableXXX.
    if (typeof isDuplex !== "boolean") isDuplex = stream instanceof Duplex;

    // object stream flag. Used to make read(n) ignore n and to
    // make all the buffer merging and length checks go away
    this.objectMode = !!options.objectMode;
    if (isDuplex)
      this.objectMode = this.objectMode || !!options.readableObjectMode;

    // the point at which it stops calling _read() to fill the buffer
    // Note: 0 is a valid value, means "don't call _read preemptively ever"
    this.highWaterMark = getHighWaterMark(
      this,
      options,
      "readableHighWaterMark",
      isDuplex
    );

    // A linked list is used to store data chunks instead of an array because the
    // linked list can remove elements from the beginning faster than
    // array.shift()
    this.buffer = new BufferList();
    this.length = 0;
    this.pipes = null;
    this.pipesCount = 0;
    this.flowing = null;
    this.ended = false;
    this.endEmitted = false;
    this.reading = false;

    // a flag to be able to tell if the event 'readable'/'data' is emitted
    // immediately, or on a later tick.  We set this to true at first, because
    // any actions that shouldn't happen until "later" should generally also
    // not happen before the first read call.
    this.sync = true;

    // whenever we return null, then we set a flag to say
    // that we're awaiting a 'readable' event emission.
    this.needReadable = false;
    this.emittedReadable = false;
    this.readableListening = false;
    this.resumeScheduled = false;
    this.paused = true;

    // Should close be emitted on destroy. Defaults to true.
    this.emitClose = options.emitClose !== false;

    // Should .destroy() be called after 'end' (and potentially 'finish')
    this.autoDestroy = !!options.autoDestroy;

    // has it been destroyed
    this.destroyed = false;

    // Crypto is kind of old and crusty.  Historically, its default string
    // encoding is 'binary' so we have to make this configurable.
    // Everything else in the universe uses 'utf8', though.
    this.defaultEncoding = options.defaultEncoding || "utf8";

    // the number of writers that are awaiting a drain event in .pipe()s
    this.awaitDrain = 0;

    // if true, a maybeReadMore has been scheduled
    this.readingMore = false;
    this.decoder = null;
    this.encoding = null;
    if (options.encoding) {
      if (!StringDecoder) StringDecoder = requireString_decoder().StringDecoder;
      this.decoder = new StringDecoder(options.encoding);
      this.encoding = options.encoding;
    }
  }
  function Readable(options) {
    Duplex = Duplex || require_stream_duplex();
    if (!(this instanceof Readable)) return new Readable(options);

    // Checking for a Stream.Duplex instance is faster here instead of inside
    // the ReadableState constructor, at least with V8 6.5
    var isDuplex = this instanceof Duplex;
    this._readableState = new ReadableState(options, this, isDuplex);

    // legacy
    this.readable = true;
    if (options) {
      if (typeof options.read === "function") this._read = options.read;
      if (typeof options.destroy === "function")
        this._destroy = options.destroy;
    }
    Stream.call(this);
  }
  Object.defineProperty(Readable.prototype, "destroyed", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      if (this._readableState === undefined) {
        return false;
      }
      return this._readableState.destroyed;
    },
    set: function set(value) {
      // we ignore the value if the stream
      // has not been initialized yet
      if (!this._readableState) {
        return;
      }

      // backward compatibility, the user is explicitly
      // managing destroyed
      this._readableState.destroyed = value;
    },
  });
  Readable.prototype.destroy = destroyImpl.destroy;
  Readable.prototype._undestroy = destroyImpl.undestroy;
  Readable.prototype._destroy = function (err, cb) {
    cb(err);
  };

  // Manually shove something into the read() buffer.
  // This returns true if the highWaterMark has not been hit yet,
  // similar to how Writable.write() returns true if you should
  // write() some more.
  Readable.prototype.push = function (chunk, encoding) {
    var state = this._readableState;
    var skipChunkCheck;
    if (!state.objectMode) {
      if (typeof chunk === "string") {
        encoding = encoding || state.defaultEncoding;
        if (encoding !== state.encoding) {
          chunk = Buffer.from(chunk, encoding);
          encoding = "";
        }
        skipChunkCheck = true;
      }
    } else {
      skipChunkCheck = true;
    }
    return readableAddChunk(this, chunk, encoding, false, skipChunkCheck);
  };

  // Unshift should *always* be something directly out of read()
  Readable.prototype.unshift = function (chunk) {
    return readableAddChunk(this, chunk, null, true, false);
  };
  function readableAddChunk(
    stream,
    chunk,
    encoding,
    addToFront,
    skipChunkCheck
  ) {
    debug("readableAddChunk", chunk);
    var state = stream._readableState;
    if (chunk === null) {
      state.reading = false;
      onEofChunk(stream, state);
    } else {
      var er;
      if (!skipChunkCheck) er = chunkInvalid(state, chunk);
      if (er) {
        errorOrDestroy(stream, er);
      } else if (state.objectMode || (chunk && chunk.length > 0)) {
        if (
          typeof chunk !== "string" &&
          !state.objectMode &&
          Object.getPrototypeOf(chunk) !== Buffer.prototype
        ) {
          chunk = _uint8ArrayToBuffer(chunk);
        }
        if (addToFront) {
          if (state.endEmitted)
            errorOrDestroy(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT());
          else addChunk(stream, state, chunk, true);
        } else if (state.ended) {
          errorOrDestroy(stream, new ERR_STREAM_PUSH_AFTER_EOF());
        } else if (state.destroyed) {
          return false;
        } else {
          state.reading = false;
          if (state.decoder && !encoding) {
            chunk = state.decoder.write(chunk);
            if (state.objectMode || chunk.length !== 0)
              addChunk(stream, state, chunk, false);
            else maybeReadMore(stream, state);
          } else {
            addChunk(stream, state, chunk, false);
          }
        }
      } else if (!addToFront) {
        state.reading = false;
        maybeReadMore(stream, state);
      }
    }

    // We can push more data if we are below the highWaterMark.
    // Also, if we have no data yet, we can stand some more bytes.
    // This is to work around cases where hwm=0, such as the repl.
    return (
      !state.ended && (state.length < state.highWaterMark || state.length === 0)
    );
  }
  function addChunk(stream, state, chunk, addToFront) {
    if (state.flowing && state.length === 0 && !state.sync) {
      state.awaitDrain = 0;
      stream.emit("data", chunk);
    } else {
      // update the buffer info.
      state.length += state.objectMode ? 1 : chunk.length;
      if (addToFront) state.buffer.unshift(chunk);
      else state.buffer.push(chunk);
      if (state.needReadable) emitReadable(stream);
    }
    maybeReadMore(stream, state);
  }
  function chunkInvalid(state, chunk) {
    var er;
    if (
      !_isUint8Array(chunk) &&
      typeof chunk !== "string" &&
      chunk !== undefined &&
      !state.objectMode
    ) {
      er = new ERR_INVALID_ARG_TYPE(
        "chunk",
        ["string", "Buffer", "Uint8Array"],
        chunk
      );
    }
    return er;
  }
  Readable.prototype.isPaused = function () {
    return this._readableState.flowing === false;
  };

  // backwards compatibility.
  Readable.prototype.setEncoding = function (enc) {
    if (!StringDecoder) StringDecoder = requireString_decoder().StringDecoder;
    var decoder = new StringDecoder(enc);
    this._readableState.decoder = decoder;
    // If setEncoding(null), decoder.encoding equals utf8
    this._readableState.encoding = this._readableState.decoder.encoding;

    // Iterate over current buffer to convert already stored Buffers:
    var p = this._readableState.buffer.head;
    var content = "";
    while (p !== null) {
      content += decoder.write(p.data);
      p = p.next;
    }
    this._readableState.buffer.clear();
    if (content !== "") this._readableState.buffer.push(content);
    this._readableState.length = content.length;
    return this;
  };

  // Don't raise the hwm > 1GB
  var MAX_HWM = 0x40000000;
  function computeNewHighWaterMark(n) {
    if (n >= MAX_HWM) {
      // TODO(ronag): Throw ERR_VALUE_OUT_OF_RANGE.
      n = MAX_HWM;
    } else {
      // Get the next highest power of 2 to prevent increasing hwm excessively in
      // tiny amounts
      n--;
      n |= n >>> 1;
      n |= n >>> 2;
      n |= n >>> 4;
      n |= n >>> 8;
      n |= n >>> 16;
      n++;
    }
    return n;
  }

  // This function is designed to be inlinable, so please take care when making
  // changes to the function body.
  function howMuchToRead(n, state) {
    if (n <= 0 || (state.length === 0 && state.ended)) return 0;
    if (state.objectMode) return 1;
    if (n !== n) {
      // Only flow one buffer at a time
      if (state.flowing && state.length) return state.buffer.head.data.length;
      else return state.length;
    }
    // If we're asking for more than the current hwm, then raise the hwm.
    if (n > state.highWaterMark)
      state.highWaterMark = computeNewHighWaterMark(n);
    if (n <= state.length) return n;
    // Don't have enough
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    }
    return state.length;
  }

  // you can override either this method, or the async _read(n) below.
  Readable.prototype.read = function (n) {
    debug("read", n);
    n = parseInt(n, 10);
    var state = this._readableState;
    var nOrig = n;
    if (n !== 0) state.emittedReadable = false;

    // if we're doing read(0) to trigger a readable event, but we
    // already have a bunch of data in the buffer, then just trigger
    // the 'readable' event and move on.
    if (
      n === 0 &&
      state.needReadable &&
      ((state.highWaterMark !== 0
        ? state.length >= state.highWaterMark
        : state.length > 0) ||
        state.ended)
    ) {
      debug("read: emitReadable", state.length, state.ended);
      if (state.length === 0 && state.ended) endReadable(this);
      else emitReadable(this);
      return null;
    }
    n = howMuchToRead(n, state);

    // if we've ended, and we're now clear, then finish it up.
    if (n === 0 && state.ended) {
      if (state.length === 0) endReadable(this);
      return null;
    }

    // All the actual chunk generation logic needs to be
    // *below* the call to _read.  The reason is that in certain
    // synthetic stream cases, such as passthrough streams, _read
    // may be a completely synchronous operation which may change
    // the state of the read buffer, providing enough data when
    // before there was *not* enough.
    //
    // So, the steps are:
    // 1. Figure out what the state of things will be after we do
    // a read from the buffer.
    //
    // 2. If that resulting state will trigger a _read, then call _read.
    // Note that this may be asynchronous, or synchronous.  Yes, it is
    // deeply ugly to write APIs this way, but that still doesn't mean
    // that the Readable class should behave improperly, as streams are
    // designed to be sync/async agnostic.
    // Take note if the _read call is sync or async (ie, if the read call
    // has returned yet), so that we know whether or not it's safe to emit
    // 'readable' etc.
    //
    // 3. Actually pull the requested chunks out of the buffer and return.

    // if we need a readable event, then we need to do some reading.
    var doRead = state.needReadable;
    debug("need readable", doRead);

    // if we currently have less than the highWaterMark, then also read some
    if (state.length === 0 || state.length - n < state.highWaterMark) {
      doRead = true;
      debug("length less than watermark", doRead);
    }

    // however, if we've ended, then there's no point, and if we're already
    // reading, then it's unnecessary.
    if (state.ended || state.reading) {
      doRead = false;
      debug("reading or ended", doRead);
    } else if (doRead) {
      debug("do read");
      state.reading = true;
      state.sync = true;
      // if the length is currently zero, then we *need* a readable event.
      if (state.length === 0) state.needReadable = true;
      // call internal read method
      this._read(state.highWaterMark);
      state.sync = false;
      // If _read pushed data synchronously, then `reading` will be false,
      // and we need to re-evaluate how much data we can return to the user.
      if (!state.reading) n = howMuchToRead(nOrig, state);
    }
    var ret;
    if (n > 0) ret = fromList(n, state);
    else ret = null;
    if (ret === null) {
      state.needReadable = state.length <= state.highWaterMark;
      n = 0;
    } else {
      state.length -= n;
      state.awaitDrain = 0;
    }
    if (state.length === 0) {
      // If we have nothing in the buffer, then we want to know
      // as soon as we *do* get something into the buffer.
      if (!state.ended) state.needReadable = true;

      // If we tried to read() past the EOF, then emit end on the next tick.
      if (nOrig !== n && state.ended) endReadable(this);
    }
    if (ret !== null) this.emit("data", ret);
    return ret;
  };
  function onEofChunk(stream, state) {
    debug("onEofChunk");
    if (state.ended) return;
    if (state.decoder) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length) {
        state.buffer.push(chunk);
        state.length += state.objectMode ? 1 : chunk.length;
      }
    }
    state.ended = true;
    if (state.sync) {
      // if we are sync, wait until next tick to emit the data.
      // Otherwise we risk emitting data in the flow()
      // the readable code triggers during a read() call
      emitReadable(stream);
    } else {
      // emit 'readable' now to make sure it gets picked up.
      state.needReadable = false;
      if (!state.emittedReadable) {
        state.emittedReadable = true;
        emitReadable_(stream);
      }
    }
  }

  // Don't emit readable right away in sync mode, because this can trigger
  // another read() call => stack overflow.  This way, it might trigger
  // a nextTick recursion warning, but that's not so bad.
  function emitReadable(stream) {
    var state = stream._readableState;
    debug("emitReadable", state.needReadable, state.emittedReadable);
    state.needReadable = false;
    if (!state.emittedReadable) {
      debug("emitReadable", state.flowing);
      state.emittedReadable = true;
      process.nextTick(emitReadable_, stream);
    }
  }
  function emitReadable_(stream) {
    var state = stream._readableState;
    debug("emitReadable_", state.destroyed, state.length, state.ended);
    if (!state.destroyed && (state.length || state.ended)) {
      stream.emit("readable");
      state.emittedReadable = false;
    }

    // The stream needs another readable event if
    // 1. It is not flowing, as the flow mechanism will take
    //    care of it.
    // 2. It is not ended.
    // 3. It is below the highWaterMark, so we can schedule
    //    another readable later.
    state.needReadable =
      !state.flowing && !state.ended && state.length <= state.highWaterMark;
    flow(stream);
  }

  // at this point, the user has presumably seen the 'readable' event,
  // and called read() to consume some data.  that may have triggered
  // in turn another _read(n) call, in which case reading = true if
  // it's in progress.
  // However, if we're not ended, or reading, and the length < hwm,
  // then go ahead and try to read some more preemptively.
  function maybeReadMore(stream, state) {
    if (!state.readingMore) {
      state.readingMore = true;
      process.nextTick(maybeReadMore_, stream, state);
    }
  }
  function maybeReadMore_(stream, state) {
    // Attempt to read more data if we should.
    //
    // The conditions for reading more data are (one of):
    // - Not enough data buffered (state.length < state.highWaterMark). The loop
    //   is responsible for filling the buffer with enough data if such data
    //   is available. If highWaterMark is 0 and we are not in the flowing mode
    //   we should _not_ attempt to buffer any extra data. We'll get more data
    //   when the stream consumer calls read() instead.
    // - No data in the buffer, and the stream is in flowing mode. In this mode
    //   the loop below is responsible for ensuring read() is called. Failing to
    //   call read here would abort the flow and there's no other mechanism for
    //   continuing the flow if the stream consumer has just subscribed to the
    //   'data' event.
    //
    // In addition to the above conditions to keep reading data, the following
    // conditions prevent the data from being read:
    // - The stream has ended (state.ended).
    // - There is already a pending 'read' operation (state.reading). This is a
    //   case where the the stream has called the implementation defined _read()
    //   method, but they are processing the call asynchronously and have _not_
    //   called push() with new data. In this case we skip performing more
    //   read()s. The execution ends in this method again after the _read() ends
    //   up calling push() with more data.
    while (
      !state.reading &&
      !state.ended &&
      (state.length < state.highWaterMark ||
        (state.flowing && state.length === 0))
    ) {
      var len = state.length;
      debug("maybeReadMore read 0");
      stream.read(0);
      if (len === state.length)
        // didn't get any data, stop spinning.
        break;
    }
    state.readingMore = false;
  }

  // abstract method.  to be overridden in specific implementation classes.
  // call cb(er, data) where data is <= n in length.
  // for virtual (non-string, non-buffer) streams, "length" is somewhat
  // arbitrary, and perhaps not very meaningful.
  Readable.prototype._read = function (n) {
    errorOrDestroy(this, new ERR_METHOD_NOT_IMPLEMENTED("_read()"));
  };
  Readable.prototype.pipe = function (dest, pipeOpts) {
    var src = this;
    var state = this._readableState;
    switch (state.pipesCount) {
      case 0:
        state.pipes = dest;
        break;
      case 1:
        state.pipes = [state.pipes, dest];
        break;
      default:
        state.pipes.push(dest);
        break;
    }
    state.pipesCount += 1;
    debug("pipe count=%d opts=%j", state.pipesCount, pipeOpts);
    var doEnd =
      (!pipeOpts || pipeOpts.end !== false) &&
      dest !== process.stdout &&
      dest !== process.stderr;
    var endFn = doEnd ? onend : unpipe;
    if (state.endEmitted) process.nextTick(endFn);
    else src.once("end", endFn);
    dest.on("unpipe", onunpipe);
    function onunpipe(readable, unpipeInfo) {
      debug("onunpipe");
      if (readable === src) {
        if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
          unpipeInfo.hasUnpiped = true;
          cleanup();
        }
      }
    }
    function onend() {
      debug("onend");
      dest.end();
    }

    // when the dest drains, it reduces the awaitDrain counter
    // on the source.  This would be more elegant with a .once()
    // handler in flow(), but adding and removing repeatedly is
    // too slow.
    var ondrain = pipeOnDrain(src);
    dest.on("drain", ondrain);
    var cleanedUp = false;
    function cleanup() {
      debug("cleanup");
      // cleanup event handlers once the pipe is broken
      dest.removeListener("close", onclose);
      dest.removeListener("finish", onfinish);
      dest.removeListener("drain", ondrain);
      dest.removeListener("error", onerror);
      dest.removeListener("unpipe", onunpipe);
      src.removeListener("end", onend);
      src.removeListener("end", unpipe);
      src.removeListener("data", ondata);
      cleanedUp = true;

      // if the reader is waiting for a drain event from this
      // specific writer, then it would cause it to never start
      // flowing again.
      // So, if this is awaiting a drain, then we just call it now.
      // If we don't know, then assume that we are waiting for one.
      if (
        state.awaitDrain &&
        (!dest._writableState || dest._writableState.needDrain)
      )
        ondrain();
    }
    src.on("data", ondata);
    function ondata(chunk) {
      debug("ondata");
      var ret = dest.write(chunk);
      debug("dest.write", ret);
      if (ret === false) {
        // If the user unpiped during `dest.write()`, it is possible
        // to get stuck in a permanently paused state if that write
        // also returned false.
        // => Check whether `dest` is still a piping destination.
        if (
          ((state.pipesCount === 1 && state.pipes === dest) ||
            (state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1)) &&
          !cleanedUp
        ) {
          debug("false write response, pause", state.awaitDrain);
          state.awaitDrain++;
        }
        src.pause();
      }
    }

    // if the dest has an error, then stop piping into it.
    // however, don't suppress the throwing behavior for this.
    function onerror(er) {
      debug("onerror", er);
      unpipe();
      dest.removeListener("error", onerror);
      if (EElistenerCount(dest, "error") === 0) errorOrDestroy(dest, er);
    }

    // Make sure our error handler is attached before userland ones.
    prependListener(dest, "error", onerror);

    // Both close and finish should trigger unpipe, but only once.
    function onclose() {
      dest.removeListener("finish", onfinish);
      unpipe();
    }
    dest.once("close", onclose);
    function onfinish() {
      debug("onfinish");
      dest.removeListener("close", onclose);
      unpipe();
    }
    dest.once("finish", onfinish);
    function unpipe() {
      debug("unpipe");
      src.unpipe(dest);
    }

    // tell the dest that it's being piped to
    dest.emit("pipe", src);

    // start the flow if it hasn't been started already.
    if (!state.flowing) {
      debug("pipe resume");
      src.resume();
    }
    return dest;
  };
  function pipeOnDrain(src) {
    return function pipeOnDrainFunctionResult() {
      var state = src._readableState;
      debug("pipeOnDrain", state.awaitDrain);
      if (state.awaitDrain) state.awaitDrain--;
      if (state.awaitDrain === 0 && EElistenerCount(src, "data")) {
        state.flowing = true;
        flow(src);
      }
    };
  }
  Readable.prototype.unpipe = function (dest) {
    var state = this._readableState;
    var unpipeInfo = {
      hasUnpiped: false,
    };

    // if we're not piping anywhere, then do nothing.
    if (state.pipesCount === 0) return this;

    // just one destination.  most common case.
    if (state.pipesCount === 1) {
      // passed in one, but it's not the right one.
      if (dest && dest !== state.pipes) return this;
      if (!dest) dest = state.pipes;

      // got a match.
      state.pipes = null;
      state.pipesCount = 0;
      state.flowing = false;
      if (dest) dest.emit("unpipe", this, unpipeInfo);
      return this;
    }

    // slow case. multiple pipe destinations.

    if (!dest) {
      // remove all.
      var dests = state.pipes;
      var len = state.pipesCount;
      state.pipes = null;
      state.pipesCount = 0;
      state.flowing = false;
      for (var i = 0; i < len; i++)
        dests[i].emit("unpipe", this, {
          hasUnpiped: false,
        });
      return this;
    }

    // try to find the right one.
    var index = indexOf(state.pipes, dest);
    if (index === -1) return this;
    state.pipes.splice(index, 1);
    state.pipesCount -= 1;
    if (state.pipesCount === 1) state.pipes = state.pipes[0];
    dest.emit("unpipe", this, unpipeInfo);
    return this;
  };

  // set up data events if they are asked for
  // Ensure readable listeners eventually get something
  Readable.prototype.on = function (ev, fn) {
    var res = Stream.prototype.on.call(this, ev, fn);
    var state = this._readableState;
    if (ev === "data") {
      // update readableListening so that resume() may be a no-op
      // a few lines down. This is needed to support once('readable').
      state.readableListening = this.listenerCount("readable") > 0;

      // Try start flowing on next tick if stream isn't explicitly paused
      if (state.flowing !== false) this.resume();
    } else if (ev === "readable") {
      if (!state.endEmitted && !state.readableListening) {
        state.readableListening = state.needReadable = true;
        state.flowing = false;
        state.emittedReadable = false;
        debug("on readable", state.length, state.reading);
        if (state.length) {
          emitReadable(this);
        } else if (!state.reading) {
          process.nextTick(nReadingNextTick, this);
        }
      }
    }
    return res;
  };
  Readable.prototype.addListener = Readable.prototype.on;
  Readable.prototype.removeListener = function (ev, fn) {
    var res = Stream.prototype.removeListener.call(this, ev, fn);
    if (ev === "readable") {
      // We need to check if there is someone still listening to
      // readable and reset the state. However this needs to happen
      // after readable has been emitted but before I/O (nextTick) to
      // support once('readable', fn) cycles. This means that calling
      // resume within the same tick will have no
      // effect.
      process.nextTick(updateReadableListening, this);
    }
    return res;
  };
  Readable.prototype.removeAllListeners = function (ev) {
    var res = Stream.prototype.removeAllListeners.apply(this, arguments);
    if (ev === "readable" || ev === undefined) {
      // We need to check if there is someone still listening to
      // readable and reset the state. However this needs to happen
      // after readable has been emitted but before I/O (nextTick) to
      // support once('readable', fn) cycles. This means that calling
      // resume within the same tick will have no
      // effect.
      process.nextTick(updateReadableListening, this);
    }
    return res;
  };
  function updateReadableListening(self) {
    var state = self._readableState;
    state.readableListening = self.listenerCount("readable") > 0;
    if (state.resumeScheduled && !state.paused) {
      // flowing needs to be set to true now, otherwise
      // the upcoming resume will not flow.
      state.flowing = true;

      // crude way to check if we should resume
    } else if (self.listenerCount("data") > 0) {
      self.resume();
    }
  }
  function nReadingNextTick(self) {
    debug("readable nexttick read 0");
    self.read(0);
  }

  // pause() and resume() are remnants of the legacy readable stream API
  // If the user uses them, then switch into old mode.
  Readable.prototype.resume = function () {
    var state = this._readableState;
    if (!state.flowing) {
      debug("resume");
      // we flow only if there is no one listening
      // for readable, but we still have to call
      // resume()
      state.flowing = !state.readableListening;
      resume(this, state);
    }
    state.paused = false;
    return this;
  };
  function resume(stream, state) {
    if (!state.resumeScheduled) {
      state.resumeScheduled = true;
      process.nextTick(resume_, stream, state);
    }
  }
  function resume_(stream, state) {
    debug("resume", state.reading);
    if (!state.reading) {
      stream.read(0);
    }
    state.resumeScheduled = false;
    stream.emit("resume");
    flow(stream);
    if (state.flowing && !state.reading) stream.read(0);
  }
  Readable.prototype.pause = function () {
    debug("call pause flowing=%j", this._readableState.flowing);
    if (this._readableState.flowing !== false) {
      debug("pause");
      this._readableState.flowing = false;
      this.emit("pause");
    }
    this._readableState.paused = true;
    return this;
  };
  function flow(stream) {
    var state = stream._readableState;
    debug("flow", state.flowing);
    while (state.flowing && stream.read() !== null);
  }

  // wrap an old-style stream as the async data source.
  // This is *not* part of the readable stream interface.
  // It is an ugly unfortunate mess of history.
  Readable.prototype.wrap = function (stream) {
    var _this = this;
    var state = this._readableState;
    var paused = false;
    stream.on("end", function () {
      debug("wrapped end");
      if (state.decoder && !state.ended) {
        var chunk = state.decoder.end();
        if (chunk && chunk.length) _this.push(chunk);
      }
      _this.push(null);
    });
    stream.on("data", function (chunk) {
      debug("wrapped data");
      if (state.decoder) chunk = state.decoder.write(chunk);

      // don't skip over falsy values in objectMode
      if (state.objectMode && (chunk === null || chunk === undefined)) return;
      else if (!state.objectMode && (!chunk || !chunk.length)) return;
      var ret = _this.push(chunk);
      if (!ret) {
        paused = true;
        stream.pause();
      }
    });

    // proxy all the other methods.
    // important when wrapping filters and duplexes.
    for (var i in stream) {
      if (this[i] === undefined && typeof stream[i] === "function") {
        this[i] = (function methodWrap(method) {
          return function methodWrapReturnFunction() {
            return stream[method].apply(stream, arguments);
          };
        })(i);
      }
    }

    // proxy certain important events.
    for (var n = 0; n < kProxyEvents.length; n++) {
      stream.on(kProxyEvents[n], this.emit.bind(this, kProxyEvents[n]));
    }

    // when we try to consume some more bytes, simply unpause the
    // underlying stream.
    this._read = function (n) {
      debug("wrapped _read", n);
      if (paused) {
        paused = false;
        stream.resume();
      }
    };
    return this;
  };
  if (typeof Symbol === "function") {
    Readable.prototype[Symbol.asyncIterator] = function () {
      if (createReadableStreamAsyncIterator === undefined) {
        createReadableStreamAsyncIterator = requireAsync_iterator();
      }
      return createReadableStreamAsyncIterator(this);
    };
  }
  Object.defineProperty(Readable.prototype, "readableHighWaterMark", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._readableState.highWaterMark;
    },
  });
  Object.defineProperty(Readable.prototype, "readableBuffer", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._readableState && this._readableState.buffer;
    },
  });
  Object.defineProperty(Readable.prototype, "readableFlowing", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._readableState.flowing;
    },
    set: function set(state) {
      if (this._readableState) {
        this._readableState.flowing = state;
      }
    },
  });

  // exposed for testing purposes only.
  Readable._fromList = fromList;
  Object.defineProperty(Readable.prototype, "readableLength", {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._readableState.length;
    },
  });

  // Pluck off n bytes from an array of buffers.
  // Length is the combined lengths of all the buffers in the list.
  // This function is designed to be inlinable, so please take care when making
  // changes to the function body.
  function fromList(n, state) {
    // nothing buffered
    if (state.length === 0) return null;
    var ret;
    if (state.objectMode) ret = state.buffer.shift();
    else if (!n || n >= state.length) {
      // read it all, truncate the list
      if (state.decoder) ret = state.buffer.join("");
      else if (state.buffer.length === 1) ret = state.buffer.first();
      else ret = state.buffer.concat(state.length);
      state.buffer.clear();
    } else {
      // read part of list
      ret = state.buffer.consume(n, state.decoder);
    }
    return ret;
  }
  function endReadable(stream) {
    var state = stream._readableState;
    debug("endReadable", state.endEmitted);
    if (!state.endEmitted) {
      state.ended = true;
      process.nextTick(endReadableNT, state, stream);
    }
  }
  function endReadableNT(state, stream) {
    debug("endReadableNT", state.endEmitted, state.length);

    // Check that we didn't get one last unshift.
    if (!state.endEmitted && state.length === 0) {
      state.endEmitted = true;
      stream.readable = false;
      stream.emit("end");
      if (state.autoDestroy) {
        // In case of duplex streams we need a way to detect
        // if the writable side is ready for autoDestroy as well
        var wState = stream._writableState;
        if (!wState || (wState.autoDestroy && wState.finished)) {
          stream.destroy();
        }
      }
    }
  }
  if (typeof Symbol === "function") {
    Readable.from = function (iterable, opts) {
      if (from === undefined) {
        from = requireFrom();
      }
      return from(Readable, iterable, opts);
    };
  }
  function indexOf(xs, x) {
    for (var i = 0, l = xs.length; i < l; i++) {
      if (xs[i] === x) return i;
    }
    return -1;
  }
  return _stream_readable;
}

var _stream_transform;
var hasRequired_stream_transform;

function require_stream_transform() {
  if (hasRequired_stream_transform) return _stream_transform;
  hasRequired_stream_transform = 1;

  _stream_transform = Transform;
  var _require$codes = requireErrors().codes,
    ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED,
    ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK,
    ERR_TRANSFORM_ALREADY_TRANSFORMING =
      _require$codes.ERR_TRANSFORM_ALREADY_TRANSFORMING,
    ERR_TRANSFORM_WITH_LENGTH_0 = _require$codes.ERR_TRANSFORM_WITH_LENGTH_0;
  var Duplex = require_stream_duplex();
  inheritsExports(Transform, Duplex);
  function afterTransform(er, data) {
    var ts = this._transformState;
    ts.transforming = false;
    var cb = ts.writecb;
    if (cb === null) {
      return this.emit("error", new ERR_MULTIPLE_CALLBACK());
    }
    ts.writechunk = null;
    ts.writecb = null;
    if (data != null)
      // single equals check for both `null` and `undefined`
      this.push(data);
    cb(er);
    var rs = this._readableState;
    rs.reading = false;
    if (rs.needReadable || rs.length < rs.highWaterMark) {
      this._read(rs.highWaterMark);
    }
  }
  function Transform(options) {
    if (!(this instanceof Transform)) return new Transform(options);
    Duplex.call(this, options);
    this._transformState = {
      afterTransform: afterTransform.bind(this),
      needTransform: false,
      transforming: false,
      writecb: null,
      writechunk: null,
      writeencoding: null,
    };

    // start out asking for a readable event once data is transformed.
    this._readableState.needReadable = true;

    // we have implemented the _read method, and done the other things
    // that Readable wants before the first _read call, so unset the
    // sync guard flag.
    this._readableState.sync = false;
    if (options) {
      if (typeof options.transform === "function")
        this._transform = options.transform;
      if (typeof options.flush === "function") this._flush = options.flush;
    }

    // When the writable side finishes, then flush out anything remaining.
    this.on("prefinish", prefinish);
  }
  function prefinish() {
    var _this = this;
    if (typeof this._flush === "function" && !this._readableState.destroyed) {
      this._flush(function (er, data) {
        done(_this, er, data);
      });
    } else {
      done(this, null, null);
    }
  }
  Transform.prototype.push = function (chunk, encoding) {
    this._transformState.needTransform = false;
    return Duplex.prototype.push.call(this, chunk, encoding);
  };

  // This is the part where you do stuff!
  // override this function in implementation classes.
  // 'chunk' is an input chunk.
  //
  // Call `push(newChunk)` to pass along transformed output
  // to the readable side.  You may call 'push' zero or more times.
  //
  // Call `cb(err)` when you are done with this chunk.  If you pass
  // an error, then that'll put the hurt on the whole operation.  If you
  // never call cb(), then you'll never get another chunk.
  Transform.prototype._transform = function (chunk, encoding, cb) {
    cb(new ERR_METHOD_NOT_IMPLEMENTED("_transform()"));
  };
  Transform.prototype._write = function (chunk, encoding, cb) {
    var ts = this._transformState;
    ts.writecb = cb;
    ts.writechunk = chunk;
    ts.writeencoding = encoding;
    if (!ts.transforming) {
      var rs = this._readableState;
      if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark)
        this._read(rs.highWaterMark);
    }
  };

  // Doesn't matter what the args are here.
  // _transform does all the work.
  // That we got here means that the readable side wants more data.
  Transform.prototype._read = function (n) {
    var ts = this._transformState;
    if (ts.writechunk !== null && !ts.transforming) {
      ts.transforming = true;
      this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
    } else {
      // mark that we need a transform, so that any data that comes in
      // will get processed, now that we've asked for it.
      ts.needTransform = true;
    }
  };
  Transform.prototype._destroy = function (err, cb) {
    Duplex.prototype._destroy.call(this, err, function (err2) {
      cb(err2);
    });
  };
  function done(stream, er, data) {
    if (er) return stream.emit("error", er);
    if (data != null)
      // single equals check for both `null` and `undefined`
      stream.push(data);

    // TODO(BridgeAR): Write a test for these two error cases
    // if there's nothing in the write buffer, then that means
    // that nothing more will ever be provided
    if (stream._writableState.length) throw new ERR_TRANSFORM_WITH_LENGTH_0();
    if (stream._transformState.transforming)
      throw new ERR_TRANSFORM_ALREADY_TRANSFORMING();
    return stream.push(null);
  }
  return _stream_transform;
}

var _stream_passthrough;
var hasRequired_stream_passthrough;

function require_stream_passthrough() {
  if (hasRequired_stream_passthrough) return _stream_passthrough;
  hasRequired_stream_passthrough = 1;

  _stream_passthrough = PassThrough;
  var Transform = require_stream_transform();
  inheritsExports(PassThrough, Transform);
  function PassThrough(options) {
    if (!(this instanceof PassThrough)) return new PassThrough(options);
    Transform.call(this, options);
  }
  PassThrough.prototype._transform = function (chunk, encoding, cb) {
    cb(null, chunk);
  };
  return _stream_passthrough;
}

var pipeline_1;
var hasRequiredPipeline;

function requirePipeline() {
  if (hasRequiredPipeline) return pipeline_1;
  hasRequiredPipeline = 1;

  var eos;
  function once(callback) {
    var called = false;
    return function () {
      if (called) return;
      called = true;
      callback.apply(void 0, arguments);
    };
  }
  var _require$codes = requireErrors().codes,
    ERR_MISSING_ARGS = _require$codes.ERR_MISSING_ARGS,
    ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED;
  function noop(err) {
    // Rethrow the error if it exists to avoid swallowing it
    if (err) throw err;
  }
  function isRequest(stream) {
    return stream.setHeader && typeof stream.abort === "function";
  }
  function destroyer(stream, reading, writing, callback) {
    callback = once(callback);
    var closed = false;
    stream.on("close", function () {
      closed = true;
    });
    if (eos === undefined) eos = requireEndOfStream();
    eos(
      stream,
      {
        readable: reading,
        writable: writing,
      },
      function (err) {
        if (err) return callback(err);
        closed = true;
        callback();
      }
    );
    var destroyed = false;
    return function (err) {
      if (closed) return;
      if (destroyed) return;
      destroyed = true;

      // request.destroy just do .end - .abort is what we want
      if (isRequest(stream)) return stream.abort();
      if (typeof stream.destroy === "function") return stream.destroy();
      callback(err || new ERR_STREAM_DESTROYED("pipe"));
    };
  }
  function call(fn) {
    fn();
  }
  function pipe(from, to) {
    return from.pipe(to);
  }
  function popCallback(streams) {
    if (!streams.length) return noop;
    if (typeof streams[streams.length - 1] !== "function") return noop;
    return streams.pop();
  }
  function pipeline() {
    for (
      var _len = arguments.length, streams = new Array(_len), _key = 0;
      _key < _len;
      _key++
    ) {
      streams[_key] = arguments[_key];
    }
    var callback = popCallback(streams);
    if (Array.isArray(streams[0])) streams = streams[0];
    if (streams.length < 2) {
      throw new ERR_MISSING_ARGS("streams");
    }
    var error;
    var destroys = streams.map(function (stream, i) {
      var reading = i < streams.length - 1;
      var writing = i > 0;
      return destroyer(stream, reading, writing, function (err) {
        if (!error) error = err;
        if (err) destroys.forEach(call);
        if (reading) return;
        destroys.forEach(call);
        callback(error);
      });
    });
    return streams.reduce(pipe);
  }
  pipeline_1 = pipeline;
  return pipeline_1;
}

(function (module, exports) {
  var Stream = require$$0$2;
  if (process.env.READABLE_STREAM === "disable" && Stream) {
    module.exports = Stream.Readable;
    Object.assign(module.exports, Stream);
    module.exports.Stream = Stream;
  } else {
    exports = module.exports = require_stream_readable();
    exports.Stream = Stream || exports;
    exports.Readable = exports;
    exports.Writable = require_stream_writable();
    exports.Duplex = require_stream_duplex();
    exports.Transform = require_stream_transform();
    exports.PassThrough = require_stream_passthrough();
    exports.finished = requireEndOfStream();
    exports.pipeline = requirePipeline();
  }
})(readable, readable.exports);

var readableExports = readable.exports;

const { Buffer } = require$$0$3;
const symbol = Symbol.for("BufferList");

function BufferList$1(buf) {
  if (!(this instanceof BufferList$1)) {
    return new BufferList$1(buf);
  }

  BufferList$1._init.call(this, buf);
}

BufferList$1._init = function _init(buf) {
  Object.defineProperty(this, symbol, { value: true });

  this._bufs = [];
  this.length = 0;

  if (buf) {
    this.append(buf);
  }
};

BufferList$1.prototype._new = function _new(buf) {
  return new BufferList$1(buf);
};

BufferList$1.prototype._offset = function _offset(offset) {
  if (offset === 0) {
    return [0, 0];
  }

  let tot = 0;

  for (let i = 0; i < this._bufs.length; i++) {
    const _t = tot + this._bufs[i].length;
    if (offset < _t || i === this._bufs.length - 1) {
      return [i, offset - tot];
    }
    tot = _t;
  }
};

BufferList$1.prototype._reverseOffset = function (blOffset) {
  const bufferId = blOffset[0];
  let offset = blOffset[1];

  for (let i = 0; i < bufferId; i++) {
    offset += this._bufs[i].length;
  }

  return offset;
};

BufferList$1.prototype.get = function get(index) {
  if (index > this.length || index < 0) {
    return undefined;
  }

  const offset = this._offset(index);

  return this._bufs[offset[0]][offset[1]];
};

BufferList$1.prototype.slice = function slice(start, end) {
  if (typeof start === "number" && start < 0) {
    start += this.length;
  }

  if (typeof end === "number" && end < 0) {
    end += this.length;
  }

  return this.copy(null, 0, start, end);
};

BufferList$1.prototype.copy = function copy(dst, dstStart, srcStart, srcEnd) {
  if (typeof srcStart !== "number" || srcStart < 0) {
    srcStart = 0;
  }

  if (typeof srcEnd !== "number" || srcEnd > this.length) {
    srcEnd = this.length;
  }

  if (srcStart >= this.length) {
    return dst || Buffer.alloc(0);
  }

  if (srcEnd <= 0) {
    return dst || Buffer.alloc(0);
  }

  const copy = !!dst;
  const off = this._offset(srcStart);
  const len = srcEnd - srcStart;
  let bytes = len;
  let bufoff = (copy && dstStart) || 0;
  let start = off[1];

  // copy/slice everything
  if (srcStart === 0 && srcEnd === this.length) {
    if (!copy) {
      // slice, but full concat if multiple buffers
      return this._bufs.length === 1
        ? this._bufs[0]
        : Buffer.concat(this._bufs, this.length);
    }

    // copy, need to copy individual buffers
    for (let i = 0; i < this._bufs.length; i++) {
      this._bufs[i].copy(dst, bufoff);
      bufoff += this._bufs[i].length;
    }

    return dst;
  }

  // easy, cheap case where it's a subset of one of the buffers
  if (bytes <= this._bufs[off[0]].length - start) {
    return copy
      ? this._bufs[off[0]].copy(dst, dstStart, start, start + bytes)
      : this._bufs[off[0]].slice(start, start + bytes);
  }

  if (!copy) {
    // a slice, we need something to copy in to
    dst = Buffer.allocUnsafe(len);
  }

  for (let i = off[0]; i < this._bufs.length; i++) {
    const l = this._bufs[i].length - start;

    if (bytes > l) {
      this._bufs[i].copy(dst, bufoff, start);
      bufoff += l;
    } else {
      this._bufs[i].copy(dst, bufoff, start, start + bytes);
      bufoff += l;
      break;
    }

    bytes -= l;

    if (start) {
      start = 0;
    }
  }

  // safeguard so that we don't return uninitialized memory
  if (dst.length > bufoff) return dst.slice(0, bufoff);

  return dst;
};

BufferList$1.prototype.shallowSlice = function shallowSlice(start, end) {
  start = start || 0;
  end = typeof end !== "number" ? this.length : end;

  if (start < 0) {
    start += this.length;
  }

  if (end < 0) {
    end += this.length;
  }

  if (start === end) {
    return this._new();
  }

  const startOffset = this._offset(start);
  const endOffset = this._offset(end);
  const buffers = this._bufs.slice(startOffset[0], endOffset[0] + 1);

  if (endOffset[1] === 0) {
    buffers.pop();
  } else {
    buffers[buffers.length - 1] = buffers[buffers.length - 1].slice(
      0,
      endOffset[1]
    );
  }

  if (startOffset[1] !== 0) {
    buffers[0] = buffers[0].slice(startOffset[1]);
  }

  return this._new(buffers);
};

BufferList$1.prototype.toString = function toString(encoding, start, end) {
  return this.slice(start, end).toString(encoding);
};

BufferList$1.prototype.consume = function consume(bytes) {
  // first, normalize the argument, in accordance with how Buffer does it
  bytes = Math.trunc(bytes);
  // do nothing if not a positive number
  if (Number.isNaN(bytes) || bytes <= 0) return this;

  while (this._bufs.length) {
    if (bytes >= this._bufs[0].length) {
      bytes -= this._bufs[0].length;
      this.length -= this._bufs[0].length;
      this._bufs.shift();
    } else {
      this._bufs[0] = this._bufs[0].slice(bytes);
      this.length -= bytes;
      break;
    }
  }

  return this;
};

BufferList$1.prototype.duplicate = function duplicate() {
  const copy = this._new();

  for (let i = 0; i < this._bufs.length; i++) {
    copy.append(this._bufs[i]);
  }

  return copy;
};

BufferList$1.prototype.append = function append(buf) {
  if (buf == null) {
    return this;
  }

  if (buf.buffer) {
    // append a view of the underlying ArrayBuffer
    this._appendBuffer(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
  } else if (Array.isArray(buf)) {
    for (let i = 0; i < buf.length; i++) {
      this.append(buf[i]);
    }
  } else if (this._isBufferList(buf)) {
    // unwrap argument into individual BufferLists
    for (let i = 0; i < buf._bufs.length; i++) {
      this.append(buf._bufs[i]);
    }
  } else {
    // coerce number arguments to strings, since Buffer(number) does
    // uninitialized memory allocation
    if (typeof buf === "number") {
      buf = buf.toString();
    }

    this._appendBuffer(Buffer.from(buf));
  }

  return this;
};

BufferList$1.prototype._appendBuffer = function appendBuffer(buf) {
  this._bufs.push(buf);
  this.length += buf.length;
};

BufferList$1.prototype.indexOf = function (search, offset, encoding) {
  if (encoding === undefined && typeof offset === "string") {
    encoding = offset;
    offset = undefined;
  }

  if (typeof search === "function" || Array.isArray(search)) {
    throw new TypeError(
      'The "value" argument must be one of type string, Buffer, BufferList, or Uint8Array.'
    );
  } else if (typeof search === "number") {
    search = Buffer.from([search]);
  } else if (typeof search === "string") {
    search = Buffer.from(search, encoding);
  } else if (this._isBufferList(search)) {
    search = search.slice();
  } else if (Array.isArray(search.buffer)) {
    search = Buffer.from(search.buffer, search.byteOffset, search.byteLength);
  } else if (!Buffer.isBuffer(search)) {
    search = Buffer.from(search);
  }

  offset = Number(offset || 0);

  if (isNaN(offset)) {
    offset = 0;
  }

  if (offset < 0) {
    offset = this.length + offset;
  }

  if (offset < 0) {
    offset = 0;
  }

  if (search.length === 0) {
    return offset > this.length ? this.length : offset;
  }

  const blOffset = this._offset(offset);
  let blIndex = blOffset[0]; // index of which internal buffer we're working on
  let buffOffset = blOffset[1]; // offset of the internal buffer we're working on

  // scan over each buffer
  for (; blIndex < this._bufs.length; blIndex++) {
    const buff = this._bufs[blIndex];

    while (buffOffset < buff.length) {
      const availableWindow = buff.length - buffOffset;

      if (availableWindow >= search.length) {
        const nativeSearchResult = buff.indexOf(search, buffOffset);

        if (nativeSearchResult !== -1) {
          return this._reverseOffset([blIndex, nativeSearchResult]);
        }

        buffOffset = buff.length - search.length + 1; // end of native search window
      } else {
        const revOffset = this._reverseOffset([blIndex, buffOffset]);

        if (this._match(revOffset, search)) {
          return revOffset;
        }

        buffOffset++;
      }
    }

    buffOffset = 0;
  }

  return -1;
};

BufferList$1.prototype._match = function (offset, search) {
  if (this.length - offset < search.length) {
    return false;
  }

  for (let searchOffset = 0; searchOffset < search.length; searchOffset++) {
    if (this.get(offset + searchOffset) !== search[searchOffset]) {
      return false;
    }
  }
  return true;
};
(function () {
  const methods = {
    readDoubleBE: 8,
    readDoubleLE: 8,
    readFloatBE: 4,
    readFloatLE: 4,
    readInt32BE: 4,
    readInt32LE: 4,
    readUInt32BE: 4,
    readUInt32LE: 4,
    readInt16BE: 2,
    readInt16LE: 2,
    readUInt16BE: 2,
    readUInt16LE: 2,
    readInt8: 1,
    readUInt8: 1,
    readIntBE: null,
    readIntLE: null,
    readUIntBE: null,
    readUIntLE: null,
  };

  for (const m in methods) {
    (function (m) {
      if (methods[m] === null) {
        BufferList$1.prototype[m] = function (offset, byteLength) {
          return this.slice(offset, offset + byteLength)[m](0, byteLength);
        };
      } else {
        BufferList$1.prototype[m] = function (offset = 0) {
          return this.slice(offset, offset + methods[m])[m](0);
        };
      }
    })(m);
  }
})();

// Used internally by the class and also as an indicator of this object being
// a `BufferList`. It's not possible to use `instanceof BufferList` in a browser
// environment because there could be multiple different copies of the
// BufferList class and some `BufferList`s might be `BufferList`s.
BufferList$1.prototype._isBufferList = function _isBufferList(b) {
  return b instanceof BufferList$1 || BufferList$1.isBufferList(b);
};

BufferList$1.isBufferList = function isBufferList(b) {
  return b != null && b[symbol];
};

var BufferList_1 = BufferList$1;

const DuplexStream = readableExports.Duplex;
const inherits = inheritsExports;
const BufferList = BufferList_1;

function BufferListStream(callback) {
  if (!(this instanceof BufferListStream)) {
    return new BufferListStream(callback);
  }

  if (typeof callback === "function") {
    this._callback = callback;

    const piper = function piper(err) {
      if (this._callback) {
        this._callback(err);
        this._callback = null;
      }
    }.bind(this);

    this.on("pipe", function onPipe(src) {
      src.on("error", piper);
    });
    this.on("unpipe", function onUnpipe(src) {
      src.removeListener("error", piper);
    });

    callback = null;
  }

  BufferList._init.call(this, callback);
  DuplexStream.call(this);
}

inherits(BufferListStream, DuplexStream);
Object.assign(BufferListStream.prototype, BufferList.prototype);

BufferListStream.prototype._new = function _new(callback) {
  return new BufferListStream(callback);
};

BufferListStream.prototype._write = function _write(buf, encoding, callback) {
  this._appendBuffer(buf);

  if (typeof callback === "function") {
    callback();
  }
};

BufferListStream.prototype._read = function _read(size) {
  if (!this.length) {
    return this.push(null);
  }

  size = Math.min(size, this.length);
  this.push(this.slice(0, size));
  this.consume(size);
};

BufferListStream.prototype.end = function end(chunk) {
  DuplexStream.prototype.end.call(this, chunk);

  if (this._callback) {
    this._callback(null, this.slice());
    this._callback = null;
  }
};

BufferListStream.prototype._destroy = function _destroy(err, cb) {
  this._bufs.length = 0;
  this.length = 0;
  cb(err);
};

BufferListStream.prototype._isBufferList = function _isBufferList(b) {
  return (
    b instanceof BufferListStream ||
    b instanceof BufferList ||
    BufferListStream.isBufferList(b)
  );
};

BufferListStream.isBufferList = BufferList.isBufferList;

bl.exports = BufferListStream;
var BufferListStream_1 = (bl.exports.BufferListStream = BufferListStream);
bl.exports.BufferList = BufferList;

const ASCII_ETX_CODE = 0x03; // Ctrl+C emits this code

class StdinDiscarder {
  #requests = 0;
  #mutedStream = new BufferListStream_1();
  #ourEmit;
  #rl;

  constructor() {
    this.#mutedStream.pipe(process$2.stdout);

    const self = this; // eslint-disable-line unicorn/no-this-assignment
    this.#ourEmit = function (event, data, ...arguments_) {
      const { stdin } = process$2;
      if (self.#requests > 0 || stdin.emit === self.#ourEmit) {
        if (event === "keypress") {
          // Fixes readline behavior
          return;
        }

        if (event === "data" && data.includes(ASCII_ETX_CODE)) {
          process$2.emit("SIGINT");
        }

        Reflect.apply(self.#ourEmit, this, [event, data, ...arguments_]);
      } else {
        Reflect.apply(process$2.stdin.emit, this, [event, data, ...arguments_]);
      }
    };
  }

  start() {
    this.#requests++;

    if (this.#requests === 1) {
      this._realStart();
    }
  }

  stop() {
    if (this.#requests <= 0) {
      throw new Error("`stop` called more times than `start`");
    }

    this.#requests--;

    if (this.#requests === 0) {
      this._realStop();
    }
  }

  // TODO: Use private methods when targeting Node.js 14.
  _realStart() {
    // No known way to make it work reliably on Windows
    if (process$2.platform === "win32") {
      return;
    }

    this.#rl = readline.createInterface({
      input: process$2.stdin,
      output: this.#mutedStream,
    });

    this.#rl.on("SIGINT", () => {
      if (process$2.listenerCount("SIGINT") === 0) {
        process$2.emit("SIGINT");
      } else {
        this.#rl.close();
        process$2.kill(process$2.pid, "SIGINT");
      }
    });
  }

  _realStop() {
    if (process$2.platform === "win32") {
      return;
    }

    this.#rl.close();
    this.#rl = undefined;
  }
}

const stdinDiscarder = new StdinDiscarder();

class Ora {
  #linesToClear = 0;
  #isDiscardingStdin = false;
  #lineCount = 0;
  #frameIndex = 0;
  #options;
  #spinner;
  #stream;
  #id;
  #initialInterval;
  #isEnabled;
  #isSilent;
  #indent;
  #text;
  #prefixText;
  #suffixText;

  color;

  constructor(options) {
    if (typeof options === "string") {
      options = {
        text: options,
      };
    }

    this.#options = {
      color: "cyan",
      stream: process$2.stderr,
      discardStdin: true,
      hideCursor: true,
      ...options,
    };

    // Public
    this.color = this.#options.color;

    // It's important that these use the public setters.
    this.spinner = this.#options.spinner;

    this.#initialInterval = this.#options.interval;
    this.#stream = this.#options.stream;
    this.#isEnabled =
      typeof this.#options.isEnabled === "boolean"
        ? this.#options.isEnabled
        : isInteractive({ stream: this.#stream });
    this.#isSilent =
      typeof this.#options.isSilent === "boolean"
        ? this.#options.isSilent
        : false;

    // Set *after* `this.#stream`.
    // It's important that these use the public setters.
    this.text = this.#options.text;
    this.prefixText = this.#options.prefixText;
    this.suffixText = this.#options.suffixText;
    this.indent = this.#options.indent;

    if (process$2.env.NODE_ENV === "test") {
      this._stream = this.#stream;
      this._isEnabled = this.#isEnabled;

      Object.defineProperty(this, "_linesToClear", {
        get() {
          return this.#linesToClear;
        },
        set(newValue) {
          this.#linesToClear = newValue;
        },
      });

      Object.defineProperty(this, "_frameIndex", {
        get() {
          return this.#frameIndex;
        },
      });

      Object.defineProperty(this, "_lineCount", {
        get() {
          return this.#lineCount;
        },
      });
    }
  }

  get indent() {
    return this.#indent;
  }

  set indent(indent = 0) {
    if (!(indent >= 0 && Number.isInteger(indent))) {
      throw new Error("The `indent` option must be an integer from 0 and up");
    }

    this.#indent = indent;
    this.#updateLineCount();
  }

  get interval() {
    return this.#initialInterval ?? this.#spinner.interval ?? 100;
  }

  get spinner() {
    return this.#spinner;
  }

  set spinner(spinner) {
    this.#frameIndex = 0;
    this.#initialInterval = undefined;

    if (typeof spinner === "object") {
      if (spinner.frames === undefined) {
        throw new Error("The given spinner must have a `frames` property");
      }

      this.#spinner = spinner;
    } else if (!isUnicodeSupported()) {
      this.#spinner = cliSpinners$1.line;
    } else if (spinner === undefined) {
      // Set default spinner
      this.#spinner = cliSpinners$1.dots;
    } else if (spinner !== "default" && cliSpinners$1[spinner]) {
      this.#spinner = cliSpinners$1[spinner];
    } else {
      throw new Error(
        `There is no built-in spinner named '${spinner}'. See https://github.com/sindresorhus/cli-spinners/blob/main/spinners.json for a full list.`
      );
    }
  }

  get text() {
    return this.#text;
  }

  set text(value = "") {
    this.#text = value;
    this.#updateLineCount();
  }

  get prefixText() {
    return this.#prefixText;
  }

  set prefixText(value = "") {
    this.#prefixText = value;
    this.#updateLineCount();
  }

  get suffixText() {
    return this.#suffixText;
  }

  set suffixText(value = "") {
    this.#suffixText = value;
    this.#updateLineCount();
  }

  get isSpinning() {
    return this.#id !== undefined;
  }

  #getFullPrefixText(prefixText = this.#prefixText, postfix = " ") {
    if (typeof prefixText === "string" && prefixText !== "") {
      return prefixText + postfix;
    }

    if (typeof prefixText === "function") {
      return prefixText() + postfix;
    }

    return "";
  }

  #getFullSuffixText(suffixText = this.#suffixText, prefix = " ") {
    if (typeof suffixText === "string" && suffixText !== "") {
      return prefix + suffixText;
    }

    if (typeof suffixText === "function") {
      return prefix + suffixText();
    }

    return "";
  }

  #updateLineCount() {
    const columns = this.#stream.columns ?? 80;
    const fullPrefixText = this.#getFullPrefixText(this.#prefixText, "-");
    const fullSuffixText = this.#getFullSuffixText(this.#suffixText, "-");
    const fullText =
      " ".repeat(this.#indent) +
      fullPrefixText +
      "--" +
      this.#text +
      "--" +
      fullSuffixText;

    this.#lineCount = 0;
    for (const line of stripAnsi(fullText).split("\n")) {
      this.#lineCount += Math.max(
        1,
        Math.ceil(stringWidth(line, { countAnsiEscapeCodes: true }) / columns)
      );
    }
  }

  get isEnabled() {
    return this.#isEnabled && !this.#isSilent;
  }

  set isEnabled(value) {
    if (typeof value !== "boolean") {
      throw new TypeError("The `isEnabled` option must be a boolean");
    }

    this.#isEnabled = value;
  }

  get isSilent() {
    return this.#isSilent;
  }

  set isSilent(value) {
    if (typeof value !== "boolean") {
      throw new TypeError("The `isSilent` option must be a boolean");
    }

    this.#isSilent = value;
  }

  frame() {
    const { frames } = this.#spinner;
    let frame = frames[this.#frameIndex];

    if (this.color) {
      frame = chalk[this.color](frame);
    }

    this.#frameIndex = ++this.#frameIndex % frames.length;
    const fullPrefixText =
      typeof this.#prefixText === "string" && this.#prefixText !== ""
        ? this.#prefixText + " "
        : "";
    const fullText = typeof this.text === "string" ? " " + this.text : "";
    const fullSuffixText =
      typeof this.#suffixText === "string" && this.#suffixText !== ""
        ? " " + this.#suffixText
        : "";

    return fullPrefixText + frame + fullText + fullSuffixText;
  }

  clear() {
    if (!this.#isEnabled || !this.#stream.isTTY) {
      return this;
    }

    this.#stream.cursorTo(0);

    for (let index = 0; index < this.#linesToClear; index++) {
      if (index > 0) {
        this.#stream.moveCursor(0, -1);
      }

      this.#stream.clearLine(1);
    }

    if (this.#indent || this.lastIndent !== this.#indent) {
      this.#stream.cursorTo(this.#indent);
    }

    this.lastIndent = this.#indent;
    this.#linesToClear = 0;

    return this;
  }

  render() {
    if (this.#isSilent) {
      return this;
    }

    this.clear();
    this.#stream.write(this.frame());
    this.#linesToClear = this.#lineCount;

    return this;
  }

  start(text) {
    if (text) {
      this.text = text;
    }

    if (this.#isSilent) {
      return this;
    }

    if (!this.#isEnabled) {
      if (this.text) {
        this.#stream.write(`- ${this.text}\n`);
      }

      return this;
    }

    if (this.isSpinning) {
      return this;
    }

    if (this.#options.hideCursor) {
      cliCursor.hide(this.#stream);
    }

    if (this.#options.discardStdin && process$2.stdin.isTTY) {
      this.#isDiscardingStdin = true;
      stdinDiscarder.start();
    }

    this.render();
    this.#id = setInterval(this.render.bind(this), this.interval);

    return this;
  }

  stop() {
    if (!this.#isEnabled) {
      return this;
    }

    clearInterval(this.#id);
    this.#id = undefined;
    this.#frameIndex = 0;
    this.clear();
    if (this.#options.hideCursor) {
      cliCursor.show(this.#stream);
    }

    if (
      this.#options.discardStdin &&
      process$2.stdin.isTTY &&
      this.#isDiscardingStdin
    ) {
      stdinDiscarder.stop();
      this.#isDiscardingStdin = false;
    }

    return this;
  }

  succeed(text) {
    return this.stopAndPersist({ symbol: logSymbols.success, text });
  }

  fail(text) {
    return this.stopAndPersist({ symbol: logSymbols.error, text });
  }

  warn(text) {
    return this.stopAndPersist({ symbol: logSymbols.warning, text });
  }

  info(text) {
    return this.stopAndPersist({ symbol: logSymbols.info, text });
  }

  stopAndPersist(options = {}) {
    if (this.#isSilent) {
      return this;
    }

    const prefixText = options.prefixText ?? this.#prefixText;
    const fullPrefixText = this.#getFullPrefixText(prefixText, " ");

    const symbolText = options.symbol ?? " ";

    const text = options.text ?? this.text;
    const fullText = typeof text === "string" ? " " + text : "";

    const suffixText = options.suffixText ?? this.#suffixText;
    const fullSuffixText = this.#getFullSuffixText(suffixText, " ");

    const textToWrite =
      fullPrefixText + symbolText + fullText + fullSuffixText + "\n";

    this.stop();
    this.#stream.write(textToWrite);

    return this;
  }
}

function ora(options) {
  return new Ora(options);
}

function load(line) {
  // get filename
  let fn = (line.split(" ")[1] || "").replace(/^("|')|("|')$/g, "");
  if (/\.lua$/.test(fn)) {
    let filePath = fn;
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(path.join(process.cwd(), fn));
    }
    if (!fs.existsSync(filePath)) {
      throw Error(chalk.red("ERROR (200): file not found."));
    }
    console.log(chalk.green("Loading... ", fn));

    const spinner = ora({
      spinner: "dots",
      suffixText: ``,
      discardStdin: false,
    });
    spinner.start();
    spinner.suffixText = chalk.gray("Parsing project structure...");

    const projectStructure = createProjectStructure(filePath);

    const [executable, modules] = createExecutableFromProject(projectStructure);
    line = executable;
    spinner.stop();

    if (projectStructure.length > 0) {
      console.log(chalk.yellow("\nThe following files will be deployed:"));
      console.log(
        chalk.dim(
          createFileTree(
            projectStructure.map((mod) => {
              if (mod.path === filePath) {
                mod.path += " " + chalk.reset(chalk.bgGreen(" MAIN "));
              }

              return mod.path;
            })
          )
        )
      );
    }

    return [line, modules];
  } else {
    throw Error(chalk.red("ERROR: .load function requires a *.lua file"));
  }
}

export default load;
