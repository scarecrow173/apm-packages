#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
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

// node_modules/.pnpm/kind-of@6.0.3/node_modules/kind-of/index.js
var require_kind_of = __commonJS({
  "node_modules/.pnpm/kind-of@6.0.3/node_modules/kind-of/index.js"(exports2, module2) {
    var toString = Object.prototype.toString;
    module2.exports = function kindOf(val) {
      if (val === void 0) return "undefined";
      if (val === null) return "null";
      var type = typeof val;
      if (type === "boolean") return "boolean";
      if (type === "string") return "string";
      if (type === "number") return "number";
      if (type === "symbol") return "symbol";
      if (type === "function") {
        return isGeneratorFn(val) ? "generatorfunction" : "function";
      }
      if (isArray(val)) return "array";
      if (isBuffer(val)) return "buffer";
      if (isArguments(val)) return "arguments";
      if (isDate(val)) return "date";
      if (isError(val)) return "error";
      if (isRegexp(val)) return "regexp";
      switch (ctorName(val)) {
        case "Symbol":
          return "symbol";
        case "Promise":
          return "promise";
        // Set, Map, WeakSet, WeakMap
        case "WeakMap":
          return "weakmap";
        case "WeakSet":
          return "weakset";
        case "Map":
          return "map";
        case "Set":
          return "set";
        // 8-bit typed arrays
        case "Int8Array":
          return "int8array";
        case "Uint8Array":
          return "uint8array";
        case "Uint8ClampedArray":
          return "uint8clampedarray";
        // 16-bit typed arrays
        case "Int16Array":
          return "int16array";
        case "Uint16Array":
          return "uint16array";
        // 32-bit typed arrays
        case "Int32Array":
          return "int32array";
        case "Uint32Array":
          return "uint32array";
        case "Float32Array":
          return "float32array";
        case "Float64Array":
          return "float64array";
      }
      if (isGeneratorObj(val)) {
        return "generator";
      }
      type = toString.call(val);
      switch (type) {
        case "[object Object]":
          return "object";
        // iterators
        case "[object Map Iterator]":
          return "mapiterator";
        case "[object Set Iterator]":
          return "setiterator";
        case "[object String Iterator]":
          return "stringiterator";
        case "[object Array Iterator]":
          return "arrayiterator";
      }
      return type.slice(8, -1).toLowerCase().replace(/\s/g, "");
    };
    function ctorName(val) {
      return typeof val.constructor === "function" ? val.constructor.name : null;
    }
    function isArray(val) {
      if (Array.isArray) return Array.isArray(val);
      return val instanceof Array;
    }
    function isError(val) {
      return val instanceof Error || typeof val.message === "string" && val.constructor && typeof val.constructor.stackTraceLimit === "number";
    }
    function isDate(val) {
      if (val instanceof Date) return true;
      return typeof val.toDateString === "function" && typeof val.getDate === "function" && typeof val.setDate === "function";
    }
    function isRegexp(val) {
      if (val instanceof RegExp) return true;
      return typeof val.flags === "string" && typeof val.ignoreCase === "boolean" && typeof val.multiline === "boolean" && typeof val.global === "boolean";
    }
    function isGeneratorFn(name, val) {
      return ctorName(name) === "GeneratorFunction";
    }
    function isGeneratorObj(val) {
      return typeof val.throw === "function" && typeof val.return === "function" && typeof val.next === "function";
    }
    function isArguments(val) {
      try {
        if (typeof val.length === "number" && typeof val.callee === "function") {
          return true;
        }
      } catch (err) {
        if (err.message.indexOf("callee") !== -1) {
          return true;
        }
      }
      return false;
    }
    function isBuffer(val) {
      if (val.constructor && typeof val.constructor.isBuffer === "function") {
        return val.constructor.isBuffer(val);
      }
      return false;
    }
  }
});

// node_modules/.pnpm/is-extendable@0.1.1/node_modules/is-extendable/index.js
var require_is_extendable = __commonJS({
  "node_modules/.pnpm/is-extendable@0.1.1/node_modules/is-extendable/index.js"(exports2, module2) {
    "use strict";
    module2.exports = function isExtendable(val) {
      return typeof val !== "undefined" && val !== null && (typeof val === "object" || typeof val === "function");
    };
  }
});

// node_modules/.pnpm/extend-shallow@2.0.1/node_modules/extend-shallow/index.js
var require_extend_shallow = __commonJS({
  "node_modules/.pnpm/extend-shallow@2.0.1/node_modules/extend-shallow/index.js"(exports2, module2) {
    "use strict";
    var isObject = require_is_extendable();
    module2.exports = function extend(o) {
      if (!isObject(o)) {
        o = {};
      }
      var len = arguments.length;
      for (var i = 1; i < len; i++) {
        var obj = arguments[i];
        if (isObject(obj)) {
          assign(o, obj);
        }
      }
      return o;
    };
    function assign(a, b) {
      for (var key in b) {
        if (hasOwn(b, key)) {
          a[key] = b[key];
        }
      }
    }
    function hasOwn(obj, key) {
      return Object.prototype.hasOwnProperty.call(obj, key);
    }
  }
});

// node_modules/.pnpm/section-matter@1.0.0/node_modules/section-matter/index.js
var require_section_matter = __commonJS({
  "node_modules/.pnpm/section-matter@1.0.0/node_modules/section-matter/index.js"(exports2, module2) {
    "use strict";
    var typeOf = require_kind_of();
    var extend = require_extend_shallow();
    module2.exports = function(input, options2) {
      if (typeof options2 === "function") {
        options2 = { parse: options2 };
      }
      var file = toObject(input);
      var defaults = { section_delimiter: "---", parse: identity };
      var opts = extend({}, defaults, options2);
      var delim = opts.section_delimiter;
      var lines = file.content.split(/\r?\n/);
      var sections = null;
      var section = createSection();
      var content = [];
      var stack = [];
      function initSections(val) {
        file.content = val;
        sections = [];
        content = [];
      }
      function closeSection(val) {
        if (stack.length) {
          section.key = getKey(stack[0], delim);
          section.content = val;
          opts.parse(section, sections);
          sections.push(section);
          section = createSection();
          content = [];
          stack = [];
        }
      }
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var len = stack.length;
        var ln = line.trim();
        if (isDelimiter(ln, delim)) {
          if (ln.length === 3 && i !== 0) {
            if (len === 0 || len === 2) {
              content.push(line);
              continue;
            }
            stack.push(ln);
            section.data = content.join("\n");
            content = [];
            continue;
          }
          if (sections === null) {
            initSections(content.join("\n"));
          }
          if (len === 2) {
            closeSection(content.join("\n"));
          }
          stack.push(ln);
          continue;
        }
        content.push(line);
      }
      if (sections === null) {
        initSections(content.join("\n"));
      } else {
        closeSection(content.join("\n"));
      }
      file.sections = sections;
      return file;
    };
    function isDelimiter(line, delim) {
      if (line.slice(0, delim.length) !== delim) {
        return false;
      }
      if (line.charAt(delim.length + 1) === delim.slice(-1)) {
        return false;
      }
      return true;
    }
    function toObject(input) {
      if (typeOf(input) !== "object") {
        input = { content: input };
      }
      if (typeof input.content !== "string" && !isBuffer(input.content)) {
        throw new TypeError("expected a buffer or string");
      }
      input.content = input.content.toString();
      input.sections = [];
      return input;
    }
    function getKey(val, delim) {
      return val ? val.slice(delim.length).trim() : "";
    }
    function createSection() {
      return { key: "", data: "", content: "" };
    }
    function identity(val) {
      return val;
    }
    function isBuffer(val) {
      if (val && val.constructor && typeof val.constructor.isBuffer === "function") {
        return val.constructor.isBuffer(val);
      }
      return false;
    }
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/common.js
var require_common = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/common.js"(exports2, module2) {
    "use strict";
    function isNothing(subject) {
      return typeof subject === "undefined" || subject === null;
    }
    function isObject(subject) {
      return typeof subject === "object" && subject !== null;
    }
    function toArray(sequence) {
      if (Array.isArray(sequence)) return sequence;
      else if (isNothing(sequence)) return [];
      return [sequence];
    }
    function extend(target, source) {
      var index, length, key, sourceKeys;
      if (source) {
        sourceKeys = Object.keys(source);
        for (index = 0, length = sourceKeys.length; index < length; index += 1) {
          key = sourceKeys[index];
          target[key] = source[key];
        }
      }
      return target;
    }
    function repeat(string, count) {
      var result = "", cycle;
      for (cycle = 0; cycle < count; cycle += 1) {
        result += string;
      }
      return result;
    }
    function isNegativeZero(number) {
      return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
    }
    module2.exports.isNothing = isNothing;
    module2.exports.isObject = isObject;
    module2.exports.toArray = toArray;
    module2.exports.repeat = repeat;
    module2.exports.isNegativeZero = isNegativeZero;
    module2.exports.extend = extend;
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/exception.js
var require_exception = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/exception.js"(exports2, module2) {
    "use strict";
    function YAMLException(reason, mark) {
      Error.call(this);
      this.name = "YAMLException";
      this.reason = reason;
      this.mark = mark;
      this.message = (this.reason || "(unknown reason)") + (this.mark ? " " + this.mark.toString() : "");
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, this.constructor);
      } else {
        this.stack = new Error().stack || "";
      }
    }
    YAMLException.prototype = Object.create(Error.prototype);
    YAMLException.prototype.constructor = YAMLException;
    YAMLException.prototype.toString = function toString(compact) {
      var result = this.name + ": ";
      result += this.reason || "(unknown reason)";
      if (!compact && this.mark) {
        result += " " + this.mark.toString();
      }
      return result;
    };
    module2.exports = YAMLException;
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/mark.js
var require_mark = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/mark.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    function Mark(name, buffer, position, line, column) {
      this.name = name;
      this.buffer = buffer;
      this.position = position;
      this.line = line;
      this.column = column;
    }
    Mark.prototype.getSnippet = function getSnippet(indent, maxLength) {
      var head, start, tail, end, snippet;
      if (!this.buffer) return null;
      indent = indent || 4;
      maxLength = maxLength || 75;
      head = "";
      start = this.position;
      while (start > 0 && "\0\r\n\x85\u2028\u2029".indexOf(this.buffer.charAt(start - 1)) === -1) {
        start -= 1;
        if (this.position - start > maxLength / 2 - 1) {
          head = " ... ";
          start += 5;
          break;
        }
      }
      tail = "";
      end = this.position;
      while (end < this.buffer.length && "\0\r\n\x85\u2028\u2029".indexOf(this.buffer.charAt(end)) === -1) {
        end += 1;
        if (end - this.position > maxLength / 2 - 1) {
          tail = " ... ";
          end -= 5;
          break;
        }
      }
      snippet = this.buffer.slice(start, end);
      return common.repeat(" ", indent) + head + snippet + tail + "\n" + common.repeat(" ", indent + this.position - start + head.length) + "^";
    };
    Mark.prototype.toString = function toString(compact) {
      var snippet, where = "";
      if (this.name) {
        where += 'in "' + this.name + '" ';
      }
      where += "at line " + (this.line + 1) + ", column " + (this.column + 1);
      if (!compact) {
        snippet = this.getSnippet();
        if (snippet) {
          where += ":\n" + snippet;
        }
      }
      return where;
    };
    module2.exports = Mark;
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type.js
var require_type = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type.js"(exports2, module2) {
    "use strict";
    var YAMLException = require_exception();
    var TYPE_CONSTRUCTOR_OPTIONS = [
      "kind",
      "resolve",
      "construct",
      "instanceOf",
      "predicate",
      "represent",
      "defaultStyle",
      "styleAliases"
    ];
    var YAML_NODE_KINDS = [
      "scalar",
      "sequence",
      "mapping"
    ];
    function compileStyleAliases(map) {
      var result = {};
      if (map !== null) {
        Object.keys(map).forEach(function(style) {
          map[style].forEach(function(alias) {
            result[String(alias)] = style;
          });
        });
      }
      return result;
    }
    function Type(tag, options2) {
      options2 = options2 || {};
      Object.keys(options2).forEach(function(name) {
        if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
          throw new YAMLException('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
        }
      });
      this.tag = tag;
      this.kind = options2["kind"] || null;
      this.resolve = options2["resolve"] || function() {
        return true;
      };
      this.construct = options2["construct"] || function(data) {
        return data;
      };
      this.instanceOf = options2["instanceOf"] || null;
      this.predicate = options2["predicate"] || null;
      this.represent = options2["represent"] || null;
      this.defaultStyle = options2["defaultStyle"] || null;
      this.styleAliases = compileStyleAliases(options2["styleAliases"] || null);
      if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
        throw new YAMLException('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
      }
    }
    module2.exports = Type;
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/schema.js
var require_schema = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/schema.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var YAMLException = require_exception();
    var Type = require_type();
    function compileList(schema, name, result) {
      var exclude = [];
      schema.include.forEach(function(includedSchema) {
        result = compileList(includedSchema, name, result);
      });
      schema[name].forEach(function(currentType) {
        result.forEach(function(previousType, previousIndex) {
          if (previousType.tag === currentType.tag && previousType.kind === currentType.kind) {
            exclude.push(previousIndex);
          }
        });
        result.push(currentType);
      });
      return result.filter(function(type, index) {
        return exclude.indexOf(index) === -1;
      });
    }
    function compileMap() {
      var result = {
        scalar: {},
        sequence: {},
        mapping: {},
        fallback: {}
      }, index, length;
      function collectType(type) {
        result[type.kind][type.tag] = result["fallback"][type.tag] = type;
      }
      for (index = 0, length = arguments.length; index < length; index += 1) {
        arguments[index].forEach(collectType);
      }
      return result;
    }
    function Schema(definition) {
      this.include = definition.include || [];
      this.implicit = definition.implicit || [];
      this.explicit = definition.explicit || [];
      this.implicit.forEach(function(type) {
        if (type.loadKind && type.loadKind !== "scalar") {
          throw new YAMLException("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
        }
      });
      this.compiledImplicit = compileList(this, "implicit", []);
      this.compiledExplicit = compileList(this, "explicit", []);
      this.compiledTypeMap = compileMap(this.compiledImplicit, this.compiledExplicit);
    }
    Schema.DEFAULT = null;
    Schema.create = function createSchema() {
      var schemas, types;
      switch (arguments.length) {
        case 1:
          schemas = Schema.DEFAULT;
          types = arguments[0];
          break;
        case 2:
          schemas = arguments[0];
          types = arguments[1];
          break;
        default:
          throw new YAMLException("Wrong number of arguments for Schema.create function");
      }
      schemas = common.toArray(schemas);
      types = common.toArray(types);
      if (!schemas.every(function(schema) {
        return schema instanceof Schema;
      })) {
        throw new YAMLException("Specified list of super schemas (or a single Schema object) contains a non-Schema object.");
      }
      if (!types.every(function(type) {
        return type instanceof Type;
      })) {
        throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
      return new Schema({
        include: schemas,
        explicit: types
      });
    };
    module2.exports = Schema;
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/str.js
var require_str = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/str.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    module2.exports = new Type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function(data) {
        return data !== null ? data : "";
      }
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/seq.js
var require_seq = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/seq.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    module2.exports = new Type("tag:yaml.org,2002:seq", {
      kind: "sequence",
      construct: function(data) {
        return data !== null ? data : [];
      }
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/map.js
var require_map = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/map.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    module2.exports = new Type("tag:yaml.org,2002:map", {
      kind: "mapping",
      construct: function(data) {
        return data !== null ? data : {};
      }
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/schema/failsafe.js
var require_failsafe = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/schema/failsafe.js"(exports2, module2) {
    "use strict";
    var Schema = require_schema();
    module2.exports = new Schema({
      explicit: [
        require_str(),
        require_seq(),
        require_map()
      ]
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/null.js
var require_null = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/null.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveYamlNull(data) {
      if (data === null) return true;
      var max = data.length;
      return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
    }
    function constructYamlNull() {
      return null;
    }
    function isNull(object) {
      return object === null;
    }
    module2.exports = new Type("tag:yaml.org,2002:null", {
      kind: "scalar",
      resolve: resolveYamlNull,
      construct: constructYamlNull,
      predicate: isNull,
      represent: {
        canonical: function() {
          return "~";
        },
        lowercase: function() {
          return "null";
        },
        uppercase: function() {
          return "NULL";
        },
        camelcase: function() {
          return "Null";
        }
      },
      defaultStyle: "lowercase"
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/bool.js
var require_bool = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/bool.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveYamlBoolean(data) {
      if (data === null) return false;
      var max = data.length;
      return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
    }
    function constructYamlBoolean(data) {
      return data === "true" || data === "True" || data === "TRUE";
    }
    function isBoolean(object) {
      return Object.prototype.toString.call(object) === "[object Boolean]";
    }
    module2.exports = new Type("tag:yaml.org,2002:bool", {
      kind: "scalar",
      resolve: resolveYamlBoolean,
      construct: constructYamlBoolean,
      predicate: isBoolean,
      represent: {
        lowercase: function(object) {
          return object ? "true" : "false";
        },
        uppercase: function(object) {
          return object ? "TRUE" : "FALSE";
        },
        camelcase: function(object) {
          return object ? "True" : "False";
        }
      },
      defaultStyle: "lowercase"
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/int.js
var require_int = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/int.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var Type = require_type();
    function isHexCode(c) {
      return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
    }
    function isOctCode(c) {
      return 48 <= c && c <= 55;
    }
    function isDecCode(c) {
      return 48 <= c && c <= 57;
    }
    function resolveYamlInteger(data) {
      if (data === null) return false;
      var max = data.length, index = 0, hasDigits = false, ch;
      if (!max) return false;
      ch = data[index];
      if (ch === "-" || ch === "+") {
        ch = data[++index];
      }
      if (ch === "0") {
        if (index + 1 === max) return true;
        ch = data[++index];
        if (ch === "b") {
          index++;
          for (; index < max; index++) {
            ch = data[index];
            if (ch === "_") continue;
            if (ch !== "0" && ch !== "1") return false;
            hasDigits = true;
          }
          return hasDigits && ch !== "_";
        }
        if (ch === "x") {
          index++;
          for (; index < max; index++) {
            ch = data[index];
            if (ch === "_") continue;
            if (!isHexCode(data.charCodeAt(index))) return false;
            hasDigits = true;
          }
          return hasDigits && ch !== "_";
        }
        for (; index < max; index++) {
          ch = data[index];
          if (ch === "_") continue;
          if (!isOctCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        return hasDigits && ch !== "_";
      }
      if (ch === "_") return false;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (ch === ":") break;
        if (!isDecCode(data.charCodeAt(index))) {
          return false;
        }
        hasDigits = true;
      }
      if (!hasDigits || ch === "_") return false;
      if (ch !== ":") return true;
      return /^(:[0-5]?[0-9])+$/.test(data.slice(index));
    }
    function constructYamlInteger(data) {
      var value = data, sign = 1, ch, base, digits = [];
      if (value.indexOf("_") !== -1) {
        value = value.replace(/_/g, "");
      }
      ch = value[0];
      if (ch === "-" || ch === "+") {
        if (ch === "-") sign = -1;
        value = value.slice(1);
        ch = value[0];
      }
      if (value === "0") return 0;
      if (ch === "0") {
        if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
        if (value[1] === "x") return sign * parseInt(value, 16);
        return sign * parseInt(value, 8);
      }
      if (value.indexOf(":") !== -1) {
        value.split(":").forEach(function(v) {
          digits.unshift(parseInt(v, 10));
        });
        value = 0;
        base = 1;
        digits.forEach(function(d) {
          value += d * base;
          base *= 60;
        });
        return sign * value;
      }
      return sign * parseInt(value, 10);
    }
    function isInteger(object) {
      return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
    }
    module2.exports = new Type("tag:yaml.org,2002:int", {
      kind: "scalar",
      resolve: resolveYamlInteger,
      construct: constructYamlInteger,
      predicate: isInteger,
      represent: {
        binary: function(obj) {
          return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
        },
        octal: function(obj) {
          return obj >= 0 ? "0" + obj.toString(8) : "-0" + obj.toString(8).slice(1);
        },
        decimal: function(obj) {
          return obj.toString(10);
        },
        /* eslint-disable max-len */
        hexadecimal: function(obj) {
          return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
        }
      },
      defaultStyle: "decimal",
      styleAliases: {
        binary: [2, "bin"],
        octal: [8, "oct"],
        decimal: [10, "dec"],
        hexadecimal: [16, "hex"]
      }
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/float.js
var require_float = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/float.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var Type = require_type();
    var YAML_FLOAT_PATTERN = new RegExp(
      // 2.5e4, 2.5 and integers
      "^(?:[-+]?(?:0|[1-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\\.[0-9_]*|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
    );
    function resolveYamlFloat(data) {
      if (data === null) return false;
      if (!YAML_FLOAT_PATTERN.test(data) || // Quick hack to not allow integers end with `_`
      // Probably should update regexp & check speed
      data[data.length - 1] === "_") {
        return false;
      }
      return true;
    }
    function constructYamlFloat(data) {
      var value, sign, base, digits;
      value = data.replace(/_/g, "").toLowerCase();
      sign = value[0] === "-" ? -1 : 1;
      digits = [];
      if ("+-".indexOf(value[0]) >= 0) {
        value = value.slice(1);
      }
      if (value === ".inf") {
        return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      } else if (value === ".nan") {
        return NaN;
      } else if (value.indexOf(":") >= 0) {
        value.split(":").forEach(function(v) {
          digits.unshift(parseFloat(v, 10));
        });
        value = 0;
        base = 1;
        digits.forEach(function(d) {
          value += d * base;
          base *= 60;
        });
        return sign * value;
      }
      return sign * parseFloat(value, 10);
    }
    var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
    function representYamlFloat(object, style) {
      var res;
      if (isNaN(object)) {
        switch (style) {
          case "lowercase":
            return ".nan";
          case "uppercase":
            return ".NAN";
          case "camelcase":
            return ".NaN";
        }
      } else if (Number.POSITIVE_INFINITY === object) {
        switch (style) {
          case "lowercase":
            return ".inf";
          case "uppercase":
            return ".INF";
          case "camelcase":
            return ".Inf";
        }
      } else if (Number.NEGATIVE_INFINITY === object) {
        switch (style) {
          case "lowercase":
            return "-.inf";
          case "uppercase":
            return "-.INF";
          case "camelcase":
            return "-.Inf";
        }
      } else if (common.isNegativeZero(object)) {
        return "-0.0";
      }
      res = object.toString(10);
      return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
    }
    function isFloat(object) {
      return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
    }
    module2.exports = new Type("tag:yaml.org,2002:float", {
      kind: "scalar",
      resolve: resolveYamlFloat,
      construct: constructYamlFloat,
      predicate: isFloat,
      represent: representYamlFloat,
      defaultStyle: "lowercase"
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/schema/json.js
var require_json = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/schema/json.js"(exports2, module2) {
    "use strict";
    var Schema = require_schema();
    module2.exports = new Schema({
      include: [
        require_failsafe()
      ],
      implicit: [
        require_null(),
        require_bool(),
        require_int(),
        require_float()
      ]
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/schema/core.js
var require_core = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/schema/core.js"(exports2, module2) {
    "use strict";
    var Schema = require_schema();
    module2.exports = new Schema({
      include: [
        require_json()
      ]
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/timestamp.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var YAML_DATE_REGEXP = new RegExp(
      "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
    );
    var YAML_TIMESTAMP_REGEXP = new RegExp(
      "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
    );
    function resolveYamlTimestamp(data) {
      if (data === null) return false;
      if (YAML_DATE_REGEXP.exec(data) !== null) return true;
      if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
      return false;
    }
    function constructYamlTimestamp(data) {
      var match, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
      match = YAML_DATE_REGEXP.exec(data);
      if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
      if (match === null) throw new Error("Date resolve error");
      year = +match[1];
      month = +match[2] - 1;
      day = +match[3];
      if (!match[4]) {
        return new Date(Date.UTC(year, month, day));
      }
      hour = +match[4];
      minute = +match[5];
      second = +match[6];
      if (match[7]) {
        fraction = match[7].slice(0, 3);
        while (fraction.length < 3) {
          fraction += "0";
        }
        fraction = +fraction;
      }
      if (match[9]) {
        tz_hour = +match[10];
        tz_minute = +(match[11] || 0);
        delta = (tz_hour * 60 + tz_minute) * 6e4;
        if (match[9] === "-") delta = -delta;
      }
      date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
      if (delta) date.setTime(date.getTime() - delta);
      return date;
    }
    function representYamlTimestamp(object) {
      return object.toISOString();
    }
    module2.exports = new Type("tag:yaml.org,2002:timestamp", {
      kind: "scalar",
      resolve: resolveYamlTimestamp,
      construct: constructYamlTimestamp,
      instanceOf: Date,
      represent: representYamlTimestamp
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/merge.js
var require_merge = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/merge.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveYamlMerge(data) {
      return data === "<<" || data === null;
    }
    module2.exports = new Type("tag:yaml.org,2002:merge", {
      kind: "scalar",
      resolve: resolveYamlMerge
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/binary.js
var require_binary = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/binary.js"(exports2, module2) {
    "use strict";
    var NodeBuffer;
    try {
      _require = require;
      NodeBuffer = _require("buffer").Buffer;
    } catch (__) {
    }
    var _require;
    var Type = require_type();
    var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
    function resolveYamlBinary(data) {
      if (data === null) return false;
      var code, idx, bitlen = 0, max = data.length, map = BASE64_MAP;
      for (idx = 0; idx < max; idx++) {
        code = map.indexOf(data.charAt(idx));
        if (code > 64) continue;
        if (code < 0) return false;
        bitlen += 6;
      }
      return bitlen % 8 === 0;
    }
    function constructYamlBinary(data) {
      var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map = BASE64_MAP, bits = 0, result = [];
      for (idx = 0; idx < max; idx++) {
        if (idx % 4 === 0 && idx) {
          result.push(bits >> 16 & 255);
          result.push(bits >> 8 & 255);
          result.push(bits & 255);
        }
        bits = bits << 6 | map.indexOf(input.charAt(idx));
      }
      tailbits = max % 4 * 6;
      if (tailbits === 0) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      } else if (tailbits === 18) {
        result.push(bits >> 10 & 255);
        result.push(bits >> 2 & 255);
      } else if (tailbits === 12) {
        result.push(bits >> 4 & 255);
      }
      if (NodeBuffer) {
        return NodeBuffer.from ? NodeBuffer.from(result) : new NodeBuffer(result);
      }
      return result;
    }
    function representYamlBinary(object) {
      var result = "", bits = 0, idx, tail, max = object.length, map = BASE64_MAP;
      for (idx = 0; idx < max; idx++) {
        if (idx % 3 === 0 && idx) {
          result += map[bits >> 18 & 63];
          result += map[bits >> 12 & 63];
          result += map[bits >> 6 & 63];
          result += map[bits & 63];
        }
        bits = (bits << 8) + object[idx];
      }
      tail = max % 3;
      if (tail === 0) {
        result += map[bits >> 18 & 63];
        result += map[bits >> 12 & 63];
        result += map[bits >> 6 & 63];
        result += map[bits & 63];
      } else if (tail === 2) {
        result += map[bits >> 10 & 63];
        result += map[bits >> 4 & 63];
        result += map[bits << 2 & 63];
        result += map[64];
      } else if (tail === 1) {
        result += map[bits >> 2 & 63];
        result += map[bits << 4 & 63];
        result += map[64];
        result += map[64];
      }
      return result;
    }
    function isBinary(object) {
      return NodeBuffer && NodeBuffer.isBuffer(object);
    }
    module2.exports = new Type("tag:yaml.org,2002:binary", {
      kind: "scalar",
      resolve: resolveYamlBinary,
      construct: constructYamlBinary,
      predicate: isBinary,
      represent: representYamlBinary
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/omap.js
var require_omap = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/omap.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var _toString = Object.prototype.toString;
    function resolveYamlOmap(data) {
      if (data === null) return true;
      var objectKeys = {}, index, length, pair, pairKey, pairHasKey, object = data;
      for (index = 0, length = object.length; index < length; index += 1) {
        pair = object[index];
        pairHasKey = false;
        if (_toString.call(pair) !== "[object Object]") return false;
        for (pairKey in pair) {
          if (_hasOwnProperty.call(pair, pairKey)) {
            if (!pairHasKey) pairHasKey = true;
            else return false;
          }
        }
        if (!pairHasKey) return false;
        if (_hasOwnProperty.call(objectKeys, pairKey)) return false;
        Object.defineProperty(objectKeys, pairKey, { value: true });
      }
      return true;
    }
    function constructYamlOmap(data) {
      return data !== null ? data : [];
    }
    module2.exports = new Type("tag:yaml.org,2002:omap", {
      kind: "sequence",
      resolve: resolveYamlOmap,
      construct: constructYamlOmap
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/pairs.js
var require_pairs = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/pairs.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _toString = Object.prototype.toString;
    function resolveYamlPairs(data) {
      if (data === null) return true;
      var index, length, pair, keys, result, object = data;
      result = new Array(object.length);
      for (index = 0, length = object.length; index < length; index += 1) {
        pair = object[index];
        if (_toString.call(pair) !== "[object Object]") return false;
        keys = Object.keys(pair);
        if (keys.length !== 1) return false;
        result[index] = [keys[0], pair[keys[0]]];
      }
      return true;
    }
    function constructYamlPairs(data) {
      if (data === null) return [];
      var index, length, pair, keys, result, object = data;
      result = new Array(object.length);
      for (index = 0, length = object.length; index < length; index += 1) {
        pair = object[index];
        keys = Object.keys(pair);
        result[index] = [keys[0], pair[keys[0]]];
      }
      return result;
    }
    module2.exports = new Type("tag:yaml.org,2002:pairs", {
      kind: "sequence",
      resolve: resolveYamlPairs,
      construct: constructYamlPairs
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/set.js
var require_set = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/set.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    function resolveYamlSet(data) {
      if (data === null) return true;
      var key, object = data;
      for (key in object) {
        if (_hasOwnProperty.call(object, key)) {
          if (object[key] !== null) return false;
        }
      }
      return true;
    }
    function constructYamlSet(data) {
      return data !== null ? data : {};
    }
    module2.exports = new Type("tag:yaml.org,2002:set", {
      kind: "mapping",
      resolve: resolveYamlSet,
      construct: constructYamlSet
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/schema/default_safe.js
var require_default_safe = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/schema/default_safe.js"(exports2, module2) {
    "use strict";
    var Schema = require_schema();
    module2.exports = new Schema({
      include: [
        require_core()
      ],
      implicit: [
        require_timestamp(),
        require_merge()
      ],
      explicit: [
        require_binary(),
        require_omap(),
        require_pairs(),
        require_set()
      ]
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/js/undefined.js
var require_undefined = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/js/undefined.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveJavascriptUndefined() {
      return true;
    }
    function constructJavascriptUndefined() {
      return void 0;
    }
    function representJavascriptUndefined() {
      return "";
    }
    function isUndefined(object) {
      return typeof object === "undefined";
    }
    module2.exports = new Type("tag:yaml.org,2002:js/undefined", {
      kind: "scalar",
      resolve: resolveJavascriptUndefined,
      construct: constructJavascriptUndefined,
      predicate: isUndefined,
      represent: representJavascriptUndefined
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/js/regexp.js
var require_regexp = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/js/regexp.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveJavascriptRegExp(data) {
      if (data === null) return false;
      if (data.length === 0) return false;
      var regexp = data, tail = /\/([gim]*)$/.exec(data), modifiers = "";
      if (regexp[0] === "/") {
        if (tail) modifiers = tail[1];
        if (modifiers.length > 3) return false;
        if (regexp[regexp.length - modifiers.length - 1] !== "/") return false;
      }
      return true;
    }
    function constructJavascriptRegExp(data) {
      var regexp = data, tail = /\/([gim]*)$/.exec(data), modifiers = "";
      if (regexp[0] === "/") {
        if (tail) modifiers = tail[1];
        regexp = regexp.slice(1, regexp.length - modifiers.length - 1);
      }
      return new RegExp(regexp, modifiers);
    }
    function representJavascriptRegExp(object) {
      var result = "/" + object.source + "/";
      if (object.global) result += "g";
      if (object.multiline) result += "m";
      if (object.ignoreCase) result += "i";
      return result;
    }
    function isRegExp(object) {
      return Object.prototype.toString.call(object) === "[object RegExp]";
    }
    module2.exports = new Type("tag:yaml.org,2002:js/regexp", {
      kind: "scalar",
      resolve: resolveJavascriptRegExp,
      construct: constructJavascriptRegExp,
      predicate: isRegExp,
      represent: representJavascriptRegExp
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/js/function.js
var require_function = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/type/js/function.js"(exports2, module2) {
    "use strict";
    var esprima;
    try {
      _require = require;
      esprima = _require("esprima");
    } catch (_) {
      if (typeof window !== "undefined") esprima = window.esprima;
    }
    var _require;
    var Type = require_type();
    function resolveJavascriptFunction(data) {
      if (data === null) return false;
      try {
        var source = "(" + data + ")", ast = esprima.parse(source, { range: true });
        if (ast.type !== "Program" || ast.body.length !== 1 || ast.body[0].type !== "ExpressionStatement" || ast.body[0].expression.type !== "ArrowFunctionExpression" && ast.body[0].expression.type !== "FunctionExpression") {
          return false;
        }
        return true;
      } catch (err) {
        return false;
      }
    }
    function constructJavascriptFunction(data) {
      var source = "(" + data + ")", ast = esprima.parse(source, { range: true }), params = [], body;
      if (ast.type !== "Program" || ast.body.length !== 1 || ast.body[0].type !== "ExpressionStatement" || ast.body[0].expression.type !== "ArrowFunctionExpression" && ast.body[0].expression.type !== "FunctionExpression") {
        throw new Error("Failed to resolve function");
      }
      ast.body[0].expression.params.forEach(function(param) {
        params.push(param.name);
      });
      body = ast.body[0].expression.body.range;
      if (ast.body[0].expression.body.type === "BlockStatement") {
        return new Function(params, source.slice(body[0] + 1, body[1] - 1));
      }
      return new Function(params, "return " + source.slice(body[0], body[1]));
    }
    function representJavascriptFunction(object) {
      return object.toString();
    }
    function isFunction(object) {
      return Object.prototype.toString.call(object) === "[object Function]";
    }
    module2.exports = new Type("tag:yaml.org,2002:js/function", {
      kind: "scalar",
      resolve: resolveJavascriptFunction,
      construct: constructJavascriptFunction,
      predicate: isFunction,
      represent: representJavascriptFunction
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/schema/default_full.js
var require_default_full = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/schema/default_full.js"(exports2, module2) {
    "use strict";
    var Schema = require_schema();
    module2.exports = Schema.DEFAULT = new Schema({
      include: [
        require_default_safe()
      ],
      explicit: [
        require_undefined(),
        require_regexp(),
        require_function()
      ]
    });
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/loader.js
var require_loader = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/loader.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var YAMLException = require_exception();
    var Mark = require_mark();
    var DEFAULT_SAFE_SCHEMA = require_default_safe();
    var DEFAULT_FULL_SCHEMA = require_default_full();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var CONTEXT_FLOW_IN = 1;
    var CONTEXT_FLOW_OUT = 2;
    var CONTEXT_BLOCK_IN = 3;
    var CONTEXT_BLOCK_OUT = 4;
    var CHOMPING_CLIP = 1;
    var CHOMPING_STRIP = 2;
    var CHOMPING_KEEP = 3;
    var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
    var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
    var PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
    var PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
    var PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
    function _class(obj) {
      return Object.prototype.toString.call(obj);
    }
    function is_EOL(c) {
      return c === 10 || c === 13;
    }
    function is_WHITE_SPACE(c) {
      return c === 9 || c === 32;
    }
    function is_WS_OR_EOL(c) {
      return c === 9 || c === 32 || c === 10 || c === 13;
    }
    function is_FLOW_INDICATOR(c) {
      return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
    }
    function fromHexCode(c) {
      var lc;
      if (48 <= c && c <= 57) {
        return c - 48;
      }
      lc = c | 32;
      if (97 <= lc && lc <= 102) {
        return lc - 97 + 10;
      }
      return -1;
    }
    function escapedHexLen(c) {
      if (c === 120) {
        return 2;
      }
      if (c === 117) {
        return 4;
      }
      if (c === 85) {
        return 8;
      }
      return 0;
    }
    function fromDecimalCode(c) {
      if (48 <= c && c <= 57) {
        return c - 48;
      }
      return -1;
    }
    function simpleEscapeSequence(c) {
      return c === 48 ? "\0" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "	" : c === 9 ? "	" : c === 110 ? "\n" : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? '"' : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "\x85" : c === 95 ? "\xA0" : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
    }
    function charFromCodepoint(c) {
      if (c <= 65535) {
        return String.fromCharCode(c);
      }
      return String.fromCharCode(
        (c - 65536 >> 10) + 55296,
        (c - 65536 & 1023) + 56320
      );
    }
    function setProperty(object, key, value) {
      if (key === "__proto__") {
        Object.defineProperty(object, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value
        });
      } else {
        object[key] = value;
      }
    }
    var simpleEscapeCheck = new Array(256);
    var simpleEscapeMap = new Array(256);
    for (i = 0; i < 256; i++) {
      simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
      simpleEscapeMap[i] = simpleEscapeSequence(i);
    }
    var i;
    function State(input, options2) {
      this.input = input;
      this.filename = options2["filename"] || null;
      this.schema = options2["schema"] || DEFAULT_FULL_SCHEMA;
      this.onWarning = options2["onWarning"] || null;
      this.legacy = options2["legacy"] || false;
      this.json = options2["json"] || false;
      this.listener = options2["listener"] || null;
      this.maxTotalMergeKeys = typeof options2["maxTotalMergeKeys"] === "number" ? options2["maxTotalMergeKeys"] : 1e4;
      this.implicitTypes = this.schema.compiledImplicit;
      this.typeMap = this.schema.compiledTypeMap;
      this.length = input.length;
      this.position = 0;
      this.line = 0;
      this.lineStart = 0;
      this.lineIndent = 0;
      this.totalMergeKeys = 0;
      this.documents = [];
    }
    function generateError(state, message) {
      return new YAMLException(
        message,
        new Mark(state.filename, state.input, state.position, state.line, state.position - state.lineStart)
      );
    }
    function throwError(state, message) {
      throw generateError(state, message);
    }
    function throwWarning(state, message) {
      if (state.onWarning) {
        state.onWarning.call(null, generateError(state, message));
      }
    }
    var directiveHandlers = {
      YAML: function handleYamlDirective(state, name, args) {
        var match, major, minor;
        if (state.version !== null) {
          throwError(state, "duplication of %YAML directive");
        }
        if (args.length !== 1) {
          throwError(state, "YAML directive accepts exactly one argument");
        }
        match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
        if (match === null) {
          throwError(state, "ill-formed argument of the YAML directive");
        }
        major = parseInt(match[1], 10);
        minor = parseInt(match[2], 10);
        if (major !== 1) {
          throwError(state, "unacceptable YAML version of the document");
        }
        state.version = args[0];
        state.checkLineBreaks = minor < 2;
        if (minor !== 1 && minor !== 2) {
          throwWarning(state, "unsupported YAML version of the document");
        }
      },
      TAG: function handleTagDirective(state, name, args) {
        var handle, prefix;
        if (args.length !== 2) {
          throwError(state, "TAG directive accepts exactly two arguments");
        }
        handle = args[0];
        prefix = args[1];
        if (!PATTERN_TAG_HANDLE.test(handle)) {
          throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
        }
        if (_hasOwnProperty.call(state.tagMap, handle)) {
          throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
        }
        if (!PATTERN_TAG_URI.test(prefix)) {
          throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
        }
        state.tagMap[handle] = prefix;
      }
    };
    function captureSegment(state, start, end, checkJson) {
      var _position, _length, _character, _result;
      if (start < end) {
        _result = state.input.slice(start, end);
        if (checkJson) {
          for (_position = 0, _length = _result.length; _position < _length; _position += 1) {
            _character = _result.charCodeAt(_position);
            if (!(_character === 9 || 32 <= _character && _character <= 1114111)) {
              throwError(state, "expected valid JSON character");
            }
          }
        } else if (PATTERN_NON_PRINTABLE.test(_result)) {
          throwError(state, "the stream contains non-printable characters");
        }
        state.result += _result;
      }
    }
    function chargeMergeWork(state) {
      state.totalMergeKeys += 1;
      if (state.maxTotalMergeKeys !== -1 && state.totalMergeKeys > state.maxTotalMergeKeys) {
        throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
      }
    }
    function mergeMappings(state, destination, source, overridableKeys) {
      var sourceKeys, key, index, quantity;
      if (!common.isObject(source)) {
        throwError(state, "cannot merge mappings; the provided source object is unacceptable");
      }
      chargeMergeWork(state);
      sourceKeys = Object.keys(source);
      for (index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
        key = sourceKeys[index];
        chargeMergeWork(state);
        if (!_hasOwnProperty.call(destination, key)) {
          setProperty(destination, key, source[key]);
          overridableKeys[key] = true;
        }
      }
    }
    function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startPos) {
      var index, quantity;
      if (Array.isArray(keyNode)) {
        keyNode = Array.prototype.slice.call(keyNode);
        for (index = 0, quantity = keyNode.length; index < quantity; index += 1) {
          if (Array.isArray(keyNode[index])) {
            throwError(state, "nested arrays are not supported inside keys");
          }
          if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
            keyNode[index] = "[object Object]";
          }
        }
      }
      if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
        keyNode = "[object Object]";
      }
      keyNode = String(keyNode);
      if (_result === null) {
        _result = {};
      }
      if (keyTag === "tag:yaml.org,2002:merge") {
        if (Array.isArray(valueNode)) {
          if (valueNode.length > 100) {
            throwError(state, "abnormal merge sequence size");
          }
          for (index = 0, quantity = valueNode.length; index < quantity; index += 1) {
            mergeMappings(state, _result, valueNode[index], overridableKeys);
          }
        } else {
          mergeMappings(state, _result, valueNode, overridableKeys);
        }
      } else {
        if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
          state.line = startLine || state.line;
          state.position = startPos || state.position;
          throwError(state, "duplicated mapping key");
        }
        setProperty(_result, keyNode, valueNode);
        delete overridableKeys[keyNode];
      }
      return _result;
    }
    function readLineBreak(state) {
      var ch;
      ch = state.input.charCodeAt(state.position);
      if (ch === 10) {
        state.position++;
      } else if (ch === 13) {
        state.position++;
        if (state.input.charCodeAt(state.position) === 10) {
          state.position++;
        }
      } else {
        throwError(state, "a line break is expected");
      }
      state.line += 1;
      state.lineStart = state.position;
    }
    function skipSeparationSpace(state, allowComments, checkIndent) {
      var lineBreaks = 0, ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        while (is_WHITE_SPACE(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (allowComments && ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (ch !== 10 && ch !== 13 && ch !== 0);
        }
        if (is_EOL(ch)) {
          readLineBreak(state);
          ch = state.input.charCodeAt(state.position);
          lineBreaks++;
          state.lineIndent = 0;
          while (ch === 32) {
            state.lineIndent++;
            ch = state.input.charCodeAt(++state.position);
          }
        } else {
          break;
        }
      }
      if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
        throwWarning(state, "deficient indentation");
      }
      return lineBreaks;
    }
    function testDocumentSeparator(state) {
      var _position = state.position, ch;
      ch = state.input.charCodeAt(_position);
      if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
        _position += 3;
        ch = state.input.charCodeAt(_position);
        if (ch === 0 || is_WS_OR_EOL(ch)) {
          return true;
        }
      }
      return false;
    }
    function writeFoldedLines(state, count) {
      if (count === 1) {
        state.result += " ";
      } else if (count > 1) {
        state.result += common.repeat("\n", count - 1);
      }
    }
    function readPlainScalar(state, nodeIndent, withinFlowCollection) {
      var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, _kind = state.kind, _result = state.result, ch;
      ch = state.input.charCodeAt(state.position);
      if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
        return false;
      }
      if (ch === 63 || ch === 45) {
        following = state.input.charCodeAt(state.position + 1);
        if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
          return false;
        }
      }
      state.kind = "scalar";
      state.result = "";
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
      while (ch !== 0) {
        if (ch === 58) {
          following = state.input.charCodeAt(state.position + 1);
          if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
            break;
          }
        } else if (ch === 35) {
          preceding = state.input.charCodeAt(state.position - 1);
          if (is_WS_OR_EOL(preceding)) {
            break;
          }
        } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && is_FLOW_INDICATOR(ch)) {
          break;
        } else if (is_EOL(ch)) {
          _line = state.line;
          _lineStart = state.lineStart;
          _lineIndent = state.lineIndent;
          skipSeparationSpace(state, false, -1);
          if (state.lineIndent >= nodeIndent) {
            hasPendingContent = true;
            ch = state.input.charCodeAt(state.position);
            continue;
          } else {
            state.position = captureEnd;
            state.line = _line;
            state.lineStart = _lineStart;
            state.lineIndent = _lineIndent;
            break;
          }
        }
        if (hasPendingContent) {
          captureSegment(state, captureStart, captureEnd, false);
          writeFoldedLines(state, state.line - _line);
          captureStart = captureEnd = state.position;
          hasPendingContent = false;
        }
        if (!is_WHITE_SPACE(ch)) {
          captureEnd = state.position + 1;
        }
        ch = state.input.charCodeAt(++state.position);
      }
      captureSegment(state, captureStart, captureEnd, false);
      if (state.result) {
        return true;
      }
      state.kind = _kind;
      state.result = _result;
      return false;
    }
    function readSingleQuotedScalar(state, nodeIndent) {
      var ch, captureStart, captureEnd;
      ch = state.input.charCodeAt(state.position);
      if (ch !== 39) {
        return false;
      }
      state.kind = "scalar";
      state.result = "";
      state.position++;
      captureStart = captureEnd = state.position;
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        if (ch === 39) {
          captureSegment(state, captureStart, state.position, true);
          ch = state.input.charCodeAt(++state.position);
          if (ch === 39) {
            captureStart = state.position;
            state.position++;
            captureEnd = state.position;
          } else {
            return true;
          }
        } else if (is_EOL(ch)) {
          captureSegment(state, captureStart, captureEnd, true);
          writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
          captureStart = captureEnd = state.position;
        } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
          throwError(state, "unexpected end of the document within a single quoted scalar");
        } else {
          state.position++;
          captureEnd = state.position;
        }
      }
      throwError(state, "unexpected end of the stream within a single quoted scalar");
    }
    function readDoubleQuotedScalar(state, nodeIndent) {
      var captureStart, captureEnd, hexLength, hexResult, tmp, ch;
      ch = state.input.charCodeAt(state.position);
      if (ch !== 34) {
        return false;
      }
      state.kind = "scalar";
      state.result = "";
      state.position++;
      captureStart = captureEnd = state.position;
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        if (ch === 34) {
          captureSegment(state, captureStart, state.position, true);
          state.position++;
          return true;
        } else if (ch === 92) {
          captureSegment(state, captureStart, state.position, true);
          ch = state.input.charCodeAt(++state.position);
          if (is_EOL(ch)) {
            skipSeparationSpace(state, false, nodeIndent);
          } else if (ch < 256 && simpleEscapeCheck[ch]) {
            state.result += simpleEscapeMap[ch];
            state.position++;
          } else if ((tmp = escapedHexLen(ch)) > 0) {
            hexLength = tmp;
            hexResult = 0;
            for (; hexLength > 0; hexLength--) {
              ch = state.input.charCodeAt(++state.position);
              if ((tmp = fromHexCode(ch)) >= 0) {
                hexResult = (hexResult << 4) + tmp;
              } else {
                throwError(state, "expected hexadecimal character");
              }
            }
            state.result += charFromCodepoint(hexResult);
            state.position++;
          } else {
            throwError(state, "unknown escape sequence");
          }
          captureStart = captureEnd = state.position;
        } else if (is_EOL(ch)) {
          captureSegment(state, captureStart, captureEnd, true);
          writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
          captureStart = captureEnd = state.position;
        } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
          throwError(state, "unexpected end of the document within a double quoted scalar");
        } else {
          state.position++;
          captureEnd = state.position;
        }
      }
      throwError(state, "unexpected end of the stream within a double quoted scalar");
    }
    function readFlowCollection(state, nodeIndent) {
      var readNext = true, _line, _tag = state.tag, _result, _anchor = state.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = {}, keyNode, keyTag, valueNode, ch;
      ch = state.input.charCodeAt(state.position);
      if (ch === 91) {
        terminator = 93;
        isMapping = false;
        _result = [];
      } else if (ch === 123) {
        terminator = 125;
        isMapping = true;
        _result = {};
      } else {
        return false;
      }
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = _result;
      }
      ch = state.input.charCodeAt(++state.position);
      while (ch !== 0) {
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if (ch === terminator) {
          state.position++;
          state.tag = _tag;
          state.anchor = _anchor;
          state.kind = isMapping ? "mapping" : "sequence";
          state.result = _result;
          return true;
        } else if (!readNext) {
          throwError(state, "missed comma between flow collection entries");
        }
        keyTag = keyNode = valueNode = null;
        isPair = isExplicitPair = false;
        if (ch === 63) {
          following = state.input.charCodeAt(state.position + 1);
          if (is_WS_OR_EOL(following)) {
            isPair = isExplicitPair = true;
            state.position++;
            skipSeparationSpace(state, true, nodeIndent);
          }
        }
        _line = state.line;
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        keyTag = state.tag;
        keyNode = state.result;
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if ((isExplicitPair || state.line === _line) && ch === 58) {
          isPair = true;
          ch = state.input.charCodeAt(++state.position);
          skipSeparationSpace(state, true, nodeIndent);
          composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
          valueNode = state.result;
        }
        if (isMapping) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode);
        } else if (isPair) {
          _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode));
        } else {
          _result.push(keyNode);
        }
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if (ch === 44) {
          readNext = true;
          ch = state.input.charCodeAt(++state.position);
        } else {
          readNext = false;
        }
      }
      throwError(state, "unexpected end of the stream within a flow collection");
    }
    function readBlockScalar(state, nodeIndent) {
      var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch;
      ch = state.input.charCodeAt(state.position);
      if (ch === 124) {
        folding = false;
      } else if (ch === 62) {
        folding = true;
      } else {
        return false;
      }
      state.kind = "scalar";
      state.result = "";
      while (ch !== 0) {
        ch = state.input.charCodeAt(++state.position);
        if (ch === 43 || ch === 45) {
          if (CHOMPING_CLIP === chomping) {
            chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
          } else {
            throwError(state, "repeat of a chomping mode identifier");
          }
        } else if ((tmp = fromDecimalCode(ch)) >= 0) {
          if (tmp === 0) {
            throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
          } else if (!detectedIndent) {
            textIndent = nodeIndent + tmp - 1;
            detectedIndent = true;
          } else {
            throwError(state, "repeat of an indentation width identifier");
          }
        } else {
          break;
        }
      }
      if (is_WHITE_SPACE(ch)) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (is_WHITE_SPACE(ch));
        if (ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (!is_EOL(ch) && ch !== 0);
        }
      }
      while (ch !== 0) {
        readLineBreak(state);
        state.lineIndent = 0;
        ch = state.input.charCodeAt(state.position);
        while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
        if (!detectedIndent && state.lineIndent > textIndent) {
          textIndent = state.lineIndent;
        }
        if (is_EOL(ch)) {
          emptyLines++;
          continue;
        }
        if (state.lineIndent < textIndent) {
          if (chomping === CHOMPING_KEEP) {
            state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
          } else if (chomping === CHOMPING_CLIP) {
            if (didReadContent) {
              state.result += "\n";
            }
          }
          break;
        }
        if (folding) {
          if (is_WHITE_SPACE(ch)) {
            atMoreIndented = true;
            state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
          } else if (atMoreIndented) {
            atMoreIndented = false;
            state.result += common.repeat("\n", emptyLines + 1);
          } else if (emptyLines === 0) {
            if (didReadContent) {
              state.result += " ";
            }
          } else {
            state.result += common.repeat("\n", emptyLines);
          }
        } else {
          state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        }
        didReadContent = true;
        detectedIndent = true;
        emptyLines = 0;
        captureStart = state.position;
        while (!is_EOL(ch) && ch !== 0) {
          ch = state.input.charCodeAt(++state.position);
        }
        captureSegment(state, captureStart, state.position, false);
      }
      return true;
    }
    function readBlockSequence(state, nodeIndent) {
      var _line, _tag = state.tag, _anchor = state.anchor, _result = [], following, detected = false, ch;
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = _result;
      }
      ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        if (ch !== 45) {
          break;
        }
        following = state.input.charCodeAt(state.position + 1);
        if (!is_WS_OR_EOL(following)) {
          break;
        }
        detected = true;
        state.position++;
        if (skipSeparationSpace(state, true, -1)) {
          if (state.lineIndent <= nodeIndent) {
            _result.push(null);
            ch = state.input.charCodeAt(state.position);
            continue;
          }
        }
        _line = state.line;
        composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
        _result.push(state.result);
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
        if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
          throwError(state, "bad indentation of a sequence entry");
        } else if (state.lineIndent < nodeIndent) {
          break;
        }
      }
      if (detected) {
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = "sequence";
        state.result = _result;
        return true;
      }
      return false;
    }
    function readBlockMapping(state, nodeIndent, flowIndent) {
      var following, allowCompact, _line, _pos, _tag = state.tag, _anchor = state.anchor, _result = {}, overridableKeys = {}, keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = _result;
      }
      ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        following = state.input.charCodeAt(state.position + 1);
        _line = state.line;
        _pos = state.position;
        if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
          if (ch === 63) {
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = true;
            allowCompact = true;
          } else if (atExplicitKey) {
            atExplicitKey = false;
            allowCompact = true;
          } else {
            throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
          }
          state.position += 1;
          ch = following;
        } else if (composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
          if (state.line === _line) {
            ch = state.input.charCodeAt(state.position);
            while (is_WHITE_SPACE(ch)) {
              ch = state.input.charCodeAt(++state.position);
            }
            if (ch === 58) {
              ch = state.input.charCodeAt(++state.position);
              if (!is_WS_OR_EOL(ch)) {
                throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
              }
              if (atExplicitKey) {
                storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null);
                keyTag = keyNode = valueNode = null;
              }
              detected = true;
              atExplicitKey = false;
              allowCompact = false;
              keyTag = state.tag;
              keyNode = state.result;
            } else if (detected) {
              throwError(state, "can not read an implicit mapping pair; a colon is missed");
            } else {
              state.tag = _tag;
              state.anchor = _anchor;
              return true;
            }
          } else if (detected) {
            throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
          } else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        } else {
          break;
        }
        if (state.line === _line || state.lineIndent > nodeIndent) {
          if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
            if (atExplicitKey) {
              keyNode = state.result;
            } else {
              valueNode = state.result;
            }
          }
          if (!atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _pos);
            keyTag = keyNode = valueNode = null;
          }
          skipSeparationSpace(state, true, -1);
          ch = state.input.charCodeAt(state.position);
        }
        if (state.lineIndent > nodeIndent && ch !== 0) {
          throwError(state, "bad indentation of a mapping entry");
        } else if (state.lineIndent < nodeIndent) {
          break;
        }
      }
      if (atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null);
      }
      if (detected) {
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = "mapping";
        state.result = _result;
      }
      return detected;
    }
    function readTagProperty(state) {
      var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch;
      ch = state.input.charCodeAt(state.position);
      if (ch !== 33) return false;
      if (state.tag !== null) {
        throwError(state, "duplication of a tag property");
      }
      ch = state.input.charCodeAt(++state.position);
      if (ch === 60) {
        isVerbatim = true;
        ch = state.input.charCodeAt(++state.position);
      } else if (ch === 33) {
        isNamed = true;
        tagHandle = "!!";
        ch = state.input.charCodeAt(++state.position);
      } else {
        tagHandle = "!";
      }
      _position = state.position;
      if (isVerbatim) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 0 && ch !== 62);
        if (state.position < state.length) {
          tagName = state.input.slice(_position, state.position);
          ch = state.input.charCodeAt(++state.position);
        } else {
          throwError(state, "unexpected end of the stream within a verbatim tag");
        }
      } else {
        while (ch !== 0 && !is_WS_OR_EOL(ch)) {
          if (ch === 33) {
            if (!isNamed) {
              tagHandle = state.input.slice(_position - 1, state.position + 1);
              if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
                throwError(state, "named tag handle cannot contain such characters");
              }
              isNamed = true;
              _position = state.position + 1;
            } else {
              throwError(state, "tag suffix cannot contain exclamation marks");
            }
          }
          ch = state.input.charCodeAt(++state.position);
        }
        tagName = state.input.slice(_position, state.position);
        if (PATTERN_FLOW_INDICATORS.test(tagName)) {
          throwError(state, "tag suffix cannot contain flow indicator characters");
        }
      }
      if (tagName && !PATTERN_TAG_URI.test(tagName)) {
        throwError(state, "tag name cannot contain such characters: " + tagName);
      }
      if (isVerbatim) {
        state.tag = tagName;
      } else if (_hasOwnProperty.call(state.tagMap, tagHandle)) {
        state.tag = state.tagMap[tagHandle] + tagName;
      } else if (tagHandle === "!") {
        state.tag = "!" + tagName;
      } else if (tagHandle === "!!") {
        state.tag = "tag:yaml.org,2002:" + tagName;
      } else {
        throwError(state, 'undeclared tag handle "' + tagHandle + '"');
      }
      return true;
    }
    function readAnchorProperty(state) {
      var _position, ch;
      ch = state.input.charCodeAt(state.position);
      if (ch !== 38) return false;
      if (state.anchor !== null) {
        throwError(state, "duplication of an anchor property");
      }
      ch = state.input.charCodeAt(++state.position);
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (state.position === _position) {
        throwError(state, "name of an anchor node must contain at least one character");
      }
      state.anchor = state.input.slice(_position, state.position);
      return true;
    }
    function readAlias(state) {
      var _position, alias, ch;
      ch = state.input.charCodeAt(state.position);
      if (ch !== 42) return false;
      ch = state.input.charCodeAt(++state.position);
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (state.position === _position) {
        throwError(state, "name of an alias node must contain at least one character");
      }
      alias = state.input.slice(_position, state.position);
      if (!_hasOwnProperty.call(state.anchorMap, alias)) {
        throwError(state, 'unidentified alias "' + alias + '"');
      }
      state.result = state.anchorMap[alias];
      skipSeparationSpace(state, true, -1);
      return true;
    }
    function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
      var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, type, flowIndent, blockIndent;
      if (state.listener !== null) {
        state.listener("open", state);
      }
      state.tag = null;
      state.anchor = null;
      state.kind = null;
      state.result = null;
      allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
      if (allowToSeek) {
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          if (state.lineIndent > parentIndent) {
            indentStatus = 1;
          } else if (state.lineIndent === parentIndent) {
            indentStatus = 0;
          } else if (state.lineIndent < parentIndent) {
            indentStatus = -1;
          }
        }
      }
      if (indentStatus === 1) {
        while (readTagProperty(state) || readAnchorProperty(state)) {
          if (skipSeparationSpace(state, true, -1)) {
            atNewLine = true;
            allowBlockCollections = allowBlockStyles;
            if (state.lineIndent > parentIndent) {
              indentStatus = 1;
            } else if (state.lineIndent === parentIndent) {
              indentStatus = 0;
            } else if (state.lineIndent < parentIndent) {
              indentStatus = -1;
            }
          } else {
            allowBlockCollections = false;
          }
        }
      }
      if (allowBlockCollections) {
        allowBlockCollections = atNewLine || allowCompact;
      }
      if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
        if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
          flowIndent = parentIndent;
        } else {
          flowIndent = parentIndent + 1;
        }
        blockIndent = state.position - state.lineStart;
        if (indentStatus === 1) {
          if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
            hasContent = true;
          } else {
            if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
              hasContent = true;
            } else if (readAlias(state)) {
              hasContent = true;
              if (state.tag !== null || state.anchor !== null) {
                throwError(state, "alias node should not have any properties");
              }
            } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
              hasContent = true;
              if (state.tag === null) {
                state.tag = "?";
              }
            }
            if (state.anchor !== null) {
              state.anchorMap[state.anchor] = state.result;
            }
          }
        } else if (indentStatus === 0) {
          hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
        }
      }
      if (state.tag !== null && state.tag !== "!") {
        if (state.tag === "?") {
          if (state.result !== null && state.kind !== "scalar") {
            throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
          }
          for (typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
            type = state.implicitTypes[typeIndex];
            if (type.resolve(state.result)) {
              state.result = type.construct(state.result);
              state.tag = type.tag;
              if (state.anchor !== null) {
                state.anchorMap[state.anchor] = state.result;
              }
              break;
            }
          }
        } else if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) {
          type = state.typeMap[state.kind || "fallback"][state.tag];
          if (state.result !== null && type.kind !== state.kind) {
            throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type.kind + '", not "' + state.kind + '"');
          }
          if (!type.resolve(state.result)) {
            throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
          } else {
            state.result = type.construct(state.result);
            if (state.anchor !== null) {
              state.anchorMap[state.anchor] = state.result;
            }
          }
        } else {
          throwError(state, "unknown tag !<" + state.tag + ">");
        }
      }
      if (state.listener !== null) {
        state.listener("close", state);
      }
      return state.tag !== null || state.anchor !== null || hasContent;
    }
    function readDocument(state) {
      var documentStart = state.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
      state.version = null;
      state.checkLineBreaks = state.legacy;
      state.tagMap = {};
      state.anchorMap = {};
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
        if (state.lineIndent > 0 || ch !== 37) {
          break;
        }
        hasDirectives = true;
        ch = state.input.charCodeAt(++state.position);
        _position = state.position;
        while (ch !== 0 && !is_WS_OR_EOL(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        directiveName = state.input.slice(_position, state.position);
        directiveArgs = [];
        if (directiveName.length < 1) {
          throwError(state, "directive name must not be less than one character in length");
        }
        while (ch !== 0) {
          while (is_WHITE_SPACE(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          if (ch === 35) {
            do {
              ch = state.input.charCodeAt(++state.position);
            } while (ch !== 0 && !is_EOL(ch));
            break;
          }
          if (is_EOL(ch)) break;
          _position = state.position;
          while (ch !== 0 && !is_WS_OR_EOL(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          directiveArgs.push(state.input.slice(_position, state.position));
        }
        if (ch !== 0) readLineBreak(state);
        if (_hasOwnProperty.call(directiveHandlers, directiveName)) {
          directiveHandlers[directiveName](state, directiveName, directiveArgs);
        } else {
          throwWarning(state, 'unknown document directive "' + directiveName + '"');
        }
      }
      skipSeparationSpace(state, true, -1);
      if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      } else if (hasDirectives) {
        throwError(state, "directives end mark is expected");
      }
      composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
      skipSeparationSpace(state, true, -1);
      if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
        throwWarning(state, "non-ASCII line breaks are interpreted as content");
      }
      state.documents.push(state.result);
      if (state.position === state.lineStart && testDocumentSeparator(state)) {
        if (state.input.charCodeAt(state.position) === 46) {
          state.position += 3;
          skipSeparationSpace(state, true, -1);
        }
        return;
      }
      if (state.position < state.length - 1) {
        throwError(state, "end of the stream or a document separator is expected");
      } else {
        return;
      }
    }
    function loadDocuments(input, options2) {
      input = String(input);
      options2 = options2 || {};
      if (input.length !== 0) {
        if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
          input += "\n";
        }
        if (input.charCodeAt(0) === 65279) {
          input = input.slice(1);
        }
      }
      var state = new State(input, options2);
      var nullpos = input.indexOf("\0");
      if (nullpos !== -1) {
        state.position = nullpos;
        throwError(state, "null byte is not allowed in input");
      }
      state.input += "\0";
      while (state.input.charCodeAt(state.position) === 32) {
        state.lineIndent += 1;
        state.position += 1;
      }
      while (state.position < state.length - 1) {
        readDocument(state);
      }
      return state.documents;
    }
    function loadAll(input, iterator, options2) {
      if (iterator !== null && typeof iterator === "object" && typeof options2 === "undefined") {
        options2 = iterator;
        iterator = null;
      }
      var documents = loadDocuments(input, options2);
      if (typeof iterator !== "function") {
        return documents;
      }
      for (var index = 0, length = documents.length; index < length; index += 1) {
        iterator(documents[index]);
      }
    }
    function load(input, options2) {
      var documents = loadDocuments(input, options2);
      if (documents.length === 0) {
        return void 0;
      } else if (documents.length === 1) {
        return documents[0];
      }
      throw new YAMLException("expected a single document in the stream, but found more");
    }
    function safeLoadAll(input, iterator, options2) {
      if (typeof iterator === "object" && iterator !== null && typeof options2 === "undefined") {
        options2 = iterator;
        iterator = null;
      }
      return loadAll(input, iterator, common.extend({ schema: DEFAULT_SAFE_SCHEMA }, options2));
    }
    function safeLoad(input, options2) {
      return load(input, common.extend({ schema: DEFAULT_SAFE_SCHEMA }, options2));
    }
    module2.exports.loadAll = loadAll;
    module2.exports.load = load;
    module2.exports.safeLoadAll = safeLoadAll;
    module2.exports.safeLoad = safeLoad;
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/dumper.js
var require_dumper = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml/dumper.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var YAMLException = require_exception();
    var DEFAULT_FULL_SCHEMA = require_default_full();
    var DEFAULT_SAFE_SCHEMA = require_default_safe();
    var _toString = Object.prototype.toString;
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var CHAR_TAB = 9;
    var CHAR_LINE_FEED = 10;
    var CHAR_CARRIAGE_RETURN = 13;
    var CHAR_SPACE = 32;
    var CHAR_EXCLAMATION = 33;
    var CHAR_DOUBLE_QUOTE = 34;
    var CHAR_SHARP = 35;
    var CHAR_PERCENT = 37;
    var CHAR_AMPERSAND = 38;
    var CHAR_SINGLE_QUOTE = 39;
    var CHAR_ASTERISK = 42;
    var CHAR_COMMA = 44;
    var CHAR_MINUS = 45;
    var CHAR_COLON = 58;
    var CHAR_EQUALS = 61;
    var CHAR_GREATER_THAN = 62;
    var CHAR_QUESTION = 63;
    var CHAR_COMMERCIAL_AT = 64;
    var CHAR_LEFT_SQUARE_BRACKET = 91;
    var CHAR_RIGHT_SQUARE_BRACKET = 93;
    var CHAR_GRAVE_ACCENT = 96;
    var CHAR_LEFT_CURLY_BRACKET = 123;
    var CHAR_VERTICAL_LINE = 124;
    var CHAR_RIGHT_CURLY_BRACKET = 125;
    var ESCAPE_SEQUENCES = {};
    ESCAPE_SEQUENCES[0] = "\\0";
    ESCAPE_SEQUENCES[7] = "\\a";
    ESCAPE_SEQUENCES[8] = "\\b";
    ESCAPE_SEQUENCES[9] = "\\t";
    ESCAPE_SEQUENCES[10] = "\\n";
    ESCAPE_SEQUENCES[11] = "\\v";
    ESCAPE_SEQUENCES[12] = "\\f";
    ESCAPE_SEQUENCES[13] = "\\r";
    ESCAPE_SEQUENCES[27] = "\\e";
    ESCAPE_SEQUENCES[34] = '\\"';
    ESCAPE_SEQUENCES[92] = "\\\\";
    ESCAPE_SEQUENCES[133] = "\\N";
    ESCAPE_SEQUENCES[160] = "\\_";
    ESCAPE_SEQUENCES[8232] = "\\L";
    ESCAPE_SEQUENCES[8233] = "\\P";
    var DEPRECATED_BOOLEANS_SYNTAX = [
      "y",
      "Y",
      "yes",
      "Yes",
      "YES",
      "on",
      "On",
      "ON",
      "n",
      "N",
      "no",
      "No",
      "NO",
      "off",
      "Off",
      "OFF"
    ];
    function compileStyleMap(schema, map) {
      var result, keys, index, length, tag, style, type;
      if (map === null) return {};
      result = {};
      keys = Object.keys(map);
      for (index = 0, length = keys.length; index < length; index += 1) {
        tag = keys[index];
        style = String(map[tag]);
        if (tag.slice(0, 2) === "!!") {
          tag = "tag:yaml.org,2002:" + tag.slice(2);
        }
        type = schema.compiledTypeMap["fallback"][tag];
        if (type && _hasOwnProperty.call(type.styleAliases, style)) {
          style = type.styleAliases[style];
        }
        result[tag] = style;
      }
      return result;
    }
    function encodeHex(character) {
      var string, handle, length;
      string = character.toString(16).toUpperCase();
      if (character <= 255) {
        handle = "x";
        length = 2;
      } else if (character <= 65535) {
        handle = "u";
        length = 4;
      } else if (character <= 4294967295) {
        handle = "U";
        length = 8;
      } else {
        throw new YAMLException("code point within a string may not be greater than 0xFFFFFFFF");
      }
      return "\\" + handle + common.repeat("0", length - string.length) + string;
    }
    function State(options2) {
      this.schema = options2["schema"] || DEFAULT_FULL_SCHEMA;
      this.indent = Math.max(1, options2["indent"] || 2);
      this.noArrayIndent = options2["noArrayIndent"] || false;
      this.skipInvalid = options2["skipInvalid"] || false;
      this.flowLevel = common.isNothing(options2["flowLevel"]) ? -1 : options2["flowLevel"];
      this.styleMap = compileStyleMap(this.schema, options2["styles"] || null);
      this.sortKeys = options2["sortKeys"] || false;
      this.lineWidth = options2["lineWidth"] || 80;
      this.noRefs = options2["noRefs"] || false;
      this.noCompatMode = options2["noCompatMode"] || false;
      this.condenseFlow = options2["condenseFlow"] || false;
      this.implicitTypes = this.schema.compiledImplicit;
      this.explicitTypes = this.schema.compiledExplicit;
      this.tag = null;
      this.result = "";
      this.duplicates = [];
      this.usedDuplicates = null;
    }
    function indentString(string, spaces) {
      var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
      while (position < length) {
        next = string.indexOf("\n", position);
        if (next === -1) {
          line = string.slice(position);
          position = length;
        } else {
          line = string.slice(position, next + 1);
          position = next + 1;
        }
        if (line.length && line !== "\n") result += ind;
        result += line;
      }
      return result;
    }
    function generateNextLine(state, level) {
      return "\n" + common.repeat(" ", state.indent * level);
    }
    function testImplicitResolving(state, str2) {
      var index, length, type;
      for (index = 0, length = state.implicitTypes.length; index < length; index += 1) {
        type = state.implicitTypes[index];
        if (type.resolve(str2)) {
          return true;
        }
      }
      return false;
    }
    function isWhitespace(c) {
      return c === CHAR_SPACE || c === CHAR_TAB;
    }
    function isPrintable(c) {
      return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== 65279 || 65536 <= c && c <= 1114111;
    }
    function isNsChar(c) {
      return isPrintable(c) && !isWhitespace(c) && c !== 65279 && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
    }
    function isPlainSafe(c, prev) {
      return isPrintable(c) && c !== 65279 && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_COLON && (c !== CHAR_SHARP || prev && isNsChar(prev));
    }
    function isPlainSafeFirst(c) {
      return isPrintable(c) && c !== 65279 && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
    }
    function needIndentIndicator(string) {
      var leadingSpaceRe = /^\n* /;
      return leadingSpaceRe.test(string);
    }
    var STYLE_PLAIN = 1;
    var STYLE_SINGLE = 2;
    var STYLE_LITERAL = 3;
    var STYLE_FOLDED = 4;
    var STYLE_DOUBLE = 5;
    function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType) {
      var i;
      var char, prev_char;
      var hasLineBreak = false;
      var hasFoldableLine = false;
      var shouldTrackWidth = lineWidth !== -1;
      var previousLineBreak = -1;
      var plain = isPlainSafeFirst(string.charCodeAt(0)) && !isWhitespace(string.charCodeAt(string.length - 1));
      if (singleLineOnly) {
        for (i = 0; i < string.length; i++) {
          char = string.charCodeAt(i);
          if (!isPrintable(char)) {
            return STYLE_DOUBLE;
          }
          prev_char = i > 0 ? string.charCodeAt(i - 1) : null;
          plain = plain && isPlainSafe(char, prev_char);
        }
      } else {
        for (i = 0; i < string.length; i++) {
          char = string.charCodeAt(i);
          if (char === CHAR_LINE_FEED) {
            hasLineBreak = true;
            if (shouldTrackWidth) {
              hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
              i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
              previousLineBreak = i;
            }
          } else if (!isPrintable(char)) {
            return STYLE_DOUBLE;
          }
          prev_char = i > 0 ? string.charCodeAt(i - 1) : null;
          plain = plain && isPlainSafe(char, prev_char);
        }
        hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
      }
      if (!hasLineBreak && !hasFoldableLine) {
        return plain && !testAmbiguousType(string) ? STYLE_PLAIN : STYLE_SINGLE;
      }
      if (indentPerLevel > 9 && needIndentIndicator(string)) {
        return STYLE_DOUBLE;
      }
      return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
    }
    function writeScalar(state, string, level, iskey) {
      state.dump = (function() {
        if (string.length === 0) {
          return "''";
        }
        if (!state.noCompatMode && DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1) {
          return "'" + string + "'";
        }
        var indent = state.indent * Math.max(1, level);
        var lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
        var singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
        function testAmbiguity(string2) {
          return testImplicitResolving(state, string2);
        }
        switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity)) {
          case STYLE_PLAIN:
            return string;
          case STYLE_SINGLE:
            return "'" + string.replace(/'/g, "''") + "'";
          case STYLE_LITERAL:
            return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
          case STYLE_FOLDED:
            return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
          case STYLE_DOUBLE:
            return '"' + escapeString(string, lineWidth) + '"';
          default:
            throw new YAMLException("impossible error: invalid scalar style");
        }
      })();
    }
    function blockHeader(string, indentPerLevel) {
      var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
      var clip = string[string.length - 1] === "\n";
      var keep = clip && (string[string.length - 2] === "\n" || string === "\n");
      var chomp = keep ? "+" : clip ? "" : "-";
      return indentIndicator + chomp + "\n";
    }
    function dropEndingNewline(string) {
      return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
    }
    function foldString(string, width) {
      var lineRe = /(\n+)([^\n]*)/g;
      var result = (function() {
        var nextLF = string.indexOf("\n");
        nextLF = nextLF !== -1 ? nextLF : string.length;
        lineRe.lastIndex = nextLF;
        return foldLine(string.slice(0, nextLF), width);
      })();
      var prevMoreIndented = string[0] === "\n" || string[0] === " ";
      var moreIndented;
      var match;
      while (match = lineRe.exec(string)) {
        var prefix = match[1], line = match[2];
        moreIndented = line[0] === " ";
        result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
        prevMoreIndented = moreIndented;
      }
      return result;
    }
    function foldLine(line, width) {
      if (line === "" || line[0] === " ") return line;
      var breakRe = / [^ ]/g;
      var match;
      var start = 0, end, curr = 0, next = 0;
      var result = "";
      while (match = breakRe.exec(line)) {
        next = match.index;
        if (next - start > width) {
          end = curr > start ? curr : next;
          result += "\n" + line.slice(start, end);
          start = end + 1;
        }
        curr = next;
      }
      result += "\n";
      if (line.length - start > width && curr > start) {
        result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
      } else {
        result += line.slice(start);
      }
      return result.slice(1);
    }
    function escapeString(string) {
      var result = "";
      var char, nextChar;
      var escapeSeq;
      for (var i = 0; i < string.length; i++) {
        char = string.charCodeAt(i);
        if (char >= 55296 && char <= 56319) {
          nextChar = string.charCodeAt(i + 1);
          if (nextChar >= 56320 && nextChar <= 57343) {
            result += encodeHex((char - 55296) * 1024 + nextChar - 56320 + 65536);
            i++;
            continue;
          }
        }
        escapeSeq = ESCAPE_SEQUENCES[char];
        result += !escapeSeq && isPrintable(char) ? string[i] : escapeSeq || encodeHex(char);
      }
      return result;
    }
    function writeFlowSequence(state, level, object) {
      var _result = "", _tag = state.tag, index, length;
      for (index = 0, length = object.length; index < length; index += 1) {
        if (writeNode(state, level, object[index], false, false)) {
          if (index !== 0) _result += "," + (!state.condenseFlow ? " " : "");
          _result += state.dump;
        }
      }
      state.tag = _tag;
      state.dump = "[" + _result + "]";
    }
    function writeBlockSequence(state, level, object, compact) {
      var _result = "", _tag = state.tag, index, length;
      for (index = 0, length = object.length; index < length; index += 1) {
        if (writeNode(state, level + 1, object[index], true, true)) {
          if (!compact || index !== 0) {
            _result += generateNextLine(state, level);
          }
          if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
            _result += "-";
          } else {
            _result += "- ";
          }
          _result += state.dump;
        }
      }
      state.tag = _tag;
      state.dump = _result || "[]";
    }
    function writeFlowMapping(state, level, object) {
      var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, pairBuffer;
      for (index = 0, length = objectKeyList.length; index < length; index += 1) {
        pairBuffer = "";
        if (index !== 0) pairBuffer += ", ";
        if (state.condenseFlow) pairBuffer += '"';
        objectKey = objectKeyList[index];
        objectValue = object[objectKey];
        if (!writeNode(state, level, objectKey, false, false)) {
          continue;
        }
        if (state.dump.length > 1024) pairBuffer += "? ";
        pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
        if (!writeNode(state, level, objectValue, false, false)) {
          continue;
        }
        pairBuffer += state.dump;
        _result += pairBuffer;
      }
      state.tag = _tag;
      state.dump = "{" + _result + "}";
    }
    function writeBlockMapping(state, level, object, compact) {
      var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
      if (state.sortKeys === true) {
        objectKeyList.sort();
      } else if (typeof state.sortKeys === "function") {
        objectKeyList.sort(state.sortKeys);
      } else if (state.sortKeys) {
        throw new YAMLException("sortKeys must be a boolean or a function");
      }
      for (index = 0, length = objectKeyList.length; index < length; index += 1) {
        pairBuffer = "";
        if (!compact || index !== 0) {
          pairBuffer += generateNextLine(state, level);
        }
        objectKey = objectKeyList[index];
        objectValue = object[objectKey];
        if (!writeNode(state, level + 1, objectKey, true, true, true)) {
          continue;
        }
        explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
        if (explicitPair) {
          if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
            pairBuffer += "?";
          } else {
            pairBuffer += "? ";
          }
        }
        pairBuffer += state.dump;
        if (explicitPair) {
          pairBuffer += generateNextLine(state, level);
        }
        if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
          continue;
        }
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          pairBuffer += ":";
        } else {
          pairBuffer += ": ";
        }
        pairBuffer += state.dump;
        _result += pairBuffer;
      }
      state.tag = _tag;
      state.dump = _result || "{}";
    }
    function detectType(state, object, explicit) {
      var _result, typeList, index, length, type, style;
      typeList = explicit ? state.explicitTypes : state.implicitTypes;
      for (index = 0, length = typeList.length; index < length; index += 1) {
        type = typeList[index];
        if ((type.instanceOf || type.predicate) && (!type.instanceOf || typeof object === "object" && object instanceof type.instanceOf) && (!type.predicate || type.predicate(object))) {
          state.tag = explicit ? type.tag : "?";
          if (type.represent) {
            style = state.styleMap[type.tag] || type.defaultStyle;
            if (_toString.call(type.represent) === "[object Function]") {
              _result = type.represent(object, style);
            } else if (_hasOwnProperty.call(type.represent, style)) {
              _result = type.represent[style](object, style);
            } else {
              throw new YAMLException("!<" + type.tag + '> tag resolver accepts not "' + style + '" style');
            }
            state.dump = _result;
          }
          return true;
        }
      }
      return false;
    }
    function writeNode(state, level, object, block, compact, iskey) {
      state.tag = null;
      state.dump = object;
      if (!detectType(state, object, false)) {
        detectType(state, object, true);
      }
      var type = _toString.call(state.dump);
      if (block) {
        block = state.flowLevel < 0 || state.flowLevel > level;
      }
      var objectOrArray = type === "[object Object]" || type === "[object Array]", duplicateIndex, duplicate;
      if (objectOrArray) {
        duplicateIndex = state.duplicates.indexOf(object);
        duplicate = duplicateIndex !== -1;
      }
      if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
        compact = false;
      }
      if (duplicate && state.usedDuplicates[duplicateIndex]) {
        state.dump = "*ref_" + duplicateIndex;
      } else {
        if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
          state.usedDuplicates[duplicateIndex] = true;
        }
        if (type === "[object Object]") {
          if (block && Object.keys(state.dump).length !== 0) {
            writeBlockMapping(state, level, state.dump, compact);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + state.dump;
            }
          } else {
            writeFlowMapping(state, level, state.dump);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + " " + state.dump;
            }
          }
        } else if (type === "[object Array]") {
          var arrayLevel = state.noArrayIndent && level > 0 ? level - 1 : level;
          if (block && state.dump.length !== 0) {
            writeBlockSequence(state, arrayLevel, state.dump, compact);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + state.dump;
            }
          } else {
            writeFlowSequence(state, arrayLevel, state.dump);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + " " + state.dump;
            }
          }
        } else if (type === "[object String]") {
          if (state.tag !== "?") {
            writeScalar(state, state.dump, level, iskey);
          }
        } else {
          if (state.skipInvalid) return false;
          throw new YAMLException("unacceptable kind of an object to dump " + type);
        }
        if (state.tag !== null && state.tag !== "?") {
          state.dump = "!<" + state.tag + "> " + state.dump;
        }
      }
      return true;
    }
    function getDuplicateReferences(object, state) {
      var objects = [], duplicatesIndexes = [], index, length;
      inspectNode(object, objects, duplicatesIndexes);
      for (index = 0, length = duplicatesIndexes.length; index < length; index += 1) {
        state.duplicates.push(objects[duplicatesIndexes[index]]);
      }
      state.usedDuplicates = new Array(length);
    }
    function inspectNode(object, objects, duplicatesIndexes) {
      var objectKeyList, index, length;
      if (object !== null && typeof object === "object") {
        index = objects.indexOf(object);
        if (index !== -1) {
          if (duplicatesIndexes.indexOf(index) === -1) {
            duplicatesIndexes.push(index);
          }
        } else {
          objects.push(object);
          if (Array.isArray(object)) {
            for (index = 0, length = object.length; index < length; index += 1) {
              inspectNode(object[index], objects, duplicatesIndexes);
            }
          } else {
            objectKeyList = Object.keys(object);
            for (index = 0, length = objectKeyList.length; index < length; index += 1) {
              inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
            }
          }
        }
      }
    }
    function dump(input, options2) {
      options2 = options2 || {};
      var state = new State(options2);
      if (!state.noRefs) getDuplicateReferences(input, state);
      if (writeNode(state, 0, input, true, true)) return state.dump + "\n";
      return "";
    }
    function safeDump(input, options2) {
      return dump(input, common.extend({ schema: DEFAULT_SAFE_SCHEMA }, options2));
    }
    module2.exports.dump = dump;
    module2.exports.safeDump = safeDump;
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml.js
var require_js_yaml = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/lib/js-yaml.js"(exports2, module2) {
    "use strict";
    var loader = require_loader();
    var dumper = require_dumper();
    function deprecated(name) {
      return function() {
        throw new Error("Function " + name + " is deprecated and cannot be used.");
      };
    }
    module2.exports.Type = require_type();
    module2.exports.Schema = require_schema();
    module2.exports.FAILSAFE_SCHEMA = require_failsafe();
    module2.exports.JSON_SCHEMA = require_json();
    module2.exports.CORE_SCHEMA = require_core();
    module2.exports.DEFAULT_SAFE_SCHEMA = require_default_safe();
    module2.exports.DEFAULT_FULL_SCHEMA = require_default_full();
    module2.exports.load = loader.load;
    module2.exports.loadAll = loader.loadAll;
    module2.exports.safeLoad = loader.safeLoad;
    module2.exports.safeLoadAll = loader.safeLoadAll;
    module2.exports.dump = dumper.dump;
    module2.exports.safeDump = dumper.safeDump;
    module2.exports.YAMLException = require_exception();
    module2.exports.MINIMAL_SCHEMA = require_failsafe();
    module2.exports.SAFE_SCHEMA = require_default_safe();
    module2.exports.DEFAULT_SCHEMA = require_default_full();
    module2.exports.scan = deprecated("scan");
    module2.exports.parse = deprecated("parse");
    module2.exports.compose = deprecated("compose");
    module2.exports.addConstructor = deprecated("addConstructor");
  }
});

// node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/index.js
var require_js_yaml2 = __commonJS({
  "node_modules/.pnpm/js-yaml@3.15.2/node_modules/js-yaml/index.js"(exports2, module2) {
    "use strict";
    var yaml2 = require_js_yaml();
    module2.exports = yaml2;
  }
});

// node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/engines.js
var require_engines = __commonJS({
  "node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/engines.js"(exports, module) {
    "use strict";
    var yaml = require_js_yaml2();
    var engines = exports = module.exports;
    engines.yaml = {
      parse: yaml.safeLoad.bind(yaml),
      stringify: yaml.safeDump.bind(yaml)
    };
    engines.json = {
      parse: JSON.parse.bind(JSON),
      stringify: function(obj, options2) {
        const opts = Object.assign({ replacer: null, space: 2 }, options2);
        return JSON.stringify(obj, opts.replacer, opts.space);
      }
    };
    engines.javascript = {
      parse: function parse(str, options, wrap) {
        try {
          if (wrap !== false) {
            str = "(function() {\nreturn " + str.trim() + ";\n}());";
          }
          return eval(str) || {};
        } catch (err) {
          if (wrap !== false && /(unexpected|identifier)/i.test(err.message)) {
            return parse(str, options, false);
          }
          throw new SyntaxError(err);
        }
      },
      stringify: function() {
        throw new Error("stringifying JavaScript is not supported");
      }
    };
  }
});

// node_modules/.pnpm/strip-bom-string@1.0.0/node_modules/strip-bom-string/index.js
var require_strip_bom_string = __commonJS({
  "node_modules/.pnpm/strip-bom-string@1.0.0/node_modules/strip-bom-string/index.js"(exports2, module2) {
    "use strict";
    module2.exports = function(str2) {
      if (typeof str2 === "string" && str2.charAt(0) === "\uFEFF") {
        return str2.slice(1);
      }
      return str2;
    };
  }
});

// node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/utils.js
var require_utils = __commonJS({
  "node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/utils.js"(exports2) {
    "use strict";
    var stripBom = require_strip_bom_string();
    var typeOf = require_kind_of();
    exports2.define = function(obj, key, val) {
      Reflect.defineProperty(obj, key, {
        enumerable: false,
        configurable: true,
        writable: true,
        value: val
      });
    };
    exports2.isBuffer = function(val) {
      return typeOf(val) === "buffer";
    };
    exports2.isObject = function(val) {
      return typeOf(val) === "object";
    };
    exports2.toBuffer = function(input) {
      return typeof input === "string" ? Buffer.from(input) : input;
    };
    exports2.toString = function(input) {
      if (exports2.isBuffer(input)) return stripBom(String(input));
      if (typeof input !== "string") {
        throw new TypeError("expected input to be a string or buffer");
      }
      return stripBom(input);
    };
    exports2.arrayify = function(val) {
      return val ? Array.isArray(val) ? val : [val] : [];
    };
    exports2.startsWith = function(str2, substr, len) {
      if (typeof len !== "number") len = substr.length;
      return str2.slice(0, len) === substr;
    };
  }
});

// node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/defaults.js
var require_defaults = __commonJS({
  "node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/defaults.js"(exports2, module2) {
    "use strict";
    var engines2 = require_engines();
    var utils = require_utils();
    module2.exports = function(options2) {
      const opts = Object.assign({}, options2);
      opts.delimiters = utils.arrayify(opts.delims || opts.delimiters || "---");
      if (opts.delimiters.length === 1) {
        opts.delimiters.push(opts.delimiters[0]);
      }
      opts.language = (opts.language || opts.lang || "yaml").toLowerCase();
      opts.engines = Object.assign({}, engines2, opts.parsers, opts.engines);
      return opts;
    };
  }
});

// node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/engine.js
var require_engine = __commonJS({
  "node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/engine.js"(exports2, module2) {
    "use strict";
    module2.exports = function(name, options2) {
      let engine = options2.engines[name] || options2.engines[aliase(name)];
      if (typeof engine === "undefined") {
        throw new Error('gray-matter engine "' + name + '" is not registered');
      }
      if (typeof engine === "function") {
        engine = { parse: engine };
      }
      return engine;
    };
    function aliase(name) {
      switch (name.toLowerCase()) {
        case "js":
        case "javascript":
          return "javascript";
        case "coffee":
        case "coffeescript":
        case "cson":
          return "coffee";
        case "yaml":
        case "yml":
          return "yaml";
        default: {
          return name;
        }
      }
    }
  }
});

// node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/stringify.js
var require_stringify = __commonJS({
  "node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/stringify.js"(exports2, module2) {
    "use strict";
    var typeOf = require_kind_of();
    var getEngine = require_engine();
    var defaults = require_defaults();
    module2.exports = function(file, data, options2) {
      if (data == null && options2 == null) {
        switch (typeOf(file)) {
          case "object":
            data = file.data;
            options2 = {};
            break;
          case "string":
            return file;
          default: {
            throw new TypeError("expected file to be a string or object");
          }
        }
      }
      const str2 = file.content;
      const opts = defaults(options2);
      if (data == null) {
        if (!opts.data) return file;
        data = opts.data;
      }
      const language = file.language || opts.language;
      const engine = getEngine(language, opts);
      if (typeof engine.stringify !== "function") {
        throw new TypeError('expected "' + language + '.stringify" to be a function');
      }
      data = Object.assign({}, file.data, data);
      const open = opts.delimiters[0];
      const close = opts.delimiters[1];
      const matter5 = engine.stringify(data, options2).trim();
      let buf = "";
      if (matter5 !== "{}") {
        buf = newline(open) + newline(matter5) + newline(close);
      }
      if (typeof file.excerpt === "string" && file.excerpt !== "") {
        if (str2.indexOf(file.excerpt.trim()) === -1) {
          buf += newline(file.excerpt) + newline(close);
        }
      }
      return buf + newline(str2);
    };
    function newline(str2) {
      return str2.slice(-1) !== "\n" ? str2 + "\n" : str2;
    }
  }
});

// node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/excerpt.js
var require_excerpt = __commonJS({
  "node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/excerpt.js"(exports2, module2) {
    "use strict";
    var defaults = require_defaults();
    module2.exports = function(file, options2) {
      const opts = defaults(options2);
      if (file.data == null) {
        file.data = {};
      }
      if (typeof opts.excerpt === "function") {
        return opts.excerpt(file, opts);
      }
      const sep = file.data.excerpt_separator || opts.excerpt_separator;
      if (sep == null && (opts.excerpt === false || opts.excerpt == null)) {
        return file;
      }
      const delimiter = typeof opts.excerpt === "string" ? opts.excerpt : sep || opts.delimiters[0];
      const idx = file.content.indexOf(delimiter);
      if (idx !== -1) {
        file.excerpt = file.content.slice(0, idx);
      }
      return file;
    };
  }
});

// node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/to-file.js
var require_to_file = __commonJS({
  "node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/to-file.js"(exports2, module2) {
    "use strict";
    var typeOf = require_kind_of();
    var stringify = require_stringify();
    var utils = require_utils();
    module2.exports = function(file) {
      if (typeOf(file) !== "object") {
        file = { content: file };
      }
      if (typeOf(file.data) !== "object") {
        file.data = {};
      }
      if (file.contents && file.content == null) {
        file.content = file.contents;
      }
      utils.define(file, "orig", utils.toBuffer(file.content));
      utils.define(file, "language", file.language || "");
      utils.define(file, "matter", file.matter || "");
      utils.define(file, "stringify", function(data, options2) {
        if (options2 && options2.language) {
          file.language = options2.language;
        }
        return stringify(file, data, options2);
      });
      file.content = utils.toString(file.content);
      file.isEmpty = false;
      file.excerpt = "";
      return file;
    };
  }
});

// node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/parse.js
var require_parse = __commonJS({
  "node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/lib/parse.js"(exports2, module2) {
    "use strict";
    var getEngine = require_engine();
    var defaults = require_defaults();
    module2.exports = function(language, str2, options2) {
      const opts = defaults(options2);
      const engine = getEngine(language, opts);
      if (typeof engine.parse !== "function") {
        throw new TypeError('expected "' + language + '.parse" to be a function');
      }
      return engine.parse(str2, opts);
    };
  }
});

// node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/index.js
var require_gray_matter = __commonJS({
  "node_modules/.pnpm/gray-matter@4.0.3/node_modules/gray-matter/index.js"(exports2, module2) {
    "use strict";
    var fs6 = require("fs");
    var sections = require_section_matter();
    var defaults = require_defaults();
    var stringify = require_stringify();
    var excerpt = require_excerpt();
    var engines2 = require_engines();
    var toFile = require_to_file();
    var parse2 = require_parse();
    var utils = require_utils();
    function matter5(input, options2) {
      if (input === "") {
        return { data: {}, content: input, excerpt: "", orig: input };
      }
      let file = toFile(input);
      const cached = matter5.cache[file.content];
      if (!options2) {
        if (cached) {
          file = Object.assign({}, cached);
          file.orig = cached.orig;
          return file;
        }
        matter5.cache[file.content] = file;
      }
      return parseMatter(file, options2);
    }
    function parseMatter(file, options2) {
      const opts = defaults(options2);
      const open = opts.delimiters[0];
      const close = "\n" + opts.delimiters[1];
      let str2 = file.content;
      if (opts.language) {
        file.language = opts.language;
      }
      const openLen = open.length;
      if (!utils.startsWith(str2, open, openLen)) {
        excerpt(file, opts);
        return file;
      }
      if (str2.charAt(openLen) === open.slice(-1)) {
        return file;
      }
      str2 = str2.slice(openLen);
      const len = str2.length;
      const language = matter5.language(str2, opts);
      if (language.name) {
        file.language = language.name;
        str2 = str2.slice(language.raw.length);
      }
      let closeIndex = str2.indexOf(close);
      if (closeIndex === -1) {
        closeIndex = len;
      }
      file.matter = str2.slice(0, closeIndex);
      const block = file.matter.replace(/^\s*#[^\n]+/gm, "").trim();
      if (block === "") {
        file.isEmpty = true;
        file.empty = file.content;
        file.data = {};
      } else {
        file.data = parse2(file.language, file.matter, opts);
      }
      if (closeIndex === len) {
        file.content = "";
      } else {
        file.content = str2.slice(closeIndex + close.length);
        if (file.content[0] === "\r") {
          file.content = file.content.slice(1);
        }
        if (file.content[0] === "\n") {
          file.content = file.content.slice(1);
        }
      }
      excerpt(file, opts);
      if (opts.sections === true || typeof opts.section === "function") {
        sections(file, opts.section);
      }
      return file;
    }
    matter5.engines = engines2;
    matter5.stringify = function(file, data, options2) {
      if (typeof file === "string") file = matter5(file, options2);
      return stringify(file, data, options2);
    };
    matter5.read = function(filepath, options2) {
      const str2 = fs6.readFileSync(filepath, "utf8");
      const file = matter5(str2, options2);
      file.path = filepath;
      return file;
    };
    matter5.test = function(str2, options2) {
      return utils.startsWith(str2, defaults(options2).delimiters[0]);
    };
    matter5.language = function(str2, options2) {
      const opts = defaults(options2);
      const open = opts.delimiters[0];
      if (matter5.test(str2)) {
        str2 = str2.slice(open.length);
      }
      const language = str2.slice(0, str2.search(/\r?\n/));
      return {
        raw: language,
        name: language ? language.trim() : ""
      };
    };
    matter5.cache = {};
    matter5.clearCache = function() {
      matter5.cache = {};
    };
    module2.exports = matter5;
  }
});

// src/skills/implementation-flow/scripts/check_parallel.ts
var import_node_fs5 = __toESM(require("node:fs"));
var import_node_path5 = __toESM(require("node:path"));
var import_gray_matter4 = __toESM(require_gray_matter());

// src/skills/doc-driven-dev-graph/scripts/lib/artifact_graph.ts
var import_node_fs2 = __toESM(require("node:fs"));
var import_node_path2 = __toESM(require("node:path"));
var import_gray_matter = __toESM(require_gray_matter());

// src/skills/lib/document_utils.ts
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var CANONICAL_DOC_DIRS = [
  "docs/ideas",
  "docs/discovery",
  "docs/specs",
  "docs/designs",
  "docs/plans",
  "docs/tasks",
  "docs/test-specs",
  "docs/adr",
  "docs/impl/ir",
  "docs/impl/exp"
];
var nonReferenceRelationKeys = /* @__PURE__ */ new Set([
  "changes",
  "test-spec-skip"
]);
function stripExtendedLengthPrefix(value) {
  if (value.startsWith("\\\\?\\UNC\\")) return `\\\\${value.slice(8)}`;
  if (value.startsWith("\\\\?\\")) return value.slice(4);
  return value;
}
function containmentKey(value) {
  const normalized = stripExtendedLengthPrefix(import_node_path.default.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function repoPathKey(value) {
  const normalized = value.replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function isInside(cwd, candidate) {
  const root = containmentKey(cwd);
  const resolved = containmentKey(candidate);
  return resolved === root || resolved.startsWith(`${root}${import_node_path.default.sep}`);
}
function isInsideRealpath(cwd, candidate) {
  try {
    return isInside(import_node_fs.default.realpathSync(cwd), import_node_fs.default.realpathSync(candidate));
  } catch {
    return false;
  }
}
function isInsideCheckout(cwd, candidate) {
  const resolved = import_node_path.default.resolve(cwd, candidate);
  if (!isInside(cwd, resolved)) return false;
  return !import_node_fs.default.existsSync(resolved) || isInsideRealpath(cwd, resolved);
}
function toRepoRelative(cwd, absolute) {
  return import_node_path.default.relative(import_node_path.default.resolve(cwd), absolute).split(import_node_path.default.sep).join("/");
}
function resolveContainedDir(cwd, dir, flag = "--dir") {
  const resolved = import_node_path.default.resolve(cwd, dir);
  if (!isInside(cwd, resolved)) {
    throw new Error(`${flag} escapes the checkout: ${dir}`);
  }
  if (import_node_fs.default.existsSync(resolved)) {
    if (!isInsideRealpath(cwd, resolved)) {
      throw new Error(`${flag} escapes the checkout through a link: ${dir}`);
    }
    return toRepoRelative(
      stripExtendedLengthPrefix(import_node_fs.default.realpathSync(cwd)),
      stripExtendedLengthPrefix(import_node_fs.default.realpathSync(resolved))
    );
  }
  return toRepoRelative(cwd, stripExtendedLengthPrefix(resolved));
}
function scanRootKey(cwd, directory) {
  const absolute = import_node_path.default.resolve(cwd, directory);
  try {
    return containmentKey(stripExtendedLengthPrefix(import_node_fs.default.realpathSync(absolute)));
  } catch {
    return containmentKey(absolute);
  }
}

// src/skills/doc-driven-dev-graph/scripts/lib/artifact_graph.ts
var LINEAGE_RELATIONS = /* @__PURE__ */ new Set([
  "implements",
  "implemented-by",
  "derives-from",
  "derived-by",
  "refines",
  "refined-by"
]);
var TASK_DEPENDENCY_RELATIONS = /* @__PURE__ */ new Set(["depends-on", "blocks"]);
var EVIDENCE_RELATIONS = /* @__PURE__ */ new Set([
  "verifies",
  "verified-by",
  "references",
  "evidence",
  "evidence-refs",
  "evidenceRefs"
]);
var EXTERNAL_REFERENCE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
function compareStrings(left, right) {
  return left.localeCompare(right);
}
function sortedUnique(values) {
  return [...new Set(values)].sort(compareStrings);
}
function normalizeArtifactPath(cwd, target) {
  return import_node_path2.default.relative(import_node_path2.default.resolve(cwd), import_node_path2.default.resolve(cwd, target)).split(import_node_path2.default.sep).join("/");
}
function isExternalArtifactReference(value) {
  return EXTERNAL_REFERENCE.test(value.trim());
}
function resolveContainedTaskDir(cwd, taskDir) {
  return resolveContainedDir(cwd, taskDir ?? "docs/tasks", "--task-dir");
}
function markdownFiles(dir) {
  if (!import_node_fs2.default.existsSync(dir) || !import_node_fs2.default.statSync(dir).isDirectory()) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of import_node_fs2.default.readdirSync(current, { withFileTypes: true }).sort((a, b) => compareStrings(a.name, b.name))) {
      const full = import_node_path2.default.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md") && !/^(?:readme|index)\.md$/i.test(entry.name)) files.push(full);
    }
  };
  visit(dir);
  return files.sort(compareStrings);
}
function relationValues(raw, ownerPath) {
  if (raw === void 0 || raw === null) return { relations: {}, issues: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { relations: {}, issues: [`invalid-relations:${ownerPath}`] };
  }
  const result = {};
  const issues = [];
  for (const key of Object.keys(raw).sort(compareStrings)) {
    const value = raw[key];
    if (nonReferenceRelationKeys.has(key)) continue;
    if (typeof value !== "string" && !Array.isArray(value)) {
      issues.push(`invalid-relation:${ownerPath}:${key}`);
      result[key] = [];
      continue;
    }
    const values = typeof value === "string" ? [value] : value;
    const valid = [];
    for (const item of values) {
      if (typeof item !== "string" || !item.trim()) {
        issues.push(`invalid-relation:${ownerPath}:${key}`);
        continue;
      }
      valid.push(item.trim());
    }
    result[key] = sortedUnique(valid);
  }
  return { relations: result, issues };
}
function readRecords(options2, collector) {
  const cwd = import_node_path2.default.resolve(options2.cwd);
  const taskDir = resolveContainedTaskDir(cwd, options2.taskDir);
  const seenRoots = /* @__PURE__ */ new Set();
  const directories = [];
  for (const directory of [...CANONICAL_DOC_DIRS, taskDir]) {
    const key = scanRootKey(cwd, directory);
    if (seenRoots.has(key)) continue;
    seenRoots.add(key);
    const absolute = import_node_path2.default.join(cwd, directory);
    if (import_node_fs2.default.existsSync(absolute) && !isInsideRealpath(cwd, absolute)) continue;
    directories.push(directory);
  }
  const files = sortedUnique(directories.flatMap((directory) => markdownFiles(import_node_path2.default.join(cwd, directory))));
  const records = [];
  for (const absolutePath of files.map((file) => import_node_path2.default.resolve(cwd, file))) {
    try {
      const raw = import_node_fs2.default.readFileSync(absolutePath, "utf8");
      if (collector) {
        collector.filesRead += 1;
        collector.bytesRead += Buffer.byteLength(raw, "utf8");
        collector.filePaths.add(normalizeArtifactPath(cwd, absolutePath));
      }
      const parsed = (0, import_gray_matter.default)(raw);
      const data = parsed.data;
      const recordPath = normalizeArtifactPath(cwd, absolutePath);
      const relationResult = relationValues(data.relations, recordPath);
      const id = typeof data.id === "string" && data.id.trim() ? data.id.trim() : null;
      const type = typeof data.type === "string" && data.type.trim() ? data.type.trim() : null;
      const status = typeof data.status === "string" && data.status.trim() ? data.status.trim() : null;
      records.push({
        path: recordPath,
        id,
        type,
        status,
        absolutePath,
        body: parsed.content,
        relations: relationResult.relations,
        relationIssues: relationResult.issues
      });
    } catch {
      records.push({
        path: normalizeArtifactPath(cwd, absolutePath),
        id: null,
        type: null,
        status: null,
        absolutePath,
        body: "",
        relations: {},
        relationIssues: [`invalid-document:${normalizeArtifactPath(cwd, absolutePath)}`]
      });
    }
  }
  return records.sort((left, right) => compareStrings(left.path, right.path));
}
function classifyArtifactRelation(relation) {
  if (LINEAGE_RELATIONS.has(relation)) return "lineage";
  if (TASK_DEPENDENCY_RELATIONS.has(relation)) return "task-dependency";
  if (EVIDENCE_RELATIONS.has(relation) || /evidence/i.test(relation)) return "evidence";
  return "contextual";
}
function localTarget(cwd, owner, value) {
  const trimmed = value.trim();
  const ownerCandidate = import_node_path2.default.resolve(import_node_path2.default.dirname(owner.absolutePath), trimmed);
  const rootCandidate = import_node_path2.default.resolve(cwd, trimmed);
  const documentRelative = trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed === "." || trimmed === "..";
  const preferred = documentRelative ? ownerCandidate : rootCandidate;
  const fallback = documentRelative ? rootCandidate : ownerCandidate;
  const chosen = isInside(cwd, preferred) && import_node_fs2.default.existsSync(preferred) ? preferred : fallback;
  const exists = isInside(cwd, chosen) && import_node_fs2.default.existsSync(chosen) && import_node_fs2.default.statSync(chosen).isFile();
  return {
    path: isInside(cwd, chosen) ? normalizeArtifactPath(cwd, chosen) : normalizeArtifactPath(cwd, preferred),
    exists
  };
}
function resolveArtifactRelation(cwd, source, rawValue, records) {
  const value = rawValue.trim();
  if (isExternalArtifactReference(value)) return void 0;
  const byId = records.filter((record) => record.id === value);
  if (byId.length === 1) return byId[0];
  if (byId.length > 1) return void 0;
  const target = localTarget(cwd, source, value);
  return records.find((record) => repoPathKey(record.path) === repoPathKey(target.path));
}
function issueCompare(left, right) {
  return compareStrings(left.code, right.code) || compareStrings(left.message, right.message);
}
function edgeCompare(left, right) {
  const kindOrder = {
    lineage: 0,
    "task-dependency": 1,
    contextual: 2,
    evidence: 3
  };
  return kindOrder[left.kind] - kindOrder[right.kind] || compareStrings(left.from, right.from) || compareStrings(left.relation, right.relation) || compareStrings(left.to ?? "", right.to ?? "") || Number(left.external) - Number(right.external);
}
function scanArtifactGraph(options2, collector) {
  const cwd = import_node_path2.default.resolve(options2.cwd);
  if (collector) collector.scans += 1;
  const records = readRecords({ ...options2, cwd }, collector);
  const nodes = records.map(({ path: recordPath, id, type }) => ({ path: recordPath, id, type }));
  const byId = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (!record.id) continue;
    const values = byId.get(record.id) ?? [];
    values.push(record);
    byId.set(record.id, values);
  }
  const edges = [];
  const issues = [];
  for (const record of records) {
    for (const relationIssue of record.relationIssues) {
      issues.push({
        code: "broken-relation",
        message: relationIssue
      });
    }
  }
  for (const [id, values] of byId.entries()) {
    if (values.length > 1) {
      issues.push({
        code: "duplicate-id",
        message: `Duplicate artifact ID ${id}: ${values.map((record) => record.path).sort(compareStrings).join(", ")}`
      });
    }
  }
  for (const source of records) {
    for (const [relation, values] of Object.entries(source.relations)) {
      const kind = classifyArtifactRelation(relation);
      for (const value of values) {
        if (isExternalArtifactReference(value)) {
          edges.push({ from: source.path, to: null, relation, kind, external: true });
          continue;
        }
        const target = resolveArtifactRelation(cwd, source, value, records);
        edges.push({ from: source.path, to: target?.path ?? null, relation, kind, external: false });
        if (!target) {
          const local = localTarget(cwd, source, value);
          if (!local.exists) {
            issues.push({
              code: "broken-relation",
              message: `Broken ${relation} relation from ${source.path} to ${value}${local.path ? ` (${local.path})` : ""}`
            });
          }
        }
      }
    }
  }
  return {
    records,
    graph: {
      nodes: [...nodes].sort((left, right) => compareStrings(left.path, right.path)),
      edges: edges.sort(edgeCompare),
      issues: [...new Map(issues.map((issue) => [`${issue.code}\0${issue.message}`, issue])).values()].sort(issueCompare)
    }
  };
}

// src/skills/doc-driven-dev-graph/scripts/lib/task_graph.ts
var import_node_fs3 = __toESM(require("node:fs"));
var import_node_path3 = __toESM(require("node:path"));
var import_gray_matter2 = __toESM(require_gray_matter());
var TASK_STATUSES = /* @__PURE__ */ new Set([
  "todo",
  "in-progress",
  "blocked",
  "done",
  "wont-do"
]);
function compareStrings2(left, right) {
  return left.localeCompare(right);
}
function sortedUnique2(values) {
  return [...new Set(values)].sort(compareStrings2);
}
function normalizeRepoPath(cwd, target) {
  const absolute = import_node_path3.default.resolve(cwd, target);
  return import_node_path3.default.relative(cwd, absolute).split(import_node_path3.default.sep).join("/");
}
function normalizeOwnedRepoPath(cwd, ownerFile, reference) {
  const ownerCandidate = import_node_path3.default.resolve(cwd, import_node_path3.default.dirname(ownerFile), reference);
  const rootCandidate = import_node_path3.default.resolve(cwd, reference);
  const documentRelative = reference.startsWith("./") || reference.startsWith("../") || reference === "." || reference === ".." || !reference.includes("/") && !reference.includes("\\");
  const chosen = documentRelative ? ownerCandidate : rootCandidate;
  return normalizeRepoPath(cwd, chosen);
}
function markdownFiles2(dir) {
  if (!import_node_fs3.default.existsSync(dir) || !import_node_fs3.default.statSync(dir).isDirectory()) return [];
  const result = [];
  const visit = (current) => {
    for (const entry of import_node_fs3.default.readdirSync(current, { withFileTypes: true }).sort((a, b) => compareStrings2(a.name, b.name))) {
      const full = import_node_path3.default.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) result.push(full);
    }
  };
  visit(dir);
  return result.sort(compareStrings2);
}
function relationValues2(raw, key, issues, taskId, file) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw !== void 0 && raw !== null) {
      issues.push({
        code: "invalid-task-document",
        tasks: [taskId || file],
        task: taskId || void 0,
        file,
        message: `Task relations must be an object (${key})`
      });
    }
    return [];
  }
  const value = raw[key];
  if (value === void 0 || value === null) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    const result = [];
    for (const item of value) {
      if (typeof item === "string" && item.trim()) result.push(item.trim());
      else if (item !== null && item !== void 0) {
        issues.push({
          code: "invalid-task-document",
          tasks: [taskId || file],
          task: taskId || void 0,
          file,
          message: `Task relation ${key} must contain only strings`
        });
      }
    }
    return sortedUnique2(result);
  }
  issues.push({
    code: "invalid-task-document",
    tasks: [taskId || file],
    task: taskId || void 0,
    file,
    message: `Task relation ${key} must be an array of strings`
  });
  return [];
}
function readTaskDocuments(cwd, taskDir) {
  const root = import_node_path3.default.resolve(cwd, taskDir);
  const tasks = [];
  for (const file of markdownFiles2(root)) {
    const relativeFile = normalizeRepoPath(cwd, file);
    let data;
    try {
      data = (0, import_gray_matter2.default)(import_node_fs3.default.readFileSync(file, "utf8")).data;
    } catch (error) {
      tasks.push({
        id: "",
        status: "todo",
        file: relativeFile,
        implements: [],
        dependsOn: [],
        blocks: [],
        parseIssues: [{
          code: "invalid-task-document",
          tasks: [relativeFile],
          file: relativeFile,
          message: `Unable to parse task front matter: ${error instanceof Error ? error.message : String(error)}`
        }]
      });
      continue;
    }
    if (data.type !== "task") continue;
    const parseIssues = [];
    const id = typeof data.id === "string" ? data.id.trim() : "";
    if (!id) {
      parseIssues.push({
        code: "invalid-task-document",
        tasks: [id || relativeFile],
        file: relativeFile,
        message: "Task front matter requires a non-empty id"
      });
    }
    const statusValue = typeof data.status === "string" ? data.status.trim() : "";
    const status = TASK_STATUSES.has(statusValue) ? statusValue : "todo";
    if (!TASK_STATUSES.has(statusValue)) {
      parseIssues.push({
        code: "invalid-task-status",
        tasks: [id || relativeFile],
        task: id || void 0,
        file: relativeFile,
        message: `Unknown task status: ${statusValue || "<missing>"}`
      });
    }
    const rawRelations = data.relations;
    const relationObject = rawRelations && typeof rawRelations === "object" && !Array.isArray(rawRelations) ? rawRelations : {};
    if (rawRelations !== void 0 && (typeof rawRelations !== "object" || Array.isArray(rawRelations))) {
      parseIssues.push({
        code: "invalid-task-document",
        tasks: [id || relativeFile],
        task: id || void 0,
        file: relativeFile,
        message: "Task relations must be an object"
      });
    }
    const implementsValues = relationValues2(relationObject, "implements", parseIssues, id, relativeFile).map((target) => normalizeOwnedRepoPath(cwd, relativeFile, target));
    const dependsOn = relationValues2(relationObject, "depends-on", parseIssues, id, relativeFile);
    const blocks = relationValues2(relationObject, "blocks", parseIssues, id, relativeFile);
    tasks.push({
      id,
      status,
      file: relativeFile,
      implements: sortedUnique2(implementsValues),
      dependsOn: sortedUnique2(dependsOn),
      blocks: sortedUnique2(blocks),
      parseIssues
    });
  }
  return tasks.sort((left, right) => compareStrings2(left.id || left.file, right.id || right.file));
}
function indexTasks(tasks) {
  const sortedTasks = [...tasks].sort((left, right) => compareStrings2(left.id || left.file, right.id || right.file));
  const byId = /* @__PURE__ */ new Map();
  const byPath = /* @__PURE__ */ new Map();
  const issues = [];
  for (const task of sortedTasks) {
    issues.push(...task.parseIssues);
    if (!task.id) continue;
    const previous = byId.get(task.id);
    if (previous) {
      issues.push({
        code: "duplicate-task-id",
        tasks: [task.id],
        task: task.id,
        file: task.file,
        message: `Duplicate task id ${task.id} (also found in ${previous.file})`
      });
      continue;
    }
    byId.set(task.id, task);
    byPath.set(repoPathKey(task.file), task);
  }
  return { tasks: sortedTasks, byId, byPath, issues };
}
function resolveReference(cwd, owner, reference, index) {
  const byId = index.byId.get(reference);
  if (byId) return byId;
  const normalized = normalizeOwnedRepoPath(cwd, owner.file, reference);
  return index.byPath.get(repoPathKey(normalized));
}
function isExistingArtifactReference(cwd, taskDir, owner, reference) {
  const candidate = import_node_path3.default.resolve(cwd, normalizeOwnedRepoPath(cwd, owner.file, reference));
  if (!isInsideCheckout(cwd, candidate)) return false;
  if (!import_node_fs3.default.existsSync(candidate) || !import_node_fs3.default.statSync(candidate).isFile()) return false;
  if (isInside(import_node_path3.default.resolve(cwd, taskDir), candidate)) return false;
  try {
    const type = (0, import_gray_matter2.default)(import_node_fs3.default.readFileSync(candidate, "utf8")).data?.type;
    return ["plan", "spec", "adr", "design"].includes(type);
  } catch {
    return false;
  }
}
function readArtifactIds(cwd, taskDir) {
  const taskRoot = import_node_path3.default.resolve(cwd, taskDir);
  const ids = /* @__PURE__ */ new Set();
  for (const file of markdownFiles2(cwd)) {
    const absolute = import_node_path3.default.resolve(file);
    if (isInside(taskRoot, absolute)) continue;
    try {
      const data = (0, import_gray_matter2.default)(import_node_fs3.default.readFileSync(file, "utf8")).data;
      if (["plan", "spec", "adr", "design"].includes(data.type) && typeof data.id === "string" && data.id.trim()) {
        ids.add(data.id.trim());
      }
    } catch {
    }
  }
  return ids;
}
function resolveTaskEdges(cwd, taskDir, index) {
  const edges = /* @__PURE__ */ new Map();
  const issues = [];
  const artifactIds = readArtifactIds(cwd, taskDir);
  const addReference = (task, reference, direction) => {
    const target = resolveReference(cwd, task, reference, index);
    if (!target || !target.id) {
      if (artifactIds.has(reference) || isExistingArtifactReference(cwd, taskDir, task, reference)) return;
      issues.push({
        code: "missing-task-reference",
        tasks: task.id ? [task.id] : [],
        task: task.id || void 0,
        reference,
        file: task.file,
        message: `Task ${task.id || task.file} references unresolved task ${reference}`
      });
      return;
    }
    const edge = direction === "depends-on" ? { from: target.id, to: task.id } : { from: task.id, to: target.id };
    edges.set(`${edge.from}\0${edge.to}`, edge);
  };
  for (const task of index.tasks) {
    if (!task.id || !index.byId.has(task.id)) continue;
    for (const reference of task.dependsOn) addReference(task, reference, "depends-on");
    for (const reference of task.blocks) addReference(task, reference, "blocks");
  }
  return {
    edges: [...edges.values()].sort((left, right) => compareStrings2(left.from, right.from) || compareStrings2(left.to, right.to)),
    issues: issues.sort(issueCompare2)
  };
}
function issueCompare2(left, right) {
  return compareStrings2(left.code, right.code) || compareStrings2((left.tasks || []).join(","), (right.tasks || []).join(",")) || compareStrings2(left.task || "", right.task || "") || compareStrings2(left.reference || "", right.reference || "") || compareStrings2(left.file || "", right.file || "") || compareStrings2(left.message, right.message);
}
function findCycles(tasks, edges) {
  const ids = sortedUnique2(tasks.map((task) => task.id).filter(Boolean));
  const adjacency = /* @__PURE__ */ new Map();
  for (const id of ids) adjacency.set(id, []);
  for (const edge of edges) {
    const successors = adjacency.get(edge.from);
    if (successors) successors.push(edge.to);
  }
  for (const successors of adjacency.values()) successors.sort(compareStrings2);
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const cycles = /* @__PURE__ */ new Set();
  const walk = (id, stack) => {
    visiting.add(id);
    stack.push(id);
    for (const next of adjacency.get(id) || []) {
      if (visiting.has(next)) {
        const start = stack.indexOf(next);
        const cycle = stack.slice(start).sort(compareStrings2);
        cycles.add(cycle.join(" -> "));
      } else if (!visited.has(next)) {
        walk(next, stack);
      }
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) if (!visited.has(id)) walk(id, []);
  return [...cycles].sort(compareStrings2).map((cycle) => ({
    code: "task-cycle",
    tasks: cycle.split(" -> "),
    message: `Task dependency cycle detected: ${cycle}`
  }));
}
function summarizeTaskGraph(plan, tasks, edges, issues) {
  const sortedTasks = tasks.filter((task) => Boolean(task.id)).map(({ parseIssues: _parseIssues, ...task }) => ({
    ...task,
    implements: [...task.implements].sort(compareStrings2),
    dependsOn: [...task.dependsOn].sort(compareStrings2),
    blocks: [...task.blocks].sort(compareStrings2)
  })).sort((left, right) => compareStrings2(left.id, right.id));
  const sortedEdges = [...edges].sort((left, right) => compareStrings2(left.from, right.from) || compareStrings2(left.to, right.to));
  const normalizedIssues = issues.map((issue) => {
    const allowed = /* @__PURE__ */ new Set([
      "duplicate-task-id",
      "missing-task-reference",
      "task-cycle",
      "plan-has-no-tasks"
    ]);
    const code = allowed.has(issue.code) ? issue.code : "missing-task-reference";
    const isMalformed = !allowed.has(issue.code);
    return {
      code,
      message: isMalformed ? `Malformed task document: ${issue.message}` : issue.message,
      tasks: sortedUnique2(issue.tasks || (issue.task ? [issue.task] : []))
    };
  });
  const uniqueIssues = [...new Map(normalizedIssues.map((issue) => [
    `${issue.code}\0${issue.tasks.join(",")}\0${issue.message}`,
    issue
  ])).values()].sort(issueCompare2);
  const runnable = uniqueIssues.length > 0 ? [] : sortedTasks.filter((task) => task.status === "todo").filter((task) => sortedEdges.filter((edge) => edge.to === task.id).every((edge) => {
    const predecessor = sortedTasks.find((candidate) => candidate.id === edge.from);
    return predecessor?.status === "done";
  })).map((task) => task.id);
  const active = sortedTasks.filter((task) => task.status === "in-progress").map((task) => task.id);
  const resumableActive = uniqueIssues.length > 0 ? [] : sortedTasks.filter((task) => task.status === "in-progress").filter((task) => sortedEdges.filter((edge) => edge.to === task.id).every((edge) => {
    const predecessor = sortedTasks.find((candidate) => candidate.id === edge.from);
    return predecessor?.status === "done";
  })).map((task) => task.id);
  const completed = sortedTasks.filter((task) => task.status === "done").map((task) => task.id);
  const blocked = sortedTasks.filter((task) => task.status === "blocked" || task.status === "wont-do" || task.status === "todo" && !runnable.includes(task.id)).map((task) => ({
    id: task.id,
    reasons: task.status === "blocked" ? ["status:blocked"] : task.status === "wont-do" ? ["status:wont-do"] : sortedEdges.filter((edge) => edge.to === task.id).filter((edge) => sortedTasks.find((candidate) => candidate.id === edge.from)?.status !== "done").map((edge) => `depends-on:${edge.from}`)
  })).filter((entry) => entry.reasons.length > 0);
  return {
    schemaVersion: 1,
    plan,
    nodes: sortedTasks.map((task) => ({
      id: task.id,
      path: task.file,
      status: task.status,
      dependsOn: task.dependsOn,
      blocks: task.blocks
    })),
    edges: sortedEdges,
    runnable: runnable.sort(compareStrings2),
    active: active.sort(compareStrings2),
    resumableActive: resumableActive.sort(compareStrings2),
    completed: completed.sort(compareStrings2),
    blocked,
    issues: uniqueIssues
  };
}
function buildTaskGraph(options2) {
  const cwd = import_node_path3.default.resolve(options2.cwd);
  const plan = normalizeRepoPath(cwd, options2.plan);
  const taskDir = resolveContainedTaskDir(cwd, options2.taskDir);
  const parsed = readTaskDocuments(cwd, taskDir).filter((task) => task.implements.includes(plan));
  const indexed = indexTasks(parsed);
  const resolved = resolveTaskEdges(cwd, taskDir, indexed);
  const issues = [...indexed.issues, ...resolved.issues, ...findCycles(parsed, resolved.edges)];
  if (parsed.length === 0) {
    issues.push({
      code: "plan-has-no-tasks",
      tasks: [],
      message: `Plan ${plan} has no task documents`
    });
  }
  return summarizeTaskGraph(plan, parsed, resolved.edges, issues);
}

// src/skills/implementation-flow/scripts/lib/scope_entry.ts
var MARKUP_CHARS = /[`[\]{}<>]/;
function scopeKey(text) {
  return text.toLowerCase();
}
function normalizeScopePath(raw) {
  let text = raw.trim().replace(/\\/g, "/");
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text)) return null;
  while (text.startsWith("./")) text = text.slice(2);
  let isDir = false;
  if (text.endsWith("/*")) {
    isDir = true;
    text = text.slice(0, -2);
  } else if (text.endsWith("/")) {
    isDir = true;
    text = text.replace(/\/+$/, "");
  }
  const segments = text.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === ".." || segment.includes("*") || segment.includes("?"))) return null;
  const normalized = segments.join("/");
  if (!normalized) return null;
  return { path: normalized, isDir };
}
function toScopeEntry(text) {
  if (MARKUP_CHARS.test(text)) return { opaque: text };
  if (!text.includes("/") && !text.includes(".") && !text.includes("\\")) {
    return { opaque: text };
  }
  const normalized = normalizeScopePath(text);
  if (!normalized) return { opaque: text };
  return { pattern: { kind: normalized.isDir ? "dir" : "file", path: normalized.path } };
}

// src/skills/lib/markdown_sections.ts
var SECTION_HEADING_ALIASES = {
  // task-doc
  "Work": ["\u4F5C\u696D"],
  "Classification": ["\u5206\u985E"],
  "Upstream Documents": ["\u4E0A\u6D41\u6587\u66F8"],
  "Dependencies": ["\u4F9D\u5B58\u95A2\u4FC2"],
  "Affected Files": ["\u5F71\u97FF\u30D5\u30A1\u30A4\u30EB"],
  "Done When": ["\u5B8C\u4E86\u6761\u4EF6"],
  "Verification": ["\u691C\u8A3C"],
  // spec-doc
  "What Should Be Built": ["\u4F55\u3092\u4F5C\u308B\u3079\u304D\u304B"],
  "Why Now": ["\u306A\u305C\u4ECA\u5FC5\u8981\u304B"],
  "Users and Value": ["\u5229\u7528\u8005\u3068\u4FA1\u5024"],
  "Scope": ["\u7BC4\u56F2", "\u30B9\u30B3\u30FC\u30D7"],
  "In Scope": ["\u7BC4\u56F2\u5185"],
  "Out of Scope": ["\u7BC4\u56F2\u5916"],
  "Requirements": ["\u8981\u4EF6"],
  "Acceptance Criteria": ["\u53D7\u3051\u5165\u308C\u57FA\u6E96"],
  "Sources and Relations": ["\u51FA\u5178\u3068 Relations", "\u51FA\u5178\u30FBRelations"],
  // discovery-doc
  "Exploration Goal": ["\u63A2\u7D22\u76EE\u7684"],
  "Key Issues and Assumptions": ["\u8AD6\u70B9\u30FB\u524D\u63D0"],
  "Alternatives and Comparison": ["\u4EE3\u66FF\u6848\u3068\u6BD4\u8F03"],
  "Tentative Conclusions and Hypotheses": ["\u66AB\u5B9A\u7D50\u8AD6\u30FB\u4EEE\u8AAC"],
  "Open Questions": ["\u672A\u89E3\u6C7A\u306E\u8AD6\u70B9", "\u672A\u89E3\u6C7A\u4E8B\u9805"],
  "Promotion Candidates": ["\u6607\u83EF\u5148\u5019\u88DC"],
  // idea-doc
  "Summary": ["\u8981\u7D04"],
  "Problem and Motivation": ["\u8AB2\u984C\u3068\u52D5\u6A5F"],
  "Expected Value": ["\u60F3\u5B9A\u4FA1\u5024"],
  "Next Action": ["\u6B21\u306E\u30A2\u30AF\u30B7\u30E7\u30F3"],
  // plan-doc
  "Goal": ["\u76EE\u7684"],
  "File Map": ["\u30D5\u30A1\u30A4\u30EB\u8868"],
  "Implementation Sequence": ["\u5B9F\u88C5\u9806\u5E8F"],
  "Dependencies and Risks": ["\u4F9D\u5B58\u95A2\u4FC2\u3068\u30EA\u30B9\u30AF"],
  "Task Breakdown": ["Task \u5206\u89E3"],
  "Open Questions / Gaps": ["\u672A\u89E3\u6C7A\u4E8B\u9805 / gap"],
  "Self-Review": ["\u81EA\u5DF1\u30EC\u30D3\u30E5\u30FC"],
  "Implementation Handoff": ["\u5B9F\u88C5\u30CF\u30F3\u30C9\u30AA\u30D5"],
  "Review Handoff": ["\u30EC\u30D3\u30E5\u30FC\u7528\u30CF\u30F3\u30C9\u30AA\u30D5"],
  // adr-doc (MADR 4 templates)
  "Context and Problem Statement": ["\u80CC\u666F\u3068\u554F\u984C"],
  "Decision Drivers": ["\u6C7A\u5B9A\u30C9\u30E9\u30A4\u30D0\u30FC"],
  "Considered Options": ["\u691C\u8A0E\u3057\u305F\u9078\u629E\u80A2"],
  "Decision Outcome": ["\u6C7A\u5B9A\u5185\u5BB9"],
  "Consequences": ["\u5F71\u97FF"],
  "Confirmation": ["\u78BA\u8A8D\u65B9\u6CD5"],
  "Implementation Plan": ["\u5B9F\u88C5\u8A08\u753B"],
  "Pros and Cons of the Options": ["\u9078\u629E\u80A2\u306E\u5229\u70B9\u3068\u6B20\u70B9"],
  "Option": ["\u9078\u629E\u80A2"],
  "Option 1": ["\u9078\u629E\u80A2 1"],
  "Option 2": ["\u9078\u629E\u80A2 2"],
  "More Information": ["\u8FFD\u52A0\u60C5\u5831"],
  // implementation-flow profile
  "Available Skills": ["\u5229\u7528\u53EF\u80FD\u306A\u30B9\u30AD\u30EB"],
  "Category Assignments": ["\u30AB\u30C6\u30B4\u30EA\u5272\u308A\u5F53\u3066"]
};
var FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
var FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
function stripFencedBlocks(body) {
  const kept = [];
  let fenceChar = "";
  let fenceLen = 0;
  for (const line of body.split(/\r?\n/)) {
    if (fenceChar === "") {
      const open = FENCE_OPEN.exec(line);
      if (open) {
        const run = open[1];
        const info = line.slice(line.indexOf(run) + run.length);
        if (info.includes(run[0])) {
          kept.push(line);
          continue;
        }
        fenceChar = run[0];
        fenceLen = run.length;
        continue;
      }
      kept.push(line);
      continue;
    }
    const close = FENCE_CLOSE.exec(line);
    if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
      fenceChar = "";
      fenceLen = 0;
    }
  }
  return kept.join("\n");
}
function headingNames(canonicalHeading) {
  return [canonicalHeading, ...SECTION_HEADING_ALIASES[canonicalHeading] ?? []];
}
function headingPattern(heading) {
  return new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
}
function sectionBody(body, canonicalHeading) {
  const lines = stripFencedBlocks(body).split(/\r?\n/);
  for (const name of headingNames(canonicalHeading)) {
    const pattern = headingPattern(name);
    const start = lines.findIndex((line) => pattern.test(line.trimEnd()));
    if (start < 0) continue;
    const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
    const section = endOffset < 0 ? lines.slice(start + 1) : lines.slice(start + 1, start + 1 + endOffset);
    return section.join("\n").trim();
  }
  return "";
}
function hasSection(body, canonicalHeading) {
  const lines = stripFencedBlocks(body).split(/\r?\n/);
  return headingNames(canonicalHeading).some((name) => {
    const pattern = headingPattern(name);
    return lines.some((line) => pattern.test(line.trimEnd()));
  });
}

// src/skills/implementation-flow/scripts/lib/parallel_safety.ts
var BULLET_ITEM = /^\s*[-*+]\s+(.*)$/;
var HTML_COMMENT = /<!--[\s\S]*?-->/g;
var CHECKBOX_MARKER = /^\[[ xX]?\]\s*/;
var SUB_HEADING = /^#{3,6}\s/;
var TOP_HEADING = /^#{1,2}\s/;
function parseAffectedEntries(body) {
  if (!hasSection(body, "Affected Files")) return null;
  const section = sectionBody(body, "Affected Files");
  const entries = [];
  let inSubSection = false;
  for (const line of section.split(/\r?\n/)) {
    if (SUB_HEADING.test(line)) {
      inSubSection = true;
      continue;
    }
    if (TOP_HEADING.test(line)) {
      inSubSection = false;
      continue;
    }
    if (inSubSection) continue;
    const match = BULLET_ITEM.exec(line);
    if (!match) continue;
    let text = match[1].replace(HTML_COMMENT, "").trim().replace(CHECKBOX_MARKER, "").trim();
    if (text.length > 2 && text.startsWith("`") && text.endsWith("`")) {
      text = text.slice(1, -1).trim();
    }
    if (!text) continue;
    entries.push(toScopeEntry(text));
  }
  return entries;
}
function parseAffectedScope(body) {
  const entries = parseAffectedEntries(body);
  if (entries === null) return null;
  const patterns = [];
  let hasOpaque = false;
  for (const entry of entries) {
    if ("opaque" in entry) hasOpaque = true;
    else patterns.push(entry.pattern);
  }
  return { patterns, hasOpaque };
}
function overlapPath(left, right) {
  const leftKey = scopeKey(left.path);
  const rightKey = scopeKey(right.path);
  if (left.kind === "file" && right.kind === "file") {
    return leftKey === rightKey ? left.path : null;
  }
  if (left.kind === "dir" && right.kind === "dir") {
    if (leftKey === rightKey) return left.path;
    if (leftKey.startsWith(`${rightKey}/`)) return left.path;
    if (rightKey.startsWith(`${leftKey}/`)) return right.path;
    return null;
  }
  const dir = left.kind === "dir" ? left : right;
  const file = left.kind === "dir" ? right : left;
  const dirKey = scopeKey(dir.path);
  const fileKey = scopeKey(file.path);
  if (fileKey === dirKey || fileKey.startsWith(`${dirKey}/`)) return file.path;
  return null;
}
function evaluateParallelSafety(taskGraph, tasks) {
  if (taskGraph.issues.length > 0) {
    return {
      decision: "blocked",
      eligible: [],
      parallel: [],
      serial: [],
      conflicts: [],
      taskGraphIssues: [...new Set(taskGraph.issues.map((issue) => issue.code))]
    };
  }
  const eligible = taskGraph.resumableActive.length > 0 ? [...taskGraph.resumableActive] : [...taskGraph.runnable];
  const bodyById = new Map(tasks.map((task) => [task.id, task.body]));
  const reasonsById = /* @__PURE__ */ new Map();
  const patternsById = /* @__PURE__ */ new Map();
  const addReason = (id, reason) => {
    const reasons = reasonsById.get(id) ?? /* @__PURE__ */ new Set();
    reasons.add(reason);
    reasonsById.set(id, reasons);
  };
  for (const id of eligible) {
    const body = bodyById.get(id);
    const scope = body === void 0 ? null : parseAffectedScope(body);
    if (scope === null || scope.patterns.length === 0 && !scope.hasOpaque) {
      addReason(id, "scope-undeclared");
      continue;
    }
    if (scope.hasOpaque) addReason(id, "scope-unverifiable");
    patternsById.set(id, scope.patterns);
  }
  const conflicts = [];
  const seenConflicts = /* @__PURE__ */ new Set();
  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      const a = eligible[i];
      const b = eligible[j];
      const patternsA = patternsById.get(a);
      const patternsB = patternsById.get(b);
      if (!patternsA || !patternsB) continue;
      for (const patternA of patternsA) {
        for (const patternB of patternsB) {
          const path6 = overlapPath(patternA, patternB);
          if (path6 === null) continue;
          const key = `${a}\0${b}\0${path6}`;
          if (!seenConflicts.has(key)) {
            seenConflicts.add(key);
            conflicts.push({ a, b, path: path6 });
          }
          addReason(a, "write-conflict");
          addReason(b, "write-conflict");
        }
      }
    }
  }
  const serial = eligible.filter((id) => reasonsById.has(id)).map((id) => ({ id, reasons: [...reasonsById.get(id) ?? []].sort() }));
  const parallel = eligible.filter((id) => !reasonsById.has(id));
  return {
    decision: parallel.length > 1 ? "parallel" : "serial",
    eligible,
    parallel,
    serial,
    conflicts,
    taskGraphIssues: []
  };
}

// src/skills/implementation-flow/scripts/lib/merge_verification.ts
var import_node_fs4 = __toESM(require("node:fs"));
var import_node_path4 = __toESM(require("node:path"));
var import_node_child_process = require("node:child_process");
var import_gray_matter3 = __toESM(require_gray_matter());
function normalizeGitPath(raw) {
  let text = raw.replace(/\\/g, "/");
  while (text.startsWith("./")) text = text.slice(2);
  return text.split("/").filter((segment) => segment.length > 0 && segment !== ".").join("/");
}
function normalizeVerifiedPath(raw) {
  let text = raw.trim().replace(/\\/g, "/");
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text)) return null;
  while (text.startsWith("./")) text = text.slice(2);
  const segments = text.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === ".." || segment.includes("*") || segment.includes("?"))) {
    return null;
  }
  const normalized = segments.join("/");
  return normalized ? normalized : null;
}
function parseScopeEntry(raw) {
  const resolution = toScopeEntry(raw);
  return "opaque" in resolution ? null : resolution.pattern;
}
function scopeContains(pattern, touched) {
  const key = scopeKey(touched);
  const patternKey = scopeKey(pattern.path);
  if (pattern.kind === "file") return key === patternKey;
  return key === patternKey || key.startsWith(`${patternKey}/`);
}
function declaredCovers(declared, claim) {
  if (claim.kind === "dir" && declared.kind === "file") return false;
  return scopeContains(declared, claim.path);
}
function isTaskDocPath(normalized, taskDir) {
  const key = scopeKey(normalized);
  const dirKey = scopeKey(taskDir);
  return key === dirKey || key.startsWith(`${dirKey}/`);
}
function git(repo, args) {
  const result = (0, import_node_child_process.spawnSync)("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}
function collectChangedPaths(repo, baseRef = "HEAD") {
  if (baseRef.startsWith("-")) {
    throw new Error(`git diff baseRef ${JSON.stringify(baseRef)} rejected: refs must not start with "-"`);
  }
  git(repo, ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
  const changed = /* @__PURE__ */ new Set();
  for (const entry of git(repo, ["-c", "core.quotepath=false", "diff", "--name-only", "-z", "--no-renames", baseRef]).split("\0")) {
    if (entry) changed.add(normalizeGitPath(entry));
  }
  const statusEntries = git(repo, ["-c", "core.quotepath=false", "status", "--porcelain", "-z", "-uall"]).split("\0");
  for (let index = 0; index < statusEntries.length; index += 1) {
    const entry = statusEntries[index];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const entryPath = entry.slice(3);
    if (entryPath) changed.add(normalizeGitPath(entryPath));
    if (status.includes("R") || status.includes("C")) {
      const source = statusEntries[index + 1];
      if (source) changed.add(normalizeGitPath(source));
      index += 1;
    }
  }
  return [...changed].sort();
}
function verifyEvidenceBinding(cwd, evidencePath, taskId) {
  if (!taskId.trim()) return false;
  const normalized = normalizeVerifiedPath(evidencePath);
  if (normalized === null) return false;
  try {
    if (!isInsideRealpath(cwd, import_node_path4.default.join(cwd, normalized))) return false;
    const resolved = import_node_fs4.default.realpathSync(import_node_path4.default.join(cwd, normalized));
    return import_node_fs4.default.readFileSync(resolved, "utf8").includes(taskId);
  } catch {
    return false;
  }
}
function isAllowedEvidencePath(normalized, taskDocPath) {
  const key = scopeKey(normalized);
  return key.startsWith("docs/impl/") || key === scopeKey(taskDocPath);
}
var BLOCKED_SEVERITY = 2;
var REVIEW_SEVERITY = 1;
function bindTaskDoc(cwd, outcome, taskDir, findings) {
  const unbound = { ownTaskDoc: null, docScope: null };
  const taskDocPath = normalizeVerifiedPath(outcome.taskDocPath);
  if (taskDocPath === null) {
    findings.push({
      code: "evidence-mismatch",
      taskId: outcome.taskId,
      path: outcome.taskDocPath,
      message: `${outcome.taskId} taskDocPath ${JSON.stringify(outcome.taskDocPath)} is not a verifiable repo-relative path`,
      severity: BLOCKED_SEVERITY
    });
    return unbound;
  }
  if (!isTaskDocPath(taskDocPath, taskDir)) {
    findings.push({
      code: "evidence-mismatch",
      taskId: outcome.taskId,
      path: taskDocPath,
      message: `${outcome.taskId} taskDocPath ${taskDocPath} is outside the task-doc subtree ${taskDir}; it cannot be the slice's own task document`,
      severity: BLOCKED_SEVERITY
    });
    return unbound;
  }
  let parsed;
  try {
    if (!isInsideRealpath(cwd, import_node_path4.default.join(cwd, taskDocPath))) {
      throw new Error("task doc resolves outside the checkout");
    }
    parsed = (0, import_gray_matter3.default)(import_node_fs4.default.readFileSync(import_node_fs4.default.realpathSync(import_node_path4.default.join(cwd, taskDocPath)), "utf8"));
  } catch {
    findings.push({
      code: "evidence-mismatch",
      taskId: outcome.taskId,
      path: taskDocPath,
      message: `${outcome.taskId} taskDocPath ${taskDocPath} is missing, unreadable, or resolves outside the repository; the slice's task document cannot be verified`,
      severity: BLOCKED_SEVERITY
    });
    return unbound;
  }
  const frontId = typeof parsed.data.id === "string" ? parsed.data.id : null;
  const bound = outcome.taskId.trim().length > 0 && (frontId !== null ? frontId === outcome.taskId : parsed.content.includes(outcome.taskId));
  if (!bound) {
    findings.push({
      code: "evidence-mismatch",
      taskId: outcome.taskId,
      path: taskDocPath,
      message: `${outcome.taskId} taskDocPath ${taskDocPath} does not carry the slice's task ID; it is not the slice's own task document`,
      severity: BLOCKED_SEVERITY
    });
    return unbound;
  }
  return {
    ownTaskDoc: taskDocPath,
    // An absent or empty ## Affected Files resolves to zero patterns, so
    // every supplied scope entry is an inflated claim.
    docScope: parseAffectedScope(parsed.content) ?? { patterns: [], hasOpaque: false }
  };
}
function verifyParallelMerge(cwd, slices, options2 = {}) {
  const resolvedTaskDir = resolveContainedTaskDir(cwd, options2.taskDir);
  const taskDir = normalizeVerifiedPath(resolvedTaskDir);
  if (taskDir === null) {
    throw new Error(`--task-dir is not a verifiable repo-relative path: ${options2.taskDir ?? "docs/tasks"}`);
  }
  if (slices.length === 0) return { verdict: "blocked", findings: [] };
  const findings = [];
  const seenTaskIds = /* @__PURE__ */ new Set();
  for (const outcome of slices) {
    if (!outcome.taskId.trim()) {
      findings.push({
        code: "evidence-mismatch",
        taskId: outcome.taskId,
        message: "slice outcome has an empty task ID; evidence cannot be bound",
        severity: BLOCKED_SEVERITY
      });
    } else if (seenTaskIds.has(outcome.taskId)) {
      findings.push({
        code: "write-collision",
        taskId: outcome.taskId,
        message: `duplicate slice outcome for ${outcome.taskId}; each slice must carry a unique task ID`,
        severity: BLOCKED_SEVERITY
      });
    }
    seenTaskIds.add(outcome.taskId);
  }
  const bound = slices.map((outcome) => bindTaskDoc(cwd, outcome, taskDir, findings));
  for (const [index, outcome] of slices.entries()) {
    const { ownTaskDoc, docScope } = bound[index];
    const declaredEvidenceKeys = new Set(
      outcome.evidencePaths.map((raw) => normalizeVerifiedPath(raw)).filter((normalized) => normalized !== null).map(scopeKey).filter((key) => key.startsWith("docs/impl/"))
    );
    const patterns = [];
    for (const rawScope of outcome.declaredScope) {
      const pattern = parseScopeEntry(rawScope);
      if (pattern === null) {
        findings.push({
          code: "scope-violation",
          taskId: outcome.taskId,
          path: rawScope,
          message: `${outcome.taskId} declared scope entry ${JSON.stringify(rawScope)} is not a verifiable repo-relative path`,
          severity: BLOCKED_SEVERITY
        });
        continue;
      }
      patterns.push(pattern);
      if (docScope !== null) {
        const covered = !docScope.hasOpaque && docScope.patterns.some((declared) => declaredCovers(declared, pattern));
        if (!covered) {
          findings.push({
            code: "scope-violation",
            taskId: outcome.taskId,
            path: rawScope,
            message: docScope.hasOpaque ? `${outcome.taskId} declared scope entry ${JSON.stringify(rawScope)} cannot be verified: the task doc's ## Affected Files is not verifiable` : `${outcome.taskId} declared scope entry ${JSON.stringify(rawScope)} is not declared by the task doc's ## Affected Files`,
            severity: BLOCKED_SEVERITY
          });
        }
      }
    }
    for (const raw of outcome.touchedPaths) {
      const touched = normalizeVerifiedPath(raw);
      if (touched === null) {
        findings.push({
          code: "scope-violation",
          taskId: outcome.taskId,
          path: raw,
          message: `${outcome.taskId} touched path ${JSON.stringify(raw)} is not a verifiable repo-relative path`,
          severity: BLOCKED_SEVERITY
        });
        continue;
      }
      const touchedKey = scopeKey(touched);
      if (isTaskDocPath(touched, taskDir) && (ownTaskDoc === null || touchedKey !== scopeKey(ownTaskDoc))) {
        findings.push({
          code: "scope-violation",
          taskId: outcome.taskId,
          path: touched,
          message: `${outcome.taskId} touched task document ${touched} outside its own task document`,
          severity: BLOCKED_SEVERITY
        });
        continue;
      }
      if (ownTaskDoc !== null && touchedKey === scopeKey(ownTaskDoc) || declaredEvidenceKeys.has(touchedKey)) {
        continue;
      }
      if (patterns.some((pattern) => scopeContains(pattern, touched))) continue;
      findings.push({
        code: "scope-violation",
        taskId: outcome.taskId,
        path: touched,
        message: `${outcome.taskId} touched ${touched} outside its declared scope`,
        severity: REVIEW_SEVERITY
      });
    }
  }
  const touchersByPath = /* @__PURE__ */ new Map();
  for (const outcome of slices) {
    for (const raw of outcome.touchedPaths) {
      const touched = normalizeVerifiedPath(raw) ?? raw;
      if (!touched) continue;
      const key = scopeKey(touched);
      const entry = touchersByPath.get(key) ?? { path: touched, taskIds: [] };
      if (!entry.taskIds.includes(outcome.taskId)) entry.taskIds.push(outcome.taskId);
      touchersByPath.set(key, entry);
    }
  }
  for (const { path: touched, taskIds } of touchersByPath.values()) {
    if (taskIds.length < 2) continue;
    findings.push({
      code: "write-collision",
      path: touched,
      message: `${touched} was touched by multiple slices (${taskIds.join(", ")}); refusing last-writer-win`,
      severity: REVIEW_SEVERITY
    });
  }
  for (const [index, outcome] of slices.entries()) {
    const taskDocPath = bound[index].ownTaskDoc;
    for (const raw of outcome.evidencePaths) {
      const evidencePath = normalizeVerifiedPath(raw);
      if (evidencePath === null) {
        findings.push({
          code: "evidence-mismatch",
          taskId: outcome.taskId,
          path: raw,
          message: `${outcome.taskId} evidence path ${JSON.stringify(raw)} is not a verifiable repo-relative path`,
          severity: BLOCKED_SEVERITY
        });
        continue;
      }
      if (taskDocPath === null || !isAllowedEvidencePath(evidencePath, taskDocPath)) {
        findings.push({
          code: "evidence-mismatch",
          taskId: outcome.taskId,
          path: evidencePath,
          message: `${outcome.taskId} evidence ${evidencePath} is outside docs/impl/ and the slice's own task doc`,
          severity: BLOCKED_SEVERITY
        });
        continue;
      }
      if (!verifyEvidenceBinding(cwd, evidencePath, outcome.taskId)) {
        findings.push({
          code: "evidence-mismatch",
          taskId: outcome.taskId,
          path: evidencePath,
          message: `${outcome.taskId} evidence ${evidencePath} is missing or does not reference the task ID`,
          severity: BLOCKED_SEVERITY
        });
      }
    }
  }
  findings.sort((left, right) => right.severity - left.severity);
  const verdict = findings.some((finding) => finding.severity === BLOCKED_SEVERITY) ? "blocked" : findings.length > 0 ? "merge-review" : "merge";
  return {
    verdict,
    findings: findings.map(({ severity: _severity, ...finding }) => finding)
  };
}

// src/skills/implementation-flow/scripts/check_parallel.ts
function parseArgs(argv) {
  const args = { cwd: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--plan") args.plan = argv[++i];
    else if (arg === "--verify-merge") args.verifyMerge = argv[++i];
    else if (arg === "--base-ref") args.baseRef = argv[++i];
    else if (arg === "--task-dir") args.taskDir = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}
function usage() {
  return "Usage: node scripts/check_parallel.js --plan <path-or-id> [--cwd DIR] [--task-dir DIR] [--json]\n       node scripts/check_parallel.js --verify-merge <slices.json> [--cwd DIR] [--base-ref REF] [--task-dir DIR] [--json]";
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function parseSliceInputs(raw) {
  if (!Array.isArray(raw)) {
    throw new Error("Slices JSON must be an array of slice outcome objects");
  }
  return raw.map((entry, index) => {
    const label = `slices[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label} must be an object`);
    }
    const slice = entry;
    if (typeof slice.taskId !== "string" || !slice.taskId.trim()) {
      throw new Error(`${label}.taskId must be a non-empty string`);
    }
    if (!isStringArray(slice.declaredScope)) {
      throw new Error(`${label}.declaredScope must be an array of strings`);
    }
    if (!isStringArray(slice.evidencePaths)) {
      throw new Error(`${label}.evidencePaths must be an array of strings`);
    }
    if (typeof slice.taskDocPath !== "string") {
      throw new Error(`${label}.taskDocPath must be a string`);
    }
    if (slice.touchedPaths !== void 0 && !isStringArray(slice.touchedPaths)) {
      throw new Error(`${label}.touchedPaths must be an array of strings when present`);
    }
    if (slice.baseRef !== void 0 && (typeof slice.baseRef !== "string" || !slice.baseRef.trim())) {
      throw new Error(`${label}.baseRef must be a non-empty string when present`);
    }
    return {
      taskId: slice.taskId,
      declaredScope: slice.declaredScope,
      evidencePaths: slice.evidencePaths,
      taskDocPath: slice.taskDocPath,
      ...slice.touchedPaths !== void 0 ? { touchedPaths: slice.touchedPaths } : {},
      ...slice.baseRef !== void 0 ? { baseRef: slice.baseRef } : {}
    };
  });
}
function resolvePlanRecord(cwd, planArg, records) {
  const normalizedPath = normalizeArtifactPath(cwd, planArg);
  const matches = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (record.type !== "plan") continue;
    if (record.path === normalizedPath || record.id === planArg) {
      matches.set(record.path, record);
    }
  }
  if (matches.size === 0) {
    throw new Error(`No plan artifact found for --plan ${JSON.stringify(planArg)}`);
  }
  if (matches.size > 1) {
    throw new Error(`--plan ${JSON.stringify(planArg)} matches multiple plan artifacts: ${[...matches.keys()].join(", ")}`);
  }
  return [...matches.values()][0];
}
function runParallelCheck(cwd, args) {
  if (!args.plan) throw new Error("Missing required --plan <path-or-id>");
  const taskDir = args.taskDir ?? "docs/tasks";
  const projection = scanArtifactGraph({ cwd, taskDir });
  const plan = resolvePlanRecord(cwd, args.plan, projection.records);
  const taskGraph = buildTaskGraph({ cwd, plan: plan.path, taskDir });
  const tasks = [];
  for (const node of taskGraph.nodes) {
    try {
      tasks.push({ id: node.id, body: (0, import_gray_matter4.default)(import_node_fs5.default.readFileSync(import_node_path5.default.join(cwd, node.path), "utf8")).content });
    } catch {
    }
  }
  return evaluateParallelSafety(taskGraph, tasks);
}
function runMergeVerification(cwd, args) {
  const slicesArg = args.verifyMerge;
  const slicesFile = import_node_path5.default.resolve(cwd, slicesArg);
  let parsed;
  try {
    parsed = JSON.parse(import_node_fs5.default.readFileSync(slicesFile, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read slices JSON ${JSON.stringify(slicesArg)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const inputs = parseSliceInputs(parsed);
  const slices = inputs.map((input) => ({
    taskId: input.taskId,
    declaredScope: input.declaredScope,
    evidencePaths: input.evidencePaths,
    taskDocPath: input.taskDocPath,
    touchedPaths: input.touchedPaths ?? collectChangedPaths(cwd, input.baseRef ?? args.baseRef ?? "HEAD")
  }));
  return verifyParallelMerge(cwd, slices, { taskDir: args.taskDir });
}
function main() {
  const jsonRequested = process.argv.slice(2).includes("--json");
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (args.plan && args.verifyMerge) {
      throw new Error("Use either --plan or --verify-merge, not both");
    }
    const cwd = import_node_path5.default.resolve(args.cwd);
    if (args.verifyMerge) {
      const report = runMergeVerification(cwd, args);
      console.log(JSON.stringify(report, null, 2));
      if (report.verdict !== "merge") process.exitCode = 1;
    } else {
      const report = runParallelCheck(cwd, args);
      console.log(JSON.stringify(report, null, 2));
      if (report.decision !== "parallel") process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (jsonRequested) {
      console.log(JSON.stringify({ error: message }));
    } else {
      console.error(message);
      console.error(usage());
    }
    process.exitCode = 1;
  }
}
main();
/*! Bundled license information:

is-extendable/index.js:
  (*!
   * is-extendable <https://github.com/jonschlinkert/is-extendable>
   *
   * Copyright (c) 2015, Jon Schlinkert.
   * Licensed under the MIT License.
   *)

strip-bom-string/index.js:
  (*!
   * strip-bom-string <https://github.com/jonschlinkert/strip-bom-string>
   *
   * Copyright (c) 2015, 2017, Jon Schlinkert.
   * Released under the MIT License.
   *)
*/
