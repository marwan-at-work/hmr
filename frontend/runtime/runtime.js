"use strict";
(function() {

Error.stackTraceLimit = Infinity;

var $global, $module;
if (typeof window !== "undefined") { /* web page */
  $global = window;
} else if (typeof self !== "undefined") { /* web worker */
  $global = self;
} else if (typeof global !== "undefined") { /* Node.js */
  $global = global;
  $global.require = require;
} else { /* others (e.g. Nashorn) */
  $global = this;
}

if ($global === undefined || $global.Array === undefined) {
  throw new Error("no global object found");
}
if (typeof module !== "undefined") {
  $module = module;
}

var $packages = {}, $idCounter = 0;
var $keys = function(m) { return m ? Object.keys(m) : []; };
var $flushConsole = function() {};
var $throwRuntimeError; /* set by package "runtime" */
var $throwNilPointerError = function() { $throwRuntimeError("invalid memory address or nil pointer dereference"); };
var $call = function(fn, rcvr, args) { return fn.apply(rcvr, args); };
var $makeFunc = function(fn) { return function() { return $externalize(fn(this, new ($sliceType($jsObjectPtr))($global.Array.prototype.slice.call(arguments, []))), $emptyInterface); }; };
var $unused = function(v) {};

var $mapArray = function(array, f) {
  var newArray = new array.constructor(array.length);
  for (var i = 0; i < array.length; i++) {
    newArray[i] = f(array[i]);
  }
  return newArray;
};

var $methodVal = function(recv, name) {
  var vals = recv.$methodVals || {};
  recv.$methodVals = vals; /* noop for primitives */
  var f = vals[name];
  if (f !== undefined) {
    return f;
  }
  var method = recv[name];
  f = function() {
    $stackDepthOffset--;
    try {
      return method.apply(recv, arguments);
    } finally {
      $stackDepthOffset++;
    }
  };
  vals[name] = f;
  return f;
};

var $methodExpr = function(typ, name) {
  var method = typ.prototype[name];
  if (method.$expr === undefined) {
    method.$expr = function() {
      $stackDepthOffset--;
      try {
        if (typ.wrapped) {
          arguments[0] = new typ(arguments[0]);
        }
        return Function.call.apply(method, arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return method.$expr;
};

var $ifaceMethodExprs = {};
var $ifaceMethodExpr = function(name) {
  var expr = $ifaceMethodExprs["$" + name];
  if (expr === undefined) {
    expr = $ifaceMethodExprs["$" + name] = function() {
      $stackDepthOffset--;
      try {
        return Function.call.apply(arguments[0][name], arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return expr;
};

var $subslice = function(slice, low, high, max) {
  if (low < 0 || high < low || max < high || high > slice.$capacity || max > slice.$capacity) {
    $throwRuntimeError("slice bounds out of range");
  }
  var s = new slice.constructor(slice.$array);
  s.$offset = slice.$offset + low;
  s.$length = slice.$length - low;
  s.$capacity = slice.$capacity - low;
  if (high !== undefined) {
    s.$length = high - low;
  }
  if (max !== undefined) {
    s.$capacity = max - low;
  }
  return s;
};

var $substring = function(str, low, high) {
  if (low < 0 || high < low || high > str.length) {
    $throwRuntimeError("slice bounds out of range");
  }
  return str.substring(low, high);
};

var $sliceToArray = function(slice) {
  if (slice.$array.constructor !== Array) {
    return slice.$array.subarray(slice.$offset, slice.$offset + slice.$length);
  }
  return slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
};

var $decodeRune = function(str, pos) {
  var c0 = str.charCodeAt(pos);

  if (c0 < 0x80) {
    return [c0, 1];
  }

  if (c0 !== c0 || c0 < 0xC0) {
    return [0xFFFD, 1];
  }

  var c1 = str.charCodeAt(pos + 1);
  if (c1 !== c1 || c1 < 0x80 || 0xC0 <= c1) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xE0) {
    var r = (c0 & 0x1F) << 6 | (c1 & 0x3F);
    if (r <= 0x7F) {
      return [0xFFFD, 1];
    }
    return [r, 2];
  }

  var c2 = str.charCodeAt(pos + 2);
  if (c2 !== c2 || c2 < 0x80 || 0xC0 <= c2) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF0) {
    var r = (c0 & 0x0F) << 12 | (c1 & 0x3F) << 6 | (c2 & 0x3F);
    if (r <= 0x7FF) {
      return [0xFFFD, 1];
    }
    if (0xD800 <= r && r <= 0xDFFF) {
      return [0xFFFD, 1];
    }
    return [r, 3];
  }

  var c3 = str.charCodeAt(pos + 3);
  if (c3 !== c3 || c3 < 0x80 || 0xC0 <= c3) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF8) {
    var r = (c0 & 0x07) << 18 | (c1 & 0x3F) << 12 | (c2 & 0x3F) << 6 | (c3 & 0x3F);
    if (r <= 0xFFFF || 0x10FFFF < r) {
      return [0xFFFD, 1];
    }
    return [r, 4];
  }

  return [0xFFFD, 1];
};

var $encodeRune = function(r) {
  if (r < 0 || r > 0x10FFFF || (0xD800 <= r && r <= 0xDFFF)) {
    r = 0xFFFD;
  }
  if (r <= 0x7F) {
    return String.fromCharCode(r);
  }
  if (r <= 0x7FF) {
    return String.fromCharCode(0xC0 | r >> 6, 0x80 | (r & 0x3F));
  }
  if (r <= 0xFFFF) {
    return String.fromCharCode(0xE0 | r >> 12, 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
  }
  return String.fromCharCode(0xF0 | r >> 18, 0x80 | (r >> 12 & 0x3F), 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
};

var $stringToBytes = function(str) {
  var array = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) {
    array[i] = str.charCodeAt(i);
  }
  return array;
};

var $bytesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i += 10000) {
    str += String.fromCharCode.apply(undefined, slice.$array.subarray(slice.$offset + i, slice.$offset + Math.min(slice.$length, i + 10000)));
  }
  return str;
};

var $stringToRunes = function(str) {
  var array = new Int32Array(str.length);
  var rune, j = 0;
  for (var i = 0; i < str.length; i += rune[1], j++) {
    rune = $decodeRune(str, i);
    array[j] = rune[0];
  }
  return array.subarray(0, j);
};

var $runesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i++) {
    str += $encodeRune(slice.$array[slice.$offset + i]);
  }
  return str;
};

var $copyString = function(dst, src) {
  var n = Math.min(src.length, dst.$length);
  for (var i = 0; i < n; i++) {
    dst.$array[dst.$offset + i] = src.charCodeAt(i);
  }
  return n;
};

var $copySlice = function(dst, src) {
  var n = Math.min(src.$length, dst.$length);
  $copyArray(dst.$array, src.$array, dst.$offset, src.$offset, n, dst.constructor.elem);
  return n;
};

var $copyArray = function(dst, src, dstOffset, srcOffset, n, elem) {
  if (n === 0 || (dst === src && dstOffset === srcOffset)) {
    return;
  }

  if (src.subarray) {
    dst.set(src.subarray(srcOffset, srcOffset + n), dstOffset);
    return;
  }

  switch (elem.kind) {
  case $kindArray:
  case $kindStruct:
    if (dst === src && dstOffset > srcOffset) {
      for (var i = n - 1; i >= 0; i--) {
        elem.copy(dst[dstOffset + i], src[srcOffset + i]);
      }
      return;
    }
    for (var i = 0; i < n; i++) {
      elem.copy(dst[dstOffset + i], src[srcOffset + i]);
    }
    return;
  }

  if (dst === src && dstOffset > srcOffset) {
    for (var i = n - 1; i >= 0; i--) {
      dst[dstOffset + i] = src[srcOffset + i];
    }
    return;
  }
  for (var i = 0; i < n; i++) {
    dst[dstOffset + i] = src[srcOffset + i];
  }
};

var $clone = function(src, type) {
  var clone = type.zero();
  type.copy(clone, src);
  return clone;
};

var $pointerOfStructConversion = function(obj, type) {
  if(obj.$proxies === undefined) {
    obj.$proxies = {};
    obj.$proxies[obj.constructor.string] = obj;
  }
  var proxy = obj.$proxies[type.string];
  if (proxy === undefined) {
    var properties = {};
    for (var i = 0; i < type.elem.fields.length; i++) {
      (function(fieldProp) {
        properties[fieldProp] = {
          get: function() { return obj[fieldProp]; },
          set: function(value) { obj[fieldProp] = value; }
        };
      })(type.elem.fields[i].prop);
    }
    proxy = Object.create(type.prototype, properties);
    proxy.$val = proxy;
    obj.$proxies[type.string] = proxy;
    proxy.$proxies = obj.$proxies;
  }
  return proxy;
};

var $append = function(slice) {
  return $internalAppend(slice, arguments, 1, arguments.length - 1);
};

var $appendSlice = function(slice, toAppend) {
  if (toAppend.constructor === String) {
    var bytes = $stringToBytes(toAppend);
    return $internalAppend(slice, bytes, 0, bytes.length);
  }
  return $internalAppend(slice, toAppend.$array, toAppend.$offset, toAppend.$length);
};

var $internalAppend = function(slice, array, offset, length) {
  if (length === 0) {
    return slice;
  }

  var newArray = slice.$array;
  var newOffset = slice.$offset;
  var newLength = slice.$length + length;
  var newCapacity = slice.$capacity;

  if (newLength > newCapacity) {
    newOffset = 0;
    newCapacity = Math.max(newLength, slice.$capacity < 1024 ? slice.$capacity * 2 : Math.floor(slice.$capacity * 5 / 4));

    if (slice.$array.constructor === Array) {
      newArray = slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
      newArray.length = newCapacity;
      var zero = slice.constructor.elem.zero;
      for (var i = slice.$length; i < newCapacity; i++) {
        newArray[i] = zero();
      }
    } else {
      newArray = new slice.$array.constructor(newCapacity);
      newArray.set(slice.$array.subarray(slice.$offset, slice.$offset + slice.$length));
    }
  }

  $copyArray(newArray, array, newOffset + slice.$length, offset, length, slice.constructor.elem);

  var newSlice = new slice.constructor(newArray);
  newSlice.$offset = newOffset;
  newSlice.$length = newLength;
  newSlice.$capacity = newCapacity;
  return newSlice;
};

var $equal = function(a, b, type) {
  if (type === $jsObjectPtr) {
    return a === b;
  }
  switch (type.kind) {
  case $kindComplex64:
  case $kindComplex128:
    return a.$real === b.$real && a.$imag === b.$imag;
  case $kindInt64:
  case $kindUint64:
    return a.$high === b.$high && a.$low === b.$low;
  case $kindArray:
    if (a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (!$equal(a[i], b[i], type.elem)) {
        return false;
      }
    }
    return true;
  case $kindStruct:
    for (var i = 0; i < type.fields.length; i++) {
      var f = type.fields[i];
      if (!$equal(a[f.prop], b[f.prop], f.typ)) {
        return false;
      }
    }
    return true;
  case $kindInterface:
    return $interfaceIsEqual(a, b);
  default:
    return a === b;
  }
};

var $interfaceIsEqual = function(a, b) {
  if (a === $ifaceNil || b === $ifaceNil) {
    return a === b;
  }
  if (a.constructor !== b.constructor) {
    return false;
  }
  if (a.constructor === $jsObjectPtr) {
    return a.object === b.object;
  }
  if (!a.constructor.comparable) {
    $throwRuntimeError("comparing uncomparable type " + a.constructor.string);
  }
  return $equal(a.$val, b.$val, a.constructor);
};

var $min = Math.min;
var $mod = function(x, y) { return x % y; };
var $parseInt = parseInt;
var $parseFloat = function(f) {
  if (f !== undefined && f !== null && f.constructor === Number) {
    return f;
  }
  return parseFloat(f);
};

var $froundBuf = new Float32Array(1);
var $fround = Math.fround || function(f) {
  $froundBuf[0] = f;
  return $froundBuf[0];
};

var $imul = Math.imul || function(a, b) {
  var ah = (a >>> 16) & 0xffff;
  var al = a & 0xffff;
  var bh = (b >>> 16) & 0xffff;
  var bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) >> 0);
};

var $floatKey = function(f) {
  if (f !== f) {
    $idCounter++;
    return "NaN$" + $idCounter;
  }
  return String(f);
};

var $flatten64 = function(x) {
  return x.$high * 4294967296 + x.$low;
};

var $shiftLeft64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high << y | x.$low >>> (32 - y), (x.$low << y) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$low << (y - 32), 0);
  }
  return new x.constructor(0, 0);
};

var $shiftRightInt64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$high >> 31, (x.$high >> (y - 32)) >>> 0);
  }
  if (x.$high < 0) {
    return new x.constructor(-1, 4294967295);
  }
  return new x.constructor(0, 0);
};

var $shiftRightUint64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >>> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(0, x.$high >>> (y - 32));
  }
  return new x.constructor(0, 0);
};

var $mul64 = function(x, y) {
  var high = 0, low = 0;
  if ((y.$low & 1) !== 0) {
    high = x.$high;
    low = x.$low;
  }
  for (var i = 1; i < 32; i++) {
    if ((y.$low & 1<<i) !== 0) {
      high += x.$high << i | x.$low >>> (32 - i);
      low += (x.$low << i) >>> 0;
    }
  }
  for (var i = 0; i < 32; i++) {
    if ((y.$high & 1<<i) !== 0) {
      high += x.$low << i;
    }
  }
  return new x.constructor(high, low);
};

var $div64 = function(x, y, returnRemainder) {
  if (y.$high === 0 && y.$low === 0) {
    $throwRuntimeError("integer divide by zero");
  }

  var s = 1;
  var rs = 1;

  var xHigh = x.$high;
  var xLow = x.$low;
  if (xHigh < 0) {
    s = -1;
    rs = -1;
    xHigh = -xHigh;
    if (xLow !== 0) {
      xHigh--;
      xLow = 4294967296 - xLow;
    }
  }

  var yHigh = y.$high;
  var yLow = y.$low;
  if (y.$high < 0) {
    s *= -1;
    yHigh = -yHigh;
    if (yLow !== 0) {
      yHigh--;
      yLow = 4294967296 - yLow;
    }
  }

  var high = 0, low = 0, n = 0;
  while (yHigh < 2147483648 && ((xHigh > yHigh) || (xHigh === yHigh && xLow > yLow))) {
    yHigh = (yHigh << 1 | yLow >>> 31) >>> 0;
    yLow = (yLow << 1) >>> 0;
    n++;
  }
  for (var i = 0; i <= n; i++) {
    high = high << 1 | low >>> 31;
    low = (low << 1) >>> 0;
    if ((xHigh > yHigh) || (xHigh === yHigh && xLow >= yLow)) {
      xHigh = xHigh - yHigh;
      xLow = xLow - yLow;
      if (xLow < 0) {
        xHigh--;
        xLow += 4294967296;
      }
      low++;
      if (low === 4294967296) {
        high++;
        low = 0;
      }
    }
    yLow = (yLow >>> 1 | yHigh << (32 - 1)) >>> 0;
    yHigh = yHigh >>> 1;
  }

  if (returnRemainder) {
    return new x.constructor(xHigh * rs, xLow * rs);
  }
  return new x.constructor(high * s, low * s);
};

var $divComplex = function(n, d) {
  var ninf = n.$real === Infinity || n.$real === -Infinity || n.$imag === Infinity || n.$imag === -Infinity;
  var dinf = d.$real === Infinity || d.$real === -Infinity || d.$imag === Infinity || d.$imag === -Infinity;
  var nnan = !ninf && (n.$real !== n.$real || n.$imag !== n.$imag);
  var dnan = !dinf && (d.$real !== d.$real || d.$imag !== d.$imag);
  if(nnan || dnan) {
    return new n.constructor(NaN, NaN);
  }
  if (ninf && !dinf) {
    return new n.constructor(Infinity, Infinity);
  }
  if (!ninf && dinf) {
    return new n.constructor(0, 0);
  }
  if (d.$real === 0 && d.$imag === 0) {
    if (n.$real === 0 && n.$imag === 0) {
      return new n.constructor(NaN, NaN);
    }
    return new n.constructor(Infinity, Infinity);
  }
  var a = Math.abs(d.$real);
  var b = Math.abs(d.$imag);
  if (a <= b) {
    var ratio = d.$real / d.$imag;
    var denom = d.$real * ratio + d.$imag;
    return new n.constructor((n.$real * ratio + n.$imag) / denom, (n.$imag * ratio - n.$real) / denom);
  }
  var ratio = d.$imag / d.$real;
  var denom = d.$imag * ratio + d.$real;
  return new n.constructor((n.$imag * ratio + n.$real) / denom, (n.$imag - n.$real * ratio) / denom);
};

var $kindBool = 1;
var $kindInt = 2;
var $kindInt8 = 3;
var $kindInt16 = 4;
var $kindInt32 = 5;
var $kindInt64 = 6;
var $kindUint = 7;
var $kindUint8 = 8;
var $kindUint16 = 9;
var $kindUint32 = 10;
var $kindUint64 = 11;
var $kindUintptr = 12;
var $kindFloat32 = 13;
var $kindFloat64 = 14;
var $kindComplex64 = 15;
var $kindComplex128 = 16;
var $kindArray = 17;
var $kindChan = 18;
var $kindFunc = 19;
var $kindInterface = 20;
var $kindMap = 21;
var $kindPtr = 22;
var $kindSlice = 23;
var $kindString = 24;
var $kindStruct = 25;
var $kindUnsafePointer = 26;

var $methodSynthesizers = [];
var $addMethodSynthesizer = function(f) {
  if ($methodSynthesizers === null) {
    f();
    return;
  }
  $methodSynthesizers.push(f);
};
var $synthesizeMethods = function() {
  $methodSynthesizers.forEach(function(f) { f(); });
  $methodSynthesizers = null;
};

var $ifaceKeyFor = function(x) {
  if (x === $ifaceNil) {
    return 'nil';
  }
  var c = x.constructor;
  return c.string + '$' + c.keyFor(x.$val);
};

var $identity = function(x) { return x; };

var $typeIDCounter = 0;

var $idKey = function(x) {
  if (x.$id === undefined) {
    $idCounter++;
    x.$id = $idCounter;
  }
  return String(x.$id);
};

var $newType = function(size, kind, string, named, pkg, exported, constructor) {
  var typ;
  switch(kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $identity;
    break;

  case $kindString:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return "$" + x; };
    break;

  case $kindFloat32:
  case $kindFloat64:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return $floatKey(x); };
    break;

  case $kindInt64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindUint64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >>> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindComplex64:
    typ = function(real, imag) {
      this.$real = $fround(real);
      this.$imag = $fround(imag);
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindComplex128:
    typ = function(real, imag) {
      this.$real = real;
      this.$imag = imag;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindArray:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, false, "", false, function(array) {
      this.$get = function() { return array; };
      this.$set = function(v) { typ.copy(this, v); };
      this.$val = array;
    });
    typ.init = function(elem, len) {
      typ.elem = elem;
      typ.len = len;
      typ.comparable = elem.comparable;
      typ.keyFor = function(x) {
        return Array.prototype.join.call($mapArray(x, function(e) {
          return String(elem.keyFor(e)).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }), "$");
      };
      typ.copy = function(dst, src) {
        $copyArray(dst, src, 0, 0, src.length, elem);
      };
      typ.ptr.init(typ);
      Object.defineProperty(typ.ptr.nil, "nilCheck", { get: $throwNilPointerError });
    };
    break;

  case $kindChan:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $idKey;
    typ.init = function(elem, sendOnly, recvOnly) {
      typ.elem = elem;
      typ.sendOnly = sendOnly;
      typ.recvOnly = recvOnly;
    };
    break;

  case $kindFunc:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(params, results, variadic) {
      typ.params = params;
      typ.results = results;
      typ.variadic = variadic;
      typ.comparable = false;
    };
    break;

  case $kindInterface:
    typ = { implementedBy: {}, missingMethodFor: {} };
    typ.keyFor = $ifaceKeyFor;
    typ.init = function(methods) {
      typ.methods = methods;
      methods.forEach(function(m) {
        $ifaceNil[m.prop] = $throwNilPointerError;
      });
    };
    break;

  case $kindMap:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(key, elem) {
      typ.key = key;
      typ.elem = elem;
      typ.comparable = false;
    };
    break;

  case $kindPtr:
    typ = constructor || function(getter, setter, target) {
      this.$get = getter;
      this.$set = setter;
      this.$target = target;
      this.$val = this;
    };
    typ.keyFor = $idKey;
    typ.init = function(elem) {
      typ.elem = elem;
      typ.wrapped = (elem.kind === $kindArray);
      typ.nil = new typ($throwNilPointerError, $throwNilPointerError);
    };
    break;

  case $kindSlice:
    typ = function(array) {
      if (array.constructor !== typ.nativeArray) {
        array = new typ.nativeArray(array);
      }
      this.$array = array;
      this.$offset = 0;
      this.$length = array.length;
      this.$capacity = array.length;
      this.$val = this;
    };
    typ.init = function(elem) {
      typ.elem = elem;
      typ.comparable = false;
      typ.nativeArray = $nativeArray(elem.kind);
      typ.nil = new typ([]);
    };
    break;

  case $kindStruct:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, false, pkg, exported, constructor);
    typ.ptr.elem = typ;
    typ.ptr.prototype.$get = function() { return this; };
    typ.ptr.prototype.$set = function(v) { typ.copy(this, v); };
    typ.init = function(pkgPath, fields) {
      typ.pkgPath = pkgPath;
      typ.fields = fields;
      fields.forEach(function(f) {
        if (!f.typ.comparable) {
          typ.comparable = false;
        }
      });
      typ.keyFor = function(x) {
        var val = x.$val;
        return $mapArray(fields, function(f) {
          return String(f.typ.keyFor(val[f.prop])).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }).join("$");
      };
      typ.copy = function(dst, src) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          switch (f.typ.kind) {
          case $kindArray:
          case $kindStruct:
            f.typ.copy(dst[f.prop], src[f.prop]);
            continue;
          default:
            dst[f.prop] = src[f.prop];
            continue;
          }
        }
      };
      /* nil value */
      var properties = {};
      fields.forEach(function(f) {
        properties[f.prop] = { get: $throwNilPointerError, set: $throwNilPointerError };
      });
      typ.ptr.nil = Object.create(constructor.prototype, properties);
      typ.ptr.nil.$val = typ.ptr.nil;
      /* methods for embedded fields */
      $addMethodSynthesizer(function() {
        var synthesizeMethod = function(target, m, f) {
          if (target.prototype[m.prop] !== undefined) { return; }
          target.prototype[m.prop] = function() {
            var v = this.$val[f.prop];
            if (f.typ === $jsObjectPtr) {
              v = new $jsObjectPtr(v);
            }
            if (v.$val === undefined) {
              v = new f.typ(v);
            }
            return v[m.prop].apply(v, arguments);
          };
        };
        fields.forEach(function(f) {
          if (f.anonymous) {
            $methodSet(f.typ).forEach(function(m) {
              synthesizeMethod(typ, m, f);
              synthesizeMethod(typ.ptr, m, f);
            });
            $methodSet($ptrType(f.typ)).forEach(function(m) {
              synthesizeMethod(typ.ptr, m, f);
            });
          }
        });
      });
    };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  switch (kind) {
  case $kindBool:
  case $kindMap:
    typ.zero = function() { return false; };
    break;

  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8 :
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
  case $kindFloat32:
  case $kindFloat64:
    typ.zero = function() { return 0; };
    break;

  case $kindString:
    typ.zero = function() { return ""; };
    break;

  case $kindInt64:
  case $kindUint64:
  case $kindComplex64:
  case $kindComplex128:
    var zero = new typ(0, 0);
    typ.zero = function() { return zero; };
    break;

  case $kindPtr:
  case $kindSlice:
    typ.zero = function() { return typ.nil; };
    break;

  case $kindChan:
    typ.zero = function() { return $chanNil; };
    break;

  case $kindFunc:
    typ.zero = function() { return $throwNilPointerError; };
    break;

  case $kindInterface:
    typ.zero = function() { return $ifaceNil; };
    break;

  case $kindArray:
    typ.zero = function() {
      var arrayClass = $nativeArray(typ.elem.kind);
      if (arrayClass !== Array) {
        return new arrayClass(typ.len);
      }
      var array = new Array(typ.len);
      for (var i = 0; i < typ.len; i++) {
        array[i] = typ.elem.zero();
      }
      return array;
    };
    break;

  case $kindStruct:
    typ.zero = function() { return new typ.ptr(); };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  typ.id = $typeIDCounter;
  $typeIDCounter++;
  typ.size = size;
  typ.kind = kind;
  typ.string = string;
  typ.named = named;
  typ.pkg = pkg;
  typ.exported = exported;
  typ.methods = [];
  typ.methodSetCache = null;
  typ.comparable = true;
  return typ;
};

var $methodSet = function(typ) {
  if (typ.methodSetCache !== null) {
    return typ.methodSetCache;
  }
  var base = {};

  var isPtr = (typ.kind === $kindPtr);
  if (isPtr && typ.elem.kind === $kindInterface) {
    typ.methodSetCache = [];
    return [];
  }

  var current = [{typ: isPtr ? typ.elem : typ, indirect: isPtr}];

  var seen = {};

  while (current.length > 0) {
    var next = [];
    var mset = [];

    current.forEach(function(e) {
      if (seen[e.typ.string]) {
        return;
      }
      seen[e.typ.string] = true;

      if (e.typ.named) {
        mset = mset.concat(e.typ.methods);
        if (e.indirect) {
          mset = mset.concat($ptrType(e.typ).methods);
        }
      }

      switch (e.typ.kind) {
      case $kindStruct:
        e.typ.fields.forEach(function(f) {
          if (f.anonymous) {
            var fTyp = f.typ;
            var fIsPtr = (fTyp.kind === $kindPtr);
            next.push({typ: fIsPtr ? fTyp.elem : fTyp, indirect: e.indirect || fIsPtr});
          }
        });
        break;

      case $kindInterface:
        mset = mset.concat(e.typ.methods);
        break;
      }
    });

    mset.forEach(function(m) {
      if (base[m.name] === undefined) {
        base[m.name] = m;
      }
    });

    current = next;
  }

  typ.methodSetCache = [];
  Object.keys(base).sort().forEach(function(name) {
    typ.methodSetCache.push(base[name]);
  });
  return typ.methodSetCache;
};

var $Bool          = $newType( 1, $kindBool,          "bool",           true, "", false, null);
var $Int           = $newType( 4, $kindInt,           "int",            true, "", false, null);
var $Int8          = $newType( 1, $kindInt8,          "int8",           true, "", false, null);
var $Int16         = $newType( 2, $kindInt16,         "int16",          true, "", false, null);
var $Int32         = $newType( 4, $kindInt32,         "int32",          true, "", false, null);
var $Int64         = $newType( 8, $kindInt64,         "int64",          true, "", false, null);
var $Uint          = $newType( 4, $kindUint,          "uint",           true, "", false, null);
var $Uint8         = $newType( 1, $kindUint8,         "uint8",          true, "", false, null);
var $Uint16        = $newType( 2, $kindUint16,        "uint16",         true, "", false, null);
var $Uint32        = $newType( 4, $kindUint32,        "uint32",         true, "", false, null);
var $Uint64        = $newType( 8, $kindUint64,        "uint64",         true, "", false, null);
var $Uintptr       = $newType( 4, $kindUintptr,       "uintptr",        true, "", false, null);
var $Float32       = $newType( 4, $kindFloat32,       "float32",        true, "", false, null);
var $Float64       = $newType( 8, $kindFloat64,       "float64",        true, "", false, null);
var $Complex64     = $newType( 8, $kindComplex64,     "complex64",      true, "", false, null);
var $Complex128    = $newType(16, $kindComplex128,    "complex128",     true, "", false, null);
var $String        = $newType( 8, $kindString,        "string",         true, "", false, null);
var $UnsafePointer = $newType( 4, $kindUnsafePointer, "unsafe.Pointer", true, "", false, null);

var $nativeArray = function(elemKind) {
  switch (elemKind) {
  case $kindInt:
    return Int32Array;
  case $kindInt8:
    return Int8Array;
  case $kindInt16:
    return Int16Array;
  case $kindInt32:
    return Int32Array;
  case $kindUint:
    return Uint32Array;
  case $kindUint8:
    return Uint8Array;
  case $kindUint16:
    return Uint16Array;
  case $kindUint32:
    return Uint32Array;
  case $kindUintptr:
    return Uint32Array;
  case $kindFloat32:
    return Float32Array;
  case $kindFloat64:
    return Float64Array;
  default:
    return Array;
  }
};
var $toNativeArray = function(elemKind, array) {
  var nativeArray = $nativeArray(elemKind);
  if (nativeArray === Array) {
    return array;
  }
  return new nativeArray(array);
};
var $arrayTypes = {};
var $arrayType = function(elem, len) {
  var typeKey = elem.id + "$" + len;
  var typ = $arrayTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(12, $kindArray, "[" + len + "]" + elem.string, false, "", false, null);
    $arrayTypes[typeKey] = typ;
    typ.init(elem, len);
  }
  return typ;
};

var $chanType = function(elem, sendOnly, recvOnly) {
  var string = (recvOnly ? "<-" : "") + "chan" + (sendOnly ? "<- " : " ") + elem.string;
  var field = sendOnly ? "SendChan" : (recvOnly ? "RecvChan" : "Chan");
  var typ = elem[field];
  if (typ === undefined) {
    typ = $newType(4, $kindChan, string, false, "", false, null);
    elem[field] = typ;
    typ.init(elem, sendOnly, recvOnly);
  }
  return typ;
};
var $Chan = function(elem, capacity) {
  if (capacity < 0 || capacity > 2147483647) {
    $throwRuntimeError("makechan: size out of range");
  }
  this.$elem = elem;
  this.$capacity = capacity;
  this.$buffer = [];
  this.$sendQueue = [];
  this.$recvQueue = [];
  this.$closed = false;
};
var $chanNil = new $Chan(null, 0);
$chanNil.$sendQueue = $chanNil.$recvQueue = { length: 0, push: function() {}, shift: function() { return undefined; }, indexOf: function() { return -1; } };

var $funcTypes = {};
var $funcType = function(params, results, variadic) {
  var typeKey = $mapArray(params, function(p) { return p.id; }).join(",") + "$" + $mapArray(results, function(r) { return r.id; }).join(",") + "$" + variadic;
  var typ = $funcTypes[typeKey];
  if (typ === undefined) {
    var paramTypes = $mapArray(params, function(p) { return p.string; });
    if (variadic) {
      paramTypes[paramTypes.length - 1] = "..." + paramTypes[paramTypes.length - 1].substr(2);
    }
    var string = "func(" + paramTypes.join(", ") + ")";
    if (results.length === 1) {
      string += " " + results[0].string;
    } else if (results.length > 1) {
      string += " (" + $mapArray(results, function(r) { return r.string; }).join(", ") + ")";
    }
    typ = $newType(4, $kindFunc, string, false, "", false, null);
    $funcTypes[typeKey] = typ;
    typ.init(params, results, variadic);
  }
  return typ;
};

var $interfaceTypes = {};
var $interfaceType = function(methods) {
  var typeKey = $mapArray(methods, function(m) { return m.pkg + "," + m.name + "," + m.typ.id; }).join("$");
  var typ = $interfaceTypes[typeKey];
  if (typ === undefined) {
    var string = "interface {}";
    if (methods.length !== 0) {
      string = "interface { " + $mapArray(methods, function(m) {
        return (m.pkg !== "" ? m.pkg + "." : "") + m.name + m.typ.string.substr(4);
      }).join("; ") + " }";
    }
    typ = $newType(8, $kindInterface, string, false, "", false, null);
    $interfaceTypes[typeKey] = typ;
    typ.init(methods);
  }
  return typ;
};
var $emptyInterface = $interfaceType([]);
var $ifaceNil = {};
var $error = $newType(8, $kindInterface, "error", true, "", false, null);
$error.init([{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}]);

var $mapTypes = {};
var $mapType = function(key, elem) {
  var typeKey = key.id + "$" + elem.id;
  var typ = $mapTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(4, $kindMap, "map[" + key.string + "]" + elem.string, false, "", false, null);
    $mapTypes[typeKey] = typ;
    typ.init(key, elem);
  }
  return typ;
};
var $makeMap = function(keyForFunc, entries) {
  var m = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    m[keyForFunc(e.k)] = e;
  }
  return m;
};

var $ptrType = function(elem) {
  var typ = elem.ptr;
  if (typ === undefined) {
    typ = $newType(4, $kindPtr, "*" + elem.string, false, "", elem.exported, null);
    elem.ptr = typ;
    typ.init(elem);
  }
  return typ;
};

var $newDataPointer = function(data, constructor) {
  if (constructor.elem.kind === $kindStruct) {
    return data;
  }
  return new constructor(function() { return data; }, function(v) { data = v; });
};

var $indexPtr = function(array, index, constructor) {
  array.$ptr = array.$ptr || {};
  return array.$ptr[index] || (array.$ptr[index] = new constructor(function() { return array[index]; }, function(v) { array[index] = v; }));
};

var $sliceType = function(elem) {
  var typ = elem.slice;
  if (typ === undefined) {
    typ = $newType(12, $kindSlice, "[]" + elem.string, false, "", false, null);
    elem.slice = typ;
    typ.init(elem);
  }
  return typ;
};
var $makeSlice = function(typ, length, capacity) {
  capacity = capacity || length;
  if (length < 0 || length > 2147483647) {
    $throwRuntimeError("makeslice: len out of range");
  }
  if (capacity < 0 || capacity < length || capacity > 2147483647) {
    $throwRuntimeError("makeslice: cap out of range");
  }
  var array = new typ.nativeArray(capacity);
  if (typ.nativeArray === Array) {
    for (var i = 0; i < capacity; i++) {
      array[i] = typ.elem.zero();
    }
  }
  var slice = new typ(array);
  slice.$length = length;
  return slice;
};

var $structTypes = {};
var $structType = function(pkgPath, fields) {
  var typeKey = $mapArray(fields, function(f) { return f.name + "," + f.typ.id + "," + f.tag; }).join("$");
  var typ = $structTypes[typeKey];
  if (typ === undefined) {
    var string = "struct { " + $mapArray(fields, function(f) {
      return f.name + " " + f.typ.string + (f.tag !== "" ? (" \"" + f.tag.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"") : "");
    }).join("; ") + " }";
    if (fields.length === 0) {
      string = "struct {}";
    }
    typ = $newType(0, $kindStruct, string, false, "", false, function() {
      this.$val = this;
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var arg = arguments[i];
        this[f.prop] = arg !== undefined ? arg : f.typ.zero();
      }
    });
    $structTypes[typeKey] = typ;
    typ.init(pkgPath, fields);
  }
  return typ;
};

var $assertType = function(value, type, returnTuple) {
  var isInterface = (type.kind === $kindInterface), ok, missingMethod = "";
  if (value === $ifaceNil) {
    ok = false;
  } else if (!isInterface) {
    ok = value.constructor === type;
  } else {
    var valueTypeString = value.constructor.string;
    ok = type.implementedBy[valueTypeString];
    if (ok === undefined) {
      ok = true;
      var valueMethodSet = $methodSet(value.constructor);
      var interfaceMethods = type.methods;
      for (var i = 0; i < interfaceMethods.length; i++) {
        var tm = interfaceMethods[i];
        var found = false;
        for (var j = 0; j < valueMethodSet.length; j++) {
          var vm = valueMethodSet[j];
          if (vm.name === tm.name && vm.pkg === tm.pkg && vm.typ === tm.typ) {
            found = true;
            break;
          }
        }
        if (!found) {
          ok = false;
          type.missingMethodFor[valueTypeString] = tm.name;
          break;
        }
      }
      type.implementedBy[valueTypeString] = ok;
    }
    if (!ok) {
      missingMethod = type.missingMethodFor[valueTypeString];
    }
  }

  if (!ok) {
    if (returnTuple) {
      return [type.zero(), false];
    }
    $panic(new $packages["runtime"].TypeAssertionError.ptr("", (value === $ifaceNil ? "" : value.constructor.string), type.string, missingMethod));
  }

  if (!isInterface) {
    value = value.$val;
  }
  if (type === $jsObjectPtr) {
    value = value.object;
  }
  return returnTuple ? [value, true] : value;
};

var $stackDepthOffset = 0;
var $getStackDepth = function() {
  var err = new Error();
  if (err.stack === undefined) {
    return undefined;
  }
  return $stackDepthOffset + err.stack.split("\n").length;
};

var $panicStackDepth = null, $panicValue;
var $callDeferred = function(deferred, jsErr, fromPanic) {
  if (!fromPanic && deferred !== null && deferred.index >= $curGoroutine.deferStack.length) {
    throw jsErr;
  }
  if (jsErr !== null) {
    var newErr = null;
    try {
      $curGoroutine.deferStack.push(deferred);
      $panic(new $jsErrorPtr(jsErr));
    } catch (err) {
      newErr = err;
    }
    $curGoroutine.deferStack.pop();
    $callDeferred(deferred, newErr);
    return;
  }
  if ($curGoroutine.asleep) {
    return;
  }

  $stackDepthOffset--;
  var outerPanicStackDepth = $panicStackDepth;
  var outerPanicValue = $panicValue;

  var localPanicValue = $curGoroutine.panicStack.pop();
  if (localPanicValue !== undefined) {
    $panicStackDepth = $getStackDepth();
    $panicValue = localPanicValue;
  }

  try {
    while (true) {
      if (deferred === null) {
        deferred = $curGoroutine.deferStack[$curGoroutine.deferStack.length - 1];
        if (deferred === undefined) {
          /* The panic reached the top of the stack. Clear it and throw it as a JavaScript error. */
          $panicStackDepth = null;
          if (localPanicValue.Object instanceof Error) {
            throw localPanicValue.Object;
          }
          var msg;
          if (localPanicValue.constructor === $String) {
            msg = localPanicValue.$val;
          } else if (localPanicValue.Error !== undefined) {
            msg = localPanicValue.Error();
          } else if (localPanicValue.String !== undefined) {
            msg = localPanicValue.String();
          } else {
            msg = localPanicValue;
          }
          throw new Error(msg);
        }
      }
      var call = deferred.pop();
      if (call === undefined) {
        $curGoroutine.deferStack.pop();
        if (localPanicValue !== undefined) {
          deferred = null;
          continue;
        }
        return;
      }
      var r = call[0].apply(call[2], call[1]);
      if (r && r.$blk !== undefined) {
        deferred.push([r.$blk, [], r]);
        if (fromPanic) {
          throw null;
        }
        return;
      }

      if (localPanicValue !== undefined && $panicStackDepth === null) {
        throw null; /* error was recovered */
      }
    }
  } finally {
    if (localPanicValue !== undefined) {
      if ($panicStackDepth !== null) {
        $curGoroutine.panicStack.push(localPanicValue);
      }
      $panicStackDepth = outerPanicStackDepth;
      $panicValue = outerPanicValue;
    }
    $stackDepthOffset++;
  }
};

var $panic = function(value) {
  $curGoroutine.panicStack.push(value);
  $callDeferred(null, null, true);
};
var $recover = function() {
  if ($panicStackDepth === null || ($panicStackDepth !== undefined && $panicStackDepth !== $getStackDepth() - 2)) {
    return $ifaceNil;
  }
  $panicStackDepth = null;
  return $panicValue;
};
var $throw = function(err) { throw err; };

var $noGoroutine = { asleep: false, exit: false, deferStack: [], panicStack: [] };
var $curGoroutine = $noGoroutine, $totalGoroutines = 0, $awakeGoroutines = 0, $checkForDeadlock = true;
var $mainFinished = false;
var $go = function(fun, args) {
  $totalGoroutines++;
  $awakeGoroutines++;
  var $goroutine = function() {
    try {
      $curGoroutine = $goroutine;
      var r = fun.apply(undefined, args);
      if (r && r.$blk !== undefined) {
        fun = function() { return r.$blk(); };
        args = [];
        return;
      }
      $goroutine.exit = true;
    } catch (err) {
      if (!$goroutine.exit) {
        throw err;
      }
    } finally {
      $curGoroutine = $noGoroutine;
      if ($goroutine.exit) { /* also set by runtime.Goexit() */
        $totalGoroutines--;
        $goroutine.asleep = true;
      }
      if ($goroutine.asleep) {
        $awakeGoroutines--;
        if (!$mainFinished && $awakeGoroutines === 0 && $checkForDeadlock) {
          console.error("fatal error: all goroutines are asleep - deadlock!");
          if ($global.process !== undefined) {
            $global.process.exit(2);
          }
        }
      }
    }
  };
  $goroutine.asleep = false;
  $goroutine.exit = false;
  $goroutine.deferStack = [];
  $goroutine.panicStack = [];
  $schedule($goroutine);
};

var $scheduled = [];
var $runScheduled = function() {
  try {
    var r;
    while ((r = $scheduled.shift()) !== undefined) {
      r();
    }
  } finally {
    if ($scheduled.length > 0) {
      setTimeout($runScheduled, 0);
    }
  }
};

var $schedule = function(goroutine) {
  if (goroutine.asleep) {
    goroutine.asleep = false;
    $awakeGoroutines++;
  }
  $scheduled.push(goroutine);
  if ($curGoroutine === $noGoroutine) {
    $runScheduled();
  }
};

var $setTimeout = function(f, t) {
  $awakeGoroutines++;
  return setTimeout(function() {
    $awakeGoroutines--;
    f();
  }, t);
};

var $block = function() {
  if ($curGoroutine === $noGoroutine) {
    $throwRuntimeError("cannot block in JavaScript callback, fix by wrapping code in goroutine");
  }
  $curGoroutine.asleep = true;
};

var $send = function(chan, value) {
  if (chan.$closed) {
    $throwRuntimeError("send on closed channel");
  }
  var queuedRecv = chan.$recvQueue.shift();
  if (queuedRecv !== undefined) {
    queuedRecv([value, true]);
    return;
  }
  if (chan.$buffer.length < chan.$capacity) {
    chan.$buffer.push(value);
    return;
  }

  var thisGoroutine = $curGoroutine;
  var closedDuringSend;
  chan.$sendQueue.push(function(closed) {
    closedDuringSend = closed;
    $schedule(thisGoroutine);
    return value;
  });
  $block();
  return {
    $blk: function() {
      if (closedDuringSend) {
        $throwRuntimeError("send on closed channel");
      }
    }
  };
};
var $recv = function(chan) {
  var queuedSend = chan.$sendQueue.shift();
  if (queuedSend !== undefined) {
    chan.$buffer.push(queuedSend(false));
  }
  var bufferedValue = chan.$buffer.shift();
  if (bufferedValue !== undefined) {
    return [bufferedValue, true];
  }
  if (chan.$closed) {
    return [chan.$elem.zero(), false];
  }

  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.value; } };
  var queueEntry = function(v) {
    f.value = v;
    $schedule(thisGoroutine);
  };
  chan.$recvQueue.push(queueEntry);
  $block();
  return f;
};
var $close = function(chan) {
  if (chan.$closed) {
    $throwRuntimeError("close of closed channel");
  }
  chan.$closed = true;
  while (true) {
    var queuedSend = chan.$sendQueue.shift();
    if (queuedSend === undefined) {
      break;
    }
    queuedSend(true); /* will panic */
  }
  while (true) {
    var queuedRecv = chan.$recvQueue.shift();
    if (queuedRecv === undefined) {
      break;
    }
    queuedRecv([chan.$elem.zero(), false]);
  }
};
var $select = function(comms) {
  var ready = [];
  var selection = -1;
  for (var i = 0; i < comms.length; i++) {
    var comm = comms[i];
    var chan = comm[0];
    switch (comm.length) {
    case 0: /* default */
      selection = i;
      break;
    case 1: /* recv */
      if (chan.$sendQueue.length !== 0 || chan.$buffer.length !== 0 || chan.$closed) {
        ready.push(i);
      }
      break;
    case 2: /* send */
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      if (chan.$recvQueue.length !== 0 || chan.$buffer.length < chan.$capacity) {
        ready.push(i);
      }
      break;
    }
  }

  if (ready.length !== 0) {
    selection = ready[Math.floor(Math.random() * ready.length)];
  }
  if (selection !== -1) {
    var comm = comms[selection];
    switch (comm.length) {
    case 0: /* default */
      return [selection];
    case 1: /* recv */
      return [selection, $recv(comm[0])];
    case 2: /* send */
      $send(comm[0], comm[1]);
      return [selection];
    }
  }

  var entries = [];
  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.selection; } };
  var removeFromQueues = function() {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var queue = entry[0];
      var index = queue.indexOf(entry[1]);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  };
  for (var i = 0; i < comms.length; i++) {
    (function(i) {
      var comm = comms[i];
      switch (comm.length) {
      case 1: /* recv */
        var queueEntry = function(value) {
          f.selection = [i, value];
          removeFromQueues();
          $schedule(thisGoroutine);
        };
        entries.push([comm[0].$recvQueue, queueEntry]);
        comm[0].$recvQueue.push(queueEntry);
        break;
      case 2: /* send */
        var queueEntry = function() {
          if (comm[0].$closed) {
            $throwRuntimeError("send on closed channel");
          }
          f.selection = [i];
          removeFromQueues();
          $schedule(thisGoroutine);
          return comm[1];
        };
        entries.push([comm[0].$sendQueue, queueEntry]);
        comm[0].$sendQueue.push(queueEntry);
        break;
      }
    })(i);
  }
  $block();
  return f;
};

var $jsObjectPtr, $jsErrorPtr;

var $needsExternalization = function(t) {
  switch (t.kind) {
    case $kindBool:
    case $kindInt:
    case $kindInt8:
    case $kindInt16:
    case $kindInt32:
    case $kindUint:
    case $kindUint8:
    case $kindUint16:
    case $kindUint32:
    case $kindUintptr:
    case $kindFloat32:
    case $kindFloat64:
      return false;
    default:
      return t !== $jsObjectPtr;
  }
};

var $externalize = function(v, t) {
  if (t === $jsObjectPtr) {
    return v;
  }
  switch (t.kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindFloat32:
  case $kindFloat64:
    return v;
  case $kindInt64:
  case $kindUint64:
    return $flatten64(v);
  case $kindArray:
    if ($needsExternalization(t.elem)) {
      return $mapArray(v, function(e) { return $externalize(e, t.elem); });
    }
    return v;
  case $kindFunc:
    return $externalizeFunction(v, t, false);
  case $kindInterface:
    if (v === $ifaceNil) {
      return null;
    }
    if (v.constructor === $jsObjectPtr) {
      return v.$val.object;
    }
    return $externalize(v.$val, v.constructor);
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var entry = v[keys[i]];
      m[$externalize(entry.k, t.key)] = $externalize(entry.v, t.elem);
    }
    return m;
  case $kindPtr:
    if (v === t.nil) {
      return null;
    }
    return $externalize(v.$get(), t.elem);
  case $kindSlice:
    if ($needsExternalization(t.elem)) {
      return $mapArray($sliceToArray(v), function(e) { return $externalize(e, t.elem); });
    }
    return $sliceToArray(v);
  case $kindString:
    if ($isASCII(v)) {
      return v;
    }
    var s = "", r;
    for (var i = 0; i < v.length; i += r[1]) {
      r = $decodeRune(v, i);
      var c = r[0];
      if (c > 0xFFFF) {
        var h = Math.floor((c - 0x10000) / 0x400) + 0xD800;
        var l = (c - 0x10000) % 0x400 + 0xDC00;
        s += String.fromCharCode(h, l);
        continue;
      }
      s += String.fromCharCode(c);
    }
    return s;
  case $kindStruct:
    var timePkg = $packages["time"];
    if (timePkg !== undefined && v.constructor === timePkg.Time.ptr) {
      var milli = $div64(v.UnixNano(), new $Int64(0, 1000000));
      return new Date($flatten64(milli));
    }

    var noJsObject = {};
    var searchJsObject = function(v, t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      switch (t.kind) {
      case $kindPtr:
        if (v === t.nil) {
          return noJsObject;
        }
        return searchJsObject(v.$get(), t.elem);
      case $kindStruct:
        var f = t.fields[0];
        return searchJsObject(v[f.prop], f.typ);
      case $kindInterface:
        return searchJsObject(v.$val, v.constructor);
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(v, t);
    if (o !== noJsObject) {
      return o;
    }

    o = {};
    for (var i = 0; i < t.fields.length; i++) {
      var f = t.fields[i];
      if (!f.exported) {
        continue;
      }
      o[f.name] = $externalize(v[f.prop], f.typ);
    }
    return o;
  }
  $throwRuntimeError("cannot externalize " + t.string);
};

var $externalizeFunction = function(v, t, passThis) {
  if (v === $throwNilPointerError) {
    return null;
  }
  if (v.$externalizeWrapper === undefined) {
    $checkForDeadlock = false;
    v.$externalizeWrapper = function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = [];
          for (var j = i; j < arguments.length; j++) {
            varargs.push($internalize(arguments[j], vt));
          }
          args.push(new (t.params[i])(varargs));
          break;
        }
        args.push($internalize(arguments[i], t.params[i]));
      }
      var result = v.apply(passThis ? this : undefined, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $externalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $externalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  }
  return v.$externalizeWrapper;
};

var $internalize = function(v, t, recv) {
  if (t === $jsObjectPtr) {
    return v;
  }
  if (t === $jsObjectPtr.elem) {
    $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
  }
  if (v && v.__internal_object__ !== undefined) {
    return $assertType(v.__internal_object__, t, false);
  }
  var timePkg = $packages["time"];
  if (timePkg !== undefined && t === timePkg.Time) {
    if (!(v !== null && v !== undefined && v.constructor === Date)) {
      $throwRuntimeError("cannot internalize time.Time from " + typeof v + ", must be Date");
    }
    return timePkg.Unix(new $Int64(0, 0), new $Int64(0, v.getTime() * 1000000));
  }
  switch (t.kind) {
  case $kindBool:
    return !!v;
  case $kindInt:
    return parseInt(v);
  case $kindInt8:
    return parseInt(v) << 24 >> 24;
  case $kindInt16:
    return parseInt(v) << 16 >> 16;
  case $kindInt32:
    return parseInt(v) >> 0;
  case $kindUint:
    return parseInt(v);
  case $kindUint8:
    return parseInt(v) << 24 >>> 24;
  case $kindUint16:
    return parseInt(v) << 16 >>> 16;
  case $kindUint32:
  case $kindUintptr:
    return parseInt(v) >>> 0;
  case $kindInt64:
  case $kindUint64:
    return new t(0, v);
  case $kindFloat32:
  case $kindFloat64:
    return parseFloat(v);
  case $kindArray:
    if (v.length !== t.len) {
      $throwRuntimeError("got array with wrong size from JavaScript native");
    }
    return $mapArray(v, function(e) { return $internalize(e, t.elem); });
  case $kindFunc:
    return function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = arguments[i];
          for (var j = 0; j < varargs.$length; j++) {
            args.push($externalize(varargs.$array[varargs.$offset + j], vt));
          }
          break;
        }
        args.push($externalize(arguments[i], t.params[i]));
      }
      var result = v.apply(recv, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $internalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $internalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  case $kindInterface:
    if (t.methods.length !== 0) {
      $throwRuntimeError("cannot internalize " + t.string);
    }
    if (v === null) {
      return $ifaceNil;
    }
    if (v === undefined) {
      return new $jsObjectPtr(undefined);
    }
    switch (v.constructor) {
    case Int8Array:
      return new ($sliceType($Int8))(v);
    case Int16Array:
      return new ($sliceType($Int16))(v);
    case Int32Array:
      return new ($sliceType($Int))(v);
    case Uint8Array:
      return new ($sliceType($Uint8))(v);
    case Uint16Array:
      return new ($sliceType($Uint16))(v);
    case Uint32Array:
      return new ($sliceType($Uint))(v);
    case Float32Array:
      return new ($sliceType($Float32))(v);
    case Float64Array:
      return new ($sliceType($Float64))(v);
    case Array:
      return $internalize(v, $sliceType($emptyInterface));
    case Boolean:
      return new $Bool(!!v);
    case Date:
      if (timePkg === undefined) {
        /* time package is not present, internalize as &js.Object{Date} so it can be externalized into original Date. */
        return new $jsObjectPtr(v);
      }
      return new timePkg.Time($internalize(v, timePkg.Time));
    case Function:
      var funcType = $funcType([$sliceType($emptyInterface)], [$jsObjectPtr], true);
      return new funcType($internalize(v, funcType));
    case Number:
      return new $Float64(parseFloat(v));
    case String:
      return new $String($internalize(v, $String));
    default:
      if ($global.Node && v instanceof $global.Node) {
        return new $jsObjectPtr(v);
      }
      var mapType = $mapType($String, $emptyInterface);
      return new mapType($internalize(v, mapType));
    }
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var k = $internalize(keys[i], t.key);
      m[t.key.keyFor(k)] = { k: k, v: $internalize(v[keys[i]], t.elem) };
    }
    return m;
  case $kindPtr:
    if (t.elem.kind === $kindStruct) {
      return $internalize(v, t.elem);
    }
  case $kindSlice:
    return new t($mapArray(v, function(e) { return $internalize(e, t.elem); }));
  case $kindString:
    v = String(v);
    if ($isASCII(v)) {
      return v;
    }
    var s = "";
    var i = 0;
    while (i < v.length) {
      var h = v.charCodeAt(i);
      if (0xD800 <= h && h <= 0xDBFF) {
        var l = v.charCodeAt(i + 1);
        var c = (h - 0xD800) * 0x400 + l - 0xDC00 + 0x10000;
        s += $encodeRune(c);
        i += 2;
        continue;
      }
      s += $encodeRune(h);
      i++;
    }
    return s;
  case $kindStruct:
    var noJsObject = {};
    var searchJsObject = function(t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      if (t === $jsObjectPtr.elem) {
        $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
      }
      switch (t.kind) {
      case $kindPtr:
        return searchJsObject(t.elem);
      case $kindStruct:
        var f = t.fields[0];
        var o = searchJsObject(f.typ);
        if (o !== noJsObject) {
          var n = new t.ptr();
          n[f.prop] = o;
          return n;
        }
        return noJsObject;
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(t);
    if (o !== noJsObject) {
      return o;
    }
  }
  $throwRuntimeError("cannot internalize " + t.string);
};

/* $isASCII reports whether string s contains only ASCII characters. */
var $isASCII = function(s) {
  for (var i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 128) {
      return false;
    }
  }
  return true;
};

$packages["github.com/gopherjs/gopherjs/js"] = (function() {
	var $pkg = {}, $init, Object, Error, sliceType, sliceType$1, ptrType, ptrType$1, MakeFunc, Keys, init;
	Object = $pkg.Object = $newType(0, $kindStruct, "js.Object", true, "github.com/gopherjs/gopherjs/js", true, function(object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.object = null;
			return;
		}
		this.object = object_;
	});
	Error = $pkg.Error = $newType(0, $kindStruct, "js.Error", true, "github.com/gopherjs/gopherjs/js", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	sliceType = $sliceType($emptyInterface);
	sliceType$1 = $sliceType($String);
	ptrType = $ptrType(Object);
	ptrType$1 = $ptrType(Error);
	Object.ptr.prototype.Get = function(key) {
		var key, o;
		o = this;
		return o.object[$externalize(key, $String)];
	};
	Object.prototype.Get = function(key) { return this.$val.Get(key); };
	Object.ptr.prototype.Set = function(key, value) {
		var key, o, value;
		o = this;
		o.object[$externalize(key, $String)] = $externalize(value, $emptyInterface);
	};
	Object.prototype.Set = function(key, value) { return this.$val.Set(key, value); };
	Object.ptr.prototype.Delete = function(key) {
		var key, o;
		o = this;
		delete o.object[$externalize(key, $String)];
	};
	Object.prototype.Delete = function(key) { return this.$val.Delete(key); };
	Object.ptr.prototype.Length = function() {
		var o;
		o = this;
		return $parseInt(o.object.length);
	};
	Object.prototype.Length = function() { return this.$val.Length(); };
	Object.ptr.prototype.Index = function(i) {
		var i, o;
		o = this;
		return o.object[i];
	};
	Object.prototype.Index = function(i) { return this.$val.Index(i); };
	Object.ptr.prototype.SetIndex = function(i, value) {
		var i, o, value;
		o = this;
		o.object[i] = $externalize(value, $emptyInterface);
	};
	Object.prototype.SetIndex = function(i, value) { return this.$val.SetIndex(i, value); };
	Object.ptr.prototype.Call = function(name, args) {
		var args, name, o, obj;
		o = this;
		return (obj = o.object, obj[$externalize(name, $String)].apply(obj, $externalize(args, sliceType)));
	};
	Object.prototype.Call = function(name, args) { return this.$val.Call(name, args); };
	Object.ptr.prototype.Invoke = function(args) {
		var args, o;
		o = this;
		return o.object.apply(undefined, $externalize(args, sliceType));
	};
	Object.prototype.Invoke = function(args) { return this.$val.Invoke(args); };
	Object.ptr.prototype.New = function(args) {
		var args, o;
		o = this;
		return new ($global.Function.prototype.bind.apply(o.object, [undefined].concat($externalize(args, sliceType))));
	};
	Object.prototype.New = function(args) { return this.$val.New(args); };
	Object.ptr.prototype.Bool = function() {
		var o;
		o = this;
		return !!(o.object);
	};
	Object.prototype.Bool = function() { return this.$val.Bool(); };
	Object.ptr.prototype.String = function() {
		var o;
		o = this;
		return $internalize(o.object, $String);
	};
	Object.prototype.String = function() { return this.$val.String(); };
	Object.ptr.prototype.Int = function() {
		var o;
		o = this;
		return $parseInt(o.object) >> 0;
	};
	Object.prototype.Int = function() { return this.$val.Int(); };
	Object.ptr.prototype.Int64 = function() {
		var o;
		o = this;
		return $internalize(o.object, $Int64);
	};
	Object.prototype.Int64 = function() { return this.$val.Int64(); };
	Object.ptr.prototype.Uint64 = function() {
		var o;
		o = this;
		return $internalize(o.object, $Uint64);
	};
	Object.prototype.Uint64 = function() { return this.$val.Uint64(); };
	Object.ptr.prototype.Float = function() {
		var o;
		o = this;
		return $parseFloat(o.object);
	};
	Object.prototype.Float = function() { return this.$val.Float(); };
	Object.ptr.prototype.Interface = function() {
		var o;
		o = this;
		return $internalize(o.object, $emptyInterface);
	};
	Object.prototype.Interface = function() { return this.$val.Interface(); };
	Object.ptr.prototype.Unsafe = function() {
		var o;
		o = this;
		return o.object;
	};
	Object.prototype.Unsafe = function() { return this.$val.Unsafe(); };
	Error.ptr.prototype.Error = function() {
		var err;
		err = this;
		return "JavaScript error: " + $internalize(err.Object.message, $String);
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	Error.ptr.prototype.Stack = function() {
		var err;
		err = this;
		return $internalize(err.Object.stack, $String);
	};
	Error.prototype.Stack = function() { return this.$val.Stack(); };
	MakeFunc = function(fn) {
		var fn;
		return $makeFunc(fn);
	};
	$pkg.MakeFunc = MakeFunc;
	Keys = function(o) {
		var a, i, o, s;
		if (o === null || o === undefined) {
			return sliceType$1.nil;
		}
		a = $global.Object.keys(o);
		s = $makeSlice(sliceType$1, $parseInt(a.length));
		i = 0;
		while (true) {
			if (!(i < $parseInt(a.length))) { break; }
			((i < 0 || i >= s.$length) ? ($throwRuntimeError("index out of range"), undefined) : s.$array[s.$offset + i] = $internalize(a[i], $String));
			i = i + (1) >> 0;
		}
		return s;
	};
	$pkg.Keys = Keys;
	init = function() {
		var e;
		e = new Error.ptr(null);
		$unused(e);
	};
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([$String, $emptyInterface], [], false)}, {prop: "Delete", name: "Delete", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [ptrType], false)}, {prop: "SetIndex", name: "SetIndex", pkg: "", typ: $funcType([$Int, $emptyInterface], [], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([$String, sliceType], [ptrType], true)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "New", name: "New", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Int64", name: "Int64", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Unsafe", name: "Unsafe", pkg: "", typ: $funcType([], [$Uintptr], false)}];
	ptrType$1.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Stack", name: "Stack", pkg: "", typ: $funcType([], [$String], false)}];
	Object.init("github.com/gopherjs/gopherjs/js", [{prop: "object", name: "object", anonymous: false, exported: false, typ: ptrType, tag: ""}]);
	Error.init("", [{prop: "Object", name: "Object", anonymous: true, exported: true, typ: ptrType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime/internal/sys"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime"] = (function() {
	var $pkg = {}, $init, js, sys, Error, TypeAssertionError, errorString, ptrType$4, init, throw$1;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	sys = $packages["runtime/internal/sys"];
	Error = $pkg.Error = $newType(8, $kindInterface, "runtime.Error", true, "runtime", true, null);
	TypeAssertionError = $pkg.TypeAssertionError = $newType(0, $kindStruct, "runtime.TypeAssertionError", true, "runtime", true, function(interfaceString_, concreteString_, assertedString_, missingMethod_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.interfaceString = "";
			this.concreteString = "";
			this.assertedString = "";
			this.missingMethod = "";
			return;
		}
		this.interfaceString = interfaceString_;
		this.concreteString = concreteString_;
		this.assertedString = assertedString_;
		this.missingMethod = missingMethod_;
	});
	errorString = $pkg.errorString = $newType(8, $kindString, "runtime.errorString", true, "runtime", false, null);
	ptrType$4 = $ptrType(TypeAssertionError);
	init = function() {
		var e, jsPkg;
		jsPkg = $packages[$externalize("github.com/gopherjs/gopherjs/js", $String)];
		$jsObjectPtr = jsPkg.Object.ptr;
		$jsErrorPtr = jsPkg.Error.ptr;
		$throwRuntimeError = throw$1;
		e = $ifaceNil;
		e = new TypeAssertionError.ptr("", "", "", "");
		$unused(e);
	};
	throw$1 = function(s) {
		var s;
		$panic(new errorString((s)));
	};
	TypeAssertionError.ptr.prototype.RuntimeError = function() {
	};
	TypeAssertionError.prototype.RuntimeError = function() { return this.$val.RuntimeError(); };
	TypeAssertionError.ptr.prototype.Error = function() {
		var e, inter;
		e = this;
		inter = e.interfaceString;
		if (inter === "") {
			inter = "interface";
		}
		if (e.concreteString === "") {
			return "interface conversion: " + inter + " is nil, not " + e.assertedString;
		}
		if (e.missingMethod === "") {
			return "interface conversion: " + inter + " is " + e.concreteString + ", not " + e.assertedString;
		}
		return "interface conversion: " + e.concreteString + " is not " + e.assertedString + ": missing method " + e.missingMethod;
	};
	TypeAssertionError.prototype.Error = function() { return this.$val.Error(); };
	errorString.prototype.RuntimeError = function() {
		var e;
		e = this.$val;
	};
	$ptrType(errorString).prototype.RuntimeError = function() { return new errorString(this.$get()).RuntimeError(); };
	errorString.prototype.Error = function() {
		var e;
		e = this.$val;
		return "runtime error: " + (e);
	};
	$ptrType(errorString).prototype.Error = function() { return new errorString(this.$get()).Error(); };
	ptrType$4.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	Error.init([{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}]);
	TypeAssertionError.init("runtime", [{prop: "interfaceString", name: "interfaceString", anonymous: false, exported: false, typ: $String, tag: ""}, {prop: "concreteString", name: "concreteString", anonymous: false, exported: false, typ: $String, tag: ""}, {prop: "assertedString", name: "assertedString", anonymous: false, exported: false, typ: $String, tag: ""}, {prop: "missingMethod", name: "missingMethod", anonymous: false, exported: false, typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sys.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["errors"] = (function() {
	var $pkg = {}, $init, errorString, ptrType, New;
	errorString = $pkg.errorString = $newType(0, $kindStruct, "errors.errorString", true, "errors", false, function(s_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.s = "";
			return;
		}
		this.s = s_;
	});
	ptrType = $ptrType(errorString);
	New = function(text) {
		var text;
		return new errorString.ptr(text);
	};
	$pkg.New = New;
	errorString.ptr.prototype.Error = function() {
		var e;
		e = this;
		return e.s;
	};
	errorString.prototype.Error = function() { return this.$val.Error(); };
	ptrType.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.init("errors", [{prop: "s", name: "s", anonymous: false, exported: false, typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["internal/race"] = (function() {
	var $pkg = {}, $init, Acquire, Release, ReleaseMerge, Disable, Enable;
	Acquire = function(addr) {
		var addr;
	};
	$pkg.Acquire = Acquire;
	Release = function(addr) {
		var addr;
	};
	$pkg.Release = Release;
	ReleaseMerge = function(addr) {
		var addr;
	};
	$pkg.ReleaseMerge = ReleaseMerge;
	Disable = function() {
	};
	$pkg.Disable = Disable;
	Enable = function() {
	};
	$pkg.Enable = Enable;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync/atomic"] = (function() {
	var $pkg = {}, $init, js, Value, noCopy, ptrType, ptrType$1, CompareAndSwapInt32, CompareAndSwapPointer, AddInt32, LoadPointer, StorePointer;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	Value = $pkg.Value = $newType(0, $kindStruct, "atomic.Value", true, "sync/atomic", true, function(noCopy_, v_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.noCopy = new noCopy.ptr();
			this.v = $ifaceNil;
			return;
		}
		this.noCopy = noCopy_;
		this.v = v_;
	});
	noCopy = $pkg.noCopy = $newType(0, $kindStruct, "atomic.noCopy", true, "sync/atomic", false, function() {
		this.$val = this;
		if (arguments.length === 0) {
			return;
		}
	});
	ptrType = $ptrType(Value);
	ptrType$1 = $ptrType(noCopy);
	CompareAndSwapInt32 = function(addr, old, new$1) {
		var addr, new$1, old;
		if (addr.$get() === old) {
			addr.$set(new$1);
			return true;
		}
		return false;
	};
	$pkg.CompareAndSwapInt32 = CompareAndSwapInt32;
	CompareAndSwapPointer = function(addr, old, new$1) {
		var addr, new$1, old;
		if (addr.$get() === old) {
			addr.$set(new$1);
			return true;
		}
		return false;
	};
	$pkg.CompareAndSwapPointer = CompareAndSwapPointer;
	AddInt32 = function(addr, delta) {
		var addr, delta, new$1;
		new$1 = addr.$get() + delta >> 0;
		addr.$set(new$1);
		return new$1;
	};
	$pkg.AddInt32 = AddInt32;
	LoadPointer = function(addr) {
		var addr;
		return addr.$get();
	};
	$pkg.LoadPointer = LoadPointer;
	StorePointer = function(addr, val) {
		var addr, val;
		addr.$set(val);
	};
	$pkg.StorePointer = StorePointer;
	Value.ptr.prototype.Load = function() {
		var v, x;
		x = $ifaceNil;
		v = this;
		x = v.v;
		return x;
	};
	Value.prototype.Load = function() { return this.$val.Load(); };
	Value.ptr.prototype.Store = function(x) {
		var v, x;
		v = this;
		if ($interfaceIsEqual(x, $ifaceNil)) {
			$panic(new $String("sync/atomic: store of nil value into Value"));
		}
		if (!($interfaceIsEqual(v.v, $ifaceNil)) && !(x.constructor === v.v.constructor)) {
			$panic(new $String("sync/atomic: store of inconsistently typed value into Value"));
		}
		v.v = x;
	};
	Value.prototype.Store = function(x) { return this.$val.Store(x); };
	noCopy.ptr.prototype.Lock = function() {
	};
	noCopy.prototype.Lock = function() { return this.$val.Lock(); };
	ptrType.methods = [{prop: "Load", name: "Load", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Store", name: "Store", pkg: "", typ: $funcType([$emptyInterface], [], false)}];
	ptrType$1.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}];
	Value.init("sync/atomic", [{prop: "noCopy", name: "noCopy", anonymous: false, exported: false, typ: noCopy, tag: ""}, {prop: "v", name: "v", anonymous: false, exported: false, typ: $emptyInterface, tag: ""}]);
	noCopy.init("", []);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync"] = (function() {
	var $pkg = {}, $init, js, race, runtime, atomic, Pool, Map, readOnly, entry, Mutex, Locker, poolLocalInternal, poolLocal, notifyList, RWMutex, rlocker, ptrType, sliceType, ptrType$1, chanType, sliceType$1, ptrType$3, ptrType$4, ptrType$5, ptrType$6, ptrType$7, sliceType$4, ptrType$8, ptrType$9, funcType, funcType$1, ptrType$15, mapType, ptrType$16, arrayType$2, semWaiters, expunged, allPools, runtime_registerPoolCleanup, runtime_Semacquire, runtime_SemacquireMutex, runtime_Semrelease, runtime_notifyListCheck, runtime_canSpin, runtime_nanotime, newEntry, throw$1, poolCleanup, init, indexLocal, init$1, runtime_doSpin;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	atomic = $packages["sync/atomic"];
	Pool = $pkg.Pool = $newType(0, $kindStruct, "sync.Pool", true, "sync", true, function(local_, localSize_, store_, New_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.local = 0;
			this.localSize = 0;
			this.store = sliceType$4.nil;
			this.New = $throwNilPointerError;
			return;
		}
		this.local = local_;
		this.localSize = localSize_;
		this.store = store_;
		this.New = New_;
	});
	Map = $pkg.Map = $newType(0, $kindStruct, "sync.Map", true, "sync", true, function(mu_, read_, dirty_, misses_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.mu = new Mutex.ptr(0, 0);
			this.read = new atomic.Value.ptr(new atomic.noCopy.ptr(), $ifaceNil);
			this.dirty = false;
			this.misses = 0;
			return;
		}
		this.mu = mu_;
		this.read = read_;
		this.dirty = dirty_;
		this.misses = misses_;
	});
	readOnly = $pkg.readOnly = $newType(0, $kindStruct, "sync.readOnly", true, "sync", false, function(m_, amended_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.m = false;
			this.amended = false;
			return;
		}
		this.m = m_;
		this.amended = amended_;
	});
	entry = $pkg.entry = $newType(0, $kindStruct, "sync.entry", true, "sync", false, function(p_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.p = 0;
			return;
		}
		this.p = p_;
	});
	Mutex = $pkg.Mutex = $newType(0, $kindStruct, "sync.Mutex", true, "sync", true, function(state_, sema_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.state = 0;
			this.sema = 0;
			return;
		}
		this.state = state_;
		this.sema = sema_;
	});
	Locker = $pkg.Locker = $newType(8, $kindInterface, "sync.Locker", true, "sync", true, null);
	poolLocalInternal = $pkg.poolLocalInternal = $newType(0, $kindStruct, "sync.poolLocalInternal", true, "sync", false, function(private$0_, shared_, Mutex_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.private$0 = $ifaceNil;
			this.shared = sliceType$4.nil;
			this.Mutex = new Mutex.ptr(0, 0);
			return;
		}
		this.private$0 = private$0_;
		this.shared = shared_;
		this.Mutex = Mutex_;
	});
	poolLocal = $pkg.poolLocal = $newType(0, $kindStruct, "sync.poolLocal", true, "sync", false, function(poolLocalInternal_, pad_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.poolLocalInternal = new poolLocalInternal.ptr($ifaceNil, sliceType$4.nil, new Mutex.ptr(0, 0));
			this.pad = arrayType$2.zero();
			return;
		}
		this.poolLocalInternal = poolLocalInternal_;
		this.pad = pad_;
	});
	notifyList = $pkg.notifyList = $newType(0, $kindStruct, "sync.notifyList", true, "sync", false, function(wait_, notify_, lock_, head_, tail_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.wait = 0;
			this.notify = 0;
			this.lock = 0;
			this.head = 0;
			this.tail = 0;
			return;
		}
		this.wait = wait_;
		this.notify = notify_;
		this.lock = lock_;
		this.head = head_;
		this.tail = tail_;
	});
	RWMutex = $pkg.RWMutex = $newType(0, $kindStruct, "sync.RWMutex", true, "sync", true, function(w_, writerSem_, readerSem_, readerCount_, readerWait_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.w = new Mutex.ptr(0, 0);
			this.writerSem = 0;
			this.readerSem = 0;
			this.readerCount = 0;
			this.readerWait = 0;
			return;
		}
		this.w = w_;
		this.writerSem = writerSem_;
		this.readerSem = readerSem_;
		this.readerCount = readerCount_;
		this.readerWait = readerWait_;
	});
	rlocker = $pkg.rlocker = $newType(0, $kindStruct, "sync.rlocker", true, "sync", false, function(w_, writerSem_, readerSem_, readerCount_, readerWait_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.w = new Mutex.ptr(0, 0);
			this.writerSem = 0;
			this.readerSem = 0;
			this.readerCount = 0;
			this.readerWait = 0;
			return;
		}
		this.w = w_;
		this.writerSem = writerSem_;
		this.readerSem = readerSem_;
		this.readerCount = readerCount_;
		this.readerWait = readerWait_;
	});
	ptrType = $ptrType(Pool);
	sliceType = $sliceType(ptrType);
	ptrType$1 = $ptrType($Uint32);
	chanType = $chanType($Bool, false, false);
	sliceType$1 = $sliceType(chanType);
	ptrType$3 = $ptrType($emptyInterface);
	ptrType$4 = $ptrType(entry);
	ptrType$5 = $ptrType($UnsafePointer);
	ptrType$6 = $ptrType($Int32);
	ptrType$7 = $ptrType(poolLocal);
	sliceType$4 = $sliceType($emptyInterface);
	ptrType$8 = $ptrType(rlocker);
	ptrType$9 = $ptrType(RWMutex);
	funcType = $funcType([], [$emptyInterface], false);
	funcType$1 = $funcType([$emptyInterface, $emptyInterface], [$Bool], false);
	ptrType$15 = $ptrType(Map);
	mapType = $mapType($emptyInterface, ptrType$4);
	ptrType$16 = $ptrType(Mutex);
	arrayType$2 = $arrayType($Uint8, 100);
	Pool.ptr.prototype.Get = function() {
		var _r, p, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; p = $f.p; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		/* */ if (p.store.$length === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (p.store.$length === 0) { */ case 1:
			/* */ if (!(p.New === $throwNilPointerError)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(p.New === $throwNilPointerError)) { */ case 3:
				_r = p.New(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
			/* } */ case 4:
			$s = -1; return $ifaceNil;
		/* } */ case 2:
		x$2 = (x = p.store, x$1 = p.store.$length - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + x$1]));
		p.store = $subslice(p.store, 0, (p.store.$length - 1 >> 0));
		$s = -1; return x$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Pool.ptr.prototype.Get }; } $f._r = _r; $f.p = p; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Pool.prototype.Get = function() { return this.$val.Get(); };
	Pool.ptr.prototype.Put = function(x) {
		var p, x;
		p = this;
		if ($interfaceIsEqual(x, $ifaceNil)) {
			return;
		}
		p.store = $append(p.store, x);
	};
	Pool.prototype.Put = function(x) { return this.$val.Put(x); };
	runtime_registerPoolCleanup = function(cleanup) {
		var cleanup;
	};
	runtime_Semacquire = function(s) {
		var _entry, _key, _r, ch, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _key = $f._key; _r = $f._r; ch = $f.ch; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ if (s.$get() === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (s.$get() === 0) { */ case 1:
			ch = new $Chan($Bool, 0);
			_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: $append((_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil), ch) };
			_r = $recv(ch); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r[0];
		/* } */ case 2:
		s.$set(s.$get() - (1) >>> 0);
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: runtime_Semacquire }; } $f._entry = _entry; $f._key = _key; $f._r = _r; $f.ch = ch; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_SemacquireMutex = function(s, lifo) {
		var lifo, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; lifo = $f.lifo; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = runtime_Semacquire(s); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: runtime_SemacquireMutex }; } $f.lifo = lifo; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_Semrelease = function(s, handoff) {
		var _entry, _key, ch, handoff, s, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _key = $f._key; ch = $f.ch; handoff = $f.handoff; s = $f.s; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s.$set(s.$get() + (1) >>> 0);
		w = (_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil);
		if (w.$length === 0) {
			$s = -1; return;
		}
		ch = (0 >= w.$length ? ($throwRuntimeError("index out of range"), undefined) : w.$array[w.$offset + 0]);
		w = $subslice(w, 1);
		_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: w };
		if (w.$length === 0) {
			delete semWaiters[ptrType$1.keyFor(s)];
		}
		$r = $send(ch, true); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: runtime_Semrelease }; } $f._entry = _entry; $f._key = _key; $f.ch = ch; $f.handoff = handoff; $f.s = s; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_notifyListCheck = function(size) {
		var size;
	};
	runtime_canSpin = function(i) {
		var i;
		return false;
	};
	runtime_nanotime = function() {
		return $mul64($internalize(new ($global.Date)().getTime(), $Int64), new $Int64(0, 1000000));
	};
	newEntry = function(i) {
		var i, i$24ptr;
		return new entry.ptr(((i$24ptr || (i$24ptr = new ptrType$3(function() { return i; }, function($v) { i = $v; })))));
	};
	Map.ptr.prototype.Load = function(key) {
		var _entry, _entry$1, _entry$2, _tmp, _tmp$1, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, e, key, m, ok, read, value, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; e = $f.e; key = $f.key; m = $f.m; ok = $f.ok; read = $f.read; value = $f.value; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		value = $ifaceNil;
		ok = false;
		m = this;
		_tuple = $assertType(m.read.Load(), readOnly, true);
		read = $clone(_tuple[0], readOnly);
		_tuple$1 = (_entry = read.m[$emptyInterface.keyFor(key)], _entry !== undefined ? [_entry.v, true] : [ptrType$4.nil, false]);
		e = _tuple$1[0];
		ok = _tuple$1[1];
		/* */ if (!ok && read.amended) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!ok && read.amended) { */ case 1:
			$r = m.mu.Lock(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_tuple$2 = $assertType(m.read.Load(), readOnly, true);
			readOnly.copy(read, _tuple$2[0]);
			_tuple$3 = (_entry$1 = read.m[$emptyInterface.keyFor(key)], _entry$1 !== undefined ? [_entry$1.v, true] : [ptrType$4.nil, false]);
			e = _tuple$3[0];
			ok = _tuple$3[1];
			if (!ok && read.amended) {
				_tuple$4 = (_entry$2 = m.dirty[$emptyInterface.keyFor(key)], _entry$2 !== undefined ? [_entry$2.v, true] : [ptrType$4.nil, false]);
				e = _tuple$4[0];
				ok = _tuple$4[1];
				m.missLocked();
			}
			$r = m.mu.Unlock(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		if (!ok) {
			_tmp = $ifaceNil;
			_tmp$1 = false;
			value = _tmp;
			ok = _tmp$1;
			$s = -1; return [value, ok];
		}
		_tuple$5 = e.load();
		value = _tuple$5[0];
		ok = _tuple$5[1];
		$s = -1; return [value, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Map.ptr.prototype.Load }; } $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f.e = e; $f.key = key; $f.m = m; $f.ok = ok; $f.read = read; $f.value = value; $f.$s = $s; $f.$r = $r; return $f;
	};
	Map.prototype.Load = function(key) { return this.$val.Load(key); };
	entry.ptr.prototype.load = function() {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, e, ok, p, value;
		value = $ifaceNil;
		ok = false;
		e = this;
		p = atomic.LoadPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))));
		if (p === 0 || p === expunged) {
			_tmp = $ifaceNil;
			_tmp$1 = false;
			value = _tmp;
			ok = _tmp$1;
			return [value, ok];
		}
		_tmp$2 = (p).$get();
		_tmp$3 = true;
		value = _tmp$2;
		ok = _tmp$3;
		return [value, ok];
	};
	entry.prototype.load = function() { return this.$val.load(); };
	Map.ptr.prototype.Store = function(key, value) {
		var _entry, _entry$1, _entry$2, _key, _key$1, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, e, e$1, e$2, key, m, ok, ok$1, ok$2, read, value, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _key = $f._key; _key$1 = $f._key$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; e = $f.e; e$1 = $f.e$1; e$2 = $f.e$2; key = $f.key; m = $f.m; ok = $f.ok; ok$1 = $f.ok$1; ok$2 = $f.ok$2; read = $f.read; value = $f.value; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		value = [value];
		m = this;
		_tuple = $assertType(m.read.Load(), readOnly, true);
		read = $clone(_tuple[0], readOnly);
		_tuple$1 = (_entry = read.m[$emptyInterface.keyFor(key)], _entry !== undefined ? [_entry.v, true] : [ptrType$4.nil, false]);
		e = _tuple$1[0];
		ok = _tuple$1[1];
		if (ok && e.tryStore((value.$ptr || (value.$ptr = new ptrType$3(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, value))))) {
			$s = -1; return;
		}
		$r = m.mu.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_tuple$2 = $assertType(m.read.Load(), readOnly, true);
		readOnly.copy(read, _tuple$2[0]);
		_tuple$3 = (_entry$1 = read.m[$emptyInterface.keyFor(key)], _entry$1 !== undefined ? [_entry$1.v, true] : [ptrType$4.nil, false]);
		e$1 = _tuple$3[0];
		ok$1 = _tuple$3[1];
		if (ok$1) {
			if (e$1.unexpungeLocked()) {
				_key = key; (m.dirty || $throwRuntimeError("assignment to entry in nil map"))[$emptyInterface.keyFor(_key)] = { k: _key, v: e$1 };
			}
			e$1.storeLocked((value.$ptr || (value.$ptr = new ptrType$3(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, value))));
		} else {
			_tuple$4 = (_entry$2 = m.dirty[$emptyInterface.keyFor(key)], _entry$2 !== undefined ? [_entry$2.v, true] : [ptrType$4.nil, false]);
			e$2 = _tuple$4[0];
			ok$2 = _tuple$4[1];
			if (ok$2) {
				e$2.storeLocked((value.$ptr || (value.$ptr = new ptrType$3(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, value))));
			} else {
				if (!read.amended) {
					m.dirtyLocked();
					m.read.Store((x = new readOnly.ptr(read.m, true), new x.constructor.elem(x)));
				}
				_key$1 = key; (m.dirty || $throwRuntimeError("assignment to entry in nil map"))[$emptyInterface.keyFor(_key$1)] = { k: _key$1, v: newEntry(value[0]) };
			}
		}
		$r = m.mu.Unlock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Map.ptr.prototype.Store }; } $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._key = _key; $f._key$1 = _key$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f.e = e; $f.e$1 = e$1; $f.e$2 = e$2; $f.key = key; $f.m = m; $f.ok = ok; $f.ok$1 = ok$1; $f.ok$2 = ok$2; $f.read = read; $f.value = value; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Map.prototype.Store = function(key, value) { return this.$val.Store(key, value); };
	entry.ptr.prototype.tryStore = function(i) {
		var e, i, p;
		e = this;
		p = atomic.LoadPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))));
		if (p === expunged) {
			return false;
		}
		while (true) {
			if (atomic.CompareAndSwapPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))), p, (i))) {
				return true;
			}
			p = atomic.LoadPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))));
			if (p === expunged) {
				return false;
			}
		}
	};
	entry.prototype.tryStore = function(i) { return this.$val.tryStore(i); };
	entry.ptr.prototype.unexpungeLocked = function() {
		var e, wasExpunged;
		wasExpunged = false;
		e = this;
		wasExpunged = atomic.CompareAndSwapPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))), expunged, 0);
		return wasExpunged;
	};
	entry.prototype.unexpungeLocked = function() { return this.$val.unexpungeLocked(); };
	entry.ptr.prototype.storeLocked = function(i) {
		var e, i;
		e = this;
		atomic.StorePointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))), (i));
	};
	entry.prototype.storeLocked = function(i) { return this.$val.storeLocked(i); };
	Map.ptr.prototype.LoadOrStore = function(key, value) {
		var _entry, _entry$1, _entry$2, _key, _key$1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, actual, actual$1, e, e$1, e$2, key, loaded, loaded$1, m, ok, ok$1, ok$2, ok$3, read, value, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _key = $f._key; _key$1 = $f._key$1; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; actual = $f.actual; actual$1 = $f.actual$1; e = $f.e; e$1 = $f.e$1; e$2 = $f.e$2; key = $f.key; loaded = $f.loaded; loaded$1 = $f.loaded$1; m = $f.m; ok = $f.ok; ok$1 = $f.ok$1; ok$2 = $f.ok$2; ok$3 = $f.ok$3; read = $f.read; value = $f.value; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		actual = $ifaceNil;
		loaded = false;
		m = this;
		_tuple = $assertType(m.read.Load(), readOnly, true);
		read = $clone(_tuple[0], readOnly);
		_tuple$1 = (_entry = read.m[$emptyInterface.keyFor(key)], _entry !== undefined ? [_entry.v, true] : [ptrType$4.nil, false]);
		e = _tuple$1[0];
		ok = _tuple$1[1];
		if (ok) {
			_tuple$2 = e.tryLoadOrStore(value);
			actual$1 = _tuple$2[0];
			loaded$1 = _tuple$2[1];
			ok$1 = _tuple$2[2];
			if (ok$1) {
				_tmp = actual$1;
				_tmp$1 = loaded$1;
				actual = _tmp;
				loaded = _tmp$1;
				$s = -1; return [actual, loaded];
			}
		}
		$r = m.mu.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_tuple$3 = $assertType(m.read.Load(), readOnly, true);
		readOnly.copy(read, _tuple$3[0]);
		_tuple$4 = (_entry$1 = read.m[$emptyInterface.keyFor(key)], _entry$1 !== undefined ? [_entry$1.v, true] : [ptrType$4.nil, false]);
		e$1 = _tuple$4[0];
		ok$2 = _tuple$4[1];
		if (ok$2) {
			if (e$1.unexpungeLocked()) {
				_key = key; (m.dirty || $throwRuntimeError("assignment to entry in nil map"))[$emptyInterface.keyFor(_key)] = { k: _key, v: e$1 };
			}
			_tuple$5 = e$1.tryLoadOrStore(value);
			actual = _tuple$5[0];
			loaded = _tuple$5[1];
		} else {
			_tuple$6 = (_entry$2 = m.dirty[$emptyInterface.keyFor(key)], _entry$2 !== undefined ? [_entry$2.v, true] : [ptrType$4.nil, false]);
			e$2 = _tuple$6[0];
			ok$3 = _tuple$6[1];
			if (ok$3) {
				_tuple$7 = e$2.tryLoadOrStore(value);
				actual = _tuple$7[0];
				loaded = _tuple$7[1];
				m.missLocked();
			} else {
				if (!read.amended) {
					m.dirtyLocked();
					m.read.Store((x = new readOnly.ptr(read.m, true), new x.constructor.elem(x)));
				}
				_key$1 = key; (m.dirty || $throwRuntimeError("assignment to entry in nil map"))[$emptyInterface.keyFor(_key$1)] = { k: _key$1, v: newEntry(value) };
				_tmp$2 = value;
				_tmp$3 = false;
				actual = _tmp$2;
				loaded = _tmp$3;
			}
		}
		$r = m.mu.Unlock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_tmp$4 = actual;
		_tmp$5 = loaded;
		actual = _tmp$4;
		loaded = _tmp$5;
		$s = -1; return [actual, loaded];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Map.ptr.prototype.LoadOrStore }; } $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._key = _key; $f._key$1 = _key$1; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f.actual = actual; $f.actual$1 = actual$1; $f.e = e; $f.e$1 = e$1; $f.e$2 = e$2; $f.key = key; $f.loaded = loaded; $f.loaded$1 = loaded$1; $f.m = m; $f.ok = ok; $f.ok$1 = ok$1; $f.ok$2 = ok$2; $f.ok$3 = ok$3; $f.read = read; $f.value = value; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Map.prototype.LoadOrStore = function(key, value) { return this.$val.LoadOrStore(key, value); };
	entry.ptr.prototype.tryLoadOrStore = function(i) {
		var _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, actual, e, i, ic, ic$24ptr, loaded, ok, p;
		actual = $ifaceNil;
		loaded = false;
		ok = false;
		e = this;
		p = atomic.LoadPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))));
		if (p === expunged) {
			_tmp = $ifaceNil;
			_tmp$1 = false;
			_tmp$2 = false;
			actual = _tmp;
			loaded = _tmp$1;
			ok = _tmp$2;
			return [actual, loaded, ok];
		}
		if (!(p === 0)) {
			_tmp$3 = (p).$get();
			_tmp$4 = true;
			_tmp$5 = true;
			actual = _tmp$3;
			loaded = _tmp$4;
			ok = _tmp$5;
			return [actual, loaded, ok];
		}
		ic = i;
		while (true) {
			if (atomic.CompareAndSwapPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))), 0, ((ic$24ptr || (ic$24ptr = new ptrType$3(function() { return ic; }, function($v) { ic = $v; })))))) {
				_tmp$6 = i;
				_tmp$7 = false;
				_tmp$8 = true;
				actual = _tmp$6;
				loaded = _tmp$7;
				ok = _tmp$8;
				return [actual, loaded, ok];
			}
			p = atomic.LoadPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))));
			if (p === expunged) {
				_tmp$9 = $ifaceNil;
				_tmp$10 = false;
				_tmp$11 = false;
				actual = _tmp$9;
				loaded = _tmp$10;
				ok = _tmp$11;
				return [actual, loaded, ok];
			}
			if (!(p === 0)) {
				_tmp$12 = (p).$get();
				_tmp$13 = true;
				_tmp$14 = true;
				actual = _tmp$12;
				loaded = _tmp$13;
				ok = _tmp$14;
				return [actual, loaded, ok];
			}
		}
	};
	entry.prototype.tryLoadOrStore = function(i) { return this.$val.tryLoadOrStore(i); };
	Map.ptr.prototype.Delete = function(key) {
		var _entry, _entry$1, _tuple, _tuple$1, _tuple$2, _tuple$3, e, key, m, ok, read, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _entry$1 = $f._entry$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; e = $f.e; key = $f.key; m = $f.m; ok = $f.ok; read = $f.read; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		_tuple = $assertType(m.read.Load(), readOnly, true);
		read = $clone(_tuple[0], readOnly);
		_tuple$1 = (_entry = read.m[$emptyInterface.keyFor(key)], _entry !== undefined ? [_entry.v, true] : [ptrType$4.nil, false]);
		e = _tuple$1[0];
		ok = _tuple$1[1];
		/* */ if (!ok && read.amended) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!ok && read.amended) { */ case 1:
			$r = m.mu.Lock(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_tuple$2 = $assertType(m.read.Load(), readOnly, true);
			readOnly.copy(read, _tuple$2[0]);
			_tuple$3 = (_entry$1 = read.m[$emptyInterface.keyFor(key)], _entry$1 !== undefined ? [_entry$1.v, true] : [ptrType$4.nil, false]);
			e = _tuple$3[0];
			ok = _tuple$3[1];
			if (!ok && read.amended) {
				delete m.dirty[$emptyInterface.keyFor(key)];
			}
			$r = m.mu.Unlock(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		if (ok) {
			e.delete$();
		}
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Map.ptr.prototype.Delete }; } $f._entry = _entry; $f._entry$1 = _entry$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f.e = e; $f.key = key; $f.m = m; $f.ok = ok; $f.read = read; $f.$s = $s; $f.$r = $r; return $f;
	};
	Map.prototype.Delete = function(key) { return this.$val.Delete(key); };
	entry.ptr.prototype.delete$ = function() {
		var e, hadValue, p;
		hadValue = false;
		e = this;
		while (true) {
			p = atomic.LoadPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))));
			if (p === 0 || p === expunged) {
				hadValue = false;
				return hadValue;
			}
			if (atomic.CompareAndSwapPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))), p, 0)) {
				hadValue = true;
				return hadValue;
			}
		}
	};
	entry.prototype.delete$ = function() { return this.$val.delete$(); };
	Map.ptr.prototype.Range = function(f) {
		var _entry, _i, _keys, _r, _ref, _tuple, _tuple$1, _tuple$2, e, f, k, m, ok, read, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _i = $f._i; _keys = $f._keys; _r = $f._r; _ref = $f._ref; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; e = $f.e; f = $f.f; k = $f.k; m = $f.m; ok = $f.ok; read = $f.read; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		_tuple = $assertType(m.read.Load(), readOnly, true);
		read = $clone(_tuple[0], readOnly);
		/* */ if (read.amended) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (read.amended) { */ case 1:
			$r = m.mu.Lock(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_tuple$1 = $assertType(m.read.Load(), readOnly, true);
			readOnly.copy(read, _tuple$1[0]);
			if (read.amended) {
				readOnly.copy(read, new readOnly.ptr(m.dirty, false));
				m.read.Store(new read.constructor.elem(read));
				m.dirty = false;
				m.misses = 0;
			}
			$r = m.mu.Unlock(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		_ref = read.m;
		_i = 0;
		_keys = $keys(_ref);
		/* while (true) { */ case 5:
			/* if (!(_i < _keys.length)) { break; } */ if(!(_i < _keys.length)) { $s = 6; continue; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				/* continue; */ $s = 5; continue;
			}
			k = _entry.k;
			e = _entry.v;
			_tuple$2 = e.load();
			v = _tuple$2[0];
			ok = _tuple$2[1];
			/* */ if (!ok) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!ok) { */ case 7:
				_i++;
				/* continue; */ $s = 5; continue;
			/* } */ case 8:
			_r = f(k, v); /* */ $s = 11; case 11: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (!_r) { $s = 9; continue; }
			/* */ $s = 10; continue;
			/* if (!_r) { */ case 9:
				/* break; */ $s = 6; continue;
			/* } */ case 10:
			_i++;
		/* } */ $s = 5; continue; case 6:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Map.ptr.prototype.Range }; } $f._entry = _entry; $f._i = _i; $f._keys = _keys; $f._r = _r; $f._ref = _ref; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.e = e; $f.f = f; $f.k = k; $f.m = m; $f.ok = ok; $f.read = read; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Map.prototype.Range = function(f) { return this.$val.Range(f); };
	Map.ptr.prototype.missLocked = function() {
		var m, x;
		m = this;
		m.misses = m.misses + (1) >> 0;
		if (m.misses < $keys(m.dirty).length) {
			return;
		}
		m.read.Store((x = new readOnly.ptr(m.dirty, false), new x.constructor.elem(x)));
		m.dirty = false;
		m.misses = 0;
	};
	Map.prototype.missLocked = function() { return this.$val.missLocked(); };
	Map.ptr.prototype.dirtyLocked = function() {
		var _entry, _i, _key, _keys, _ref, _tuple, e, k, m, read, x;
		m = this;
		if (!(m.dirty === false)) {
			return;
		}
		_tuple = $assertType(m.read.Load(), readOnly, true);
		read = $clone(_tuple[0], readOnly);
		m.dirty = (x = $keys(read.m).length, ((x < 0 || x > 2147483647) ? $throwRuntimeError("makemap: size out of range") : {}));
		_ref = read.m;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			k = _entry.k;
			e = _entry.v;
			if (!e.tryExpungeLocked()) {
				_key = k; (m.dirty || $throwRuntimeError("assignment to entry in nil map"))[$emptyInterface.keyFor(_key)] = { k: _key, v: e };
			}
			_i++;
		}
	};
	Map.prototype.dirtyLocked = function() { return this.$val.dirtyLocked(); };
	entry.ptr.prototype.tryExpungeLocked = function() {
		var e, isExpunged, p;
		isExpunged = false;
		e = this;
		p = atomic.LoadPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))));
		while (true) {
			if (!(p === 0)) { break; }
			if (atomic.CompareAndSwapPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))), 0, expunged)) {
				isExpunged = true;
				return isExpunged;
			}
			p = atomic.LoadPointer((e.$ptr_p || (e.$ptr_p = new ptrType$5(function() { return this.$target.p; }, function($v) { this.$target.p = $v; }, e))));
		}
		isExpunged = p === expunged;
		return isExpunged;
	};
	entry.prototype.tryExpungeLocked = function() { return this.$val.tryExpungeLocked(); };
	throw$1 = function() {
		$throwRuntimeError("native function not implemented: sync.throw");
	};
	Mutex.ptr.prototype.Lock = function() {
		var awoke, delta, iter, m, new$1, old, queueLifo, starving, waitStartTime, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; awoke = $f.awoke; delta = $f.delta; iter = $f.iter; m = $f.m; new$1 = $f.new$1; old = $f.old; queueLifo = $f.queueLifo; starving = $f.starving; waitStartTime = $f.waitStartTime; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), 0, 1)) {
			if (false) {
				race.Acquire((m));
			}
			$s = -1; return;
		}
		waitStartTime = new $Int64(0, 0);
		starving = false;
		awoke = false;
		iter = 0;
		old = m.state;
		/* while (true) { */ case 1:
			/* */ if (((old & 5) === 1) && runtime_canSpin(iter)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (((old & 5) === 1) && runtime_canSpin(iter)) { */ case 3:
				if (!awoke && ((old & 2) === 0) && !(((old >> 3 >> 0) === 0)) && atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, old | 2)) {
					awoke = true;
				}
				runtime_doSpin();
				iter = iter + (1) >> 0;
				old = m.state;
				/* continue; */ $s = 1; continue;
			/* } */ case 4:
			new$1 = old;
			if ((old & 4) === 0) {
				new$1 = new$1 | (1);
			}
			if (!(((old & 5) === 0))) {
				new$1 = new$1 + (8) >> 0;
			}
			if (starving && !(((old & 1) === 0))) {
				new$1 = new$1 | (4);
			}
			if (awoke) {
				if ((new$1 & 2) === 0) {
					$panic(new $String("sync: inconsistent mutex state"));
				}
				new$1 = (new$1 & ~(2)) >> 0;
			}
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 5:
				if ((old & 5) === 0) {
					/* break; */ $s = 2; continue;
				}
				queueLifo = !((waitStartTime.$high === 0 && waitStartTime.$low === 0));
				if ((waitStartTime.$high === 0 && waitStartTime.$low === 0)) {
					waitStartTime = runtime_nanotime();
				}
				$r = runtime_SemacquireMutex((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m))), queueLifo); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				starving = starving || (x = (x$1 = runtime_nanotime(), new $Int64(x$1.$high - waitStartTime.$high, x$1.$low - waitStartTime.$low)), (x.$high > 0 || (x.$high === 0 && x.$low > 1000000)));
				old = m.state;
				if (!(((old & 4) === 0))) {
					if (!(((old & 3) === 0)) || ((old >> 3 >> 0) === 0)) {
						$panic(new $String("sync: inconsistent mutex state"));
					}
					delta = -7;
					if (!starving || ((old >> 3 >> 0) === 1)) {
						delta = delta - (4) >> 0;
					}
					atomic.AddInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), delta);
					/* break; */ $s = 2; continue;
				}
				awoke = true;
				iter = 0;
				$s = 7; continue;
			/* } else { */ case 6:
				old = m.state;
			/* } */ case 7:
		/* } */ $s = 1; continue; case 2:
		if (false) {
			race.Acquire((m));
		}
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Lock }; } $f.awoke = awoke; $f.delta = delta; $f.iter = iter; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.queueLifo = queueLifo; $f.starving = starving; $f.waitStartTime = waitStartTime; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.ptr.prototype.Unlock = function() {
		var m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (false) {
			$unused(m.state);
			race.Release((m));
		}
		new$1 = atomic.AddInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), -1);
		if ((((new$1 + 1 >> 0)) & 1) === 0) {
			$panic(new $String("sync: unlock of unlocked mutex"));
		}
		/* */ if ((new$1 & 4) === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((new$1 & 4) === 0) { */ case 1:
			old = new$1;
			/* while (true) { */ case 4:
				if (((old >> 3 >> 0) === 0) || !(((old & 7) === 0))) {
					$s = -1; return;
				}
				new$1 = ((old - 8 >> 0)) | 2;
				/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$6(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 6:
					$r = runtime_Semrelease((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m))), false); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = -1; return;
				/* } */ case 7:
				old = m.state;
			/* } */ $s = 4; continue; case 5:
			$s = 3; continue;
		/* } else { */ case 2:
			$r = runtime_Semrelease((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m))), true); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Unlock }; } $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	poolCleanup = function() {
		var _i, _i$1, _ref, _ref$1, i, i$1, j, l, p, x;
		_ref = allPools;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= allPools.$length) ? ($throwRuntimeError("index out of range"), undefined) : allPools.$array[allPools.$offset + i] = ptrType.nil);
			i$1 = 0;
			while (true) {
				if (!(i$1 < ((p.localSize >> 0)))) { break; }
				l = indexLocal(p.local, i$1);
				l.poolLocalInternal.private$0 = $ifaceNil;
				_ref$1 = l.poolLocalInternal.shared;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					j = _i$1;
					(x = l.poolLocalInternal.shared, ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j] = $ifaceNil));
					_i$1++;
				}
				l.poolLocalInternal.shared = sliceType$4.nil;
				i$1 = i$1 + (1) >> 0;
			}
			p.local = 0;
			p.localSize = 0;
			_i++;
		}
		allPools = new sliceType([]);
	};
	init = function() {
		runtime_registerPoolCleanup(poolCleanup);
	};
	indexLocal = function(l, i) {
		var i, l, lp;
		lp = (((l) + ($imul(((i >>> 0)), 128) >>> 0) >>> 0));
		return ($pointerOfStructConversion(lp, ptrType$7));
	};
	init$1 = function() {
		var n;
		n = new notifyList.ptr(0, 0, 0, 0, 0);
		runtime_notifyListCheck(20);
	};
	runtime_doSpin = function() {
		$throwRuntimeError("native function not implemented: sync.runtime_doSpin");
	};
	RWMutex.ptr.prototype.RLock = function() {
		var rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			$unused(rw.w.state);
			race.Disable();
		}
		/* */ if (atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$6(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1) < 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$6(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1) < 0) { */ case 1:
			$r = runtime_Semacquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw)))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		if (false) {
			race.Enable();
			race.Acquire(((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw)))));
		}
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.RLock }; } $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.RLock = function() { return this.$val.RLock(); };
	RWMutex.ptr.prototype.RUnlock = function() {
		var r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			$unused(rw.w.state);
			race.ReleaseMerge(((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw)))));
			race.Disable();
		}
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$6(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), -1);
		/* */ if (r < 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (r < 0) { */ case 1:
			if (((r + 1 >> 0) === 0) || ((r + 1 >> 0) === -1073741824)) {
				race.Enable();
				throw$1("sync: RUnlock of unlocked RWMutex");
			}
			/* */ if (atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$6(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), -1) === 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$6(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), -1) === 0) { */ case 3:
				$r = runtime_Semrelease((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))), false); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
		/* } */ case 2:
		if (false) {
			race.Enable();
		}
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.RUnlock }; } $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.RUnlock = function() { return this.$val.RUnlock(); };
	RWMutex.ptr.prototype.Lock = function() {
		var r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			$unused(rw.w.state);
			race.Disable();
		}
		$r = rw.w.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$6(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), -1073741824) + 1073741824 >> 0;
		/* */ if (!((r === 0)) && !((atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$6(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), r) === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((r === 0)) && !((atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$6(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), r) === 0))) { */ case 2:
			$r = runtime_Semacquire((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw)))); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		if (false) {
			race.Enable();
			race.Acquire(((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw)))));
			race.Acquire(((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw)))));
		}
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.Lock }; } $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.Lock = function() { return this.$val.Lock(); };
	RWMutex.ptr.prototype.Unlock = function() {
		var i, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; i = $f.i; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			$unused(rw.w.state);
			race.Release(((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw)))));
			race.Release(((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw)))));
			race.Disable();
		}
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$6(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1073741824);
		if (r >= 1073741824) {
			race.Enable();
			throw$1("sync: Unlock of unlocked RWMutex");
		}
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < ((r >> 0)))) { break; } */ if(!(i < ((r >> 0)))) { $s = 2; continue; }
			$r = runtime_Semrelease((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))), false); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$r = rw.w.Unlock(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (false) {
			race.Enable();
		}
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.Unlock }; } $f.i = i; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	RWMutex.ptr.prototype.RLocker = function() {
		var rw;
		rw = this;
		return ($pointerOfStructConversion(rw, ptrType$8));
	};
	RWMutex.prototype.RLocker = function() { return this.$val.RLocker(); };
	rlocker.ptr.prototype.Lock = function() {
		var r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		$r = ($pointerOfStructConversion(r, ptrType$9)).RLock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rlocker.ptr.prototype.Lock }; } $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	rlocker.prototype.Lock = function() { return this.$val.Lock(); };
	rlocker.ptr.prototype.Unlock = function() {
		var r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		$r = ($pointerOfStructConversion(r, ptrType$9)).RUnlock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rlocker.ptr.prototype.Unlock }; } $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	rlocker.prototype.Unlock = function() { return this.$val.Unlock(); };
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Put", name: "Put", pkg: "", typ: $funcType([$emptyInterface], [], false)}, {prop: "getSlow", name: "getSlow", pkg: "sync", typ: $funcType([], [$emptyInterface], false)}, {prop: "pin", name: "pin", pkg: "sync", typ: $funcType([], [ptrType$7], false)}, {prop: "pinSlow", name: "pinSlow", pkg: "sync", typ: $funcType([], [ptrType$7], false)}];
	ptrType$15.methods = [{prop: "Load", name: "Load", pkg: "", typ: $funcType([$emptyInterface], [$emptyInterface, $Bool], false)}, {prop: "Store", name: "Store", pkg: "", typ: $funcType([$emptyInterface, $emptyInterface], [], false)}, {prop: "LoadOrStore", name: "LoadOrStore", pkg: "", typ: $funcType([$emptyInterface, $emptyInterface], [$emptyInterface, $Bool], false)}, {prop: "Delete", name: "Delete", pkg: "", typ: $funcType([$emptyInterface], [], false)}, {prop: "Range", name: "Range", pkg: "", typ: $funcType([funcType$1], [], false)}, {prop: "missLocked", name: "missLocked", pkg: "sync", typ: $funcType([], [], false)}, {prop: "dirtyLocked", name: "dirtyLocked", pkg: "sync", typ: $funcType([], [], false)}];
	ptrType$4.methods = [{prop: "load", name: "load", pkg: "sync", typ: $funcType([], [$emptyInterface, $Bool], false)}, {prop: "tryStore", name: "tryStore", pkg: "sync", typ: $funcType([ptrType$3], [$Bool], false)}, {prop: "unexpungeLocked", name: "unexpungeLocked", pkg: "sync", typ: $funcType([], [$Bool], false)}, {prop: "storeLocked", name: "storeLocked", pkg: "sync", typ: $funcType([ptrType$3], [], false)}, {prop: "tryLoadOrStore", name: "tryLoadOrStore", pkg: "sync", typ: $funcType([$emptyInterface], [$emptyInterface, $Bool, $Bool], false)}, {prop: "delete$", name: "delete", pkg: "sync", typ: $funcType([], [$Bool], false)}, {prop: "tryExpungeLocked", name: "tryExpungeLocked", pkg: "sync", typ: $funcType([], [$Bool], false)}];
	ptrType$16.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	ptrType$9.methods = [{prop: "RLock", name: "RLock", pkg: "", typ: $funcType([], [], false)}, {prop: "RUnlock", name: "RUnlock", pkg: "", typ: $funcType([], [], false)}, {prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}, {prop: "RLocker", name: "RLocker", pkg: "", typ: $funcType([], [Locker], false)}];
	ptrType$8.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	Pool.init("sync", [{prop: "local", name: "local", anonymous: false, exported: false, typ: $UnsafePointer, tag: ""}, {prop: "localSize", name: "localSize", anonymous: false, exported: false, typ: $Uintptr, tag: ""}, {prop: "store", name: "store", anonymous: false, exported: false, typ: sliceType$4, tag: ""}, {prop: "New", name: "New", anonymous: false, exported: true, typ: funcType, tag: ""}]);
	Map.init("sync", [{prop: "mu", name: "mu", anonymous: false, exported: false, typ: Mutex, tag: ""}, {prop: "read", name: "read", anonymous: false, exported: false, typ: atomic.Value, tag: ""}, {prop: "dirty", name: "dirty", anonymous: false, exported: false, typ: mapType, tag: ""}, {prop: "misses", name: "misses", anonymous: false, exported: false, typ: $Int, tag: ""}]);
	readOnly.init("sync", [{prop: "m", name: "m", anonymous: false, exported: false, typ: mapType, tag: ""}, {prop: "amended", name: "amended", anonymous: false, exported: false, typ: $Bool, tag: ""}]);
	entry.init("sync", [{prop: "p", name: "p", anonymous: false, exported: false, typ: $UnsafePointer, tag: ""}]);
	Mutex.init("sync", [{prop: "state", name: "state", anonymous: false, exported: false, typ: $Int32, tag: ""}, {prop: "sema", name: "sema", anonymous: false, exported: false, typ: $Uint32, tag: ""}]);
	Locker.init([{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}]);
	poolLocalInternal.init("sync", [{prop: "private$0", name: "private", anonymous: false, exported: false, typ: $emptyInterface, tag: ""}, {prop: "shared", name: "shared", anonymous: false, exported: false, typ: sliceType$4, tag: ""}, {prop: "Mutex", name: "Mutex", anonymous: true, exported: true, typ: Mutex, tag: ""}]);
	poolLocal.init("sync", [{prop: "poolLocalInternal", name: "poolLocalInternal", anonymous: true, exported: false, typ: poolLocalInternal, tag: ""}, {prop: "pad", name: "pad", anonymous: false, exported: false, typ: arrayType$2, tag: ""}]);
	notifyList.init("sync", [{prop: "wait", name: "wait", anonymous: false, exported: false, typ: $Uint32, tag: ""}, {prop: "notify", name: "notify", anonymous: false, exported: false, typ: $Uint32, tag: ""}, {prop: "lock", name: "lock", anonymous: false, exported: false, typ: $Uintptr, tag: ""}, {prop: "head", name: "head", anonymous: false, exported: false, typ: $UnsafePointer, tag: ""}, {prop: "tail", name: "tail", anonymous: false, exported: false, typ: $UnsafePointer, tag: ""}]);
	RWMutex.init("sync", [{prop: "w", name: "w", anonymous: false, exported: false, typ: Mutex, tag: ""}, {prop: "writerSem", name: "writerSem", anonymous: false, exported: false, typ: $Uint32, tag: ""}, {prop: "readerSem", name: "readerSem", anonymous: false, exported: false, typ: $Uint32, tag: ""}, {prop: "readerCount", name: "readerCount", anonymous: false, exported: false, typ: $Int32, tag: ""}, {prop: "readerWait", name: "readerWait", anonymous: false, exported: false, typ: $Int32, tag: ""}]);
	rlocker.init("sync", [{prop: "w", name: "w", anonymous: false, exported: false, typ: Mutex, tag: ""}, {prop: "writerSem", name: "writerSem", anonymous: false, exported: false, typ: $Uint32, tag: ""}, {prop: "readerSem", name: "readerSem", anonymous: false, exported: false, typ: $Uint32, tag: ""}, {prop: "readerCount", name: "readerCount", anonymous: false, exported: false, typ: $Int32, tag: ""}, {prop: "readerWait", name: "readerWait", anonymous: false, exported: false, typ: $Int32, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = race.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		allPools = sliceType.nil;
		semWaiters = {};
		expunged = (new Uint8Array(8));
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["io"] = (function() {
	var $pkg = {}, $init, errors, sync, errWhence, errOffset;
	errors = $packages["errors"];
	sync = $packages["sync"];
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrShortWrite = errors.New("short write");
		$pkg.ErrShortBuffer = errors.New("short buffer");
		$pkg.EOF = errors.New("EOF");
		$pkg.ErrUnexpectedEOF = errors.New("unexpected EOF");
		$pkg.ErrNoProgress = errors.New("multiple Read calls return no data or error");
		errWhence = errors.New("Seek: invalid whence");
		errOffset = errors.New("Seek: invalid offset");
		$pkg.ErrClosedPipe = errors.New("io: read/write on closed pipe");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode"] = (function() {
	var $pkg = {}, $init, RangeTable, Range16, Range32, CaseRange, d, foldPair, arrayType, sliceType, sliceType$1, sliceType$3, sliceType$4, _L, _Nd, _CaseRanges, properties, asciiFold, caseOrbit, to, IsDigit, IsLetter, is16, is32, isExcludingLatin, To, ToUpper, ToLower, SimpleFold;
	RangeTable = $pkg.RangeTable = $newType(0, $kindStruct, "unicode.RangeTable", true, "unicode", true, function(R16_, R32_, LatinOffset_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.R16 = sliceType.nil;
			this.R32 = sliceType$1.nil;
			this.LatinOffset = 0;
			return;
		}
		this.R16 = R16_;
		this.R32 = R32_;
		this.LatinOffset = LatinOffset_;
	});
	Range16 = $pkg.Range16 = $newType(0, $kindStruct, "unicode.Range16", true, "unicode", true, function(Lo_, Hi_, Stride_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Stride = 0;
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Stride = Stride_;
	});
	Range32 = $pkg.Range32 = $newType(0, $kindStruct, "unicode.Range32", true, "unicode", true, function(Lo_, Hi_, Stride_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Stride = 0;
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Stride = Stride_;
	});
	CaseRange = $pkg.CaseRange = $newType(0, $kindStruct, "unicode.CaseRange", true, "unicode", true, function(Lo_, Hi_, Delta_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Delta = arrayType.zero();
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Delta = Delta_;
	});
	d = $pkg.d = $newType(12, $kindArray, "unicode.d", true, "unicode", false, null);
	foldPair = $pkg.foldPair = $newType(0, $kindStruct, "unicode.foldPair", true, "unicode", false, function(From_, To_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.From = 0;
			this.To = 0;
			return;
		}
		this.From = From_;
		this.To = To_;
	});
	arrayType = $arrayType($Int32, 3);
	sliceType = $sliceType(Range16);
	sliceType$1 = $sliceType(Range32);
	sliceType$3 = $sliceType(CaseRange);
	sliceType$4 = $sliceType(foldPair);
	to = function(_case, r, caseRange) {
		var _case, _q, caseRange, cr, delta, hi, lo, m, r, x;
		if (_case < 0 || 3 <= _case) {
			return 65533;
		}
		lo = 0;
		hi = caseRange.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			cr = ((m < 0 || m >= caseRange.$length) ? ($throwRuntimeError("index out of range"), undefined) : caseRange.$array[caseRange.$offset + m]);
			if (((cr.Lo >> 0)) <= r && r <= ((cr.Hi >> 0))) {
				delta = ((x = cr.Delta, ((_case < 0 || _case >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[_case])));
				if (delta > 1114111) {
					return ((cr.Lo >> 0)) + ((((((r - ((cr.Lo >> 0)) >> 0)) & ~1) >> 0) | (((_case & 1) >> 0)))) >> 0;
				}
				return r + delta >> 0;
			}
			if (r < ((cr.Lo >> 0))) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return r;
	};
	IsDigit = function(r) {
		var r;
		if (r <= 255) {
			return 48 <= r && r <= 57;
		}
		return isExcludingLatin($pkg.Digit, r);
	};
	$pkg.IsDigit = IsDigit;
	IsLetter = function(r) {
		var r, x;
		if (((r >>> 0)) <= 255) {
			return !(((((x = ((r << 24 >>> 24)), ((x < 0 || x >= properties.length) ? ($throwRuntimeError("index out of range"), undefined) : properties[x])) & 96) >>> 0) === 0));
		}
		return isExcludingLatin($pkg.Letter, r);
	};
	$pkg.IsLetter = IsLetter;
	is16 = function(ranges, r) {
		var _i, _q, _r, _r$1, _ref, hi, i, lo, m, r, range_, range_$1, ranges;
		if (ranges.$length <= 18 || r <= 255) {
			_ref = ranges;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				range_ = ((i < 0 || i >= ranges.$length) ? ($throwRuntimeError("index out of range"), undefined) : ranges.$array[ranges.$offset + i]);
				if (r < range_.Lo) {
					return false;
				}
				if (r <= range_.Hi) {
					return (_r = ((r - range_.Lo << 16 >>> 16)) % range_.Stride, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0;
				}
				_i++;
			}
			return false;
		}
		lo = 0;
		hi = ranges.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			range_$1 = ((m < 0 || m >= ranges.$length) ? ($throwRuntimeError("index out of range"), undefined) : ranges.$array[ranges.$offset + m]);
			if (range_$1.Lo <= r && r <= range_$1.Hi) {
				return (_r$1 = ((r - range_$1.Lo << 16 >>> 16)) % range_$1.Stride, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0;
			}
			if (r < range_$1.Lo) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return false;
	};
	is32 = function(ranges, r) {
		var _i, _q, _r, _r$1, _ref, hi, i, lo, m, r, range_, range_$1, ranges;
		if (ranges.$length <= 18) {
			_ref = ranges;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				range_ = ((i < 0 || i >= ranges.$length) ? ($throwRuntimeError("index out of range"), undefined) : ranges.$array[ranges.$offset + i]);
				if (r < range_.Lo) {
					return false;
				}
				if (r <= range_.Hi) {
					return (_r = ((r - range_.Lo >>> 0)) % range_.Stride, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0;
				}
				_i++;
			}
			return false;
		}
		lo = 0;
		hi = ranges.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			range_$1 = $clone(((m < 0 || m >= ranges.$length) ? ($throwRuntimeError("index out of range"), undefined) : ranges.$array[ranges.$offset + m]), Range32);
			if (range_$1.Lo <= r && r <= range_$1.Hi) {
				return (_r$1 = ((r - range_$1.Lo >>> 0)) % range_$1.Stride, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0;
			}
			if (r < range_$1.Lo) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return false;
	};
	isExcludingLatin = function(rangeTab, r) {
		var off, r, r16, r32, rangeTab, x;
		r16 = rangeTab.R16;
		off = rangeTab.LatinOffset;
		if (r16.$length > off && r <= (((x = r16.$length - 1 >> 0, ((x < 0 || x >= r16.$length) ? ($throwRuntimeError("index out of range"), undefined) : r16.$array[r16.$offset + x])).Hi >> 0))) {
			return is16($subslice(r16, off), ((r << 16 >>> 16)));
		}
		r32 = rangeTab.R32;
		if (r32.$length > 0 && r >= (((0 >= r32.$length ? ($throwRuntimeError("index out of range"), undefined) : r32.$array[r32.$offset + 0]).Lo >> 0))) {
			return is32(r32, ((r >>> 0)));
		}
		return false;
	};
	To = function(_case, r) {
		var _case, r;
		return to(_case, r, $pkg.CaseRanges);
	};
	$pkg.To = To;
	ToUpper = function(r) {
		var r;
		if (r <= 127) {
			if (97 <= r && r <= 122) {
				r = r - (32) >> 0;
			}
			return r;
		}
		return To(0, r);
	};
	$pkg.ToUpper = ToUpper;
	ToLower = function(r) {
		var r;
		if (r <= 127) {
			if (65 <= r && r <= 90) {
				r = r + (32) >> 0;
			}
			return r;
		}
		return To(1, r);
	};
	$pkg.ToLower = ToLower;
	SimpleFold = function(r) {
		var _q, hi, l, lo, m, r;
		if (r < 0 || r > 1114111) {
			return r;
		}
		if (((r >> 0)) < 128) {
			return ((((r < 0 || r >= asciiFold.length) ? ($throwRuntimeError("index out of range"), undefined) : asciiFold[r]) >> 0));
		}
		lo = 0;
		hi = caseOrbit.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			if (((((m < 0 || m >= caseOrbit.$length) ? ($throwRuntimeError("index out of range"), undefined) : caseOrbit.$array[caseOrbit.$offset + m]).From >> 0)) < r) {
				lo = m + 1 >> 0;
			} else {
				hi = m;
			}
		}
		if (lo < caseOrbit.$length && (((((lo < 0 || lo >= caseOrbit.$length) ? ($throwRuntimeError("index out of range"), undefined) : caseOrbit.$array[caseOrbit.$offset + lo]).From >> 0)) === r)) {
			return ((((lo < 0 || lo >= caseOrbit.$length) ? ($throwRuntimeError("index out of range"), undefined) : caseOrbit.$array[caseOrbit.$offset + lo]).To >> 0));
		}
		l = ToLower(r);
		if (!((l === r))) {
			return l;
		}
		return ToUpper(r);
	};
	$pkg.SimpleFold = SimpleFold;
	RangeTable.init("", [{prop: "R16", name: "R16", anonymous: false, exported: true, typ: sliceType, tag: ""}, {prop: "R32", name: "R32", anonymous: false, exported: true, typ: sliceType$1, tag: ""}, {prop: "LatinOffset", name: "LatinOffset", anonymous: false, exported: true, typ: $Int, tag: ""}]);
	Range16.init("", [{prop: "Lo", name: "Lo", anonymous: false, exported: true, typ: $Uint16, tag: ""}, {prop: "Hi", name: "Hi", anonymous: false, exported: true, typ: $Uint16, tag: ""}, {prop: "Stride", name: "Stride", anonymous: false, exported: true, typ: $Uint16, tag: ""}]);
	Range32.init("", [{prop: "Lo", name: "Lo", anonymous: false, exported: true, typ: $Uint32, tag: ""}, {prop: "Hi", name: "Hi", anonymous: false, exported: true, typ: $Uint32, tag: ""}, {prop: "Stride", name: "Stride", anonymous: false, exported: true, typ: $Uint32, tag: ""}]);
	CaseRange.init("", [{prop: "Lo", name: "Lo", anonymous: false, exported: true, typ: $Uint32, tag: ""}, {prop: "Hi", name: "Hi", anonymous: false, exported: true, typ: $Uint32, tag: ""}, {prop: "Delta", name: "Delta", anonymous: false, exported: true, typ: d, tag: ""}]);
	d.init($Int32, 3);
	foldPair.init("", [{prop: "From", name: "From", anonymous: false, exported: true, typ: $Uint16, tag: ""}, {prop: "To", name: "To", anonymous: false, exported: true, typ: $Uint16, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_L = new RangeTable.ptr(new sliceType([new Range16.ptr(65, 90, 1), new Range16.ptr(97, 122, 1), new Range16.ptr(170, 181, 11), new Range16.ptr(186, 192, 6), new Range16.ptr(193, 214, 1), new Range16.ptr(216, 246, 1), new Range16.ptr(248, 705, 1), new Range16.ptr(710, 721, 1), new Range16.ptr(736, 740, 1), new Range16.ptr(748, 750, 2), new Range16.ptr(880, 884, 1), new Range16.ptr(886, 887, 1), new Range16.ptr(890, 893, 1), new Range16.ptr(895, 902, 7), new Range16.ptr(904, 906, 1), new Range16.ptr(908, 910, 2), new Range16.ptr(911, 929, 1), new Range16.ptr(931, 1013, 1), new Range16.ptr(1015, 1153, 1), new Range16.ptr(1162, 1327, 1), new Range16.ptr(1329, 1366, 1), new Range16.ptr(1369, 1377, 8), new Range16.ptr(1378, 1415, 1), new Range16.ptr(1488, 1514, 1), new Range16.ptr(1520, 1522, 1), new Range16.ptr(1568, 1610, 1), new Range16.ptr(1646, 1647, 1), new Range16.ptr(1649, 1747, 1), new Range16.ptr(1749, 1765, 16), new Range16.ptr(1766, 1774, 8), new Range16.ptr(1775, 1786, 11), new Range16.ptr(1787, 1788, 1), new Range16.ptr(1791, 1808, 17), new Range16.ptr(1810, 1839, 1), new Range16.ptr(1869, 1957, 1), new Range16.ptr(1969, 1994, 25), new Range16.ptr(1995, 2026, 1), new Range16.ptr(2036, 2037, 1), new Range16.ptr(2042, 2048, 6), new Range16.ptr(2049, 2069, 1), new Range16.ptr(2074, 2084, 10), new Range16.ptr(2088, 2112, 24), new Range16.ptr(2113, 2136, 1), new Range16.ptr(2208, 2228, 1), new Range16.ptr(2230, 2237, 1), new Range16.ptr(2308, 2361, 1), new Range16.ptr(2365, 2384, 19), new Range16.ptr(2392, 2401, 1), new Range16.ptr(2417, 2432, 1), new Range16.ptr(2437, 2444, 1), new Range16.ptr(2447, 2448, 1), new Range16.ptr(2451, 2472, 1), new Range16.ptr(2474, 2480, 1), new Range16.ptr(2482, 2486, 4), new Range16.ptr(2487, 2489, 1), new Range16.ptr(2493, 2510, 17), new Range16.ptr(2524, 2525, 1), new Range16.ptr(2527, 2529, 1), new Range16.ptr(2544, 2545, 1), new Range16.ptr(2565, 2570, 1), new Range16.ptr(2575, 2576, 1), new Range16.ptr(2579, 2600, 1), new Range16.ptr(2602, 2608, 1), new Range16.ptr(2610, 2611, 1), new Range16.ptr(2613, 2614, 1), new Range16.ptr(2616, 2617, 1), new Range16.ptr(2649, 2652, 1), new Range16.ptr(2654, 2674, 20), new Range16.ptr(2675, 2676, 1), new Range16.ptr(2693, 2701, 1), new Range16.ptr(2703, 2705, 1), new Range16.ptr(2707, 2728, 1), new Range16.ptr(2730, 2736, 1), new Range16.ptr(2738, 2739, 1), new Range16.ptr(2741, 2745, 1), new Range16.ptr(2749, 2768, 19), new Range16.ptr(2784, 2785, 1), new Range16.ptr(2809, 2821, 12), new Range16.ptr(2822, 2828, 1), new Range16.ptr(2831, 2832, 1), new Range16.ptr(2835, 2856, 1), new Range16.ptr(2858, 2864, 1), new Range16.ptr(2866, 2867, 1), new Range16.ptr(2869, 2873, 1), new Range16.ptr(2877, 2908, 31), new Range16.ptr(2909, 2911, 2), new Range16.ptr(2912, 2913, 1), new Range16.ptr(2929, 2947, 18), new Range16.ptr(2949, 2954, 1), new Range16.ptr(2958, 2960, 1), new Range16.ptr(2962, 2965, 1), new Range16.ptr(2969, 2970, 1), new Range16.ptr(2972, 2974, 2), new Range16.ptr(2975, 2979, 4), new Range16.ptr(2980, 2984, 4), new Range16.ptr(2985, 2986, 1), new Range16.ptr(2990, 3001, 1), new Range16.ptr(3024, 3077, 53), new Range16.ptr(3078, 3084, 1), new Range16.ptr(3086, 3088, 1), new Range16.ptr(3090, 3112, 1), new Range16.ptr(3114, 3129, 1), new Range16.ptr(3133, 3160, 27), new Range16.ptr(3161, 3162, 1), new Range16.ptr(3168, 3169, 1), new Range16.ptr(3200, 3205, 5), new Range16.ptr(3206, 3212, 1), new Range16.ptr(3214, 3216, 1), new Range16.ptr(3218, 3240, 1), new Range16.ptr(3242, 3251, 1), new Range16.ptr(3253, 3257, 1), new Range16.ptr(3261, 3294, 33), new Range16.ptr(3296, 3297, 1), new Range16.ptr(3313, 3314, 1), new Range16.ptr(3333, 3340, 1), new Range16.ptr(3342, 3344, 1), new Range16.ptr(3346, 3386, 1), new Range16.ptr(3389, 3406, 17), new Range16.ptr(3412, 3414, 1), new Range16.ptr(3423, 3425, 1), new Range16.ptr(3450, 3455, 1), new Range16.ptr(3461, 3478, 1), new Range16.ptr(3482, 3505, 1), new Range16.ptr(3507, 3515, 1), new Range16.ptr(3517, 3520, 3), new Range16.ptr(3521, 3526, 1), new Range16.ptr(3585, 3632, 1), new Range16.ptr(3634, 3635, 1), new Range16.ptr(3648, 3654, 1), new Range16.ptr(3713, 3714, 1), new Range16.ptr(3716, 3719, 3), new Range16.ptr(3720, 3722, 2), new Range16.ptr(3725, 3732, 7), new Range16.ptr(3733, 3735, 1), new Range16.ptr(3737, 3743, 1), new Range16.ptr(3745, 3747, 1), new Range16.ptr(3749, 3751, 2), new Range16.ptr(3754, 3755, 1), new Range16.ptr(3757, 3760, 1), new Range16.ptr(3762, 3763, 1), new Range16.ptr(3773, 3776, 3), new Range16.ptr(3777, 3780, 1), new Range16.ptr(3782, 3804, 22), new Range16.ptr(3805, 3807, 1), new Range16.ptr(3840, 3904, 64), new Range16.ptr(3905, 3911, 1), new Range16.ptr(3913, 3948, 1), new Range16.ptr(3976, 3980, 1), new Range16.ptr(4096, 4138, 1), new Range16.ptr(4159, 4176, 17), new Range16.ptr(4177, 4181, 1), new Range16.ptr(4186, 4189, 1), new Range16.ptr(4193, 4197, 4), new Range16.ptr(4198, 4206, 8), new Range16.ptr(4207, 4208, 1), new Range16.ptr(4213, 4225, 1), new Range16.ptr(4238, 4256, 18), new Range16.ptr(4257, 4293, 1), new Range16.ptr(4295, 4301, 6), new Range16.ptr(4304, 4346, 1), new Range16.ptr(4348, 4680, 1), new Range16.ptr(4682, 4685, 1), new Range16.ptr(4688, 4694, 1), new Range16.ptr(4696, 4698, 2), new Range16.ptr(4699, 4701, 1), new Range16.ptr(4704, 4744, 1), new Range16.ptr(4746, 4749, 1), new Range16.ptr(4752, 4784, 1), new Range16.ptr(4786, 4789, 1), new Range16.ptr(4792, 4798, 1), new Range16.ptr(4800, 4802, 2), new Range16.ptr(4803, 4805, 1), new Range16.ptr(4808, 4822, 1), new Range16.ptr(4824, 4880, 1), new Range16.ptr(4882, 4885, 1), new Range16.ptr(4888, 4954, 1), new Range16.ptr(4992, 5007, 1), new Range16.ptr(5024, 5109, 1), new Range16.ptr(5112, 5117, 1), new Range16.ptr(5121, 5740, 1), new Range16.ptr(5743, 5759, 1), new Range16.ptr(5761, 5786, 1), new Range16.ptr(5792, 5866, 1), new Range16.ptr(5873, 5880, 1), new Range16.ptr(5888, 5900, 1), new Range16.ptr(5902, 5905, 1), new Range16.ptr(5920, 5937, 1), new Range16.ptr(5952, 5969, 1), new Range16.ptr(5984, 5996, 1), new Range16.ptr(5998, 6000, 1), new Range16.ptr(6016, 6067, 1), new Range16.ptr(6103, 6108, 5), new Range16.ptr(6176, 6263, 1), new Range16.ptr(6272, 6276, 1), new Range16.ptr(6279, 6312, 1), new Range16.ptr(6314, 6320, 6), new Range16.ptr(6321, 6389, 1), new Range16.ptr(6400, 6430, 1), new Range16.ptr(6480, 6509, 1), new Range16.ptr(6512, 6516, 1), new Range16.ptr(6528, 6571, 1), new Range16.ptr(6576, 6601, 1), new Range16.ptr(6656, 6678, 1), new Range16.ptr(6688, 6740, 1), new Range16.ptr(6823, 6917, 94), new Range16.ptr(6918, 6963, 1), new Range16.ptr(6981, 6987, 1), new Range16.ptr(7043, 7072, 1), new Range16.ptr(7086, 7087, 1), new Range16.ptr(7098, 7141, 1), new Range16.ptr(7168, 7203, 1), new Range16.ptr(7245, 7247, 1), new Range16.ptr(7258, 7293, 1), new Range16.ptr(7296, 7304, 1), new Range16.ptr(7401, 7404, 1), new Range16.ptr(7406, 7409, 1), new Range16.ptr(7413, 7414, 1), new Range16.ptr(7424, 7615, 1), new Range16.ptr(7680, 7957, 1), new Range16.ptr(7960, 7965, 1), new Range16.ptr(7968, 8005, 1), new Range16.ptr(8008, 8013, 1), new Range16.ptr(8016, 8023, 1), new Range16.ptr(8025, 8031, 2), new Range16.ptr(8032, 8061, 1), new Range16.ptr(8064, 8116, 1), new Range16.ptr(8118, 8124, 1), new Range16.ptr(8126, 8130, 4), new Range16.ptr(8131, 8132, 1), new Range16.ptr(8134, 8140, 1), new Range16.ptr(8144, 8147, 1), new Range16.ptr(8150, 8155, 1), new Range16.ptr(8160, 8172, 1), new Range16.ptr(8178, 8180, 1), new Range16.ptr(8182, 8188, 1), new Range16.ptr(8305, 8319, 14), new Range16.ptr(8336, 8348, 1), new Range16.ptr(8450, 8455, 5), new Range16.ptr(8458, 8467, 1), new Range16.ptr(8469, 8473, 4), new Range16.ptr(8474, 8477, 1), new Range16.ptr(8484, 8490, 2), new Range16.ptr(8491, 8493, 1), new Range16.ptr(8495, 8505, 1), new Range16.ptr(8508, 8511, 1), new Range16.ptr(8517, 8521, 1), new Range16.ptr(8526, 8579, 53), new Range16.ptr(8580, 11264, 2684), new Range16.ptr(11265, 11310, 1), new Range16.ptr(11312, 11358, 1), new Range16.ptr(11360, 11492, 1), new Range16.ptr(11499, 11502, 1), new Range16.ptr(11506, 11507, 1), new Range16.ptr(11520, 11557, 1), new Range16.ptr(11559, 11565, 6), new Range16.ptr(11568, 11623, 1), new Range16.ptr(11631, 11648, 17), new Range16.ptr(11649, 11670, 1), new Range16.ptr(11680, 11686, 1), new Range16.ptr(11688, 11694, 1), new Range16.ptr(11696, 11702, 1), new Range16.ptr(11704, 11710, 1), new Range16.ptr(11712, 11718, 1), new Range16.ptr(11720, 11726, 1), new Range16.ptr(11728, 11734, 1), new Range16.ptr(11736, 11742, 1), new Range16.ptr(11823, 12293, 470), new Range16.ptr(12294, 12337, 43), new Range16.ptr(12338, 12341, 1), new Range16.ptr(12347, 12348, 1), new Range16.ptr(12353, 12438, 1), new Range16.ptr(12445, 12447, 1), new Range16.ptr(12449, 12538, 1), new Range16.ptr(12540, 12543, 1), new Range16.ptr(12549, 12589, 1), new Range16.ptr(12593, 12686, 1), new Range16.ptr(12704, 12730, 1), new Range16.ptr(12784, 12799, 1), new Range16.ptr(13312, 19893, 1), new Range16.ptr(19968, 40917, 1), new Range16.ptr(40960, 42124, 1), new Range16.ptr(42192, 42237, 1), new Range16.ptr(42240, 42508, 1), new Range16.ptr(42512, 42527, 1), new Range16.ptr(42538, 42539, 1), new Range16.ptr(42560, 42606, 1), new Range16.ptr(42623, 42653, 1), new Range16.ptr(42656, 42725, 1), new Range16.ptr(42775, 42783, 1), new Range16.ptr(42786, 42888, 1), new Range16.ptr(42891, 42926, 1), new Range16.ptr(42928, 42935, 1), new Range16.ptr(42999, 43009, 1), new Range16.ptr(43011, 43013, 1), new Range16.ptr(43015, 43018, 1), new Range16.ptr(43020, 43042, 1), new Range16.ptr(43072, 43123, 1), new Range16.ptr(43138, 43187, 1), new Range16.ptr(43250, 43255, 1), new Range16.ptr(43259, 43261, 2), new Range16.ptr(43274, 43301, 1), new Range16.ptr(43312, 43334, 1), new Range16.ptr(43360, 43388, 1), new Range16.ptr(43396, 43442, 1), new Range16.ptr(43471, 43488, 17), new Range16.ptr(43489, 43492, 1), new Range16.ptr(43494, 43503, 1), new Range16.ptr(43514, 43518, 1), new Range16.ptr(43520, 43560, 1), new Range16.ptr(43584, 43586, 1), new Range16.ptr(43588, 43595, 1), new Range16.ptr(43616, 43638, 1), new Range16.ptr(43642, 43646, 4), new Range16.ptr(43647, 43695, 1), new Range16.ptr(43697, 43701, 4), new Range16.ptr(43702, 43705, 3), new Range16.ptr(43706, 43709, 1), new Range16.ptr(43712, 43714, 2), new Range16.ptr(43739, 43741, 1), new Range16.ptr(43744, 43754, 1), new Range16.ptr(43762, 43764, 1), new Range16.ptr(43777, 43782, 1), new Range16.ptr(43785, 43790, 1), new Range16.ptr(43793, 43798, 1), new Range16.ptr(43808, 43814, 1), new Range16.ptr(43816, 43822, 1), new Range16.ptr(43824, 43866, 1), new Range16.ptr(43868, 43877, 1), new Range16.ptr(43888, 44002, 1), new Range16.ptr(44032, 55203, 1), new Range16.ptr(55216, 55238, 1), new Range16.ptr(55243, 55291, 1), new Range16.ptr(63744, 64109, 1), new Range16.ptr(64112, 64217, 1), new Range16.ptr(64256, 64262, 1), new Range16.ptr(64275, 64279, 1), new Range16.ptr(64285, 64287, 2), new Range16.ptr(64288, 64296, 1), new Range16.ptr(64298, 64310, 1), new Range16.ptr(64312, 64316, 1), new Range16.ptr(64318, 64320, 2), new Range16.ptr(64321, 64323, 2), new Range16.ptr(64324, 64326, 2), new Range16.ptr(64327, 64433, 1), new Range16.ptr(64467, 64829, 1), new Range16.ptr(64848, 64911, 1), new Range16.ptr(64914, 64967, 1), new Range16.ptr(65008, 65019, 1), new Range16.ptr(65136, 65140, 1), new Range16.ptr(65142, 65276, 1), new Range16.ptr(65313, 65338, 1), new Range16.ptr(65345, 65370, 1), new Range16.ptr(65382, 65470, 1), new Range16.ptr(65474, 65479, 1), new Range16.ptr(65482, 65487, 1), new Range16.ptr(65490, 65495, 1), new Range16.ptr(65498, 65500, 1)]), new sliceType$1([new Range32.ptr(65536, 65547, 1), new Range32.ptr(65549, 65574, 1), new Range32.ptr(65576, 65594, 1), new Range32.ptr(65596, 65597, 1), new Range32.ptr(65599, 65613, 1), new Range32.ptr(65616, 65629, 1), new Range32.ptr(65664, 65786, 1), new Range32.ptr(66176, 66204, 1), new Range32.ptr(66208, 66256, 1), new Range32.ptr(66304, 66335, 1), new Range32.ptr(66352, 66368, 1), new Range32.ptr(66370, 66377, 1), new Range32.ptr(66384, 66421, 1), new Range32.ptr(66432, 66461, 1), new Range32.ptr(66464, 66499, 1), new Range32.ptr(66504, 66511, 1), new Range32.ptr(66560, 66717, 1), new Range32.ptr(66736, 66771, 1), new Range32.ptr(66776, 66811, 1), new Range32.ptr(66816, 66855, 1), new Range32.ptr(66864, 66915, 1), new Range32.ptr(67072, 67382, 1), new Range32.ptr(67392, 67413, 1), new Range32.ptr(67424, 67431, 1), new Range32.ptr(67584, 67589, 1), new Range32.ptr(67592, 67594, 2), new Range32.ptr(67595, 67637, 1), new Range32.ptr(67639, 67640, 1), new Range32.ptr(67644, 67647, 3), new Range32.ptr(67648, 67669, 1), new Range32.ptr(67680, 67702, 1), new Range32.ptr(67712, 67742, 1), new Range32.ptr(67808, 67826, 1), new Range32.ptr(67828, 67829, 1), new Range32.ptr(67840, 67861, 1), new Range32.ptr(67872, 67897, 1), new Range32.ptr(67968, 68023, 1), new Range32.ptr(68030, 68031, 1), new Range32.ptr(68096, 68112, 16), new Range32.ptr(68113, 68115, 1), new Range32.ptr(68117, 68119, 1), new Range32.ptr(68121, 68147, 1), new Range32.ptr(68192, 68220, 1), new Range32.ptr(68224, 68252, 1), new Range32.ptr(68288, 68295, 1), new Range32.ptr(68297, 68324, 1), new Range32.ptr(68352, 68405, 1), new Range32.ptr(68416, 68437, 1), new Range32.ptr(68448, 68466, 1), new Range32.ptr(68480, 68497, 1), new Range32.ptr(68608, 68680, 1), new Range32.ptr(68736, 68786, 1), new Range32.ptr(68800, 68850, 1), new Range32.ptr(69635, 69687, 1), new Range32.ptr(69763, 69807, 1), new Range32.ptr(69840, 69864, 1), new Range32.ptr(69891, 69926, 1), new Range32.ptr(69968, 70002, 1), new Range32.ptr(70006, 70019, 13), new Range32.ptr(70020, 70066, 1), new Range32.ptr(70081, 70084, 1), new Range32.ptr(70106, 70108, 2), new Range32.ptr(70144, 70161, 1), new Range32.ptr(70163, 70187, 1), new Range32.ptr(70272, 70278, 1), new Range32.ptr(70280, 70282, 2), new Range32.ptr(70283, 70285, 1), new Range32.ptr(70287, 70301, 1), new Range32.ptr(70303, 70312, 1), new Range32.ptr(70320, 70366, 1), new Range32.ptr(70405, 70412, 1), new Range32.ptr(70415, 70416, 1), new Range32.ptr(70419, 70440, 1), new Range32.ptr(70442, 70448, 1), new Range32.ptr(70450, 70451, 1), new Range32.ptr(70453, 70457, 1), new Range32.ptr(70461, 70480, 19), new Range32.ptr(70493, 70497, 1), new Range32.ptr(70656, 70708, 1), new Range32.ptr(70727, 70730, 1), new Range32.ptr(70784, 70831, 1), new Range32.ptr(70852, 70853, 1), new Range32.ptr(70855, 71040, 185), new Range32.ptr(71041, 71086, 1), new Range32.ptr(71128, 71131, 1), new Range32.ptr(71168, 71215, 1), new Range32.ptr(71236, 71296, 60), new Range32.ptr(71297, 71338, 1), new Range32.ptr(71424, 71449, 1), new Range32.ptr(71840, 71903, 1), new Range32.ptr(71935, 72384, 449), new Range32.ptr(72385, 72440, 1), new Range32.ptr(72704, 72712, 1), new Range32.ptr(72714, 72750, 1), new Range32.ptr(72768, 72818, 50), new Range32.ptr(72819, 72847, 1), new Range32.ptr(73728, 74649, 1), new Range32.ptr(74880, 75075, 1), new Range32.ptr(77824, 78894, 1), new Range32.ptr(82944, 83526, 1), new Range32.ptr(92160, 92728, 1), new Range32.ptr(92736, 92766, 1), new Range32.ptr(92880, 92909, 1), new Range32.ptr(92928, 92975, 1), new Range32.ptr(92992, 92995, 1), new Range32.ptr(93027, 93047, 1), new Range32.ptr(93053, 93071, 1), new Range32.ptr(93952, 94020, 1), new Range32.ptr(94032, 94099, 67), new Range32.ptr(94100, 94111, 1), new Range32.ptr(94176, 94208, 32), new Range32.ptr(94209, 100332, 1), new Range32.ptr(100352, 101106, 1), new Range32.ptr(110592, 110593, 1), new Range32.ptr(113664, 113770, 1), new Range32.ptr(113776, 113788, 1), new Range32.ptr(113792, 113800, 1), new Range32.ptr(113808, 113817, 1), new Range32.ptr(119808, 119892, 1), new Range32.ptr(119894, 119964, 1), new Range32.ptr(119966, 119967, 1), new Range32.ptr(119970, 119973, 3), new Range32.ptr(119974, 119977, 3), new Range32.ptr(119978, 119980, 1), new Range32.ptr(119982, 119993, 1), new Range32.ptr(119995, 119997, 2), new Range32.ptr(119998, 120003, 1), new Range32.ptr(120005, 120069, 1), new Range32.ptr(120071, 120074, 1), new Range32.ptr(120077, 120084, 1), new Range32.ptr(120086, 120092, 1), new Range32.ptr(120094, 120121, 1), new Range32.ptr(120123, 120126, 1), new Range32.ptr(120128, 120132, 1), new Range32.ptr(120134, 120138, 4), new Range32.ptr(120139, 120144, 1), new Range32.ptr(120146, 120485, 1), new Range32.ptr(120488, 120512, 1), new Range32.ptr(120514, 120538, 1), new Range32.ptr(120540, 120570, 1), new Range32.ptr(120572, 120596, 1), new Range32.ptr(120598, 120628, 1), new Range32.ptr(120630, 120654, 1), new Range32.ptr(120656, 120686, 1), new Range32.ptr(120688, 120712, 1), new Range32.ptr(120714, 120744, 1), new Range32.ptr(120746, 120770, 1), new Range32.ptr(120772, 120779, 1), new Range32.ptr(124928, 125124, 1), new Range32.ptr(125184, 125251, 1), new Range32.ptr(126464, 126467, 1), new Range32.ptr(126469, 126495, 1), new Range32.ptr(126497, 126498, 1), new Range32.ptr(126500, 126503, 3), new Range32.ptr(126505, 126514, 1), new Range32.ptr(126516, 126519, 1), new Range32.ptr(126521, 126523, 2), new Range32.ptr(126530, 126535, 5), new Range32.ptr(126537, 126541, 2), new Range32.ptr(126542, 126543, 1), new Range32.ptr(126545, 126546, 1), new Range32.ptr(126548, 126551, 3), new Range32.ptr(126553, 126561, 2), new Range32.ptr(126562, 126564, 2), new Range32.ptr(126567, 126570, 1), new Range32.ptr(126572, 126578, 1), new Range32.ptr(126580, 126583, 1), new Range32.ptr(126585, 126588, 1), new Range32.ptr(126590, 126592, 2), new Range32.ptr(126593, 126601, 1), new Range32.ptr(126603, 126619, 1), new Range32.ptr(126625, 126627, 1), new Range32.ptr(126629, 126633, 1), new Range32.ptr(126635, 126651, 1), new Range32.ptr(131072, 173782, 1), new Range32.ptr(173824, 177972, 1), new Range32.ptr(177984, 178205, 1), new Range32.ptr(178208, 183969, 1), new Range32.ptr(194560, 195101, 1)]), 6);
		_Nd = new RangeTable.ptr(new sliceType([new Range16.ptr(48, 57, 1), new Range16.ptr(1632, 1641, 1), new Range16.ptr(1776, 1785, 1), new Range16.ptr(1984, 1993, 1), new Range16.ptr(2406, 2415, 1), new Range16.ptr(2534, 2543, 1), new Range16.ptr(2662, 2671, 1), new Range16.ptr(2790, 2799, 1), new Range16.ptr(2918, 2927, 1), new Range16.ptr(3046, 3055, 1), new Range16.ptr(3174, 3183, 1), new Range16.ptr(3302, 3311, 1), new Range16.ptr(3430, 3439, 1), new Range16.ptr(3558, 3567, 1), new Range16.ptr(3664, 3673, 1), new Range16.ptr(3792, 3801, 1), new Range16.ptr(3872, 3881, 1), new Range16.ptr(4160, 4169, 1), new Range16.ptr(4240, 4249, 1), new Range16.ptr(6112, 6121, 1), new Range16.ptr(6160, 6169, 1), new Range16.ptr(6470, 6479, 1), new Range16.ptr(6608, 6617, 1), new Range16.ptr(6784, 6793, 1), new Range16.ptr(6800, 6809, 1), new Range16.ptr(6992, 7001, 1), new Range16.ptr(7088, 7097, 1), new Range16.ptr(7232, 7241, 1), new Range16.ptr(7248, 7257, 1), new Range16.ptr(42528, 42537, 1), new Range16.ptr(43216, 43225, 1), new Range16.ptr(43264, 43273, 1), new Range16.ptr(43472, 43481, 1), new Range16.ptr(43504, 43513, 1), new Range16.ptr(43600, 43609, 1), new Range16.ptr(44016, 44025, 1), new Range16.ptr(65296, 65305, 1)]), new sliceType$1([new Range32.ptr(66720, 66729, 1), new Range32.ptr(69734, 69743, 1), new Range32.ptr(69872, 69881, 1), new Range32.ptr(69942, 69951, 1), new Range32.ptr(70096, 70105, 1), new Range32.ptr(70384, 70393, 1), new Range32.ptr(70736, 70745, 1), new Range32.ptr(70864, 70873, 1), new Range32.ptr(71248, 71257, 1), new Range32.ptr(71360, 71369, 1), new Range32.ptr(71472, 71481, 1), new Range32.ptr(71904, 71913, 1), new Range32.ptr(72784, 72793, 1), new Range32.ptr(92768, 92777, 1), new Range32.ptr(93008, 93017, 1), new Range32.ptr(120782, 120831, 1), new Range32.ptr(125264, 125273, 1)]), 1);
		$pkg.Digit = _Nd;
		$pkg.Letter = _L;
		_CaseRanges = new sliceType$3([new CaseRange.ptr(65, 90, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(97, 122, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(181, 181, $toNativeArray($kindInt32, [743, 0, 743])), new CaseRange.ptr(192, 214, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(216, 222, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(224, 246, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(248, 254, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(255, 255, $toNativeArray($kindInt32, [121, 0, 121])), new CaseRange.ptr(256, 303, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(304, 304, $toNativeArray($kindInt32, [0, -199, 0])), new CaseRange.ptr(305, 305, $toNativeArray($kindInt32, [-232, 0, -232])), new CaseRange.ptr(306, 311, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(313, 328, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(330, 375, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(376, 376, $toNativeArray($kindInt32, [0, -121, 0])), new CaseRange.ptr(377, 382, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(383, 383, $toNativeArray($kindInt32, [-300, 0, -300])), new CaseRange.ptr(384, 384, $toNativeArray($kindInt32, [195, 0, 195])), new CaseRange.ptr(385, 385, $toNativeArray($kindInt32, [0, 210, 0])), new CaseRange.ptr(386, 389, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(390, 390, $toNativeArray($kindInt32, [0, 206, 0])), new CaseRange.ptr(391, 392, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(393, 394, $toNativeArray($kindInt32, [0, 205, 0])), new CaseRange.ptr(395, 396, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(398, 398, $toNativeArray($kindInt32, [0, 79, 0])), new CaseRange.ptr(399, 399, $toNativeArray($kindInt32, [0, 202, 0])), new CaseRange.ptr(400, 400, $toNativeArray($kindInt32, [0, 203, 0])), new CaseRange.ptr(401, 402, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(403, 403, $toNativeArray($kindInt32, [0, 205, 0])), new CaseRange.ptr(404, 404, $toNativeArray($kindInt32, [0, 207, 0])), new CaseRange.ptr(405, 405, $toNativeArray($kindInt32, [97, 0, 97])), new CaseRange.ptr(406, 406, $toNativeArray($kindInt32, [0, 211, 0])), new CaseRange.ptr(407, 407, $toNativeArray($kindInt32, [0, 209, 0])), new CaseRange.ptr(408, 409, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(410, 410, $toNativeArray($kindInt32, [163, 0, 163])), new CaseRange.ptr(412, 412, $toNativeArray($kindInt32, [0, 211, 0])), new CaseRange.ptr(413, 413, $toNativeArray($kindInt32, [0, 213, 0])), new CaseRange.ptr(414, 414, $toNativeArray($kindInt32, [130, 0, 130])), new CaseRange.ptr(415, 415, $toNativeArray($kindInt32, [0, 214, 0])), new CaseRange.ptr(416, 421, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(422, 422, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(423, 424, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(425, 425, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(428, 429, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(430, 430, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(431, 432, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(433, 434, $toNativeArray($kindInt32, [0, 217, 0])), new CaseRange.ptr(435, 438, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(439, 439, $toNativeArray($kindInt32, [0, 219, 0])), new CaseRange.ptr(440, 441, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(444, 445, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(447, 447, $toNativeArray($kindInt32, [56, 0, 56])), new CaseRange.ptr(452, 452, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(453, 453, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(454, 454, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(455, 455, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(456, 456, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(457, 457, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(458, 458, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(459, 459, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(460, 460, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(461, 476, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(477, 477, $toNativeArray($kindInt32, [-79, 0, -79])), new CaseRange.ptr(478, 495, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(497, 497, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(498, 498, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(499, 499, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(500, 501, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(502, 502, $toNativeArray($kindInt32, [0, -97, 0])), new CaseRange.ptr(503, 503, $toNativeArray($kindInt32, [0, -56, 0])), new CaseRange.ptr(504, 543, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(544, 544, $toNativeArray($kindInt32, [0, -130, 0])), new CaseRange.ptr(546, 563, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(570, 570, $toNativeArray($kindInt32, [0, 10795, 0])), new CaseRange.ptr(571, 572, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(573, 573, $toNativeArray($kindInt32, [0, -163, 0])), new CaseRange.ptr(574, 574, $toNativeArray($kindInt32, [0, 10792, 0])), new CaseRange.ptr(575, 576, $toNativeArray($kindInt32, [10815, 0, 10815])), new CaseRange.ptr(577, 578, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(579, 579, $toNativeArray($kindInt32, [0, -195, 0])), new CaseRange.ptr(580, 580, $toNativeArray($kindInt32, [0, 69, 0])), new CaseRange.ptr(581, 581, $toNativeArray($kindInt32, [0, 71, 0])), new CaseRange.ptr(582, 591, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(592, 592, $toNativeArray($kindInt32, [10783, 0, 10783])), new CaseRange.ptr(593, 593, $toNativeArray($kindInt32, [10780, 0, 10780])), new CaseRange.ptr(594, 594, $toNativeArray($kindInt32, [10782, 0, 10782])), new CaseRange.ptr(595, 595, $toNativeArray($kindInt32, [-210, 0, -210])), new CaseRange.ptr(596, 596, $toNativeArray($kindInt32, [-206, 0, -206])), new CaseRange.ptr(598, 599, $toNativeArray($kindInt32, [-205, 0, -205])), new CaseRange.ptr(601, 601, $toNativeArray($kindInt32, [-202, 0, -202])), new CaseRange.ptr(603, 603, $toNativeArray($kindInt32, [-203, 0, -203])), new CaseRange.ptr(604, 604, $toNativeArray($kindInt32, [42319, 0, 42319])), new CaseRange.ptr(608, 608, $toNativeArray($kindInt32, [-205, 0, -205])), new CaseRange.ptr(609, 609, $toNativeArray($kindInt32, [42315, 0, 42315])), new CaseRange.ptr(611, 611, $toNativeArray($kindInt32, [-207, 0, -207])), new CaseRange.ptr(613, 613, $toNativeArray($kindInt32, [42280, 0, 42280])), new CaseRange.ptr(614, 614, $toNativeArray($kindInt32, [42308, 0, 42308])), new CaseRange.ptr(616, 616, $toNativeArray($kindInt32, [-209, 0, -209])), new CaseRange.ptr(617, 617, $toNativeArray($kindInt32, [-211, 0, -211])), new CaseRange.ptr(618, 618, $toNativeArray($kindInt32, [42308, 0, 42308])), new CaseRange.ptr(619, 619, $toNativeArray($kindInt32, [10743, 0, 10743])), new CaseRange.ptr(620, 620, $toNativeArray($kindInt32, [42305, 0, 42305])), new CaseRange.ptr(623, 623, $toNativeArray($kindInt32, [-211, 0, -211])), new CaseRange.ptr(625, 625, $toNativeArray($kindInt32, [10749, 0, 10749])), new CaseRange.ptr(626, 626, $toNativeArray($kindInt32, [-213, 0, -213])), new CaseRange.ptr(629, 629, $toNativeArray($kindInt32, [-214, 0, -214])), new CaseRange.ptr(637, 637, $toNativeArray($kindInt32, [10727, 0, 10727])), new CaseRange.ptr(640, 640, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(643, 643, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(647, 647, $toNativeArray($kindInt32, [42282, 0, 42282])), new CaseRange.ptr(648, 648, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(649, 649, $toNativeArray($kindInt32, [-69, 0, -69])), new CaseRange.ptr(650, 651, $toNativeArray($kindInt32, [-217, 0, -217])), new CaseRange.ptr(652, 652, $toNativeArray($kindInt32, [-71, 0, -71])), new CaseRange.ptr(658, 658, $toNativeArray($kindInt32, [-219, 0, -219])), new CaseRange.ptr(669, 669, $toNativeArray($kindInt32, [42261, 0, 42261])), new CaseRange.ptr(670, 670, $toNativeArray($kindInt32, [42258, 0, 42258])), new CaseRange.ptr(837, 837, $toNativeArray($kindInt32, [84, 0, 84])), new CaseRange.ptr(880, 883, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(886, 887, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(891, 893, $toNativeArray($kindInt32, [130, 0, 130])), new CaseRange.ptr(895, 895, $toNativeArray($kindInt32, [0, 116, 0])), new CaseRange.ptr(902, 902, $toNativeArray($kindInt32, [0, 38, 0])), new CaseRange.ptr(904, 906, $toNativeArray($kindInt32, [0, 37, 0])), new CaseRange.ptr(908, 908, $toNativeArray($kindInt32, [0, 64, 0])), new CaseRange.ptr(910, 911, $toNativeArray($kindInt32, [0, 63, 0])), new CaseRange.ptr(913, 929, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(931, 939, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(940, 940, $toNativeArray($kindInt32, [-38, 0, -38])), new CaseRange.ptr(941, 943, $toNativeArray($kindInt32, [-37, 0, -37])), new CaseRange.ptr(945, 961, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(962, 962, $toNativeArray($kindInt32, [-31, 0, -31])), new CaseRange.ptr(963, 971, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(972, 972, $toNativeArray($kindInt32, [-64, 0, -64])), new CaseRange.ptr(973, 974, $toNativeArray($kindInt32, [-63, 0, -63])), new CaseRange.ptr(975, 975, $toNativeArray($kindInt32, [0, 8, 0])), new CaseRange.ptr(976, 976, $toNativeArray($kindInt32, [-62, 0, -62])), new CaseRange.ptr(977, 977, $toNativeArray($kindInt32, [-57, 0, -57])), new CaseRange.ptr(981, 981, $toNativeArray($kindInt32, [-47, 0, -47])), new CaseRange.ptr(982, 982, $toNativeArray($kindInt32, [-54, 0, -54])), new CaseRange.ptr(983, 983, $toNativeArray($kindInt32, [-8, 0, -8])), new CaseRange.ptr(984, 1007, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1008, 1008, $toNativeArray($kindInt32, [-86, 0, -86])), new CaseRange.ptr(1009, 1009, $toNativeArray($kindInt32, [-80, 0, -80])), new CaseRange.ptr(1010, 1010, $toNativeArray($kindInt32, [7, 0, 7])), new CaseRange.ptr(1011, 1011, $toNativeArray($kindInt32, [-116, 0, -116])), new CaseRange.ptr(1012, 1012, $toNativeArray($kindInt32, [0, -60, 0])), new CaseRange.ptr(1013, 1013, $toNativeArray($kindInt32, [-96, 0, -96])), new CaseRange.ptr(1015, 1016, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1017, 1017, $toNativeArray($kindInt32, [0, -7, 0])), new CaseRange.ptr(1018, 1019, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1021, 1023, $toNativeArray($kindInt32, [0, -130, 0])), new CaseRange.ptr(1024, 1039, $toNativeArray($kindInt32, [0, 80, 0])), new CaseRange.ptr(1040, 1071, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(1072, 1103, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(1104, 1119, $toNativeArray($kindInt32, [-80, 0, -80])), new CaseRange.ptr(1120, 1153, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1162, 1215, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1216, 1216, $toNativeArray($kindInt32, [0, 15, 0])), new CaseRange.ptr(1217, 1230, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1231, 1231, $toNativeArray($kindInt32, [-15, 0, -15])), new CaseRange.ptr(1232, 1327, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1329, 1366, $toNativeArray($kindInt32, [0, 48, 0])), new CaseRange.ptr(1377, 1414, $toNativeArray($kindInt32, [-48, 0, -48])), new CaseRange.ptr(4256, 4293, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(4295, 4295, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(4301, 4301, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(5024, 5103, $toNativeArray($kindInt32, [0, 38864, 0])), new CaseRange.ptr(5104, 5109, $toNativeArray($kindInt32, [0, 8, 0])), new CaseRange.ptr(5112, 5117, $toNativeArray($kindInt32, [-8, 0, -8])), new CaseRange.ptr(7296, 7296, $toNativeArray($kindInt32, [-6254, 0, -6254])), new CaseRange.ptr(7297, 7297, $toNativeArray($kindInt32, [-6253, 0, -6253])), new CaseRange.ptr(7298, 7298, $toNativeArray($kindInt32, [-6244, 0, -6244])), new CaseRange.ptr(7299, 7300, $toNativeArray($kindInt32, [-6242, 0, -6242])), new CaseRange.ptr(7301, 7301, $toNativeArray($kindInt32, [-6243, 0, -6243])), new CaseRange.ptr(7302, 7302, $toNativeArray($kindInt32, [-6236, 0, -6236])), new CaseRange.ptr(7303, 7303, $toNativeArray($kindInt32, [-6181, 0, -6181])), new CaseRange.ptr(7304, 7304, $toNativeArray($kindInt32, [35266, 0, 35266])), new CaseRange.ptr(7545, 7545, $toNativeArray($kindInt32, [35332, 0, 35332])), new CaseRange.ptr(7549, 7549, $toNativeArray($kindInt32, [3814, 0, 3814])), new CaseRange.ptr(7680, 7829, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(7835, 7835, $toNativeArray($kindInt32, [-59, 0, -59])), new CaseRange.ptr(7838, 7838, $toNativeArray($kindInt32, [0, -7615, 0])), new CaseRange.ptr(7840, 7935, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(7936, 7943, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7944, 7951, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7952, 7957, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7960, 7965, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7968, 7975, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7976, 7983, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7984, 7991, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7992, 7999, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8000, 8005, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8008, 8013, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8017, 8017, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8019, 8019, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8021, 8021, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8023, 8023, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8025, 8025, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8027, 8027, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8029, 8029, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8031, 8031, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8032, 8039, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8040, 8047, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8048, 8049, $toNativeArray($kindInt32, [74, 0, 74])), new CaseRange.ptr(8050, 8053, $toNativeArray($kindInt32, [86, 0, 86])), new CaseRange.ptr(8054, 8055, $toNativeArray($kindInt32, [100, 0, 100])), new CaseRange.ptr(8056, 8057, $toNativeArray($kindInt32, [128, 0, 128])), new CaseRange.ptr(8058, 8059, $toNativeArray($kindInt32, [112, 0, 112])), new CaseRange.ptr(8060, 8061, $toNativeArray($kindInt32, [126, 0, 126])), new CaseRange.ptr(8064, 8071, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8072, 8079, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8080, 8087, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8088, 8095, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8096, 8103, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8104, 8111, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8112, 8113, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8115, 8115, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8120, 8121, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8122, 8123, $toNativeArray($kindInt32, [0, -74, 0])), new CaseRange.ptr(8124, 8124, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8126, 8126, $toNativeArray($kindInt32, [-7205, 0, -7205])), new CaseRange.ptr(8131, 8131, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8136, 8139, $toNativeArray($kindInt32, [0, -86, 0])), new CaseRange.ptr(8140, 8140, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8144, 8145, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8152, 8153, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8154, 8155, $toNativeArray($kindInt32, [0, -100, 0])), new CaseRange.ptr(8160, 8161, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8165, 8165, $toNativeArray($kindInt32, [7, 0, 7])), new CaseRange.ptr(8168, 8169, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8170, 8171, $toNativeArray($kindInt32, [0, -112, 0])), new CaseRange.ptr(8172, 8172, $toNativeArray($kindInt32, [0, -7, 0])), new CaseRange.ptr(8179, 8179, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8184, 8185, $toNativeArray($kindInt32, [0, -128, 0])), new CaseRange.ptr(8186, 8187, $toNativeArray($kindInt32, [0, -126, 0])), new CaseRange.ptr(8188, 8188, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8486, 8486, $toNativeArray($kindInt32, [0, -7517, 0])), new CaseRange.ptr(8490, 8490, $toNativeArray($kindInt32, [0, -8383, 0])), new CaseRange.ptr(8491, 8491, $toNativeArray($kindInt32, [0, -8262, 0])), new CaseRange.ptr(8498, 8498, $toNativeArray($kindInt32, [0, 28, 0])), new CaseRange.ptr(8526, 8526, $toNativeArray($kindInt32, [-28, 0, -28])), new CaseRange.ptr(8544, 8559, $toNativeArray($kindInt32, [0, 16, 0])), new CaseRange.ptr(8560, 8575, $toNativeArray($kindInt32, [-16, 0, -16])), new CaseRange.ptr(8579, 8580, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(9398, 9423, $toNativeArray($kindInt32, [0, 26, 0])), new CaseRange.ptr(9424, 9449, $toNativeArray($kindInt32, [-26, 0, -26])), new CaseRange.ptr(11264, 11310, $toNativeArray($kindInt32, [0, 48, 0])), new CaseRange.ptr(11312, 11358, $toNativeArray($kindInt32, [-48, 0, -48])), new CaseRange.ptr(11360, 11361, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11362, 11362, $toNativeArray($kindInt32, [0, -10743, 0])), new CaseRange.ptr(11363, 11363, $toNativeArray($kindInt32, [0, -3814, 0])), new CaseRange.ptr(11364, 11364, $toNativeArray($kindInt32, [0, -10727, 0])), new CaseRange.ptr(11365, 11365, $toNativeArray($kindInt32, [-10795, 0, -10795])), new CaseRange.ptr(11366, 11366, $toNativeArray($kindInt32, [-10792, 0, -10792])), new CaseRange.ptr(11367, 11372, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11373, 11373, $toNativeArray($kindInt32, [0, -10780, 0])), new CaseRange.ptr(11374, 11374, $toNativeArray($kindInt32, [0, -10749, 0])), new CaseRange.ptr(11375, 11375, $toNativeArray($kindInt32, [0, -10783, 0])), new CaseRange.ptr(11376, 11376, $toNativeArray($kindInt32, [0, -10782, 0])), new CaseRange.ptr(11378, 11379, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11381, 11382, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11390, 11391, $toNativeArray($kindInt32, [0, -10815, 0])), new CaseRange.ptr(11392, 11491, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11499, 11502, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11506, 11507, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11520, 11557, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(11559, 11559, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(11565, 11565, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(42560, 42605, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42624, 42651, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42786, 42799, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42802, 42863, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42873, 42876, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42877, 42877, $toNativeArray($kindInt32, [0, -35332, 0])), new CaseRange.ptr(42878, 42887, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42891, 42892, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42893, 42893, $toNativeArray($kindInt32, [0, -42280, 0])), new CaseRange.ptr(42896, 42899, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42902, 42921, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42922, 42922, $toNativeArray($kindInt32, [0, -42308, 0])), new CaseRange.ptr(42923, 42923, $toNativeArray($kindInt32, [0, -42319, 0])), new CaseRange.ptr(42924, 42924, $toNativeArray($kindInt32, [0, -42315, 0])), new CaseRange.ptr(42925, 42925, $toNativeArray($kindInt32, [0, -42305, 0])), new CaseRange.ptr(42926, 42926, $toNativeArray($kindInt32, [0, -42308, 0])), new CaseRange.ptr(42928, 42928, $toNativeArray($kindInt32, [0, -42258, 0])), new CaseRange.ptr(42929, 42929, $toNativeArray($kindInt32, [0, -42282, 0])), new CaseRange.ptr(42930, 42930, $toNativeArray($kindInt32, [0, -42261, 0])), new CaseRange.ptr(42931, 42931, $toNativeArray($kindInt32, [0, 928, 0])), new CaseRange.ptr(42932, 42935, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(43859, 43859, $toNativeArray($kindInt32, [-928, 0, -928])), new CaseRange.ptr(43888, 43967, $toNativeArray($kindInt32, [-38864, 0, -38864])), new CaseRange.ptr(65313, 65338, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(65345, 65370, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(66560, 66599, $toNativeArray($kindInt32, [0, 40, 0])), new CaseRange.ptr(66600, 66639, $toNativeArray($kindInt32, [-40, 0, -40])), new CaseRange.ptr(66736, 66771, $toNativeArray($kindInt32, [0, 40, 0])), new CaseRange.ptr(66776, 66811, $toNativeArray($kindInt32, [-40, 0, -40])), new CaseRange.ptr(68736, 68786, $toNativeArray($kindInt32, [0, 64, 0])), new CaseRange.ptr(68800, 68850, $toNativeArray($kindInt32, [-64, 0, -64])), new CaseRange.ptr(71840, 71871, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(71872, 71903, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(125184, 125217, $toNativeArray($kindInt32, [0, 34, 0])), new CaseRange.ptr(125218, 125251, $toNativeArray($kindInt32, [-34, 0, -34]))]);
		$pkg.CaseRanges = _CaseRanges;
		properties = $toNativeArray($kindUint8, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 144, 130, 130, 130, 136, 130, 130, 130, 130, 130, 130, 136, 130, 130, 130, 130, 132, 132, 132, 132, 132, 132, 132, 132, 132, 132, 130, 130, 136, 136, 136, 130, 130, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 130, 130, 130, 136, 130, 136, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 130, 136, 130, 136, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 16, 130, 136, 136, 136, 136, 136, 130, 136, 136, 224, 130, 136, 0, 136, 136, 136, 136, 132, 132, 136, 192, 130, 130, 136, 132, 224, 130, 132, 132, 132, 130, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 160, 136, 160, 160, 160, 160, 160, 160, 160, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 192, 136, 192, 192, 192, 192, 192, 192, 192, 192]);
		asciiFold = $toNativeArray($kindUint16, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 91, 92, 93, 94, 95, 96, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 8490, 76, 77, 78, 79, 80, 81, 82, 383, 84, 85, 86, 87, 88, 89, 90, 123, 124, 125, 126, 127]);
		caseOrbit = new sliceType$4([new foldPair.ptr(75, 107), new foldPair.ptr(83, 115), new foldPair.ptr(107, 8490), new foldPair.ptr(115, 383), new foldPair.ptr(181, 924), new foldPair.ptr(197, 229), new foldPair.ptr(223, 7838), new foldPair.ptr(229, 8491), new foldPair.ptr(304, 304), new foldPair.ptr(305, 305), new foldPair.ptr(383, 83), new foldPair.ptr(452, 453), new foldPair.ptr(453, 454), new foldPair.ptr(454, 452), new foldPair.ptr(455, 456), new foldPair.ptr(456, 457), new foldPair.ptr(457, 455), new foldPair.ptr(458, 459), new foldPair.ptr(459, 460), new foldPair.ptr(460, 458), new foldPair.ptr(497, 498), new foldPair.ptr(498, 499), new foldPair.ptr(499, 497), new foldPair.ptr(837, 921), new foldPair.ptr(914, 946), new foldPair.ptr(917, 949), new foldPair.ptr(920, 952), new foldPair.ptr(921, 953), new foldPair.ptr(922, 954), new foldPair.ptr(924, 956), new foldPair.ptr(928, 960), new foldPair.ptr(929, 961), new foldPair.ptr(931, 962), new foldPair.ptr(934, 966), new foldPair.ptr(937, 969), new foldPair.ptr(946, 976), new foldPair.ptr(949, 1013), new foldPair.ptr(952, 977), new foldPair.ptr(953, 8126), new foldPair.ptr(954, 1008), new foldPair.ptr(956, 181), new foldPair.ptr(960, 982), new foldPair.ptr(961, 1009), new foldPair.ptr(962, 963), new foldPair.ptr(963, 931), new foldPair.ptr(966, 981), new foldPair.ptr(969, 8486), new foldPair.ptr(976, 914), new foldPair.ptr(977, 1012), new foldPair.ptr(981, 934), new foldPair.ptr(982, 928), new foldPair.ptr(1008, 922), new foldPair.ptr(1009, 929), new foldPair.ptr(1012, 920), new foldPair.ptr(1013, 917), new foldPair.ptr(1042, 1074), new foldPair.ptr(1044, 1076), new foldPair.ptr(1054, 1086), new foldPair.ptr(1057, 1089), new foldPair.ptr(1058, 1090), new foldPair.ptr(1066, 1098), new foldPair.ptr(1074, 7296), new foldPair.ptr(1076, 7297), new foldPair.ptr(1086, 7298), new foldPair.ptr(1089, 7299), new foldPair.ptr(1090, 7300), new foldPair.ptr(1098, 7302), new foldPair.ptr(1122, 1123), new foldPair.ptr(1123, 7303), new foldPair.ptr(7296, 1042), new foldPair.ptr(7297, 1044), new foldPair.ptr(7298, 1054), new foldPair.ptr(7299, 1057), new foldPair.ptr(7300, 7301), new foldPair.ptr(7301, 1058), new foldPair.ptr(7302, 1066), new foldPair.ptr(7303, 1122), new foldPair.ptr(7304, 42570), new foldPair.ptr(7776, 7777), new foldPair.ptr(7777, 7835), new foldPair.ptr(7835, 7776), new foldPair.ptr(7838, 223), new foldPair.ptr(8126, 837), new foldPair.ptr(8486, 937), new foldPair.ptr(8490, 75), new foldPair.ptr(8491, 197), new foldPair.ptr(42570, 42571), new foldPair.ptr(42571, 7304)]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode/utf8"] = (function() {
	var $pkg = {}, $init, acceptRange, first, acceptRanges, DecodeRune, DecodeRuneInString, RuneLen, EncodeRune, ValidRune;
	acceptRange = $pkg.acceptRange = $newType(0, $kindStruct, "utf8.acceptRange", true, "unicode/utf8", false, function(lo_, hi_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lo = 0;
			this.hi = 0;
			return;
		}
		this.lo = lo_;
		this.hi = hi_;
	});
	DecodeRune = function(p) {
		var _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, accept, b1, b2, b3, mask, n, p, p0, r, size, sz, x, x$1;
		r = 0;
		size = 0;
		n = p.$length;
		if (n < 1) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		p0 = (0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0]);
		x = ((p0 < 0 || p0 >= first.length) ? ($throwRuntimeError("index out of range"), undefined) : first[p0]);
		if (x >= 240) {
			mask = (((x >> 0)) << 31 >> 0) >> 31 >> 0;
			_tmp$2 = (((((0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0]) >> 0)) & ~mask) >> 0) | (65533 & mask);
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		sz = (x & 7) >>> 0;
		accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? ($throwRuntimeError("index out of range"), undefined) : acceptRanges[x$1])), acceptRange);
		if (n < ((sz >> 0))) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		b1 = (1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1]);
		if (b1 < accept.lo || accept.hi < b1) {
			_tmp$6 = 65533;
			_tmp$7 = 1;
			r = _tmp$6;
			size = _tmp$7;
			return [r, size];
		}
		if (sz === 2) {
			_tmp$8 = (((((p0 & 31) >>> 0) >> 0)) << 6 >> 0) | ((((b1 & 63) >>> 0) >> 0));
			_tmp$9 = 2;
			r = _tmp$8;
			size = _tmp$9;
			return [r, size];
		}
		b2 = (2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2]);
		if (b2 < 128 || 191 < b2) {
			_tmp$10 = 65533;
			_tmp$11 = 1;
			r = _tmp$10;
			size = _tmp$11;
			return [r, size];
		}
		if (sz === 3) {
			_tmp$12 = ((((((p0 & 15) >>> 0) >> 0)) << 12 >> 0) | (((((b1 & 63) >>> 0) >> 0)) << 6 >> 0)) | ((((b2 & 63) >>> 0) >> 0));
			_tmp$13 = 3;
			r = _tmp$12;
			size = _tmp$13;
			return [r, size];
		}
		b3 = (3 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 3]);
		if (b3 < 128 || 191 < b3) {
			_tmp$14 = 65533;
			_tmp$15 = 1;
			r = _tmp$14;
			size = _tmp$15;
			return [r, size];
		}
		_tmp$16 = (((((((p0 & 7) >>> 0) >> 0)) << 18 >> 0) | (((((b1 & 63) >>> 0) >> 0)) << 12 >> 0)) | (((((b2 & 63) >>> 0) >> 0)) << 6 >> 0)) | ((((b3 & 63) >>> 0) >> 0));
		_tmp$17 = 4;
		r = _tmp$16;
		size = _tmp$17;
		return [r, size];
	};
	$pkg.DecodeRune = DecodeRune;
	DecodeRuneInString = function(s) {
		var _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, accept, mask, n, r, s, s0, s1, s2, s3, size, sz, x, x$1;
		r = 0;
		size = 0;
		n = s.length;
		if (n < 1) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		s0 = s.charCodeAt(0);
		x = ((s0 < 0 || s0 >= first.length) ? ($throwRuntimeError("index out of range"), undefined) : first[s0]);
		if (x >= 240) {
			mask = (((x >> 0)) << 31 >> 0) >> 31 >> 0;
			_tmp$2 = ((((s.charCodeAt(0) >> 0)) & ~mask) >> 0) | (65533 & mask);
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		sz = (x & 7) >>> 0;
		accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? ($throwRuntimeError("index out of range"), undefined) : acceptRanges[x$1])), acceptRange);
		if (n < ((sz >> 0))) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		s1 = s.charCodeAt(1);
		if (s1 < accept.lo || accept.hi < s1) {
			_tmp$6 = 65533;
			_tmp$7 = 1;
			r = _tmp$6;
			size = _tmp$7;
			return [r, size];
		}
		if (sz === 2) {
			_tmp$8 = (((((s0 & 31) >>> 0) >> 0)) << 6 >> 0) | ((((s1 & 63) >>> 0) >> 0));
			_tmp$9 = 2;
			r = _tmp$8;
			size = _tmp$9;
			return [r, size];
		}
		s2 = s.charCodeAt(2);
		if (s2 < 128 || 191 < s2) {
			_tmp$10 = 65533;
			_tmp$11 = 1;
			r = _tmp$10;
			size = _tmp$11;
			return [r, size];
		}
		if (sz === 3) {
			_tmp$12 = ((((((s0 & 15) >>> 0) >> 0)) << 12 >> 0) | (((((s1 & 63) >>> 0) >> 0)) << 6 >> 0)) | ((((s2 & 63) >>> 0) >> 0));
			_tmp$13 = 3;
			r = _tmp$12;
			size = _tmp$13;
			return [r, size];
		}
		s3 = s.charCodeAt(3);
		if (s3 < 128 || 191 < s3) {
			_tmp$14 = 65533;
			_tmp$15 = 1;
			r = _tmp$14;
			size = _tmp$15;
			return [r, size];
		}
		_tmp$16 = (((((((s0 & 7) >>> 0) >> 0)) << 18 >> 0) | (((((s1 & 63) >>> 0) >> 0)) << 12 >> 0)) | (((((s2 & 63) >>> 0) >> 0)) << 6 >> 0)) | ((((s3 & 63) >>> 0) >> 0));
		_tmp$17 = 4;
		r = _tmp$16;
		size = _tmp$17;
		return [r, size];
	};
	$pkg.DecodeRuneInString = DecodeRuneInString;
	RuneLen = function(r) {
		var r;
		if (r < 0) {
			return -1;
		} else if (r <= 127) {
			return 1;
		} else if (r <= 2047) {
			return 2;
		} else if (55296 <= r && r <= 57343) {
			return -1;
		} else if (r <= 65535) {
			return 3;
		} else if (r <= 1114111) {
			return 4;
		}
		return -1;
	};
	$pkg.RuneLen = RuneLen;
	EncodeRune = function(p, r) {
		var i, p, r;
		i = ((r >>> 0));
		if (i <= 127) {
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((r << 24 >>> 24)));
			return 1;
		} else if (i <= 2047) {
			$unused((1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1]));
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((192 | (((r >> 6 >> 0) << 24 >>> 24))) >>> 0));
			(1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1] = ((128 | ((((r << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			return 2;
		} else if ((i > 1114111) || (55296 <= i && i <= 57343)) {
			r = 65533;
			$unused((2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2]));
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((224 | (((r >> 12 >> 0) << 24 >>> 24))) >>> 0));
			(1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1] = ((128 | (((((r >> 6 >> 0) << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2] = ((128 | ((((r << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			return 3;
		} else if (i <= 65535) {
			$unused((2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2]));
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((224 | (((r >> 12 >> 0) << 24 >>> 24))) >>> 0));
			(1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1] = ((128 | (((((r >> 6 >> 0) << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2] = ((128 | ((((r << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			return 3;
		} else {
			$unused((3 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 3]));
			(0 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 0] = ((240 | (((r >> 18 >> 0) << 24 >>> 24))) >>> 0));
			(1 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 1] = ((128 | (((((r >> 12 >> 0) << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 2] = ((128 | (((((r >> 6 >> 0) << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			(3 >= p.$length ? ($throwRuntimeError("index out of range"), undefined) : p.$array[p.$offset + 3] = ((128 | ((((r << 24 >>> 24)) & 63) >>> 0)) >>> 0));
			return 4;
		}
	};
	$pkg.EncodeRune = EncodeRune;
	ValidRune = function(r) {
		var r;
		if (0 <= r && r < 55296) {
			return true;
		} else if (57343 < r && r <= 1114111) {
			return true;
		}
		return false;
	};
	$pkg.ValidRune = ValidRune;
	acceptRange.init("unicode/utf8", [{prop: "lo", name: "lo", anonymous: false, exported: false, typ: $Uint8, tag: ""}, {prop: "hi", name: "hi", anonymous: false, exported: false, typ: $Uint8, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		first = $toNativeArray($kindUint8, [240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 19, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 35, 3, 3, 52, 4, 4, 4, 68, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241]);
		acceptRanges = $toNativeArray($kindStruct, [new acceptRange.ptr(128, 191), new acceptRange.ptr(160, 191), new acceptRange.ptr(128, 159), new acceptRange.ptr(144, 191), new acceptRange.ptr(128, 143)]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["bytes"] = (function() {
	var $pkg = {}, $init, errors, io, unicode, utf8, Equal, EqualFold;
	errors = $packages["errors"];
	io = $packages["io"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	Equal = function(a, b) {
		var _i, _ref, a, b, c, i;
		if (!((a.$length === b.$length))) {
			return false;
		}
		_ref = a;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			c = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			if (!((c === ((i < 0 || i >= b.$length) ? ($throwRuntimeError("index out of range"), undefined) : b.$array[b.$offset + i])))) {
				return false;
			}
			_i++;
		}
		return true;
	};
	$pkg.Equal = Equal;
	EqualFold = function(s, t) {
		var _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, _tuple$1, r, r$1, r$2, s, size, size$1, sr, t, tr;
		while (true) {
			if (!(!((s.$length === 0)) && !((t.$length === 0)))) { break; }
			_tmp = 0;
			_tmp$1 = 0;
			sr = _tmp;
			tr = _tmp$1;
			if ((0 >= s.$length ? ($throwRuntimeError("index out of range"), undefined) : s.$array[s.$offset + 0]) < 128) {
				_tmp$2 = (((0 >= s.$length ? ($throwRuntimeError("index out of range"), undefined) : s.$array[s.$offset + 0]) >> 0));
				_tmp$3 = $subslice(s, 1);
				sr = _tmp$2;
				s = _tmp$3;
			} else {
				_tuple = utf8.DecodeRune(s);
				r = _tuple[0];
				size = _tuple[1];
				_tmp$4 = r;
				_tmp$5 = $subslice(s, size);
				sr = _tmp$4;
				s = _tmp$5;
			}
			if ((0 >= t.$length ? ($throwRuntimeError("index out of range"), undefined) : t.$array[t.$offset + 0]) < 128) {
				_tmp$6 = (((0 >= t.$length ? ($throwRuntimeError("index out of range"), undefined) : t.$array[t.$offset + 0]) >> 0));
				_tmp$7 = $subslice(t, 1);
				tr = _tmp$6;
				t = _tmp$7;
			} else {
				_tuple$1 = utf8.DecodeRune(t);
				r$1 = _tuple$1[0];
				size$1 = _tuple$1[1];
				_tmp$8 = r$1;
				_tmp$9 = $subslice(t, size$1);
				tr = _tmp$8;
				t = _tmp$9;
			}
			if (tr === sr) {
				continue;
			}
			if (tr < sr) {
				_tmp$10 = sr;
				_tmp$11 = tr;
				tr = _tmp$10;
				sr = _tmp$11;
			}
			if (tr < 128 && 65 <= sr && sr <= 90) {
				if (tr === ((sr + 97 >> 0) - 65 >> 0)) {
					continue;
				}
				return false;
			}
			r$2 = unicode.SimpleFold(sr);
			while (true) {
				if (!(!((r$2 === sr)) && r$2 < tr)) { break; }
				r$2 = unicode.SimpleFold(r$2);
			}
			if (r$2 === tr) {
				continue;
			}
			return false;
		}
		return s.$length === t.$length;
	};
	$pkg.EqualFold = EqualFold;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrTooLarge = errors.New("bytes.Buffer: too large");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["encoding"] = (function() {
	var $pkg = {}, $init, TextMarshaler, TextUnmarshaler, sliceType;
	TextMarshaler = $pkg.TextMarshaler = $newType(8, $kindInterface, "encoding.TextMarshaler", true, "encoding", true, null);
	TextUnmarshaler = $pkg.TextUnmarshaler = $newType(8, $kindInterface, "encoding.TextUnmarshaler", true, "encoding", true, null);
	sliceType = $sliceType($Uint8);
	TextMarshaler.init([{prop: "MarshalText", name: "MarshalText", pkg: "", typ: $funcType([], [sliceType, $error], false)}]);
	TextUnmarshaler.init([{prop: "UnmarshalText", name: "UnmarshalText", pkg: "", typ: $funcType([sliceType], [$error], false)}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["math"] = (function() {
	var $pkg = {}, $init, js, arrayType, arrayType$1, arrayType$2, structType, math, zero, posInf, negInf, nan, buf, Inf, NaN, init, Float32bits, Float32frombits, Float64bits, Float64frombits;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	arrayType = $arrayType($Uint32, 2);
	arrayType$1 = $arrayType($Float32, 2);
	arrayType$2 = $arrayType($Float64, 1);
	structType = $structType("math", [{prop: "uint32array", name: "uint32array", anonymous: false, exported: false, typ: arrayType, tag: ""}, {prop: "float32array", name: "float32array", anonymous: false, exported: false, typ: arrayType$1, tag: ""}, {prop: "float64array", name: "float64array", anonymous: false, exported: false, typ: arrayType$2, tag: ""}]);
	Inf = function(sign) {
		var sign;
		if (sign >= 0) {
			return posInf;
		} else {
			return negInf;
		}
	};
	$pkg.Inf = Inf;
	NaN = function() {
		return nan;
	};
	$pkg.NaN = NaN;
	init = function() {
		var ab;
		ab = new ($global.ArrayBuffer)(8);
		buf.uint32array = new ($global.Uint32Array)(ab);
		buf.float32array = new ($global.Float32Array)(ab);
		buf.float64array = new ($global.Float64Array)(ab);
	};
	Float32bits = function(f) {
		var f;
		buf.float32array[0] = f;
		return buf.uint32array[0];
	};
	$pkg.Float32bits = Float32bits;
	Float32frombits = function(b) {
		var b;
		buf.uint32array[0] = b;
		return buf.float32array[0];
	};
	$pkg.Float32frombits = Float32frombits;
	Float64bits = function(f) {
		var f, x, x$1;
		buf.float64array[0] = f;
		return (x = $shiftLeft64((new $Uint64(0, buf.uint32array[1])), 32), x$1 = (new $Uint64(0, buf.uint32array[0])), new $Uint64(x.$high + x$1.$high, x.$low + x$1.$low));
	};
	$pkg.Float64bits = Float64bits;
	Float64frombits = function(b) {
		var b;
		buf.uint32array[0] = ((b.$low >>> 0));
		buf.uint32array[1] = (($shiftRightUint64(b, 32).$low >>> 0));
		return buf.float64array[0];
	};
	$pkg.Float64frombits = Float64frombits;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		buf = new structType.ptr(arrayType.zero(), arrayType$1.zero(), arrayType$2.zero());
		math = $global.Math;
		zero = 0;
		posInf = 1 / zero;
		negInf = -1 / zero;
		nan = 0 / zero;
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strconv"] = (function() {
	var $pkg = {}, $init, errors, math, utf8, NumError, decimal, leftCheat, extFloat, floatInfo, decimalSlice, sliceType, sliceType$1, sliceType$2, sliceType$3, sliceType$4, sliceType$5, arrayType, ptrType, sliceType$6, arrayType$1, arrayType$2, ptrType$1, arrayType$3, arrayType$4, ptrType$2, ptrType$3, ptrType$4, optimize, powtab, float64pow10, float32pow10, leftcheats, smallPowersOfTen, powersOfTen, uint64pow10, float32info, float32info$24ptr, float64info, float64info$24ptr, isPrint16, isNotPrint16, isPrint32, isNotPrint32, isGraphic, shifts, equalIgnoreCase, special, readFloat, atof64exact, atof32exact, atof32, atof64, ParseFloat, syntaxError, rangeError, ParseUint, ParseInt, digitZero, trim, rightShift, prefixIsLessThan, leftShift, shouldRoundUp, frexp10Many, adjustLastDigitFixed, adjustLastDigit, FormatFloat, genericFtoa, bigFtoa, formatDigits, roundShortest, fmtE, fmtF, fmtB, min, max, FormatInt, Itoa, small, formatBits, quoteWith, appendQuotedWith, appendEscapedRune, Quote, unhex, UnquoteChar, Unquote, contains, bsearch16, bsearch32, IsPrint, isInGraphicList;
	errors = $packages["errors"];
	math = $packages["math"];
	utf8 = $packages["unicode/utf8"];
	NumError = $pkg.NumError = $newType(0, $kindStruct, "strconv.NumError", true, "strconv", true, function(Func_, Num_, Err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Func = "";
			this.Num = "";
			this.Err = $ifaceNil;
			return;
		}
		this.Func = Func_;
		this.Num = Num_;
		this.Err = Err_;
	});
	decimal = $pkg.decimal = $newType(0, $kindStruct, "strconv.decimal", true, "strconv", false, function(d_, nd_, dp_, neg_, trunc_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.d = arrayType.zero();
			this.nd = 0;
			this.dp = 0;
			this.neg = false;
			this.trunc = false;
			return;
		}
		this.d = d_;
		this.nd = nd_;
		this.dp = dp_;
		this.neg = neg_;
		this.trunc = trunc_;
	});
	leftCheat = $pkg.leftCheat = $newType(0, $kindStruct, "strconv.leftCheat", true, "strconv", false, function(delta_, cutoff_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.delta = 0;
			this.cutoff = "";
			return;
		}
		this.delta = delta_;
		this.cutoff = cutoff_;
	});
	extFloat = $pkg.extFloat = $newType(0, $kindStruct, "strconv.extFloat", true, "strconv", false, function(mant_, exp_, neg_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.mant = new $Uint64(0, 0);
			this.exp = 0;
			this.neg = false;
			return;
		}
		this.mant = mant_;
		this.exp = exp_;
		this.neg = neg_;
	});
	floatInfo = $pkg.floatInfo = $newType(0, $kindStruct, "strconv.floatInfo", true, "strconv", false, function(mantbits_, expbits_, bias_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.mantbits = 0;
			this.expbits = 0;
			this.bias = 0;
			return;
		}
		this.mantbits = mantbits_;
		this.expbits = expbits_;
		this.bias = bias_;
	});
	decimalSlice = $pkg.decimalSlice = $newType(0, $kindStruct, "strconv.decimalSlice", true, "strconv", false, function(d_, nd_, dp_, neg_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.d = sliceType$6.nil;
			this.nd = 0;
			this.dp = 0;
			this.neg = false;
			return;
		}
		this.d = d_;
		this.nd = nd_;
		this.dp = dp_;
		this.neg = neg_;
	});
	sliceType = $sliceType($Int);
	sliceType$1 = $sliceType($Float64);
	sliceType$2 = $sliceType($Float32);
	sliceType$3 = $sliceType(leftCheat);
	sliceType$4 = $sliceType($Uint16);
	sliceType$5 = $sliceType($Uint32);
	arrayType = $arrayType($Uint8, 800);
	ptrType = $ptrType(NumError);
	sliceType$6 = $sliceType($Uint8);
	arrayType$1 = $arrayType($Uint8, 24);
	arrayType$2 = $arrayType($Uint8, 32);
	ptrType$1 = $ptrType(floatInfo);
	arrayType$3 = $arrayType($Uint8, 65);
	arrayType$4 = $arrayType($Uint8, 4);
	ptrType$2 = $ptrType(decimal);
	ptrType$3 = $ptrType(decimalSlice);
	ptrType$4 = $ptrType(extFloat);
	equalIgnoreCase = function(s1, s2) {
		var c1, c2, i, s1, s2;
		if (!((s1.length === s2.length))) {
			return false;
		}
		i = 0;
		while (true) {
			if (!(i < s1.length)) { break; }
			c1 = s1.charCodeAt(i);
			if (65 <= c1 && c1 <= 90) {
				c1 = c1 + (32) << 24 >>> 24;
			}
			c2 = s2.charCodeAt(i);
			if (65 <= c2 && c2 <= 90) {
				c2 = c2 + (32) << 24 >>> 24;
			}
			if (!((c1 === c2))) {
				return false;
			}
			i = i + (1) >> 0;
		}
		return true;
	};
	special = function(s) {
		var _1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, f, ok, s;
		f = 0;
		ok = false;
		if (s.length === 0) {
			return [f, ok];
		}
		_1 = s.charCodeAt(0);
		if (_1 === (43)) {
			if (equalIgnoreCase(s, "+inf") || equalIgnoreCase(s, "+infinity")) {
				_tmp = math.Inf(1);
				_tmp$1 = true;
				f = _tmp;
				ok = _tmp$1;
				return [f, ok];
			}
		} else if (_1 === (45)) {
			if (equalIgnoreCase(s, "-inf") || equalIgnoreCase(s, "-infinity")) {
				_tmp$2 = math.Inf(-1);
				_tmp$3 = true;
				f = _tmp$2;
				ok = _tmp$3;
				return [f, ok];
			}
		} else if ((_1 === (110)) || (_1 === (78))) {
			if (equalIgnoreCase(s, "nan")) {
				_tmp$4 = math.NaN();
				_tmp$5 = true;
				f = _tmp$4;
				ok = _tmp$5;
				return [f, ok];
			}
		} else if ((_1 === (105)) || (_1 === (73))) {
			if (equalIgnoreCase(s, "inf") || equalIgnoreCase(s, "infinity")) {
				_tmp$6 = math.Inf(1);
				_tmp$7 = true;
				f = _tmp$6;
				ok = _tmp$7;
				return [f, ok];
			}
		} else {
			return [f, ok];
		}
		return [f, ok];
	};
	decimal.ptr.prototype.set = function(s) {
		var b, e, esign, i, ok, s, sawdigits, sawdot, x, x$1;
		ok = false;
		b = this;
		i = 0;
		b.neg = false;
		b.trunc = false;
		if (i >= s.length) {
			return ok;
		}
		if ((s.charCodeAt(i) === 43)) {
			i = i + (1) >> 0;
		} else if ((s.charCodeAt(i) === 45)) {
			b.neg = true;
			i = i + (1) >> 0;
		}
		sawdot = false;
		sawdigits = false;
		while (true) {
			if (!(i < s.length)) { break; }
			if ((s.charCodeAt(i) === 46)) {
				if (sawdot) {
					return ok;
				}
				sawdot = true;
				b.dp = b.nd;
				i = i + (1) >> 0;
				continue;
			} else if (48 <= s.charCodeAt(i) && s.charCodeAt(i) <= 57) {
				sawdigits = true;
				if ((s.charCodeAt(i) === 48) && (b.nd === 0)) {
					b.dp = b.dp - (1) >> 0;
					i = i + (1) >> 0;
					continue;
				}
				if (b.nd < 800) {
					(x = b.d, x$1 = b.nd, ((x$1 < 0 || x$1 >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[x$1] = s.charCodeAt(i)));
					b.nd = b.nd + (1) >> 0;
				} else if (!((s.charCodeAt(i) === 48))) {
					b.trunc = true;
				}
				i = i + (1) >> 0;
				continue;
			}
			break;
		}
		if (!sawdigits) {
			return ok;
		}
		if (!sawdot) {
			b.dp = b.nd;
		}
		if (i < s.length && ((s.charCodeAt(i) === 101) || (s.charCodeAt(i) === 69))) {
			i = i + (1) >> 0;
			if (i >= s.length) {
				return ok;
			}
			esign = 1;
			if (s.charCodeAt(i) === 43) {
				i = i + (1) >> 0;
			} else if (s.charCodeAt(i) === 45) {
				i = i + (1) >> 0;
				esign = -1;
			}
			if (i >= s.length || s.charCodeAt(i) < 48 || s.charCodeAt(i) > 57) {
				return ok;
			}
			e = 0;
			while (true) {
				if (!(i < s.length && 48 <= s.charCodeAt(i) && s.charCodeAt(i) <= 57)) { break; }
				if (e < 10000) {
					e = (($imul(e, 10)) + ((s.charCodeAt(i) >> 0)) >> 0) - 48 >> 0;
				}
				i = i + (1) >> 0;
			}
			b.dp = b.dp + (($imul(e, esign))) >> 0;
		}
		if (!((i === s.length))) {
			return ok;
		}
		ok = true;
		return ok;
	};
	decimal.prototype.set = function(s) { return this.$val.set(s); };
	readFloat = function(s) {
		var _1, c, dp, e, esign, exp, i, mantissa, nd, ndMant, neg, ok, s, sawdigits, sawdot, trunc, x;
		mantissa = new $Uint64(0, 0);
		exp = 0;
		neg = false;
		trunc = false;
		ok = false;
		i = 0;
		if (i >= s.length) {
			return [mantissa, exp, neg, trunc, ok];
		}
		if ((s.charCodeAt(i) === 43)) {
			i = i + (1) >> 0;
		} else if ((s.charCodeAt(i) === 45)) {
			neg = true;
			i = i + (1) >> 0;
		}
		sawdot = false;
		sawdigits = false;
		nd = 0;
		ndMant = 0;
		dp = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			c = s.charCodeAt(i);
			_1 = true;
			if (_1 === ((c === 46))) {
				if (sawdot) {
					return [mantissa, exp, neg, trunc, ok];
				}
				sawdot = true;
				dp = nd;
				i = i + (1) >> 0;
				continue;
			} else if (_1 === (48 <= c && c <= 57)) {
				sawdigits = true;
				if ((c === 48) && (nd === 0)) {
					dp = dp - (1) >> 0;
					i = i + (1) >> 0;
					continue;
				}
				nd = nd + (1) >> 0;
				if (ndMant < 19) {
					mantissa = $mul64(mantissa, (new $Uint64(0, 10)));
					mantissa = (x = (new $Uint64(0, (c - 48 << 24 >>> 24))), new $Uint64(mantissa.$high + x.$high, mantissa.$low + x.$low));
					ndMant = ndMant + (1) >> 0;
				} else if (!((s.charCodeAt(i) === 48))) {
					trunc = true;
				}
				i = i + (1) >> 0;
				continue;
			}
			break;
		}
		if (!sawdigits) {
			return [mantissa, exp, neg, trunc, ok];
		}
		if (!sawdot) {
			dp = nd;
		}
		if (i < s.length && ((s.charCodeAt(i) === 101) || (s.charCodeAt(i) === 69))) {
			i = i + (1) >> 0;
			if (i >= s.length) {
				return [mantissa, exp, neg, trunc, ok];
			}
			esign = 1;
			if (s.charCodeAt(i) === 43) {
				i = i + (1) >> 0;
			} else if (s.charCodeAt(i) === 45) {
				i = i + (1) >> 0;
				esign = -1;
			}
			if (i >= s.length || s.charCodeAt(i) < 48 || s.charCodeAt(i) > 57) {
				return [mantissa, exp, neg, trunc, ok];
			}
			e = 0;
			while (true) {
				if (!(i < s.length && 48 <= s.charCodeAt(i) && s.charCodeAt(i) <= 57)) { break; }
				if (e < 10000) {
					e = (($imul(e, 10)) + ((s.charCodeAt(i) >> 0)) >> 0) - 48 >> 0;
				}
				i = i + (1) >> 0;
			}
			dp = dp + (($imul(e, esign))) >> 0;
		}
		if (!((i === s.length))) {
			return [mantissa, exp, neg, trunc, ok];
		}
		if (!((mantissa.$high === 0 && mantissa.$low === 0))) {
			exp = dp - ndMant >> 0;
		}
		ok = true;
		return [mantissa, exp, neg, trunc, ok];
	};
	decimal.ptr.prototype.floatBits = function(flt) {
		var _tmp, _tmp$1, b, bits, d, exp, flt, mant, n, n$1, n$2, overflow, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, y, y$1, y$2, y$3, $s;
		/* */ $s = 0; s: while (true) { switch ($s) { case 0:
		b = new $Uint64(0, 0);
		overflow = false;
		d = this;
		exp = 0;
		mant = new $Uint64(0, 0);
		/* */ if (d.nd === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (d.nd === 0) { */ case 1:
			mant = new $Uint64(0, 0);
			exp = flt.bias;
			/* goto out */ $s = 3; continue;
		/* } */ case 2:
		/* */ if (d.dp > 310) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (d.dp > 310) { */ case 4:
			/* goto overflow */ $s = 6; continue;
		/* } */ case 5:
		/* */ if (d.dp < -330) { $s = 7; continue; }
		/* */ $s = 8; continue;
		/* if (d.dp < -330) { */ case 7:
			mant = new $Uint64(0, 0);
			exp = flt.bias;
			/* goto out */ $s = 3; continue;
		/* } */ case 8:
		exp = 0;
		while (true) {
			if (!(d.dp > 0)) { break; }
			n = 0;
			if (d.dp >= powtab.$length) {
				n = 27;
			} else {
				n = (x = d.dp, ((x < 0 || x >= powtab.$length) ? ($throwRuntimeError("index out of range"), undefined) : powtab.$array[powtab.$offset + x]));
			}
			d.Shift(-n);
			exp = exp + (n) >> 0;
		}
		while (true) {
			if (!(d.dp < 0 || (d.dp === 0) && d.d[0] < 53)) { break; }
			n$1 = 0;
			if (-d.dp >= powtab.$length) {
				n$1 = 27;
			} else {
				n$1 = (x$1 = -d.dp, ((x$1 < 0 || x$1 >= powtab.$length) ? ($throwRuntimeError("index out of range"), undefined) : powtab.$array[powtab.$offset + x$1]));
			}
			d.Shift(n$1);
			exp = exp - (n$1) >> 0;
		}
		exp = exp - (1) >> 0;
		if (exp < (flt.bias + 1 >> 0)) {
			n$2 = (flt.bias + 1 >> 0) - exp >> 0;
			d.Shift(-n$2);
			exp = exp + (n$2) >> 0;
		}
		/* */ if ((exp - flt.bias >> 0) >= (((y = flt.expbits, y < 32 ? (1 << y) : 0) >> 0) - 1 >> 0)) { $s = 9; continue; }
		/* */ $s = 10; continue;
		/* if ((exp - flt.bias >> 0) >= (((y = flt.expbits, y < 32 ? (1 << y) : 0) >> 0) - 1 >> 0)) { */ case 9:
			/* goto overflow */ $s = 6; continue;
		/* } */ case 10:
		d.Shift((((1 + flt.mantbits >>> 0) >> 0)));
		mant = d.RoundedInteger();
		/* */ if ((x$2 = $shiftLeft64(new $Uint64(0, 2), flt.mantbits), (mant.$high === x$2.$high && mant.$low === x$2.$low))) { $s = 11; continue; }
		/* */ $s = 12; continue;
		/* if ((x$2 = $shiftLeft64(new $Uint64(0, 2), flt.mantbits), (mant.$high === x$2.$high && mant.$low === x$2.$low))) { */ case 11:
			mant = $shiftRightUint64(mant, (1));
			exp = exp + (1) >> 0;
			/* */ if ((exp - flt.bias >> 0) >= (((y$1 = flt.expbits, y$1 < 32 ? (1 << y$1) : 0) >> 0) - 1 >> 0)) { $s = 13; continue; }
			/* */ $s = 14; continue;
			/* if ((exp - flt.bias >> 0) >= (((y$1 = flt.expbits, y$1 < 32 ? (1 << y$1) : 0) >> 0) - 1 >> 0)) { */ case 13:
				/* goto overflow */ $s = 6; continue;
			/* } */ case 14:
		/* } */ case 12:
		if ((x$3 = (x$4 = $shiftLeft64(new $Uint64(0, 1), flt.mantbits), new $Uint64(mant.$high & x$4.$high, (mant.$low & x$4.$low) >>> 0)), (x$3.$high === 0 && x$3.$low === 0))) {
			exp = flt.bias;
		}
		/* goto out */ $s = 3; continue;
		/* overflow: */ case 6:
		mant = new $Uint64(0, 0);
		exp = (((y$2 = flt.expbits, y$2 < 32 ? (1 << y$2) : 0) >> 0) - 1 >> 0) + flt.bias >> 0;
		overflow = true;
		/* out: */ case 3:
		bits = (x$5 = (x$6 = $shiftLeft64(new $Uint64(0, 1), flt.mantbits), new $Uint64(x$6.$high - 0, x$6.$low - 1)), new $Uint64(mant.$high & x$5.$high, (mant.$low & x$5.$low) >>> 0));
		bits = (x$7 = $shiftLeft64((new $Uint64(0, (((exp - flt.bias >> 0)) & ((((y$3 = flt.expbits, y$3 < 32 ? (1 << y$3) : 0) >> 0) - 1 >> 0))))), flt.mantbits), new $Uint64(bits.$high | x$7.$high, (bits.$low | x$7.$low) >>> 0));
		if (d.neg) {
			bits = (x$8 = $shiftLeft64($shiftLeft64(new $Uint64(0, 1), flt.mantbits), flt.expbits), new $Uint64(bits.$high | x$8.$high, (bits.$low | x$8.$low) >>> 0));
		}
		_tmp = bits;
		_tmp$1 = overflow;
		b = _tmp;
		overflow = _tmp$1;
		$s = -1; return [b, overflow];
		/* */ } return; }
	};
	decimal.prototype.floatBits = function(flt) { return this.$val.floatBits(flt); };
	atof64exact = function(mantissa, exp, neg) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, exp, f, mantissa, neg, ok, x, x$1, x$2;
		f = 0;
		ok = false;
		if (!((x = $shiftRightUint64(mantissa, float64info.mantbits), (x.$high === 0 && x.$low === 0)))) {
			return [f, ok];
		}
		f = ($flatten64(mantissa));
		if (neg) {
			f = -f;
		}
		if ((exp === 0)) {
			_tmp = f;
			_tmp$1 = true;
			f = _tmp;
			ok = _tmp$1;
			return [f, ok];
		} else if (exp > 0 && exp <= 37) {
			if (exp > 22) {
				f = f * ((x$1 = exp - 22 >> 0, ((x$1 < 0 || x$1 >= float64pow10.$length) ? ($throwRuntimeError("index out of range"), undefined) : float64pow10.$array[float64pow10.$offset + x$1])));
				exp = 22;
			}
			if (f > 1e+15 || f < -1e+15) {
				return [f, ok];
			}
			_tmp$2 = f * ((exp < 0 || exp >= float64pow10.$length) ? ($throwRuntimeError("index out of range"), undefined) : float64pow10.$array[float64pow10.$offset + exp]);
			_tmp$3 = true;
			f = _tmp$2;
			ok = _tmp$3;
			return [f, ok];
		} else if (exp < 0 && exp >= -22) {
			_tmp$4 = f / (x$2 = -exp, ((x$2 < 0 || x$2 >= float64pow10.$length) ? ($throwRuntimeError("index out of range"), undefined) : float64pow10.$array[float64pow10.$offset + x$2]));
			_tmp$5 = true;
			f = _tmp$4;
			ok = _tmp$5;
			return [f, ok];
		}
		return [f, ok];
	};
	atof32exact = function(mantissa, exp, neg) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, exp, f, mantissa, neg, ok, x, x$1, x$2;
		f = 0;
		ok = false;
		if (!((x = $shiftRightUint64(mantissa, float32info.mantbits), (x.$high === 0 && x.$low === 0)))) {
			return [f, ok];
		}
		f = ($flatten64(mantissa));
		if (neg) {
			f = -f;
		}
		if ((exp === 0)) {
			_tmp = f;
			_tmp$1 = true;
			f = _tmp;
			ok = _tmp$1;
			return [f, ok];
		} else if (exp > 0 && exp <= 17) {
			if (exp > 10) {
				f = $fround(f * ((x$1 = exp - 10 >> 0, ((x$1 < 0 || x$1 >= float32pow10.$length) ? ($throwRuntimeError("index out of range"), undefined) : float32pow10.$array[float32pow10.$offset + x$1]))));
				exp = 10;
			}
			if (f > 1e+07 || f < -1e+07) {
				return [f, ok];
			}
			_tmp$2 = $fround(f * ((exp < 0 || exp >= float32pow10.$length) ? ($throwRuntimeError("index out of range"), undefined) : float32pow10.$array[float32pow10.$offset + exp]));
			_tmp$3 = true;
			f = _tmp$2;
			ok = _tmp$3;
			return [f, ok];
		} else if (exp < 0 && exp >= -10) {
			_tmp$4 = $fround(f / (x$2 = -exp, ((x$2 < 0 || x$2 >= float32pow10.$length) ? ($throwRuntimeError("index out of range"), undefined) : float32pow10.$array[float32pow10.$offset + x$2])));
			_tmp$5 = true;
			f = _tmp$4;
			ok = _tmp$5;
			return [f, ok];
		}
		return [f, ok];
	};
	atof32 = function(s) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, b, b$1, d, err, exp, ext, f, f$1, mantissa, neg, ok, ok$1, ok$2, ok$3, ovf, ovf$1, s, trunc, val;
		f = 0;
		err = $ifaceNil;
		_tuple = special(s);
		val = _tuple[0];
		ok = _tuple[1];
		if (ok) {
			_tmp = ($fround(val));
			_tmp$1 = $ifaceNil;
			f = _tmp;
			err = _tmp$1;
			return [f, err];
		}
		if (optimize) {
			_tuple$1 = readFloat(s);
			mantissa = _tuple$1[0];
			exp = _tuple$1[1];
			neg = _tuple$1[2];
			trunc = _tuple$1[3];
			ok$1 = _tuple$1[4];
			if (ok$1) {
				if (!trunc) {
					_tuple$2 = atof32exact(mantissa, exp, neg);
					f$1 = _tuple$2[0];
					ok$2 = _tuple$2[1];
					if (ok$2) {
						_tmp$2 = f$1;
						_tmp$3 = $ifaceNil;
						f = _tmp$2;
						err = _tmp$3;
						return [f, err];
					}
				}
				ext = new extFloat.ptr(new $Uint64(0, 0), 0, false);
				ok$3 = ext.AssignDecimal(mantissa, exp, neg, trunc, float32info);
				if (ok$3) {
					_tuple$3 = ext.floatBits(float32info);
					b = _tuple$3[0];
					ovf = _tuple$3[1];
					f = math.Float32frombits(((b.$low >>> 0)));
					if (ovf) {
						err = rangeError("ParseFloat", s);
					}
					_tmp$4 = f;
					_tmp$5 = err;
					f = _tmp$4;
					err = _tmp$5;
					return [f, err];
				}
			}
		}
		d = new decimal.ptr(arrayType.zero(), 0, 0, false, false);
		if (!d.set(s)) {
			_tmp$6 = 0;
			_tmp$7 = syntaxError("ParseFloat", s);
			f = _tmp$6;
			err = _tmp$7;
			return [f, err];
		}
		_tuple$4 = d.floatBits(float32info);
		b$1 = _tuple$4[0];
		ovf$1 = _tuple$4[1];
		f = math.Float32frombits(((b$1.$low >>> 0)));
		if (ovf$1) {
			err = rangeError("ParseFloat", s);
		}
		_tmp$8 = f;
		_tmp$9 = err;
		f = _tmp$8;
		err = _tmp$9;
		return [f, err];
	};
	atof64 = function(s) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, b, b$1, d, err, exp, ext, f, f$1, mantissa, neg, ok, ok$1, ok$2, ok$3, ovf, ovf$1, s, trunc, val;
		f = 0;
		err = $ifaceNil;
		_tuple = special(s);
		val = _tuple[0];
		ok = _tuple[1];
		if (ok) {
			_tmp = val;
			_tmp$1 = $ifaceNil;
			f = _tmp;
			err = _tmp$1;
			return [f, err];
		}
		if (optimize) {
			_tuple$1 = readFloat(s);
			mantissa = _tuple$1[0];
			exp = _tuple$1[1];
			neg = _tuple$1[2];
			trunc = _tuple$1[3];
			ok$1 = _tuple$1[4];
			if (ok$1) {
				if (!trunc) {
					_tuple$2 = atof64exact(mantissa, exp, neg);
					f$1 = _tuple$2[0];
					ok$2 = _tuple$2[1];
					if (ok$2) {
						_tmp$2 = f$1;
						_tmp$3 = $ifaceNil;
						f = _tmp$2;
						err = _tmp$3;
						return [f, err];
					}
				}
				ext = new extFloat.ptr(new $Uint64(0, 0), 0, false);
				ok$3 = ext.AssignDecimal(mantissa, exp, neg, trunc, float64info);
				if (ok$3) {
					_tuple$3 = ext.floatBits(float64info);
					b = _tuple$3[0];
					ovf = _tuple$3[1];
					f = math.Float64frombits(b);
					if (ovf) {
						err = rangeError("ParseFloat", s);
					}
					_tmp$4 = f;
					_tmp$5 = err;
					f = _tmp$4;
					err = _tmp$5;
					return [f, err];
				}
			}
		}
		d = new decimal.ptr(arrayType.zero(), 0, 0, false, false);
		if (!d.set(s)) {
			_tmp$6 = 0;
			_tmp$7 = syntaxError("ParseFloat", s);
			f = _tmp$6;
			err = _tmp$7;
			return [f, err];
		}
		_tuple$4 = d.floatBits(float64info);
		b$1 = _tuple$4[0];
		ovf$1 = _tuple$4[1];
		f = math.Float64frombits(b$1);
		if (ovf$1) {
			err = rangeError("ParseFloat", s);
		}
		_tmp$8 = f;
		_tmp$9 = err;
		f = _tmp$8;
		err = _tmp$9;
		return [f, err];
	};
	ParseFloat = function(s, bitSize) {
		var _tuple, bitSize, err, f, s;
		if (bitSize === 32) {
			_tuple = atof32(s);
			f = _tuple[0];
			err = _tuple[1];
			return [(f), err];
		}
		return atof64(s);
	};
	$pkg.ParseFloat = ParseFloat;
	NumError.ptr.prototype.Error = function() {
		var _r, e, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		e = this;
		_r = e.Err.Error(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return "strconv." + e.Func + ": " + "parsing " + Quote(e.Num) + ": " + _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: NumError.ptr.prototype.Error }; } $f._r = _r; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
	};
	NumError.prototype.Error = function() { return this.$val.Error(); };
	syntaxError = function(fn, str) {
		var fn, str;
		return new NumError.ptr(fn, str, $pkg.ErrSyntax);
	};
	rangeError = function(fn, str) {
		var fn, str;
		return new NumError.ptr(fn, str, $pkg.ErrRange);
	};
	ParseUint = function(s, base, bitSize) {
		var _1, _tmp, _tmp$1, base, bitSize, cutoff, d, err, i, maxVal, n, n1, s, v, x, x$1, x$2, $s;
		/* */ $s = 0; s: while (true) { switch ($s) { case 0:
		n = new $Uint64(0, 0);
		err = $ifaceNil;
		_tmp = new $Uint64(0, 0);
		_tmp$1 = new $Uint64(0, 0);
		cutoff = _tmp;
		maxVal = _tmp$1;
		if (bitSize === 0) {
			bitSize = 32;
		}
		i = 0;
			/* */ if (s.length < 1) { $s = 2; continue; }
			/* */ if (2 <= base && base <= 36) { $s = 3; continue; }
			/* */ if ((base === 0)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (s.length < 1) { */ case 2:
				err = $pkg.ErrSyntax;
				/* goto Error */ $s = 7; continue;
				$s = 6; continue;
			/* } else if (2 <= base && base <= 36) { */ case 3:
				$s = 6; continue;
			/* } else if ((base === 0)) { */ case 4:
					/* */ if ((s.charCodeAt(0) === 48) && s.length > 1 && ((s.charCodeAt(1) === 120) || (s.charCodeAt(1) === 88))) { $s = 9; continue; }
					/* */ if ((s.charCodeAt(0) === 48)) { $s = 10; continue; }
					/* */ $s = 11; continue;
					/* if ((s.charCodeAt(0) === 48) && s.length > 1 && ((s.charCodeAt(1) === 120) || (s.charCodeAt(1) === 88))) { */ case 9:
						/* */ if (s.length < 3) { $s = 13; continue; }
						/* */ $s = 14; continue;
						/* if (s.length < 3) { */ case 13:
							err = $pkg.ErrSyntax;
							/* goto Error */ $s = 7; continue;
						/* } */ case 14:
						base = 16;
						i = 2;
						$s = 12; continue;
					/* } else if ((s.charCodeAt(0) === 48)) { */ case 10:
						base = 8;
						i = 1;
						$s = 12; continue;
					/* } else { */ case 11:
						base = 10;
					/* } */ case 12:
				case 8:
				$s = 6; continue;
			/* } else { */ case 5:
				err = errors.New("invalid base " + Itoa(base));
				/* goto Error */ $s = 7; continue;
			/* } */ case 6:
		case 1:
		_1 = base;
		if (_1 === (10)) {
			cutoff = new $Uint64(429496729, 2576980378);
		} else if (_1 === (16)) {
			cutoff = new $Uint64(268435456, 0);
		} else {
			cutoff = (x = $div64(new $Uint64(4294967295, 4294967295), (new $Uint64(0, base)), false), new $Uint64(x.$high + 0, x.$low + 1));
		}
		maxVal = (x$1 = $shiftLeft64(new $Uint64(0, 1), ((bitSize >>> 0))), new $Uint64(x$1.$high - 0, x$1.$low - 1));
		/* while (true) { */ case 15:
			/* if (!(i < s.length)) { break; } */ if(!(i < s.length)) { $s = 16; continue; }
			v = 0;
			d = s.charCodeAt(i);
				/* */ if (48 <= d && d <= 57) { $s = 18; continue; }
				/* */ if (97 <= d && d <= 122) { $s = 19; continue; }
				/* */ if (65 <= d && d <= 90) { $s = 20; continue; }
				/* */ $s = 21; continue;
				/* if (48 <= d && d <= 57) { */ case 18:
					v = d - 48 << 24 >>> 24;
					$s = 22; continue;
				/* } else if (97 <= d && d <= 122) { */ case 19:
					v = (d - 97 << 24 >>> 24) + 10 << 24 >>> 24;
					$s = 22; continue;
				/* } else if (65 <= d && d <= 90) { */ case 20:
					v = (d - 65 << 24 >>> 24) + 10 << 24 >>> 24;
					$s = 22; continue;
				/* } else { */ case 21:
					n = new $Uint64(0, 0);
					err = $pkg.ErrSyntax;
					/* goto Error */ $s = 7; continue;
				/* } */ case 22:
			case 17:
			/* */ if (v >= ((base << 24 >>> 24))) { $s = 23; continue; }
			/* */ $s = 24; continue;
			/* if (v >= ((base << 24 >>> 24))) { */ case 23:
				n = new $Uint64(0, 0);
				err = $pkg.ErrSyntax;
				/* goto Error */ $s = 7; continue;
			/* } */ case 24:
			/* */ if ((n.$high > cutoff.$high || (n.$high === cutoff.$high && n.$low >= cutoff.$low))) { $s = 25; continue; }
			/* */ $s = 26; continue;
			/* if ((n.$high > cutoff.$high || (n.$high === cutoff.$high && n.$low >= cutoff.$low))) { */ case 25:
				n = new $Uint64(4294967295, 4294967295);
				err = $pkg.ErrRange;
				/* goto Error */ $s = 7; continue;
			/* } */ case 26:
			n = $mul64(n, ((new $Uint64(0, base))));
			n1 = (x$2 = (new $Uint64(0, v)), new $Uint64(n.$high + x$2.$high, n.$low + x$2.$low));
			/* */ if ((n1.$high < n.$high || (n1.$high === n.$high && n1.$low < n.$low)) || (n1.$high > maxVal.$high || (n1.$high === maxVal.$high && n1.$low > maxVal.$low))) { $s = 27; continue; }
			/* */ $s = 28; continue;
			/* if ((n1.$high < n.$high || (n1.$high === n.$high && n1.$low < n.$low)) || (n1.$high > maxVal.$high || (n1.$high === maxVal.$high && n1.$low > maxVal.$low))) { */ case 27:
				n = new $Uint64(4294967295, 4294967295);
				err = $pkg.ErrRange;
				/* goto Error */ $s = 7; continue;
			/* } */ case 28:
			n = n1;
			i = i + (1) >> 0;
		/* } */ $s = 15; continue; case 16:
		$s = -1; return [n, $ifaceNil];
		/* Error: */ case 7:
		$s = -1; return [n, new NumError.ptr("ParseUint", s, err)];
		$s = -1; return [new $Uint64(0, 0), $ifaceNil];
		/* */ } return; }
	};
	$pkg.ParseUint = ParseUint;
	ParseInt = function(s, base, bitSize) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, base, bitSize, cutoff, err, i, n, neg, s, s0, un, x, x$1;
		i = new $Int64(0, 0);
		err = $ifaceNil;
		if (bitSize === 0) {
			bitSize = 32;
		}
		if (s.length === 0) {
			_tmp = new $Int64(0, 0);
			_tmp$1 = syntaxError("ParseInt", s);
			i = _tmp;
			err = _tmp$1;
			return [i, err];
		}
		s0 = s;
		neg = false;
		if (s.charCodeAt(0) === 43) {
			s = $substring(s, 1);
		} else if (s.charCodeAt(0) === 45) {
			neg = true;
			s = $substring(s, 1);
		}
		un = new $Uint64(0, 0);
		_tuple = ParseUint(s, base, bitSize);
		un = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil)) && !($interfaceIsEqual($assertType(err, ptrType).Err, $pkg.ErrRange))) {
			$assertType(err, ptrType).Func = "ParseInt";
			$assertType(err, ptrType).Num = s0;
			_tmp$2 = new $Int64(0, 0);
			_tmp$3 = err;
			i = _tmp$2;
			err = _tmp$3;
			return [i, err];
		}
		cutoff = ($shiftLeft64(new $Uint64(0, 1), (((bitSize - 1 >> 0) >>> 0))));
		if (!neg && (un.$high > cutoff.$high || (un.$high === cutoff.$high && un.$low >= cutoff.$low))) {
			_tmp$4 = ((x = new $Uint64(cutoff.$high - 0, cutoff.$low - 1), new $Int64(x.$high, x.$low)));
			_tmp$5 = rangeError("ParseInt", s0);
			i = _tmp$4;
			err = _tmp$5;
			return [i, err];
		}
		if (neg && (un.$high > cutoff.$high || (un.$high === cutoff.$high && un.$low > cutoff.$low))) {
			_tmp$6 = (x$1 = (new $Int64(cutoff.$high, cutoff.$low)), new $Int64(-x$1.$high, -x$1.$low));
			_tmp$7 = rangeError("ParseInt", s0);
			i = _tmp$6;
			err = _tmp$7;
			return [i, err];
		}
		n = (new $Int64(un.$high, un.$low));
		if (neg) {
			n = new $Int64(-n.$high, -n.$low);
		}
		_tmp$8 = n;
		_tmp$9 = $ifaceNil;
		i = _tmp$8;
		err = _tmp$9;
		return [i, err];
	};
	$pkg.ParseInt = ParseInt;
	decimal.ptr.prototype.String = function() {
		var a, buf, n, w;
		a = this;
		n = 10 + a.nd >> 0;
		if (a.dp > 0) {
			n = n + (a.dp) >> 0;
		}
		if (a.dp < 0) {
			n = n + (-a.dp) >> 0;
		}
		buf = $makeSlice(sliceType$6, n);
		w = 0;
		if ((a.nd === 0)) {
			return "0";
		} else if (a.dp <= 0) {
			((w < 0 || w >= buf.$length) ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + w] = 48);
			w = w + (1) >> 0;
			((w < 0 || w >= buf.$length) ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + w] = 46);
			w = w + (1) >> 0;
			w = w + (digitZero($subslice(buf, w, (w + -a.dp >> 0)))) >> 0;
			w = w + ($copySlice($subslice(buf, w), $subslice(new sliceType$6(a.d), 0, a.nd))) >> 0;
		} else if (a.dp < a.nd) {
			w = w + ($copySlice($subslice(buf, w), $subslice(new sliceType$6(a.d), 0, a.dp))) >> 0;
			((w < 0 || w >= buf.$length) ? ($throwRuntimeError("index out of range"), undefined) : buf.$array[buf.$offset + w] = 46);
			w = w + (1) >> 0;
			w = w + ($copySlice($subslice(buf, w), $subslice(new sliceType$6(a.d), a.dp, a.nd))) >> 0;
		} else {
			w = w + ($copySlice($subslice(buf, w), $subslice(new sliceType$6(a.d), 0, a.nd))) >> 0;
			w = w + (digitZero($subslice(buf, w, ((w + a.dp >> 0) - a.nd >> 0)))) >> 0;
		}
		return ($bytesToString($subslice(buf, 0, w)));
	};
	decimal.prototype.String = function() { return this.$val.String(); };
	digitZero = function(dst) {
		var _i, _ref, dst, i;
		_ref = dst;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			((i < 0 || i >= dst.$length) ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + i] = 48);
			_i++;
		}
		return dst.$length;
	};
	trim = function(a) {
		var a, x, x$1;
		while (true) {
			if (!(a.nd > 0 && ((x = a.d, x$1 = a.nd - 1 >> 0, ((x$1 < 0 || x$1 >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[x$1])) === 48))) { break; }
			a.nd = a.nd - (1) >> 0;
		}
		if (a.nd === 0) {
			a.dp = 0;
		}
	};
	decimal.ptr.prototype.Assign = function(v) {
		var a, buf, n, v, v1, x, x$1, x$2;
		a = this;
		buf = arrayType$1.zero();
		n = 0;
		while (true) {
			if (!((v.$high > 0 || (v.$high === 0 && v.$low > 0)))) { break; }
			v1 = $div64(v, new $Uint64(0, 10), false);
			v = (x = $mul64(new $Uint64(0, 10), v1), new $Uint64(v.$high - x.$high, v.$low - x.$low));
			((n < 0 || n >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[n] = ((new $Uint64(v.$high + 0, v.$low + 48).$low << 24 >>> 24)));
			n = n + (1) >> 0;
			v = v1;
		}
		a.nd = 0;
		n = n - (1) >> 0;
		while (true) {
			if (!(n >= 0)) { break; }
			(x$1 = a.d, x$2 = a.nd, ((x$2 < 0 || x$2 >= x$1.length) ? ($throwRuntimeError("index out of range"), undefined) : x$1[x$2] = ((n < 0 || n >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[n])));
			a.nd = a.nd + (1) >> 0;
			n = n - (1) >> 0;
		}
		a.dp = a.nd;
		trim(a);
	};
	decimal.prototype.Assign = function(v) { return this.$val.Assign(v); };
	rightShift = function(a, k) {
		var a, c, c$1, dig, dig$1, k, mask, n, r, w, x, x$1, x$2, x$3, y, y$1, y$2, y$3, y$4;
		r = 0;
		w = 0;
		n = 0;
		while (true) {
			if (!(((y = k, y < 32 ? (n >>> y) : 0) >>> 0) === 0)) { break; }
			if (r >= a.nd) {
				if (n === 0) {
					a.nd = 0;
					return;
				}
				while (true) {
					if (!(((y$1 = k, y$1 < 32 ? (n >>> y$1) : 0) >>> 0) === 0)) { break; }
					n = n * 10 >>> 0;
					r = r + (1) >> 0;
				}
				break;
			}
			c = (((x = a.d, ((r < 0 || r >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[r])) >>> 0));
			n = ((n * 10 >>> 0) + c >>> 0) - 48 >>> 0;
			r = r + (1) >> 0;
		}
		a.dp = a.dp - ((r - 1 >> 0)) >> 0;
		mask = (((y$2 = k, y$2 < 32 ? (1 << y$2) : 0) >>> 0)) - 1 >>> 0;
		while (true) {
			if (!(r < a.nd)) { break; }
			c$1 = (((x$1 = a.d, ((r < 0 || r >= x$1.length) ? ($throwRuntimeError("index out of range"), undefined) : x$1[r])) >>> 0));
			dig = (y$3 = k, y$3 < 32 ? (n >>> y$3) : 0) >>> 0;
			n = (n & (mask)) >>> 0;
			(x$2 = a.d, ((w < 0 || w >= x$2.length) ? ($throwRuntimeError("index out of range"), undefined) : x$2[w] = (((dig + 48 >>> 0) << 24 >>> 24))));
			w = w + (1) >> 0;
			n = ((n * 10 >>> 0) + c$1 >>> 0) - 48 >>> 0;
			r = r + (1) >> 0;
		}
		while (true) {
			if (!(n > 0)) { break; }
			dig$1 = (y$4 = k, y$4 < 32 ? (n >>> y$4) : 0) >>> 0;
			n = (n & (mask)) >>> 0;
			if (w < 800) {
				(x$3 = a.d, ((w < 0 || w >= x$3.length) ? ($throwRuntimeError("index out of range"), undefined) : x$3[w] = (((dig$1 + 48 >>> 0) << 24 >>> 24))));
				w = w + (1) >> 0;
			} else if (dig$1 > 0) {
				a.trunc = true;
			}
			n = n * 10 >>> 0;
		}
		a.nd = w;
		trim(a);
	};
	prefixIsLessThan = function(b, s) {
		var b, i, s;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			if (i >= b.$length) {
				return true;
			}
			if (!((((i < 0 || i >= b.$length) ? ($throwRuntimeError("index out of range"), undefined) : b.$array[b.$offset + i]) === s.charCodeAt(i)))) {
				return ((i < 0 || i >= b.$length) ? ($throwRuntimeError("index out of range"), undefined) : b.$array[b.$offset + i]) < s.charCodeAt(i);
			}
			i = i + (1) >> 0;
		}
		return false;
	};
	leftShift = function(a, k) {
		var _q, _q$1, a, delta, k, n, quo, quo$1, r, rem, rem$1, w, x, x$1, x$2, y;
		delta = ((k < 0 || k >= leftcheats.$length) ? ($throwRuntimeError("index out of range"), undefined) : leftcheats.$array[leftcheats.$offset + k]).delta;
		if (prefixIsLessThan($subslice(new sliceType$6(a.d), 0, a.nd), ((k < 0 || k >= leftcheats.$length) ? ($throwRuntimeError("index out of range"), undefined) : leftcheats.$array[leftcheats.$offset + k]).cutoff)) {
			delta = delta - (1) >> 0;
		}
		r = a.nd;
		w = a.nd + delta >> 0;
		n = 0;
		r = r - (1) >> 0;
		while (true) {
			if (!(r >= 0)) { break; }
			n = n + (((y = k, y < 32 ? ((((((x = a.d, ((r < 0 || r >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[r])) >>> 0)) - 48 >>> 0)) << y) : 0) >>> 0)) >>> 0;
			quo = (_q = n / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
			rem = n - (10 * quo >>> 0) >>> 0;
			w = w - (1) >> 0;
			if (w < 800) {
				(x$1 = a.d, ((w < 0 || w >= x$1.length) ? ($throwRuntimeError("index out of range"), undefined) : x$1[w] = (((rem + 48 >>> 0) << 24 >>> 24))));
			} else if (!((rem === 0))) {
				a.trunc = true;
			}
			n = quo;
			r = r - (1) >> 0;
		}
		while (true) {
			if (!(n > 0)) { break; }
			quo$1 = (_q$1 = n / 10, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
			rem$1 = n - (10 * quo$1 >>> 0) >>> 0;
			w = w - (1) >> 0;
			if (w < 800) {
				(x$2 = a.d, ((w < 0 || w >= x$2.length) ? ($throwRuntimeError("index out of range"), undefined) : x$2[w] = (((rem$1 + 48 >>> 0) << 24 >>> 24))));
			} else if (!((rem$1 === 0))) {
				a.trunc = true;
			}
			n = quo$1;
		}
		a.nd = a.nd + (delta) >> 0;
		if (a.nd >= 800) {
			a.nd = 800;
		}
		a.dp = a.dp + (delta) >> 0;
		trim(a);
	};
	decimal.ptr.prototype.Shift = function(k) {
		var a, k;
		a = this;
		if ((a.nd === 0)) {
		} else if (k > 0) {
			while (true) {
				if (!(k > 28)) { break; }
				leftShift(a, 28);
				k = k - (28) >> 0;
			}
			leftShift(a, ((k >>> 0)));
		} else if (k < 0) {
			while (true) {
				if (!(k < -28)) { break; }
				rightShift(a, 28);
				k = k + (28) >> 0;
			}
			rightShift(a, ((-k >>> 0)));
		}
	};
	decimal.prototype.Shift = function(k) { return this.$val.Shift(k); };
	shouldRoundUp = function(a, nd) {
		var _r, a, nd, x, x$1, x$2, x$3;
		if (nd < 0 || nd >= a.nd) {
			return false;
		}
		if (((x = a.d, ((nd < 0 || nd >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[nd])) === 53) && ((nd + 1 >> 0) === a.nd)) {
			if (a.trunc) {
				return true;
			}
			return nd > 0 && !(((_r = (((x$1 = a.d, x$2 = nd - 1 >> 0, ((x$2 < 0 || x$2 >= x$1.length) ? ($throwRuntimeError("index out of range"), undefined) : x$1[x$2])) - 48 << 24 >>> 24)) % 2, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0));
		}
		return (x$3 = a.d, ((nd < 0 || nd >= x$3.length) ? ($throwRuntimeError("index out of range"), undefined) : x$3[nd])) >= 53;
	};
	decimal.ptr.prototype.Round = function(nd) {
		var a, nd;
		a = this;
		if (nd < 0 || nd >= a.nd) {
			return;
		}
		if (shouldRoundUp(a, nd)) {
			a.RoundUp(nd);
		} else {
			a.RoundDown(nd);
		}
	};
	decimal.prototype.Round = function(nd) { return this.$val.Round(nd); };
	decimal.ptr.prototype.RoundDown = function(nd) {
		var a, nd;
		a = this;
		if (nd < 0 || nd >= a.nd) {
			return;
		}
		a.nd = nd;
		trim(a);
	};
	decimal.prototype.RoundDown = function(nd) { return this.$val.RoundDown(nd); };
	decimal.ptr.prototype.RoundUp = function(nd) {
		var a, c, i, nd, x, x$1, x$2;
		a = this;
		if (nd < 0 || nd >= a.nd) {
			return;
		}
		i = nd - 1 >> 0;
		while (true) {
			if (!(i >= 0)) { break; }
			c = (x = a.d, ((i < 0 || i >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[i]));
			if (c < 57) {
				(x$2 = a.d, ((i < 0 || i >= x$2.length) ? ($throwRuntimeError("index out of range"), undefined) : x$2[i] = ((x$1 = a.d, ((i < 0 || i >= x$1.length) ? ($throwRuntimeError("index out of range"), undefined) : x$1[i])) + (1) << 24 >>> 24)));
				a.nd = i + 1 >> 0;
				return;
			}
			i = i - (1) >> 0;
		}
		a.d[0] = 49;
		a.nd = 1;
		a.dp = a.dp + (1) >> 0;
	};
	decimal.prototype.RoundUp = function(nd) { return this.$val.RoundUp(nd); };
	decimal.ptr.prototype.RoundedInteger = function() {
		var a, i, n, x, x$1, x$2, x$3;
		a = this;
		if (a.dp > 20) {
			return new $Uint64(4294967295, 4294967295);
		}
		i = 0;
		n = new $Uint64(0, 0);
		i = 0;
		while (true) {
			if (!(i < a.dp && i < a.nd)) { break; }
			n = (x = $mul64(n, new $Uint64(0, 10)), x$1 = (new $Uint64(0, ((x$2 = a.d, ((i < 0 || i >= x$2.length) ? ($throwRuntimeError("index out of range"), undefined) : x$2[i])) - 48 << 24 >>> 24))), new $Uint64(x.$high + x$1.$high, x.$low + x$1.$low));
			i = i + (1) >> 0;
		}
		while (true) {
			if (!(i < a.dp)) { break; }
			n = $mul64(n, (new $Uint64(0, 10)));
			i = i + (1) >> 0;
		}
		if (shouldRoundUp(a, a.dp)) {
			n = (x$3 = new $Uint64(0, 1), new $Uint64(n.$high + x$3.$high, n.$low + x$3.$low));
		}
		return n;
	};
	decimal.prototype.RoundedInteger = function() { return this.$val.RoundedInteger(); };
	extFloat.ptr.prototype.floatBits = function(flt) {
		var bits, exp, f, flt, mant, n, overflow, x, x$1, x$10, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, y$1, y$2;
		bits = new $Uint64(0, 0);
		overflow = false;
		f = this;
		f.Normalize();
		exp = f.exp + 63 >> 0;
		if (exp < (flt.bias + 1 >> 0)) {
			n = (flt.bias + 1 >> 0) - exp >> 0;
			f.mant = $shiftRightUint64(f.mant, (((n >>> 0))));
			exp = exp + (n) >> 0;
		}
		mant = $shiftRightUint64(f.mant, ((63 - flt.mantbits >>> 0)));
		if (!((x = (x$1 = f.mant, x$2 = $shiftLeft64(new $Uint64(0, 1), ((62 - flt.mantbits >>> 0))), new $Uint64(x$1.$high & x$2.$high, (x$1.$low & x$2.$low) >>> 0)), (x.$high === 0 && x.$low === 0)))) {
			mant = (x$3 = new $Uint64(0, 1), new $Uint64(mant.$high + x$3.$high, mant.$low + x$3.$low));
		}
		if ((x$4 = $shiftLeft64(new $Uint64(0, 2), flt.mantbits), (mant.$high === x$4.$high && mant.$low === x$4.$low))) {
			mant = $shiftRightUint64(mant, (1));
			exp = exp + (1) >> 0;
		}
		if ((exp - flt.bias >> 0) >= (((y = flt.expbits, y < 32 ? (1 << y) : 0) >> 0) - 1 >> 0)) {
			mant = new $Uint64(0, 0);
			exp = (((y$1 = flt.expbits, y$1 < 32 ? (1 << y$1) : 0) >> 0) - 1 >> 0) + flt.bias >> 0;
			overflow = true;
		} else if ((x$5 = (x$6 = $shiftLeft64(new $Uint64(0, 1), flt.mantbits), new $Uint64(mant.$high & x$6.$high, (mant.$low & x$6.$low) >>> 0)), (x$5.$high === 0 && x$5.$low === 0))) {
			exp = flt.bias;
		}
		bits = (x$7 = (x$8 = $shiftLeft64(new $Uint64(0, 1), flt.mantbits), new $Uint64(x$8.$high - 0, x$8.$low - 1)), new $Uint64(mant.$high & x$7.$high, (mant.$low & x$7.$low) >>> 0));
		bits = (x$9 = $shiftLeft64((new $Uint64(0, (((exp - flt.bias >> 0)) & ((((y$2 = flt.expbits, y$2 < 32 ? (1 << y$2) : 0) >> 0) - 1 >> 0))))), flt.mantbits), new $Uint64(bits.$high | x$9.$high, (bits.$low | x$9.$low) >>> 0));
		if (f.neg) {
			bits = (x$10 = $shiftLeft64(new $Uint64(0, 1), ((flt.mantbits + flt.expbits >>> 0))), new $Uint64(bits.$high | x$10.$high, (bits.$low | x$10.$low) >>> 0));
		}
		return [bits, overflow];
	};
	extFloat.prototype.floatBits = function(flt) { return this.$val.floatBits(flt); };
	extFloat.ptr.prototype.AssignComputeBounds = function(mant, exp, neg, flt) {
		var _tmp, _tmp$1, exp, expBiased, f, flt, lower, mant, neg, upper, x, x$1, x$2, x$3, x$4;
		lower = new extFloat.ptr(new $Uint64(0, 0), 0, false);
		upper = new extFloat.ptr(new $Uint64(0, 0), 0, false);
		f = this;
		f.mant = mant;
		f.exp = exp - ((flt.mantbits >> 0)) >> 0;
		f.neg = neg;
		if (f.exp <= 0 && (x = $shiftLeft64(($shiftRightUint64(mant, ((-f.exp >>> 0)))), ((-f.exp >>> 0))), (mant.$high === x.$high && mant.$low === x.$low))) {
			f.mant = $shiftRightUint64(f.mant, (((-f.exp >>> 0))));
			f.exp = 0;
			_tmp = $clone(f, extFloat);
			_tmp$1 = $clone(f, extFloat);
			extFloat.copy(lower, _tmp);
			extFloat.copy(upper, _tmp$1);
			return [lower, upper];
		}
		expBiased = exp - flt.bias >> 0;
		extFloat.copy(upper, new extFloat.ptr((x$1 = $mul64(new $Uint64(0, 2), f.mant), new $Uint64(x$1.$high + 0, x$1.$low + 1)), f.exp - 1 >> 0, f.neg));
		if (!((x$2 = $shiftLeft64(new $Uint64(0, 1), flt.mantbits), (mant.$high === x$2.$high && mant.$low === x$2.$low))) || (expBiased === 1)) {
			extFloat.copy(lower, new extFloat.ptr((x$3 = $mul64(new $Uint64(0, 2), f.mant), new $Uint64(x$3.$high - 0, x$3.$low - 1)), f.exp - 1 >> 0, f.neg));
		} else {
			extFloat.copy(lower, new extFloat.ptr((x$4 = $mul64(new $Uint64(0, 4), f.mant), new $Uint64(x$4.$high - 0, x$4.$low - 1)), f.exp - 2 >> 0, f.neg));
		}
		return [lower, upper];
	};
	extFloat.prototype.AssignComputeBounds = function(mant, exp, neg, flt) { return this.$val.AssignComputeBounds(mant, exp, neg, flt); };
	extFloat.ptr.prototype.Normalize = function() {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, exp, f, mant, shift, x, x$1, x$2, x$3, x$4, x$5;
		shift = 0;
		f = this;
		_tmp = f.mant;
		_tmp$1 = f.exp;
		mant = _tmp;
		exp = _tmp$1;
		if ((mant.$high === 0 && mant.$low === 0)) {
			shift = 0;
			return shift;
		}
		if ((x = $shiftRightUint64(mant, 32), (x.$high === 0 && x.$low === 0))) {
			mant = $shiftLeft64(mant, (32));
			exp = exp - (32) >> 0;
		}
		if ((x$1 = $shiftRightUint64(mant, 48), (x$1.$high === 0 && x$1.$low === 0))) {
			mant = $shiftLeft64(mant, (16));
			exp = exp - (16) >> 0;
		}
		if ((x$2 = $shiftRightUint64(mant, 56), (x$2.$high === 0 && x$2.$low === 0))) {
			mant = $shiftLeft64(mant, (8));
			exp = exp - (8) >> 0;
		}
		if ((x$3 = $shiftRightUint64(mant, 60), (x$3.$high === 0 && x$3.$low === 0))) {
			mant = $shiftLeft64(mant, (4));
			exp = exp - (4) >> 0;
		}
		if ((x$4 = $shiftRightUint64(mant, 62), (x$4.$high === 0 && x$4.$low === 0))) {
			mant = $shiftLeft64(mant, (2));
			exp = exp - (2) >> 0;
		}
		if ((x$5 = $shiftRightUint64(mant, 63), (x$5.$high === 0 && x$5.$low === 0))) {
			mant = $shiftLeft64(mant, (1));
			exp = exp - (1) >> 0;
		}
		shift = (((f.exp - exp >> 0) >>> 0));
		_tmp$2 = mant;
		_tmp$3 = exp;
		f.mant = _tmp$2;
		f.exp = _tmp$3;
		return shift;
	};
	extFloat.prototype.Normalize = function() { return this.$val.Normalize(); };
	extFloat.ptr.prototype.Multiply = function(g) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, cross1, cross2, f, fhi, flo, g, ghi, glo, rem, x, x$1, x$10, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		f = this;
		_tmp = $shiftRightUint64(f.mant, 32);
		_tmp$1 = (new $Uint64(0, ((f.mant.$low >>> 0))));
		fhi = _tmp;
		flo = _tmp$1;
		_tmp$2 = $shiftRightUint64(g.mant, 32);
		_tmp$3 = (new $Uint64(0, ((g.mant.$low >>> 0))));
		ghi = _tmp$2;
		glo = _tmp$3;
		cross1 = $mul64(fhi, glo);
		cross2 = $mul64(flo, ghi);
		f.mant = (x = (x$1 = $mul64(fhi, ghi), x$2 = $shiftRightUint64(cross1, 32), new $Uint64(x$1.$high + x$2.$high, x$1.$low + x$2.$low)), x$3 = $shiftRightUint64(cross2, 32), new $Uint64(x.$high + x$3.$high, x.$low + x$3.$low));
		rem = (x$4 = (x$5 = (new $Uint64(0, ((cross1.$low >>> 0)))), x$6 = (new $Uint64(0, ((cross2.$low >>> 0)))), new $Uint64(x$5.$high + x$6.$high, x$5.$low + x$6.$low)), x$7 = $shiftRightUint64(($mul64(flo, glo)), 32), new $Uint64(x$4.$high + x$7.$high, x$4.$low + x$7.$low));
		rem = (x$8 = new $Uint64(0, 2147483648), new $Uint64(rem.$high + x$8.$high, rem.$low + x$8.$low));
		f.mant = (x$9 = f.mant, x$10 = ($shiftRightUint64(rem, 32)), new $Uint64(x$9.$high + x$10.$high, x$9.$low + x$10.$low));
		f.exp = (f.exp + g.exp >> 0) + 64 >> 0;
	};
	extFloat.prototype.Multiply = function(g) { return this.$val.Multiply(g); };
	extFloat.ptr.prototype.AssignDecimal = function(mantissa, exp10, neg, trunc, flt) {
		var _q, _r, adjExp, denormalExp, errors$1, exp10, extrabits, f, flt, halfway, i, mant_extra, mantissa, neg, ok, shift, trunc, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y;
		ok = false;
		f = this;
		errors$1 = 0;
		if (trunc) {
			errors$1 = errors$1 + (4) >> 0;
		}
		f.mant = mantissa;
		f.exp = 0;
		f.neg = neg;
		i = (_q = ((exp10 - -348 >> 0)) / 8, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		if (exp10 < -348 || i >= 87) {
			ok = false;
			return ok;
		}
		adjExp = (_r = ((exp10 - -348 >> 0)) % 8, _r === _r ? _r : $throwRuntimeError("integer divide by zero"));
		if (adjExp < 19 && (x = (x$1 = 19 - adjExp >> 0, ((x$1 < 0 || x$1 >= uint64pow10.length) ? ($throwRuntimeError("index out of range"), undefined) : uint64pow10[x$1])), (mantissa.$high < x.$high || (mantissa.$high === x.$high && mantissa.$low < x.$low)))) {
			f.mant = $mul64(f.mant, (((adjExp < 0 || adjExp >= uint64pow10.length) ? ($throwRuntimeError("index out of range"), undefined) : uint64pow10[adjExp])));
			f.Normalize();
		} else {
			f.Normalize();
			f.Multiply($clone(((adjExp < 0 || adjExp >= smallPowersOfTen.length) ? ($throwRuntimeError("index out of range"), undefined) : smallPowersOfTen[adjExp]), extFloat));
			errors$1 = errors$1 + (4) >> 0;
		}
		f.Multiply($clone(((i < 0 || i >= powersOfTen.length) ? ($throwRuntimeError("index out of range"), undefined) : powersOfTen[i]), extFloat));
		if (errors$1 > 0) {
			errors$1 = errors$1 + (1) >> 0;
		}
		errors$1 = errors$1 + (4) >> 0;
		shift = f.Normalize();
		errors$1 = (y = (shift), y < 32 ? (errors$1 << y) : 0) >> 0;
		denormalExp = flt.bias - 63 >> 0;
		extrabits = 0;
		if (f.exp <= denormalExp) {
			extrabits = ((63 - flt.mantbits >>> 0) + 1 >>> 0) + (((denormalExp - f.exp >> 0) >>> 0)) >>> 0;
		} else {
			extrabits = 63 - flt.mantbits >>> 0;
		}
		halfway = $shiftLeft64(new $Uint64(0, 1), ((extrabits - 1 >>> 0)));
		mant_extra = (x$2 = f.mant, x$3 = (x$4 = $shiftLeft64(new $Uint64(0, 1), extrabits), new $Uint64(x$4.$high - 0, x$4.$low - 1)), new $Uint64(x$2.$high & x$3.$high, (x$2.$low & x$3.$low) >>> 0));
		if ((x$5 = (x$6 = (new $Int64(halfway.$high, halfway.$low)), x$7 = (new $Int64(0, errors$1)), new $Int64(x$6.$high - x$7.$high, x$6.$low - x$7.$low)), x$8 = (new $Int64(mant_extra.$high, mant_extra.$low)), (x$5.$high < x$8.$high || (x$5.$high === x$8.$high && x$5.$low < x$8.$low))) && (x$9 = (new $Int64(mant_extra.$high, mant_extra.$low)), x$10 = (x$11 = (new $Int64(halfway.$high, halfway.$low)), x$12 = (new $Int64(0, errors$1)), new $Int64(x$11.$high + x$12.$high, x$11.$low + x$12.$low)), (x$9.$high < x$10.$high || (x$9.$high === x$10.$high && x$9.$low < x$10.$low)))) {
			ok = false;
			return ok;
		}
		ok = true;
		return ok;
	};
	extFloat.prototype.AssignDecimal = function(mantissa, exp10, neg, trunc, flt) { return this.$val.AssignDecimal(mantissa, exp10, neg, trunc, flt); };
	extFloat.ptr.prototype.frexp10 = function() {
		var _q, _q$1, _tmp, _tmp$1, approxExp10, exp, exp10, f, i, index;
		exp10 = 0;
		index = 0;
		f = this;
		approxExp10 = (_q = ($imul(((-46 - f.exp >> 0)), 28)) / 93, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		i = (_q$1 = ((approxExp10 - -348 >> 0)) / 8, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
		Loop:
		while (true) {
			exp = (f.exp + ((i < 0 || i >= powersOfTen.length) ? ($throwRuntimeError("index out of range"), undefined) : powersOfTen[i]).exp >> 0) + 64 >> 0;
			if (exp < -60) {
				i = i + (1) >> 0;
			} else if (exp > -32) {
				i = i - (1) >> 0;
			} else {
				break Loop;
			}
		}
		f.Multiply($clone(((i < 0 || i >= powersOfTen.length) ? ($throwRuntimeError("index out of range"), undefined) : powersOfTen[i]), extFloat));
		_tmp = -((-348 + ($imul(i, 8)) >> 0));
		_tmp$1 = i;
		exp10 = _tmp;
		index = _tmp$1;
		return [exp10, index];
	};
	extFloat.prototype.frexp10 = function() { return this.$val.frexp10(); };
	frexp10Many = function(a, b, c) {
		var _tuple, a, b, c, exp10, i;
		exp10 = 0;
		_tuple = c.frexp10();
		exp10 = _tuple[0];
		i = _tuple[1];
		a.Multiply($clone(((i < 0 || i >= powersOfTen.length) ? ($throwRuntimeError("index out of range"), undefined) : powersOfTen[i]), extFloat));
		b.Multiply($clone(((i < 0 || i >= powersOfTen.length) ? ($throwRuntimeError("index out of range"), undefined) : powersOfTen[i]), extFloat));
		return exp10;
	};
	extFloat.ptr.prototype.FixedDecimal = function(d, n) {
		var $CE$B5, _q, _q$1, _tmp, _tmp$1, _tuple, buf, d, digit, exp10, f, fraction, i, i$1, i$2, integer, integerDigits, n, nd, needed, ok, pos, pow, pow10, rest, shift, v, v1, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		f = this;
		if ((x = f.mant, (x.$high === 0 && x.$low === 0))) {
			d.nd = 0;
			d.dp = 0;
			d.neg = f.neg;
			return true;
		}
		if (n === 0) {
			$panic(new $String("strconv: internal error: extFloat.FixedDecimal called with n == 0"));
		}
		f.Normalize();
		_tuple = f.frexp10();
		exp10 = _tuple[0];
		shift = ((-f.exp >>> 0));
		integer = (($shiftRightUint64(f.mant, shift).$low >>> 0));
		fraction = (x$1 = f.mant, x$2 = $shiftLeft64((new $Uint64(0, integer)), shift), new $Uint64(x$1.$high - x$2.$high, x$1.$low - x$2.$low));
		$CE$B5 = new $Uint64(0, 1);
		needed = n;
		integerDigits = 0;
		pow10 = new $Uint64(0, 1);
		_tmp = 0;
		_tmp$1 = new $Uint64(0, 1);
		i = _tmp;
		pow = _tmp$1;
		while (true) {
			if (!(i < 20)) { break; }
			if ((x$3 = (new $Uint64(0, integer)), (pow.$high > x$3.$high || (pow.$high === x$3.$high && pow.$low > x$3.$low)))) {
				integerDigits = i;
				break;
			}
			pow = $mul64(pow, (new $Uint64(0, 10)));
			i = i + (1) >> 0;
		}
		rest = integer;
		if (integerDigits > needed) {
			pow10 = (x$4 = integerDigits - needed >> 0, ((x$4 < 0 || x$4 >= uint64pow10.length) ? ($throwRuntimeError("index out of range"), undefined) : uint64pow10[x$4]));
			integer = (_q = integer / (((pow10.$low >>> 0))), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
			rest = rest - (($imul(integer, ((pow10.$low >>> 0))) >>> 0)) >>> 0;
		} else {
			rest = 0;
		}
		buf = arrayType$2.zero();
		pos = 32;
		v = integer;
		while (true) {
			if (!(v > 0)) { break; }
			v1 = (_q$1 = v / 10, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
			v = v - (($imul(10, v1) >>> 0)) >>> 0;
			pos = pos - (1) >> 0;
			((pos < 0 || pos >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[pos] = (((v + 48 >>> 0) << 24 >>> 24)));
			v = v1;
		}
		i$1 = pos;
		while (true) {
			if (!(i$1 < 32)) { break; }
			(x$5 = d.d, x$6 = i$1 - pos >> 0, ((x$6 < 0 || x$6 >= x$5.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$5.$array[x$5.$offset + x$6] = ((i$1 < 0 || i$1 >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[i$1])));
			i$1 = i$1 + (1) >> 0;
		}
		nd = 32 - pos >> 0;
		d.nd = nd;
		d.dp = integerDigits + exp10 >> 0;
		needed = needed - (nd) >> 0;
		if (needed > 0) {
			if (!((rest === 0)) || !((pow10.$high === 0 && pow10.$low === 1))) {
				$panic(new $String("strconv: internal error, rest != 0 but needed > 0"));
			}
			while (true) {
				if (!(needed > 0)) { break; }
				fraction = $mul64(fraction, (new $Uint64(0, 10)));
				$CE$B5 = $mul64($CE$B5, (new $Uint64(0, 10)));
				if ((x$7 = $mul64(new $Uint64(0, 2), $CE$B5), x$8 = $shiftLeft64(new $Uint64(0, 1), shift), (x$7.$high > x$8.$high || (x$7.$high === x$8.$high && x$7.$low > x$8.$low)))) {
					return false;
				}
				digit = $shiftRightUint64(fraction, shift);
				(x$9 = d.d, ((nd < 0 || nd >= x$9.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$9.$array[x$9.$offset + nd] = ((new $Uint64(digit.$high + 0, digit.$low + 48).$low << 24 >>> 24))));
				fraction = (x$10 = $shiftLeft64(digit, shift), new $Uint64(fraction.$high - x$10.$high, fraction.$low - x$10.$low));
				nd = nd + (1) >> 0;
				needed = needed - (1) >> 0;
			}
			d.nd = nd;
		}
		ok = adjustLastDigitFixed(d, (x$11 = $shiftLeft64((new $Uint64(0, rest)), shift), new $Uint64(x$11.$high | fraction.$high, (x$11.$low | fraction.$low) >>> 0)), pow10, shift, $CE$B5);
		if (!ok) {
			return false;
		}
		i$2 = d.nd - 1 >> 0;
		while (true) {
			if (!(i$2 >= 0)) { break; }
			if (!(((x$12 = d.d, ((i$2 < 0 || i$2 >= x$12.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$12.$array[x$12.$offset + i$2])) === 48))) {
				d.nd = i$2 + 1 >> 0;
				break;
			}
			i$2 = i$2 - (1) >> 0;
		}
		return true;
	};
	extFloat.prototype.FixedDecimal = function(d, n) { return this.$val.FixedDecimal(d, n); };
	adjustLastDigitFixed = function(d, num, den, shift, $CE$B5) {
		var $CE$B5, d, den, i, num, shift, x, x$1, x$10, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		if ((x = $shiftLeft64(den, shift), (num.$high > x.$high || (num.$high === x.$high && num.$low > x.$low)))) {
			$panic(new $String("strconv: num > den<<shift in adjustLastDigitFixed"));
		}
		if ((x$1 = $mul64(new $Uint64(0, 2), $CE$B5), x$2 = $shiftLeft64(den, shift), (x$1.$high > x$2.$high || (x$1.$high === x$2.$high && x$1.$low > x$2.$low)))) {
			$panic(new $String("strconv: \xCE\xB5 > (den<<shift)/2"));
		}
		if ((x$3 = $mul64(new $Uint64(0, 2), (new $Uint64(num.$high + $CE$B5.$high, num.$low + $CE$B5.$low))), x$4 = $shiftLeft64(den, shift), (x$3.$high < x$4.$high || (x$3.$high === x$4.$high && x$3.$low < x$4.$low)))) {
			return true;
		}
		if ((x$5 = $mul64(new $Uint64(0, 2), (new $Uint64(num.$high - $CE$B5.$high, num.$low - $CE$B5.$low))), x$6 = $shiftLeft64(den, shift), (x$5.$high > x$6.$high || (x$5.$high === x$6.$high && x$5.$low > x$6.$low)))) {
			i = d.nd - 1 >> 0;
			while (true) {
				if (!(i >= 0)) { break; }
				if ((x$7 = d.d, ((i < 0 || i >= x$7.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$7.$array[x$7.$offset + i])) === 57) {
					d.nd = d.nd - (1) >> 0;
				} else {
					break;
				}
				i = i - (1) >> 0;
			}
			if (i < 0) {
				(x$8 = d.d, (0 >= x$8.$length ? ($throwRuntimeError("index out of range"), undefined) : x$8.$array[x$8.$offset + 0] = 49));
				d.nd = 1;
				d.dp = d.dp + (1) >> 0;
			} else {
				(x$10 = d.d, ((i < 0 || i >= x$10.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$10.$array[x$10.$offset + i] = ((x$9 = d.d, ((i < 0 || i >= x$9.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$9.$array[x$9.$offset + i])) + (1) << 24 >>> 24)));
			}
			return true;
		}
		return false;
	};
	extFloat.ptr.prototype.ShortestDecimal = function(d, lower, upper) {
		var _q, _tmp, _tmp$1, _tmp$2, _tmp$3, allowance, buf, currentDiff, d, digit, digit$1, exp10, f, fraction, i, i$1, i$2, integer, integerDigits, lower, multiplier, n, nd, pow, pow$1, shift, targetDiff, upper, v, v1, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$17, x$18, x$19, x$2, x$20, x$21, x$22, x$23, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		f = this;
		if ((x = f.mant, (x.$high === 0 && x.$low === 0))) {
			d.nd = 0;
			d.dp = 0;
			d.neg = f.neg;
			return true;
		}
		if ((f.exp === 0) && $equal(lower, f, extFloat) && $equal(lower, upper, extFloat)) {
			buf = arrayType$1.zero();
			n = 23;
			v = f.mant;
			while (true) {
				if (!((v.$high > 0 || (v.$high === 0 && v.$low > 0)))) { break; }
				v1 = $div64(v, new $Uint64(0, 10), false);
				v = (x$1 = $mul64(new $Uint64(0, 10), v1), new $Uint64(v.$high - x$1.$high, v.$low - x$1.$low));
				((n < 0 || n >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[n] = ((new $Uint64(v.$high + 0, v.$low + 48).$low << 24 >>> 24)));
				n = n - (1) >> 0;
				v = v1;
			}
			nd = (24 - n >> 0) - 1 >> 0;
			i = 0;
			while (true) {
				if (!(i < nd)) { break; }
				(x$3 = d.d, ((i < 0 || i >= x$3.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$3.$array[x$3.$offset + i] = (x$2 = (n + 1 >> 0) + i >> 0, ((x$2 < 0 || x$2 >= buf.length) ? ($throwRuntimeError("index out of range"), undefined) : buf[x$2]))));
				i = i + (1) >> 0;
			}
			_tmp = nd;
			_tmp$1 = nd;
			d.nd = _tmp;
			d.dp = _tmp$1;
			while (true) {
				if (!(d.nd > 0 && ((x$4 = d.d, x$5 = d.nd - 1 >> 0, ((x$5 < 0 || x$5 >= x$4.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$4.$array[x$4.$offset + x$5])) === 48))) { break; }
				d.nd = d.nd - (1) >> 0;
			}
			if (d.nd === 0) {
				d.dp = 0;
			}
			d.neg = f.neg;
			return true;
		}
		upper.Normalize();
		if (f.exp > upper.exp) {
			f.mant = $shiftLeft64(f.mant, ((((f.exp - upper.exp >> 0) >>> 0))));
			f.exp = upper.exp;
		}
		if (lower.exp > upper.exp) {
			lower.mant = $shiftLeft64(lower.mant, ((((lower.exp - upper.exp >> 0) >>> 0))));
			lower.exp = upper.exp;
		}
		exp10 = frexp10Many(lower, f, upper);
		upper.mant = (x$6 = upper.mant, x$7 = new $Uint64(0, 1), new $Uint64(x$6.$high + x$7.$high, x$6.$low + x$7.$low));
		lower.mant = (x$8 = lower.mant, x$9 = new $Uint64(0, 1), new $Uint64(x$8.$high - x$9.$high, x$8.$low - x$9.$low));
		shift = ((-upper.exp >>> 0));
		integer = (($shiftRightUint64(upper.mant, shift).$low >>> 0));
		fraction = (x$10 = upper.mant, x$11 = $shiftLeft64((new $Uint64(0, integer)), shift), new $Uint64(x$10.$high - x$11.$high, x$10.$low - x$11.$low));
		allowance = (x$12 = upper.mant, x$13 = lower.mant, new $Uint64(x$12.$high - x$13.$high, x$12.$low - x$13.$low));
		targetDiff = (x$14 = upper.mant, x$15 = f.mant, new $Uint64(x$14.$high - x$15.$high, x$14.$low - x$15.$low));
		integerDigits = 0;
		_tmp$2 = 0;
		_tmp$3 = new $Uint64(0, 1);
		i$1 = _tmp$2;
		pow = _tmp$3;
		while (true) {
			if (!(i$1 < 20)) { break; }
			if ((x$16 = (new $Uint64(0, integer)), (pow.$high > x$16.$high || (pow.$high === x$16.$high && pow.$low > x$16.$low)))) {
				integerDigits = i$1;
				break;
			}
			pow = $mul64(pow, (new $Uint64(0, 10)));
			i$1 = i$1 + (1) >> 0;
		}
		i$2 = 0;
		while (true) {
			if (!(i$2 < integerDigits)) { break; }
			pow$1 = (x$17 = (integerDigits - i$2 >> 0) - 1 >> 0, ((x$17 < 0 || x$17 >= uint64pow10.length) ? ($throwRuntimeError("index out of range"), undefined) : uint64pow10[x$17]));
			digit = (_q = integer / ((pow$1.$low >>> 0)), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
			(x$18 = d.d, ((i$2 < 0 || i$2 >= x$18.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$18.$array[x$18.$offset + i$2] = (((digit + 48 >>> 0) << 24 >>> 24))));
			integer = integer - (($imul(digit, ((pow$1.$low >>> 0))) >>> 0)) >>> 0;
			currentDiff = (x$19 = $shiftLeft64((new $Uint64(0, integer)), shift), new $Uint64(x$19.$high + fraction.$high, x$19.$low + fraction.$low));
			if ((currentDiff.$high < allowance.$high || (currentDiff.$high === allowance.$high && currentDiff.$low < allowance.$low))) {
				d.nd = i$2 + 1 >> 0;
				d.dp = integerDigits + exp10 >> 0;
				d.neg = f.neg;
				return adjustLastDigit(d, currentDiff, targetDiff, allowance, $shiftLeft64(pow$1, shift), new $Uint64(0, 2));
			}
			i$2 = i$2 + (1) >> 0;
		}
		d.nd = integerDigits;
		d.dp = d.nd + exp10 >> 0;
		d.neg = f.neg;
		digit$1 = 0;
		multiplier = new $Uint64(0, 1);
		while (true) {
			fraction = $mul64(fraction, (new $Uint64(0, 10)));
			multiplier = $mul64(multiplier, (new $Uint64(0, 10)));
			digit$1 = (($shiftRightUint64(fraction, shift).$low >> 0));
			(x$20 = d.d, x$21 = d.nd, ((x$21 < 0 || x$21 >= x$20.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$20.$array[x$20.$offset + x$21] = (((digit$1 + 48 >> 0) << 24 >>> 24))));
			d.nd = d.nd + (1) >> 0;
			fraction = (x$22 = $shiftLeft64((new $Uint64(0, digit$1)), shift), new $Uint64(fraction.$high - x$22.$high, fraction.$low - x$22.$low));
			if ((x$23 = $mul64(allowance, multiplier), (fraction.$high < x$23.$high || (fraction.$high === x$23.$high && fraction.$low < x$23.$low)))) {
				return adjustLastDigit(d, fraction, $mul64(targetDiff, multiplier), $mul64(allowance, multiplier), $shiftLeft64(new $Uint64(0, 1), shift), $mul64(multiplier, new $Uint64(0, 2)));
			}
		}
	};
	extFloat.prototype.ShortestDecimal = function(d, lower, upper) { return this.$val.ShortestDecimal(d, lower, upper); };
	adjustLastDigit = function(d, currentDiff, targetDiff, maxDiff, ulpDecimal, ulpBinary) {
		var _index, currentDiff, d, maxDiff, targetDiff, ulpBinary, ulpDecimal, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		if ((x = $mul64(new $Uint64(0, 2), ulpBinary), (ulpDecimal.$high < x.$high || (ulpDecimal.$high === x.$high && ulpDecimal.$low < x.$low)))) {
			return false;
		}
		while (true) {
			if (!((x$1 = (x$2 = (x$3 = $div64(ulpDecimal, new $Uint64(0, 2), false), new $Uint64(currentDiff.$high + x$3.$high, currentDiff.$low + x$3.$low)), new $Uint64(x$2.$high + ulpBinary.$high, x$2.$low + ulpBinary.$low)), (x$1.$high < targetDiff.$high || (x$1.$high === targetDiff.$high && x$1.$low < targetDiff.$low))))) { break; }
			_index = d.nd - 1 >> 0;
			(x$5 = d.d, ((_index < 0 || _index >= x$5.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$5.$array[x$5.$offset + _index] = ((x$4 = d.d, ((_index < 0 || _index >= x$4.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$4.$array[x$4.$offset + _index])) - (1) << 24 >>> 24)));
			currentDiff = (x$6 = ulpDecimal, new $Uint64(currentDiff.$high + x$6.$high, currentDiff.$low + x$6.$low));
		}
		if ((x$7 = new $Uint64(currentDiff.$high + ulpDecimal.$high, currentDiff.$low + ulpDecimal.$low), x$8 = (x$9 = (x$10 = $div64(ulpDecimal, new $Uint64(0, 2), false), new $Uint64(targetDiff.$high + x$10.$high, targetDiff.$low + x$10.$low)), new $Uint64(x$9.$high + ulpBinary.$high, x$9.$low + ulpBinary.$low)), (x$7.$high < x$8.$high || (x$7.$high === x$8.$high && x$7.$low <= x$8.$low)))) {
			return false;
		}
		if ((currentDiff.$high < ulpBinary.$high || (currentDiff.$high === ulpBinary.$high && currentDiff.$low < ulpBinary.$low)) || (x$11 = new $Uint64(maxDiff.$high - ulpBinary.$high, maxDiff.$low - ulpBinary.$low), (currentDiff.$high > x$11.$high || (currentDiff.$high === x$11.$high && currentDiff.$low > x$11.$low)))) {
			return false;
		}
		if ((d.nd === 1) && ((x$12 = d.d, (0 >= x$12.$length ? ($throwRuntimeError("index out of range"), undefined) : x$12.$array[x$12.$offset + 0])) === 48)) {
			d.nd = 0;
			d.dp = 0;
		}
		return true;
	};
	FormatFloat = function(f, fmt, prec, bitSize) {
		var bitSize, f, fmt, prec;
		return ($bytesToString(genericFtoa($makeSlice(sliceType$6, 0, max(prec + 4 >> 0, 24)), f, fmt, prec, bitSize)));
	};
	$pkg.FormatFloat = FormatFloat;
	genericFtoa = function(dst, val, fmt, prec, bitSize) {
		var _1, _2, _3, _4, _tuple, bitSize, bits, buf, buf$1, digits, digs, dst, exp, f, f$1, flt, fmt, lower, mant, neg, ok, prec, s, shortest, upper, val, x, x$1, x$2, x$3, y, y$1;
		bits = new $Uint64(0, 0);
		flt = ptrType$1.nil;
		_1 = bitSize;
		if (_1 === (32)) {
			bits = (new $Uint64(0, math.Float32bits(($fround(val)))));
			flt = float32info;
		} else if (_1 === (64)) {
			bits = math.Float64bits(val);
			flt = float64info;
		} else {
			$panic(new $String("strconv: illegal AppendFloat/FormatFloat bitSize"));
		}
		neg = !((x = $shiftRightUint64(bits, ((flt.expbits + flt.mantbits >>> 0))), (x.$high === 0 && x.$low === 0)));
		exp = (($shiftRightUint64(bits, flt.mantbits).$low >> 0)) & ((((y = flt.expbits, y < 32 ? (1 << y) : 0) >> 0) - 1 >> 0));
		mant = (x$1 = (x$2 = $shiftLeft64(new $Uint64(0, 1), flt.mantbits), new $Uint64(x$2.$high - 0, x$2.$low - 1)), new $Uint64(bits.$high & x$1.$high, (bits.$low & x$1.$low) >>> 0));
		_2 = exp;
		if (_2 === ((((y$1 = flt.expbits, y$1 < 32 ? (1 << y$1) : 0) >> 0) - 1 >> 0))) {
			s = "";
			if (!((mant.$high === 0 && mant.$low === 0))) {
				s = "NaN";
			} else if (neg) {
				s = "-Inf";
			} else {
				s = "+Inf";
			}
			return $appendSlice(dst, s);
		} else if (_2 === (0)) {
			exp = exp + (1) >> 0;
		} else {
			mant = (x$3 = $shiftLeft64(new $Uint64(0, 1), flt.mantbits), new $Uint64(mant.$high | x$3.$high, (mant.$low | x$3.$low) >>> 0));
		}
		exp = exp + (flt.bias) >> 0;
		if (fmt === 98) {
			return fmtB(dst, neg, mant, exp, flt);
		}
		if (!optimize) {
			return bigFtoa(dst, prec, fmt, neg, mant, exp, flt);
		}
		digs = new decimalSlice.ptr(sliceType$6.nil, 0, 0, false);
		ok = false;
		shortest = prec < 0;
		if (shortest) {
			f = new extFloat.ptr(new $Uint64(0, 0), 0, false);
			_tuple = f.AssignComputeBounds(mant, exp, neg, flt);
			lower = $clone(_tuple[0], extFloat);
			upper = $clone(_tuple[1], extFloat);
			buf = arrayType$2.zero();
			digs.d = new sliceType$6(buf);
			ok = f.ShortestDecimal(digs, lower, upper);
			if (!ok) {
				return bigFtoa(dst, prec, fmt, neg, mant, exp, flt);
			}
			_3 = fmt;
			if ((_3 === (101)) || (_3 === (69))) {
				prec = max(digs.nd - 1 >> 0, 0);
			} else if (_3 === (102)) {
				prec = max(digs.nd - digs.dp >> 0, 0);
			} else if ((_3 === (103)) || (_3 === (71))) {
				prec = digs.nd;
			}
		} else if (!((fmt === 102))) {
			digits = prec;
			_4 = fmt;
			if ((_4 === (101)) || (_4 === (69))) {
				digits = digits + (1) >> 0;
			} else if ((_4 === (103)) || (_4 === (71))) {
				if (prec === 0) {
					prec = 1;
				}
				digits = prec;
			}
			if (digits <= 15) {
				buf$1 = arrayType$1.zero();
				digs.d = new sliceType$6(buf$1);
				f$1 = new extFloat.ptr(mant, exp - ((flt.mantbits >> 0)) >> 0, neg);
				ok = f$1.FixedDecimal(digs, digits);
			}
		}
		if (!ok) {
			return bigFtoa(dst, prec, fmt, neg, mant, exp, flt);
		}
		return formatDigits(dst, shortest, neg, $clone(digs, decimalSlice), prec, fmt);
	};
	bigFtoa = function(dst, prec, fmt, neg, mant, exp, flt) {
		var _1, _2, d, digs, dst, exp, flt, fmt, mant, neg, prec, shortest;
		d = new decimal.ptr(arrayType.zero(), 0, 0, false, false);
		d.Assign(mant);
		d.Shift(exp - ((flt.mantbits >> 0)) >> 0);
		digs = new decimalSlice.ptr(sliceType$6.nil, 0, 0, false);
		shortest = prec < 0;
		if (shortest) {
			roundShortest(d, mant, exp, flt);
			decimalSlice.copy(digs, new decimalSlice.ptr(new sliceType$6(d.d), d.nd, d.dp, false));
			_1 = fmt;
			if ((_1 === (101)) || (_1 === (69))) {
				prec = digs.nd - 1 >> 0;
			} else if (_1 === (102)) {
				prec = max(digs.nd - digs.dp >> 0, 0);
			} else if ((_1 === (103)) || (_1 === (71))) {
				prec = digs.nd;
			}
		} else {
			_2 = fmt;
			if ((_2 === (101)) || (_2 === (69))) {
				d.Round(prec + 1 >> 0);
			} else if (_2 === (102)) {
				d.Round(d.dp + prec >> 0);
			} else if ((_2 === (103)) || (_2 === (71))) {
				if (prec === 0) {
					prec = 1;
				}
				d.Round(prec);
			}
			decimalSlice.copy(digs, new decimalSlice.ptr(new sliceType$6(d.d), d.nd, d.dp, false));
		}
		return formatDigits(dst, shortest, neg, $clone(digs, decimalSlice), prec, fmt);
	};
	formatDigits = function(dst, shortest, neg, digs, prec, fmt) {
		var _1, digs, dst, eprec, exp, fmt, neg, prec, shortest;
		_1 = fmt;
		if ((_1 === (101)) || (_1 === (69))) {
			return fmtE(dst, neg, $clone(digs, decimalSlice), prec, fmt);
		} else if (_1 === (102)) {
			return fmtF(dst, neg, $clone(digs, decimalSlice), prec);
		} else if ((_1 === (103)) || (_1 === (71))) {
			eprec = prec;
			if (eprec > digs.nd && digs.nd >= digs.dp) {
				eprec = digs.nd;
			}
			if (shortest) {
				eprec = 6;
			}
			exp = digs.dp - 1 >> 0;
			if (exp < -4 || exp >= eprec) {
				if (prec > digs.nd) {
					prec = digs.nd;
				}
				return fmtE(dst, neg, $clone(digs, decimalSlice), prec - 1 >> 0, (fmt + 101 << 24 >>> 24) - 103 << 24 >>> 24);
			}
			if (prec > digs.dp) {
				prec = digs.nd;
			}
			return fmtF(dst, neg, $clone(digs, decimalSlice), max(prec - digs.dp >> 0, 0));
		}
		return $append(dst, 37, fmt);
	};
	roundShortest = function(d, mant, exp, flt) {
		var d, exp, explo, flt, i, inclusive, l, lower, m, mant, mantlo, minexp, okdown, okup, u, upper, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7;
		if ((mant.$high === 0 && mant.$low === 0)) {
			d.nd = 0;
			return;
		}
		minexp = flt.bias + 1 >> 0;
		if (exp > minexp && ($imul(332, ((d.dp - d.nd >> 0)))) >= ($imul(100, ((exp - ((flt.mantbits >> 0)) >> 0))))) {
			return;
		}
		upper = new decimal.ptr(arrayType.zero(), 0, 0, false, false);
		upper.Assign((x = $mul64(mant, new $Uint64(0, 2)), new $Uint64(x.$high + 0, x.$low + 1)));
		upper.Shift((exp - ((flt.mantbits >> 0)) >> 0) - 1 >> 0);
		mantlo = new $Uint64(0, 0);
		explo = 0;
		if ((x$1 = $shiftLeft64(new $Uint64(0, 1), flt.mantbits), (mant.$high > x$1.$high || (mant.$high === x$1.$high && mant.$low > x$1.$low))) || (exp === minexp)) {
			mantlo = new $Uint64(mant.$high - 0, mant.$low - 1);
			explo = exp;
		} else {
			mantlo = (x$2 = $mul64(mant, new $Uint64(0, 2)), new $Uint64(x$2.$high - 0, x$2.$low - 1));
			explo = exp - 1 >> 0;
		}
		lower = new decimal.ptr(arrayType.zero(), 0, 0, false, false);
		lower.Assign((x$3 = $mul64(mantlo, new $Uint64(0, 2)), new $Uint64(x$3.$high + 0, x$3.$low + 1)));
		lower.Shift((explo - ((flt.mantbits >> 0)) >> 0) - 1 >> 0);
		inclusive = (x$4 = $div64(mant, new $Uint64(0, 2), true), (x$4.$high === 0 && x$4.$low === 0));
		i = 0;
		while (true) {
			if (!(i < d.nd)) { break; }
			l = 48;
			if (i < lower.nd) {
				l = (x$5 = lower.d, ((i < 0 || i >= x$5.length) ? ($throwRuntimeError("index out of range"), undefined) : x$5[i]));
			}
			m = (x$6 = d.d, ((i < 0 || i >= x$6.length) ? ($throwRuntimeError("index out of range"), undefined) : x$6[i]));
			u = 48;
			if (i < upper.nd) {
				u = (x$7 = upper.d, ((i < 0 || i >= x$7.length) ? ($throwRuntimeError("index out of range"), undefined) : x$7[i]));
			}
			okdown = !((l === m)) || inclusive && ((i + 1 >> 0) === lower.nd);
			okup = !((m === u)) && (inclusive || (m + 1 << 24 >>> 24) < u || (i + 1 >> 0) < upper.nd);
			if (okdown && okup) {
				d.Round(i + 1 >> 0);
				return;
			} else if (okdown) {
				d.RoundDown(i + 1 >> 0);
				return;
			} else if (okup) {
				d.RoundUp(i + 1 >> 0);
				return;
			}
			i = i + (1) >> 0;
		}
	};
	fmtE = function(dst, neg, d, prec, fmt) {
		var _q, _q$1, _q$2, _r, _r$1, _r$2, ch, d, dst, exp, fmt, i, m, neg, prec, x;
		if (neg) {
			dst = $append(dst, 45);
		}
		ch = 48;
		if (!((d.nd === 0))) {
			ch = (x = d.d, (0 >= x.$length ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + 0]));
		}
		dst = $append(dst, ch);
		if (prec > 0) {
			dst = $append(dst, 46);
			i = 1;
			m = min(d.nd, prec + 1 >> 0);
			if (i < m) {
				dst = $appendSlice(dst, $subslice(d.d, i, m));
				i = m;
			}
			while (true) {
				if (!(i <= prec)) { break; }
				dst = $append(dst, 48);
				i = i + (1) >> 0;
			}
		}
		dst = $append(dst, fmt);
		exp = d.dp - 1 >> 0;
		if (d.nd === 0) {
			exp = 0;
		}
		if (exp < 0) {
			ch = 45;
			exp = -exp;
		} else {
			ch = 43;
		}
		dst = $append(dst, ch);
		if (exp < 10) {
			dst = $append(dst, 48, ((exp << 24 >>> 24)) + 48 << 24 >>> 24);
		} else if (exp < 100) {
			dst = $append(dst, (((_q = exp / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) << 24 >>> 24)) + 48 << 24 >>> 24, (((_r = exp % 10, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) << 24 >>> 24)) + 48 << 24 >>> 24);
		} else {
			dst = $append(dst, (((_q$1 = exp / 100, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero")) << 24 >>> 24)) + 48 << 24 >>> 24, (_r$1 = (((_q$2 = exp / 10, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero")) << 24 >>> 24)) % 10, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) + 48 << 24 >>> 24, (((_r$2 = exp % 10, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")) << 24 >>> 24)) + 48 << 24 >>> 24);
		}
		return dst;
	};
	fmtF = function(dst, neg, d, prec) {
		var ch, d, dst, i, j, m, neg, prec, x;
		if (neg) {
			dst = $append(dst, 45);
		}
		if (d.dp > 0) {
			m = min(d.nd, d.dp);
			dst = $appendSlice(dst, $subslice(d.d, 0, m));
			while (true) {
				if (!(m < d.dp)) { break; }
				dst = $append(dst, 48);
				m = m + (1) >> 0;
			}
		} else {
			dst = $append(dst, 48);
		}
		if (prec > 0) {
			dst = $append(dst, 46);
			i = 0;
			while (true) {
				if (!(i < prec)) { break; }
				ch = 48;
				j = d.dp + i >> 0;
				if (0 <= j && j < d.nd) {
					ch = (x = d.d, ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]));
				}
				dst = $append(dst, ch);
				i = i + (1) >> 0;
			}
		}
		return dst;
	};
	fmtB = function(dst, neg, mant, exp, flt) {
		var _tuple, _tuple$1, dst, exp, flt, mant, neg;
		if (neg) {
			dst = $append(dst, 45);
		}
		_tuple = formatBits(dst, mant, 10, false, true);
		dst = _tuple[0];
		dst = $append(dst, 112);
		exp = exp - (((flt.mantbits >> 0))) >> 0;
		if (exp >= 0) {
			dst = $append(dst, 43);
		}
		_tuple$1 = formatBits(dst, (new $Uint64(0, exp)), 10, exp < 0, true);
		dst = _tuple$1[0];
		return dst;
	};
	min = function(a, b) {
		var a, b;
		if (a < b) {
			return a;
		}
		return b;
	};
	max = function(a, b) {
		var a, b;
		if (a > b) {
			return a;
		}
		return b;
	};
	FormatInt = function(i, base) {
		var _tuple, base, i, s;
		if (true && (0 < i.$high || (0 === i.$high && 0 <= i.$low)) && (i.$high < 0 || (i.$high === 0 && i.$low < 100)) && (base === 10)) {
			return small((((i.$low + ((i.$high >> 31) * 4294967296)) >> 0)));
		}
		_tuple = formatBits(sliceType$6.nil, (new $Uint64(i.$high, i.$low)), base, (i.$high < 0 || (i.$high === 0 && i.$low < 0)), false);
		s = _tuple[1];
		return s;
	};
	$pkg.FormatInt = FormatInt;
	Itoa = function(i) {
		var i;
		return FormatInt((new $Int64(0, i)), 10);
	};
	$pkg.Itoa = Itoa;
	small = function(i) {
		var i, off;
		off = 0;
		if (i < 10) {
			off = 1;
		}
		return $substring("00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899", (($imul(i, 2)) + off >> 0), (($imul(i, 2)) + 2 >> 0));
	};
	formatBits = function(dst, u, base, neg, append_) {
		var _q, _q$1, _r, _r$1, a, append_, b, b$1, base, d, dst, i, is, is$1, is$2, j, m, neg, q, q$1, s, s$1, u, us, us$1, x, x$1, x$2, x$3, x$4, x$5;
		d = sliceType$6.nil;
		s = "";
		if (base < 2 || base > 36) {
			$panic(new $String("strconv: illegal AppendInt/FormatInt base"));
		}
		a = arrayType$3.zero();
		i = 65;
		if (neg) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		if (base === 10) {
			if (true) {
				while (true) {
					if (!((u.$high > 0 || (u.$high === 0 && u.$low >= 1000000000)))) { break; }
					q = $div64(u, new $Uint64(0, 1000000000), false);
					us = (((x = $mul64(q, new $Uint64(0, 1000000000)), new $Uint64(u.$high - x.$high, u.$low - x.$low)).$low >>> 0));
					j = 4;
					while (true) {
						if (!(j > 0)) { break; }
						is = (_r = us % 100, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) * 2 >>> 0;
						us = (_q = us / (100), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
						i = i - (2) >> 0;
						(x$1 = i + 1 >> 0, ((x$1 < 0 || x$1 >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[x$1] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt((is + 1 >>> 0))));
						(x$2 = i + 0 >> 0, ((x$2 < 0 || x$2 >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[x$2] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt((is + 0 >>> 0))));
						j = j - (1) >> 0;
					}
					i = i - (1) >> 0;
					((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt(((us * 2 >>> 0) + 1 >>> 0)));
					u = q;
				}
			}
			us$1 = ((u.$low >>> 0));
			while (true) {
				if (!(us$1 >= 100)) { break; }
				is$1 = (_r$1 = us$1 % 100, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) * 2 >>> 0;
				us$1 = (_q$1 = us$1 / (100), (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
				i = i - (2) >> 0;
				(x$3 = i + 1 >> 0, ((x$3 < 0 || x$3 >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[x$3] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt((is$1 + 1 >>> 0))));
				(x$4 = i + 0 >> 0, ((x$4 < 0 || x$4 >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[x$4] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt((is$1 + 0 >>> 0))));
			}
			is$2 = us$1 * 2 >>> 0;
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt((is$2 + 1 >>> 0)));
			if (us$1 >= 10) {
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899".charCodeAt(is$2));
			}
		} else {
			s$1 = ((base < 0 || base >= shifts.length) ? ($throwRuntimeError("index out of range"), undefined) : shifts[base]);
			if (s$1 > 0) {
				b = (new $Uint64(0, base));
				m = ((base >>> 0)) - 1 >>> 0;
				while (true) {
					if (!((u.$high > b.$high || (u.$high === b.$high && u.$low >= b.$low)))) { break; }
					i = i - (1) >> 0;
					((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(((((u.$low >>> 0)) & m) >>> 0)));
					u = $shiftRightUint64(u, (s$1));
				}
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(((u.$low >>> 0))));
			} else {
				b$1 = (new $Uint64(0, base));
				while (true) {
					if (!((u.$high > b$1.$high || (u.$high === b$1.$high && u.$low >= b$1.$low)))) { break; }
					i = i - (1) >> 0;
					q$1 = $div64(u, b$1, false);
					((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((((x$5 = $mul64(q$1, b$1), new $Uint64(u.$high - x$5.$high, u.$low - x$5.$low)).$low >>> 0))));
					u = q$1;
				}
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(((u.$low >>> 0))));
			}
		}
		if (neg) {
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? ($throwRuntimeError("index out of range"), undefined) : a[i] = 45);
		}
		if (append_) {
			d = $appendSlice(dst, $subslice(new sliceType$6(a), i));
			return [d, s];
		}
		s = ($bytesToString($subslice(new sliceType$6(a), i)));
		return [d, s];
	};
	quoteWith = function(s, quote, ASCIIonly, graphicOnly) {
		var ASCIIonly, _q, graphicOnly, quote, s;
		return ($bytesToString(appendQuotedWith($makeSlice(sliceType$6, 0, (_q = ($imul(3, s.length)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"))), s, quote, ASCIIonly, graphicOnly)));
	};
	appendQuotedWith = function(buf, s, quote, ASCIIonly, graphicOnly) {
		var ASCIIonly, _tuple, buf, graphicOnly, quote, r, s, width;
		buf = $append(buf, quote);
		width = 0;
		while (true) {
			if (!(s.length > 0)) { break; }
			r = ((s.charCodeAt(0) >> 0));
			width = 1;
			if (r >= 128) {
				_tuple = utf8.DecodeRuneInString(s);
				r = _tuple[0];
				width = _tuple[1];
			}
			if ((width === 1) && (r === 65533)) {
				buf = $appendSlice(buf, "\\x");
				buf = $append(buf, "0123456789abcdef".charCodeAt((s.charCodeAt(0) >>> 4 << 24 >>> 24)));
				buf = $append(buf, "0123456789abcdef".charCodeAt(((s.charCodeAt(0) & 15) >>> 0)));
				s = $substring(s, width);
				continue;
			}
			buf = appendEscapedRune(buf, r, quote, ASCIIonly, graphicOnly);
			s = $substring(s, width);
		}
		buf = $append(buf, quote);
		return buf;
	};
	appendEscapedRune = function(buf, r, quote, ASCIIonly, graphicOnly) {
		var ASCIIonly, _1, buf, graphicOnly, n, quote, r, runeTmp, s, s$1;
		runeTmp = arrayType$4.zero();
		if ((r === ((quote >> 0))) || (r === 92)) {
			buf = $append(buf, 92);
			buf = $append(buf, ((r << 24 >>> 24)));
			return buf;
		}
		if (ASCIIonly) {
			if (r < 128 && IsPrint(r)) {
				buf = $append(buf, ((r << 24 >>> 24)));
				return buf;
			}
		} else if (IsPrint(r) || graphicOnly && isInGraphicList(r)) {
			n = utf8.EncodeRune(new sliceType$6(runeTmp), r);
			buf = $appendSlice(buf, $subslice(new sliceType$6(runeTmp), 0, n));
			return buf;
		}
		_1 = r;
		if (_1 === (7)) {
			buf = $appendSlice(buf, "\\a");
		} else if (_1 === (8)) {
			buf = $appendSlice(buf, "\\b");
		} else if (_1 === (12)) {
			buf = $appendSlice(buf, "\\f");
		} else if (_1 === (10)) {
			buf = $appendSlice(buf, "\\n");
		} else if (_1 === (13)) {
			buf = $appendSlice(buf, "\\r");
		} else if (_1 === (9)) {
			buf = $appendSlice(buf, "\\t");
		} else if (_1 === (11)) {
			buf = $appendSlice(buf, "\\v");
		} else {
			if (r < 32) {
				buf = $appendSlice(buf, "\\x");
				buf = $append(buf, "0123456789abcdef".charCodeAt((((r << 24 >>> 24)) >>> 4 << 24 >>> 24)));
				buf = $append(buf, "0123456789abcdef".charCodeAt(((((r << 24 >>> 24)) & 15) >>> 0)));
			} else if (r > 1114111) {
				r = 65533;
				buf = $appendSlice(buf, "\\u");
				s = 12;
				while (true) {
					if (!(s >= 0)) { break; }
					buf = $append(buf, "0123456789abcdef".charCodeAt((((r >> $min(((s >>> 0)), 31)) >> 0) & 15)));
					s = s - (4) >> 0;
				}
			} else if (r < 65536) {
				buf = $appendSlice(buf, "\\u");
				s = 12;
				while (true) {
					if (!(s >= 0)) { break; }
					buf = $append(buf, "0123456789abcdef".charCodeAt((((r >> $min(((s >>> 0)), 31)) >> 0) & 15)));
					s = s - (4) >> 0;
				}
			} else {
				buf = $appendSlice(buf, "\\U");
				s$1 = 28;
				while (true) {
					if (!(s$1 >= 0)) { break; }
					buf = $append(buf, "0123456789abcdef".charCodeAt((((r >> $min(((s$1 >>> 0)), 31)) >> 0) & 15)));
					s$1 = s$1 - (4) >> 0;
				}
			}
		}
		return buf;
	};
	Quote = function(s) {
		var s;
		return quoteWith(s, 34, false, false);
	};
	$pkg.Quote = Quote;
	unhex = function(b) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, b, c, ok, v;
		v = 0;
		ok = false;
		c = ((b >> 0));
		if (48 <= c && c <= 57) {
			_tmp = c - 48 >> 0;
			_tmp$1 = true;
			v = _tmp;
			ok = _tmp$1;
			return [v, ok];
		} else if (97 <= c && c <= 102) {
			_tmp$2 = (c - 97 >> 0) + 10 >> 0;
			_tmp$3 = true;
			v = _tmp$2;
			ok = _tmp$3;
			return [v, ok];
		} else if (65 <= c && c <= 70) {
			_tmp$4 = (c - 65 >> 0) + 10 >> 0;
			_tmp$5 = true;
			v = _tmp$4;
			ok = _tmp$5;
			return [v, ok];
		}
		return [v, ok];
	};
	UnquoteChar = function(s, quote) {
		var _1, _2, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, _tuple$1, c, c$1, err, j, j$1, multibyte, n, ok, quote, r, s, size, tail, v, v$1, value, x, x$1;
		value = 0;
		multibyte = false;
		tail = "";
		err = $ifaceNil;
		c = s.charCodeAt(0);
		if ((c === quote) && ((quote === 39) || (quote === 34))) {
			err = $pkg.ErrSyntax;
			return [value, multibyte, tail, err];
		} else if (c >= 128) {
			_tuple = utf8.DecodeRuneInString(s);
			r = _tuple[0];
			size = _tuple[1];
			_tmp = r;
			_tmp$1 = true;
			_tmp$2 = $substring(s, size);
			_tmp$3 = $ifaceNil;
			value = _tmp;
			multibyte = _tmp$1;
			tail = _tmp$2;
			err = _tmp$3;
			return [value, multibyte, tail, err];
		} else if (!((c === 92))) {
			_tmp$4 = ((s.charCodeAt(0) >> 0));
			_tmp$5 = false;
			_tmp$6 = $substring(s, 1);
			_tmp$7 = $ifaceNil;
			value = _tmp$4;
			multibyte = _tmp$5;
			tail = _tmp$6;
			err = _tmp$7;
			return [value, multibyte, tail, err];
		}
		if (s.length <= 1) {
			err = $pkg.ErrSyntax;
			return [value, multibyte, tail, err];
		}
		c$1 = s.charCodeAt(1);
		s = $substring(s, 2);
		switch (0) { default:
			_1 = c$1;
			if (_1 === (97)) {
				value = 7;
			} else if (_1 === (98)) {
				value = 8;
			} else if (_1 === (102)) {
				value = 12;
			} else if (_1 === (110)) {
				value = 10;
			} else if (_1 === (114)) {
				value = 13;
			} else if (_1 === (116)) {
				value = 9;
			} else if (_1 === (118)) {
				value = 11;
			} else if ((_1 === (120)) || (_1 === (117)) || (_1 === (85))) {
				n = 0;
				_2 = c$1;
				if (_2 === (120)) {
					n = 2;
				} else if (_2 === (117)) {
					n = 4;
				} else if (_2 === (85)) {
					n = 8;
				}
				v = 0;
				if (s.length < n) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				j = 0;
				while (true) {
					if (!(j < n)) { break; }
					_tuple$1 = unhex(s.charCodeAt(j));
					x = _tuple$1[0];
					ok = _tuple$1[1];
					if (!ok) {
						err = $pkg.ErrSyntax;
						return [value, multibyte, tail, err];
					}
					v = (v << 4 >> 0) | x;
					j = j + (1) >> 0;
				}
				s = $substring(s, n);
				if (c$1 === 120) {
					value = v;
					break;
				}
				if (v > 1114111) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = v;
				multibyte = true;
			} else if ((_1 === (48)) || (_1 === (49)) || (_1 === (50)) || (_1 === (51)) || (_1 === (52)) || (_1 === (53)) || (_1 === (54)) || (_1 === (55))) {
				v$1 = ((c$1 >> 0)) - 48 >> 0;
				if (s.length < 2) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				j$1 = 0;
				while (true) {
					if (!(j$1 < 2)) { break; }
					x$1 = ((s.charCodeAt(j$1) >> 0)) - 48 >> 0;
					if (x$1 < 0 || x$1 > 7) {
						err = $pkg.ErrSyntax;
						return [value, multibyte, tail, err];
					}
					v$1 = ((v$1 << 3 >> 0)) | x$1;
					j$1 = j$1 + (1) >> 0;
				}
				s = $substring(s, 2);
				if (v$1 > 255) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = v$1;
			} else if (_1 === (92)) {
				value = 92;
			} else if ((_1 === (39)) || (_1 === (34))) {
				if (!((c$1 === quote))) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = ((c$1 >> 0));
			} else {
				err = $pkg.ErrSyntax;
				return [value, multibyte, tail, err];
			}
		}
		tail = s;
		return [value, multibyte, tail, err];
	};
	$pkg.UnquoteChar = UnquoteChar;
	Unquote = function(s) {
		var _1, _q, _tuple, _tuple$1, buf, buf$1, c, err, i, multibyte, n, n$1, quote, r, runeTmp, s, size, ss;
		n = s.length;
		if (n < 2) {
			return ["", $pkg.ErrSyntax];
		}
		quote = s.charCodeAt(0);
		if (!((quote === s.charCodeAt((n - 1 >> 0))))) {
			return ["", $pkg.ErrSyntax];
		}
		s = $substring(s, 1, (n - 1 >> 0));
		if (quote === 96) {
			if (contains(s, 96)) {
				return ["", $pkg.ErrSyntax];
			}
			if (contains(s, 13)) {
				buf = $makeSlice(sliceType$6, 0, (s.length - 1 >> 0));
				i = 0;
				while (true) {
					if (!(i < s.length)) { break; }
					if (!((s.charCodeAt(i) === 13))) {
						buf = $append(buf, s.charCodeAt(i));
					}
					i = i + (1) >> 0;
				}
				return [($bytesToString(buf)), $ifaceNil];
			}
			return [s, $ifaceNil];
		}
		if (!((quote === 34)) && !((quote === 39))) {
			return ["", $pkg.ErrSyntax];
		}
		if (contains(s, 10)) {
			return ["", $pkg.ErrSyntax];
		}
		if (!contains(s, 92) && !contains(s, quote)) {
			_1 = quote;
			if (_1 === (34)) {
				return [s, $ifaceNil];
			} else if (_1 === (39)) {
				_tuple = utf8.DecodeRuneInString(s);
				r = _tuple[0];
				size = _tuple[1];
				if ((size === s.length) && (!((r === 65533)) || !((size === 1)))) {
					return [s, $ifaceNil];
				}
			}
		}
		runeTmp = arrayType$4.zero();
		buf$1 = $makeSlice(sliceType$6, 0, (_q = ($imul(3, s.length)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")));
		while (true) {
			if (!(s.length > 0)) { break; }
			_tuple$1 = UnquoteChar(s, quote);
			c = _tuple$1[0];
			multibyte = _tuple$1[1];
			ss = _tuple$1[2];
			err = _tuple$1[3];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				return ["", err];
			}
			s = ss;
			if (c < 128 || !multibyte) {
				buf$1 = $append(buf$1, ((c << 24 >>> 24)));
			} else {
				n$1 = utf8.EncodeRune(new sliceType$6(runeTmp), c);
				buf$1 = $appendSlice(buf$1, $subslice(new sliceType$6(runeTmp), 0, n$1));
			}
			if ((quote === 39) && !((s.length === 0))) {
				return ["", $pkg.ErrSyntax];
			}
		}
		return [($bytesToString(buf$1)), $ifaceNil];
	};
	$pkg.Unquote = Unquote;
	contains = function(s, c) {
		var c, i, s;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			if (s.charCodeAt(i) === c) {
				return true;
			}
			i = i + (1) >> 0;
		}
		return false;
	};
	bsearch16 = function(a, x) {
		var _q, _tmp, _tmp$1, a, h, i, j, x;
		_tmp = 0;
		_tmp$1 = a.$length;
		i = _tmp;
		j = _tmp$1;
		while (true) {
			if (!(i < j)) { break; }
			h = i + (_q = ((j - i >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			if (((h < 0 || h >= a.$length) ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + h]) < x) {
				i = h + 1 >> 0;
			} else {
				j = h;
			}
		}
		return i;
	};
	bsearch32 = function(a, x) {
		var _q, _tmp, _tmp$1, a, h, i, j, x;
		_tmp = 0;
		_tmp$1 = a.$length;
		i = _tmp;
		j = _tmp$1;
		while (true) {
			if (!(i < j)) { break; }
			h = i + (_q = ((j - i >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			if (((h < 0 || h >= a.$length) ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + h]) < x) {
				i = h + 1 >> 0;
			} else {
				j = h;
			}
		}
		return i;
	};
	IsPrint = function(r) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, i, i$1, isNotPrint, isNotPrint$1, isPrint, isPrint$1, j, j$1, r, rr, rr$1, x, x$1, x$2, x$3;
		if (r <= 255) {
			if (32 <= r && r <= 126) {
				return true;
			}
			if (161 <= r && r <= 255) {
				return !((r === 173));
			}
			return false;
		}
		if (0 <= r && r < 65536) {
			_tmp = ((r << 16 >>> 16));
			_tmp$1 = isPrint16;
			_tmp$2 = isNotPrint16;
			rr = _tmp;
			isPrint = _tmp$1;
			isNotPrint = _tmp$2;
			i = bsearch16(isPrint, rr);
			if (i >= isPrint.$length || rr < (x = (i & ~1) >> 0, ((x < 0 || x >= isPrint.$length) ? ($throwRuntimeError("index out of range"), undefined) : isPrint.$array[isPrint.$offset + x])) || (x$1 = i | 1, ((x$1 < 0 || x$1 >= isPrint.$length) ? ($throwRuntimeError("index out of range"), undefined) : isPrint.$array[isPrint.$offset + x$1])) < rr) {
				return false;
			}
			j = bsearch16(isNotPrint, rr);
			return j >= isNotPrint.$length || !((((j < 0 || j >= isNotPrint.$length) ? ($throwRuntimeError("index out of range"), undefined) : isNotPrint.$array[isNotPrint.$offset + j]) === rr));
		}
		_tmp$3 = ((r >>> 0));
		_tmp$4 = isPrint32;
		_tmp$5 = isNotPrint32;
		rr$1 = _tmp$3;
		isPrint$1 = _tmp$4;
		isNotPrint$1 = _tmp$5;
		i$1 = bsearch32(isPrint$1, rr$1);
		if (i$1 >= isPrint$1.$length || rr$1 < (x$2 = (i$1 & ~1) >> 0, ((x$2 < 0 || x$2 >= isPrint$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : isPrint$1.$array[isPrint$1.$offset + x$2])) || (x$3 = i$1 | 1, ((x$3 < 0 || x$3 >= isPrint$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : isPrint$1.$array[isPrint$1.$offset + x$3])) < rr$1) {
			return false;
		}
		if (r >= 131072) {
			return true;
		}
		r = r - (65536) >> 0;
		j$1 = bsearch16(isNotPrint$1, ((r << 16 >>> 16)));
		return j$1 >= isNotPrint$1.$length || !((((j$1 < 0 || j$1 >= isNotPrint$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : isNotPrint$1.$array[isNotPrint$1.$offset + j$1]) === ((r << 16 >>> 16))));
	};
	$pkg.IsPrint = IsPrint;
	isInGraphicList = function(r) {
		var i, r, rr;
		if (r > 65535) {
			return false;
		}
		rr = ((r << 16 >>> 16));
		i = bsearch16(isGraphic, rr);
		return i < isGraphic.$length && (rr === ((i < 0 || i >= isGraphic.$length) ? ($throwRuntimeError("index out of range"), undefined) : isGraphic.$array[isGraphic.$offset + i]));
	};
	ptrType.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$2.methods = [{prop: "set", name: "set", pkg: "strconv", typ: $funcType([$String], [$Bool], false)}, {prop: "floatBits", name: "floatBits", pkg: "strconv", typ: $funcType([ptrType$1], [$Uint64, $Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Assign", name: "Assign", pkg: "", typ: $funcType([$Uint64], [], false)}, {prop: "Shift", name: "Shift", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Round", name: "Round", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "RoundDown", name: "RoundDown", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "RoundUp", name: "RoundUp", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "RoundedInteger", name: "RoundedInteger", pkg: "", typ: $funcType([], [$Uint64], false)}];
	ptrType$4.methods = [{prop: "floatBits", name: "floatBits", pkg: "strconv", typ: $funcType([ptrType$1], [$Uint64, $Bool], false)}, {prop: "AssignComputeBounds", name: "AssignComputeBounds", pkg: "", typ: $funcType([$Uint64, $Int, $Bool, ptrType$1], [extFloat, extFloat], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [$Uint], false)}, {prop: "Multiply", name: "Multiply", pkg: "", typ: $funcType([extFloat], [], false)}, {prop: "AssignDecimal", name: "AssignDecimal", pkg: "", typ: $funcType([$Uint64, $Int, $Bool, $Bool, ptrType$1], [$Bool], false)}, {prop: "frexp10", name: "frexp10", pkg: "strconv", typ: $funcType([], [$Int, $Int], false)}, {prop: "FixedDecimal", name: "FixedDecimal", pkg: "", typ: $funcType([ptrType$3, $Int], [$Bool], false)}, {prop: "ShortestDecimal", name: "ShortestDecimal", pkg: "", typ: $funcType([ptrType$3, ptrType$4, ptrType$4], [$Bool], false)}];
	NumError.init("", [{prop: "Func", name: "Func", anonymous: false, exported: true, typ: $String, tag: ""}, {prop: "Num", name: "Num", anonymous: false, exported: true, typ: $String, tag: ""}, {prop: "Err", name: "Err", anonymous: false, exported: true, typ: $error, tag: ""}]);
	decimal.init("strconv", [{prop: "d", name: "d", anonymous: false, exported: false, typ: arrayType, tag: ""}, {prop: "nd", name: "nd", anonymous: false, exported: false, typ: $Int, tag: ""}, {prop: "dp", name: "dp", anonymous: false, exported: false, typ: $Int, tag: ""}, {prop: "neg", name: "neg", anonymous: false, exported: false, typ: $Bool, tag: ""}, {prop: "trunc", name: "trunc", anonymous: false, exported: false, typ: $Bool, tag: ""}]);
	leftCheat.init("strconv", [{prop: "delta", name: "delta", anonymous: false, exported: false, typ: $Int, tag: ""}, {prop: "cutoff", name: "cutoff", anonymous: false, exported: false, typ: $String, tag: ""}]);
	extFloat.init("strconv", [{prop: "mant", name: "mant", anonymous: false, exported: false, typ: $Uint64, tag: ""}, {prop: "exp", name: "exp", anonymous: false, exported: false, typ: $Int, tag: ""}, {prop: "neg", name: "neg", anonymous: false, exported: false, typ: $Bool, tag: ""}]);
	floatInfo.init("strconv", [{prop: "mantbits", name: "mantbits", anonymous: false, exported: false, typ: $Uint, tag: ""}, {prop: "expbits", name: "expbits", anonymous: false, exported: false, typ: $Uint, tag: ""}, {prop: "bias", name: "bias", anonymous: false, exported: false, typ: $Int, tag: ""}]);
	decimalSlice.init("strconv", [{prop: "d", name: "d", anonymous: false, exported: false, typ: sliceType$6, tag: ""}, {prop: "nd", name: "nd", anonymous: false, exported: false, typ: $Int, tag: ""}, {prop: "dp", name: "dp", anonymous: false, exported: false, typ: $Int, tag: ""}, {prop: "neg", name: "neg", anonymous: false, exported: false, typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		optimize = true;
		powtab = new sliceType([1, 3, 6, 9, 13, 16, 19, 23, 26]);
		float64pow10 = new sliceType$1([1, 10, 100, 1000, 10000, 100000, 1e+06, 1e+07, 1e+08, 1e+09, 1e+10, 1e+11, 1e+12, 1e+13, 1e+14, 1e+15, 1e+16, 1e+17, 1e+18, 1e+19, 1e+20, 1e+21, 1e+22]);
		float32pow10 = new sliceType$2([1, 10, 100, 1000, 10000, 100000, 1e+06, 1e+07, 1e+08, 1e+09, 1e+10]);
		$pkg.ErrRange = errors.New("value out of range");
		$pkg.ErrSyntax = errors.New("invalid syntax");
		leftcheats = new sliceType$3([new leftCheat.ptr(0, ""), new leftCheat.ptr(1, "5"), new leftCheat.ptr(1, "25"), new leftCheat.ptr(1, "125"), new leftCheat.ptr(2, "625"), new leftCheat.ptr(2, "3125"), new leftCheat.ptr(2, "15625"), new leftCheat.ptr(3, "78125"), new leftCheat.ptr(3, "390625"), new leftCheat.ptr(3, "1953125"), new leftCheat.ptr(4, "9765625"), new leftCheat.ptr(4, "48828125"), new leftCheat.ptr(4, "244140625"), new leftCheat.ptr(4, "1220703125"), new leftCheat.ptr(5, "6103515625"), new leftCheat.ptr(5, "30517578125"), new leftCheat.ptr(5, "152587890625"), new leftCheat.ptr(6, "762939453125"), new leftCheat.ptr(6, "3814697265625"), new leftCheat.ptr(6, "19073486328125"), new leftCheat.ptr(7, "95367431640625"), new leftCheat.ptr(7, "476837158203125"), new leftCheat.ptr(7, "2384185791015625"), new leftCheat.ptr(7, "11920928955078125"), new leftCheat.ptr(8, "59604644775390625"), new leftCheat.ptr(8, "298023223876953125"), new leftCheat.ptr(8, "1490116119384765625"), new leftCheat.ptr(9, "7450580596923828125"), new leftCheat.ptr(9, "37252902984619140625"), new leftCheat.ptr(9, "186264514923095703125"), new leftCheat.ptr(10, "931322574615478515625"), new leftCheat.ptr(10, "4656612873077392578125"), new leftCheat.ptr(10, "23283064365386962890625"), new leftCheat.ptr(10, "116415321826934814453125"), new leftCheat.ptr(11, "582076609134674072265625"), new leftCheat.ptr(11, "2910383045673370361328125"), new leftCheat.ptr(11, "14551915228366851806640625"), new leftCheat.ptr(12, "72759576141834259033203125"), new leftCheat.ptr(12, "363797880709171295166015625"), new leftCheat.ptr(12, "1818989403545856475830078125"), new leftCheat.ptr(13, "9094947017729282379150390625"), new leftCheat.ptr(13, "45474735088646411895751953125"), new leftCheat.ptr(13, "227373675443232059478759765625"), new leftCheat.ptr(13, "1136868377216160297393798828125"), new leftCheat.ptr(14, "5684341886080801486968994140625"), new leftCheat.ptr(14, "28421709430404007434844970703125"), new leftCheat.ptr(14, "142108547152020037174224853515625"), new leftCheat.ptr(15, "710542735760100185871124267578125"), new leftCheat.ptr(15, "3552713678800500929355621337890625"), new leftCheat.ptr(15, "17763568394002504646778106689453125"), new leftCheat.ptr(16, "88817841970012523233890533447265625"), new leftCheat.ptr(16, "444089209850062616169452667236328125"), new leftCheat.ptr(16, "2220446049250313080847263336181640625"), new leftCheat.ptr(16, "11102230246251565404236316680908203125"), new leftCheat.ptr(17, "55511151231257827021181583404541015625"), new leftCheat.ptr(17, "277555756156289135105907917022705078125"), new leftCheat.ptr(17, "1387778780781445675529539585113525390625"), new leftCheat.ptr(18, "6938893903907228377647697925567626953125"), new leftCheat.ptr(18, "34694469519536141888238489627838134765625"), new leftCheat.ptr(18, "173472347597680709441192448139190673828125"), new leftCheat.ptr(19, "867361737988403547205962240695953369140625")]);
		smallPowersOfTen = $toNativeArray($kindStruct, [new extFloat.ptr(new $Uint64(2147483648, 0), -63, false), new extFloat.ptr(new $Uint64(2684354560, 0), -60, false), new extFloat.ptr(new $Uint64(3355443200, 0), -57, false), new extFloat.ptr(new $Uint64(4194304000, 0), -54, false), new extFloat.ptr(new $Uint64(2621440000, 0), -50, false), new extFloat.ptr(new $Uint64(3276800000, 0), -47, false), new extFloat.ptr(new $Uint64(4096000000, 0), -44, false), new extFloat.ptr(new $Uint64(2560000000, 0), -40, false)]);
		powersOfTen = $toNativeArray($kindStruct, [new extFloat.ptr(new $Uint64(4203730336, 136053384), -1220, false), new extFloat.ptr(new $Uint64(3132023167, 2722021238), -1193, false), new extFloat.ptr(new $Uint64(2333539104, 810921078), -1166, false), new extFloat.ptr(new $Uint64(3477244234, 1573795306), -1140, false), new extFloat.ptr(new $Uint64(2590748842, 1432697645), -1113, false), new extFloat.ptr(new $Uint64(3860516611, 1025131999), -1087, false), new extFloat.ptr(new $Uint64(2876309015, 3348809418), -1060, false), new extFloat.ptr(new $Uint64(4286034428, 3200048207), -1034, false), new extFloat.ptr(new $Uint64(3193344495, 1097586188), -1007, false), new extFloat.ptr(new $Uint64(2379227053, 2424306748), -980, false), new extFloat.ptr(new $Uint64(3545324584, 827693699), -954, false), new extFloat.ptr(new $Uint64(2641472655, 2913388981), -927, false), new extFloat.ptr(new $Uint64(3936100983, 602835915), -901, false), new extFloat.ptr(new $Uint64(2932623761, 1081627501), -874, false), new extFloat.ptr(new $Uint64(2184974969, 1572261463), -847, false), new extFloat.ptr(new $Uint64(3255866422, 1308317239), -821, false), new extFloat.ptr(new $Uint64(2425809519, 944281679), -794, false), new extFloat.ptr(new $Uint64(3614737867, 629291719), -768, false), new extFloat.ptr(new $Uint64(2693189581, 2545915892), -741, false), new extFloat.ptr(new $Uint64(4013165208, 388672741), -715, false), new extFloat.ptr(new $Uint64(2990041083, 708162190), -688, false), new extFloat.ptr(new $Uint64(2227754207, 3536207675), -661, false), new extFloat.ptr(new $Uint64(3319612455, 450088378), -635, false), new extFloat.ptr(new $Uint64(2473304014, 3139815830), -608, false), new extFloat.ptr(new $Uint64(3685510180, 2103616900), -582, false), new extFloat.ptr(new $Uint64(2745919064, 224385782), -555, false), new extFloat.ptr(new $Uint64(4091738259, 3737383206), -529, false), new extFloat.ptr(new $Uint64(3048582568, 2868871352), -502, false), new extFloat.ptr(new $Uint64(2271371013, 1820084875), -475, false), new extFloat.ptr(new $Uint64(3384606560, 885076051), -449, false), new extFloat.ptr(new $Uint64(2521728396, 2444895829), -422, false), new extFloat.ptr(new $Uint64(3757668132, 1881767613), -396, false), new extFloat.ptr(new $Uint64(2799680927, 3102062735), -369, false), new extFloat.ptr(new $Uint64(4171849679, 2289335700), -343, false), new extFloat.ptr(new $Uint64(3108270227, 2410191823), -316, false), new extFloat.ptr(new $Uint64(2315841784, 3205436779), -289, false), new extFloat.ptr(new $Uint64(3450873173, 1697722806), -263, false), new extFloat.ptr(new $Uint64(2571100870, 3497754540), -236, false), new extFloat.ptr(new $Uint64(3831238852, 707476230), -210, false), new extFloat.ptr(new $Uint64(2854495385, 1769181907), -183, false), new extFloat.ptr(new $Uint64(4253529586, 2197867022), -157, false), new extFloat.ptr(new $Uint64(3169126500, 2450594539), -130, false), new extFloat.ptr(new $Uint64(2361183241, 1867548876), -103, false), new extFloat.ptr(new $Uint64(3518437208, 3793315116), -77, false), new extFloat.ptr(new $Uint64(2621440000, 0), -50, false), new extFloat.ptr(new $Uint64(3906250000, 0), -24, false), new extFloat.ptr(new $Uint64(2910383045, 2892103680), 3, false), new extFloat.ptr(new $Uint64(2168404344, 4170451332), 30, false), new extFloat.ptr(new $Uint64(3231174267, 3372684723), 56, false), new extFloat.ptr(new $Uint64(2407412430, 2078956656), 83, false), new extFloat.ptr(new $Uint64(3587324068, 2884206696), 109, false), new extFloat.ptr(new $Uint64(2672764710, 395977285), 136, false), new extFloat.ptr(new $Uint64(3982729777, 3569679143), 162, false), new extFloat.ptr(new $Uint64(2967364920, 2361961896), 189, false), new extFloat.ptr(new $Uint64(2210859150, 447440347), 216, false), new extFloat.ptr(new $Uint64(3294436857, 1114709402), 242, false), new extFloat.ptr(new $Uint64(2454546732, 2786846552), 269, false), new extFloat.ptr(new $Uint64(3657559652, 443583978), 295, false), new extFloat.ptr(new $Uint64(2725094297, 2599384906), 322, false), new extFloat.ptr(new $Uint64(4060706939, 3028118405), 348, false), new extFloat.ptr(new $Uint64(3025462433, 2044532855), 375, false), new extFloat.ptr(new $Uint64(2254145170, 1536935362), 402, false), new extFloat.ptr(new $Uint64(3358938053, 3365297469), 428, false), new extFloat.ptr(new $Uint64(2502603868, 4204241075), 455, false), new extFloat.ptr(new $Uint64(3729170365, 2577424355), 481, false), new extFloat.ptr(new $Uint64(2778448436, 3677981733), 508, false), new extFloat.ptr(new $Uint64(4140210802, 2744688476), 534, false), new extFloat.ptr(new $Uint64(3084697427, 1424604878), 561, false), new extFloat.ptr(new $Uint64(2298278679, 4062331362), 588, false), new extFloat.ptr(new $Uint64(3424702107, 3546052773), 614, false), new extFloat.ptr(new $Uint64(2551601907, 2065781727), 641, false), new extFloat.ptr(new $Uint64(3802183132, 2535403578), 667, false), new extFloat.ptr(new $Uint64(2832847187, 1558426518), 694, false), new extFloat.ptr(new $Uint64(4221271257, 2762425404), 720, false), new extFloat.ptr(new $Uint64(3145092172, 2812560400), 747, false), new extFloat.ptr(new $Uint64(2343276271, 3057687578), 774, false), new extFloat.ptr(new $Uint64(3491753744, 2790753324), 800, false), new extFloat.ptr(new $Uint64(2601559269, 3918606633), 827, false), new extFloat.ptr(new $Uint64(3876625403, 2711358621), 853, false), new extFloat.ptr(new $Uint64(2888311001, 1648096297), 880, false), new extFloat.ptr(new $Uint64(2151959390, 2057817989), 907, false), new extFloat.ptr(new $Uint64(3206669376, 61660461), 933, false), new extFloat.ptr(new $Uint64(2389154863, 1581580175), 960, false), new extFloat.ptr(new $Uint64(3560118173, 2626467905), 986, false), new extFloat.ptr(new $Uint64(2652494738, 3034782633), 1013, false), new extFloat.ptr(new $Uint64(3952525166, 3135207385), 1039, false), new extFloat.ptr(new $Uint64(2944860731, 2616258155), 1066, false)]);
		uint64pow10 = $toNativeArray($kindUint64, [new $Uint64(0, 1), new $Uint64(0, 10), new $Uint64(0, 100), new $Uint64(0, 1000), new $Uint64(0, 10000), new $Uint64(0, 100000), new $Uint64(0, 1000000), new $Uint64(0, 10000000), new $Uint64(0, 100000000), new $Uint64(0, 1000000000), new $Uint64(2, 1410065408), new $Uint64(23, 1215752192), new $Uint64(232, 3567587328), new $Uint64(2328, 1316134912), new $Uint64(23283, 276447232), new $Uint64(232830, 2764472320), new $Uint64(2328306, 1874919424), new $Uint64(23283064, 1569325056), new $Uint64(232830643, 2808348672), new $Uint64(2328306436, 2313682944)]);
		float32info = new floatInfo.ptr(23, 8, -127);
		float64info = new floatInfo.ptr(52, 11, -1023);
		isPrint16 = new sliceType$4([32, 126, 161, 887, 890, 895, 900, 1366, 1369, 1418, 1421, 1479, 1488, 1514, 1520, 1524, 1542, 1563, 1566, 1805, 1808, 1866, 1869, 1969, 1984, 2042, 2048, 2093, 2096, 2139, 2142, 2142, 2208, 2237, 2260, 2444, 2447, 2448, 2451, 2482, 2486, 2489, 2492, 2500, 2503, 2504, 2507, 2510, 2519, 2519, 2524, 2531, 2534, 2555, 2561, 2570, 2575, 2576, 2579, 2617, 2620, 2626, 2631, 2632, 2635, 2637, 2641, 2641, 2649, 2654, 2662, 2677, 2689, 2745, 2748, 2765, 2768, 2768, 2784, 2787, 2790, 2801, 2809, 2809, 2817, 2828, 2831, 2832, 2835, 2873, 2876, 2884, 2887, 2888, 2891, 2893, 2902, 2903, 2908, 2915, 2918, 2935, 2946, 2954, 2958, 2965, 2969, 2975, 2979, 2980, 2984, 2986, 2990, 3001, 3006, 3010, 3014, 3021, 3024, 3024, 3031, 3031, 3046, 3066, 3072, 3129, 3133, 3149, 3157, 3162, 3168, 3171, 3174, 3183, 3192, 3257, 3260, 3277, 3285, 3286, 3294, 3299, 3302, 3314, 3329, 3386, 3389, 3407, 3412, 3427, 3430, 3455, 3458, 3478, 3482, 3517, 3520, 3526, 3530, 3530, 3535, 3551, 3558, 3567, 3570, 3572, 3585, 3642, 3647, 3675, 3713, 3716, 3719, 3722, 3725, 3725, 3732, 3751, 3754, 3773, 3776, 3789, 3792, 3801, 3804, 3807, 3840, 3948, 3953, 4058, 4096, 4295, 4301, 4301, 4304, 4685, 4688, 4701, 4704, 4749, 4752, 4789, 4792, 4805, 4808, 4885, 4888, 4954, 4957, 4988, 4992, 5017, 5024, 5109, 5112, 5117, 5120, 5788, 5792, 5880, 5888, 5908, 5920, 5942, 5952, 5971, 5984, 6003, 6016, 6109, 6112, 6121, 6128, 6137, 6144, 6157, 6160, 6169, 6176, 6263, 6272, 6314, 6320, 6389, 6400, 6443, 6448, 6459, 6464, 6464, 6468, 6509, 6512, 6516, 6528, 6571, 6576, 6601, 6608, 6618, 6622, 6683, 6686, 6780, 6783, 6793, 6800, 6809, 6816, 6829, 6832, 6846, 6912, 6987, 6992, 7036, 7040, 7155, 7164, 7223, 7227, 7241, 7245, 7304, 7360, 7367, 7376, 7417, 7424, 7669, 7675, 7957, 7960, 7965, 7968, 8005, 8008, 8013, 8016, 8061, 8064, 8147, 8150, 8175, 8178, 8190, 8208, 8231, 8240, 8286, 8304, 8305, 8308, 8348, 8352, 8382, 8400, 8432, 8448, 8587, 8592, 9254, 9280, 9290, 9312, 11123, 11126, 11157, 11160, 11193, 11197, 11217, 11244, 11247, 11264, 11507, 11513, 11559, 11565, 11565, 11568, 11623, 11631, 11632, 11647, 11670, 11680, 11844, 11904, 12019, 12032, 12245, 12272, 12283, 12289, 12438, 12441, 12543, 12549, 12589, 12593, 12730, 12736, 12771, 12784, 19893, 19904, 40917, 40960, 42124, 42128, 42182, 42192, 42539, 42560, 42743, 42752, 42935, 42999, 43051, 43056, 43065, 43072, 43127, 43136, 43205, 43214, 43225, 43232, 43261, 43264, 43347, 43359, 43388, 43392, 43481, 43486, 43574, 43584, 43597, 43600, 43609, 43612, 43714, 43739, 43766, 43777, 43782, 43785, 43790, 43793, 43798, 43808, 43877, 43888, 44013, 44016, 44025, 44032, 55203, 55216, 55238, 55243, 55291, 63744, 64109, 64112, 64217, 64256, 64262, 64275, 64279, 64285, 64449, 64467, 64831, 64848, 64911, 64914, 64967, 65008, 65021, 65024, 65049, 65056, 65131, 65136, 65276, 65281, 65470, 65474, 65479, 65482, 65487, 65490, 65495, 65498, 65500, 65504, 65518, 65532, 65533]);
		isNotPrint16 = new sliceType$4([173, 907, 909, 930, 1328, 1376, 1416, 1424, 1757, 2111, 2229, 2274, 2436, 2473, 2481, 2526, 2564, 2601, 2609, 2612, 2615, 2621, 2653, 2692, 2702, 2706, 2729, 2737, 2740, 2758, 2762, 2820, 2857, 2865, 2868, 2910, 2948, 2961, 2971, 2973, 3017, 3076, 3085, 3089, 3113, 3141, 3145, 3159, 3204, 3213, 3217, 3241, 3252, 3269, 3273, 3295, 3312, 3332, 3341, 3345, 3397, 3401, 3460, 3506, 3516, 3541, 3543, 3715, 3721, 3736, 3744, 3748, 3750, 3756, 3770, 3781, 3783, 3912, 3992, 4029, 4045, 4294, 4681, 4695, 4697, 4745, 4785, 4799, 4801, 4823, 4881, 5760, 5901, 5997, 6001, 6431, 6751, 7415, 8024, 8026, 8028, 8030, 8117, 8133, 8156, 8181, 8335, 9215, 11209, 11311, 11359, 11558, 11687, 11695, 11703, 11711, 11719, 11727, 11735, 11743, 11930, 12352, 12687, 12831, 13055, 42927, 43470, 43519, 43815, 43823, 64311, 64317, 64319, 64322, 64325, 65107, 65127, 65141, 65511]);
		isPrint32 = new sliceType$5([65536, 65613, 65616, 65629, 65664, 65786, 65792, 65794, 65799, 65843, 65847, 65947, 65952, 65952, 66000, 66045, 66176, 66204, 66208, 66256, 66272, 66299, 66304, 66339, 66352, 66378, 66384, 66426, 66432, 66499, 66504, 66517, 66560, 66717, 66720, 66729, 66736, 66771, 66776, 66811, 66816, 66855, 66864, 66915, 66927, 66927, 67072, 67382, 67392, 67413, 67424, 67431, 67584, 67589, 67592, 67640, 67644, 67644, 67647, 67742, 67751, 67759, 67808, 67829, 67835, 67867, 67871, 67897, 67903, 67903, 67968, 68023, 68028, 68047, 68050, 68102, 68108, 68147, 68152, 68154, 68159, 68167, 68176, 68184, 68192, 68255, 68288, 68326, 68331, 68342, 68352, 68405, 68409, 68437, 68440, 68466, 68472, 68497, 68505, 68508, 68521, 68527, 68608, 68680, 68736, 68786, 68800, 68850, 68858, 68863, 69216, 69246, 69632, 69709, 69714, 69743, 69759, 69825, 69840, 69864, 69872, 69881, 69888, 69955, 69968, 70006, 70016, 70093, 70096, 70132, 70144, 70206, 70272, 70313, 70320, 70378, 70384, 70393, 70400, 70412, 70415, 70416, 70419, 70457, 70460, 70468, 70471, 70472, 70475, 70477, 70480, 70480, 70487, 70487, 70493, 70499, 70502, 70508, 70512, 70516, 70656, 70749, 70784, 70855, 70864, 70873, 71040, 71093, 71096, 71133, 71168, 71236, 71248, 71257, 71264, 71276, 71296, 71351, 71360, 71369, 71424, 71449, 71453, 71467, 71472, 71487, 71840, 71922, 71935, 71935, 72384, 72440, 72704, 72773, 72784, 72812, 72816, 72847, 72850, 72886, 73728, 74649, 74752, 74868, 74880, 75075, 77824, 78894, 82944, 83526, 92160, 92728, 92736, 92777, 92782, 92783, 92880, 92909, 92912, 92917, 92928, 92997, 93008, 93047, 93053, 93071, 93952, 94020, 94032, 94078, 94095, 94111, 94176, 94176, 94208, 100332, 100352, 101106, 110592, 110593, 113664, 113770, 113776, 113788, 113792, 113800, 113808, 113817, 113820, 113823, 118784, 119029, 119040, 119078, 119081, 119154, 119163, 119272, 119296, 119365, 119552, 119638, 119648, 119665, 119808, 119967, 119970, 119970, 119973, 119974, 119977, 120074, 120077, 120134, 120138, 120485, 120488, 120779, 120782, 121483, 121499, 121519, 122880, 122904, 122907, 122922, 124928, 125124, 125127, 125142, 125184, 125258, 125264, 125273, 125278, 125279, 126464, 126500, 126503, 126523, 126530, 126530, 126535, 126548, 126551, 126564, 126567, 126619, 126625, 126651, 126704, 126705, 126976, 127019, 127024, 127123, 127136, 127150, 127153, 127221, 127232, 127244, 127248, 127339, 127344, 127404, 127462, 127490, 127504, 127547, 127552, 127560, 127568, 127569, 127744, 128722, 128736, 128748, 128752, 128758, 128768, 128883, 128896, 128980, 129024, 129035, 129040, 129095, 129104, 129113, 129120, 129159, 129168, 129197, 129296, 129319, 129328, 129328, 129331, 129355, 129360, 129374, 129408, 129425, 129472, 129472, 131072, 173782, 173824, 177972, 177984, 178205, 178208, 183969, 194560, 195101, 917760, 917999]);
		isNotPrint32 = new sliceType$4([12, 39, 59, 62, 399, 926, 2057, 2102, 2134, 2291, 2564, 2580, 2584, 4285, 4405, 4576, 4626, 4743, 4745, 4750, 4766, 4868, 4905, 4913, 4916, 5210, 5212, 7177, 7223, 7336, 9327, 27231, 27482, 27490, 54357, 54429, 54445, 54458, 54460, 54468, 54534, 54549, 54557, 54586, 54591, 54597, 54609, 55968, 57351, 57378, 57381, 60932, 60960, 60963, 60968, 60979, 60984, 60986, 61000, 61002, 61004, 61008, 61011, 61016, 61018, 61020, 61022, 61024, 61027, 61035, 61043, 61048, 61053, 61055, 61066, 61092, 61098, 61632, 61648, 61743, 63775, 63807]);
		isGraphic = new sliceType$4([160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8239, 8287, 12288]);
		shifts = $toNativeArray($kindUint, [0, 0, 1, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["encoding/base64"] = (function() {
	var $pkg = {}, $init, io, strconv, Encoding, CorruptInputError, arrayType, arrayType$1, sliceType, ptrType, arrayType$4, NewEncoding;
	io = $packages["io"];
	strconv = $packages["strconv"];
	Encoding = $pkg.Encoding = $newType(0, $kindStruct, "base64.Encoding", true, "encoding/base64", true, function(encode_, decodeMap_, padChar_, strict_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.encode = arrayType.zero();
			this.decodeMap = arrayType$1.zero();
			this.padChar = 0;
			this.strict = false;
			return;
		}
		this.encode = encode_;
		this.decodeMap = decodeMap_;
		this.padChar = padChar_;
		this.strict = strict_;
	});
	CorruptInputError = $pkg.CorruptInputError = $newType(8, $kindInt64, "base64.CorruptInputError", true, "encoding/base64", true, null);
	arrayType = $arrayType($Uint8, 64);
	arrayType$1 = $arrayType($Uint8, 256);
	sliceType = $sliceType($Uint8);
	ptrType = $ptrType(Encoding);
	arrayType$4 = $arrayType($Uint8, 4);
	NewEncoding = function(encoder$1) {
		var e, encoder$1, i, i$1, i$2, x, x$1, x$2;
		if (!((encoder$1.length === 64))) {
			$panic(new $String("encoding alphabet is not 64-bytes long"));
		}
		i = 0;
		while (true) {
			if (!(i < encoder$1.length)) { break; }
			if ((encoder$1.charCodeAt(i) === 10) || (encoder$1.charCodeAt(i) === 13)) {
				$panic(new $String("encoding alphabet contains newline character"));
			}
			i = i + (1) >> 0;
		}
		e = new Encoding.ptr(arrayType.zero(), arrayType$1.zero(), 0, false);
		e.padChar = 61;
		$copyString(new sliceType(e.encode), encoder$1);
		i$1 = 0;
		while (true) {
			if (!(i$1 < 256)) { break; }
			(x = e.decodeMap, ((i$1 < 0 || i$1 >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[i$1] = 255));
			i$1 = i$1 + (1) >> 0;
		}
		i$2 = 0;
		while (true) {
			if (!(i$2 < encoder$1.length)) { break; }
			(x$1 = e.decodeMap, x$2 = encoder$1.charCodeAt(i$2), ((x$2 < 0 || x$2 >= x$1.length) ? ($throwRuntimeError("index out of range"), undefined) : x$1[x$2] = ((i$2 << 24 >>> 24))));
			i$2 = i$2 + (1) >> 0;
		}
		return e;
	};
	$pkg.NewEncoding = NewEncoding;
	Encoding.ptr.prototype.WithPadding = function(padding) {
		var enc, i, padding, x;
		enc = this;
		if ((padding === 13) || (padding === 10) || padding > 255) {
			$panic(new $String("invalid padding"));
		}
		i = 0;
		while (true) {
			if (!(i < 64)) { break; }
			if ((((x = enc.encode, ((i < 0 || i >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[i])) >> 0)) === padding) {
				$panic(new $String("padding contained in alphabet"));
			}
			i = i + (1) >> 0;
		}
		enc.padChar = padding;
		return enc;
	};
	Encoding.prototype.WithPadding = function(padding) { return this.$val.WithPadding(padding); };
	Encoding.ptr.prototype.Strict = function() {
		var enc;
		enc = this;
		enc.strict = true;
		return enc;
	};
	Encoding.prototype.Strict = function() { return this.$val.Strict(); };
	Encoding.ptr.prototype.Encode = function(dst, src) {
		var _1, _q, _tmp, _tmp$1, di, dst, enc, n, remain, si, src, val, val$1, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$17, x$18, x$19, x$2, x$20, x$21, x$22, x$23, x$24, x$25, x$26, x$27, x$28, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		enc = this;
		if (src.$length === 0) {
			return;
		}
		_tmp = 0;
		_tmp$1 = 0;
		di = _tmp;
		si = _tmp$1;
		n = $imul(((_q = src.$length / 3, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"))), 3);
		while (true) {
			if (!(si < n)) { break; }
			val = (((((((x = si + 0 >> 0, ((x < 0 || x >= src.$length) ? ($throwRuntimeError("index out of range"), undefined) : src.$array[src.$offset + x])) >>> 0)) << 16 >>> 0) | ((((x$1 = si + 1 >> 0, ((x$1 < 0 || x$1 >= src.$length) ? ($throwRuntimeError("index out of range"), undefined) : src.$array[src.$offset + x$1])) >>> 0)) << 8 >>> 0)) >>> 0) | (((x$2 = si + 2 >> 0, ((x$2 < 0 || x$2 >= src.$length) ? ($throwRuntimeError("index out of range"), undefined) : src.$array[src.$offset + x$2])) >>> 0))) >>> 0;
			(x$5 = di + 0 >> 0, ((x$5 < 0 || x$5 >= dst.$length) ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + x$5] = (x$3 = enc.encode, x$4 = ((val >>> 18 >>> 0) & 63) >>> 0, ((x$4 < 0 || x$4 >= x$3.length) ? ($throwRuntimeError("index out of range"), undefined) : x$3[x$4]))));
			(x$8 = di + 1 >> 0, ((x$8 < 0 || x$8 >= dst.$length) ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + x$8] = (x$6 = enc.encode, x$7 = ((val >>> 12 >>> 0) & 63) >>> 0, ((x$7 < 0 || x$7 >= x$6.length) ? ($throwRuntimeError("index out of range"), undefined) : x$6[x$7]))));
			(x$11 = di + 2 >> 0, ((x$11 < 0 || x$11 >= dst.$length) ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + x$11] = (x$9 = enc.encode, x$10 = ((val >>> 6 >>> 0) & 63) >>> 0, ((x$10 < 0 || x$10 >= x$9.length) ? ($throwRuntimeError("index out of range"), undefined) : x$9[x$10]))));
			(x$14 = di + 3 >> 0, ((x$14 < 0 || x$14 >= dst.$length) ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + x$14] = (x$12 = enc.encode, x$13 = (val & 63) >>> 0, ((x$13 < 0 || x$13 >= x$12.length) ? ($throwRuntimeError("index out of range"), undefined) : x$12[x$13]))));
			si = si + (3) >> 0;
			di = di + (4) >> 0;
		}
		remain = src.$length - si >> 0;
		if (remain === 0) {
			return;
		}
		val$1 = (((x$15 = si + 0 >> 0, ((x$15 < 0 || x$15 >= src.$length) ? ($throwRuntimeError("index out of range"), undefined) : src.$array[src.$offset + x$15])) >>> 0)) << 16 >>> 0;
		if (remain === 2) {
			val$1 = (val$1 | (((((x$16 = si + 1 >> 0, ((x$16 < 0 || x$16 >= src.$length) ? ($throwRuntimeError("index out of range"), undefined) : src.$array[src.$offset + x$16])) >>> 0)) << 8 >>> 0))) >>> 0;
		}
		(x$19 = di + 0 >> 0, ((x$19 < 0 || x$19 >= dst.$length) ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + x$19] = (x$17 = enc.encode, x$18 = ((val$1 >>> 18 >>> 0) & 63) >>> 0, ((x$18 < 0 || x$18 >= x$17.length) ? ($throwRuntimeError("index out of range"), undefined) : x$17[x$18]))));
		(x$22 = di + 1 >> 0, ((x$22 < 0 || x$22 >= dst.$length) ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + x$22] = (x$20 = enc.encode, x$21 = ((val$1 >>> 12 >>> 0) & 63) >>> 0, ((x$21 < 0 || x$21 >= x$20.length) ? ($throwRuntimeError("index out of range"), undefined) : x$20[x$21]))));
		_1 = remain;
		if (_1 === (2)) {
			(x$25 = di + 2 >> 0, ((x$25 < 0 || x$25 >= dst.$length) ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + x$25] = (x$23 = enc.encode, x$24 = ((val$1 >>> 6 >>> 0) & 63) >>> 0, ((x$24 < 0 || x$24 >= x$23.length) ? ($throwRuntimeError("index out of range"), undefined) : x$23[x$24]))));
			if (!((enc.padChar === -1))) {
				(x$26 = di + 3 >> 0, ((x$26 < 0 || x$26 >= dst.$length) ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + x$26] = ((enc.padChar << 24 >>> 24))));
			}
		} else if (_1 === (1)) {
			if (!((enc.padChar === -1))) {
				(x$27 = di + 2 >> 0, ((x$27 < 0 || x$27 >= dst.$length) ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + x$27] = ((enc.padChar << 24 >>> 24))));
				(x$28 = di + 3 >> 0, ((x$28 < 0 || x$28 >= dst.$length) ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + x$28] = ((enc.padChar << 24 >>> 24))));
			}
		}
	};
	Encoding.prototype.Encode = function(dst, src) { return this.$val.Encode(dst, src); };
	Encoding.ptr.prototype.EncodeToString = function(src) {
		var buf, enc, src;
		enc = this;
		buf = $makeSlice(sliceType, enc.EncodedLen(src.$length));
		enc.Encode(buf, src);
		return ($bytesToString(buf));
	};
	Encoding.prototype.EncodeToString = function(src) { return this.$val.EncodeToString(src); };
	Encoding.ptr.prototype.EncodedLen = function(n) {
		var _q, _q$1, enc, n;
		enc = this;
		if (enc.padChar === -1) {
			return (_q = ((($imul(n, 8)) + 5 >> 0)) / 6, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		}
		return $imul((_q$1 = ((n + 2 >> 0)) / 3, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero")), 4);
	};
	Encoding.prototype.EncodedLen = function(n) { return this.$val.EncodedLen(n); };
	CorruptInputError.prototype.Error = function() {
		var e;
		e = this;
		return "illegal base64 data at input byte " + strconv.FormatInt((new $Int64(e.$high, e.$low)), 10);
	};
	$ptrType(CorruptInputError).prototype.Error = function() { return this.$get().Error(); };
	Encoding.ptr.prototype.decode = function(dst, src) {
		var _1, _2, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$22, _tmp$23, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$3, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, _tmp$39, _tmp$4, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$44, _tmp$45, _tmp$46, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, dbuf, dinc, dlen, dst, enc, end, err, in$1, j, n, out, si, src, val, x;
		n = 0;
		end = false;
		err = $ifaceNil;
		enc = this;
		si = 0;
		while (true) {
			if (!(si < src.$length && !end)) { break; }
			dbuf = arrayType$4.zero();
			_tmp = 3;
			_tmp$1 = 4;
			dinc = _tmp;
			dlen = _tmp$1;
			j = 0;
			while (true) {
				if (!(j < 4)) { break; }
				if (src.$length === si) {
					if ((j === 0)) {
						_tmp$2 = n;
						_tmp$3 = false;
						_tmp$4 = $ifaceNil;
						n = _tmp$2;
						end = _tmp$3;
						err = _tmp$4;
						return [n, end, err];
					} else if (((j === 1)) || (!((enc.padChar === -1)))) {
						_tmp$5 = n;
						_tmp$6 = false;
						_tmp$7 = (new CorruptInputError(0, (si - j >> 0)));
						n = _tmp$5;
						end = _tmp$6;
						err = _tmp$7;
						return [n, end, err];
					}
					_tmp$8 = j - 1 >> 0;
					_tmp$9 = j;
					_tmp$10 = true;
					dinc = _tmp$8;
					dlen = _tmp$9;
					end = _tmp$10;
					break;
				}
				in$1 = ((si < 0 || si >= src.$length) ? ($throwRuntimeError("index out of range"), undefined) : src.$array[src.$offset + si]);
				si = si + (1) >> 0;
				out = (x = enc.decodeMap, ((in$1 < 0 || in$1 >= x.length) ? ($throwRuntimeError("index out of range"), undefined) : x[in$1]));
				if (!((out === 255))) {
					((j < 0 || j >= dbuf.length) ? ($throwRuntimeError("index out of range"), undefined) : dbuf[j] = out);
					j = j + (1) >> 0;
					continue;
				}
				if ((in$1 === 10) || (in$1 === 13)) {
					j = j - (1) >> 0;
					j = j + (1) >> 0;
					continue;
				}
				if (((in$1 >> 0)) === enc.padChar) {
					_1 = j;
					if ((_1 === (0)) || (_1 === (1))) {
						_tmp$11 = n;
						_tmp$12 = false;
						_tmp$13 = (new CorruptInputError(0, (si - 1 >> 0)));
						n = _tmp$11;
						end = _tmp$12;
						err = _tmp$13;
						return [n, end, err];
					} else if (_1 === (2)) {
						while (true) {
							if (!(si < src.$length && ((((si < 0 || si >= src.$length) ? ($throwRuntimeError("index out of range"), undefined) : src.$array[src.$offset + si]) === 10) || (((si < 0 || si >= src.$length) ? ($throwRuntimeError("index out of range"), undefined) : src.$array[src.$offset + si]) === 13)))) { break; }
							si = si + (1) >> 0;
						}
						if (si === src.$length) {
							_tmp$14 = n;
							_tmp$15 = false;
							_tmp$16 = (new CorruptInputError(0, src.$length));
							n = _tmp$14;
							end = _tmp$15;
							err = _tmp$16;
							return [n, end, err];
						}
						if (!((((((si < 0 || si >= src.$length) ? ($throwRuntimeError("index out of range"), undefined) : src.$array[src.$offset + si]) >> 0)) === enc.padChar))) {
							_tmp$17 = n;
							_tmp$18 = false;
							_tmp$19 = (new CorruptInputError(0, (si - 1 >> 0)));
							n = _tmp$17;
							end = _tmp$18;
							err = _tmp$19;
							return [n, end, err];
						}
						si = si + (1) >> 0;
					}
					while (true) {
						if (!(si < src.$length && ((((si < 0 || si >= src.$length) ? ($throwRuntimeError("index out of range"), undefined) : src.$array[src.$offset + si]) === 10) || (((si < 0 || si >= src.$length) ? ($throwRuntimeError("index out of range"), undefined) : src.$array[src.$offset + si]) === 13)))) { break; }
						si = si + (1) >> 0;
					}
					if (si < src.$length) {
						err = (new CorruptInputError(0, si));
					}
					_tmp$20 = 3;
					_tmp$21 = j;
					_tmp$22 = true;
					dinc = _tmp$20;
					dlen = _tmp$21;
					end = _tmp$22;
					break;
				}
				_tmp$23 = n;
				_tmp$24 = false;
				_tmp$25 = (new CorruptInputError(0, (si - 1 >> 0)));
				n = _tmp$23;
				end = _tmp$24;
				err = _tmp$25;
				return [n, end, err];
			}
			val = ((((((((dbuf[0] >>> 0)) << 18 >>> 0) | (((dbuf[1] >>> 0)) << 12 >>> 0)) >>> 0) | (((dbuf[2] >>> 0)) << 6 >>> 0)) >>> 0) | ((dbuf[3] >>> 0))) >>> 0;
			_tmp$26 = (((val >>> 0 >>> 0) << 24 >>> 24));
			_tmp$27 = (((val >>> 8 >>> 0) << 24 >>> 24));
			_tmp$28 = (((val >>> 16 >>> 0) << 24 >>> 24));
			dbuf[2] = _tmp$26;
			dbuf[1] = _tmp$27;
			dbuf[0] = _tmp$28;
			_2 = dlen;
			if (_2 === (4)) {
				(2 >= dst.$length ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + 2] = dbuf[2]);
				dbuf[2] = 0;
				(1 >= dst.$length ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + 1] = dbuf[1]);
				if (enc.strict && !((dbuf[2] === 0))) {
					_tmp$29 = n;
					_tmp$30 = end;
					_tmp$31 = (new CorruptInputError(0, (si - 1 >> 0)));
					n = _tmp$29;
					end = _tmp$30;
					err = _tmp$31;
					return [n, end, err];
				}
				dbuf[1] = 0;
				(0 >= dst.$length ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + 0] = dbuf[0]);
				if (enc.strict && (!((dbuf[1] === 0)) || !((dbuf[2] === 0)))) {
					_tmp$32 = n;
					_tmp$33 = end;
					_tmp$34 = (new CorruptInputError(0, (si - 2 >> 0)));
					n = _tmp$32;
					end = _tmp$33;
					err = _tmp$34;
					return [n, end, err];
				}
			} else if (_2 === (3)) {
				(1 >= dst.$length ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + 1] = dbuf[1]);
				if (enc.strict && !((dbuf[2] === 0))) {
					_tmp$35 = n;
					_tmp$36 = end;
					_tmp$37 = (new CorruptInputError(0, (si - 1 >> 0)));
					n = _tmp$35;
					end = _tmp$36;
					err = _tmp$37;
					return [n, end, err];
				}
				dbuf[1] = 0;
				(0 >= dst.$length ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + 0] = dbuf[0]);
				if (enc.strict && (!((dbuf[1] === 0)) || !((dbuf[2] === 0)))) {
					_tmp$38 = n;
					_tmp$39 = end;
					_tmp$40 = (new CorruptInputError(0, (si - 2 >> 0)));
					n = _tmp$38;
					end = _tmp$39;
					err = _tmp$40;
					return [n, end, err];
				}
			} else if (_2 === (2)) {
				(0 >= dst.$length ? ($throwRuntimeError("index out of range"), undefined) : dst.$array[dst.$offset + 0] = dbuf[0]);
				if (enc.strict && (!((dbuf[1] === 0)) || !((dbuf[2] === 0)))) {
					_tmp$41 = n;
					_tmp$42 = end;
					_tmp$43 = (new CorruptInputError(0, (si - 2 >> 0)));
					n = _tmp$41;
					end = _tmp$42;
					err = _tmp$43;
					return [n, end, err];
				}
			}
			dst = $subslice(dst, dinc);
			n = n + ((dlen - 1 >> 0)) >> 0;
		}
		_tmp$44 = n;
		_tmp$45 = end;
		_tmp$46 = err;
		n = _tmp$44;
		end = _tmp$45;
		err = _tmp$46;
		return [n, end, err];
	};
	Encoding.prototype.decode = function(dst, src) { return this.$val.decode(dst, src); };
	Encoding.ptr.prototype.Decode = function(dst, src) {
		var _tuple, dst, enc, err, n, src;
		n = 0;
		err = $ifaceNil;
		enc = this;
		_tuple = enc.decode(dst, src);
		n = _tuple[0];
		err = _tuple[2];
		return [n, err];
	};
	Encoding.prototype.Decode = function(dst, src) { return this.$val.Decode(dst, src); };
	Encoding.ptr.prototype.DecodeString = function(s) {
		var _tuple, dbuf, enc, err, n, s;
		enc = this;
		dbuf = $makeSlice(sliceType, enc.DecodedLen(s.length));
		_tuple = enc.decode(dbuf, (new sliceType($stringToBytes(s))));
		n = _tuple[0];
		err = _tuple[2];
		return [$subslice(dbuf, 0, n), err];
	};
	Encoding.prototype.DecodeString = function(s) { return this.$val.DecodeString(s); };
	Encoding.ptr.prototype.DecodedLen = function(n) {
		var _q, _q$1, enc, n;
		enc = this;
		if (enc.padChar === -1) {
			return (_q = ($imul(n, 6)) / 8, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		}
		return $imul((_q$1 = n / 4, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero")), 3);
	};
	Encoding.prototype.DecodedLen = function(n) { return this.$val.DecodedLen(n); };
	Encoding.methods = [{prop: "WithPadding", name: "WithPadding", pkg: "", typ: $funcType([$Int32], [ptrType], false)}, {prop: "Strict", name: "Strict", pkg: "", typ: $funcType([], [ptrType], false)}];
	ptrType.methods = [{prop: "Encode", name: "Encode", pkg: "", typ: $funcType([sliceType, sliceType], [], false)}, {prop: "EncodeToString", name: "EncodeToString", pkg: "", typ: $funcType([sliceType], [$String], false)}, {prop: "EncodedLen", name: "EncodedLen", pkg: "", typ: $funcType([$Int], [$Int], false)}, {prop: "decode", name: "decode", pkg: "encoding/base64", typ: $funcType([sliceType, sliceType], [$Int, $Bool, $error], false)}, {prop: "Decode", name: "Decode", pkg: "", typ: $funcType([sliceType, sliceType], [$Int, $error], false)}, {prop: "DecodeString", name: "DecodeString", pkg: "", typ: $funcType([$String], [sliceType, $error], false)}, {prop: "DecodedLen", name: "DecodedLen", pkg: "", typ: $funcType([$Int], [$Int], false)}];
	CorruptInputError.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	Encoding.init("encoding/base64", [{prop: "encode", name: "encode", anonymous: false, exported: false, typ: arrayType, tag: ""}, {prop: "decodeMap", name: "decodeMap", anonymous: false, exported: false, typ: arrayType$1, tag: ""}, {prop: "padChar", name: "padChar", anonymous: false, exported: false, typ: $Int32, tag: ""}, {prop: "strict", name: "strict", anonymous: false, exported: false, typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = io.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.StdEncoding = NewEncoding("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
		$pkg.URLEncoding = NewEncoding("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_");
		$pkg.RawStdEncoding = $clone($pkg.StdEncoding, Encoding).WithPadding(-1);
		$pkg.RawURLEncoding = $clone($pkg.URLEncoding, Encoding).WithPadding(-1);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["reflect"] = (function() {
	var $pkg = {}, $init, errors, js, math, runtime, strconv, sync, unicode, utf8, uncommonType, funcType, name, nameData, mapIter, Type, Kind, tflag, rtype, typeAlg, method, ChanDir, arrayType, chanType, imethod, interfaceType, mapType, ptrType, sliceType, structField, structType, Method, nameOff, typeOff, textOff, StructField, StructTag, fieldScan, Value, flag, ValueError, sliceType$1, ptrType$1, sliceType$2, sliceType$3, ptrType$2, funcType$1, sliceType$4, ptrType$3, ptrType$4, sliceType$5, sliceType$6, sliceType$7, ptrType$5, ptrType$6, structType$3, sliceType$8, sliceType$9, sliceType$10, sliceType$11, ptrType$7, ptrType$8, sliceType$13, sliceType$14, ptrType$9, sliceType$15, ptrType$15, sliceType$17, ptrType$16, funcType$3, funcType$4, funcType$5, ptrType$17, arrayType$12, ptrType$18, initialized, uncommonTypeMap, nameMap, nameOffList, typeOffList, callHelper, jsObjectPtr, selectHelper, kindNames, methodCache, uint8Type, init, jsType, reflectType, setKindType, newName, newNameOff, newTypeOff, internalStr, isWrapped, copyStruct, makeValue, MakeSlice, TypeOf, ValueOf, FuncOf, SliceOf, Zero, unsafe_New, makeInt, typedmemmove, makemap, keyFor, mapaccess, mapassign, mapdelete, mapiterinit, mapiterkey, mapiternext, maplen, cvtDirect, Copy, methodReceiver, valueInterface, ifaceE2I, methodName, makeMethodValue, wrapJsObject, unwrapJsObject, getJsTag, chanrecv, chansend, PtrTo, implements$1, directlyAssignable, haveIdenticalType, haveIdenticalUnderlyingType, toType, ifaceIndir, overflowFloat32, typesMustMatch, MakeMap, MakeMapWithSize, New, convertOp, makeFloat, makeComplex, makeString, makeBytes, makeRunes, cvtInt, cvtUint, cvtFloatInt, cvtFloatUint, cvtIntFloat, cvtUintFloat, cvtFloat, cvtComplex, cvtIntString, cvtUintString, cvtBytesString, cvtStringBytes, cvtRunesString, cvtStringRunes, cvtT2I, cvtI2I;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	math = $packages["math"];
	runtime = $packages["runtime"];
	strconv = $packages["strconv"];
	sync = $packages["sync"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	uncommonType = $pkg.uncommonType = $newType(0, $kindStruct, "reflect.uncommonType", true, "reflect", false, function(pkgPath_, mcount_, _$2_, moff_, _$4_, _methods_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.pkgPath = 0;
			this.mcount = 0;
			this._$2 = 0;
			this.moff = 0;
			this._$4 = 0;
			this._methods = sliceType$5.nil;
			return;
		}
		this.pkgPath = pkgPath_;
		this.mcount = mcount_;
		this._$2 = _$2_;
		this.moff = moff_;
		this._$4 = _$4_;
		this._methods = _methods_;
	});
	funcType = $pkg.funcType = $newType(0, $kindStruct, "reflect.funcType", true, "reflect", false, function(rtype_, inCount_, outCount_, _in_, _out_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0);
			this.inCount = 0;
			this.outCount = 0;
			this._in = sliceType$2.nil;
			this._out = sliceType$2.nil;
			return;
		}
		this.rtype = rtype_;
		this.inCount = inCount_;
		this.outCount = outCount_;
		this._in = _in_;
		this._out = _out_;
	});
	name = $pkg.name = $newType(0, $kindStruct, "reflect.name", true, "reflect", false, function(bytes_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.bytes = ptrType$4.nil;
			return;
		}
		this.bytes = bytes_;
	});
	nameData = $pkg.nameData = $newType(0, $kindStruct, "reflect.nameData", true, "reflect", false, function(name_, tag_, pkgPath_, exported_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.tag = "";
			this.pkgPath = "";
			this.exported = false;
			return;
		}
		this.name = name_;
		this.tag = tag_;
		this.pkgPath = pkgPath_;
		this.exported = exported_;
	});
	mapIter = $pkg.mapIter = $newType(0, $kindStruct, "reflect.mapIter", true, "reflect", false, function(t_, m_, keys_, i_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.t = $ifaceNil;
			this.m = null;
			this.keys = null;
			this.i = 0;
			return;
		}
		this.t = t_;
		this.m = m_;
		this.keys = keys_;
		this.i = i_;
	});
	Type = $pkg.Type = $newType(8, $kindInterface, "reflect.Type", true, "reflect", true, null);
	Kind = $pkg.Kind = $newType(4, $kindUint, "reflect.Kind", true, "reflect", true, null);
	tflag = $pkg.tflag = $newType(1, $kindUint8, "reflect.tflag", true, "reflect", false, null);
	rtype = $pkg.rtype = $newType(0, $kindStruct, "reflect.rtype", true, "reflect", false, function(size_, ptrdata_, hash_, tflag_, align_, fieldAlign_, kind_, alg_, gcdata_, str_, ptrToThis_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.size = 0;
			this.ptrdata = 0;
			this.hash = 0;
			this.tflag = 0;
			this.align = 0;
			this.fieldAlign = 0;
			this.kind = 0;
			this.alg = ptrType$3.nil;
			this.gcdata = ptrType$4.nil;
			this.str = 0;
			this.ptrToThis = 0;
			return;
		}
		this.size = size_;
		this.ptrdata = ptrdata_;
		this.hash = hash_;
		this.tflag = tflag_;
		this.align = align_;
		this.fieldAlign = fieldAlign_;
		this.kind = kind_;
		this.alg = alg_;
		this.gcdata = gcdata_;
		this.str = str_;
		this.ptrToThis = ptrToThis_;
	});
	typeAlg = $pkg.typeAlg = $newType(0, $kindStruct, "reflect.typeAlg", true, "reflect", false, function(hash_, equal_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.hash = $throwNilPointerError;
			this.equal = $throwNilPointerError;
			return;
		}
		this.hash = hash_;
		this.equal = equal_;
	});
	method = $pkg.method = $newType(0, $kindStruct, "reflect.method", true, "reflect", false, function(name_, mtyp_, ifn_, tfn_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = 0;
			this.mtyp = 0;
			this.ifn = 0;
			this.tfn = 0;
			return;
		}
		this.name = name_;
		this.mtyp = mtyp_;
		this.ifn = ifn_;
		this.tfn = tfn_;
	});
	ChanDir = $pkg.ChanDir = $newType(4, $kindInt, "reflect.ChanDir", true, "reflect", true, null);
	arrayType = $pkg.arrayType = $newType(0, $kindStruct, "reflect.arrayType", true, "reflect", false, function(rtype_, elem_, slice_, len_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0);
			this.elem = ptrType$1.nil;
			this.slice = ptrType$1.nil;
			this.len = 0;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
		this.slice = slice_;
		this.len = len_;
	});
	chanType = $pkg.chanType = $newType(0, $kindStruct, "reflect.chanType", true, "reflect", false, function(rtype_, elem_, dir_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0);
			this.elem = ptrType$1.nil;
			this.dir = 0;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
		this.dir = dir_;
	});
	imethod = $pkg.imethod = $newType(0, $kindStruct, "reflect.imethod", true, "reflect", false, function(name_, typ_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = 0;
			this.typ = 0;
			return;
		}
		this.name = name_;
		this.typ = typ_;
	});
	interfaceType = $pkg.interfaceType = $newType(0, $kindStruct, "reflect.interfaceType", true, "reflect", false, function(rtype_, pkgPath_, methods_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0);
			this.pkgPath = new name.ptr(ptrType$4.nil);
			this.methods = sliceType$6.nil;
			return;
		}
		this.rtype = rtype_;
		this.pkgPath = pkgPath_;
		this.methods = methods_;
	});
	mapType = $pkg.mapType = $newType(0, $kindStruct, "reflect.mapType", true, "reflect", false, function(rtype_, key_, elem_, bucket_, hmap_, keysize_, indirectkey_, valuesize_, indirectvalue_, bucketsize_, reflexivekey_, needkeyupdate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0);
			this.key = ptrType$1.nil;
			this.elem = ptrType$1.nil;
			this.bucket = ptrType$1.nil;
			this.hmap = ptrType$1.nil;
			this.keysize = 0;
			this.indirectkey = 0;
			this.valuesize = 0;
			this.indirectvalue = 0;
			this.bucketsize = 0;
			this.reflexivekey = false;
			this.needkeyupdate = false;
			return;
		}
		this.rtype = rtype_;
		this.key = key_;
		this.elem = elem_;
		this.bucket = bucket_;
		this.hmap = hmap_;
		this.keysize = keysize_;
		this.indirectkey = indirectkey_;
		this.valuesize = valuesize_;
		this.indirectvalue = indirectvalue_;
		this.bucketsize = bucketsize_;
		this.reflexivekey = reflexivekey_;
		this.needkeyupdate = needkeyupdate_;
	});
	ptrType = $pkg.ptrType = $newType(0, $kindStruct, "reflect.ptrType", true, "reflect", false, function(rtype_, elem_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0);
			this.elem = ptrType$1.nil;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
	});
	sliceType = $pkg.sliceType = $newType(0, $kindStruct, "reflect.sliceType", true, "reflect", false, function(rtype_, elem_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0);
			this.elem = ptrType$1.nil;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
	});
	structField = $pkg.structField = $newType(0, $kindStruct, "reflect.structField", true, "reflect", false, function(name_, typ_, offsetAnon_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = new name.ptr(ptrType$4.nil);
			this.typ = ptrType$1.nil;
			this.offsetAnon = 0;
			return;
		}
		this.name = name_;
		this.typ = typ_;
		this.offsetAnon = offsetAnon_;
	});
	structType = $pkg.structType = $newType(0, $kindStruct, "reflect.structType", true, "reflect", false, function(rtype_, pkgPath_, fields_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0);
			this.pkgPath = new name.ptr(ptrType$4.nil);
			this.fields = sliceType$7.nil;
			return;
		}
		this.rtype = rtype_;
		this.pkgPath = pkgPath_;
		this.fields = fields_;
	});
	Method = $pkg.Method = $newType(0, $kindStruct, "reflect.Method", true, "reflect", true, function(Name_, PkgPath_, Type_, Func_, Index_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.PkgPath = "";
			this.Type = $ifaceNil;
			this.Func = new Value.ptr(ptrType$1.nil, 0, 0);
			this.Index = 0;
			return;
		}
		this.Name = Name_;
		this.PkgPath = PkgPath_;
		this.Type = Type_;
		this.Func = Func_;
		this.Index = Index_;
	});
	nameOff = $pkg.nameOff = $newType(4, $kindInt32, "reflect.nameOff", true, "reflect", false, null);
	typeOff = $pkg.typeOff = $newType(4, $kindInt32, "reflect.typeOff", true, "reflect", false, null);
	textOff = $pkg.textOff = $newType(4, $kindInt32, "reflect.textOff", true, "reflect", false, null);
	StructField = $pkg.StructField = $newType(0, $kindStruct, "reflect.StructField", true, "reflect", true, function(Name_, PkgPath_, Type_, Tag_, Offset_, Index_, Anonymous_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.PkgPath = "";
			this.Type = $ifaceNil;
			this.Tag = "";
			this.Offset = 0;
			this.Index = sliceType$13.nil;
			this.Anonymous = false;
			return;
		}
		this.Name = Name_;
		this.PkgPath = PkgPath_;
		this.Type = Type_;
		this.Tag = Tag_;
		this.Offset = Offset_;
		this.Index = Index_;
		this.Anonymous = Anonymous_;
	});
	StructTag = $pkg.StructTag = $newType(8, $kindString, "reflect.StructTag", true, "reflect", true, null);
	fieldScan = $pkg.fieldScan = $newType(0, $kindStruct, "reflect.fieldScan", true, "reflect", false, function(typ_, index_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.typ = ptrType$9.nil;
			this.index = sliceType$13.nil;
			return;
		}
		this.typ = typ_;
		this.index = index_;
	});
	Value = $pkg.Value = $newType(0, $kindStruct, "reflect.Value", true, "reflect", true, function(typ_, ptr_, flag_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.typ = ptrType$1.nil;
			this.ptr = 0;
			this.flag = 0;
			return;
		}
		this.typ = typ_;
		this.ptr = ptr_;
		this.flag = flag_;
	});
	flag = $pkg.flag = $newType(4, $kindUintptr, "reflect.flag", true, "reflect", false, null);
	ValueError = $pkg.ValueError = $newType(0, $kindStruct, "reflect.ValueError", true, "reflect", true, function(Method_, Kind_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Method = "";
			this.Kind = 0;
			return;
		}
		this.Method = Method_;
		this.Kind = Kind_;
	});
	sliceType$1 = $sliceType(name);
	ptrType$1 = $ptrType(rtype);
	sliceType$2 = $sliceType(ptrType$1);
	sliceType$3 = $sliceType($emptyInterface);
	ptrType$2 = $ptrType(js.Object);
	funcType$1 = $funcType([sliceType$3], [ptrType$2], true);
	sliceType$4 = $sliceType($String);
	ptrType$3 = $ptrType(typeAlg);
	ptrType$4 = $ptrType($Uint8);
	sliceType$5 = $sliceType(method);
	sliceType$6 = $sliceType(imethod);
	sliceType$7 = $sliceType(structField);
	ptrType$5 = $ptrType(uncommonType);
	ptrType$6 = $ptrType(nameData);
	structType$3 = $structType("reflect", [{prop: "str", name: "str", anonymous: false, exported: false, typ: $String, tag: ""}]);
	sliceType$8 = $sliceType(ptrType$2);
	sliceType$9 = $sliceType(Value);
	sliceType$10 = $sliceType(Type);
	sliceType$11 = $sliceType(sliceType$8);
	ptrType$7 = $ptrType(interfaceType);
	ptrType$8 = $ptrType(imethod);
	sliceType$13 = $sliceType($Int);
	sliceType$14 = $sliceType(fieldScan);
	ptrType$9 = $ptrType(structType);
	sliceType$15 = $sliceType($Uint8);
	ptrType$15 = $ptrType($UnsafePointer);
	sliceType$17 = $sliceType($Int32);
	ptrType$16 = $ptrType(funcType);
	funcType$3 = $funcType([$String], [$Bool], false);
	funcType$4 = $funcType([$UnsafePointer, $Uintptr], [$Uintptr], false);
	funcType$5 = $funcType([$UnsafePointer, $UnsafePointer], [$Bool], false);
	ptrType$17 = $ptrType(structField);
	arrayType$12 = $arrayType($Uintptr, 2);
	ptrType$18 = $ptrType(ValueError);
	init = function() {
		var used, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; used = $f.used; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		used = (function(i) {
			var i;
		});
		$r = used((x = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), new x.constructor.elem(x))); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$1 = new uncommonType.ptr(0, 0, 0, 0, 0, sliceType$5.nil), new x$1.constructor.elem(x$1))); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$2 = new method.ptr(0, 0, 0, 0), new x$2.constructor.elem(x$2))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$3 = new arrayType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), ptrType$1.nil, ptrType$1.nil, 0), new x$3.constructor.elem(x$3))); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$4 = new chanType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), ptrType$1.nil, 0), new x$4.constructor.elem(x$4))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$5 = new funcType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), 0, 0, sliceType$2.nil, sliceType$2.nil), new x$5.constructor.elem(x$5))); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$6 = new interfaceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), new name.ptr(ptrType$4.nil), sliceType$6.nil), new x$6.constructor.elem(x$6))); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$7 = new mapType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), ptrType$1.nil, ptrType$1.nil, ptrType$1.nil, ptrType$1.nil, 0, 0, 0, 0, 0, false, false), new x$7.constructor.elem(x$7))); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$8 = new ptrType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), ptrType$1.nil), new x$8.constructor.elem(x$8))); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$9 = new sliceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), ptrType$1.nil), new x$9.constructor.elem(x$9))); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$10 = new structType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), new name.ptr(ptrType$4.nil), sliceType$7.nil), new x$10.constructor.elem(x$10))); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$11 = new imethod.ptr(0, 0), new x$11.constructor.elem(x$11))); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$12 = new structField.ptr(new name.ptr(ptrType$4.nil), ptrType$1.nil, 0), new x$12.constructor.elem(x$12))); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		initialized = true;
		uint8Type = $assertType(TypeOf(new $Uint8(0)), ptrType$1);
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: init }; } $f.used = used; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.$s = $s; $f.$r = $r; return $f;
	};
	jsType = function(typ) {
		var typ;
		return typ.jsType;
	};
	reflectType = function(typ) {
		var _1, _i, _i$1, _i$2, _i$3, _i$4, _key, _ref, _ref$1, _ref$2, _ref$3, _ref$4, dir, f, fields, i, i$1, i$2, i$3, i$4, imethods, in$1, m, m$1, methodSet, methods, offsetAnon, out, outCount, params, reflectFields, reflectMethods, results, rt, typ, ut;
		if (typ.reflectType === undefined) {
			rt = new rtype.ptr(((($parseInt(typ.size) >> 0) >>> 0)), 0, 0, 0, 0, 0, ((($parseInt(typ.kind) >> 0) << 24 >>> 24)), ptrType$3.nil, ptrType$4.nil, newNameOff($clone(newName(internalStr(typ.string), "", "", !!(typ.exported)), name)), 0);
			rt.jsType = typ;
			typ.reflectType = rt;
			methodSet = $methodSet(typ);
			if (!(($parseInt(methodSet.length) === 0)) || !!(typ.named)) {
				rt.tflag = (rt.tflag | (1)) >>> 0;
				if (!!(typ.named)) {
					rt.tflag = (rt.tflag | (4)) >>> 0;
				}
				reflectMethods = $makeSlice(sliceType$5, $parseInt(methodSet.length));
				_ref = reflectMethods;
				_i = 0;
				while (true) {
					if (!(_i < _ref.$length)) { break; }
					i = _i;
					m = methodSet[i];
					method.copy(((i < 0 || i >= reflectMethods.$length) ? ($throwRuntimeError("index out of range"), undefined) : reflectMethods.$array[reflectMethods.$offset + i]), new method.ptr(newNameOff($clone(newName(internalStr(m.name), "", "", internalStr(m.pkg) === ""), name)), newTypeOff(reflectType(m.typ)), 0, 0));
					_i++;
				}
				ut = new uncommonType.ptr(newNameOff($clone(newName(internalStr(typ.pkg), "", "", false), name)), (($parseInt(methodSet.length) << 16 >>> 16)), 0, 0, 0, reflectMethods);
				_key = rt; (uncommonTypeMap || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: ut };
				ut.jsType = typ;
			}
			_1 = rt.Kind();
			if (_1 === (17)) {
				setKindType(rt, new arrayType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), reflectType(typ.elem), ptrType$1.nil, ((($parseInt(typ.len) >> 0) >>> 0))));
			} else if (_1 === (18)) {
				dir = 3;
				if (!!(typ.sendOnly)) {
					dir = 2;
				}
				if (!!(typ.recvOnly)) {
					dir = 1;
				}
				setKindType(rt, new chanType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), reflectType(typ.elem), ((dir >>> 0))));
			} else if (_1 === (19)) {
				params = typ.params;
				in$1 = $makeSlice(sliceType$2, $parseInt(params.length));
				_ref$1 = in$1;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					i$1 = _i$1;
					((i$1 < 0 || i$1 >= in$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : in$1.$array[in$1.$offset + i$1] = reflectType(params[i$1]));
					_i$1++;
				}
				results = typ.results;
				out = $makeSlice(sliceType$2, $parseInt(results.length));
				_ref$2 = out;
				_i$2 = 0;
				while (true) {
					if (!(_i$2 < _ref$2.$length)) { break; }
					i$2 = _i$2;
					((i$2 < 0 || i$2 >= out.$length) ? ($throwRuntimeError("index out of range"), undefined) : out.$array[out.$offset + i$2] = reflectType(results[i$2]));
					_i$2++;
				}
				outCount = (($parseInt(results.length) << 16 >>> 16));
				if (!!(typ.variadic)) {
					outCount = (outCount | (32768)) >>> 0;
				}
				setKindType(rt, new funcType.ptr($clone(rt, rtype), (($parseInt(params.length) << 16 >>> 16)), outCount, in$1, out));
			} else if (_1 === (20)) {
				methods = typ.methods;
				imethods = $makeSlice(sliceType$6, $parseInt(methods.length));
				_ref$3 = imethods;
				_i$3 = 0;
				while (true) {
					if (!(_i$3 < _ref$3.$length)) { break; }
					i$3 = _i$3;
					m$1 = methods[i$3];
					imethod.copy(((i$3 < 0 || i$3 >= imethods.$length) ? ($throwRuntimeError("index out of range"), undefined) : imethods.$array[imethods.$offset + i$3]), new imethod.ptr(newNameOff($clone(newName(internalStr(m$1.name), "", "", internalStr(m$1.pkg) === ""), name)), newTypeOff(reflectType(m$1.typ))));
					_i$3++;
				}
				setKindType(rt, new interfaceType.ptr($clone(rt, rtype), $clone(newName(internalStr(typ.pkg), "", "", false), name), imethods));
			} else if (_1 === (21)) {
				setKindType(rt, new mapType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), reflectType(typ.key), reflectType(typ.elem), ptrType$1.nil, ptrType$1.nil, 0, 0, 0, 0, 0, false, false));
			} else if (_1 === (22)) {
				setKindType(rt, new ptrType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), reflectType(typ.elem)));
			} else if (_1 === (23)) {
				setKindType(rt, new sliceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0), reflectType(typ.elem)));
			} else if (_1 === (25)) {
				fields = typ.fields;
				reflectFields = $makeSlice(sliceType$7, $parseInt(fields.length));
				_ref$4 = reflectFields;
				_i$4 = 0;
				while (true) {
					if (!(_i$4 < _ref$4.$length)) { break; }
					i$4 = _i$4;
					f = fields[i$4];
					offsetAnon = ((i$4 >>> 0)) << 1 >>> 0;
					if (!!(f.anonymous)) {
						offsetAnon = (offsetAnon | (1)) >>> 0;
					}
					structField.copy(((i$4 < 0 || i$4 >= reflectFields.$length) ? ($throwRuntimeError("index out of range"), undefined) : reflectFields.$array[reflectFields.$offset + i$4]), new structField.ptr($clone(newName(internalStr(f.name), internalStr(f.tag), "", !!(f.exported)), name), reflectType(f.typ), offsetAnon));
					_i$4++;
				}
				setKindType(rt, new structType.ptr($clone(rt, rtype), $clone(newName(internalStr(typ.pkgPath), "", "", false), name), reflectFields));
			}
		}
		return ((typ.reflectType));
	};
	setKindType = function(rt, kindType) {
		var kindType, rt;
		rt.kindType = kindType;
		kindType.rtype = rt;
	};
	uncommonType.ptr.prototype.methods = function() {
		var t;
		t = this;
		return t._methods;
	};
	uncommonType.prototype.methods = function() { return this.$val.methods(); };
	rtype.ptr.prototype.uncommon = function() {
		var _entry, t;
		t = this;
		return (_entry = uncommonTypeMap[ptrType$1.keyFor(t)], _entry !== undefined ? _entry.v : ptrType$5.nil);
	};
	rtype.prototype.uncommon = function() { return this.$val.uncommon(); };
	funcType.ptr.prototype.in$ = function() {
		var t;
		t = this;
		return t._in;
	};
	funcType.prototype.in$ = function() { return this.$val.in$(); };
	funcType.ptr.prototype.out = function() {
		var t;
		t = this;
		return t._out;
	};
	funcType.prototype.out = function() { return this.$val.out(); };
	name.ptr.prototype.name = function() {
		var _entry, n, s;
		s = "";
		n = this;
		s = (_entry = nameMap[ptrType$4.keyFor(n.bytes)], _entry !== undefined ? _entry.v : ptrType$6.nil).name;
		return s;
	};
	name.prototype.name = function() { return this.$val.name(); };
	name.ptr.prototype.tag = function() {
		var _entry, n, s;
		s = "";
		n = this;
		s = (_entry = nameMap[ptrType$4.keyFor(n.bytes)], _entry !== undefined ? _entry.v : ptrType$6.nil).tag;
		return s;
	};
	name.prototype.tag = function() { return this.$val.tag(); };
	name.ptr.prototype.pkgPath = function() {
		var _entry, n;
		n = this;
		return (_entry = nameMap[ptrType$4.keyFor(n.bytes)], _entry !== undefined ? _entry.v : ptrType$6.nil).pkgPath;
	};
	name.prototype.pkgPath = function() { return this.$val.pkgPath(); };
	name.ptr.prototype.isExported = function() {
		var _entry, n;
		n = this;
		return (_entry = nameMap[ptrType$4.keyFor(n.bytes)], _entry !== undefined ? _entry.v : ptrType$6.nil).exported;
	};
	name.prototype.isExported = function() { return this.$val.isExported(); };
	newName = function(n, tag, pkgPath, exported) {
		var _key, b, exported, n, pkgPath, tag;
		b = $newDataPointer(0, ptrType$4);
		_key = b; (nameMap || $throwRuntimeError("assignment to entry in nil map"))[ptrType$4.keyFor(_key)] = { k: _key, v: new nameData.ptr(n, tag, pkgPath, exported) };
		return new name.ptr(b);
	};
	rtype.ptr.prototype.nameOff = function(off) {
		var off, t, x;
		t = this;
		return (x = ((off >> 0)), ((x < 0 || x >= nameOffList.$length) ? ($throwRuntimeError("index out of range"), undefined) : nameOffList.$array[nameOffList.$offset + x]));
	};
	rtype.prototype.nameOff = function(off) { return this.$val.nameOff(off); };
	newNameOff = function(n) {
		var i, n;
		i = nameOffList.$length;
		nameOffList = $append(nameOffList, n);
		return ((i >> 0));
	};
	rtype.ptr.prototype.typeOff = function(off) {
		var off, t, x;
		t = this;
		return (x = ((off >> 0)), ((x < 0 || x >= typeOffList.$length) ? ($throwRuntimeError("index out of range"), undefined) : typeOffList.$array[typeOffList.$offset + x]));
	};
	rtype.prototype.typeOff = function(off) { return this.$val.typeOff(off); };
	newTypeOff = function(t) {
		var i, t;
		i = typeOffList.$length;
		typeOffList = $append(typeOffList, t);
		return ((i >> 0));
	};
	internalStr = function(strObj) {
		var c, strObj;
		c = new structType$3.ptr("");
		c.str = strObj;
		return c.str;
	};
	isWrapped = function(typ) {
		var typ;
		return !!(jsType(typ).wrapped);
	};
	copyStruct = function(dst, src, typ) {
		var dst, fields, i, prop, src, typ;
		fields = jsType(typ).fields;
		i = 0;
		while (true) {
			if (!(i < $parseInt(fields.length))) { break; }
			prop = $internalize(fields[i].prop, $String);
			dst[$externalize(prop, $String)] = src[$externalize(prop, $String)];
			i = i + (1) >> 0;
		}
	};
	makeValue = function(t, v, fl) {
		var _r, _r$1, _r$2, _r$3, _r$4, _r$5, _v, _v$1, fl, rt, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _v = $f._v; _v$1 = $f._v$1; fl = $f.fl; rt = $f.rt; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		rt = _r;
		_r$1 = t.Kind(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		if (_r$1 === 17) { _v$1 = true; $s = 5; continue s; }
		_r$2 = t.Kind(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_v$1 = _r$2 === 25; case 5:
		if (_v$1) { _v = true; $s = 4; continue s; }
		_r$3 = t.Kind(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		_v = _r$3 === 22; case 4:
		/* */ if (_v) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (_v) { */ case 2:
			_r$4 = t.Kind(); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			$s = -1; return new Value.ptr(rt, (v), (fl | ((_r$4 >>> 0))) >>> 0);
		/* } */ case 3:
		_r$5 = t.Kind(); /* */ $s = 10; case 10: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(rt, ($newDataPointer(v, jsType(rt.ptrTo()))), (((fl | ((_r$5 >>> 0))) >>> 0) | 128) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeValue }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._v = _v; $f._v$1 = _v$1; $f.fl = fl; $f.rt = rt; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	MakeSlice = function(typ, len, cap) {
		var _r, _r$1, cap, len, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; cap = $f.cap; len = $f.len; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		typ = [typ];
		_r = typ[0].Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 23))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 23))) { */ case 1:
			$panic(new $String("reflect.MakeSlice of non-slice type"));
		/* } */ case 2:
		if (len < 0) {
			$panic(new $String("reflect.MakeSlice: negative len"));
		}
		if (cap < 0) {
			$panic(new $String("reflect.MakeSlice: negative cap"));
		}
		if (len > cap) {
			$panic(new $String("reflect.MakeSlice: len > cap"));
		}
		_r$1 = makeValue(typ[0], $makeSlice(jsType(typ[0]), len, cap, (function(typ) { return function $b() {
			var _r$1, _r$2, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r$1 = $f._r$1; _r$2 = $f._r$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r$1 = typ[0].Elem(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_r$2 = jsType(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			$s = -1; return _r$2.zero();
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f._r$1 = _r$1; $f._r$2 = _r$2; $f.$s = $s; $f.$r = $r; return $f;
		}; })(typ)), 0); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: MakeSlice }; } $f._r = _r; $f._r$1 = _r$1; $f.cap = cap; $f.len = len; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.MakeSlice = MakeSlice;
	TypeOf = function(i) {
		var i;
		if (!initialized) {
			return new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$3.nil, ptrType$4.nil, 0, 0);
		}
		if ($interfaceIsEqual(i, $ifaceNil)) {
			return $ifaceNil;
		}
		return reflectType(i.constructor);
	};
	$pkg.TypeOf = TypeOf;
	ValueOf = function(i) {
		var _r, i, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; i = $f.i; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if ($interfaceIsEqual(i, $ifaceNil)) {
			$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_r = makeValue(reflectType(i.constructor), i.$val, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ValueOf }; } $f._r = _r; $f.i = i; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ValueOf = ValueOf;
	FuncOf = function(in$1, out, variadic) {
		var _i, _i$1, _r, _ref, _ref$1, _v, _v$1, i, i$1, in$1, jsIn, jsOut, out, v, v$1, variadic, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _ref = $f._ref; _ref$1 = $f._ref$1; _v = $f._v; _v$1 = $f._v$1; i = $f.i; i$1 = $f.i$1; in$1 = $f.in$1; jsIn = $f.jsIn; jsOut = $f.jsOut; out = $f.out; v = $f.v; v$1 = $f.v$1; variadic = $f.variadic; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (!(variadic)) { _v = false; $s = 3; continue s; }
		if (in$1.$length === 0) { _v$1 = true; $s = 4; continue s; }
		_r = (x = in$1.$length - 1 >> 0, ((x < 0 || x >= in$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : in$1.$array[in$1.$offset + x])).Kind(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_v$1 = !((_r === 23)); case 4:
		_v = _v$1; case 3:
		/* */ if (_v) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_v) { */ case 1:
			$panic(new $String("reflect.FuncOf: last arg of variadic func must be slice"));
		/* } */ case 2:
		jsIn = $makeSlice(sliceType$8, in$1.$length);
		_ref = in$1;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			v = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= jsIn.$length) ? ($throwRuntimeError("index out of range"), undefined) : jsIn.$array[jsIn.$offset + i] = jsType(v));
			_i++;
		}
		jsOut = $makeSlice(sliceType$8, out.$length);
		_ref$1 = out;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			i$1 = _i$1;
			v$1 = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref$1.$array[_ref$1.$offset + _i$1]);
			((i$1 < 0 || i$1 >= jsOut.$length) ? ($throwRuntimeError("index out of range"), undefined) : jsOut.$array[jsOut.$offset + i$1] = jsType(v$1));
			_i$1++;
		}
		$s = -1; return reflectType($funcType($externalize(jsIn, sliceType$8), $externalize(jsOut, sliceType$8), $externalize(variadic, $Bool)));
		/* */ } return; } if ($f === undefined) { $f = { $blk: FuncOf }; } $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._ref = _ref; $f._ref$1 = _ref$1; $f._v = _v; $f._v$1 = _v$1; $f.i = i; $f.i$1 = i$1; $f.in$1 = in$1; $f.jsIn = jsIn; $f.jsOut = jsOut; $f.out = out; $f.v = v; $f.v$1 = v$1; $f.variadic = variadic; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.FuncOf = FuncOf;
	rtype.ptr.prototype.ptrTo = function() {
		var t;
		t = this;
		return reflectType($ptrType(jsType(t)));
	};
	rtype.prototype.ptrTo = function() { return this.$val.ptrTo(); };
	SliceOf = function(t) {
		var t;
		return reflectType($sliceType(jsType(t)));
	};
	$pkg.SliceOf = SliceOf;
	Zero = function(typ) {
		var _r, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeValue(typ, jsType(typ).zero(), 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Zero }; } $f._r = _r; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Zero = Zero;
	unsafe_New = function(typ) {
		var _1, typ;
		_1 = typ.Kind();
		if (_1 === (25)) {
			return (new (jsType(typ).ptr)());
		} else if (_1 === (17)) {
			return (jsType(typ).zero());
		} else {
			return ($newDataPointer(jsType(typ).zero(), jsType(typ.ptrTo())));
		}
	};
	makeInt = function(f, bits, t) {
		var _1, _r, bits, f, ptr, t, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r = $f._r; bits = $f.bits; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_1 = typ.Kind();
		if (_1 === (3)) {
			(ptr).$set(((bits.$low << 24 >> 24)));
		} else if (_1 === (4)) {
			(ptr).$set(((bits.$low << 16 >> 16)));
		} else if ((_1 === (2)) || (_1 === (5))) {
			(ptr).$set(((bits.$low >> 0)));
		} else if (_1 === (6)) {
			(ptr).$set((new $Int64(bits.$high, bits.$low)));
		} else if (_1 === (8)) {
			(ptr).$set(((bits.$low << 24 >>> 24)));
		} else if (_1 === (9)) {
			(ptr).$set(((bits.$low << 16 >>> 16)));
		} else if ((_1 === (7)) || (_1 === (10)) || (_1 === (12))) {
			(ptr).$set(((bits.$low >>> 0)));
		} else if (_1 === (11)) {
			(ptr).$set((bits));
		}
		$s = -1; return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | ((typ.Kind() >>> 0))) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeInt }; } $f._1 = _1; $f._r = _r; $f.bits = bits; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	typedmemmove = function(t, dst, src) {
		var dst, src, t;
		dst.$set(src.$get());
	};
	makemap = function(t, cap) {
		var cap, m, t;
		m = 0;
		m = (new ($global.Object)());
		return m;
	};
	keyFor = function(t, key) {
		var k, key, kv, t;
		kv = key;
		if (!(kv.$get === undefined)) {
			kv = kv.$get();
		}
		k = $internalize(jsType(t.Key()).keyFor(kv), $String);
		return [kv, k];
	};
	mapaccess = function(t, m, key) {
		var _tuple, entry, k, key, m, t;
		_tuple = keyFor(t, key);
		k = _tuple[1];
		entry = m[$externalize(k, $String)];
		if (entry === undefined) {
			return 0;
		}
		return ($newDataPointer(entry.v, jsType(PtrTo(t.Elem()))));
	};
	mapassign = function(t, m, key, val) {
		var _r, _tuple, entry, et, jsVal, k, key, kv, m, newVal, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; entry = $f.entry; et = $f.et; jsVal = $f.jsVal; k = $f.k; key = $f.key; kv = $f.kv; m = $f.m; newVal = $f.newVal; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = keyFor(t, key);
		kv = _tuple[0];
		k = _tuple[1];
		jsVal = val.$get();
		et = t.Elem();
		_r = et.Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (_r === 25) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_r === 25) { */ case 1:
			newVal = jsType(et).zero();
			copyStruct(newVal, jsVal, et);
			jsVal = newVal;
		/* } */ case 2:
		entry = new ($global.Object)();
		entry.k = kv;
		entry.v = jsVal;
		m[$externalize(k, $String)] = entry;
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: mapassign }; } $f._r = _r; $f._tuple = _tuple; $f.entry = entry; $f.et = et; $f.jsVal = jsVal; $f.k = k; $f.key = key; $f.kv = kv; $f.m = m; $f.newVal = newVal; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	mapdelete = function(t, m, key) {
		var _tuple, k, key, m, t;
		_tuple = keyFor(t, key);
		k = _tuple[1];
		delete m[$externalize(k, $String)];
	};
	mapiterinit = function(t, m) {
		var m, t;
		return ((new mapIter.ptr(t, m, $keys(m), 0)));
	};
	mapiterkey = function(it) {
		var _r, _r$1, _r$2, it, iter, k, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; it = $f.it; iter = $f.iter; k = $f.k; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		iter = ((it));
		k = iter.keys[iter.i];
		_r = iter.t.Key(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = PtrTo(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = jsType(_r$1); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return ($newDataPointer(iter.m[$externalize($internalize(k, $String), $String)].k, _r$2));
		/* */ } return; } if ($f === undefined) { $f = { $blk: mapiterkey }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.it = it; $f.iter = iter; $f.k = k; $f.$s = $s; $f.$r = $r; return $f;
	};
	mapiternext = function(it) {
		var it, iter;
		iter = ((it));
		iter.i = iter.i + (1) >> 0;
	};
	maplen = function(m) {
		var m;
		return $parseInt($keys(m).length);
	};
	cvtDirect = function(v, typ) {
		var _1, _arg, _arg$1, _arg$2, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, k, slice, srcVal, typ, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; k = $f.k; slice = $f.slice; srcVal = $f.srcVal; typ = $f.typ; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		srcVal = $clone(v, Value).object();
		/* */ if (srcVal === jsType(v.typ).nil) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (srcVal === jsType(v.typ).nil) { */ case 1:
			_r = makeValue(typ, jsType(typ).nil, v.flag); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return _r;
		/* } */ case 2:
		val = null;
			_r$1 = typ.Kind(); /* */ $s = 5; case 5: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			k = _r$1;
			_1 = k;
			/* */ if (_1 === (23)) { $s = 6; continue; }
			/* */ if (_1 === (22)) { $s = 7; continue; }
			/* */ if (_1 === (25)) { $s = 8; continue; }
			/* */ if ((_1 === (17)) || (_1 === (1)) || (_1 === (18)) || (_1 === (19)) || (_1 === (20)) || (_1 === (21)) || (_1 === (24))) { $s = 9; continue; }
			/* */ $s = 10; continue;
			/* if (_1 === (23)) { */ case 6:
				slice = new (jsType(typ))(srcVal.$array);
				slice.$offset = srcVal.$offset;
				slice.$length = srcVal.$length;
				slice.$capacity = srcVal.$capacity;
				val = $newDataPointer(slice, jsType(PtrTo(typ)));
				$s = 11; continue;
			/* } else if (_1 === (22)) { */ case 7:
				_r$2 = typ.Elem(); /* */ $s = 14; case 14: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_r$3 = _r$2.Kind(); /* */ $s = 15; case 15: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				/* */ if (_r$3 === 25) { $s = 12; continue; }
				/* */ $s = 13; continue;
				/* if (_r$3 === 25) { */ case 12:
					_r$4 = typ.Elem(); /* */ $s = 18; case 18: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					/* */ if ($interfaceIsEqual(_r$4, v.typ.Elem())) { $s = 16; continue; }
					/* */ $s = 17; continue;
					/* if ($interfaceIsEqual(_r$4, v.typ.Elem())) { */ case 16:
						val = srcVal;
						/* break; */ $s = 4; continue;
					/* } */ case 17:
					val = new (jsType(typ))();
					_arg = val;
					_arg$1 = srcVal;
					_r$5 = typ.Elem(); /* */ $s = 19; case 19: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
					_arg$2 = _r$5;
					$r = copyStruct(_arg, _arg$1, _arg$2); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					/* break; */ $s = 4; continue;
				/* } */ case 13:
				val = new (jsType(typ))(srcVal.$get, srcVal.$set);
				$s = 11; continue;
			/* } else if (_1 === (25)) { */ case 8:
				val = new (jsType(typ).ptr)();
				copyStruct(val, srcVal, typ);
				$s = 11; continue;
			/* } else if ((_1 === (17)) || (_1 === (1)) || (_1 === (18)) || (_1 === (19)) || (_1 === (20)) || (_1 === (21)) || (_1 === (24))) { */ case 9:
				val = v.ptr;
				$s = 11; continue;
			/* } else { */ case 10:
				$panic(new ValueError.ptr("reflect.Convert", k));
			/* } */ case 11:
		case 4:
		_r$6 = typ.common(); /* */ $s = 21; case 21: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		_r$7 = typ.Kind(); /* */ $s = 22; case 22: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r$6, (val), (((v.flag & 224) >>> 0) | ((_r$7 >>> 0))) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtDirect }; } $f._1 = _1; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f.k = k; $f.slice = slice; $f.srcVal = srcVal; $f.typ = typ; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Copy = function(dst, src) {
		var dk, dst, dstVal, sk, src, srcVal, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; dk = $f.dk; dst = $f.dst; dstVal = $f.dstVal; sk = $f.sk; src = $f.src; srcVal = $f.srcVal; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		dk = new flag(dst.flag).kind();
		if (!((dk === 17)) && !((dk === 23))) {
			$panic(new ValueError.ptr("reflect.Copy", dk));
		}
		if (dk === 17) {
			new flag(dst.flag).mustBeAssignable();
		}
		new flag(dst.flag).mustBeExported();
		sk = new flag(src.flag).kind();
		if (!((sk === 17)) && !((sk === 23))) {
			$panic(new ValueError.ptr("reflect.Copy", sk));
		}
		new flag(src.flag).mustBeExported();
		$r = typesMustMatch("reflect.Copy", dst.typ.Elem(), src.typ.Elem()); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		dstVal = $clone(dst, Value).object();
		if (dk === 17) {
			dstVal = new (jsType(SliceOf(dst.typ.Elem())))(dstVal);
		}
		srcVal = $clone(src, Value).object();
		if (sk === 17) {
			srcVal = new (jsType(SliceOf(src.typ.Elem())))(srcVal);
		}
		$s = -1; return $parseInt($copySlice(dstVal, srcVal)) >> 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Copy }; } $f.dk = dk; $f.dst = dst; $f.dstVal = dstVal; $f.sk = sk; $f.src = src; $f.srcVal = srcVal; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Copy = Copy;
	methodReceiver = function(op, v, i) {
		var _$38, fn, i, m, m$1, op, prop, rcvr, t, tt, ut, v, x, x$1;
		_$38 = ptrType$1.nil;
		t = ptrType$1.nil;
		fn = 0;
		prop = "";
		if (v.typ.Kind() === 20) {
			tt = (v.typ.kindType);
			if (i < 0 || i >= tt.methods.$length) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m = (x = tt.methods, ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]));
			if (!$clone(tt.rtype.nameOff(m.name), name).isExported()) {
				$panic(new $String("reflect: " + op + " of unexported method"));
			}
			t = tt.rtype.typeOff(m.typ);
			prop = $clone(tt.rtype.nameOff(m.name), name).name();
		} else {
			ut = v.typ.uncommon();
			if (ut === ptrType$5.nil || ((i >>> 0)) >= ((ut.mcount >>> 0))) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m$1 = $clone((x$1 = ut.methods(), ((i < 0 || i >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + i])), method);
			if (!$clone(v.typ.nameOff(m$1.name), name).isExported()) {
				$panic(new $String("reflect: " + op + " of unexported method"));
			}
			t = v.typ.typeOff(m$1.mtyp);
			prop = $internalize($methodSet(jsType(v.typ))[i].prop, $String);
		}
		rcvr = $clone(v, Value).object();
		if (isWrapped(v.typ)) {
			rcvr = new (jsType(v.typ))(rcvr);
		}
		fn = (rcvr[$externalize(prop, $String)]);
		return [_$38, t, fn];
	};
	valueInterface = function(v, safe) {
		var _r, safe, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; safe = $f.safe; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (v.flag === 0) {
			$panic(new ValueError.ptr("reflect.Value.Interface", 0));
		}
		if (safe && !((((v.flag & 96) >>> 0) === 0))) {
			$panic(new $String("reflect.Value.Interface: cannot return value obtained from unexported field or method"));
		}
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue("Interface", $clone(v, Value)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
		if (isWrapped(v.typ)) {
			$s = -1; return ((new (jsType(v.typ))($clone(v, Value).object())));
		}
		$s = -1; return (($clone(v, Value).object()));
		/* */ } return; } if ($f === undefined) { $f = { $blk: valueInterface }; } $f._r = _r; $f.safe = safe; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	ifaceE2I = function(t, src, dst) {
		var dst, src, t;
		dst.$set(src);
	};
	methodName = function() {
		return "?FIXME?";
	};
	makeMethodValue = function(op, v) {
		var _r, _tuple, fn, fv, op, rcvr, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; fn = $f.fn; fv = $f.fv; op = $f.op; rcvr = $f.rcvr; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		fn = [fn];
		rcvr = [rcvr];
		if (((v.flag & 512) >>> 0) === 0) {
			$panic(new $String("reflect: internal error: invalid use of makePartialFunc"));
		}
		_tuple = methodReceiver(op, $clone(v, Value), ((v.flag >> 0)) >> 10 >> 0);
		fn[0] = _tuple[2];
		rcvr[0] = $clone(v, Value).object();
		if (isWrapped(v.typ)) {
			rcvr[0] = new (jsType(v.typ))(rcvr[0]);
		}
		fv = js.MakeFunc((function(fn, rcvr) { return function(this$1, arguments$1) {
			var arguments$1, this$1;
			return new $jsObjectPtr(fn[0].apply(rcvr[0], $externalize(arguments$1, sliceType$8)));
		}; })(fn, rcvr));
		_r = $clone(v, Value).Type().common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r, (fv), (((v.flag & 96) >>> 0) | 19) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeMethodValue }; } $f._r = _r; $f._tuple = _tuple; $f.fn = fn; $f.fv = fv; $f.op = op; $f.rcvr = rcvr; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.ptr.prototype.pointers = function() {
		var _1, t;
		t = this;
		_1 = t.Kind();
		if ((_1 === (22)) || (_1 === (21)) || (_1 === (18)) || (_1 === (19)) || (_1 === (25)) || (_1 === (17))) {
			return true;
		} else {
			return false;
		}
	};
	rtype.prototype.pointers = function() { return this.$val.pointers(); };
	rtype.ptr.prototype.Comparable = function() {
		var _1, _r, _r$1, i, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; i = $f.i; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
			_1 = t.Kind();
			/* */ if ((_1 === (19)) || (_1 === (23)) || (_1 === (21))) { $s = 2; continue; }
			/* */ if (_1 === (17)) { $s = 3; continue; }
			/* */ if (_1 === (25)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if ((_1 === (19)) || (_1 === (23)) || (_1 === (21))) { */ case 2:
				$s = -1; return false;
			/* } else if (_1 === (17)) { */ case 3:
				_r = t.Elem().Comparable(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
			/* } else if (_1 === (25)) { */ case 4:
				i = 0;
				/* while (true) { */ case 7:
					/* if (!(i < t.NumField())) { break; } */ if(!(i < t.NumField())) { $s = 8; continue; }
					_r$1 = t.Field(i).Type.Comparable(); /* */ $s = 11; case 11: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					/* */ if (!_r$1) { $s = 9; continue; }
					/* */ $s = 10; continue;
					/* if (!_r$1) { */ case 9:
						$s = -1; return false;
					/* } */ case 10:
					i = i + (1) >> 0;
				/* } */ $s = 7; continue; case 8:
			/* } */ case 5:
		case 1:
		$s = -1; return true;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Comparable }; } $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f.i = i; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Comparable = function() { return this.$val.Comparable(); };
	rtype.ptr.prototype.Method = function(i) {
		var _i, _i$1, _r, _r$1, _ref, _ref$1, arg, fl, fn, ft, i, in$1, m, methods, mt, mtyp, out, p, pname, prop, ret, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _ref$1 = $f._ref$1; arg = $f.arg; fl = $f.fl; fn = $f.fn; ft = $f.ft; i = $f.i; in$1 = $f.in$1; m = $f.m; methods = $f.methods; mt = $f.mt; mtyp = $f.mtyp; out = $f.out; p = $f.p; pname = $f.pname; prop = $f.prop; ret = $f.ret; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		prop = [prop];
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		t = this;
		if (t.Kind() === 20) {
			tt = (t.kindType);
			Method.copy(m, tt.Method(i));
			$s = -1; return m;
		}
		_r = t.exportedMethods(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		methods = _r;
		if (i < 0 || i >= methods.$length) {
			$panic(new $String("reflect: Method index out of range"));
		}
		p = $clone(((i < 0 || i >= methods.$length) ? ($throwRuntimeError("index out of range"), undefined) : methods.$array[methods.$offset + i]), method);
		pname = $clone(t.nameOff(p.name), name);
		m.Name = $clone(pname, name).name();
		fl = 19;
		mtyp = t.typeOff(p.mtyp);
		ft = (mtyp.kindType);
		in$1 = $makeSlice(sliceType$10, 0, (1 + ft.in$().$length >> 0));
		in$1 = $append(in$1, t);
		_ref = ft.in$();
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			arg = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			in$1 = $append(in$1, arg);
			_i++;
		}
		out = $makeSlice(sliceType$10, 0, ft.out().$length);
		_ref$1 = ft.out();
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			ret = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref$1.$array[_ref$1.$offset + _i$1]);
			out = $append(out, ret);
			_i$1++;
		}
		_r$1 = FuncOf(in$1, out, ft.rtype.IsVariadic()); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		mt = _r$1;
		m.Type = mt;
		prop[0] = $internalize($methodSet(t.jsType)[i].prop, $String);
		fn = js.MakeFunc((function(prop) { return function(this$1, arguments$1) {
			var arguments$1, rcvr, this$1;
			rcvr = (0 >= arguments$1.$length ? ($throwRuntimeError("index out of range"), undefined) : arguments$1.$array[arguments$1.$offset + 0]);
			return new $jsObjectPtr(rcvr[$externalize(prop[0], $String)].apply(rcvr, $externalize($subslice(arguments$1, 1), sliceType$8)));
		}; })(prop));
		m.Func = new Value.ptr($assertType(mt, ptrType$1), (fn), fl);
		m.Index = i;
		Method.copy(m, m);
		$s = -1; return m;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Method }; } $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._ref$1 = _ref$1; $f.arg = arg; $f.fl = fl; $f.fn = fn; $f.ft = ft; $f.i = i; $f.in$1 = in$1; $f.m = m; $f.methods = methods; $f.mt = mt; $f.mtyp = mtyp; $f.out = out; $f.p = p; $f.pname = pname; $f.prop = prop; $f.ret = ret; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Method = function(i) { return this.$val.Method(i); };
	Value.ptr.prototype.object = function() {
		var _1, newVal, v, val;
		v = this;
		if ((v.typ.Kind() === 17) || (v.typ.Kind() === 25)) {
			return v.ptr;
		}
		if (!((((v.flag & 128) >>> 0) === 0))) {
			val = v.ptr.$get();
			if (!(val === $ifaceNil) && !(val.constructor === jsType(v.typ))) {
				switch (0) { default:
					_1 = v.typ.Kind();
					if ((_1 === (11)) || (_1 === (6))) {
						val = new (jsType(v.typ))(val.$high, val.$low);
					} else if ((_1 === (15)) || (_1 === (16))) {
						val = new (jsType(v.typ))(val.$real, val.$imag);
					} else if (_1 === (23)) {
						if (val === val.constructor.nil) {
							val = jsType(v.typ).nil;
							break;
						}
						newVal = new (jsType(v.typ))(val.$array);
						newVal.$offset = val.$offset;
						newVal.$length = val.$length;
						newVal.$capacity = val.$capacity;
						val = newVal;
					}
				}
			}
			return val;
		}
		return v.ptr;
	};
	Value.prototype.object = function() { return this.$val.object(); };
	Value.ptr.prototype.call = function(op, in$1) {
		var _1, _arg, _arg$1, _arg$2, _arg$3, _i, _i$1, _i$2, _r, _r$1, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _ref, _ref$1, _ref$2, _tmp, _tmp$1, _tuple, arg, argsArray, elem, fn, i, i$1, i$2, i$3, in$1, isSlice, m, n, nin, nout, op, origIn, rcvr, results, ret, slice, t, targ, v, x, x$1, x$2, xt, xt$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _arg$3 = $f._arg$3; _i = $f._i; _i$1 = $f._i$1; _i$2 = $f._i$2; _r = $f._r; _r$1 = $f._r$1; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _ref = $f._ref; _ref$1 = $f._ref$1; _ref$2 = $f._ref$2; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; arg = $f.arg; argsArray = $f.argsArray; elem = $f.elem; fn = $f.fn; i = $f.i; i$1 = $f.i$1; i$2 = $f.i$2; i$3 = $f.i$3; in$1 = $f.in$1; isSlice = $f.isSlice; m = $f.m; n = $f.n; nin = $f.nin; nout = $f.nout; op = $f.op; origIn = $f.origIn; rcvr = $f.rcvr; results = $f.results; ret = $f.ret; slice = $f.slice; t = $f.t; targ = $f.targ; v = $f.v; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; xt = $f.xt; xt$1 = $f.xt$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		t = ptrType$1.nil;
		fn = 0;
		rcvr = null;
		if (!((((v.flag & 512) >>> 0) === 0))) {
			_tuple = methodReceiver(op, $clone(v, Value), ((v.flag >> 0)) >> 10 >> 0);
			t = _tuple[1];
			fn = _tuple[2];
			rcvr = $clone(v, Value).object();
			if (isWrapped(v.typ)) {
				rcvr = new (jsType(v.typ))(rcvr);
			}
		} else {
			t = v.typ;
			fn = ($clone(v, Value).object());
			rcvr = undefined;
		}
		if (fn === 0) {
			$panic(new $String("reflect.Value.Call: call of nil function"));
		}
		isSlice = op === "CallSlice";
		n = t.NumIn();
		if (isSlice) {
			if (!t.IsVariadic()) {
				$panic(new $String("reflect: CallSlice of non-variadic function"));
			}
			if (in$1.$length < n) {
				$panic(new $String("reflect: CallSlice with too few input arguments"));
			}
			if (in$1.$length > n) {
				$panic(new $String("reflect: CallSlice with too many input arguments"));
			}
		} else {
			if (t.IsVariadic()) {
				n = n - (1) >> 0;
			}
			if (in$1.$length < n) {
				$panic(new $String("reflect: Call with too few input arguments"));
			}
			if (!t.IsVariadic() && in$1.$length > n) {
				$panic(new $String("reflect: Call with too many input arguments"));
			}
		}
		_ref = in$1;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			x = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			if ($clone(x, Value).Kind() === 0) {
				$panic(new $String("reflect: " + op + " using zero Value argument"));
			}
			_i++;
		}
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < n)) { break; } */ if(!(i < n)) { $s = 2; continue; }
			_tmp = $clone(((i < 0 || i >= in$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : in$1.$array[in$1.$offset + i]), Value).Type();
			_tmp$1 = t.In(i);
			xt = _tmp;
			targ = _tmp$1;
			_r = xt.AssignableTo(targ); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (!_r) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!_r) { */ case 3:
				_r$1 = xt.String(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$2 = targ.String(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				$panic(new $String("reflect: " + op + " using " + _r$1 + " as type " + _r$2));
			/* } */ case 4:
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		/* */ if (!isSlice && t.IsVariadic()) { $s = 8; continue; }
		/* */ $s = 9; continue;
		/* if (!isSlice && t.IsVariadic()) { */ case 8:
			m = in$1.$length - n >> 0;
			_r$3 = MakeSlice(t.In(n), m, m); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			slice = _r$3;
			_r$4 = t.In(n).Elem(); /* */ $s = 11; case 11: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			elem = _r$4;
			i$1 = 0;
			/* while (true) { */ case 12:
				/* if (!(i$1 < m)) { break; } */ if(!(i$1 < m)) { $s = 13; continue; }
				x$2 = (x$1 = n + i$1 >> 0, ((x$1 < 0 || x$1 >= in$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : in$1.$array[in$1.$offset + x$1]));
				xt$1 = $clone(x$2, Value).Type();
				_r$5 = xt$1.AssignableTo(elem); /* */ $s = 16; case 16: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
				/* */ if (!_r$5) { $s = 14; continue; }
				/* */ $s = 15; continue;
				/* if (!_r$5) { */ case 14:
					_r$6 = xt$1.String(); /* */ $s = 17; case 17: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					_r$7 = elem.String(); /* */ $s = 18; case 18: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
					$panic(new $String("reflect: cannot use " + _r$6 + " as type " + _r$7 + " in " + op));
				/* } */ case 15:
				_r$8 = $clone(slice, Value).Index(i$1); /* */ $s = 19; case 19: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
				$r = $clone(_r$8, Value).Set($clone(x$2, Value)); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				i$1 = i$1 + (1) >> 0;
			/* } */ $s = 12; continue; case 13:
			origIn = in$1;
			in$1 = $makeSlice(sliceType$9, (n + 1 >> 0));
			$copySlice($subslice(in$1, 0, n), origIn);
			((n < 0 || n >= in$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : in$1.$array[in$1.$offset + n] = slice);
		/* } */ case 9:
		nin = in$1.$length;
		if (!((nin === t.NumIn()))) {
			$panic(new $String("reflect.Value.Call: wrong argument count"));
		}
		nout = t.NumOut();
		argsArray = new ($global.Array)(t.NumIn());
		_ref$1 = in$1;
		_i$1 = 0;
		/* while (true) { */ case 21:
			/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 22; continue; }
			i$2 = _i$1;
			arg = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref$1.$array[_ref$1.$offset + _i$1]);
			_arg = t.In(i$2);
			_r$9 = t.In(i$2).common(); /* */ $s = 23; case 23: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
			_arg$1 = _r$9;
			_arg$2 = 0;
			_r$10 = $clone(arg, Value).assignTo("reflect.Value.Call", _arg$1, _arg$2); /* */ $s = 24; case 24: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
			_r$11 = $clone(_r$10, Value).object(); /* */ $s = 25; case 25: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
			_arg$3 = _r$11;
			_r$12 = unwrapJsObject(_arg, _arg$3); /* */ $s = 26; case 26: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
			argsArray[i$2] = _r$12;
			_i$1++;
		/* } */ $s = 21; continue; case 22:
		_r$13 = callHelper(new sliceType$3([new $jsObjectPtr(fn), new $jsObjectPtr(rcvr), new $jsObjectPtr(argsArray)])); /* */ $s = 27; case 27: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
		results = _r$13;
			_1 = nout;
			/* */ if (_1 === (0)) { $s = 29; continue; }
			/* */ if (_1 === (1)) { $s = 30; continue; }
			/* */ $s = 31; continue;
			/* if (_1 === (0)) { */ case 29:
				$s = -1; return sliceType$9.nil;
			/* } else if (_1 === (1)) { */ case 30:
				_r$14 = makeValue(t.Out(0), wrapJsObject(t.Out(0), results), 0); /* */ $s = 33; case 33: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
				$s = -1; return new sliceType$9([$clone(_r$14, Value)]);
			/* } else { */ case 31:
				ret = $makeSlice(sliceType$9, nout);
				_ref$2 = ret;
				_i$2 = 0;
				/* while (true) { */ case 34:
					/* if (!(_i$2 < _ref$2.$length)) { break; } */ if(!(_i$2 < _ref$2.$length)) { $s = 35; continue; }
					i$3 = _i$2;
					_r$15 = makeValue(t.Out(i$3), wrapJsObject(t.Out(i$3), results[i$3]), 0); /* */ $s = 36; case 36: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
					((i$3 < 0 || i$3 >= ret.$length) ? ($throwRuntimeError("index out of range"), undefined) : ret.$array[ret.$offset + i$3] = _r$15);
					_i$2++;
				/* } */ $s = 34; continue; case 35:
				$s = -1; return ret;
			/* } */ case 32:
		case 28:
		$s = -1; return sliceType$9.nil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.call }; } $f._1 = _1; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._arg$3 = _arg$3; $f._i = _i; $f._i$1 = _i$1; $f._i$2 = _i$2; $f._r = _r; $f._r$1 = _r$1; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._ref = _ref; $f._ref$1 = _ref$1; $f._ref$2 = _ref$2; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.arg = arg; $f.argsArray = argsArray; $f.elem = elem; $f.fn = fn; $f.i = i; $f.i$1 = i$1; $f.i$2 = i$2; $f.i$3 = i$3; $f.in$1 = in$1; $f.isSlice = isSlice; $f.m = m; $f.n = n; $f.nin = nin; $f.nout = nout; $f.op = op; $f.origIn = origIn; $f.rcvr = rcvr; $f.results = results; $f.ret = ret; $f.slice = slice; $f.t = t; $f.targ = targ; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.xt = xt; $f.xt$1 = xt$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.call = function(op, in$1) { return this.$val.call(op, in$1); };
	Value.ptr.prototype.Cap = function() {
		var _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (17)) {
			return v.typ.Len();
		} else if ((_1 === (18)) || (_1 === (23))) {
			return $parseInt($clone(v, Value).object().$capacity) >> 0;
		}
		$panic(new ValueError.ptr("reflect.Value.Cap", k));
	};
	Value.prototype.Cap = function() { return this.$val.Cap(); };
	wrapJsObject = function(typ, val) {
		var typ, val;
		if ($interfaceIsEqual(typ, jsObjectPtr)) {
			return new (jsType(jsObjectPtr))(val);
		}
		return val;
	};
	unwrapJsObject = function(typ, val) {
		var typ, val;
		if ($interfaceIsEqual(typ, jsObjectPtr)) {
			return val.object;
		}
		return val;
	};
	Value.ptr.prototype.Elem = function() {
		var _1, _r, fl, k, tt, typ, v, val, val$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r = $f._r; fl = $f.fl; k = $f.k; tt = $f.tt; typ = $f.typ; v = $f.v; val = $f.val; val$1 = $f.val$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
			k = new flag(v.flag).kind();
			_1 = k;
			/* */ if (_1 === (20)) { $s = 2; continue; }
			/* */ if (_1 === (22)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_1 === (20)) { */ case 2:
				val = $clone(v, Value).object();
				if (val === $ifaceNil) {
					$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
				}
				typ = reflectType(val.constructor);
				_r = makeValue(typ, val.$val, (v.flag & 96) >>> 0); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
			/* } else if (_1 === (22)) { */ case 3:
				if ($clone(v, Value).IsNil()) {
					$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
				}
				val$1 = $clone(v, Value).object();
				tt = (v.typ.kindType);
				fl = (((((v.flag & 96) >>> 0) | 128) >>> 0) | 256) >>> 0;
				fl = (fl | (((tt.elem.Kind() >>> 0)))) >>> 0;
				$s = -1; return new Value.ptr(tt.elem, (wrapJsObject(tt.elem, val$1)), fl);
			/* } else { */ case 4:
				$panic(new ValueError.ptr("reflect.Value.Elem", k));
			/* } */ case 5:
		case 1:
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Elem }; } $f._1 = _1; $f._r = _r; $f.fl = fl; $f.k = k; $f.tt = tt; $f.typ = typ; $f.v = v; $f.val = val; $f.val$1 = val$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Elem = function() { return this.$val.Elem(); };
	Value.ptr.prototype.Field = function(i) {
		var _r, _r$1, _r$2, field, fl, i, jsTag, o, prop, s, tag, tt, typ, v, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; field = $f.field; fl = $f.fl; i = $f.i; jsTag = $f.jsTag; o = $f.o; prop = $f.prop; s = $f.s; tag = $f.tag; tt = $f.tt; typ = $f.typ; v = $f.v; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		jsTag = [jsTag];
		prop = [prop];
		s = [s];
		typ = [typ];
		v = this;
		if (!((new flag(v.flag).kind() === 25))) {
			$panic(new ValueError.ptr("reflect.Value.Field", new flag(v.flag).kind()));
		}
		tt = (v.typ.kindType);
		if (((i >>> 0)) >= ((tt.fields.$length >>> 0))) {
			$panic(new $String("reflect: Field index out of range"));
		}
		prop[0] = $internalize(jsType(v.typ).fields[i].prop, $String);
		field = (x = tt.fields, ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]));
		typ[0] = field.typ;
		fl = (((v.flag & 416) >>> 0) | ((typ[0].Kind() >>> 0))) >>> 0;
		if (!$clone(field.name, name).isExported()) {
			if (field.anon()) {
				fl = (fl | (64)) >>> 0;
			} else {
				fl = (fl | (32)) >>> 0;
			}
		}
		tag = $clone((x$1 = tt.fields, ((i < 0 || i >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + i])).name, name).tag();
		/* */ if (!(tag === "") && !((i === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(tag === "") && !((i === 0))) { */ case 1:
			jsTag[0] = getJsTag(tag);
			/* */ if (!(jsTag[0] === "")) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(jsTag[0] === "")) { */ case 3:
				/* while (true) { */ case 5:
					o = [o];
					_r = $clone(v, Value).Field(0); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					v = _r;
					/* */ if (v.typ === jsObjectPtr) { $s = 8; continue; }
					/* */ $s = 9; continue;
					/* if (v.typ === jsObjectPtr) { */ case 8:
						o[0] = $clone(v, Value).object().object;
						$s = -1; return new Value.ptr(typ[0], (new (jsType(PtrTo(typ[0])))((function(jsTag, o, prop, s, typ) { return function() {
							return $internalize(o[0][$externalize(jsTag[0], $String)], jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ), (function(jsTag, o, prop, s, typ) { return function(x$2) {
							var x$2;
							o[0][$externalize(jsTag[0], $String)] = $externalize(x$2, jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ))), fl);
					/* } */ case 9:
					/* */ if (v.typ.Kind() === 22) { $s = 10; continue; }
					/* */ $s = 11; continue;
					/* if (v.typ.Kind() === 22) { */ case 10:
						_r$1 = $clone(v, Value).Elem(); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						v = _r$1;
					/* } */ case 11:
				/* } */ $s = 5; continue; case 6:
			/* } */ case 4:
		/* } */ case 2:
		s[0] = v.ptr;
		/* */ if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { $s = 13; continue; }
		/* */ $s = 14; continue;
		/* if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { */ case 13:
			$s = -1; return new Value.ptr(typ[0], (new (jsType(PtrTo(typ[0])))((function(jsTag, prop, s, typ) { return function() {
				return wrapJsObject(typ[0], s[0][$externalize(prop[0], $String)]);
			}; })(jsTag, prop, s, typ), (function(jsTag, prop, s, typ) { return function(x$2) {
				var x$2;
				s[0][$externalize(prop[0], $String)] = unwrapJsObject(typ[0], x$2);
			}; })(jsTag, prop, s, typ))), fl);
		/* } */ case 14:
		_r$2 = makeValue(typ[0], wrapJsObject(typ[0], s[0][$externalize(prop[0], $String)]), fl); /* */ $s = 15; case 15: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Field }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.field = field; $f.fl = fl; $f.i = i; $f.jsTag = jsTag; $f.o = o; $f.prop = prop; $f.s = s; $f.tag = tag; $f.tt = tt; $f.typ = typ; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Field = function(i) { return this.$val.Field(i); };
	getJsTag = function(tag) {
		var _tuple, i, name$1, qvalue, tag, value;
		while (true) {
			if (!(!(tag === ""))) { break; }
			i = 0;
			while (true) {
				if (!(i < tag.length && (tag.charCodeAt(i) === 32))) { break; }
				i = i + (1) >> 0;
			}
			tag = $substring(tag, i);
			if (tag === "") {
				break;
			}
			i = 0;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 32)) && !((tag.charCodeAt(i) === 58)) && !((tag.charCodeAt(i) === 34)))) { break; }
				i = i + (1) >> 0;
			}
			if ((i + 1 >> 0) >= tag.length || !((tag.charCodeAt(i) === 58)) || !((tag.charCodeAt((i + 1 >> 0)) === 34))) {
				break;
			}
			name$1 = ($substring(tag, 0, i));
			tag = $substring(tag, (i + 1 >> 0));
			i = 1;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 34)))) { break; }
				if (tag.charCodeAt(i) === 92) {
					i = i + (1) >> 0;
				}
				i = i + (1) >> 0;
			}
			if (i >= tag.length) {
				break;
			}
			qvalue = ($substring(tag, 0, (i + 1 >> 0)));
			tag = $substring(tag, (i + 1 >> 0));
			if (name$1 === "js") {
				_tuple = strconv.Unquote(qvalue);
				value = _tuple[0];
				return value;
			}
		}
		return "";
	};
	Value.ptr.prototype.Index = function(i) {
		var _1, _r, _r$1, a, a$1, c, fl, fl$1, fl$2, i, k, s, str, tt, tt$1, typ, typ$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; a = $f.a; a$1 = $f.a$1; c = $f.c; fl = $f.fl; fl$1 = $f.fl$1; fl$2 = $f.fl$2; i = $f.i; k = $f.k; s = $f.s; str = $f.str; tt = $f.tt; tt$1 = $f.tt$1; typ = $f.typ; typ$1 = $f.typ$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		a = [a];
		a$1 = [a$1];
		c = [c];
		i = [i];
		typ = [typ];
		typ$1 = [typ$1];
		v = this;
			k = new flag(v.flag).kind();
			_1 = k;
			/* */ if (_1 === (17)) { $s = 2; continue; }
			/* */ if (_1 === (23)) { $s = 3; continue; }
			/* */ if (_1 === (24)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_1 === (17)) { */ case 2:
				tt = (v.typ.kindType);
				if (i[0] < 0 || i[0] > ((tt.len >> 0))) {
					$panic(new $String("reflect: array index out of range"));
				}
				typ[0] = tt.elem;
				fl = (v.flag & 480) >>> 0;
				fl = (fl | (((typ[0].Kind() >>> 0)))) >>> 0;
				a[0] = v.ptr;
				/* */ if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { */ case 7:
					$s = -1; return new Value.ptr(typ[0], (new (jsType(PtrTo(typ[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						return wrapJsObject(typ[0], a[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var x;
						a[0][i[0]] = unwrapJsObject(typ[0], x);
					}; })(a, a$1, c, i, typ, typ$1))), fl);
				/* } */ case 8:
				_r = makeValue(typ[0], wrapJsObject(typ[0], a[0][i[0]]), fl); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
			/* } else if (_1 === (23)) { */ case 3:
				s = $clone(v, Value).object();
				if (i[0] < 0 || i[0] >= ($parseInt(s.$length) >> 0)) {
					$panic(new $String("reflect: slice index out of range"));
				}
				tt$1 = (v.typ.kindType);
				typ$1[0] = tt$1.elem;
				fl$1 = (384 | ((v.flag & 96) >>> 0)) >>> 0;
				fl$1 = (fl$1 | (((typ$1[0].Kind() >>> 0)))) >>> 0;
				i[0] = i[0] + (($parseInt(s.$offset) >> 0)) >> 0;
				a$1[0] = s.$array;
				/* */ if (!((((fl$1 & 128) >>> 0) === 0)) && !((typ$1[0].Kind() === 17)) && !((typ$1[0].Kind() === 25))) { $s = 10; continue; }
				/* */ $s = 11; continue;
				/* if (!((((fl$1 & 128) >>> 0) === 0)) && !((typ$1[0].Kind() === 17)) && !((typ$1[0].Kind() === 25))) { */ case 10:
					$s = -1; return new Value.ptr(typ$1[0], (new (jsType(PtrTo(typ$1[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						return wrapJsObject(typ$1[0], a$1[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var x;
						a$1[0][i[0]] = unwrapJsObject(typ$1[0], x);
					}; })(a, a$1, c, i, typ, typ$1))), fl$1);
				/* } */ case 11:
				_r$1 = makeValue(typ$1[0], wrapJsObject(typ$1[0], a$1[0][i[0]]), fl$1); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				$s = -1; return _r$1;
			/* } else if (_1 === (24)) { */ case 4:
				str = (v.ptr).$get();
				if (i[0] < 0 || i[0] >= str.length) {
					$panic(new $String("reflect: string index out of range"));
				}
				fl$2 = (((v.flag & 96) >>> 0) | 8) >>> 0;
				c[0] = str.charCodeAt(i[0]);
				$s = -1; return new Value.ptr(uint8Type, ((c.$ptr || (c.$ptr = new ptrType$4(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, c)))), (fl$2 | 128) >>> 0);
			/* } else { */ case 5:
				$panic(new ValueError.ptr("reflect.Value.Index", k));
			/* } */ case 6:
		case 1:
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Index }; } $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f.a = a; $f.a$1 = a$1; $f.c = c; $f.fl = fl; $f.fl$1 = fl$1; $f.fl$2 = fl$2; $f.i = i; $f.k = k; $f.s = s; $f.str = str; $f.tt = tt; $f.tt$1 = tt$1; $f.typ = typ; $f.typ$1 = typ$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Index = function(i) { return this.$val.Index(i); };
	Value.ptr.prototype.InterfaceData = function() {
		var v;
		v = this;
		$panic(errors.New("InterfaceData is not supported by GopherJS"));
	};
	Value.prototype.InterfaceData = function() { return this.$val.InterfaceData(); };
	Value.ptr.prototype.IsNil = function() {
		var _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (22)) || (_1 === (23))) {
			return $clone(v, Value).object() === jsType(v.typ).nil;
		} else if (_1 === (18)) {
			return $clone(v, Value).object() === $chanNil;
		} else if (_1 === (19)) {
			return $clone(v, Value).object() === $throwNilPointerError;
		} else if (_1 === (21)) {
			return $clone(v, Value).object() === false;
		} else if (_1 === (20)) {
			return $clone(v, Value).object() === $ifaceNil;
		} else {
			$panic(new ValueError.ptr("reflect.Value.IsNil", k));
		}
	};
	Value.prototype.IsNil = function() { return this.$val.IsNil(); };
	Value.ptr.prototype.Len = function() {
		var _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (17)) || (_1 === (24))) {
			return $parseInt($clone(v, Value).object().length);
		} else if (_1 === (23)) {
			return $parseInt($clone(v, Value).object().$length) >> 0;
		} else if (_1 === (18)) {
			return $parseInt($clone(v, Value).object().$buffer.length) >> 0;
		} else if (_1 === (21)) {
			return $parseInt($keys($clone(v, Value).object()).length);
		} else {
			$panic(new ValueError.ptr("reflect.Value.Len", k));
		}
	};
	Value.prototype.Len = function() { return this.$val.Len(); };
	Value.ptr.prototype.Pointer = function() {
		var _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (18)) || (_1 === (21)) || (_1 === (22)) || (_1 === (26))) {
			if ($clone(v, Value).IsNil()) {
				return 0;
			}
			return $clone(v, Value).object();
		} else if (_1 === (19)) {
			if ($clone(v, Value).IsNil()) {
				return 0;
			}
			return 1;
		} else if (_1 === (23)) {
			if ($clone(v, Value).IsNil()) {
				return 0;
			}
			return $clone(v, Value).object().$array;
		} else {
			$panic(new ValueError.ptr("reflect.Value.Pointer", k));
		}
	};
	Value.prototype.Pointer = function() { return this.$val.Pointer(); };
	Value.ptr.prototype.Set = function(x) {
		var _1, _r, _r$1, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(x.flag).mustBeExported();
		_r = $clone(x, Value).assignTo("reflect.Set", v.typ, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		x = _r;
		/* */ if (!((((v.flag & 128) >>> 0) === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((((v.flag & 128) >>> 0) === 0))) { */ case 2:
				_1 = v.typ.Kind();
				/* */ if (_1 === (17)) { $s = 5; continue; }
				/* */ if (_1 === (20)) { $s = 6; continue; }
				/* */ if (_1 === (25)) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (_1 === (17)) { */ case 5:
					jsType(v.typ).copy(v.ptr, x.ptr);
					$s = 9; continue;
				/* } else if (_1 === (20)) { */ case 6:
					_r$1 = valueInterface($clone(x, Value), false); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					v.ptr.$set(_r$1);
					$s = 9; continue;
				/* } else if (_1 === (25)) { */ case 7:
					copyStruct(v.ptr, x.ptr, v.typ);
					$s = 9; continue;
				/* } else { */ case 8:
					v.ptr.$set($clone(x, Value).object());
				/* } */ case 9:
			case 4:
			$s = -1; return;
		/* } */ case 3:
		v.ptr = x.ptr;
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Set }; } $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Set = function(x) { return this.$val.Set(x); };
	Value.ptr.prototype.SetBytes = function(x) {
		var _r, _r$1, _v, slice, typedSlice, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _v = $f._v; slice = $f.slice; typedSlice = $f.typedSlice; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 8))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 8))) { */ case 1:
			$panic(new $String("reflect.Value.SetBytes of non-byte slice"));
		/* } */ case 2:
		slice = x;
		if (!(v.typ.Name() === "")) { _v = true; $s = 6; continue s; }
		_r$1 = v.typ.Elem().Name(); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_v = !(_r$1 === ""); case 6:
		/* */ if (_v) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (_v) { */ case 4:
			typedSlice = new (jsType(v.typ))(slice.$array);
			typedSlice.$offset = slice.$offset;
			typedSlice.$length = slice.$length;
			typedSlice.$capacity = slice.$capacity;
			slice = typedSlice;
		/* } */ case 5:
		v.ptr.$set(slice);
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.SetBytes }; } $f._r = _r; $f._r$1 = _r$1; $f._v = _v; $f.slice = slice; $f.typedSlice = typedSlice; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.SetBytes = function(x) { return this.$val.SetBytes(x); };
	Value.ptr.prototype.SetCap = function(n) {
		var n, newSlice, s, v;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		s = v.ptr.$get();
		if (n < ($parseInt(s.$length) >> 0) || n > ($parseInt(s.$capacity) >> 0)) {
			$panic(new $String("reflect: slice capacity out of range in SetCap"));
		}
		newSlice = new (jsType(v.typ))(s.$array);
		newSlice.$offset = s.$offset;
		newSlice.$length = s.$length;
		newSlice.$capacity = n;
		v.ptr.$set(newSlice);
	};
	Value.prototype.SetCap = function(n) { return this.$val.SetCap(n); };
	Value.ptr.prototype.SetLen = function(n) {
		var n, newSlice, s, v;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		s = v.ptr.$get();
		if (n < 0 || n > ($parseInt(s.$capacity) >> 0)) {
			$panic(new $String("reflect: slice length out of range in SetLen"));
		}
		newSlice = new (jsType(v.typ))(s.$array);
		newSlice.$offset = s.$offset;
		newSlice.$length = n;
		newSlice.$capacity = s.$capacity;
		v.ptr.$set(newSlice);
	};
	Value.prototype.SetLen = function(n) { return this.$val.SetLen(n); };
	Value.ptr.prototype.Slice = function(i, j) {
		var _1, _r, _r$1, cap, i, j, kind, s, str, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; cap = $f.cap; i = $f.i; j = $f.j; kind = $f.kind; s = $f.s; str = $f.str; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		cap = 0;
		typ = $ifaceNil;
		s = null;
			kind = new flag(v.flag).kind();
			_1 = kind;
			/* */ if (_1 === (17)) { $s = 2; continue; }
			/* */ if (_1 === (23)) { $s = 3; continue; }
			/* */ if (_1 === (24)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_1 === (17)) { */ case 2:
				if (((v.flag & 256) >>> 0) === 0) {
					$panic(new $String("reflect.Value.Slice: slice of unaddressable array"));
				}
				tt = (v.typ.kindType);
				cap = ((tt.len >> 0));
				typ = SliceOf(tt.elem);
				s = new (jsType(typ))($clone(v, Value).object());
				$s = 6; continue;
			/* } else if (_1 === (23)) { */ case 3:
				typ = v.typ;
				s = $clone(v, Value).object();
				cap = $parseInt(s.$capacity) >> 0;
				$s = 6; continue;
			/* } else if (_1 === (24)) { */ case 4:
				str = (v.ptr).$get();
				if (i < 0 || j < i || j > str.length) {
					$panic(new $String("reflect.Value.Slice: string slice index out of bounds"));
				}
				_r = ValueOf(new $String($substring(str, i, j))); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
			/* } else { */ case 5:
				$panic(new ValueError.ptr("reflect.Value.Slice", kind));
			/* } */ case 6:
		case 1:
		if (i < 0 || j < i || j > cap) {
			$panic(new $String("reflect.Value.Slice: slice index out of bounds"));
		}
		_r$1 = makeValue(typ, $subslice(s, i, j), (v.flag & 96) >>> 0); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Slice }; } $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f.cap = cap; $f.i = i; $f.j = j; $f.kind = kind; $f.s = s; $f.str = str; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Slice = function(i, j) { return this.$val.Slice(i, j); };
	Value.ptr.prototype.Slice3 = function(i, j, k) {
		var _1, _r, cap, i, j, k, kind, s, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r = $f._r; cap = $f.cap; i = $f.i; j = $f.j; k = $f.k; kind = $f.kind; s = $f.s; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		cap = 0;
		typ = $ifaceNil;
		s = null;
		kind = new flag(v.flag).kind();
		_1 = kind;
		if (_1 === (17)) {
			if (((v.flag & 256) >>> 0) === 0) {
				$panic(new $String("reflect.Value.Slice: slice of unaddressable array"));
			}
			tt = (v.typ.kindType);
			cap = ((tt.len >> 0));
			typ = SliceOf(tt.elem);
			s = new (jsType(typ))($clone(v, Value).object());
		} else if (_1 === (23)) {
			typ = v.typ;
			s = $clone(v, Value).object();
			cap = $parseInt(s.$capacity) >> 0;
		} else {
			$panic(new ValueError.ptr("reflect.Value.Slice3", kind));
		}
		if (i < 0 || j < i || k < j || k > cap) {
			$panic(new $String("reflect.Value.Slice3: slice index out of bounds"));
		}
		_r = makeValue(typ, $subslice(s, i, j, k), (v.flag & 96) >>> 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Slice3 }; } $f._1 = _1; $f._r = _r; $f.cap = cap; $f.i = i; $f.j = j; $f.k = k; $f.kind = kind; $f.s = s; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Slice3 = function(i, j, k) { return this.$val.Slice3(i, j, k); };
	Value.ptr.prototype.Close = function() {
		var v;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		$close($clone(v, Value).object());
	};
	Value.prototype.Close = function() { return this.$val.Close(); };
	chanrecv = function(ch, nb, val) {
		var _r, _tmp, _tmp$1, _tmp$2, _tmp$3, ch, comms, nb, received, recvRes, selectRes, selected, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; ch = $f.ch; comms = $f.comms; nb = $f.nb; received = $f.received; recvRes = $f.recvRes; selectRes = $f.selectRes; selected = $f.selected; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		selected = false;
		received = false;
		comms = new sliceType$11([new sliceType$8([ch])]);
		if (nb) {
			comms = $append(comms, new sliceType$8([]));
		}
		_r = selectHelper(new sliceType$3([comms])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		selectRes = _r;
		if (nb && (($parseInt(selectRes[0]) >> 0) === 1)) {
			_tmp = false;
			_tmp$1 = false;
			selected = _tmp;
			received = _tmp$1;
			$s = -1; return [selected, received];
		}
		recvRes = selectRes[1];
		val.$set(recvRes[0]);
		_tmp$2 = true;
		_tmp$3 = !!(recvRes[1]);
		selected = _tmp$2;
		received = _tmp$3;
		$s = -1; return [selected, received];
		/* */ } return; } if ($f === undefined) { $f = { $blk: chanrecv }; } $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.ch = ch; $f.comms = comms; $f.nb = nb; $f.received = received; $f.recvRes = recvRes; $f.selectRes = selectRes; $f.selected = selected; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	chansend = function(ch, val, nb) {
		var _r, ch, comms, nb, selectRes, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; ch = $f.ch; comms = $f.comms; nb = $f.nb; selectRes = $f.selectRes; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		comms = new sliceType$11([new sliceType$8([ch, val.$get()])]);
		if (nb) {
			comms = $append(comms, new sliceType$8([]));
		}
		_r = selectHelper(new sliceType$3([comms])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		selectRes = _r;
		if (nb && (($parseInt(selectRes[0]) >> 0) === 1)) {
			$s = -1; return false;
		}
		$s = -1; return true;
		/* */ } return; } if ($f === undefined) { $f = { $blk: chansend }; } $f._r = _r; $f.ch = ch; $f.comms = comms; $f.nb = nb; $f.selectRes = selectRes; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	structField.ptr.prototype.offset = function() {
		var f;
		f = this;
		return f.offsetAnon >>> 1 >>> 0;
	};
	structField.prototype.offset = function() { return this.$val.offset(); };
	structField.ptr.prototype.anon = function() {
		var f;
		f = this;
		return !((((f.offsetAnon & 1) >>> 0) === 0));
	};
	structField.prototype.anon = function() { return this.$val.anon(); };
	Kind.prototype.String = function() {
		var k;
		k = this.$val;
		if (((k >> 0)) < kindNames.$length) {
			return ((k < 0 || k >= kindNames.$length) ? ($throwRuntimeError("index out of range"), undefined) : kindNames.$array[kindNames.$offset + k]);
		}
		return "kind" + strconv.Itoa(((k >> 0)));
	};
	$ptrType(Kind).prototype.String = function() { return new Kind(this.$get()).String(); };
	rtype.ptr.prototype.String = function() {
		var s, t;
		t = this;
		s = $clone(t.nameOff(t.str), name).name();
		if (!((((t.tflag & 2) >>> 0) === 0))) {
			return $substring(s, 1);
		}
		return s;
	};
	rtype.prototype.String = function() { return this.$val.String(); };
	rtype.ptr.prototype.Size = function() {
		var t;
		t = this;
		return t.size;
	};
	rtype.prototype.Size = function() { return this.$val.Size(); };
	rtype.ptr.prototype.Bits = function() {
		var k, t;
		t = this;
		if (t === ptrType$1.nil) {
			$panic(new $String("reflect: Bits of nil Type"));
		}
		k = t.Kind();
		if (k < 2 || k > 16) {
			$panic(new $String("reflect: Bits of non-arithmetic Type " + t.String()));
		}
		return $imul(((t.size >> 0)), 8);
	};
	rtype.prototype.Bits = function() { return this.$val.Bits(); };
	rtype.ptr.prototype.Align = function() {
		var t;
		t = this;
		return ((t.align >> 0));
	};
	rtype.prototype.Align = function() { return this.$val.Align(); };
	rtype.ptr.prototype.FieldAlign = function() {
		var t;
		t = this;
		return ((t.fieldAlign >> 0));
	};
	rtype.prototype.FieldAlign = function() { return this.$val.FieldAlign(); };
	rtype.ptr.prototype.Kind = function() {
		var t;
		t = this;
		return ((((t.kind & 31) >>> 0) >>> 0));
	};
	rtype.prototype.Kind = function() { return this.$val.Kind(); };
	rtype.ptr.prototype.common = function() {
		var t;
		t = this;
		return t;
	};
	rtype.prototype.common = function() { return this.$val.common(); };
	rtype.ptr.prototype.exportedMethods = function() {
		var _i, _i$1, _r, _r$1, _ref, _ref$1, _tuple, _tuple$1, allExported, allm, found, m, m$1, methods, methodsi, name$1, name$2, t, ut, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _ref$1 = $f._ref$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; allExported = $f.allExported; allm = $f.allm; found = $f.found; m = $f.m; m$1 = $f.m$1; methods = $f.methods; methodsi = $f.methodsi; name$1 = $f.name$1; name$2 = $f.name$2; t = $f.t; ut = $f.ut; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = methodCache.Load(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		methodsi = _tuple[0];
		found = _tuple[1];
		if (found) {
			$s = -1; return $assertType(methodsi, sliceType$5);
		}
		ut = t.uncommon();
		if (ut === ptrType$5.nil) {
			$s = -1; return sliceType$5.nil;
		}
		allm = ut.methods();
		allExported = true;
		_ref = allm;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			m = $clone(((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]), method);
			name$1 = $clone(t.nameOff(m.name), name);
			if (!$clone(name$1, name).isExported()) {
				allExported = false;
				break;
			}
			_i++;
		}
		methods = sliceType$5.nil;
		if (allExported) {
			methods = allm;
		} else {
			methods = $makeSlice(sliceType$5, 0, allm.$length);
			_ref$1 = allm;
			_i$1 = 0;
			while (true) {
				if (!(_i$1 < _ref$1.$length)) { break; }
				m$1 = $clone(((_i$1 < 0 || _i$1 >= _ref$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref$1.$array[_ref$1.$offset + _i$1]), method);
				name$2 = $clone(t.nameOff(m$1.name), name);
				if ($clone(name$2, name).isExported()) {
					methods = $append(methods, m$1);
				}
				_i$1++;
			}
			methods = $subslice(methods, 0, methods.$length, methods.$length);
		}
		_r$1 = methodCache.LoadOrStore(t, methods); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		methodsi = _tuple$1[0];
		$s = -1; return $assertType(methodsi, sliceType$5);
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.exportedMethods }; } $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.allExported = allExported; $f.allm = allm; $f.found = found; $f.m = m; $f.m$1 = m$1; $f.methods = methods; $f.methodsi = methodsi; $f.name$1 = name$1; $f.name$2 = name$2; $f.t = t; $f.ut = ut; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.exportedMethods = function() { return this.$val.exportedMethods(); };
	rtype.ptr.prototype.NumMethod = function() {
		var _r, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (t.Kind() === 20) {
			tt = (t.kindType);
			$s = -1; return tt.NumMethod();
		}
		if (((t.tflag & 1) >>> 0) === 0) {
			$s = -1; return 0;
		}
		_r = t.exportedMethods(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r.$length;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.NumMethod }; } $f._r = _r; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	rtype.ptr.prototype.MethodByName = function(name$1) {
		var _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, i, m, name$1, ok, p, pname, t, tt, ut, utmethods, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; i = $f.i; m = $f.m; name$1 = $f.name$1; ok = $f.ok; p = $f.p; pname = $f.pname; t = $f.t; tt = $f.tt; ut = $f.ut; utmethods = $f.utmethods; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		ok = false;
		t = this;
		if (t.Kind() === 20) {
			tt = (t.kindType);
			_tuple = tt.MethodByName(name$1);
			Method.copy(m, _tuple[0]);
			ok = _tuple[1];
			$s = -1; return [m, ok];
		}
		ut = t.uncommon();
		if (ut === ptrType$5.nil) {
			_tmp = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
			_tmp$1 = false;
			Method.copy(m, _tmp);
			ok = _tmp$1;
			$s = -1; return [m, ok];
		}
		utmethods = ut.methods();
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < ((ut.mcount >> 0)))) { break; } */ if(!(i < ((ut.mcount >> 0)))) { $s = 2; continue; }
			p = $clone(((i < 0 || i >= utmethods.$length) ? ($throwRuntimeError("index out of range"), undefined) : utmethods.$array[utmethods.$offset + i]), method);
			pname = $clone(t.nameOff(p.name), name);
			/* */ if ($clone(pname, name).isExported() && $clone(pname, name).name() === name$1) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if ($clone(pname, name).isExported() && $clone(pname, name).name() === name$1) { */ case 3:
				_r = t.Method(i); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tmp$2 = $clone(_r, Method);
				_tmp$3 = true;
				Method.copy(m, _tmp$2);
				ok = _tmp$3;
				$s = -1; return [m, ok];
			/* } */ case 4:
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		_tmp$4 = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		_tmp$5 = false;
		Method.copy(m, _tmp$4);
		ok = _tmp$5;
		$s = -1; return [m, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.MethodByName }; } $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.i = i; $f.m = m; $f.name$1 = name$1; $f.ok = ok; $f.p = p; $f.pname = pname; $f.t = t; $f.tt = tt; $f.ut = ut; $f.utmethods = utmethods; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.MethodByName = function(name$1) { return this.$val.MethodByName(name$1); };
	rtype.ptr.prototype.PkgPath = function() {
		var t, ut;
		t = this;
		if (((t.tflag & 4) >>> 0) === 0) {
			return "";
		}
		ut = t.uncommon();
		if (ut === ptrType$5.nil) {
			return "";
		}
		return $clone(t.nameOff(ut.pkgPath), name).name();
	};
	rtype.prototype.PkgPath = function() { return this.$val.PkgPath(); };
	rtype.ptr.prototype.Name = function() {
		var i, s, t;
		t = this;
		if (((t.tflag & 4) >>> 0) === 0) {
			return "";
		}
		s = t.String();
		i = s.length - 1 >> 0;
		while (true) {
			if (!(i >= 0)) { break; }
			if (s.charCodeAt(i) === 46) {
				break;
			}
			i = i - (1) >> 0;
		}
		return $substring(s, (i + 1 >> 0));
	};
	rtype.prototype.Name = function() { return this.$val.Name(); };
	rtype.ptr.prototype.ChanDir = function() {
		var t, tt;
		t = this;
		if (!((t.Kind() === 18))) {
			$panic(new $String("reflect: ChanDir of non-chan type"));
		}
		tt = (t.kindType);
		return ((tt.dir >> 0));
	};
	rtype.prototype.ChanDir = function() { return this.$val.ChanDir(); };
	rtype.ptr.prototype.IsVariadic = function() {
		var t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: IsVariadic of non-func type"));
		}
		tt = (t.kindType);
		return !((((tt.outCount & 32768) >>> 0) === 0));
	};
	rtype.prototype.IsVariadic = function() { return this.$val.IsVariadic(); };
	rtype.ptr.prototype.Elem = function() {
		var _1, t, tt, tt$1, tt$2, tt$3, tt$4;
		t = this;
		_1 = t.Kind();
		if (_1 === (17)) {
			tt = (t.kindType);
			return toType(tt.elem);
		} else if (_1 === (18)) {
			tt$1 = (t.kindType);
			return toType(tt$1.elem);
		} else if (_1 === (21)) {
			tt$2 = (t.kindType);
			return toType(tt$2.elem);
		} else if (_1 === (22)) {
			tt$3 = (t.kindType);
			return toType(tt$3.elem);
		} else if (_1 === (23)) {
			tt$4 = (t.kindType);
			return toType(tt$4.elem);
		}
		$panic(new $String("reflect: Elem of invalid type"));
	};
	rtype.prototype.Elem = function() { return this.$val.Elem(); };
	rtype.ptr.prototype.Field = function(i) {
		var i, t, tt;
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: Field of non-struct type"));
		}
		tt = (t.kindType);
		return tt.Field(i);
	};
	rtype.prototype.Field = function(i) { return this.$val.Field(i); };
	rtype.ptr.prototype.FieldByIndex = function(index) {
		var _r, index, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; index = $f.index; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByIndex of non-struct type"));
		}
		tt = (t.kindType);
		_r = tt.FieldByIndex(index); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByIndex }; } $f._r = _r; $f.index = index; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	rtype.ptr.prototype.FieldByName = function(name$1) {
		var _r, name$1, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; name$1 = $f.name$1; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByName of non-struct type"));
		}
		tt = (t.kindType);
		_r = tt.FieldByName(name$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByName }; } $f._r = _r; $f.name$1 = name$1; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByName = function(name$1) { return this.$val.FieldByName(name$1); };
	rtype.ptr.prototype.FieldByNameFunc = function(match) {
		var _r, match, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; match = $f.match; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByNameFunc of non-struct type"));
		}
		tt = (t.kindType);
		_r = tt.FieldByNameFunc(match); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByNameFunc }; } $f._r = _r; $f.match = match; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	rtype.ptr.prototype.In = function(i) {
		var i, t, tt, x;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: In of non-func type"));
		}
		tt = (t.kindType);
		return toType((x = tt.in$(), ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i])));
	};
	rtype.prototype.In = function(i) { return this.$val.In(i); };
	rtype.ptr.prototype.Key = function() {
		var t, tt;
		t = this;
		if (!((t.Kind() === 21))) {
			$panic(new $String("reflect: Key of non-map type"));
		}
		tt = (t.kindType);
		return toType(tt.key);
	};
	rtype.prototype.Key = function() { return this.$val.Key(); };
	rtype.ptr.prototype.Len = function() {
		var t, tt;
		t = this;
		if (!((t.Kind() === 17))) {
			$panic(new $String("reflect: Len of non-array type"));
		}
		tt = (t.kindType);
		return ((tt.len >> 0));
	};
	rtype.prototype.Len = function() { return this.$val.Len(); };
	rtype.ptr.prototype.NumField = function() {
		var t, tt;
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: NumField of non-struct type"));
		}
		tt = (t.kindType);
		return tt.fields.$length;
	};
	rtype.prototype.NumField = function() { return this.$val.NumField(); };
	rtype.ptr.prototype.NumIn = function() {
		var t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: NumIn of non-func type"));
		}
		tt = (t.kindType);
		return ((tt.inCount >> 0));
	};
	rtype.prototype.NumIn = function() { return this.$val.NumIn(); };
	rtype.ptr.prototype.NumOut = function() {
		var t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: NumOut of non-func type"));
		}
		tt = (t.kindType);
		return tt.out().$length;
	};
	rtype.prototype.NumOut = function() { return this.$val.NumOut(); };
	rtype.ptr.prototype.Out = function(i) {
		var i, t, tt, x;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: Out of non-func type"));
		}
		tt = (t.kindType);
		return toType((x = tt.out(), ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i])));
	};
	rtype.prototype.Out = function(i) { return this.$val.Out(i); };
	ChanDir.prototype.String = function() {
		var _1, d;
		d = this.$val;
		_1 = d;
		if (_1 === (2)) {
			return "chan<-";
		} else if (_1 === (1)) {
			return "<-chan";
		} else if (_1 === (3)) {
			return "chan";
		}
		return "ChanDir" + strconv.Itoa(((d >> 0)));
	};
	$ptrType(ChanDir).prototype.String = function() { return new ChanDir(this.$get()).String(); };
	interfaceType.ptr.prototype.Method = function(i) {
		var i, m, p, pname, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		t = this;
		if (i < 0 || i >= t.methods.$length) {
			return m;
		}
		p = (x = t.methods, ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]));
		pname = $clone(t.rtype.nameOff(p.name), name);
		m.Name = $clone(pname, name).name();
		if (!$clone(pname, name).isExported()) {
			m.PkgPath = $clone(pname, name).pkgPath();
			if (m.PkgPath === "") {
				m.PkgPath = $clone(t.pkgPath, name).name();
			}
		}
		m.Type = toType(t.rtype.typeOff(p.typ));
		m.Index = i;
		return m;
	};
	interfaceType.prototype.Method = function(i) { return this.$val.Method(i); };
	interfaceType.ptr.prototype.NumMethod = function() {
		var t;
		t = this;
		return t.methods.$length;
	};
	interfaceType.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	interfaceType.ptr.prototype.MethodByName = function(name$1) {
		var _i, _ref, _tmp, _tmp$1, i, m, name$1, ok, p, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		ok = false;
		t = this;
		if (t === ptrType$7.nil) {
			return [m, ok];
		}
		p = ptrType$8.nil;
		_ref = t.methods;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = (x = t.methods, ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]));
			if ($clone(t.rtype.nameOff(p.name), name).name() === name$1) {
				_tmp = $clone(t.Method(i), Method);
				_tmp$1 = true;
				Method.copy(m, _tmp);
				ok = _tmp$1;
				return [m, ok];
			}
			_i++;
		}
		return [m, ok];
	};
	interfaceType.prototype.MethodByName = function(name$1) { return this.$val.MethodByName(name$1); };
	StructTag.prototype.Get = function(key) {
		var _tuple, key, tag, v;
		tag = this.$val;
		_tuple = new StructTag(tag).Lookup(key);
		v = _tuple[0];
		return v;
	};
	$ptrType(StructTag).prototype.Get = function(key) { return new StructTag(this.$get()).Get(key); };
	StructTag.prototype.Lookup = function(key) {
		var _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, err, i, key, name$1, ok, qvalue, tag, value, value$1;
		value = "";
		ok = false;
		tag = this.$val;
		while (true) {
			if (!(!(tag === ""))) { break; }
			i = 0;
			while (true) {
				if (!(i < tag.length && (tag.charCodeAt(i) === 32))) { break; }
				i = i + (1) >> 0;
			}
			tag = $substring(tag, i);
			if (tag === "") {
				break;
			}
			i = 0;
			while (true) {
				if (!(i < tag.length && tag.charCodeAt(i) > 32 && !((tag.charCodeAt(i) === 58)) && !((tag.charCodeAt(i) === 34)) && !((tag.charCodeAt(i) === 127)))) { break; }
				i = i + (1) >> 0;
			}
			if ((i === 0) || (i + 1 >> 0) >= tag.length || !((tag.charCodeAt(i) === 58)) || !((tag.charCodeAt((i + 1 >> 0)) === 34))) {
				break;
			}
			name$1 = ($substring(tag, 0, i));
			tag = $substring(tag, (i + 1 >> 0));
			i = 1;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 34)))) { break; }
				if (tag.charCodeAt(i) === 92) {
					i = i + (1) >> 0;
				}
				i = i + (1) >> 0;
			}
			if (i >= tag.length) {
				break;
			}
			qvalue = ($substring(tag, 0, (i + 1 >> 0)));
			tag = $substring(tag, (i + 1 >> 0));
			if (key === name$1) {
				_tuple = strconv.Unquote(qvalue);
				value$1 = _tuple[0];
				err = _tuple[1];
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					break;
				}
				_tmp = value$1;
				_tmp$1 = true;
				value = _tmp;
				ok = _tmp$1;
				return [value, ok];
			}
		}
		_tmp$2 = "";
		_tmp$3 = false;
		value = _tmp$2;
		ok = _tmp$3;
		return [value, ok];
	};
	$ptrType(StructTag).prototype.Lookup = function(key) { return new StructTag(this.$get()).Lookup(key); };
	structType.ptr.prototype.Field = function(i) {
		var f, i, p, t, tag, x;
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$13.nil, false);
		t = this;
		if (i < 0 || i >= t.fields.$length) {
			$panic(new $String("reflect: Field index out of bounds"));
		}
		p = (x = t.fields, ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]));
		f.Type = toType(p.typ);
		f.Name = $clone(p.name, name).name();
		f.Anonymous = p.anon();
		if (!$clone(p.name, name).isExported()) {
			f.PkgPath = $clone(p.name, name).pkgPath();
			if (f.PkgPath === "") {
				f.PkgPath = $clone(t.pkgPath, name).name();
			}
		}
		tag = $clone(p.name, name).tag();
		if (!(tag === "")) {
			f.Tag = (tag);
		}
		f.Offset = p.offset();
		f.Index = new sliceType$13([i]);
		return f;
	};
	structType.prototype.Field = function(i) { return this.$val.Field(i); };
	structType.ptr.prototype.FieldByIndex = function(index) {
		var _i, _r, _r$1, _r$2, _r$3, _r$4, _ref, _v, f, ft, i, index, t, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _ref = $f._ref; _v = $f._v; f = $f.f; ft = $f.ft; i = $f.i; index = $f.index; t = $f.t; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$13.nil, false);
		t = this;
		f.Type = toType(t.rtype);
		_ref = index;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			i = _i;
			x = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			/* */ if (i > 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (i > 0) { */ case 3:
				ft = f.Type;
				_r = ft.Kind(); /* */ $s = 8; case 8: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				if (!(_r === 22)) { _v = false; $s = 7; continue s; }
				_r$1 = ft.Elem(); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$2 = _r$1.Kind(); /* */ $s = 10; case 10: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v = _r$2 === 25; case 7:
				/* */ if (_v) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (_v) { */ case 5:
					_r$3 = ft.Elem(); /* */ $s = 11; case 11: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					ft = _r$3;
				/* } */ case 6:
				f.Type = ft;
			/* } */ case 4:
			_r$4 = f.Type.Field(x); /* */ $s = 12; case 12: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			StructField.copy(f, _r$4);
			_i++;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByIndex }; } $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._ref = _ref; $f._v = _v; $f.f = f; $f.ft = ft; $f.i = i; $f.index = index; $f.t = t; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	structType.ptr.prototype.FieldByNameFunc = function(match) {
		var _entry, _entry$1, _entry$2, _entry$3, _i, _i$1, _key, _key$1, _key$2, _key$3, _r, _r$1, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, count, current, f, fname, i, index, match, next, nextCount, ntyp, ok, result, scan, styp, t, t$1, visited, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _i = $f._i; _i$1 = $f._i$1; _key = $f._key; _key$1 = $f._key$1; _key$2 = $f._key$2; _key$3 = $f._key$3; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _ref$1 = $f._ref$1; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; count = $f.count; current = $f.current; f = $f.f; fname = $f.fname; i = $f.i; index = $f.index; match = $f.match; next = $f.next; nextCount = $f.nextCount; ntyp = $f.ntyp; ok = $f.ok; result = $f.result; scan = $f.scan; styp = $f.styp; t = $f.t; t$1 = $f.t$1; visited = $f.visited; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		result = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$13.nil, false);
		ok = false;
		t = this;
		current = new sliceType$14([]);
		next = new sliceType$14([new fieldScan.ptr(t, sliceType$13.nil)]);
		nextCount = false;
		visited = $makeMap(ptrType$9.keyFor, []);
		/* while (true) { */ case 1:
			/* if (!(next.$length > 0)) { break; } */ if(!(next.$length > 0)) { $s = 2; continue; }
			_tmp = next;
			_tmp$1 = $subslice(current, 0, 0);
			current = _tmp;
			next = _tmp$1;
			count = nextCount;
			nextCount = false;
			_ref = current;
			_i = 0;
			/* while (true) { */ case 3:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 4; continue; }
				scan = $clone(((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]), fieldScan);
				t$1 = scan.typ;
				/* */ if ((_entry = visited[ptrType$9.keyFor(t$1)], _entry !== undefined ? _entry.v : false)) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if ((_entry = visited[ptrType$9.keyFor(t$1)], _entry !== undefined ? _entry.v : false)) { */ case 5:
					_i++;
					/* continue; */ $s = 3; continue;
				/* } */ case 6:
				_key = t$1; (visited || $throwRuntimeError("assignment to entry in nil map"))[ptrType$9.keyFor(_key)] = { k: _key, v: true };
				_ref$1 = t$1.fields;
				_i$1 = 0;
				/* while (true) { */ case 7:
					/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 8; continue; }
					i = _i$1;
					f = (x = t$1.fields, ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]));
					fname = $clone(f.name, name).name();
					ntyp = ptrType$1.nil;
					/* */ if (f.anon()) { $s = 9; continue; }
					/* */ $s = 10; continue;
					/* if (f.anon()) { */ case 9:
						ntyp = f.typ;
						/* */ if (ntyp.Kind() === 22) { $s = 11; continue; }
						/* */ $s = 12; continue;
						/* if (ntyp.Kind() === 22) { */ case 11:
							_r = ntyp.Elem().common(); /* */ $s = 13; case 13: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
							ntyp = _r;
						/* } */ case 12:
					/* } */ case 10:
					_r$1 = match(fname); /* */ $s = 16; case 16: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					/* */ if (_r$1) { $s = 14; continue; }
					/* */ $s = 15; continue;
					/* if (_r$1) { */ case 14:
						if ((_entry$1 = count[ptrType$9.keyFor(t$1)], _entry$1 !== undefined ? _entry$1.v : 0) > 1 || ok) {
							_tmp$2 = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$13.nil, false);
							_tmp$3 = false;
							StructField.copy(result, _tmp$2);
							ok = _tmp$3;
							$s = -1; return [result, ok];
						}
						StructField.copy(result, t$1.Field(i));
						result.Index = sliceType$13.nil;
						result.Index = $appendSlice(result.Index, scan.index);
						result.Index = $append(result.Index, i);
						ok = true;
						_i$1++;
						/* continue; */ $s = 7; continue;
					/* } */ case 15:
					if (ok || ntyp === ptrType$1.nil || !((ntyp.Kind() === 25))) {
						_i$1++;
						/* continue; */ $s = 7; continue;
					}
					styp = (ntyp.kindType);
					if ((_entry$2 = nextCount[ptrType$9.keyFor(styp)], _entry$2 !== undefined ? _entry$2.v : 0) > 0) {
						_key$1 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$9.keyFor(_key$1)] = { k: _key$1, v: 2 };
						_i$1++;
						/* continue; */ $s = 7; continue;
					}
					if (nextCount === false) {
						nextCount = $makeMap(ptrType$9.keyFor, []);
					}
					_key$2 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$9.keyFor(_key$2)] = { k: _key$2, v: 1 };
					if ((_entry$3 = count[ptrType$9.keyFor(t$1)], _entry$3 !== undefined ? _entry$3.v : 0) > 1) {
						_key$3 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$9.keyFor(_key$3)] = { k: _key$3, v: 2 };
					}
					index = sliceType$13.nil;
					index = $appendSlice(index, scan.index);
					index = $append(index, i);
					next = $append(next, new fieldScan.ptr(styp, index));
					_i$1++;
				/* } */ $s = 7; continue; case 8:
				_i++;
			/* } */ $s = 3; continue; case 4:
			if (ok) {
				/* break; */ $s = 2; continue;
			}
		/* } */ $s = 1; continue; case 2:
		$s = -1; return [result, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByNameFunc }; } $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._i = _i; $f._i$1 = _i$1; $f._key = _key; $f._key$1 = _key$1; $f._key$2 = _key$2; $f._key$3 = _key$3; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.count = count; $f.current = current; $f.f = f; $f.fname = fname; $f.i = i; $f.index = index; $f.match = match; $f.next = next; $f.nextCount = nextCount; $f.ntyp = ntyp; $f.ok = ok; $f.result = result; $f.scan = scan; $f.styp = styp; $f.t = t; $f.t$1 = t$1; $f.visited = visited; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	structType.ptr.prototype.FieldByName = function(name$1) {
		var _i, _r, _ref, _tmp, _tmp$1, _tuple, f, hasAnon, i, name$1, present, t, tf, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _r = $f._r; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; f = $f.f; hasAnon = $f.hasAnon; i = $f.i; name$1 = $f.name$1; present = $f.present; t = $f.t; tf = $f.tf; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name$1 = [name$1];
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$13.nil, false);
		present = false;
		t = this;
		hasAnon = false;
		if (!(name$1[0] === "")) {
			_ref = t.fields;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				tf = (x = t.fields, ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]));
				if ($clone(tf.name, name).name() === name$1[0]) {
					_tmp = $clone(t.Field(i), StructField);
					_tmp$1 = true;
					StructField.copy(f, _tmp);
					present = _tmp$1;
					$s = -1; return [f, present];
				}
				if (tf.anon()) {
					hasAnon = true;
				}
				_i++;
			}
		}
		if (!hasAnon) {
			$s = -1; return [f, present];
		}
		_r = t.FieldByNameFunc((function(name$1) { return function(s) {
			var s;
			return s === name$1[0];
		}; })(name$1)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		StructField.copy(f, _tuple[0]);
		present = _tuple[1];
		$s = -1; return [f, present];
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByName }; } $f._i = _i; $f._r = _r; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.f = f; $f.hasAnon = hasAnon; $f.i = i; $f.name$1 = name$1; $f.present = present; $f.t = t; $f.tf = tf; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByName = function(name$1) { return this.$val.FieldByName(name$1); };
	PtrTo = function(t) {
		var t;
		return $assertType(t, ptrType$1).ptrTo();
	};
	$pkg.PtrTo = PtrTo;
	rtype.ptr.prototype.Implements = function(u) {
		var _r, t, u, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; u = $f.u; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.Implements"));
		}
		_r = u.Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 20))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 20))) { */ case 1:
			$panic(new $String("reflect: non-interface type passed to Type.Implements"));
		/* } */ case 2:
		$s = -1; return implements$1($assertType(u, ptrType$1), t);
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Implements }; } $f._r = _r; $f.t = t; $f.u = u; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Implements = function(u) { return this.$val.Implements(u); };
	rtype.ptr.prototype.AssignableTo = function(u) {
		var _r, t, u, uu, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; u = $f.u; uu = $f.uu; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.AssignableTo"));
		}
		uu = $assertType(u, ptrType$1);
		_r = directlyAssignable(uu, t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r || implements$1(uu, t);
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.AssignableTo }; } $f._r = _r; $f.t = t; $f.u = u; $f.uu = uu; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.AssignableTo = function(u) { return this.$val.AssignableTo(u); };
	rtype.ptr.prototype.ConvertibleTo = function(u) {
		var _r, t, u, uu, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; u = $f.u; uu = $f.uu; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.ConvertibleTo"));
		}
		uu = $assertType(u, ptrType$1);
		_r = convertOp(uu, t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return !(_r === $throwNilPointerError);
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.ConvertibleTo }; } $f._r = _r; $f.t = t; $f.u = u; $f.uu = uu; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.ConvertibleTo = function(u) { return this.$val.ConvertibleTo(u); };
	implements$1 = function(T, V) {
		var T, V, i, i$1, j, j$1, t, tm, tm$1, tmName, tmName$1, tmPkgPath, tmPkgPath$1, v, v$1, vm, vm$1, vmName, vmName$1, vmPkgPath, vmPkgPath$1, vmethods, x, x$1, x$2;
		if (!((T.Kind() === 20))) {
			return false;
		}
		t = (T.kindType);
		if (t.methods.$length === 0) {
			return true;
		}
		if (V.Kind() === 20) {
			v = (V.kindType);
			i = 0;
			j = 0;
			while (true) {
				if (!(j < v.methods.$length)) { break; }
				tm = (x = t.methods, ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]));
				tmName = $clone(t.rtype.nameOff(tm.name), name);
				vm = (x$1 = v.methods, ((j < 0 || j >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + j]));
				vmName = $clone(V.nameOff(vm.name), name);
				if ($clone(vmName, name).name() === $clone(tmName, name).name() && V.typeOff(vm.typ) === t.rtype.typeOff(tm.typ)) {
					if (!$clone(tmName, name).isExported()) {
						tmPkgPath = $clone(tmName, name).pkgPath();
						if (tmPkgPath === "") {
							tmPkgPath = $clone(t.pkgPath, name).name();
						}
						vmPkgPath = $clone(vmName, name).pkgPath();
						if (vmPkgPath === "") {
							vmPkgPath = $clone(v.pkgPath, name).name();
						}
						if (!(tmPkgPath === vmPkgPath)) {
							j = j + (1) >> 0;
							continue;
						}
					}
					i = i + (1) >> 0;
					if (i >= t.methods.$length) {
						return true;
					}
				}
				j = j + (1) >> 0;
			}
			return false;
		}
		v$1 = V.uncommon();
		if (v$1 === ptrType$5.nil) {
			return false;
		}
		i$1 = 0;
		vmethods = v$1.methods();
		j$1 = 0;
		while (true) {
			if (!(j$1 < ((v$1.mcount >> 0)))) { break; }
			tm$1 = (x$2 = t.methods, ((i$1 < 0 || i$1 >= x$2.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$2.$array[x$2.$offset + i$1]));
			tmName$1 = $clone(t.rtype.nameOff(tm$1.name), name);
			vm$1 = $clone(((j$1 < 0 || j$1 >= vmethods.$length) ? ($throwRuntimeError("index out of range"), undefined) : vmethods.$array[vmethods.$offset + j$1]), method);
			vmName$1 = $clone(V.nameOff(vm$1.name), name);
			if ($clone(vmName$1, name).name() === $clone(tmName$1, name).name() && V.typeOff(vm$1.mtyp) === t.rtype.typeOff(tm$1.typ)) {
				if (!$clone(tmName$1, name).isExported()) {
					tmPkgPath$1 = $clone(tmName$1, name).pkgPath();
					if (tmPkgPath$1 === "") {
						tmPkgPath$1 = $clone(t.pkgPath, name).name();
					}
					vmPkgPath$1 = $clone(vmName$1, name).pkgPath();
					if (vmPkgPath$1 === "") {
						vmPkgPath$1 = $clone(V.nameOff(v$1.pkgPath), name).name();
					}
					if (!(tmPkgPath$1 === vmPkgPath$1)) {
						j$1 = j$1 + (1) >> 0;
						continue;
					}
				}
				i$1 = i$1 + (1) >> 0;
				if (i$1 >= t.methods.$length) {
					return true;
				}
			}
			j$1 = j$1 + (1) >> 0;
		}
		return false;
	};
	directlyAssignable = function(T, V) {
		var T, V, _r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; T = $f.T; V = $f.V; _r = $f._r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (T === V) {
			$s = -1; return true;
		}
		if (!(T.Name() === "") && !(V.Name() === "") || !((T.Kind() === V.Kind()))) {
			$s = -1; return false;
		}
		_r = haveIdenticalUnderlyingType(T, V, true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: directlyAssignable }; } $f.T = T; $f.V = V; $f._r = _r; $f.$s = $s; $f.$r = $r; return $f;
	};
	haveIdenticalType = function(T, V, cmpTags) {
		var T, V, _arg, _arg$1, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _v, cmpTags, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; T = $f.T; V = $f.V; _arg = $f._arg; _arg$1 = $f._arg$1; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _v = $f._v; cmpTags = $f.cmpTags; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (cmpTags) {
			$s = -1; return $interfaceIsEqual(T, V);
		}
		_r = T.Name(); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = V.Name(); /* */ $s = 5; case 5: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		if (!(_r === _r$1)) { _v = true; $s = 3; continue s; }
		_r$2 = T.Kind(); /* */ $s = 6; case 6: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_r$3 = V.Kind(); /* */ $s = 7; case 7: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		_v = !((_r$2 === _r$3)); case 3:
		/* */ if (_v) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_v) { */ case 1:
			$s = -1; return false;
		/* } */ case 2:
		_r$4 = T.common(); /* */ $s = 8; case 8: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		_arg = _r$4;
		_r$5 = V.common(); /* */ $s = 9; case 9: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		_arg$1 = _r$5;
		_r$6 = haveIdenticalUnderlyingType(_arg, _arg$1, false); /* */ $s = 10; case 10: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		$s = -1; return _r$6;
		/* */ } return; } if ($f === undefined) { $f = { $blk: haveIdenticalType }; } $f.T = T; $f.V = V; $f._arg = _arg; $f._arg$1 = _arg$1; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._v = _v; $f.cmpTags = cmpTags; $f.$s = $s; $f.$r = $r; return $f;
	};
	haveIdenticalUnderlyingType = function(T, V, cmpTags) {
		var T, V, _1, _i, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _ref, _v, _v$1, _v$2, _v$3, cmpTags, i, i$1, i$2, kind, t, t$1, t$2, tf, tp, v, v$1, v$2, vf, vp, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; T = $f.T; V = $f.V; _1 = $f._1; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _ref = $f._ref; _v = $f._v; _v$1 = $f._v$1; _v$2 = $f._v$2; _v$3 = $f._v$3; cmpTags = $f.cmpTags; i = $f.i; i$1 = $f.i$1; i$2 = $f.i$2; kind = $f.kind; t = $f.t; t$1 = $f.t$1; t$2 = $f.t$2; tf = $f.tf; tp = $f.tp; v = $f.v; v$1 = $f.v$1; v$2 = $f.v$2; vf = $f.vf; vp = $f.vp; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (T === V) {
			$s = -1; return true;
		}
		kind = T.Kind();
		if (!((kind === V.Kind()))) {
			$s = -1; return false;
		}
		if (1 <= kind && kind <= 16 || (kind === 24) || (kind === 26)) {
			$s = -1; return true;
		}
			_1 = kind;
			/* */ if (_1 === (17)) { $s = 2; continue; }
			/* */ if (_1 === (18)) { $s = 3; continue; }
			/* */ if (_1 === (19)) { $s = 4; continue; }
			/* */ if (_1 === (20)) { $s = 5; continue; }
			/* */ if (_1 === (21)) { $s = 6; continue; }
			/* */ if ((_1 === (22)) || (_1 === (23))) { $s = 7; continue; }
			/* */ if (_1 === (25)) { $s = 8; continue; }
			/* */ $s = 9; continue;
			/* if (_1 === (17)) { */ case 2:
				if (!(T.Len() === V.Len())) { _v = false; $s = 10; continue s; }
				_r = haveIdenticalType(T.Elem(), V.Elem(), cmpTags); /* */ $s = 11; case 11: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_v = _r; case 10:
				$s = -1; return _v;
			/* } else if (_1 === (18)) { */ case 3:
				if (!(V.ChanDir() === 3)) { _v$1 = false; $s = 14; continue s; }
				_r$1 = haveIdenticalType(T.Elem(), V.Elem(), cmpTags); /* */ $s = 15; case 15: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_v$1 = _r$1; case 14:
				/* */ if (_v$1) { $s = 12; continue; }
				/* */ $s = 13; continue;
				/* if (_v$1) { */ case 12:
					$s = -1; return true;
				/* } */ case 13:
				if (!(V.ChanDir() === T.ChanDir())) { _v$2 = false; $s = 16; continue s; }
				_r$2 = haveIdenticalType(T.Elem(), V.Elem(), cmpTags); /* */ $s = 17; case 17: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v$2 = _r$2; case 16:
				$s = -1; return _v$2;
			/* } else if (_1 === (19)) { */ case 4:
				t = (T.kindType);
				v = (V.kindType);
				if (!((t.outCount === v.outCount)) || !((t.inCount === v.inCount))) {
					$s = -1; return false;
				}
				i = 0;
				/* while (true) { */ case 18:
					/* if (!(i < t.rtype.NumIn())) { break; } */ if(!(i < t.rtype.NumIn())) { $s = 19; continue; }
					_r$3 = haveIdenticalType(t.rtype.In(i), v.rtype.In(i), cmpTags); /* */ $s = 22; case 22: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					/* */ if (!_r$3) { $s = 20; continue; }
					/* */ $s = 21; continue;
					/* if (!_r$3) { */ case 20:
						$s = -1; return false;
					/* } */ case 21:
					i = i + (1) >> 0;
				/* } */ $s = 18; continue; case 19:
				i$1 = 0;
				/* while (true) { */ case 23:
					/* if (!(i$1 < t.rtype.NumOut())) { break; } */ if(!(i$1 < t.rtype.NumOut())) { $s = 24; continue; }
					_r$4 = haveIdenticalType(t.rtype.Out(i$1), v.rtype.Out(i$1), cmpTags); /* */ $s = 27; case 27: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					/* */ if (!_r$4) { $s = 25; continue; }
					/* */ $s = 26; continue;
					/* if (!_r$4) { */ case 25:
						$s = -1; return false;
					/* } */ case 26:
					i$1 = i$1 + (1) >> 0;
				/* } */ $s = 23; continue; case 24:
				$s = -1; return true;
			/* } else if (_1 === (20)) { */ case 5:
				t$1 = (T.kindType);
				v$1 = (V.kindType);
				if ((t$1.methods.$length === 0) && (v$1.methods.$length === 0)) {
					$s = -1; return true;
				}
				$s = -1; return false;
			/* } else if (_1 === (21)) { */ case 6:
				_r$5 = haveIdenticalType(T.Key(), V.Key(), cmpTags); /* */ $s = 29; case 29: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
				if (!(_r$5)) { _v$3 = false; $s = 28; continue s; }
				_r$6 = haveIdenticalType(T.Elem(), V.Elem(), cmpTags); /* */ $s = 30; case 30: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
				_v$3 = _r$6; case 28:
				$s = -1; return _v$3;
			/* } else if ((_1 === (22)) || (_1 === (23))) { */ case 7:
				_r$7 = haveIdenticalType(T.Elem(), V.Elem(), cmpTags); /* */ $s = 31; case 31: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
				$s = -1; return _r$7;
			/* } else if (_1 === (25)) { */ case 8:
				t$2 = (T.kindType);
				v$2 = (V.kindType);
				if (!((t$2.fields.$length === v$2.fields.$length))) {
					$s = -1; return false;
				}
				_ref = t$2.fields;
				_i = 0;
				/* while (true) { */ case 32:
					/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 33; continue; }
					i$2 = _i;
					tf = (x = t$2.fields, ((i$2 < 0 || i$2 >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i$2]));
					vf = (x$1 = v$2.fields, ((i$2 < 0 || i$2 >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + i$2]));
					if (!($clone(tf.name, name).name() === $clone(vf.name, name).name())) {
						$s = -1; return false;
					}
					_r$8 = haveIdenticalType(tf.typ, vf.typ, cmpTags); /* */ $s = 36; case 36: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
					/* */ if (!_r$8) { $s = 34; continue; }
					/* */ $s = 35; continue;
					/* if (!_r$8) { */ case 34:
						$s = -1; return false;
					/* } */ case 35:
					if (cmpTags && !($clone(tf.name, name).tag() === $clone(vf.name, name).tag())) {
						$s = -1; return false;
					}
					if (!((tf.offsetAnon === vf.offsetAnon))) {
						$s = -1; return false;
					}
					if (!$clone(tf.name, name).isExported()) {
						tp = $clone(tf.name, name).pkgPath();
						if (tp === "") {
							tp = $clone(t$2.pkgPath, name).name();
						}
						vp = $clone(vf.name, name).pkgPath();
						if (vp === "") {
							vp = $clone(v$2.pkgPath, name).name();
						}
						if (!(tp === vp)) {
							$s = -1; return false;
						}
					}
					_i++;
				/* } */ $s = 32; continue; case 33:
				$s = -1; return true;
			/* } */ case 9:
		case 1:
		$s = -1; return false;
		/* */ } return; } if ($f === undefined) { $f = { $blk: haveIdenticalUnderlyingType }; } $f.T = T; $f.V = V; $f._1 = _1; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._ref = _ref; $f._v = _v; $f._v$1 = _v$1; $f._v$2 = _v$2; $f._v$3 = _v$3; $f.cmpTags = cmpTags; $f.i = i; $f.i$1 = i$1; $f.i$2 = i$2; $f.kind = kind; $f.t = t; $f.t$1 = t$1; $f.t$2 = t$2; $f.tf = tf; $f.tp = tp; $f.v = v; $f.v$1 = v$1; $f.v$2 = v$2; $f.vf = vf; $f.vp = vp; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	toType = function(t) {
		var t;
		if (t === ptrType$1.nil) {
			return $ifaceNil;
		}
		return t;
	};
	ifaceIndir = function(t) {
		var t;
		return ((t.kind & 32) >>> 0) === 0;
	};
	flag.prototype.kind = function() {
		var f;
		f = this.$val;
		return ((((f & 31) >>> 0) >>> 0));
	};
	$ptrType(flag).prototype.kind = function() { return new flag(this.$get()).kind(); };
	Value.ptr.prototype.pointer = function() {
		var v;
		v = this;
		if (!((v.typ.size === 4)) || !v.typ.pointers()) {
			$panic(new $String("can't call pointer on a non-pointer Value"));
		}
		if (!((((v.flag & 128) >>> 0) === 0))) {
			return (v.ptr).$get();
		}
		return v.ptr;
	};
	Value.prototype.pointer = function() { return this.$val.pointer(); };
	ValueError.ptr.prototype.Error = function() {
		var e;
		e = this;
		if (e.Kind === 0) {
			return "reflect: call of " + e.Method + " on zero Value";
		}
		return "reflect: call of " + e.Method + " on " + new Kind(e.Kind).String() + " Value";
	};
	ValueError.prototype.Error = function() { return this.$val.Error(); };
	flag.prototype.mustBe = function(expected) {
		var expected, f;
		f = this.$val;
		if (!((new flag(f).kind() === expected))) {
			$panic(new ValueError.ptr(methodName(), new flag(f).kind()));
		}
	};
	$ptrType(flag).prototype.mustBe = function(expected) { return new flag(this.$get()).mustBe(expected); };
	flag.prototype.mustBeExported = function() {
		var f;
		f = this.$val;
		if (f === 0) {
			$panic(new ValueError.ptr(methodName(), 0));
		}
		if (!((((f & 96) >>> 0) === 0))) {
			$panic(new $String("reflect: " + methodName() + " using value obtained using unexported field"));
		}
	};
	$ptrType(flag).prototype.mustBeExported = function() { return new flag(this.$get()).mustBeExported(); };
	flag.prototype.mustBeAssignable = function() {
		var f;
		f = this.$val;
		if (f === 0) {
			$panic(new ValueError.ptr(methodName(), 0));
		}
		if (!((((f & 96) >>> 0) === 0))) {
			$panic(new $String("reflect: " + methodName() + " using value obtained using unexported field"));
		}
		if (((f & 256) >>> 0) === 0) {
			$panic(new $String("reflect: " + methodName() + " using unaddressable value"));
		}
	};
	$ptrType(flag).prototype.mustBeAssignable = function() { return new flag(this.$get()).mustBeAssignable(); };
	Value.ptr.prototype.Addr = function() {
		var v;
		v = this;
		if (((v.flag & 256) >>> 0) === 0) {
			$panic(new $String("reflect.Value.Addr of unaddressable value"));
		}
		return new Value.ptr(v.typ.ptrTo(), v.ptr, ((((v.flag & 96) >>> 0)) | 22) >>> 0);
	};
	Value.prototype.Addr = function() { return this.$val.Addr(); };
	Value.ptr.prototype.Bool = function() {
		var v;
		v = this;
		new flag(v.flag).mustBe(1);
		return (v.ptr).$get();
	};
	Value.prototype.Bool = function() { return this.$val.Bool(); };
	Value.ptr.prototype.Bytes = function() {
		var _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 8))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 8))) { */ case 1:
			$panic(new $String("reflect.Value.Bytes of non-byte slice"));
		/* } */ case 2:
		$s = -1; return (v.ptr).$get();
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Bytes }; } $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Bytes = function() { return this.$val.Bytes(); };
	Value.ptr.prototype.runes = function() {
		var _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 5))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 5))) { */ case 1:
			$panic(new $String("reflect.Value.Bytes of non-rune slice"));
		/* } */ case 2:
		$s = -1; return (v.ptr).$get();
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.runes }; } $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.runes = function() { return this.$val.runes(); };
	Value.ptr.prototype.CanAddr = function() {
		var v;
		v = this;
		return !((((v.flag & 256) >>> 0) === 0));
	};
	Value.prototype.CanAddr = function() { return this.$val.CanAddr(); };
	Value.ptr.prototype.CanSet = function() {
		var v;
		v = this;
		return ((v.flag & 352) >>> 0) === 256;
	};
	Value.prototype.CanSet = function() { return this.$val.CanSet(); };
	Value.ptr.prototype.Call = function(in$1) {
		var _r, in$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; in$1 = $f.in$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(19);
		new flag(v.flag).mustBeExported();
		_r = $clone(v, Value).call("Call", in$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Call }; } $f._r = _r; $f.in$1 = in$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Call = function(in$1) { return this.$val.Call(in$1); };
	Value.ptr.prototype.CallSlice = function(in$1) {
		var _r, in$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; in$1 = $f.in$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(19);
		new flag(v.flag).mustBeExported();
		_r = $clone(v, Value).call("CallSlice", in$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.CallSlice }; } $f._r = _r; $f.in$1 = in$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.CallSlice = function(in$1) { return this.$val.CallSlice(in$1); };
	Value.ptr.prototype.Complex = function() {
		var _1, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (15)) {
			return ((x = (v.ptr).$get(), new $Complex128(x.$real, x.$imag)));
		} else if (_1 === (16)) {
			return (v.ptr).$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Complex", new flag(v.flag).kind()));
	};
	Value.prototype.Complex = function() { return this.$val.Complex(); };
	Value.ptr.prototype.FieldByIndex = function(index) {
		var _i, _r, _r$1, _r$2, _r$3, _ref, _v, i, index, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _ref = $f._ref; _v = $f._v; i = $f.i; index = $f.index; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (index.$length === 1) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (index.$length === 1) { */ case 1:
			_r = $clone(v, Value).Field((0 >= index.$length ? ($throwRuntimeError("index out of range"), undefined) : index.$array[index.$offset + 0])); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return _r;
		/* } */ case 2:
		new flag(v.flag).mustBe(25);
		_ref = index;
		_i = 0;
		/* while (true) { */ case 4:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 5; continue; }
			i = _i;
			x = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			/* */ if (i > 0) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (i > 0) { */ case 6:
				if (!($clone(v, Value).Kind() === 22)) { _v = false; $s = 10; continue s; }
				_r$1 = v.typ.Elem().Kind(); /* */ $s = 11; case 11: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_v = _r$1 === 25; case 10:
				/* */ if (_v) { $s = 8; continue; }
				/* */ $s = 9; continue;
				/* if (_v) { */ case 8:
					if ($clone(v, Value).IsNil()) {
						$panic(new $String("reflect: indirection through nil pointer to embedded struct"));
					}
					_r$2 = $clone(v, Value).Elem(); /* */ $s = 12; case 12: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					v = _r$2;
				/* } */ case 9:
			/* } */ case 7:
			_r$3 = $clone(v, Value).Field(x); /* */ $s = 13; case 13: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			v = _r$3;
			_i++;
		/* } */ $s = 4; continue; case 5:
		$s = -1; return v;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByIndex }; } $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._ref = _ref; $f._v = _v; $f.i = i; $f.index = index; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	Value.ptr.prototype.FieldByName = function(name$1) {
		var _r, _r$1, _tuple, f, name$1, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; f = $f.f; name$1 = $f.name$1; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(25);
		_r = v.typ.FieldByName(name$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		f = $clone(_tuple[0], StructField);
		ok = _tuple[1];
		/* */ if (ok) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (ok) { */ case 2:
			_r$1 = $clone(v, Value).FieldByIndex(f.Index); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$s = -1; return _r$1;
		/* } */ case 3:
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByName }; } $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.f = f; $f.name$1 = name$1; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByName = function(name$1) { return this.$val.FieldByName(name$1); };
	Value.ptr.prototype.FieldByNameFunc = function(match) {
		var _r, _r$1, _tuple, f, match, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; f = $f.f; match = $f.match; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		_r = v.typ.FieldByNameFunc(match); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		f = $clone(_tuple[0], StructField);
		ok = _tuple[1];
		/* */ if (ok) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (ok) { */ case 2:
			_r$1 = $clone(v, Value).FieldByIndex(f.Index); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$s = -1; return _r$1;
		/* } */ case 3:
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByNameFunc }; } $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.f = f; $f.match = match; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	Value.ptr.prototype.Float = function() {
		var _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (13)) {
			return ((v.ptr).$get());
		} else if (_1 === (14)) {
			return (v.ptr).$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Float", new flag(v.flag).kind()));
	};
	Value.prototype.Float = function() { return this.$val.Float(); };
	Value.ptr.prototype.Int = function() {
		var _1, k, p, v;
		v = this;
		k = new flag(v.flag).kind();
		p = v.ptr;
		_1 = k;
		if (_1 === (2)) {
			return (new $Int64(0, (p).$get()));
		} else if (_1 === (3)) {
			return (new $Int64(0, (p).$get()));
		} else if (_1 === (4)) {
			return (new $Int64(0, (p).$get()));
		} else if (_1 === (5)) {
			return (new $Int64(0, (p).$get()));
		} else if (_1 === (6)) {
			return (p).$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Int", new flag(v.flag).kind()));
	};
	Value.prototype.Int = function() { return this.$val.Int(); };
	Value.ptr.prototype.CanInterface = function() {
		var v;
		v = this;
		if (v.flag === 0) {
			$panic(new ValueError.ptr("reflect.Value.CanInterface", 0));
		}
		return ((v.flag & 96) >>> 0) === 0;
	};
	Value.prototype.CanInterface = function() { return this.$val.CanInterface(); };
	Value.ptr.prototype.Interface = function() {
		var _r, i, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; i = $f.i; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = $ifaceNil;
		v = this;
		_r = valueInterface($clone(v, Value), true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		i = _r;
		$s = -1; return i;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Interface }; } $f._r = _r; $f.i = i; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Interface = function() { return this.$val.Interface(); };
	Value.ptr.prototype.IsValid = function() {
		var v;
		v = this;
		return !((v.flag === 0));
	};
	Value.prototype.IsValid = function() { return this.$val.IsValid(); };
	Value.ptr.prototype.Kind = function() {
		var v;
		v = this;
		return new flag(v.flag).kind();
	};
	Value.prototype.Kind = function() { return this.$val.Kind(); };
	Value.ptr.prototype.MapIndex = function(key) {
		var _r, c, e, fl, k, key, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; c = $f.c; e = $f.e; fl = $f.fl; k = $f.k; key = $f.key; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(21);
		tt = (v.typ.kindType);
		_r = $clone(key, Value).assignTo("reflect.Value.MapIndex", tt.key, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		key = _r;
		k = 0;
		if (!((((key.flag & 128) >>> 0) === 0))) {
			k = key.ptr;
		} else {
			k = ((key.$ptr_ptr || (key.$ptr_ptr = new ptrType$15(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, key))));
		}
		e = mapaccess(v.typ, $clone(v, Value).pointer(), k);
		if (e === 0) {
			$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		typ = tt.elem;
		fl = ((((v.flag | key.flag) >>> 0)) & 96) >>> 0;
		fl = (fl | (((typ.Kind() >>> 0)))) >>> 0;
		if (ifaceIndir(typ)) {
			c = unsafe_New(typ);
			typedmemmove(typ, c, e);
			$s = -1; return new Value.ptr(typ, c, (fl | 128) >>> 0);
		} else {
			$s = -1; return new Value.ptr(typ, (e).$get(), fl);
		}
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MapIndex }; } $f._r = _r; $f.c = c; $f.e = e; $f.fl = fl; $f.k = k; $f.key = key; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MapIndex = function(key) { return this.$val.MapIndex(key); };
	Value.ptr.prototype.MapKeys = function() {
		var _r, a, c, fl, i, it, key, keyType, m, mlen, tt, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; a = $f.a; c = $f.c; fl = $f.fl; i = $f.i; it = $f.it; key = $f.key; keyType = $f.keyType; m = $f.m; mlen = $f.mlen; tt = $f.tt; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(21);
		tt = (v.typ.kindType);
		keyType = tt.key;
		fl = (((v.flag & 96) >>> 0) | ((keyType.Kind() >>> 0))) >>> 0;
		m = $clone(v, Value).pointer();
		mlen = 0;
		if (!(m === 0)) {
			mlen = maplen(m);
		}
		it = mapiterinit(v.typ, m);
		a = $makeSlice(sliceType$9, mlen);
		i = 0;
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < a.$length)) { break; } */ if(!(i < a.$length)) { $s = 2; continue; }
			_r = mapiterkey(it); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			key = _r;
			if (key === 0) {
				/* break; */ $s = 2; continue;
			}
			if (ifaceIndir(keyType)) {
				c = unsafe_New(keyType);
				typedmemmove(keyType, c, key);
				((i < 0 || i >= a.$length) ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + i] = new Value.ptr(keyType, c, (fl | 128) >>> 0));
			} else {
				((i < 0 || i >= a.$length) ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + i] = new Value.ptr(keyType, (key).$get(), fl));
			}
			mapiternext(it);
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return $subslice(a, 0, i);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MapKeys }; } $f._r = _r; $f.a = a; $f.c = c; $f.fl = fl; $f.i = i; $f.it = it; $f.key = key; $f.keyType = keyType; $f.m = m; $f.mlen = mlen; $f.tt = tt; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MapKeys = function() { return this.$val.MapKeys(); };
	Value.ptr.prototype.Method = function(i) {
		var _r, _v, fl, i, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _v = $f._v; fl = $f.fl; i = $f.i; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.Method", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) { _v = true; $s = 3; continue s; }
		_r = v.typ.NumMethod(); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_v = ((i >>> 0)) >= ((_r >>> 0)); case 3:
		/* */ if (_v) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_v) { */ case 1:
			$panic(new $String("reflect: Method index out of range"));
		/* } */ case 2:
		if ((v.typ.Kind() === 20) && $clone(v, Value).IsNil()) {
			$panic(new $String("reflect: Method on nil interface value"));
		}
		fl = (v.flag & 160) >>> 0;
		fl = (fl | (19)) >>> 0;
		fl = (fl | ((((((i >>> 0)) << 10 >>> 0) | 512) >>> 0))) >>> 0;
		$s = -1; return new Value.ptr(v.typ, v.ptr, fl);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Method }; } $f._r = _r; $f._v = _v; $f.fl = fl; $f.i = i; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Method = function(i) { return this.$val.Method(i); };
	Value.ptr.prototype.NumMethod = function() {
		var _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.NumMethod", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) {
			$s = -1; return 0;
		}
		_r = v.typ.NumMethod(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.NumMethod }; } $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	Value.ptr.prototype.MethodByName = function(name$1) {
		var _r, _r$1, _tuple, m, name$1, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; m = $f.m; name$1 = $f.name$1; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.MethodByName", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) {
			$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_r = v.typ.MethodByName(name$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		m = $clone(_tuple[0], Method);
		ok = _tuple[1];
		if (!ok) {
			$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_r$1 = $clone(v, Value).Method(m.Index); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MethodByName }; } $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.m = m; $f.name$1 = name$1; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MethodByName = function(name$1) { return this.$val.MethodByName(name$1); };
	Value.ptr.prototype.NumField = function() {
		var tt, v;
		v = this;
		new flag(v.flag).mustBe(25);
		tt = (v.typ.kindType);
		return tt.fields.$length;
	};
	Value.prototype.NumField = function() { return this.$val.NumField(); };
	Value.ptr.prototype.OverflowComplex = function(x) {
		var _1, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (15)) {
			return overflowFloat32(x.$real) || overflowFloat32(x.$imag);
		} else if (_1 === (16)) {
			return false;
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowComplex", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowComplex = function(x) { return this.$val.OverflowComplex(x); };
	Value.ptr.prototype.OverflowFloat = function(x) {
		var _1, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (13)) {
			return overflowFloat32(x);
		} else if (_1 === (14)) {
			return false;
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowFloat", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowFloat = function(x) { return this.$val.OverflowFloat(x); };
	overflowFloat32 = function(x) {
		var x;
		if (x < 0) {
			x = -x;
		}
		return 3.4028234663852886e+38 < x && x <= 1.7976931348623157e+308;
	};
	Value.ptr.prototype.OverflowInt = function(x) {
		var _1, bitSize, k, trunc, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6))) {
			bitSize = $imul(v.typ.size, 8) >>> 0;
			trunc = $shiftRightInt64(($shiftLeft64(x, ((64 - bitSize >>> 0)))), ((64 - bitSize >>> 0)));
			return !((x.$high === trunc.$high && x.$low === trunc.$low));
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowInt", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowInt = function(x) { return this.$val.OverflowInt(x); };
	Value.ptr.prototype.OverflowUint = function(x) {
		var _1, bitSize, k, trunc, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (7)) || (_1 === (12)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11))) {
			bitSize = $imul(v.typ.size, 8) >>> 0;
			trunc = $shiftRightUint64(($shiftLeft64(x, ((64 - bitSize >>> 0)))), ((64 - bitSize >>> 0)));
			return !((x.$high === trunc.$high && x.$low === trunc.$low));
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowUint", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowUint = function(x) { return this.$val.OverflowUint(x); };
	Value.ptr.prototype.Recv = function() {
		var _r, _tuple, ok, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; ok = $f.ok; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = $clone(v, Value).recv(false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		x = _tuple[0];
		ok = _tuple[1];
		$s = -1; return [x, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Recv }; } $f._r = _r; $f._tuple = _tuple; $f.ok = ok; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Recv = function() { return this.$val.Recv(); };
	Value.ptr.prototype.recv = function(nb) {
		var _r, _tuple, nb, ok, p, selected, t, tt, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; nb = $f.nb; ok = $f.ok; p = $f.p; selected = $f.selected; t = $f.t; tt = $f.tt; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		val = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		tt = (v.typ.kindType);
		if ((((tt.dir >> 0)) & 1) === 0) {
			$panic(new $String("reflect: recv on send-only channel"));
		}
		t = tt.elem;
		val = new Value.ptr(t, 0, ((t.Kind() >>> 0)));
		p = 0;
		if (ifaceIndir(t)) {
			p = unsafe_New(t);
			val.ptr = p;
			val.flag = (val.flag | (128)) >>> 0;
		} else {
			p = ((val.$ptr_ptr || (val.$ptr_ptr = new ptrType$15(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, val))));
		}
		_r = chanrecv($clone(v, Value).pointer(), nb, p); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		selected = _tuple[0];
		ok = _tuple[1];
		if (!selected) {
			val = new Value.ptr(ptrType$1.nil, 0, 0);
		}
		$s = -1; return [val, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.recv }; } $f._r = _r; $f._tuple = _tuple; $f.nb = nb; $f.ok = ok; $f.p = p; $f.selected = selected; $f.t = t; $f.tt = tt; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.recv = function(nb) { return this.$val.recv(nb); };
	Value.ptr.prototype.Send = function(x) {
		var _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = $clone(v, Value).send($clone(x, Value), false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r;
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Send }; } $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Send = function(x) { return this.$val.Send(x); };
	Value.ptr.prototype.send = function(x, nb) {
		var _r, _r$1, nb, p, selected, tt, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; nb = $f.nb; p = $f.p; selected = $f.selected; tt = $f.tt; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		selected = false;
		v = this;
		tt = (v.typ.kindType);
		if ((((tt.dir >> 0)) & 2) === 0) {
			$panic(new $String("reflect: send on recv-only channel"));
		}
		new flag(x.flag).mustBeExported();
		_r = $clone(x, Value).assignTo("reflect.Value.Send", tt.elem, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		x = _r;
		p = 0;
		if (!((((x.flag & 128) >>> 0) === 0))) {
			p = x.ptr;
		} else {
			p = ((x.$ptr_ptr || (x.$ptr_ptr = new ptrType$15(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, x))));
		}
		_r$1 = chansend($clone(v, Value).pointer(), p, nb); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		selected = _r$1;
		$s = -1; return selected;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.send }; } $f._r = _r; $f._r$1 = _r$1; $f.nb = nb; $f.p = p; $f.selected = selected; $f.tt = tt; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.send = function(x, nb) { return this.$val.send(x, nb); };
	Value.ptr.prototype.SetBool = function(x) {
		var v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(1);
		(v.ptr).$set(x);
	};
	Value.prototype.SetBool = function(x) { return this.$val.SetBool(x); };
	Value.ptr.prototype.setRunes = function(x) {
		var _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 5))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 5))) { */ case 1:
			$panic(new $String("reflect.Value.setRunes of non-rune slice"));
		/* } */ case 2:
		(v.ptr).$set(x);
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.setRunes }; } $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.setRunes = function(x) { return this.$val.setRunes(x); };
	Value.ptr.prototype.SetComplex = function(x) {
		var _1, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (15)) {
			(v.ptr).$set((new $Complex64(x.$real, x.$imag)));
		} else if (_1 === (16)) {
			(v.ptr).$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetComplex", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetComplex = function(x) { return this.$val.SetComplex(x); };
	Value.ptr.prototype.SetFloat = function(x) {
		var _1, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (13)) {
			(v.ptr).$set(($fround(x)));
		} else if (_1 === (14)) {
			(v.ptr).$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetFloat", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetFloat = function(x) { return this.$val.SetFloat(x); };
	Value.ptr.prototype.SetInt = function(x) {
		var _1, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (2)) {
			(v.ptr).$set((((x.$low + ((x.$high >> 31) * 4294967296)) >> 0)));
		} else if (_1 === (3)) {
			(v.ptr).$set((((x.$low + ((x.$high >> 31) * 4294967296)) << 24 >> 24)));
		} else if (_1 === (4)) {
			(v.ptr).$set((((x.$low + ((x.$high >> 31) * 4294967296)) << 16 >> 16)));
		} else if (_1 === (5)) {
			(v.ptr).$set((((x.$low + ((x.$high >> 31) * 4294967296)) >> 0)));
		} else if (_1 === (6)) {
			(v.ptr).$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetInt", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetInt = function(x) { return this.$val.SetInt(x); };
	Value.ptr.prototype.SetMapIndex = function(key, val) {
		var _r, _r$1, e, k, key, tt, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; e = $f.e; k = $f.k; key = $f.key; tt = $f.tt; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(21);
		new flag(v.flag).mustBeExported();
		new flag(key.flag).mustBeExported();
		tt = (v.typ.kindType);
		_r = $clone(key, Value).assignTo("reflect.Value.SetMapIndex", tt.key, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		key = _r;
		k = 0;
		if (!((((key.flag & 128) >>> 0) === 0))) {
			k = key.ptr;
		} else {
			k = ((key.$ptr_ptr || (key.$ptr_ptr = new ptrType$15(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, key))));
		}
		if (val.typ === ptrType$1.nil) {
			mapdelete(v.typ, $clone(v, Value).pointer(), k);
			$s = -1; return;
		}
		new flag(val.flag).mustBeExported();
		_r$1 = $clone(val, Value).assignTo("reflect.Value.SetMapIndex", tt.elem, 0); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		val = _r$1;
		e = 0;
		if (!((((val.flag & 128) >>> 0) === 0))) {
			e = val.ptr;
		} else {
			e = ((val.$ptr_ptr || (val.$ptr_ptr = new ptrType$15(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, val))));
		}
		$r = mapassign(v.typ, $clone(v, Value).pointer(), k, e); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.SetMapIndex }; } $f._r = _r; $f._r$1 = _r$1; $f.e = e; $f.k = k; $f.key = key; $f.tt = tt; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.SetMapIndex = function(key, val) { return this.$val.SetMapIndex(key, val); };
	Value.ptr.prototype.SetUint = function(x) {
		var _1, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (7)) {
			(v.ptr).$set(((x.$low >>> 0)));
		} else if (_1 === (8)) {
			(v.ptr).$set(((x.$low << 24 >>> 24)));
		} else if (_1 === (9)) {
			(v.ptr).$set(((x.$low << 16 >>> 16)));
		} else if (_1 === (10)) {
			(v.ptr).$set(((x.$low >>> 0)));
		} else if (_1 === (11)) {
			(v.ptr).$set(x);
		} else if (_1 === (12)) {
			(v.ptr).$set(((x.$low >>> 0)));
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetUint", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetUint = function(x) { return this.$val.SetUint(x); };
	Value.ptr.prototype.SetPointer = function(x) {
		var v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(26);
		(v.ptr).$set(x);
	};
	Value.prototype.SetPointer = function(x) { return this.$val.SetPointer(x); };
	Value.ptr.prototype.SetString = function(x) {
		var v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(24);
		(v.ptr).$set(x);
	};
	Value.prototype.SetString = function(x) { return this.$val.SetString(x); };
	Value.ptr.prototype.String = function() {
		var _1, _r, k, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r = $f._r; k = $f.k; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (0)) {
			$s = -1; return "<invalid Value>";
		} else if (_1 === (24)) {
			$s = -1; return (v.ptr).$get();
		}
		_r = $clone(v, Value).Type().String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return "<" + _r + " Value>";
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.String }; } $f._1 = _1; $f._r = _r; $f.k = k; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.String = function() { return this.$val.String(); };
	Value.ptr.prototype.TryRecv = function() {
		var _r, _tuple, ok, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _tuple = $f._tuple; ok = $f.ok; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = $clone(v, Value).recv(true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		x = _tuple[0];
		ok = _tuple[1];
		$s = -1; return [x, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.TryRecv }; } $f._r = _r; $f._tuple = _tuple; $f.ok = ok; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.TryRecv = function() { return this.$val.TryRecv(); };
	Value.ptr.prototype.TrySend = function(x) {
		var _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = $clone(v, Value).send($clone(x, Value), true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.TrySend }; } $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.TrySend = function(x) { return this.$val.TrySend(x); };
	Value.ptr.prototype.Type = function() {
		var f, i, m, m$1, tt, ut, v, x, x$1;
		v = this;
		f = v.flag;
		if (f === 0) {
			$panic(new ValueError.ptr("reflect.Value.Type", 0));
		}
		if (((f & 512) >>> 0) === 0) {
			return v.typ;
		}
		i = ((v.flag >> 0)) >> 10 >> 0;
		if (v.typ.Kind() === 20) {
			tt = (v.typ.kindType);
			if (((i >>> 0)) >= ((tt.methods.$length >>> 0))) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m = (x = tt.methods, ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]));
			return v.typ.typeOff(m.typ);
		}
		ut = v.typ.uncommon();
		if (ut === ptrType$5.nil || ((i >>> 0)) >= ((ut.mcount >>> 0))) {
			$panic(new $String("reflect: internal error: invalid method index"));
		}
		m$1 = $clone((x$1 = ut.methods(), ((i < 0 || i >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + i])), method);
		return v.typ.typeOff(m$1.mtyp);
	};
	Value.prototype.Type = function() { return this.$val.Type(); };
	Value.ptr.prototype.Uint = function() {
		var _1, k, p, v, x;
		v = this;
		k = new flag(v.flag).kind();
		p = v.ptr;
		_1 = k;
		if (_1 === (7)) {
			return (new $Uint64(0, (p).$get()));
		} else if (_1 === (8)) {
			return (new $Uint64(0, (p).$get()));
		} else if (_1 === (9)) {
			return (new $Uint64(0, (p).$get()));
		} else if (_1 === (10)) {
			return (new $Uint64(0, (p).$get()));
		} else if (_1 === (11)) {
			return (p).$get();
		} else if (_1 === (12)) {
			return ((x = (p).$get(), new $Uint64(0, x.constructor === Number ? x : 1)));
		}
		$panic(new ValueError.ptr("reflect.Value.Uint", new flag(v.flag).kind()));
	};
	Value.prototype.Uint = function() { return this.$val.Uint(); };
	Value.ptr.prototype.UnsafeAddr = function() {
		var v;
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.UnsafeAddr", 0));
		}
		if (((v.flag & 256) >>> 0) === 0) {
			$panic(new $String("reflect.Value.UnsafeAddr of unaddressable value"));
		}
		return (v.ptr);
	};
	Value.prototype.UnsafeAddr = function() { return this.$val.UnsafeAddr(); };
	typesMustMatch = function(what, t1, t2) {
		var _r, _r$1, t1, t2, what, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; t1 = $f.t1; t2 = $f.t2; what = $f.what; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ if (!($interfaceIsEqual(t1, t2))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!($interfaceIsEqual(t1, t2))) { */ case 1:
			_r = t1.String(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r$1 = t2.String(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$panic(new $String(what + ": " + _r + " != " + _r$1));
		/* } */ case 2:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: typesMustMatch }; } $f._r = _r; $f._r$1 = _r$1; $f.t1 = t1; $f.t2 = t2; $f.what = what; $f.$s = $s; $f.$r = $r; return $f;
	};
	MakeMap = function(typ) {
		var _r, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = MakeMapWithSize(typ, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: MakeMap }; } $f._r = _r; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.MakeMap = MakeMap;
	MakeMapWithSize = function(typ, n) {
		var _r, _r$1, m, n, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; m = $f.m; n = $f.n; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = typ.Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 21))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 21))) { */ case 1:
			$panic(new $String("reflect.MakeMapWithSize of non-map type"));
		/* } */ case 2:
		m = makemap($assertType(typ, ptrType$1), n);
		_r$1 = typ.common(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r$1, m, 21);
		/* */ } return; } if ($f === undefined) { $f = { $blk: MakeMapWithSize }; } $f._r = _r; $f._r$1 = _r$1; $f.m = m; $f.n = n; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.MakeMapWithSize = MakeMapWithSize;
	New = function(typ) {
		var _r, _r$1, fl, ptr, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; fl = $f.fl; ptr = $f.ptr; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if ($interfaceIsEqual(typ, $ifaceNil)) {
			$panic(new $String("reflect: New(nil)"));
		}
		ptr = unsafe_New($assertType(typ, ptrType$1));
		fl = 22;
		_r = typ.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.ptrTo(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r$1, ptr, fl);
		/* */ } return; } if ($f === undefined) { $f = { $blk: New }; } $f._r = _r; $f._r$1 = _r$1; $f.fl = fl; $f.ptr = ptr; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.New = New;
	Value.ptr.prototype.assignTo = function(context, dst, target) {
		var _r, _r$1, _r$2, _r$3, context, dst, fl, target, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; context = $f.context; dst = $f.dst; fl = $f.fl; target = $f.target; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue(context, $clone(v, Value)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
			_r$1 = directlyAssignable(dst, v.typ); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ if (_r$1) { $s = 5; continue; }
			/* */ if (implements$1(dst, v.typ)) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (_r$1) { */ case 5:
				fl = (v.flag & 480) >>> 0;
				fl = (fl | (((dst.Kind() >>> 0)))) >>> 0;
				$s = -1; return new Value.ptr(dst, v.ptr, fl);
			/* } else if (implements$1(dst, v.typ)) { */ case 6:
				if (target === 0) {
					target = unsafe_New(dst);
				}
				_r$2 = valueInterface($clone(v, Value), false); /* */ $s = 9; case 9: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				x = _r$2;
				_r$3 = dst.NumMethod(); /* */ $s = 13; case 13: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				/* */ if (_r$3 === 0) { $s = 10; continue; }
				/* */ $s = 11; continue;
				/* if (_r$3 === 0) { */ case 10:
					(target).$set(x);
					$s = 12; continue;
				/* } else { */ case 11:
					ifaceE2I(dst, x, target);
				/* } */ case 12:
				$s = -1; return new Value.ptr(dst, target, 148);
			/* } */ case 7:
		case 4:
		$panic(new $String(context + ": value of type " + v.typ.String() + " is not assignable to type " + dst.String()));
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.assignTo }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f.context = context; $f.dst = dst; $f.fl = fl; $f.target = target; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.assignTo = function(context, dst, target) { return this.$val.assignTo(context, dst, target); };
	Value.ptr.prototype.Convert = function(t) {
		var _r, _r$1, _r$2, _r$3, _r$4, op, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; op = $f.op; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue("Convert", $clone(v, Value)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
		_r$1 = t.common(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = convertOp(_r$1, v.typ); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		op = _r$2;
		/* */ if (op === $throwNilPointerError) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (op === $throwNilPointerError) { */ case 6:
			_r$3 = t.String(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			$panic(new $String("reflect.Value.Convert: value of type " + v.typ.String() + " cannot be converted to type " + _r$3));
		/* } */ case 7:
		_r$4 = op($clone(v, Value), t); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		$s = -1; return _r$4;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Convert }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.op = op; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Convert = function(t) { return this.$val.Convert(t); };
	convertOp = function(dst, src) {
		var _1, _2, _3, _4, _5, _6, _7, _arg, _arg$1, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _v, _v$1, _v$2, dst, src, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _2 = $f._2; _3 = $f._3; _4 = $f._4; _5 = $f._5; _6 = $f._6; _7 = $f._7; _arg = $f._arg; _arg$1 = $f._arg$1; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _v = $f._v; _v$1 = $f._v$1; _v$2 = $f._v$2; dst = $f.dst; src = $f.src; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_1 = src.Kind();
			/* */ if ((_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6))) { $s = 2; continue; }
			/* */ if ((_1 === (7)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (12))) { $s = 3; continue; }
			/* */ if ((_1 === (13)) || (_1 === (14))) { $s = 4; continue; }
			/* */ if ((_1 === (15)) || (_1 === (16))) { $s = 5; continue; }
			/* */ if (_1 === (24)) { $s = 6; continue; }
			/* */ if (_1 === (23)) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if ((_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6))) { */ case 2:
				_2 = dst.Kind();
				if ((_2 === (2)) || (_2 === (3)) || (_2 === (4)) || (_2 === (5)) || (_2 === (6)) || (_2 === (7)) || (_2 === (8)) || (_2 === (9)) || (_2 === (10)) || (_2 === (11)) || (_2 === (12))) {
					$s = -1; return cvtInt;
				} else if ((_2 === (13)) || (_2 === (14))) {
					$s = -1; return cvtIntFloat;
				} else if (_2 === (24)) {
					$s = -1; return cvtIntString;
				}
				$s = 8; continue;
			/* } else if ((_1 === (7)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (12))) { */ case 3:
				_3 = dst.Kind();
				if ((_3 === (2)) || (_3 === (3)) || (_3 === (4)) || (_3 === (5)) || (_3 === (6)) || (_3 === (7)) || (_3 === (8)) || (_3 === (9)) || (_3 === (10)) || (_3 === (11)) || (_3 === (12))) {
					$s = -1; return cvtUint;
				} else if ((_3 === (13)) || (_3 === (14))) {
					$s = -1; return cvtUintFloat;
				} else if (_3 === (24)) {
					$s = -1; return cvtUintString;
				}
				$s = 8; continue;
			/* } else if ((_1 === (13)) || (_1 === (14))) { */ case 4:
				_4 = dst.Kind();
				if ((_4 === (2)) || (_4 === (3)) || (_4 === (4)) || (_4 === (5)) || (_4 === (6))) {
					$s = -1; return cvtFloatInt;
				} else if ((_4 === (7)) || (_4 === (8)) || (_4 === (9)) || (_4 === (10)) || (_4 === (11)) || (_4 === (12))) {
					$s = -1; return cvtFloatUint;
				} else if ((_4 === (13)) || (_4 === (14))) {
					$s = -1; return cvtFloat;
				}
				$s = 8; continue;
			/* } else if ((_1 === (15)) || (_1 === (16))) { */ case 5:
				_5 = dst.Kind();
				if ((_5 === (15)) || (_5 === (16))) {
					$s = -1; return cvtComplex;
				}
				$s = 8; continue;
			/* } else if (_1 === (24)) { */ case 6:
				if (!(dst.Kind() === 23)) { _v = false; $s = 11; continue s; }
				_r = dst.Elem().PkgPath(); /* */ $s = 12; case 12: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_v = _r === ""; case 11:
				/* */ if (_v) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if (_v) { */ case 9:
						_r$1 = dst.Elem().Kind(); /* */ $s = 14; case 14: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						_6 = _r$1;
						if (_6 === (8)) {
							$s = -1; return cvtStringBytes;
						} else if (_6 === (5)) {
							$s = -1; return cvtStringRunes;
						}
					case 13:
				/* } */ case 10:
				$s = 8; continue;
			/* } else if (_1 === (23)) { */ case 7:
				if (!(dst.Kind() === 24)) { _v$1 = false; $s = 17; continue s; }
				_r$2 = src.Elem().PkgPath(); /* */ $s = 18; case 18: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v$1 = _r$2 === ""; case 17:
				/* */ if (_v$1) { $s = 15; continue; }
				/* */ $s = 16; continue;
				/* if (_v$1) { */ case 15:
						_r$3 = src.Elem().Kind(); /* */ $s = 20; case 20: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
						_7 = _r$3;
						if (_7 === (8)) {
							$s = -1; return cvtBytesString;
						} else if (_7 === (5)) {
							$s = -1; return cvtRunesString;
						}
					case 19:
				/* } */ case 16:
			/* } */ case 8:
		case 1:
		_r$4 = haveIdenticalUnderlyingType(dst, src, false); /* */ $s = 23; case 23: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		/* */ if (_r$4) { $s = 21; continue; }
		/* */ $s = 22; continue;
		/* if (_r$4) { */ case 21:
			$s = -1; return cvtDirect;
		/* } */ case 22:
		if (!((dst.Kind() === 22) && dst.Name() === "" && (src.Kind() === 22) && src.Name() === "")) { _v$2 = false; $s = 26; continue s; }
		_r$5 = dst.Elem().common(); /* */ $s = 27; case 27: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		_arg = _r$5;
		_r$6 = src.Elem().common(); /* */ $s = 28; case 28: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		_arg$1 = _r$6;
		_r$7 = haveIdenticalUnderlyingType(_arg, _arg$1, false); /* */ $s = 29; case 29: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
		_v$2 = _r$7; case 26:
		/* */ if (_v$2) { $s = 24; continue; }
		/* */ $s = 25; continue;
		/* if (_v$2) { */ case 24:
			$s = -1; return cvtDirect;
		/* } */ case 25:
		if (implements$1(dst, src)) {
			if (src.Kind() === 20) {
				$s = -1; return cvtI2I;
			}
			$s = -1; return cvtT2I;
		}
		$s = -1; return $throwNilPointerError;
		/* */ } return; } if ($f === undefined) { $f = { $blk: convertOp }; } $f._1 = _1; $f._2 = _2; $f._3 = _3; $f._4 = _4; $f._5 = _5; $f._6 = _6; $f._7 = _7; $f._arg = _arg; $f._arg$1 = _arg$1; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._v = _v; $f._v$1 = _v$1; $f._v$2 = _v$2; $f.dst = dst; $f.src = src; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeFloat = function(f, v, t) {
		var _1, _r, f, ptr, t, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r = $f._r; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_1 = typ.size;
		if (_1 === (4)) {
			(ptr).$set(($fround(v)));
		} else if (_1 === (8)) {
			(ptr).$set(v);
		}
		$s = -1; return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | ((typ.Kind() >>> 0))) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeFloat }; } $f._1 = _1; $f._r = _r; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeComplex = function(f, v, t) {
		var _1, _r, f, ptr, t, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r = $f._r; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_1 = typ.size;
		if (_1 === (8)) {
			(ptr).$set((new $Complex64(v.$real, v.$imag)));
		} else if (_1 === (16)) {
			(ptr).$set(v);
		}
		$s = -1; return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | ((typ.Kind() >>> 0))) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeComplex }; } $f._1 = _1; $f._r = _r; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeString = function(f, v, t) {
		var _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = $clone(_r, Value).Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		$clone(ret, Value).SetString(v);
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		$s = -1; return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeString }; } $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeBytes = function(f, v, t) {
		var _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = $clone(_r, Value).Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		$r = $clone(ret, Value).SetBytes(v); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		$s = -1; return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeBytes }; } $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeRunes = function(f, v, t) {
		var _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = $clone(_r, Value).Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		$r = $clone(ret, Value).setRunes(v); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		$s = -1; return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeRunes }; } $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtInt = function(v, t) {
		var _r, t, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeInt((v.flag & 96) >>> 0, ((x = $clone(v, Value).Int(), new $Uint64(x.$high, x.$low))), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtInt }; } $f._r = _r; $f.t = t; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUint = function(v, t) {
		var _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeInt((v.flag & 96) >>> 0, $clone(v, Value).Uint(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUint }; } $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloatInt = function(v, t) {
		var _r, t, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeInt((v.flag & 96) >>> 0, ((x = (new $Int64(0, $clone(v, Value).Float())), new $Uint64(x.$high, x.$low))), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloatInt }; } $f._r = _r; $f.t = t; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloatUint = function(v, t) {
		var _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeInt((v.flag & 96) >>> 0, (new $Uint64(0, $clone(v, Value).Float())), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloatUint }; } $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtIntFloat = function(v, t) {
		var _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeFloat((v.flag & 96) >>> 0, ($flatten64($clone(v, Value).Int())), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtIntFloat }; } $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUintFloat = function(v, t) {
		var _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeFloat((v.flag & 96) >>> 0, ($flatten64($clone(v, Value).Uint())), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUintFloat }; } $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloat = function(v, t) {
		var _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeFloat((v.flag & 96) >>> 0, $clone(v, Value).Float(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloat }; } $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtComplex = function(v, t) {
		var _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeComplex((v.flag & 96) >>> 0, $clone(v, Value).Complex(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtComplex }; } $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtIntString = function(v, t) {
		var _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeString((v.flag & 96) >>> 0, ($encodeRune($clone(v, Value).Int().$low)), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtIntString }; } $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUintString = function(v, t) {
		var _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeString((v.flag & 96) >>> 0, ($encodeRune($clone(v, Value).Uint().$low)), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUintString }; } $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtBytesString = function(v, t) {
		var _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_arg = (v.flag & 96) >>> 0;
		_r = $clone(v, Value).Bytes(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = ($bytesToString(_r));
		_arg$2 = t;
		_r$1 = makeString(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtBytesString }; } $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtStringBytes = function(v, t) {
		var _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_arg = (v.flag & 96) >>> 0;
		_r = $clone(v, Value).String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = (new sliceType$15($stringToBytes(_r)));
		_arg$2 = t;
		_r$1 = makeBytes(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtStringBytes }; } $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtRunesString = function(v, t) {
		var _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_arg = (v.flag & 96) >>> 0;
		_r = $clone(v, Value).runes(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = ($runesToString(_r));
		_arg$2 = t;
		_r$1 = makeString(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtRunesString }; } $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtStringRunes = function(v, t) {
		var _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_arg = (v.flag & 96) >>> 0;
		_r = $clone(v, Value).String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = (new sliceType$17($stringToRunes(_r)));
		_arg$2 = t;
		_r$1 = makeRunes(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtStringRunes }; } $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtT2I = function(v, typ) {
		var _r, _r$1, _r$2, _r$3, _r$4, target, typ, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; target = $f.target; typ = $f.typ; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = typ.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = unsafe_New(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		target = _r$1;
		_r$2 = valueInterface($clone(v, Value), false); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		x = _r$2;
		_r$3 = typ.NumMethod(); /* */ $s = 7; case 7: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		/* */ if (_r$3 === 0) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (_r$3 === 0) { */ case 4:
			(target).$set(x);
			$s = 6; continue;
		/* } else { */ case 5:
			ifaceE2I($assertType(typ, ptrType$1), x, target);
		/* } */ case 6:
		_r$4 = typ.common(); /* */ $s = 8; case 8: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r$4, target, (((((v.flag & 96) >>> 0) | 128) >>> 0) | 20) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtT2I }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.target = target; $f.typ = typ; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtI2I = function(v, typ) {
		var _r, _r$1, _r$2, ret, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; ret = $f.ret; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ if ($clone(v, Value).IsNil()) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ($clone(v, Value).IsNil()) { */ case 1:
			_r = Zero(typ); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			ret = _r;
			ret.flag = (ret.flag | (((v.flag & 96) >>> 0))) >>> 0;
			$s = -1; return ret;
		/* } */ case 2:
		_r$1 = $clone(v, Value).Elem(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = cvtT2I($clone(_r$1, Value), typ); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtI2I }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.ret = ret; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	ptrType$5.methods = [{prop: "methods", name: "methods", pkg: "reflect", typ: $funcType([], [sliceType$5], false)}];
	ptrType$16.methods = [{prop: "in$", name: "in", pkg: "reflect", typ: $funcType([], [sliceType$2], false)}, {prop: "out", name: "out", pkg: "reflect", typ: $funcType([], [sliceType$2], false)}];
	name.methods = [{prop: "name", name: "name", pkg: "reflect", typ: $funcType([], [$String], false)}, {prop: "tag", name: "tag", pkg: "reflect", typ: $funcType([], [$String], false)}, {prop: "pkgPath", name: "pkgPath", pkg: "reflect", typ: $funcType([], [$String], false)}, {prop: "isExported", name: "isExported", pkg: "reflect", typ: $funcType([], [$Bool], false)}, {prop: "data", name: "data", pkg: "reflect", typ: $funcType([$Int], [ptrType$4], false)}, {prop: "nameLen", name: "nameLen", pkg: "reflect", typ: $funcType([], [$Int], false)}, {prop: "tagLen", name: "tagLen", pkg: "reflect", typ: $funcType([], [$Int], false)}];
	Kind.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$1.methods = [{prop: "uncommon", name: "uncommon", pkg: "reflect", typ: $funcType([], [ptrType$5], false)}, {prop: "nameOff", name: "nameOff", pkg: "reflect", typ: $funcType([nameOff], [name], false)}, {prop: "typeOff", name: "typeOff", pkg: "reflect", typ: $funcType([typeOff], [ptrType$1], false)}, {prop: "ptrTo", name: "ptrTo", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "pointers", name: "pointers", pkg: "reflect", typ: $funcType([], [$Bool], false)}, {prop: "Comparable", name: "Comparable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "textOff", name: "textOff", pkg: "reflect", typ: $funcType([textOff], [$UnsafePointer], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "Bits", name: "Bits", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Align", name: "Align", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "FieldAlign", name: "FieldAlign", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "common", name: "common", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "exportedMethods", name: "exportedMethods", pkg: "reflect", typ: $funcType([], [sliceType$5], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChanDir", name: "ChanDir", pkg: "", typ: $funcType([], [ChanDir], false)}, {prop: "IsVariadic", name: "IsVariadic", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$13], [StructField], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "Key", name: "Key", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumIn", name: "NumIn", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumOut", name: "NumOut", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Out", name: "Out", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "Implements", name: "Implements", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "AssignableTo", name: "AssignableTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "ConvertibleTo", name: "ConvertibleTo", pkg: "", typ: $funcType([Type], [$Bool], false)}];
	ChanDir.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$7.methods = [{prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}];
	ptrType$17.methods = [{prop: "offset", name: "offset", pkg: "reflect", typ: $funcType([], [$Uintptr], false)}, {prop: "anon", name: "anon", pkg: "reflect", typ: $funcType([], [$Bool], false)}];
	ptrType$9.methods = [{prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$13], [StructField], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}];
	StructTag.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "Lookup", name: "Lookup", pkg: "", typ: $funcType([$String], [$String, $Bool], false)}];
	Value.methods = [{prop: "object", name: "object", pkg: "reflect", typ: $funcType([], [ptrType$2], false)}, {prop: "call", name: "call", pkg: "reflect", typ: $funcType([$String, sliceType$9], [sliceType$9], false)}, {prop: "Cap", name: "Cap", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Value], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "InterfaceData", name: "InterfaceData", pkg: "", typ: $funcType([], [arrayType$12], false)}, {prop: "IsNil", name: "IsNil", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Pointer", name: "Pointer", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([Value], [], false)}, {prop: "SetBytes", name: "SetBytes", pkg: "", typ: $funcType([sliceType$15], [], false)}, {prop: "SetCap", name: "SetCap", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "SetLen", name: "SetLen", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Slice", name: "Slice", pkg: "", typ: $funcType([$Int, $Int], [Value], false)}, {prop: "Slice3", name: "Slice3", pkg: "", typ: $funcType([$Int, $Int, $Int], [Value], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [], false)}, {prop: "pointer", name: "pointer", pkg: "reflect", typ: $funcType([], [$UnsafePointer], false)}, {prop: "Addr", name: "Addr", pkg: "", typ: $funcType([], [Value], false)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Bytes", name: "Bytes", pkg: "", typ: $funcType([], [sliceType$15], false)}, {prop: "runes", name: "runes", pkg: "reflect", typ: $funcType([], [sliceType$17], false)}, {prop: "CanAddr", name: "CanAddr", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "CanSet", name: "CanSet", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([sliceType$9], [sliceType$9], false)}, {prop: "CallSlice", name: "CallSlice", pkg: "", typ: $funcType([sliceType$9], [sliceType$9], false)}, {prop: "Complex", name: "Complex", pkg: "", typ: $funcType([], [$Complex128], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$13], [Value], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [Value], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [Value], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "CanInterface", name: "CanInterface", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "IsValid", name: "IsValid", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "MapIndex", name: "MapIndex", pkg: "", typ: $funcType([Value], [Value], false)}, {prop: "MapKeys", name: "MapKeys", pkg: "", typ: $funcType([], [sliceType$9], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Value], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "OverflowComplex", name: "OverflowComplex", pkg: "", typ: $funcType([$Complex128], [$Bool], false)}, {prop: "OverflowFloat", name: "OverflowFloat", pkg: "", typ: $funcType([$Float64], [$Bool], false)}, {prop: "OverflowInt", name: "OverflowInt", pkg: "", typ: $funcType([$Int64], [$Bool], false)}, {prop: "OverflowUint", name: "OverflowUint", pkg: "", typ: $funcType([$Uint64], [$Bool], false)}, {prop: "Recv", name: "Recv", pkg: "", typ: $funcType([], [Value, $Bool], false)}, {prop: "recv", name: "recv", pkg: "reflect", typ: $funcType([$Bool], [Value, $Bool], false)}, {prop: "Send", name: "Send", pkg: "", typ: $funcType([Value], [], false)}, {prop: "send", name: "send", pkg: "reflect", typ: $funcType([Value, $Bool], [$Bool], false)}, {prop: "SetBool", name: "SetBool", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "setRunes", name: "setRunes", pkg: "reflect", typ: $funcType([sliceType$17], [], false)}, {prop: "SetComplex", name: "SetComplex", pkg: "", typ: $funcType([$Complex128], [], false)}, {prop: "SetFloat", name: "SetFloat", pkg: "", typ: $funcType([$Float64], [], false)}, {prop: "SetInt", name: "SetInt", pkg: "", typ: $funcType([$Int64], [], false)}, {prop: "SetMapIndex", name: "SetMapIndex", pkg: "", typ: $funcType([Value, Value], [], false)}, {prop: "SetUint", name: "SetUint", pkg: "", typ: $funcType([$Uint64], [], false)}, {prop: "SetPointer", name: "SetPointer", pkg: "", typ: $funcType([$UnsafePointer], [], false)}, {prop: "SetString", name: "SetString", pkg: "", typ: $funcType([$String], [], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "TryRecv", name: "TryRecv", pkg: "", typ: $funcType([], [Value, $Bool], false)}, {prop: "TrySend", name: "TrySend", pkg: "", typ: $funcType([Value], [$Bool], false)}, {prop: "Type", name: "Type", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Uint", name: "Uint", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "UnsafeAddr", name: "UnsafeAddr", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "assignTo", name: "assignTo", pkg: "reflect", typ: $funcType([$String, ptrType$1, $UnsafePointer], [Value], false)}, {prop: "Convert", name: "Convert", pkg: "", typ: $funcType([Type], [Value], false)}];
	flag.methods = [{prop: "kind", name: "kind", pkg: "reflect", typ: $funcType([], [Kind], false)}, {prop: "mustBe", name: "mustBe", pkg: "reflect", typ: $funcType([Kind], [], false)}, {prop: "mustBeExported", name: "mustBeExported", pkg: "reflect", typ: $funcType([], [], false)}, {prop: "mustBeAssignable", name: "mustBeAssignable", pkg: "reflect", typ: $funcType([], [], false)}];
	ptrType$18.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	uncommonType.init("reflect", [{prop: "pkgPath", name: "pkgPath", anonymous: false, exported: false, typ: nameOff, tag: ""}, {prop: "mcount", name: "mcount", anonymous: false, exported: false, typ: $Uint16, tag: ""}, {prop: "_$2", name: "_", anonymous: false, exported: false, typ: $Uint16, tag: ""}, {prop: "moff", name: "moff", anonymous: false, exported: false, typ: $Uint32, tag: ""}, {prop: "_$4", name: "_", anonymous: false, exported: false, typ: $Uint32, tag: ""}, {prop: "_methods", name: "_methods", anonymous: false, exported: false, typ: sliceType$5, tag: ""}]);
	funcType.init("reflect", [{prop: "rtype", name: "rtype", anonymous: true, exported: false, typ: rtype, tag: "reflect:\"func\""}, {prop: "inCount", name: "inCount", anonymous: false, exported: false, typ: $Uint16, tag: ""}, {prop: "outCount", name: "outCount", anonymous: false, exported: false, typ: $Uint16, tag: ""}, {prop: "_in", name: "_in", anonymous: false, exported: false, typ: sliceType$2, tag: ""}, {prop: "_out", name: "_out", anonymous: false, exported: false, typ: sliceType$2, tag: ""}]);
	name.init("reflect", [{prop: "bytes", name: "bytes", anonymous: false, exported: false, typ: ptrType$4, tag: ""}]);
	nameData.init("reflect", [{prop: "name", name: "name", anonymous: false, exported: false, typ: $String, tag: ""}, {prop: "tag", name: "tag", anonymous: false, exported: false, typ: $String, tag: ""}, {prop: "pkgPath", name: "pkgPath", anonymous: false, exported: false, typ: $String, tag: ""}, {prop: "exported", name: "exported", anonymous: false, exported: false, typ: $Bool, tag: ""}]);
	mapIter.init("reflect", [{prop: "t", name: "t", anonymous: false, exported: false, typ: Type, tag: ""}, {prop: "m", name: "m", anonymous: false, exported: false, typ: ptrType$2, tag: ""}, {prop: "keys", name: "keys", anonymous: false, exported: false, typ: ptrType$2, tag: ""}, {prop: "i", name: "i", anonymous: false, exported: false, typ: $Int, tag: ""}]);
	Type.init([{prop: "Align", name: "Align", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "AssignableTo", name: "AssignableTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "Bits", name: "Bits", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ChanDir", name: "ChanDir", pkg: "", typ: $funcType([], [ChanDir], false)}, {prop: "Comparable", name: "Comparable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "ConvertibleTo", name: "ConvertibleTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldAlign", name: "FieldAlign", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$13], [StructField], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "Implements", name: "Implements", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "IsVariadic", name: "IsVariadic", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Key", name: "Key", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumIn", name: "NumIn", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumOut", name: "NumOut", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Out", name: "Out", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "common", name: "common", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "uncommon", name: "uncommon", pkg: "reflect", typ: $funcType([], [ptrType$5], false)}]);
	rtype.init("reflect", [{prop: "size", name: "size", anonymous: false, exported: false, typ: $Uintptr, tag: ""}, {prop: "ptrdata", name: "ptrdata", anonymous: false, exported: false, typ: $Uintptr, tag: ""}, {prop: "hash", name: "hash", anonymous: false, exported: false, typ: $Uint32, tag: ""}, {prop: "tflag", name: "tflag", anonymous: false, exported: false, typ: tflag, tag: ""}, {prop: "align", name: "align", anonymous: false, exported: false, typ: $Uint8, tag: ""}, {prop: "fieldAlign", name: "fieldAlign", anonymous: false, exported: false, typ: $Uint8, tag: ""}, {prop: "kind", name: "kind", anonymous: false, exported: false, typ: $Uint8, tag: ""}, {prop: "alg", name: "alg", anonymous: false, exported: false, typ: ptrType$3, tag: ""}, {prop: "gcdata", name: "gcdata", anonymous: false, exported: false, typ: ptrType$4, tag: ""}, {prop: "str", name: "str", anonymous: false, exported: false, typ: nameOff, tag: ""}, {prop: "ptrToThis", name: "ptrToThis", anonymous: false, exported: false, typ: typeOff, tag: ""}]);
	typeAlg.init("reflect", [{prop: "hash", name: "hash", anonymous: false, exported: false, typ: funcType$4, tag: ""}, {prop: "equal", name: "equal", anonymous: false, exported: false, typ: funcType$5, tag: ""}]);
	method.init("reflect", [{prop: "name", name: "name", anonymous: false, exported: false, typ: nameOff, tag: ""}, {prop: "mtyp", name: "mtyp", anonymous: false, exported: false, typ: typeOff, tag: ""}, {prop: "ifn", name: "ifn", anonymous: false, exported: false, typ: textOff, tag: ""}, {prop: "tfn", name: "tfn", anonymous: false, exported: false, typ: textOff, tag: ""}]);
	arrayType.init("reflect", [{prop: "rtype", name: "rtype", anonymous: true, exported: false, typ: rtype, tag: "reflect:\"array\""}, {prop: "elem", name: "elem", anonymous: false, exported: false, typ: ptrType$1, tag: ""}, {prop: "slice", name: "slice", anonymous: false, exported: false, typ: ptrType$1, tag: ""}, {prop: "len", name: "len", anonymous: false, exported: false, typ: $Uintptr, tag: ""}]);
	chanType.init("reflect", [{prop: "rtype", name: "rtype", anonymous: true, exported: false, typ: rtype, tag: "reflect:\"chan\""}, {prop: "elem", name: "elem", anonymous: false, exported: false, typ: ptrType$1, tag: ""}, {prop: "dir", name: "dir", anonymous: false, exported: false, typ: $Uintptr, tag: ""}]);
	imethod.init("reflect", [{prop: "name", name: "name", anonymous: false, exported: false, typ: nameOff, tag: ""}, {prop: "typ", name: "typ", anonymous: false, exported: false, typ: typeOff, tag: ""}]);
	interfaceType.init("reflect", [{prop: "rtype", name: "rtype", anonymous: true, exported: false, typ: rtype, tag: "reflect:\"interface\""}, {prop: "pkgPath", name: "pkgPath", anonymous: false, exported: false, typ: name, tag: ""}, {prop: "methods", name: "methods", anonymous: false, exported: false, typ: sliceType$6, tag: ""}]);
	mapType.init("reflect", [{prop: "rtype", name: "rtype", anonymous: true, exported: false, typ: rtype, tag: "reflect:\"map\""}, {prop: "key", name: "key", anonymous: false, exported: false, typ: ptrType$1, tag: ""}, {prop: "elem", name: "elem", anonymous: false, exported: false, typ: ptrType$1, tag: ""}, {prop: "bucket", name: "bucket", anonymous: false, exported: false, typ: ptrType$1, tag: ""}, {prop: "hmap", name: "hmap", anonymous: false, exported: false, typ: ptrType$1, tag: ""}, {prop: "keysize", name: "keysize", anonymous: false, exported: false, typ: $Uint8, tag: ""}, {prop: "indirectkey", name: "indirectkey", anonymous: false, exported: false, typ: $Uint8, tag: ""}, {prop: "valuesize", name: "valuesize", anonymous: false, exported: false, typ: $Uint8, tag: ""}, {prop: "indirectvalue", name: "indirectvalue", anonymous: false, exported: false, typ: $Uint8, tag: ""}, {prop: "bucketsize", name: "bucketsize", anonymous: false, exported: false, typ: $Uint16, tag: ""}, {prop: "reflexivekey", name: "reflexivekey", anonymous: false, exported: false, typ: $Bool, tag: ""}, {prop: "needkeyupdate", name: "needkeyupdate", anonymous: false, exported: false, typ: $Bool, tag: ""}]);
	ptrType.init("reflect", [{prop: "rtype", name: "rtype", anonymous: true, exported: false, typ: rtype, tag: "reflect:\"ptr\""}, {prop: "elem", name: "elem", anonymous: false, exported: false, typ: ptrType$1, tag: ""}]);
	sliceType.init("reflect", [{prop: "rtype", name: "rtype", anonymous: true, exported: false, typ: rtype, tag: "reflect:\"slice\""}, {prop: "elem", name: "elem", anonymous: false, exported: false, typ: ptrType$1, tag: ""}]);
	structField.init("reflect", [{prop: "name", name: "name", anonymous: false, exported: false, typ: name, tag: ""}, {prop: "typ", name: "typ", anonymous: false, exported: false, typ: ptrType$1, tag: ""}, {prop: "offsetAnon", name: "offsetAnon", anonymous: false, exported: false, typ: $Uintptr, tag: ""}]);
	structType.init("reflect", [{prop: "rtype", name: "rtype", anonymous: true, exported: false, typ: rtype, tag: "reflect:\"struct\""}, {prop: "pkgPath", name: "pkgPath", anonymous: false, exported: false, typ: name, tag: ""}, {prop: "fields", name: "fields", anonymous: false, exported: false, typ: sliceType$7, tag: ""}]);
	Method.init("", [{prop: "Name", name: "Name", anonymous: false, exported: true, typ: $String, tag: ""}, {prop: "PkgPath", name: "PkgPath", anonymous: false, exported: true, typ: $String, tag: ""}, {prop: "Type", name: "Type", anonymous: false, exported: true, typ: Type, tag: ""}, {prop: "Func", name: "Func", anonymous: false, exported: true, typ: Value, tag: ""}, {prop: "Index", name: "Index", anonymous: false, exported: true, typ: $Int, tag: ""}]);
	StructField.init("", [{prop: "Name", name: "Name", anonymous: false, exported: true, typ: $String, tag: ""}, {prop: "PkgPath", name: "PkgPath", anonymous: false, exported: true, typ: $String, tag: ""}, {prop: "Type", name: "Type", anonymous: false, exported: true, typ: Type, tag: ""}, {prop: "Tag", name: "Tag", anonymous: false, exported: true, typ: StructTag, tag: ""}, {prop: "Offset", name: "Offset", anonymous: false, exported: true, typ: $Uintptr, tag: ""}, {prop: "Index", name: "Index", anonymous: false, exported: true, typ: sliceType$13, tag: ""}, {prop: "Anonymous", name: "Anonymous", anonymous: false, exported: true, typ: $Bool, tag: ""}]);
	fieldScan.init("reflect", [{prop: "typ", name: "typ", anonymous: false, exported: false, typ: ptrType$9, tag: ""}, {prop: "index", name: "index", anonymous: false, exported: false, typ: sliceType$13, tag: ""}]);
	Value.init("reflect", [{prop: "typ", name: "typ", anonymous: false, exported: false, typ: ptrType$1, tag: ""}, {prop: "ptr", name: "ptr", anonymous: false, exported: false, typ: $UnsafePointer, tag: ""}, {prop: "flag", name: "flag", anonymous: true, exported: false, typ: flag, tag: ""}]);
	ValueError.init("", [{prop: "Method", name: "Method", anonymous: false, exported: true, typ: $String, tag: ""}, {prop: "Kind", name: "Kind", anonymous: false, exported: true, typ: Kind, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		nameOffList = sliceType$1.nil;
		typeOffList = sliceType$2.nil;
		methodCache = new sync.Map.ptr(new sync.Mutex.ptr(0, 0), new $packages["sync/atomic"].Value.ptr(new $packages["sync/atomic"].noCopy.ptr(), $ifaceNil), false, 0);
		initialized = false;
		uncommonTypeMap = {};
		nameMap = {};
		callHelper = $assertType($internalize($call, $emptyInterface), funcType$1);
		selectHelper = $assertType($internalize($select, $emptyInterface), funcType$1);
		jsObjectPtr = reflectType($jsObjectPtr);
		kindNames = new sliceType$4(["invalid", "bool", "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "float32", "float64", "complex64", "complex128", "array", "chan", "func", "interface", "map", "ptr", "slice", "string", "struct", "unsafe.Pointer"]);
		uint8Type = $assertType(TypeOf(new $Uint8(0)), ptrType$1);
		$r = init(); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strings"] = (function() {
	var $pkg = {}, $init, errors, js, io, unicode, utf8, sliceType, IndexByte, Index, ContainsRune, IndexRune, Join, Map, ToUpper;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	io = $packages["io"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	sliceType = $sliceType($Uint8);
	IndexByte = function(s, c) {
		var c, s;
		return $parseInt(s.indexOf($global.String.fromCharCode(c))) >> 0;
	};
	$pkg.IndexByte = IndexByte;
	Index = function(s, sep) {
		var s, sep;
		return $parseInt(s.indexOf(sep)) >> 0;
	};
	$pkg.Index = Index;
	ContainsRune = function(s, r) {
		var r, s;
		return IndexRune(s, r) >= 0;
	};
	$pkg.ContainsRune = ContainsRune;
	IndexRune = function(s, r) {
		var _i, _ref, _rune, i, r, r$1, s;
		if (0 <= r && r < 128) {
			return IndexByte(s, ((r << 24 >>> 24)));
		} else if ((r === 65533)) {
			_ref = s;
			_i = 0;
			while (true) {
				if (!(_i < _ref.length)) { break; }
				_rune = $decodeRune(_ref, _i);
				i = _i;
				r$1 = _rune[0];
				if (r$1 === 65533) {
					return i;
				}
				_i += _rune[1];
			}
			return -1;
		} else if (!utf8.ValidRune(r)) {
			return -1;
		} else {
			return Index(s, ($encodeRune(r)));
		}
	};
	$pkg.IndexRune = IndexRune;
	Join = function(a, sep) {
		var _1, _i, _ref, a, b, bp, i, n, s, sep;
		_1 = a.$length;
		if (_1 === (0)) {
			return "";
		} else if (_1 === (1)) {
			return (0 >= a.$length ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + 0]);
		} else if (_1 === (2)) {
			return (0 >= a.$length ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + 0]) + sep + (1 >= a.$length ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + 1]);
		} else if (_1 === (3)) {
			return (0 >= a.$length ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + 0]) + sep + (1 >= a.$length ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + 1]) + sep + (2 >= a.$length ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + 2]);
		}
		n = $imul(sep.length, ((a.$length - 1 >> 0)));
		i = 0;
		while (true) {
			if (!(i < a.$length)) { break; }
			n = n + (((i < 0 || i >= a.$length) ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + i]).length) >> 0;
			i = i + (1) >> 0;
		}
		b = $makeSlice(sliceType, n);
		bp = $copyString(b, (0 >= a.$length ? ($throwRuntimeError("index out of range"), undefined) : a.$array[a.$offset + 0]));
		_ref = $subslice(a, 1);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			s = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			bp = bp + ($copyString($subslice(b, bp), sep)) >> 0;
			bp = bp + ($copyString($subslice(b, bp), s)) >> 0;
			_i++;
		}
		return ($bytesToString(b));
	};
	$pkg.Join = Join;
	Map = function(mapping, s) {
		var _i, _i$1, _r, _r$1, _ref, _ref$1, _rune, _rune$1, _tuple, b, c, c$1, i, mapping, nb, nbytes, r, r$1, s, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _ref$1 = $f._ref$1; _rune = $f._rune; _rune$1 = $f._rune$1; _tuple = $f._tuple; b = $f.b; c = $f.c; c$1 = $f.c$1; i = $f.i; mapping = $f.mapping; nb = $f.nb; nbytes = $f.nbytes; r = $f.r; r$1 = $f.r$1; s = $f.s; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		b = sliceType.nil;
		nbytes = 0;
		_ref = s;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.length)) { break; } */ if(!(_i < _ref.length)) { $s = 2; continue; }
			_rune = $decodeRune(_ref, _i);
			i = _i;
			c = _rune[0];
			_r = mapping(c); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			r = _r;
			if (r === c) {
				_i += _rune[1];
				/* continue; */ $s = 1; continue;
			}
			b = $makeSlice(sliceType, (s.length + 4 >> 0));
			nbytes = $copyString(b, $substring(s, 0, i));
			if (r >= 0) {
				if (r <= 128) {
					((nbytes < 0 || nbytes >= b.$length) ? ($throwRuntimeError("index out of range"), undefined) : b.$array[b.$offset + nbytes] = ((r << 24 >>> 24)));
					nbytes = nbytes + (1) >> 0;
				} else {
					nbytes = nbytes + (utf8.EncodeRune($subslice(b, nbytes), r)) >> 0;
				}
			}
			if (c === 65533) {
				_tuple = utf8.DecodeRuneInString($substring(s, i));
				w = _tuple[1];
				i = i + (w) >> 0;
			} else {
				i = i + (utf8.RuneLen(c)) >> 0;
			}
			s = $substring(s, i);
			/* break; */ $s = 2; continue;
		/* } */ $s = 1; continue; case 2:
		if (b === sliceType.nil) {
			$s = -1; return s;
		}
		_ref$1 = s;
		_i$1 = 0;
		/* while (true) { */ case 4:
			/* if (!(_i$1 < _ref$1.length)) { break; } */ if(!(_i$1 < _ref$1.length)) { $s = 5; continue; }
			_rune$1 = $decodeRune(_ref$1, _i$1);
			c$1 = _rune$1[0];
			_r$1 = mapping(c$1); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			r$1 = _r$1;
			if ((0 <= r$1 && r$1 <= 128) && nbytes < b.$length) {
				((nbytes < 0 || nbytes >= b.$length) ? ($throwRuntimeError("index out of range"), undefined) : b.$array[b.$offset + nbytes] = ((r$1 << 24 >>> 24)));
				nbytes = nbytes + (1) >> 0;
				_i$1 += _rune$1[1];
				/* continue; */ $s = 4; continue;
			}
			if (r$1 >= 0) {
				if ((nbytes + 4 >> 0) >= b.$length) {
					nb = $makeSlice(sliceType, ($imul(2, b.$length)));
					$copySlice(nb, $subslice(b, 0, nbytes));
					b = nb;
				}
				nbytes = nbytes + (utf8.EncodeRune($subslice(b, nbytes), r$1)) >> 0;
			}
			_i$1 += _rune$1[1];
		/* } */ $s = 4; continue; case 5:
		$s = -1; return ($bytesToString($subslice(b, 0, nbytes)));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Map }; } $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._ref$1 = _ref$1; $f._rune = _rune; $f._rune$1 = _rune$1; $f._tuple = _tuple; $f.b = b; $f.c = c; $f.c$1 = c$1; $f.i = i; $f.mapping = mapping; $f.nb = nb; $f.nbytes = nbytes; $f.r = r; $f.r$1 = r$1; $f.s = s; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Map = Map;
	ToUpper = function(s) {
		var _r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = Map(unicode.ToUpper, s); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ToUpper }; } $f._r = _r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ToUpper = ToUpper;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/cathalgarvey/fmtless"] = (function() {
	var $pkg = {}, $init, errors, reflect, strconv, strings, sprintMatch, sliceType, sliceType$1, sliceType$2, sliceType$3, Errorf, Sprintf, splitFmtSpecs, getSpec, fmtI, fmtBytes, fmtString, fmtUEscape, fmtInt, fmtFloat, SRepeat;
	errors = $packages["errors"];
	reflect = $packages["reflect"];
	strconv = $packages["strconv"];
	strings = $packages["strings"];
	sprintMatch = $pkg.sprintMatch = $newType(0, $kindStruct, "fmt.sprintMatch", true, "github.com/cathalgarvey/fmtless", false, function(before_, spec_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.before = "";
			this.spec = "";
			return;
		}
		this.before = before_;
		this.spec = spec_;
	});
	sliceType = $sliceType($Uint8);
	sliceType$1 = $sliceType($String);
	sliceType$2 = $sliceType($emptyInterface);
	sliceType$3 = $sliceType(sprintMatch);
	Errorf = function(format, a) {
		var _r, _r$1, a, format, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; a = $f.a; format = $f.format; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = Sprintf(format, a); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = errors.New(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Errorf }; } $f._r = _r; $f._r$1 = _r$1; $f.a = a; $f.format = format; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Errorf = Errorf;
	Sprintf = function(fmts, args) {
		var _i, _r, _ref, args, bits, fmlist, fmts, i, idx, sm, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _r = $f._r; _ref = $f._ref; args = $f.args; bits = $f.bits; fmlist = $f.fmlist; fmts = $f.fmts; i = $f.i; idx = $f.idx; sm = $f.sm; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		bits = sliceType$1.nil;
		fmlist = splitFmtSpecs(fmts);
		_ref = fmlist;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			idx = _i;
			sm = $clone(((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]), sprintMatch);
			i = $ifaceNil;
			i = $ifaceNil;
			if (idx < args.$length) {
				i = ((idx < 0 || idx >= args.$length) ? ($throwRuntimeError("index out of range"), undefined) : args.$array[args.$offset + idx]);
			}
			_r = $clone(sm, sprintMatch).render(new sliceType$2([i])); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			bits = $append(bits, _r);
			_i++;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return strings.Join(bits, "");
		/* */ } return; } if ($f === undefined) { $f = { $blk: Sprintf }; } $f._i = _i; $f._r = _r; $f._ref = _ref; $f.args = args; $f.bits = bits; $f.fmlist = fmlist; $f.fmts = fmts; $f.i = i; $f.idx = idx; $f.sm = sm; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Sprintf = Sprintf;
	sprintMatch.ptr.prototype.render = function(i) {
		var _r, i, spm, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; i = $f.i; spm = $f.spm; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		spm = this;
		if (spm.spec === "") {
			$s = -1; return spm.before;
		}
		_r = fmtI(spm.spec, (0 >= i.$length ? ($throwRuntimeError("index out of range"), undefined) : i.$array[i.$offset + 0])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return spm.before + _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: sprintMatch.ptr.prototype.render }; } $f._r = _r; $f.i = i; $f.spm = spm; $f.$s = $s; $f.$r = $r; return $f;
	};
	sprintMatch.prototype.render = function(i) { return this.$val.render(i); };
	splitFmtSpecs = function(fmts) {
		var _tuple, bound, fmts, i, lastMatch, lm, matches, ok, percent, sm, spec, window;
		lastMatch = 0;
		window = sliceType.nil;
		matches = sliceType$3.nil;
		percent = 37;
		i = 0;
		while (true) {
			if (!(i < fmts.length)) { break; }
			bound = i + 3 >> 0;
			if (bound >= fmts.length) {
				bound = fmts.length;
			}
			window = $subslice((new sliceType($stringToBytes(fmts))), i, bound);
			if (window.$length < 2 || !(((0 >= window.$length ? ($throwRuntimeError("index out of range"), undefined) : window.$array[window.$offset + 0]) === percent))) {
				i = i + (1) >> 0;
				continue;
			}
			_tuple = getSpec(window);
			spec = _tuple[0];
			ok = _tuple[1];
			if (!ok) {
				i = i + (1) >> 0;
				continue;
			}
			sm = new sprintMatch.ptr($substring(fmts, lastMatch, i), spec);
			matches = $append(matches, sm);
			lastMatch = i + sm.spec.length >> 0;
			i = i + ((sm.spec.length - 1 >> 0)) >> 0;
			i = i + (1) >> 0;
		}
		if (lastMatch < fmts.length) {
			lm = new sprintMatch.ptr($substring(fmts, lastMatch), "");
			matches = $append(matches, lm);
		}
		return matches;
	};
	getSpec = function(window) {
		var _1, speclen, window, x;
		if (!(((0 >= window.$length ? ($throwRuntimeError("index out of range"), undefined) : window.$array[window.$offset + 0]) === 37))) {
			return ["", false];
		}
		speclen = 0;
		if (((1 >= window.$length ? ($throwRuntimeError("index out of range"), undefined) : window.$array[window.$offset + 1]) === 43) || ((1 >= window.$length ? ($throwRuntimeError("index out of range"), undefined) : window.$array[window.$offset + 1]) === 35)) {
			speclen = 3;
		} else {
			speclen = 2;
		}
		_1 = (x = speclen - 1 >> 0, ((x < 0 || x >= window.$length) ? ($throwRuntimeError("index out of range"), undefined) : window.$array[window.$offset + x]));
		if ((_1 === (118)) || (_1 === (115)) || (_1 === (113)) || (_1 === (100)) || (_1 === (98)) || (_1 === (102)) || (_1 === (70)) || (_1 === (103)) || (_1 === (71)) || (_1 === (101)) || (_1 === (69)) || (_1 === (111)) || (_1 === (120)) || (_1 === (88)) || (_1 === (85))) {
			return [($bytesToString($subslice(window, 0, speclen))), true];
		} else {
			return ["", false];
		}
	};
	fmtI = function(spec, i) {
		var _arg, _arg$1, _arg$2, _arg$3, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _ref, i, spec, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _arg$3 = $f._arg$3; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _ref = $f._ref; i = $f.i; spec = $f.spec; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_ref = i;
		/* */ if ($assertType(_ref, reflect.Type, true)[1]) { $s = 1; continue; }
		/* */ if ($assertType(_ref, $error, true)[1]) { $s = 2; continue; }
		/* */ if ($assertType(_ref, $String, true)[1]) { $s = 3; continue; }
		/* */ if ($assertType(_ref, sliceType, true)[1]) { $s = 4; continue; }
		/* */ if ($assertType(_ref, $Int32, true)[1]) { $s = 5; continue; }
		/* */ if ($assertType(_ref, $Int, true)[1] || $assertType(_ref, $Int64, true)[1]) { $s = 6; continue; }
		/* */ if ($assertType(_ref, $Float32, true)[1] || $assertType(_ref, $Float64, true)[1]) { $s = 7; continue; }
		/* */ $s = 8; continue;
		/* if ($assertType(_ref, reflect.Type, true)[1]) { */ case 1:
			_arg = spec;
			_r = $assertType(i, reflect.Type).String(); /* */ $s = 10; case 10: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_arg$1 = _r;
			_r$1 = fmtString(_arg, _arg$1); /* */ $s = 11; case 11: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$s = -1; return _r$1;
		/* } else if ($assertType(_ref, $error, true)[1]) { */ case 2:
			_arg$2 = spec;
			_r$2 = $assertType(i, $error).Error(); /* */ $s = 12; case 12: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_arg$3 = _r$2;
			_r$3 = fmtString(_arg$2, _arg$3); /* */ $s = 13; case 13: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			$s = -1; return _r$3;
		/* } else if ($assertType(_ref, $String, true)[1]) { */ case 3:
			$s = -1; return fmtString(spec, $assertType(i, $String));
		/* } else if ($assertType(_ref, sliceType, true)[1]) { */ case 4:
			_r$4 = fmtBytes(spec, $assertType(i, sliceType)); /* */ $s = 14; case 14: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			$s = -1; return _r$4;
		/* } else if ($assertType(_ref, $Int32, true)[1]) { */ case 5:
			_r$5 = fmtUEscape($assertType(i, $Int32)); /* */ $s = 15; case 15: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			$s = -1; return _r$5;
		/* } else if ($assertType(_ref, $Int, true)[1] || $assertType(_ref, $Int64, true)[1]) { */ case 6:
			_r$6 = fmtInt(spec, i); /* */ $s = 16; case 16: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
			$s = -1; return _r$6;
		/* } else if ($assertType(_ref, $Float32, true)[1] || $assertType(_ref, $Float64, true)[1]) { */ case 7:
			$s = -1; return fmtFloat(spec, i);
		/* } else { */ case 8:
			$panic(new $String("Unsupported interface for fmtless.Sprintf"));
		/* } */ case 9:
		$s = -1; return "";
		/* */ } return; } if ($f === undefined) { $f = { $blk: fmtI }; } $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._arg$3 = _arg$3; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._ref = _ref; $f.i = i; $f.spec = spec; $f.$s = $s; $f.$r = $r; return $f;
	};
	fmtBytes = function(spec, i) {
		var _1, _i, _r, _ref, b, b16bytes, bs, i, spec, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _i = $f._i; _r = $f._r; _ref = $f._ref; b = $f.b; b16bytes = $f.b16bytes; bs = $f.bs; i = $f.i; spec = $f.spec; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_1 = spec;
			/* */ if (_1 === ("%v") || _1 === ("%q") || _1 === ("%s")) { $s = 2; continue; }
			/* */ if (_1 === ("%x") || _1 === ("%X")) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_1 === ("%v") || _1 === ("%q") || _1 === ("%s")) { */ case 2:
				$s = -1; return fmtString(spec, ($bytesToString(i)));
			/* } else if (_1 === ("%x") || _1 === ("%X")) { */ case 3:
				b16bytes = sliceType$1.nil;
				_ref = i;
				_i = 0;
				while (true) {
					if (!(_i < _ref.$length)) { break; }
					b = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
					bs = strconv.FormatInt((new $Int64(0, b)), 16);
					if (bs.length === 1) {
						bs = "0" + bs;
					}
					b16bytes = $append(b16bytes, bs);
					_i++;
				}
				/* */ if (spec === "%X") { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if (spec === "%X") { */ case 6:
					_r = strings.ToUpper(strings.Join(b16bytes, "")); /* */ $s = 8; case 8: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					$s = -1; return _r;
				/* } */ case 7:
				$s = -1; return strings.Join(b16bytes, "");
				$s = 5; continue;
			/* } else { */ case 4:
				$panic(new $String("Unsupported spec for []byte: " + spec));
			/* } */ case 5:
		case 1:
		$s = -1; return "";
		/* */ } return; } if ($f === undefined) { $f = { $blk: fmtBytes }; } $f._1 = _1; $f._i = _i; $f._r = _r; $f._ref = _ref; $f.b = b; $f.b16bytes = b16bytes; $f.bs = bs; $f.i = i; $f.spec = spec; $f.$s = $s; $f.$r = $r; return $f;
	};
	fmtString = function(spec, i) {
		var _1, i, spec;
		_1 = spec;
		if (_1 === ("%s") || _1 === ("%v") || _1 === ("%#v")) {
			return i;
		} else if (_1 === ("%q")) {
			return strconv.Quote(i);
		} else {
			$panic(new $String("Unsupported spec for string: " + spec));
		}
	};
	fmtUEscape = function(r) {
		var _r, r, rcode, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; r = $f.r; rcode = $f.rcode; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = strings.ToUpper(strconv.FormatInt((new $Int64(0, r)), 16)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		rcode = _r;
		rcode = "U+" + SRepeat("0", 4 - rcode.length >> 0) + rcode;
		$s = -1; return rcode;
		/* */ } return; } if ($f === undefined) { $f = { $blk: fmtUEscape }; } $f._r = _r; $f.r = r; $f.rcode = rcode; $f.$s = $s; $f.$r = $r; return $f;
	};
	fmtInt = function(spec, i) {
		var _1, _r, _ref, base, i, i64, out, spec, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r = $f._r; _ref = $f._ref; base = $f.base; i = $f.i; i64 = $f.i64; out = $f.out; spec = $f.spec; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i64 = new $Int64(0, 0);
		base = 0;
		_ref = i;
		if ($assertType(_ref, $Int, true)[1]) {
			i64 = (new $Int64(0, $assertType(i, $Int)));
		} else if ($assertType(_ref, $Int32, true)[1]) {
			i64 = (new $Int64(0, $assertType(i, $Int32)));
		} else if ($assertType(_ref, $Int64, true)[1]) {
			i64 = $assertType(i, $Int64);
		}
		_1 = spec;
		if (_1 === ("%s") || _1 === ("%d") || _1 === ("%v")) {
			base = 10;
		} else if (_1 === ("%o")) {
			base = 8;
		} else if (_1 === ("%b")) {
			base = 2;
		} else if (_1 === ("%X") || _1 === ("%x")) {
			base = 16;
		}
		out = strconv.FormatInt(i64, base);
		/* */ if (spec === "%X") { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (spec === "%X") { */ case 1:
			_r = strings.ToUpper(out); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			out = _r;
		/* } */ case 2:
		$s = -1; return out;
		/* */ } return; } if ($f === undefined) { $f = { $blk: fmtInt }; } $f._1 = _1; $f._r = _r; $f._ref = _ref; $f.base = base; $f.i = i; $f.i64 = i64; $f.out = out; $f.spec = spec; $f.$s = $s; $f.$r = $r; return $f;
	};
	fmtFloat = function(spec, i) {
		var _1, _ref, bs, i, ifl, spec;
		bs = 0;
		ifl = 0;
		_ref = i;
		if ($assertType(_ref, $Float32, true)[1]) {
			ifl = ($assertType(i, $Float32));
			bs = 32;
		} else if ($assertType(_ref, $Float64, true)[1]) {
			ifl = $assertType(i, $Float64);
			bs = 64;
		} else {
			$panic(new $String("Unpossible"));
		}
		_1 = spec;
		if (_1 === ("%b") || _1 === ("%f") || _1 === ("%F") || _1 === ("%g") || _1 === ("%G") || _1 === ("%e") || _1 === ("%E")) {
			return strconv.FormatFloat(ifl, spec.charCodeAt(1), -1, bs);
		} else if (_1 === ("%s") || _1 === ("%v")) {
			return strconv.FormatFloat(ifl, 102, -1, bs);
		} else {
			$panic(new $String("Unsupported specifier for floats: " + spec));
		}
	};
	SRepeat = function(char$1, repeat) {
		var char$1, i, out, repeat;
		out = new sliceType$1([]);
		i = 0;
		while (true) {
			if (!(i < repeat)) { break; }
			out = $append(out, char$1);
			i = i + (1) >> 0;
		}
		return strings.Join(out, "");
	};
	$pkg.SRepeat = SRepeat;
	sprintMatch.methods = [{prop: "render", name: "render", pkg: "github.com/cathalgarvey/fmtless", typ: $funcType([sliceType$2], [$String], true)}];
	sprintMatch.init("github.com/cathalgarvey/fmtless", [{prop: "before", name: "before", anonymous: false, exported: false, typ: $String, tag: ""}, {prop: "spec", name: "spec", anonymous: false, exported: false, typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = reflect.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sort"] = (function() {
	var $pkg = {}, $init, reflect, insertionSort, siftDown, heapSort, medianOfThree, doPivot, quickSort, Sort, maxDepth;
	reflect = $packages["reflect"];
	insertionSort = function(data, a, b) {
		var _r, _v, a, b, data, i, j, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _v = $f._v; a = $f.a; b = $f.b; data = $f.data; i = $f.i; j = $f.j; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = a + 1 >> 0;
		/* while (true) { */ case 1:
			/* if (!(i < b)) { break; } */ if(!(i < b)) { $s = 2; continue; }
			j = i;
			/* while (true) { */ case 3:
				if (!(j > a)) { _v = false; $s = 5; continue s; }
				_r = data.Less(j, j - 1 >> 0); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_v = _r; case 5:
				/* if (!(_v)) { break; } */ if(!(_v)) { $s = 4; continue; }
				$r = data.Swap(j, j - 1 >> 0); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				j = j - (1) >> 0;
			/* } */ $s = 3; continue; case 4:
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: insertionSort }; } $f._r = _r; $f._v = _v; $f.a = a; $f.b = b; $f.data = data; $f.i = i; $f.j = j; $f.$s = $s; $f.$r = $r; return $f;
	};
	siftDown = function(data, lo, hi, first) {
		var _r, _r$1, _v, child, data, first, hi, lo, root, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _v = $f._v; child = $f.child; data = $f.data; first = $f.first; hi = $f.hi; lo = $f.lo; root = $f.root; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		root = lo;
		/* while (true) { */ case 1:
			child = ($imul(2, root)) + 1 >> 0;
			if (child >= hi) {
				/* break; */ $s = 2; continue;
			}
			if (!((child + 1 >> 0) < hi)) { _v = false; $s = 5; continue s; }
			_r = data.Less(first + child >> 0, (first + child >> 0) + 1 >> 0); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_v = _r; case 5:
			/* */ if (_v) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_v) { */ case 3:
				child = child + (1) >> 0;
			/* } */ case 4:
			_r$1 = data.Less(first + root >> 0, first + child >> 0); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ if (!_r$1) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!_r$1) { */ case 7:
				$s = -1; return;
			/* } */ case 8:
			$r = data.Swap(first + root >> 0, first + child >> 0); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			root = child;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: siftDown }; } $f._r = _r; $f._r$1 = _r$1; $f._v = _v; $f.child = child; $f.data = data; $f.first = first; $f.hi = hi; $f.lo = lo; $f.root = root; $f.$s = $s; $f.$r = $r; return $f;
	};
	heapSort = function(data, a, b) {
		var _q, a, b, data, first, hi, i, i$1, lo, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _q = $f._q; a = $f.a; b = $f.b; data = $f.data; first = $f.first; hi = $f.hi; i = $f.i; i$1 = $f.i$1; lo = $f.lo; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		first = a;
		lo = 0;
		hi = b - a >> 0;
		i = (_q = ((hi - 1 >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* while (true) { */ case 1:
			/* if (!(i >= 0)) { break; } */ if(!(i >= 0)) { $s = 2; continue; }
			$r = siftDown(data, i, hi, first); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			i = i - (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		i$1 = hi - 1 >> 0;
		/* while (true) { */ case 4:
			/* if (!(i$1 >= 0)) { break; } */ if(!(i$1 >= 0)) { $s = 5; continue; }
			$r = data.Swap(first, first + i$1 >> 0); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = siftDown(data, lo, i$1, first); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			i$1 = i$1 - (1) >> 0;
		/* } */ $s = 4; continue; case 5:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: heapSort }; } $f._q = _q; $f.a = a; $f.b = b; $f.data = data; $f.first = first; $f.hi = hi; $f.i = i; $f.i$1 = i$1; $f.lo = lo; $f.$s = $s; $f.$r = $r; return $f;
	};
	medianOfThree = function(data, m1, m0, m2) {
		var _r, _r$1, _r$2, data, m0, m1, m2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; data = $f.data; m0 = $f.m0; m1 = $f.m1; m2 = $f.m2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = data.Less(m1, m0); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (_r) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_r) { */ case 1:
			$r = data.Swap(m1, m0); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		_r$1 = data.Less(m2, m1); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ if (_r$1) { $s = 5; continue; }
		/* */ $s = 6; continue;
		/* if (_r$1) { */ case 5:
			$r = data.Swap(m2, m1); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_r$2 = data.Less(m1, m0); /* */ $s = 11; case 11: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			/* */ if (_r$2) { $s = 9; continue; }
			/* */ $s = 10; continue;
			/* if (_r$2) { */ case 9:
				$r = data.Swap(m1, m0); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 10:
		/* } */ case 6:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: medianOfThree }; } $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.data = data; $f.m0 = m0; $f.m1 = m1; $f.m2 = m2; $f.$s = $s; $f.$r = $r; return $f;
	};
	doPivot = function(data, lo, hi) {
		var _q, _q$1, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _tmp, _tmp$1, _tmp$2, _tmp$3, _v, _v$1, _v$2, _v$3, _v$4, a, b, c, data, dups, hi, lo, m, midhi, midlo, pivot, protect, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _q = $f._q; _q$1 = $f._q$1; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _v = $f._v; _v$1 = $f._v$1; _v$2 = $f._v$2; _v$3 = $f._v$3; _v$4 = $f._v$4; a = $f.a; b = $f.b; c = $f.c; data = $f.data; dups = $f.dups; hi = $f.hi; lo = $f.lo; m = $f.m; midhi = $f.midhi; midlo = $f.midlo; pivot = $f.pivot; protect = $f.protect; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		midlo = 0;
		midhi = 0;
		m = ((((((lo + hi >> 0) >>> 0)) >>> 1 >>> 0) >> 0));
		/* */ if ((hi - lo >> 0) > 40) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((hi - lo >> 0) > 40) { */ case 1:
			s = (_q = ((hi - lo >> 0)) / 8, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			$r = medianOfThree(data, lo, lo + s >> 0, lo + ($imul(2, s)) >> 0); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = medianOfThree(data, m, m - s >> 0, m + s >> 0); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = medianOfThree(data, hi - 1 >> 0, (hi - 1 >> 0) - s >> 0, (hi - 1 >> 0) - ($imul(2, s)) >> 0); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		$r = medianOfThree(data, lo, m, hi - 1 >> 0); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		pivot = lo;
		_tmp = lo + 1 >> 0;
		_tmp$1 = hi - 1 >> 0;
		a = _tmp;
		c = _tmp$1;
		/* while (true) { */ case 7:
			if (!(a < c)) { _v = false; $s = 9; continue s; }
			_r = data.Less(a, pivot); /* */ $s = 10; case 10: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_v = _r; case 9:
			/* if (!(_v)) { break; } */ if(!(_v)) { $s = 8; continue; }
			a = a + (1) >> 0;
		/* } */ $s = 7; continue; case 8:
		b = a;
		/* while (true) { */ case 11:
			/* while (true) { */ case 13:
				if (!(b < c)) { _v$1 = false; $s = 15; continue s; }
				_r$1 = data.Less(pivot, b); /* */ $s = 16; case 16: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_v$1 = !_r$1; case 15:
				/* if (!(_v$1)) { break; } */ if(!(_v$1)) { $s = 14; continue; }
				b = b + (1) >> 0;
			/* } */ $s = 13; continue; case 14:
			/* while (true) { */ case 17:
				if (!(b < c)) { _v$2 = false; $s = 19; continue s; }
				_r$2 = data.Less(pivot, c - 1 >> 0); /* */ $s = 20; case 20: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v$2 = _r$2; case 19:
				/* if (!(_v$2)) { break; } */ if(!(_v$2)) { $s = 18; continue; }
				c = c - (1) >> 0;
			/* } */ $s = 17; continue; case 18:
			if (b >= c) {
				/* break; */ $s = 12; continue;
			}
			$r = data.Swap(b, c - 1 >> 0); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			b = b + (1) >> 0;
			c = c - (1) >> 0;
		/* } */ $s = 11; continue; case 12:
		protect = (hi - c >> 0) < 5;
		/* */ if (!protect && (hi - c >> 0) < (_q$1 = ((hi - lo >> 0)) / 4, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"))) { $s = 22; continue; }
		/* */ $s = 23; continue;
		/* if (!protect && (hi - c >> 0) < (_q$1 = ((hi - lo >> 0)) / 4, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"))) { */ case 22:
			dups = 0;
			_r$3 = data.Less(pivot, hi - 1 >> 0); /* */ $s = 26; case 26: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			/* */ if (!_r$3) { $s = 24; continue; }
			/* */ $s = 25; continue;
			/* if (!_r$3) { */ case 24:
				$r = data.Swap(c, hi - 1 >> 0); /* */ $s = 27; case 27: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				c = c + (1) >> 0;
				dups = dups + (1) >> 0;
			/* } */ case 25:
			_r$4 = data.Less(b - 1 >> 0, pivot); /* */ $s = 30; case 30: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			/* */ if (!_r$4) { $s = 28; continue; }
			/* */ $s = 29; continue;
			/* if (!_r$4) { */ case 28:
				b = b - (1) >> 0;
				dups = dups + (1) >> 0;
			/* } */ case 29:
			_r$5 = data.Less(m, pivot); /* */ $s = 33; case 33: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			/* */ if (!_r$5) { $s = 31; continue; }
			/* */ $s = 32; continue;
			/* if (!_r$5) { */ case 31:
				$r = data.Swap(m, b - 1 >> 0); /* */ $s = 34; case 34: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				b = b - (1) >> 0;
				dups = dups + (1) >> 0;
			/* } */ case 32:
			protect = dups > 1;
		/* } */ case 23:
		/* */ if (protect) { $s = 35; continue; }
		/* */ $s = 36; continue;
		/* if (protect) { */ case 35:
			/* while (true) { */ case 37:
				/* while (true) { */ case 39:
					if (!(a < b)) { _v$3 = false; $s = 41; continue s; }
					_r$6 = data.Less(b - 1 >> 0, pivot); /* */ $s = 42; case 42: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					_v$3 = !_r$6; case 41:
					/* if (!(_v$3)) { break; } */ if(!(_v$3)) { $s = 40; continue; }
					b = b - (1) >> 0;
				/* } */ $s = 39; continue; case 40:
				/* while (true) { */ case 43:
					if (!(a < b)) { _v$4 = false; $s = 45; continue s; }
					_r$7 = data.Less(a, pivot); /* */ $s = 46; case 46: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
					_v$4 = _r$7; case 45:
					/* if (!(_v$4)) { break; } */ if(!(_v$4)) { $s = 44; continue; }
					a = a + (1) >> 0;
				/* } */ $s = 43; continue; case 44:
				if (a >= b) {
					/* break; */ $s = 38; continue;
				}
				$r = data.Swap(a, b - 1 >> 0); /* */ $s = 47; case 47: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				a = a + (1) >> 0;
				b = b - (1) >> 0;
			/* } */ $s = 37; continue; case 38:
		/* } */ case 36:
		$r = data.Swap(pivot, b - 1 >> 0); /* */ $s = 48; case 48: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_tmp$2 = b - 1 >> 0;
		_tmp$3 = c;
		midlo = _tmp$2;
		midhi = _tmp$3;
		$s = -1; return [midlo, midhi];
		/* */ } return; } if ($f === undefined) { $f = { $blk: doPivot }; } $f._q = _q; $f._q$1 = _q$1; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._v = _v; $f._v$1 = _v$1; $f._v$2 = _v$2; $f._v$3 = _v$3; $f._v$4 = _v$4; $f.a = a; $f.b = b; $f.c = c; $f.data = data; $f.dups = dups; $f.hi = hi; $f.lo = lo; $f.m = m; $f.midhi = midhi; $f.midlo = midlo; $f.pivot = pivot; $f.protect = protect; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	quickSort = function(data, a, b, maxDepth$1) {
		var _r, _r$1, _tuple, a, b, data, i, maxDepth$1, mhi, mlo, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; a = $f.a; b = $f.b; data = $f.data; i = $f.i; maxDepth$1 = $f.maxDepth$1; mhi = $f.mhi; mlo = $f.mlo; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* while (true) { */ case 1:
			/* if (!((b - a >> 0) > 12)) { break; } */ if(!((b - a >> 0) > 12)) { $s = 2; continue; }
			/* */ if (maxDepth$1 === 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (maxDepth$1 === 0) { */ case 3:
				$r = heapSort(data, a, b); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = -1; return;
			/* } */ case 4:
			maxDepth$1 = maxDepth$1 - (1) >> 0;
			_r = doPivot(data, a, b); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			mlo = _tuple[0];
			mhi = _tuple[1];
			/* */ if ((mlo - a >> 0) < (b - mhi >> 0)) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if ((mlo - a >> 0) < (b - mhi >> 0)) { */ case 7:
				$r = quickSort(data, a, mlo, maxDepth$1); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				a = mhi;
				$s = 9; continue;
			/* } else { */ case 8:
				$r = quickSort(data, mhi, b, maxDepth$1); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				b = mlo;
			/* } */ case 9:
		/* } */ $s = 1; continue; case 2:
		/* */ if ((b - a >> 0) > 1) { $s = 12; continue; }
		/* */ $s = 13; continue;
		/* if ((b - a >> 0) > 1) { */ case 12:
			i = a + 6 >> 0;
			/* while (true) { */ case 14:
				/* if (!(i < b)) { break; } */ if(!(i < b)) { $s = 15; continue; }
				_r$1 = data.Less(i, i - 6 >> 0); /* */ $s = 18; case 18: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				/* */ if (_r$1) { $s = 16; continue; }
				/* */ $s = 17; continue;
				/* if (_r$1) { */ case 16:
					$r = data.Swap(i, i - 6 >> 0); /* */ $s = 19; case 19: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 17:
				i = i + (1) >> 0;
			/* } */ $s = 14; continue; case 15:
			$r = insertionSort(data, a, b); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 13:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: quickSort }; } $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.a = a; $f.b = b; $f.data = data; $f.i = i; $f.maxDepth$1 = maxDepth$1; $f.mhi = mhi; $f.mlo = mlo; $f.$s = $s; $f.$r = $r; return $f;
	};
	Sort = function(data) {
		var _r, data, n, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r = $f._r; data = $f.data; n = $f.n; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = data.Len(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		n = _r;
		$r = quickSort(data, 0, n, maxDepth(n)); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Sort }; } $f._r = _r; $f.data = data; $f.n = n; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Sort = Sort;
	maxDepth = function(n) {
		var depth, i, n;
		depth = 0;
		i = n;
		while (true) {
			if (!(i > 0)) { break; }
			depth = depth + (1) >> 0;
			i = (i >> $min((1), 31)) >> 0;
		}
		return $imul(depth, 2);
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = reflect.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode/utf16"] = (function() {
	var $pkg = {}, $init, IsSurrogate, DecodeRune;
	IsSurrogate = function(r) {
		var r;
		return 55296 <= r && r < 57344;
	};
	$pkg.IsSurrogate = IsSurrogate;
	DecodeRune = function(r1, r2) {
		var r1, r2;
		if (55296 <= r1 && r1 < 56320 && 56320 <= r2 && r2 < 57344) {
			return ((((r1 - 55296 >> 0)) << 10 >> 0) | ((r2 - 56320 >> 0))) + 65536 >> 0;
		}
		return 65533;
	};
	$pkg.DecodeRune = DecodeRune;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/cathalgarvey/fmtless/encoding/json"] = (function() {
	var $pkg = {}, $init, bytes, encoding, base64, errors, fmt, io, math, reflect, runtime, sort, strconv, strings, sync, unicode, utf16, utf8, Unmarshaler, UnmarshalTypeError, InvalidUnmarshalError, Number, decodeState, unquotedValue, Marshaler, field, byName, byIndex, SyntaxError, scanner, tagOptions, sliceType, sliceType$1, mapType$1, structType$1, sliceType$2, ptrType, ptrType$1, sliceType$3, ptrType$3, mapType$2, ptrType$4, ptrType$8, ptrType$9, ptrType$11, ptrType$12, funcType, ptrType$23, funcType$1, errPhase, nullLiteral, numberType, marshalerType, textMarshalerType, fieldCache, _r, _r$1, Unmarshal, isValidNumber, getu4, unquote, unquoteBytes, isValidTag, fillField, typeFields, dominantField, cachedTypeFields, foldFunc, equalFoldRight, asciiEqualFold, simpleLetterEqualFold, checkValid, nextValue, isSpace, stateBeginValueOrEmpty, stateBeginValue, stateBeginStringOrEmpty, stateBeginString, stateEndValue, stateEndTop, stateInString, stateInStringEsc, stateInStringEscU, stateInStringEscU1, stateInStringEscU12, stateInStringEscU123, stateNeg, state1, state0, stateDot, stateDot0, stateE, stateESign, stateE0, stateT, stateTr, stateTru, stateF, stateFa, stateFal, stateFals, stateN, stateNu, stateNul, stateError, quoteChar, stateRedo, parseTag;
	bytes = $packages["bytes"];
	encoding = $packages["encoding"];
	base64 = $packages["encoding/base64"];
	errors = $packages["errors"];
	fmt = $packages["github.com/cathalgarvey/fmtless"];
	io = $packages["io"];
	math = $packages["math"];
	reflect = $packages["reflect"];
	runtime = $packages["runtime"];
	sort = $packages["sort"];
	strconv = $packages["strconv"];
	strings = $packages["strings"];
	sync = $packages["sync"];
	unicode = $packages["unicode"];
	utf16 = $packages["unicode/utf16"];
	utf8 = $packages["unicode/utf8"];
	Unmarshaler = $pkg.Unmarshaler = $newType(8, $kindInterface, "json.Unmarshaler", true, "github.com/cathalgarvey/fmtless/encoding/json", true, null);
	UnmarshalTypeError = $pkg.UnmarshalTypeError = $newType(0, $kindStruct, "json.UnmarshalTypeError", true, "github.com/cathalgarvey/fmtless/encoding/json", true, function(Value_, Type_, Offset_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Value = "";
			this.Type = $ifaceNil;
			this.Offset = new $Int64(0, 0);
			return;
		}
		this.Value = Value_;
		this.Type = Type_;
		this.Offset = Offset_;
	});
	InvalidUnmarshalError = $pkg.InvalidUnmarshalError = $newType(0, $kindStruct, "json.InvalidUnmarshalError", true, "github.com/cathalgarvey/fmtless/encoding/json", true, function(Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Type = $ifaceNil;
			return;
		}
		this.Type = Type_;
	});
	Number = $pkg.Number = $newType(8, $kindString, "json.Number", true, "github.com/cathalgarvey/fmtless/encoding/json", true, null);
	decodeState = $pkg.decodeState = $newType(0, $kindStruct, "json.decodeState", true, "github.com/cathalgarvey/fmtless/encoding/json", false, function(data_, off_, scan_, nextscan_, savedError_, useNumber_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.data = sliceType$2.nil;
			this.off = 0;
			this.scan = new scanner.ptr($throwNilPointerError, false, sliceType$3.nil, $ifaceNil, false, 0, $throwNilPointerError, new $Int64(0, 0));
			this.nextscan = new scanner.ptr($throwNilPointerError, false, sliceType$3.nil, $ifaceNil, false, 0, $throwNilPointerError, new $Int64(0, 0));
			this.savedError = $ifaceNil;
			this.useNumber = false;
			return;
		}
		this.data = data_;
		this.off = off_;
		this.scan = scan_;
		this.nextscan = nextscan_;
		this.savedError = savedError_;
		this.useNumber = useNumber_;
	});
	unquotedValue = $pkg.unquotedValue = $newType(0, $kindStruct, "json.unquotedValue", true, "github.com/cathalgarvey/fmtless/encoding/json", false, function() {
		this.$val = this;
		if (arguments.length === 0) {
			return;
		}
	});
	Marshaler = $pkg.Marshaler = $newType(8, $kindInterface, "json.Marshaler", true, "github.com/cathalgarvey/fmtless/encoding/json", true, null);
	field = $pkg.field = $newType(0, $kindStruct, "json.field", true, "github.com/cathalgarvey/fmtless/encoding/json", false, function(name_, nameBytes_, equalFold_, tag_, index_, typ_, omitEmpty_, quoted_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.nameBytes = sliceType$2.nil;
			this.equalFold = $throwNilPointerError;
			this.tag = false;
			this.index = sliceType$3.nil;
			this.typ = $ifaceNil;
			this.omitEmpty = false;
			this.quoted = false;
			return;
		}
		this.name = name_;
		this.nameBytes = nameBytes_;
		this.equalFold = equalFold_;
		this.tag = tag_;
		this.index = index_;
		this.typ = typ_;
		this.omitEmpty = omitEmpty_;
		this.quoted = quoted_;
	});
	byName = $pkg.byName = $newType(12, $kindSlice, "json.byName", true, "github.com/cathalgarvey/fmtless/encoding/json", false, null);
	byIndex = $pkg.byIndex = $newType(12, $kindSlice, "json.byIndex", true, "github.com/cathalgarvey/fmtless/encoding/json", false, null);
	SyntaxError = $pkg.SyntaxError = $newType(0, $kindStruct, "json.SyntaxError", true, "github.com/cathalgarvey/fmtless/encoding/json", true, function(msg_, Offset_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.msg = "";
			this.Offset = new $Int64(0, 0);
			return;
		}
		this.msg = msg_;
		this.Offset = Offset_;
	});
	scanner = $pkg.scanner = $newType(0, $kindStruct, "json.scanner", true, "github.com/cathalgarvey/fmtless/encoding/json", false, function(step_, endTop_, parseState_, err_, redo_, redoCode_, redoState_, bytes_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.step = $throwNilPointerError;
			this.endTop = false;
			this.parseState = sliceType$3.nil;
			this.err = $ifaceNil;
			this.redo = false;
			this.redoCode = 0;
			this.redoState = $throwNilPointerError;
			this.bytes = new $Int64(0, 0);
			return;
		}
		this.step = step_;
		this.endTop = endTop_;
		this.parseState = parseState_;
		this.err = err_;
		this.redo = redo_;
		this.redoCode = redoCode_;
		this.redoState = redoState_;
		this.bytes = bytes_;
	});
	tagOptions = $pkg.tagOptions = $newType(8, $kindString, "json.tagOptions", true, "github.com/cathalgarvey/fmtless/encoding/json", false, null);
	sliceType = $sliceType($emptyInterface);
	sliceType$1 = $sliceType(field);
	mapType$1 = $mapType(reflect.Type, sliceType$1);
	structType$1 = $structType("github.com/cathalgarvey/fmtless/encoding/json", [{prop: "RWMutex", name: "RWMutex", anonymous: true, exported: true, typ: sync.RWMutex, tag: ""}, {prop: "m", name: "m", anonymous: false, exported: false, typ: mapType$1, tag: ""}]);
	sliceType$2 = $sliceType($Uint8);
	ptrType = $ptrType(Marshaler);
	ptrType$1 = $ptrType(encoding.TextMarshaler);
	sliceType$3 = $sliceType($Int);
	ptrType$3 = $ptrType(reflect.rtype);
	mapType$2 = $mapType($String, $emptyInterface);
	ptrType$4 = $ptrType(field);
	ptrType$8 = $ptrType(SyntaxError);
	ptrType$9 = $ptrType(UnmarshalTypeError);
	ptrType$11 = $ptrType(InvalidUnmarshalError);
	ptrType$12 = $ptrType(decodeState);
	funcType = $funcType([sliceType$2, sliceType$2], [$Bool], false);
	ptrType$23 = $ptrType(scanner);
	funcType$1 = $funcType([ptrType$23, $Uint8], [$Int], false);
	Unmarshal = function(data, v) {
		var _r$2, _r$3, d, data, err, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r$2 = $f._r$2; _r$3 = $f._r$3; d = $f.d; data = $f.data; err = $f.err; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = new decodeState.ptr(sliceType$2.nil, 0, new scanner.ptr($throwNilPointerError, false, sliceType$3.nil, $ifaceNil, false, 0, $throwNilPointerError, new $Int64(0, 0)), new scanner.ptr($throwNilPointerError, false, sliceType$3.nil, $ifaceNil, false, 0, $throwNilPointerError, new $Int64(0, 0)), $ifaceNil, false);
		_r$2 = checkValid(data, d.scan); /* */ $s = 1; case 1: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		err = _r$2;
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return err;
		}
		d.init(data);
		_r$3 = d.unmarshal(v); /* */ $s = 2; case 2: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		$s = -1; return _r$3;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Unmarshal }; } $f._r$2 = _r$2; $f._r$3 = _r$3; $f.d = d; $f.data = data; $f.err = err; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Unmarshal = Unmarshal;
	UnmarshalTypeError.ptr.prototype.Error = function() {
		var _r$2, e, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r$2 = $f._r$2; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		e = this;
		_r$2 = e.Type.String(); /* */ $s = 1; case 1: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return "json: cannot unmarshal " + e.Value + " into Go value of type " + _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: UnmarshalTypeError.ptr.prototype.Error }; } $f._r$2 = _r$2; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
	};
	UnmarshalTypeError.prototype.Error = function() { return this.$val.Error(); };
	InvalidUnmarshalError.ptr.prototype.Error = function() {
		var _r$2, _r$3, _r$4, e, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		e = this;
		if ($interfaceIsEqual(e.Type, $ifaceNil)) {
			$s = -1; return "json: Unmarshal(nil)";
		}
		_r$2 = e.Type.Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ if (!((_r$2 === 22))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r$2 === 22))) { */ case 1:
			_r$3 = e.Type.String(); /* */ $s = 4; case 4: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			$s = -1; return "json: Unmarshal(non-pointer " + _r$3 + ")";
		/* } */ case 2:
		_r$4 = e.Type.String(); /* */ $s = 5; case 5: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		$s = -1; return "json: Unmarshal(nil " + _r$4 + ")";
		/* */ } return; } if ($f === undefined) { $f = { $blk: InvalidUnmarshalError.ptr.prototype.Error }; } $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
	};
	InvalidUnmarshalError.prototype.Error = function() { return this.$val.Error(); };
	decodeState.ptr.prototype.unmarshal = function(v) {
		var _r$2, d, err, rv, v, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r$2 = $f._r$2; d = $f.d; err = $f.err; rv = $f.rv; v = $f.v; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = [err];
		err[0] = $ifaceNil;
		d = this;
		$deferred.push([(function(err) { return function() {
			var _tuple, ok, r;
			r = $recover();
			if (!($interfaceIsEqual(r, $ifaceNil))) {
				_tuple = $assertType(r, runtime.Error, true);
				ok = _tuple[1];
				if (ok) {
					$panic(r);
				}
				err[0] = $assertType(r, $error);
			}
		}; })(err), []]);
		_r$2 = reflect.ValueOf(v); /* */ $s = 1; case 1: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		rv = _r$2;
		if (!(($clone(rv, reflect.Value).Kind() === 22)) || $clone(rv, reflect.Value).IsNil()) {
			err[0] = new InvalidUnmarshalError.ptr(reflect.TypeOf(v));
			$s = -1; return err[0];
		}
		d.scan.reset();
		$r = d.value($clone(rv, reflect.Value)); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		err[0] = d.savedError;
		$s = -1; return err[0];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err[0]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.unmarshal }; } $f._r$2 = _r$2; $f.d = d; $f.err = err; $f.rv = rv; $f.v = v; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	decodeState.prototype.unmarshal = function(v) { return this.$val.unmarshal(v); };
	Number.prototype.String = function() {
		var n;
		n = this.$val;
		return (n);
	};
	$ptrType(Number).prototype.String = function() { return new Number(this.$get()).String(); };
	Number.prototype.Float64 = function() {
		var n;
		n = this.$val;
		return strconv.ParseFloat((n), 64);
	};
	$ptrType(Number).prototype.Float64 = function() { return new Number(this.$get()).Float64(); };
	Number.prototype.Int64 = function() {
		var n;
		n = this.$val;
		return strconv.ParseInt((n), 10, 64);
	};
	$ptrType(Number).prototype.Int64 = function() { return new Number(this.$get()).Int64(); };
	isValidNumber = function(s) {
		var s;
		if (s === "") {
			return false;
		}
		if (s.charCodeAt(0) === 45) {
			s = $substring(s, 1);
			if (s === "") {
				return false;
			}
		}
		if ((s.charCodeAt(0) === 48)) {
			s = $substring(s, 1);
		} else if (49 <= s.charCodeAt(0) && s.charCodeAt(0) <= 57) {
			s = $substring(s, 1);
			while (true) {
				if (!(s.length > 0 && 48 <= s.charCodeAt(0) && s.charCodeAt(0) <= 57)) { break; }
				s = $substring(s, 1);
			}
		} else {
			return false;
		}
		if (s.length >= 2 && (s.charCodeAt(0) === 46) && 48 <= s.charCodeAt(1) && s.charCodeAt(1) <= 57) {
			s = $substring(s, 2);
			while (true) {
				if (!(s.length > 0 && 48 <= s.charCodeAt(0) && s.charCodeAt(0) <= 57)) { break; }
				s = $substring(s, 1);
			}
		}
		if (s.length >= 2 && ((s.charCodeAt(0) === 101) || (s.charCodeAt(0) === 69))) {
			s = $substring(s, 1);
			if ((s.charCodeAt(0) === 43) || (s.charCodeAt(0) === 45)) {
				s = $substring(s, 1);
				if (s === "") {
					return false;
				}
			}
			while (true) {
				if (!(s.length > 0 && 48 <= s.charCodeAt(0) && s.charCodeAt(0) <= 57)) { break; }
				s = $substring(s, 1);
			}
		}
		return s === "";
	};
	decodeState.ptr.prototype.init = function(data) {
		var d, data;
		d = this;
		d.data = data;
		d.off = 0;
		d.savedError = $ifaceNil;
		return d;
	};
	decodeState.prototype.init = function(data) { return this.$val.init(data); };
	decodeState.ptr.prototype.error = function(err) {
		var d, err;
		d = this;
		$panic(err);
	};
	decodeState.prototype.error = function(err) { return this.$val.error(err); };
	decodeState.ptr.prototype.saveError = function(err) {
		var d, err;
		d = this;
		if ($interfaceIsEqual(d.savedError, $ifaceNil)) {
			d.savedError = err;
		}
	};
	decodeState.prototype.saveError = function(err) { return this.$val.saveError(err); };
	decodeState.ptr.prototype.next = function() {
		var _r$2, _r$3, _r$4, _tuple, c, d, err, item, rest, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _tuple = $f._tuple; c = $f.c; d = $f.d; err = $f.err; item = $f.item; rest = $f.rest; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		c = (x = d.data, x$1 = d.off, ((x$1 < 0 || x$1 >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + x$1]));
		_r$2 = nextValue($subslice(d.data, d.off), d.nextscan); /* */ $s = 1; case 1: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple = _r$2;
		item = _tuple[0];
		rest = _tuple[1];
		err = _tuple[2];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			d.error(err);
		}
		d.off = d.data.$length - rest.$length >> 0;
		/* */ if (c === 123) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (c === 123) { */ case 2:
			_r$3 = d.scan.step(d.scan, 125); /* */ $s = 5; case 5: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			_r$3;
			$s = 4; continue;
		/* } else { */ case 3:
			_r$4 = d.scan.step(d.scan, 93); /* */ $s = 6; case 6: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			_r$4;
		/* } */ case 4:
		$s = -1; return item;
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.next }; } $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._tuple = _tuple; $f.c = c; $f.d = d; $f.err = err; $f.item = item; $f.rest = rest; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.next = function() { return this.$val.next(); };
	decodeState.ptr.prototype.scanWhile = function(op) {
		var _r$2, _r$3, c, d, newOp, op, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r$2 = $f._r$2; _r$3 = $f._r$3; c = $f.c; d = $f.d; newOp = $f.newOp; op = $f.op; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		newOp = 0;
		/* while (true) { */ case 1:
			/* */ if (d.off >= d.data.$length) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (d.off >= d.data.$length) { */ case 3:
				_r$2 = d.scan.eof(); /* */ $s = 6; case 6: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				newOp = _r$2;
				d.off = d.data.$length + 1 >> 0;
				$s = 5; continue;
			/* } else { */ case 4:
				c = (x = d.data, x$1 = d.off, ((x$1 < 0 || x$1 >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + x$1]));
				d.off = d.off + (1) >> 0;
				_r$3 = d.scan.step(d.scan, c); /* */ $s = 7; case 7: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				newOp = _r$3;
			/* } */ case 5:
			if (!((newOp === op))) {
				/* break; */ $s = 2; continue;
			}
		/* } */ $s = 1; continue; case 2:
		$s = -1; return newOp;
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.scanWhile }; } $f._r$2 = _r$2; $f._r$3 = _r$3; $f.c = c; $f.d = d; $f.newOp = newOp; $f.op = op; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.scanWhile = function(op) { return this.$val.scanWhile(op); };
	decodeState.ptr.prototype.value = function(v) {
		var _1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _tuple, d, err, n, op, rest, v, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _tuple = $f._tuple; d = $f.d; err = $f.err; n = $f.n; op = $f.op; rest = $f.rest; v = $f.v; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		/* */ if (!$clone(v, reflect.Value).IsValid()) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!$clone(v, reflect.Value).IsValid()) { */ case 1:
			_r$2 = nextValue($subslice(d.data, d.off), d.nextscan); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_tuple = _r$2;
			rest = _tuple[1];
			err = _tuple[2];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				d.error(err);
			}
			d.off = d.data.$length - rest.$length >> 0;
			if (d.scan.redo) {
				d.scan.redo = false;
				d.scan.step = stateBeginValue;
			}
			_r$3 = d.scan.step(d.scan, 34); /* */ $s = 4; case 4: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			_r$3;
			_r$4 = d.scan.step(d.scan, 34); /* */ $s = 5; case 5: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			_r$4;
			n = d.scan.parseState.$length;
			/* */ if (n > 0 && ((x = d.scan.parseState, x$1 = n - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + x$1])) === 0)) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (n > 0 && ((x = d.scan.parseState, x$1 = n - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + x$1])) === 0)) { */ case 6:
				_r$5 = d.scan.step(d.scan, 58); /* */ $s = 8; case 8: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
				_r$5;
				_r$6 = d.scan.step(d.scan, 34); /* */ $s = 9; case 9: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
				_r$6;
				_r$7 = d.scan.step(d.scan, 34); /* */ $s = 10; case 10: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
				_r$7;
				_r$8 = d.scan.step(d.scan, 125); /* */ $s = 11; case 11: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
				_r$8;
			/* } */ case 7:
			$s = -1; return;
		/* } */ case 2:
			_r$9 = d.scanWhile(9); /* */ $s = 13; case 13: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
			op = _r$9;
			_1 = op;
			/* */ if (_1 === (6)) { $s = 14; continue; }
			/* */ if (_1 === (2)) { $s = 15; continue; }
			/* */ if (_1 === (1)) { $s = 16; continue; }
			/* */ $s = 17; continue;
			/* if (_1 === (6)) { */ case 14:
				$r = d.array($clone(v, reflect.Value)); /* */ $s = 19; case 19: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 18; continue;
			/* } else if (_1 === (2)) { */ case 15:
				$r = d.object($clone(v, reflect.Value)); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 18; continue;
			/* } else if (_1 === (1)) { */ case 16:
				$r = d.literal($clone(v, reflect.Value)); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 18; continue;
			/* } else { */ case 17:
				d.error(errPhase);
			/* } */ case 18:
		case 12:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.value }; } $f._1 = _1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._tuple = _tuple; $f.d = d; $f.err = err; $f.n = n; $f.op = op; $f.rest = rest; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.value = function(v) { return this.$val.value(v); };
	decodeState.ptr.prototype.valueQuoted = function() {
		var _1, _r$2, _r$3, _ref, d, op, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r$2 = $f._r$2; _r$3 = $f._r$3; _ref = $f._ref; d = $f.d; op = $f.op; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
			_r$2 = d.scanWhile(9); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			op = _r$2;
			_1 = op;
			/* */ if (_1 === (6)) { $s = 3; continue; }
			/* */ if (_1 === (2)) { $s = 4; continue; }
			/* */ if (_1 === (1)) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (_1 === (6)) { */ case 3:
				$r = d.array(new reflect.Value.ptr(ptrType$3.nil, 0, 0)); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 7; continue;
			/* } else if (_1 === (2)) { */ case 4:
				$r = d.object(new reflect.Value.ptr(ptrType$3.nil, 0, 0)); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 7; continue;
			/* } else if (_1 === (1)) { */ case 5:
				_r$3 = d.literalInterface(); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				_ref = _r$3;
				/* */ if (_ref === $ifaceNil || $assertType(_ref, $String, true)[1]) { $s = 11; continue; }
				/* */ $s = 12; continue;
				/* if (_ref === $ifaceNil || $assertType(_ref, $String, true)[1]) { */ case 11:
					v = _ref;
					$s = -1; return v;
				/* } */ case 12:
				$s = 7; continue;
			/* } else { */ case 6:
				d.error(errPhase);
			/* } */ case 7:
		case 1:
		$s = -1; return (x = new unquotedValue.ptr(), new x.constructor.elem(x));
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.valueQuoted }; } $f._1 = _1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._ref = _ref; $f.d = d; $f.op = op; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.valueQuoted = function() { return this.$val.valueQuoted(); };
	decodeState.ptr.prototype.indirect = function(v, decodingNull) {
		var _r$10, _r$11, _r$12, _r$13, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _tuple, _tuple$1, _v, _v$1, _v$2, d, decodingNull, e, ok, ok$1, u, u$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _v = $f._v; _v$1 = $f._v$1; _v$2 = $f._v$2; d = $f.d; decodingNull = $f.decodingNull; e = $f.e; ok = $f.ok; ok$1 = $f.ok$1; u = $f.u; u$1 = $f.u$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		if (!(!(($clone(v, reflect.Value).Kind() === 22)))) { _v = false; $s = 3; continue s; }
		_r$2 = $clone(v, reflect.Value).Type().Name(); /* */ $s = 4; case 4: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_v = !(_r$2 === ""); case 3:
		/* */ if (_v && $clone(v, reflect.Value).CanAddr()) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_v && $clone(v, reflect.Value).CanAddr()) { */ case 1:
			v = $clone(v, reflect.Value).Addr();
		/* } */ case 2:
		/* while (true) { */ case 5:
			/* */ if (($clone(v, reflect.Value).Kind() === 20) && !$clone(v, reflect.Value).IsNil()) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (($clone(v, reflect.Value).Kind() === 20) && !$clone(v, reflect.Value).IsNil()) { */ case 7:
				_r$3 = $clone(v, reflect.Value).Elem(); /* */ $s = 9; case 9: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				e = _r$3;
				if (!(($clone(e, reflect.Value).Kind() === 22) && !$clone(e, reflect.Value).IsNil())) { _v$1 = false; $s = 12; continue s; }
				if (!decodingNull) { _v$2 = true; $s = 13; continue s; }
				_r$4 = $clone(e, reflect.Value).Elem(); /* */ $s = 14; case 14: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
				_r$5 = $clone(_r$4, reflect.Value).Kind(); /* */ $s = 15; case 15: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
				_v$2 = _r$5 === 22; case 13:
				_v$1 = _v$2; case 12:
				/* */ if (_v$1) { $s = 10; continue; }
				/* */ $s = 11; continue;
				/* if (_v$1) { */ case 10:
					v = e;
					/* continue; */ $s = 5; continue;
				/* } */ case 11:
			/* } */ case 8:
			if (!(($clone(v, reflect.Value).Kind() === 22))) {
				/* break; */ $s = 6; continue;
			}
			_r$6 = $clone(v, reflect.Value).Elem(); /* */ $s = 18; case 18: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
			_r$7 = $clone(_r$6, reflect.Value).Kind(); /* */ $s = 19; case 19: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
			/* */ if (!((_r$7 === 22)) && decodingNull && $clone(v, reflect.Value).CanSet()) { $s = 16; continue; }
			/* */ $s = 17; continue;
			/* if (!((_r$7 === 22)) && decodingNull && $clone(v, reflect.Value).CanSet()) { */ case 16:
				/* break; */ $s = 6; continue;
			/* } */ case 17:
			/* */ if ($clone(v, reflect.Value).IsNil()) { $s = 20; continue; }
			/* */ $s = 21; continue;
			/* if ($clone(v, reflect.Value).IsNil()) { */ case 20:
				_r$8 = $clone(v, reflect.Value).Type().Elem(); /* */ $s = 22; case 22: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
				_r$9 = reflect.New(_r$8); /* */ $s = 23; case 23: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
				$r = $clone(v, reflect.Value).Set($clone(_r$9, reflect.Value)); /* */ $s = 24; case 24: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 21:
			_r$10 = $clone(v, reflect.Value).Type().NumMethod(); /* */ $s = 27; case 27: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
			/* */ if (_r$10 > 0) { $s = 25; continue; }
			/* */ $s = 26; continue;
			/* if (_r$10 > 0) { */ case 25:
				_r$11 = $clone(v, reflect.Value).Interface(); /* */ $s = 28; case 28: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
				_tuple = $assertType(_r$11, Unmarshaler, true);
				u = _tuple[0];
				ok = _tuple[1];
				if (ok) {
					$s = -1; return [u, $ifaceNil, new reflect.Value.ptr(ptrType$3.nil, 0, 0)];
				}
				_r$12 = $clone(v, reflect.Value).Interface(); /* */ $s = 29; case 29: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
				_tuple$1 = $assertType(_r$12, encoding.TextUnmarshaler, true);
				u$1 = _tuple$1[0];
				ok$1 = _tuple$1[1];
				if (ok$1) {
					$s = -1; return [$ifaceNil, u$1, new reflect.Value.ptr(ptrType$3.nil, 0, 0)];
				}
			/* } */ case 26:
			_r$13 = $clone(v, reflect.Value).Elem(); /* */ $s = 30; case 30: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
			v = _r$13;
		/* } */ $s = 5; continue; case 6:
		$s = -1; return [$ifaceNil, $ifaceNil, v];
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.indirect }; } $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._v = _v; $f._v$1 = _v$1; $f._v$2 = _v$2; $f.d = d; $f.decodingNull = decodingNull; $f.e = e; $f.ok = ok; $f.ok$1 = ok$1; $f.u = u; $f.u$1 = u$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.indirect = function(v, decodingNull) { return this.$val.indirect(v, decodingNull); };
	decodeState.ptr.prototype.array = function(v) {
		var _1, _q, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$16, _r$17, _r$18, _r$19, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _tuple, d, err, i, newcap, newv, op, pv, u, ut, v, z, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _q = $f._q; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$16 = $f._r$16; _r$17 = $f._r$17; _r$18 = $f._r$18; _r$19 = $f._r$19; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _tuple = $f._tuple; d = $f.d; err = $f.err; i = $f.i; newcap = $f.newcap; newv = $f.newv; op = $f.op; pv = $f.pv; u = $f.u; ut = $f.ut; v = $f.v; z = $f.z; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		_r$2 = d.indirect($clone(v, reflect.Value), false); /* */ $s = 1; case 1: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple = _r$2;
		u = _tuple[0];
		ut = _tuple[1];
		pv = _tuple[2];
		/* */ if (!($interfaceIsEqual(u, $ifaceNil))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!($interfaceIsEqual(u, $ifaceNil))) { */ case 2:
			d.off = d.off - (1) >> 0;
			_r$3 = d.next(); /* */ $s = 4; case 4: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			_r$4 = u.UnmarshalJSON(_r$3); /* */ $s = 5; case 5: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			err = _r$4;
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				d.error(err);
			}
			$s = -1; return;
		/* } */ case 3:
		/* */ if (!($interfaceIsEqual(ut, $ifaceNil))) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (!($interfaceIsEqual(ut, $ifaceNil))) { */ case 6:
			d.saveError(new UnmarshalTypeError.ptr("array", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
			d.off = d.off - (1) >> 0;
			_r$5 = d.next(); /* */ $s = 8; case 8: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			_r$5;
			$s = -1; return;
		/* } */ case 7:
		v = pv;
			_1 = $clone(v, reflect.Value).Kind();
			/* */ if (_1 === (20)) { $s = 10; continue; }
			/* */ if (_1 === (17)) { $s = 11; continue; }
			/* */ if (_1 === (23)) { $s = 12; continue; }
			/* */ $s = 13; continue;
			/* if (_1 === (20)) { */ case 10:
				_r$6 = $clone(v, reflect.Value).NumMethod(); /* */ $s = 17; case 17: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
				/* */ if (_r$6 === 0) { $s = 15; continue; }
				/* */ $s = 16; continue;
				/* if (_r$6 === 0) { */ case 15:
					_r$7 = d.arrayInterface(); /* */ $s = 18; case 18: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
					_r$8 = reflect.ValueOf(_r$7); /* */ $s = 19; case 19: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
					$r = $clone(v, reflect.Value).Set($clone(_r$8, reflect.Value)); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = -1; return;
				/* } */ case 16:
				d.saveError(new UnmarshalTypeError.ptr("array", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
				d.off = d.off - (1) >> 0;
				_r$9 = d.next(); /* */ $s = 21; case 21: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
				_r$9;
				$s = -1; return;
			/* } else if (_1 === (17)) { */ case 11:
				$s = 14; continue;
			/* } else if (_1 === (23)) { */ case 12:
				/* break; */ $s = 9; continue;
				$s = 14; continue;
			/* } else { */ case 13:
				d.saveError(new UnmarshalTypeError.ptr("array", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
				d.off = d.off - (1) >> 0;
				_r$10 = d.next(); /* */ $s = 22; case 22: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
				_r$10;
				$s = -1; return;
			/* } */ case 14:
		case 9:
		i = 0;
		/* while (true) { */ case 23:
			_r$11 = d.scanWhile(9); /* */ $s = 25; case 25: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
			op = _r$11;
			if (op === 8) {
				/* break; */ $s = 24; continue;
			}
			d.off = d.off - (1) >> 0;
			d.scan.undo(op);
			/* */ if ($clone(v, reflect.Value).Kind() === 23) { $s = 26; continue; }
			/* */ $s = 27; continue;
			/* if ($clone(v, reflect.Value).Kind() === 23) { */ case 26:
				/* */ if (i >= $clone(v, reflect.Value).Cap()) { $s = 28; continue; }
				/* */ $s = 29; continue;
				/* if (i >= $clone(v, reflect.Value).Cap()) { */ case 28:
					newcap = $clone(v, reflect.Value).Cap() + (_q = $clone(v, reflect.Value).Cap() / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
					if (newcap < 4) {
						newcap = 4;
					}
					_r$12 = reflect.MakeSlice($clone(v, reflect.Value).Type(), $clone(v, reflect.Value).Len(), newcap); /* */ $s = 30; case 30: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
					newv = _r$12;
					_r$13 = reflect.Copy($clone(newv, reflect.Value), $clone(v, reflect.Value)); /* */ $s = 31; case 31: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
					_r$13;
					$r = $clone(v, reflect.Value).Set($clone(newv, reflect.Value)); /* */ $s = 32; case 32: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 29:
				if (i >= $clone(v, reflect.Value).Len()) {
					$clone(v, reflect.Value).SetLen(i + 1 >> 0);
				}
			/* } */ case 27:
			/* */ if (i < $clone(v, reflect.Value).Len()) { $s = 33; continue; }
			/* */ $s = 34; continue;
			/* if (i < $clone(v, reflect.Value).Len()) { */ case 33:
				_r$14 = $clone(v, reflect.Value).Index(i); /* */ $s = 36; case 36: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
				$r = d.value($clone(_r$14, reflect.Value)); /* */ $s = 37; case 37: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 35; continue;
			/* } else { */ case 34:
				$r = d.value(new reflect.Value.ptr(ptrType$3.nil, 0, 0)); /* */ $s = 38; case 38: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 35:
			i = i + (1) >> 0;
			_r$15 = d.scanWhile(9); /* */ $s = 39; case 39: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
			op = _r$15;
			if (op === 8) {
				/* break; */ $s = 24; continue;
			}
			if (!((op === 7))) {
				d.error(errPhase);
			}
		/* } */ $s = 23; continue; case 24:
		/* */ if (i < $clone(v, reflect.Value).Len()) { $s = 40; continue; }
		/* */ $s = 41; continue;
		/* if (i < $clone(v, reflect.Value).Len()) { */ case 40:
			/* */ if ($clone(v, reflect.Value).Kind() === 17) { $s = 42; continue; }
			/* */ $s = 43; continue;
			/* if ($clone(v, reflect.Value).Kind() === 17) { */ case 42:
				_r$16 = $clone(v, reflect.Value).Type().Elem(); /* */ $s = 45; case 45: if($c) { $c = false; _r$16 = _r$16.$blk(); } if (_r$16 && _r$16.$blk !== undefined) { break s; }
				_r$17 = reflect.Zero(_r$16); /* */ $s = 46; case 46: if($c) { $c = false; _r$17 = _r$17.$blk(); } if (_r$17 && _r$17.$blk !== undefined) { break s; }
				z = _r$17;
				/* while (true) { */ case 47:
					/* if (!(i < $clone(v, reflect.Value).Len())) { break; } */ if(!(i < $clone(v, reflect.Value).Len())) { $s = 48; continue; }
					_r$18 = $clone(v, reflect.Value).Index(i); /* */ $s = 49; case 49: if($c) { $c = false; _r$18 = _r$18.$blk(); } if (_r$18 && _r$18.$blk !== undefined) { break s; }
					$r = $clone(_r$18, reflect.Value).Set($clone(z, reflect.Value)); /* */ $s = 50; case 50: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					i = i + (1) >> 0;
				/* } */ $s = 47; continue; case 48:
				$s = 44; continue;
			/* } else { */ case 43:
				$clone(v, reflect.Value).SetLen(i);
			/* } */ case 44:
		/* } */ case 41:
		/* */ if ((i === 0) && ($clone(v, reflect.Value).Kind() === 23)) { $s = 51; continue; }
		/* */ $s = 52; continue;
		/* if ((i === 0) && ($clone(v, reflect.Value).Kind() === 23)) { */ case 51:
			_r$19 = reflect.MakeSlice($clone(v, reflect.Value).Type(), 0, 0); /* */ $s = 53; case 53: if($c) { $c = false; _r$19 = _r$19.$blk(); } if (_r$19 && _r$19.$blk !== undefined) { break s; }
			$r = $clone(v, reflect.Value).Set($clone(_r$19, reflect.Value)); /* */ $s = 54; case 54: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 52:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.array }; } $f._1 = _1; $f._q = _q; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$16 = _r$16; $f._r$17 = _r$17; $f._r$18 = _r$18; $f._r$19 = _r$19; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._tuple = _tuple; $f.d = d; $f.err = err; $f.i = i; $f.newcap = newcap; $f.newv = newv; $f.op = op; $f.pv = pv; $f.u = u; $f.ut = ut; $f.v = v; $f.z = z; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.array = function(v) { return this.$val.array(v); };
	decodeState.ptr.prototype.object = function(v) {
		var _1, _i, _i$1, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$16, _r$17, _r$18, _r$19, _r$2, _r$20, _r$21, _r$22, _r$23, _r$24, _r$25, _r$26, _r$27, _r$28, _r$29, _r$3, _r$30, _r$31, _r$32, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _ref, _ref$1, _ref$2, _tuple, _tuple$1, _v, _v$1, d, destring, elemType, err, f, ff, fields, i, i$1, item, key, kv, mapElem, ok, op, pv, qv, qv$1, qv$2, start, subv, t, u, ut, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _i = $f._i; _i$1 = $f._i$1; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$16 = $f._r$16; _r$17 = $f._r$17; _r$18 = $f._r$18; _r$19 = $f._r$19; _r$2 = $f._r$2; _r$20 = $f._r$20; _r$21 = $f._r$21; _r$22 = $f._r$22; _r$23 = $f._r$23; _r$24 = $f._r$24; _r$25 = $f._r$25; _r$26 = $f._r$26; _r$27 = $f._r$27; _r$28 = $f._r$28; _r$29 = $f._r$29; _r$3 = $f._r$3; _r$30 = $f._r$30; _r$31 = $f._r$31; _r$32 = $f._r$32; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _ref = $f._ref; _ref$1 = $f._ref$1; _ref$2 = $f._ref$2; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _v = $f._v; _v$1 = $f._v$1; d = $f.d; destring = $f.destring; elemType = $f.elemType; err = $f.err; f = $f.f; ff = $f.ff; fields = $f.fields; i = $f.i; i$1 = $f.i$1; item = $f.item; key = $f.key; kv = $f.kv; mapElem = $f.mapElem; ok = $f.ok; op = $f.op; pv = $f.pv; qv = $f.qv; qv$1 = $f.qv$1; qv$2 = $f.qv$2; start = $f.start; subv = $f.subv; t = $f.t; u = $f.u; ut = $f.ut; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		_r$2 = d.indirect($clone(v, reflect.Value), false); /* */ $s = 1; case 1: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple = _r$2;
		u = _tuple[0];
		ut = _tuple[1];
		pv = _tuple[2];
		/* */ if (!($interfaceIsEqual(u, $ifaceNil))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!($interfaceIsEqual(u, $ifaceNil))) { */ case 2:
			d.off = d.off - (1) >> 0;
			_r$3 = d.next(); /* */ $s = 4; case 4: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			_r$4 = u.UnmarshalJSON(_r$3); /* */ $s = 5; case 5: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			err = _r$4;
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				d.error(err);
			}
			$s = -1; return;
		/* } */ case 3:
		/* */ if (!($interfaceIsEqual(ut, $ifaceNil))) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (!($interfaceIsEqual(ut, $ifaceNil))) { */ case 6:
			d.saveError(new UnmarshalTypeError.ptr("object", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
			d.off = d.off - (1) >> 0;
			_r$5 = d.next(); /* */ $s = 8; case 8: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			_r$5;
			$s = -1; return;
		/* } */ case 7:
		v = pv;
		if (!($clone(v, reflect.Value).Kind() === 20)) { _v = false; $s = 11; continue s; }
		_r$6 = $clone(v, reflect.Value).NumMethod(); /* */ $s = 12; case 12: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		_v = _r$6 === 0; case 11:
		/* */ if (_v) { $s = 9; continue; }
		/* */ $s = 10; continue;
		/* if (_v) { */ case 9:
			_r$7 = d.objectInterface(); /* */ $s = 13; case 13: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
			_r$8 = reflect.ValueOf(new mapType$2(_r$7)); /* */ $s = 14; case 14: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
			$r = $clone(v, reflect.Value).Set($clone(_r$8, reflect.Value)); /* */ $s = 15; case 15: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = -1; return;
		/* } */ case 10:
			_1 = $clone(v, reflect.Value).Kind();
			/* */ if (_1 === (21)) { $s = 17; continue; }
			/* */ if (_1 === (25)) { $s = 18; continue; }
			/* */ $s = 19; continue;
			/* if (_1 === (21)) { */ case 17:
				t = $clone(v, reflect.Value).Type();
				_r$9 = t.Key(); /* */ $s = 23; case 23: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
				_r$10 = _r$9.Kind(); /* */ $s = 24; case 24: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
				/* */ if (!((_r$10 === 24))) { $s = 21; continue; }
				/* */ $s = 22; continue;
				/* if (!((_r$10 === 24))) { */ case 21:
					d.saveError(new UnmarshalTypeError.ptr("object", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
					d.off = d.off - (1) >> 0;
					_r$11 = d.next(); /* */ $s = 25; case 25: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
					_r$11;
					$s = -1; return;
				/* } */ case 22:
				/* */ if ($clone(v, reflect.Value).IsNil()) { $s = 26; continue; }
				/* */ $s = 27; continue;
				/* if ($clone(v, reflect.Value).IsNil()) { */ case 26:
					_r$12 = reflect.MakeMap(t); /* */ $s = 28; case 28: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
					$r = $clone(v, reflect.Value).Set($clone(_r$12, reflect.Value)); /* */ $s = 29; case 29: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 27:
				$s = 20; continue;
			/* } else if (_1 === (25)) { */ case 18:
				$s = 20; continue;
			/* } else { */ case 19:
				d.saveError(new UnmarshalTypeError.ptr("object", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
				d.off = d.off - (1) >> 0;
				_r$13 = d.next(); /* */ $s = 30; case 30: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
				_r$13;
				$s = -1; return;
			/* } */ case 20:
		case 16:
		mapElem = new reflect.Value.ptr(ptrType$3.nil, 0, 0);
		/* while (true) { */ case 31:
			_r$14 = d.scanWhile(9); /* */ $s = 33; case 33: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
			op = _r$14;
			if (op === 5) {
				/* break; */ $s = 32; continue;
			}
			if (!((op === 1))) {
				d.error(errPhase);
			}
			start = d.off - 1 >> 0;
			_r$15 = d.scanWhile(0); /* */ $s = 34; case 34: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
			op = _r$15;
			item = $subslice(d.data, start, (d.off - 1 >> 0));
			_tuple$1 = unquoteBytes(item);
			key = _tuple$1[0];
			ok = _tuple$1[1];
			if (!ok) {
				d.error(errPhase);
			}
			subv = new reflect.Value.ptr(ptrType$3.nil, 0, 0);
			destring = false;
			/* */ if ($clone(v, reflect.Value).Kind() === 21) { $s = 35; continue; }
			/* */ $s = 36; continue;
			/* if ($clone(v, reflect.Value).Kind() === 21) { */ case 35:
				_r$16 = $clone(v, reflect.Value).Type().Elem(); /* */ $s = 38; case 38: if($c) { $c = false; _r$16 = _r$16.$blk(); } if (_r$16 && _r$16.$blk !== undefined) { break s; }
				elemType = _r$16;
				/* */ if (!$clone(mapElem, reflect.Value).IsValid()) { $s = 39; continue; }
				/* */ $s = 40; continue;
				/* if (!$clone(mapElem, reflect.Value).IsValid()) { */ case 39:
					_r$17 = reflect.New(elemType); /* */ $s = 42; case 42: if($c) { $c = false; _r$17 = _r$17.$blk(); } if (_r$17 && _r$17.$blk !== undefined) { break s; }
					_r$18 = $clone(_r$17, reflect.Value).Elem(); /* */ $s = 43; case 43: if($c) { $c = false; _r$18 = _r$18.$blk(); } if (_r$18 && _r$18.$blk !== undefined) { break s; }
					mapElem = _r$18;
					$s = 41; continue;
				/* } else { */ case 40:
					_r$19 = reflect.Zero(elemType); /* */ $s = 44; case 44: if($c) { $c = false; _r$19 = _r$19.$blk(); } if (_r$19 && _r$19.$blk !== undefined) { break s; }
					$r = $clone(mapElem, reflect.Value).Set($clone(_r$19, reflect.Value)); /* */ $s = 45; case 45: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 41:
				subv = mapElem;
				$s = 37; continue;
			/* } else { */ case 36:
				f = ptrType$4.nil;
				_r$20 = cachedTypeFields($clone(v, reflect.Value).Type()); /* */ $s = 46; case 46: if($c) { $c = false; _r$20 = _r$20.$blk(); } if (_r$20 && _r$20.$blk !== undefined) { break s; }
				fields = _r$20;
				_ref = fields;
				_i = 0;
				/* while (true) { */ case 47:
					/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 48; continue; }
					i = _i;
					ff = ((i < 0 || i >= fields.$length) ? ($throwRuntimeError("index out of range"), undefined) : fields.$array[fields.$offset + i]);
					if (bytes.Equal(ff.nameBytes, key)) {
						f = ff;
						/* break; */ $s = 48; continue;
					}
					if (!(f === ptrType$4.nil)) { _v$1 = false; $s = 51; continue s; }
					_r$21 = ff.equalFold(ff.nameBytes, key); /* */ $s = 52; case 52: if($c) { $c = false; _r$21 = _r$21.$blk(); } if (_r$21 && _r$21.$blk !== undefined) { break s; }
					_v$1 = _r$21; case 51:
					/* */ if (_v$1) { $s = 49; continue; }
					/* */ $s = 50; continue;
					/* if (_v$1) { */ case 49:
						f = ff;
					/* } */ case 50:
					_i++;
				/* } */ $s = 47; continue; case 48:
				/* */ if (!(f === ptrType$4.nil)) { $s = 53; continue; }
				/* */ $s = 54; continue;
				/* if (!(f === ptrType$4.nil)) { */ case 53:
					subv = v;
					destring = f.quoted;
					_ref$1 = f.index;
					_i$1 = 0;
					/* while (true) { */ case 55:
						/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 56; continue; }
						i$1 = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref$1.$array[_ref$1.$offset + _i$1]);
						/* */ if ($clone(subv, reflect.Value).Kind() === 22) { $s = 57; continue; }
						/* */ $s = 58; continue;
						/* if ($clone(subv, reflect.Value).Kind() === 22) { */ case 57:
							/* */ if ($clone(subv, reflect.Value).IsNil()) { $s = 59; continue; }
							/* */ $s = 60; continue;
							/* if ($clone(subv, reflect.Value).IsNil()) { */ case 59:
								_r$22 = $clone(subv, reflect.Value).Type().Elem(); /* */ $s = 61; case 61: if($c) { $c = false; _r$22 = _r$22.$blk(); } if (_r$22 && _r$22.$blk !== undefined) { break s; }
								_r$23 = reflect.New(_r$22); /* */ $s = 62; case 62: if($c) { $c = false; _r$23 = _r$23.$blk(); } if (_r$23 && _r$23.$blk !== undefined) { break s; }
								$r = $clone(subv, reflect.Value).Set($clone(_r$23, reflect.Value)); /* */ $s = 63; case 63: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							/* } */ case 60:
							_r$24 = $clone(subv, reflect.Value).Elem(); /* */ $s = 64; case 64: if($c) { $c = false; _r$24 = _r$24.$blk(); } if (_r$24 && _r$24.$blk !== undefined) { break s; }
							subv = _r$24;
						/* } */ case 58:
						_r$25 = $clone(subv, reflect.Value).Field(i$1); /* */ $s = 65; case 65: if($c) { $c = false; _r$25 = _r$25.$blk(); } if (_r$25 && _r$25.$blk !== undefined) { break s; }
						subv = _r$25;
						_i$1++;
					/* } */ $s = 55; continue; case 56:
				/* } */ case 54:
			/* } */ case 37:
			/* */ if (op === 9) { $s = 66; continue; }
			/* */ $s = 67; continue;
			/* if (op === 9) { */ case 66:
				_r$26 = d.scanWhile(9); /* */ $s = 68; case 68: if($c) { $c = false; _r$26 = _r$26.$blk(); } if (_r$26 && _r$26.$blk !== undefined) { break s; }
				op = _r$26;
			/* } */ case 67:
			if (!((op === 3))) {
				d.error(errPhase);
			}
			/* */ if (destring) { $s = 69; continue; }
			/* */ $s = 70; continue;
			/* if (destring) { */ case 69:
				_r$27 = d.valueQuoted(); /* */ $s = 72; case 72: if($c) { $c = false; _r$27 = _r$27.$blk(); } if (_r$27 && _r$27.$blk !== undefined) { break s; }
				_ref$2 = _r$27;
				/* */ if (_ref$2 === $ifaceNil) { $s = 73; continue; }
				/* */ if ($assertType(_ref$2, $String, true)[1]) { $s = 74; continue; }
				/* */ $s = 75; continue;
				/* if (_ref$2 === $ifaceNil) { */ case 73:
					qv = _ref$2;
					$r = d.literalStore(nullLiteral, $clone(subv, reflect.Value), false); /* */ $s = 77; case 77: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = 76; continue;
				/* } else if ($assertType(_ref$2, $String, true)[1]) { */ case 74:
					qv$1 = _ref$2.$val;
					$r = d.literalStore((new sliceType$2($stringToBytes(qv$1))), $clone(subv, reflect.Value), true); /* */ $s = 78; case 78: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = 76; continue;
				/* } else { */ case 75:
					qv$2 = _ref$2;
					_r$28 = fmt.Errorf("json: invalid use of ,string struct tag, trying to unmarshal unquoted value into %v", new sliceType([$clone(subv, reflect.Value).Type()])); /* */ $s = 79; case 79: if($c) { $c = false; _r$28 = _r$28.$blk(); } if (_r$28 && _r$28.$blk !== undefined) { break s; }
					$r = d.saveError(_r$28); /* */ $s = 80; case 80: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 76:
				$s = 71; continue;
			/* } else { */ case 70:
				$r = d.value($clone(subv, reflect.Value)); /* */ $s = 81; case 81: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 71:
			/* */ if ($clone(v, reflect.Value).Kind() === 21) { $s = 82; continue; }
			/* */ $s = 83; continue;
			/* if ($clone(v, reflect.Value).Kind() === 21) { */ case 82:
				_r$29 = reflect.ValueOf(key); /* */ $s = 84; case 84: if($c) { $c = false; _r$29 = _r$29.$blk(); } if (_r$29 && _r$29.$blk !== undefined) { break s; }
				_r$30 = $clone(v, reflect.Value).Type().Key(); /* */ $s = 85; case 85: if($c) { $c = false; _r$30 = _r$30.$blk(); } if (_r$30 && _r$30.$blk !== undefined) { break s; }
				_r$31 = $clone(_r$29, reflect.Value).Convert(_r$30); /* */ $s = 86; case 86: if($c) { $c = false; _r$31 = _r$31.$blk(); } if (_r$31 && _r$31.$blk !== undefined) { break s; }
				kv = _r$31;
				$r = $clone(v, reflect.Value).SetMapIndex($clone(kv, reflect.Value), $clone(subv, reflect.Value)); /* */ $s = 87; case 87: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 83:
			_r$32 = d.scanWhile(9); /* */ $s = 88; case 88: if($c) { $c = false; _r$32 = _r$32.$blk(); } if (_r$32 && _r$32.$blk !== undefined) { break s; }
			op = _r$32;
			if (op === 5) {
				/* break; */ $s = 32; continue;
			}
			if (!((op === 4))) {
				d.error(errPhase);
			}
		/* } */ $s = 31; continue; case 32:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.object }; } $f._1 = _1; $f._i = _i; $f._i$1 = _i$1; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$16 = _r$16; $f._r$17 = _r$17; $f._r$18 = _r$18; $f._r$19 = _r$19; $f._r$2 = _r$2; $f._r$20 = _r$20; $f._r$21 = _r$21; $f._r$22 = _r$22; $f._r$23 = _r$23; $f._r$24 = _r$24; $f._r$25 = _r$25; $f._r$26 = _r$26; $f._r$27 = _r$27; $f._r$28 = _r$28; $f._r$29 = _r$29; $f._r$3 = _r$3; $f._r$30 = _r$30; $f._r$31 = _r$31; $f._r$32 = _r$32; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._ref = _ref; $f._ref$1 = _ref$1; $f._ref$2 = _ref$2; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._v = _v; $f._v$1 = _v$1; $f.d = d; $f.destring = destring; $f.elemType = elemType; $f.err = err; $f.f = f; $f.ff = ff; $f.fields = fields; $f.i = i; $f.i$1 = i$1; $f.item = item; $f.key = key; $f.kv = kv; $f.mapElem = mapElem; $f.ok = ok; $f.op = op; $f.pv = pv; $f.qv = qv; $f.qv$1 = qv$1; $f.qv$2 = qv$2; $f.start = start; $f.subv = subv; $f.t = t; $f.u = u; $f.ut = ut; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.object = function(v) { return this.$val.object(v); };
	decodeState.ptr.prototype.literal = function(v) {
		var _r$2, d, op, start, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r$2 = $f._r$2; d = $f.d; op = $f.op; start = $f.start; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		start = d.off - 1 >> 0;
		_r$2 = d.scanWhile(0); /* */ $s = 1; case 1: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		op = _r$2;
		d.off = d.off - (1) >> 0;
		d.scan.undo(op);
		$r = d.literalStore($subslice(d.data, start, d.off), $clone(v, reflect.Value), false); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.literal }; } $f._r$2 = _r$2; $f.d = d; $f.op = op; $f.start = start; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.literal = function(v) { return this.$val.literal(v); };
	decodeState.ptr.prototype.convertNumber = function(s) {
		var _tuple, d, err, f, s;
		d = this;
		if (d.useNumber) {
			return [new Number((s)), $ifaceNil];
		}
		_tuple = strconv.ParseFloat(s, 64);
		f = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [$ifaceNil, new UnmarshalTypeError.ptr("number " + s, reflect.TypeOf(new $Float64(0)), (new $Int64(0, d.off)))];
		}
		return [new $Float64(f), $ifaceNil];
	};
	decodeState.prototype.convertNumber = function(s) { return this.$val.convertNumber(s); };
	decodeState.ptr.prototype.literalStore = function(item, v, fromQuoted) {
		var _1, _2, _3, _4, _5, _arg, _arg$1, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$16, _r$17, _r$18, _r$19, _r$2, _r$20, _r$21, _r$22, _r$23, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, b, c, d, err, err$1, err$2, err$3, err$4, err$5, err$6, fromQuoted, item, n, n$1, n$2, n$3, n$4, ok, ok$1, pv, s, s$1, s$2, u, ut, v, value, wantptr, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _2 = $f._2; _3 = $f._3; _4 = $f._4; _5 = $f._5; _arg = $f._arg; _arg$1 = $f._arg$1; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$16 = $f._r$16; _r$17 = $f._r$17; _r$18 = $f._r$18; _r$19 = $f._r$19; _r$2 = $f._r$2; _r$20 = $f._r$20; _r$21 = $f._r$21; _r$22 = $f._r$22; _r$23 = $f._r$23; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; b = $f.b; c = $f.c; d = $f.d; err = $f.err; err$1 = $f.err$1; err$2 = $f.err$2; err$3 = $f.err$3; err$4 = $f.err$4; err$5 = $f.err$5; err$6 = $f.err$6; fromQuoted = $f.fromQuoted; item = $f.item; n = $f.n; n$1 = $f.n$1; n$2 = $f.n$2; n$3 = $f.n$3; n$4 = $f.n$4; ok = $f.ok; ok$1 = $f.ok$1; pv = $f.pv; s = $f.s; s$1 = $f.s$1; s$2 = $f.s$2; u = $f.u; ut = $f.ut; v = $f.v; value = $f.value; wantptr = $f.wantptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		/* */ if (item.$length === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (item.$length === 0) { */ case 1:
			_r$2 = fmt.Errorf("json: invalid use of ,string struct tag, trying to unmarshal %q into %v", new sliceType([item, $clone(v, reflect.Value).Type()])); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			$r = d.saveError(_r$2); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = -1; return;
		/* } */ case 2:
		wantptr = (0 >= item.$length ? ($throwRuntimeError("index out of range"), undefined) : item.$array[item.$offset + 0]) === 110;
		_r$3 = d.indirect($clone(v, reflect.Value), wantptr); /* */ $s = 5; case 5: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		_tuple = _r$3;
		u = _tuple[0];
		ut = _tuple[1];
		pv = _tuple[2];
		/* */ if (!($interfaceIsEqual(u, $ifaceNil))) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (!($interfaceIsEqual(u, $ifaceNil))) { */ case 6:
			_r$4 = u.UnmarshalJSON(item); /* */ $s = 8; case 8: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			err = _r$4;
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				d.error(err);
			}
			$s = -1; return;
		/* } */ case 7:
		/* */ if (!($interfaceIsEqual(ut, $ifaceNil))) { $s = 9; continue; }
		/* */ $s = 10; continue;
		/* if (!($interfaceIsEqual(ut, $ifaceNil))) { */ case 9:
			/* */ if (!(((0 >= item.$length ? ($throwRuntimeError("index out of range"), undefined) : item.$array[item.$offset + 0]) === 34))) { $s = 11; continue; }
			/* */ $s = 12; continue;
			/* if (!(((0 >= item.$length ? ($throwRuntimeError("index out of range"), undefined) : item.$array[item.$offset + 0]) === 34))) { */ case 11:
				/* */ if (fromQuoted) { $s = 13; continue; }
				/* */ $s = 14; continue;
				/* if (fromQuoted) { */ case 13:
					_r$5 = fmt.Errorf("json: invalid use of ,string struct tag, trying to unmarshal %q into %v", new sliceType([item, $clone(v, reflect.Value).Type()])); /* */ $s = 16; case 16: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
					$r = d.saveError(_r$5); /* */ $s = 17; case 17: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = 15; continue;
				/* } else { */ case 14:
					d.saveError(new UnmarshalTypeError.ptr("string", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
				/* } */ case 15:
				$s = -1; return;
			/* } */ case 12:
			_tuple$1 = unquoteBytes(item);
			s = _tuple$1[0];
			ok = _tuple$1[1];
			/* */ if (!ok) { $s = 18; continue; }
			/* */ $s = 19; continue;
			/* if (!ok) { */ case 18:
				/* */ if (fromQuoted) { $s = 20; continue; }
				/* */ $s = 21; continue;
				/* if (fromQuoted) { */ case 20:
					_r$6 = fmt.Errorf("json: invalid use of ,string struct tag, trying to unmarshal %q into %v", new sliceType([item, $clone(v, reflect.Value).Type()])); /* */ $s = 23; case 23: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					$r = d.error(_r$6); /* */ $s = 24; case 24: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = 22; continue;
				/* } else { */ case 21:
					d.error(errPhase);
				/* } */ case 22:
			/* } */ case 19:
			_r$7 = ut.UnmarshalText(s); /* */ $s = 25; case 25: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
			err$1 = _r$7;
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				d.error(err$1);
			}
			$s = -1; return;
		/* } */ case 10:
		v = pv;
			c = (0 >= item.$length ? ($throwRuntimeError("index out of range"), undefined) : item.$array[item.$offset + 0]);
			_1 = c;
			/* */ if (_1 === (110)) { $s = 27; continue; }
			/* */ if ((_1 === (116)) || (_1 === (102))) { $s = 28; continue; }
			/* */ if (_1 === (34)) { $s = 29; continue; }
			/* */ $s = 30; continue;
			/* if (_1 === (110)) { */ case 27:
					_2 = $clone(v, reflect.Value).Kind();
					/* */ if ((_2 === (20)) || (_2 === (22)) || (_2 === (21)) || (_2 === (23))) { $s = 33; continue; }
					/* */ $s = 34; continue;
					/* if ((_2 === (20)) || (_2 === (22)) || (_2 === (21)) || (_2 === (23))) { */ case 33:
						_r$8 = reflect.Zero($clone(v, reflect.Value).Type()); /* */ $s = 35; case 35: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
						$r = $clone(v, reflect.Value).Set($clone(_r$8, reflect.Value)); /* */ $s = 36; case 36: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					/* } */ case 34:
				case 32:
				$s = 31; continue;
			/* } else if ((_1 === (116)) || (_1 === (102))) { */ case 28:
				value = c === 116;
					_3 = $clone(v, reflect.Value).Kind();
					/* */ if (_3 === (1)) { $s = 38; continue; }
					/* */ if (_3 === (20)) { $s = 39; continue; }
					/* */ if (fromQuoted) { $s = 40; continue; }
					/* */ $s = 41; continue;
					/* if (_3 === (1)) { */ case 38:
						$clone(v, reflect.Value).SetBool(value);
						$s = 42; continue;
					/* } else if (_3 === (20)) { */ case 39:
						_r$9 = $clone(v, reflect.Value).NumMethod(); /* */ $s = 46; case 46: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
						/* */ if (_r$9 === 0) { $s = 43; continue; }
						/* */ $s = 44; continue;
						/* if (_r$9 === 0) { */ case 43:
							_r$10 = reflect.ValueOf(new $Bool(value)); /* */ $s = 47; case 47: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
							$r = $clone(v, reflect.Value).Set($clone(_r$10, reflect.Value)); /* */ $s = 48; case 48: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							$s = 45; continue;
						/* } else { */ case 44:
							d.saveError(new UnmarshalTypeError.ptr("bool", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
						/* } */ case 45:
						$s = 42; continue;
					/* } else if (fromQuoted) { */ case 40:
						_r$11 = fmt.Errorf("json: invalid use of ,string struct tag, trying to unmarshal %q into %v", new sliceType([item, $clone(v, reflect.Value).Type()])); /* */ $s = 49; case 49: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
						$r = d.saveError(_r$11); /* */ $s = 50; case 50: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						$s = 42; continue;
					/* } else { */ case 41:
						d.saveError(new UnmarshalTypeError.ptr("bool", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
					/* } */ case 42:
				case 37:
				$s = 31; continue;
			/* } else if (_1 === (34)) { */ case 29:
				_tuple$2 = unquoteBytes(item);
				s$1 = _tuple$2[0];
				ok$1 = _tuple$2[1];
				/* */ if (!ok$1) { $s = 51; continue; }
				/* */ $s = 52; continue;
				/* if (!ok$1) { */ case 51:
					/* */ if (fromQuoted) { $s = 53; continue; }
					/* */ $s = 54; continue;
					/* if (fromQuoted) { */ case 53:
						_r$12 = fmt.Errorf("json: invalid use of ,string struct tag, trying to unmarshal %q into %v", new sliceType([item, $clone(v, reflect.Value).Type()])); /* */ $s = 56; case 56: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
						$r = d.error(_r$12); /* */ $s = 57; case 57: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						$s = 55; continue;
					/* } else { */ case 54:
						d.error(errPhase);
					/* } */ case 55:
				/* } */ case 52:
					_4 = $clone(v, reflect.Value).Kind();
					/* */ if (_4 === (23)) { $s = 59; continue; }
					/* */ if (_4 === (24)) { $s = 60; continue; }
					/* */ if (_4 === (20)) { $s = 61; continue; }
					/* */ $s = 62; continue;
					/* if (_4 === (23)) { */ case 59:
						_r$13 = $clone(v, reflect.Value).Type().Elem(); /* */ $s = 66; case 66: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
						_r$14 = _r$13.Kind(); /* */ $s = 67; case 67: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
						/* */ if (!((_r$14 === 8))) { $s = 64; continue; }
						/* */ $s = 65; continue;
						/* if (!((_r$14 === 8))) { */ case 64:
							d.saveError(new UnmarshalTypeError.ptr("string", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
							/* break; */ $s = 58; continue;
						/* } */ case 65:
						b = $makeSlice(sliceType$2, base64.StdEncoding.DecodedLen(s$1.$length));
						_tuple$3 = base64.StdEncoding.Decode(b, s$1);
						n = _tuple$3[0];
						err$2 = _tuple$3[1];
						if (!($interfaceIsEqual(err$2, $ifaceNil))) {
							d.saveError(err$2);
							/* break; */ $s = 58; continue;
						}
						$r = $clone(v, reflect.Value).SetBytes($subslice(b, 0, n)); /* */ $s = 68; case 68: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						$s = 63; continue;
					/* } else if (_4 === (24)) { */ case 60:
						$clone(v, reflect.Value).SetString(($bytesToString(s$1)));
						$s = 63; continue;
					/* } else if (_4 === (20)) { */ case 61:
						_r$15 = $clone(v, reflect.Value).NumMethod(); /* */ $s = 72; case 72: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
						/* */ if (_r$15 === 0) { $s = 69; continue; }
						/* */ $s = 70; continue;
						/* if (_r$15 === 0) { */ case 69:
							_r$16 = reflect.ValueOf(new $String(($bytesToString(s$1)))); /* */ $s = 73; case 73: if($c) { $c = false; _r$16 = _r$16.$blk(); } if (_r$16 && _r$16.$blk !== undefined) { break s; }
							$r = $clone(v, reflect.Value).Set($clone(_r$16, reflect.Value)); /* */ $s = 74; case 74: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							$s = 71; continue;
						/* } else { */ case 70:
							d.saveError(new UnmarshalTypeError.ptr("string", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
						/* } */ case 71:
						$s = 63; continue;
					/* } else { */ case 62:
						d.saveError(new UnmarshalTypeError.ptr("string", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
					/* } */ case 63:
				case 58:
				$s = 31; continue;
			/* } else { */ case 30:
				/* */ if (!((c === 45)) && (c < 48 || c > 57)) { $s = 75; continue; }
				/* */ $s = 76; continue;
				/* if (!((c === 45)) && (c < 48 || c > 57)) { */ case 75:
					/* */ if (fromQuoted) { $s = 77; continue; }
					/* */ $s = 78; continue;
					/* if (fromQuoted) { */ case 77:
						_r$17 = fmt.Errorf("json: invalid use of ,string struct tag, trying to unmarshal %q into %v", new sliceType([item, $clone(v, reflect.Value).Type()])); /* */ $s = 80; case 80: if($c) { $c = false; _r$17 = _r$17.$blk(); } if (_r$17 && _r$17.$blk !== undefined) { break s; }
						$r = d.error(_r$17); /* */ $s = 81; case 81: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						$s = 79; continue;
					/* } else { */ case 78:
						d.error(errPhase);
					/* } */ case 79:
				/* } */ case 76:
				s$2 = ($bytesToString(item));
					_5 = $clone(v, reflect.Value).Kind();
					/* */ if (_5 === (20)) { $s = 83; continue; }
					/* */ if ((_5 === (2)) || (_5 === (3)) || (_5 === (4)) || (_5 === (5)) || (_5 === (6))) { $s = 84; continue; }
					/* */ if ((_5 === (7)) || (_5 === (8)) || (_5 === (9)) || (_5 === (10)) || (_5 === (11)) || (_5 === (12))) { $s = 85; continue; }
					/* */ if ((_5 === (13)) || (_5 === (14))) { $s = 86; continue; }
					/* */ $s = 87; continue;
					/* if (_5 === (20)) { */ case 83:
						_tuple$4 = d.convertNumber(s$2);
						n$1 = _tuple$4[0];
						err$3 = _tuple$4[1];
						if (!($interfaceIsEqual(err$3, $ifaceNil))) {
							d.saveError(err$3);
							/* break; */ $s = 82; continue;
						}
						_r$18 = $clone(v, reflect.Value).NumMethod(); /* */ $s = 91; case 91: if($c) { $c = false; _r$18 = _r$18.$blk(); } if (_r$18 && _r$18.$blk !== undefined) { break s; }
						/* */ if (!((_r$18 === 0))) { $s = 89; continue; }
						/* */ $s = 90; continue;
						/* if (!((_r$18 === 0))) { */ case 89:
							d.saveError(new UnmarshalTypeError.ptr("number", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
							/* break; */ $s = 82; continue;
						/* } */ case 90:
						_r$19 = reflect.ValueOf(n$1); /* */ $s = 92; case 92: if($c) { $c = false; _r$19 = _r$19.$blk(); } if (_r$19 && _r$19.$blk !== undefined) { break s; }
						$r = $clone(v, reflect.Value).Set($clone(_r$19, reflect.Value)); /* */ $s = 93; case 93: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						$s = 88; continue;
					/* } else if ((_5 === (2)) || (_5 === (3)) || (_5 === (4)) || (_5 === (5)) || (_5 === (6))) { */ case 84:
						_tuple$5 = strconv.ParseInt(s$2, 10, 64);
						n$2 = _tuple$5[0];
						err$4 = _tuple$5[1];
						if (!($interfaceIsEqual(err$4, $ifaceNil)) || $clone(v, reflect.Value).OverflowInt(n$2)) {
							d.saveError(new UnmarshalTypeError.ptr("number " + s$2, $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
							/* break; */ $s = 82; continue;
						}
						$clone(v, reflect.Value).SetInt(n$2);
						$s = 88; continue;
					/* } else if ((_5 === (7)) || (_5 === (8)) || (_5 === (9)) || (_5 === (10)) || (_5 === (11)) || (_5 === (12))) { */ case 85:
						_tuple$6 = strconv.ParseUint(s$2, 10, 64);
						n$3 = _tuple$6[0];
						err$5 = _tuple$6[1];
						if (!($interfaceIsEqual(err$5, $ifaceNil)) || $clone(v, reflect.Value).OverflowUint(n$3)) {
							d.saveError(new UnmarshalTypeError.ptr("number " + s$2, $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
							/* break; */ $s = 82; continue;
						}
						$clone(v, reflect.Value).SetUint(n$3);
						$s = 88; continue;
					/* } else if ((_5 === (13)) || (_5 === (14))) { */ case 86:
						_arg = s$2;
						_r$20 = $clone(v, reflect.Value).Type().Bits(); /* */ $s = 94; case 94: if($c) { $c = false; _r$20 = _r$20.$blk(); } if (_r$20 && _r$20.$blk !== undefined) { break s; }
						_arg$1 = _r$20;
						_r$21 = strconv.ParseFloat(_arg, _arg$1); /* */ $s = 95; case 95: if($c) { $c = false; _r$21 = _r$21.$blk(); } if (_r$21 && _r$21.$blk !== undefined) { break s; }
						_tuple$7 = _r$21;
						n$4 = _tuple$7[0];
						err$6 = _tuple$7[1];
						if (!($interfaceIsEqual(err$6, $ifaceNil)) || $clone(v, reflect.Value).OverflowFloat(n$4)) {
							d.saveError(new UnmarshalTypeError.ptr("number " + s$2, $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
							/* break; */ $s = 82; continue;
						}
						$clone(v, reflect.Value).SetFloat(n$4);
						$s = 88; continue;
					/* } else { */ case 87:
						/* */ if (($clone(v, reflect.Value).Kind() === 24) && $interfaceIsEqual($clone(v, reflect.Value).Type(), numberType)) { $s = 96; continue; }
						/* */ $s = 97; continue;
						/* if (($clone(v, reflect.Value).Kind() === 24) && $interfaceIsEqual($clone(v, reflect.Value).Type(), numberType)) { */ case 96:
							$clone(v, reflect.Value).SetString(s$2);
							/* */ if (!isValidNumber(s$2)) { $s = 98; continue; }
							/* */ $s = 99; continue;
							/* if (!isValidNumber(s$2)) { */ case 98:
								_r$22 = fmt.Errorf("json: invalid number literal, trying to unmarshal %q into Number", new sliceType([item])); /* */ $s = 100; case 100: if($c) { $c = false; _r$22 = _r$22.$blk(); } if (_r$22 && _r$22.$blk !== undefined) { break s; }
								$r = d.error(_r$22); /* */ $s = 101; case 101: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							/* } */ case 99:
							/* break; */ $s = 82; continue;
						/* } */ case 97:
						/* */ if (fromQuoted) { $s = 102; continue; }
						/* */ $s = 103; continue;
						/* if (fromQuoted) { */ case 102:
							_r$23 = fmt.Errorf("json: invalid use of ,string struct tag, trying to unmarshal %q into %v", new sliceType([item, $clone(v, reflect.Value).Type()])); /* */ $s = 105; case 105: if($c) { $c = false; _r$23 = _r$23.$blk(); } if (_r$23 && _r$23.$blk !== undefined) { break s; }
							$r = d.error(_r$23); /* */ $s = 106; case 106: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							$s = 104; continue;
						/* } else { */ case 103:
							d.error(new UnmarshalTypeError.ptr("number", $clone(v, reflect.Value).Type(), (new $Int64(0, d.off))));
						/* } */ case 104:
					/* } */ case 88:
				case 82:
			/* } */ case 31:
		case 26:
		$s = -1; return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.literalStore }; } $f._1 = _1; $f._2 = _2; $f._3 = _3; $f._4 = _4; $f._5 = _5; $f._arg = _arg; $f._arg$1 = _arg$1; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$16 = _r$16; $f._r$17 = _r$17; $f._r$18 = _r$18; $f._r$19 = _r$19; $f._r$2 = _r$2; $f._r$20 = _r$20; $f._r$21 = _r$21; $f._r$22 = _r$22; $f._r$23 = _r$23; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f.b = b; $f.c = c; $f.d = d; $f.err = err; $f.err$1 = err$1; $f.err$2 = err$2; $f.err$3 = err$3; $f.err$4 = err$4; $f.err$5 = err$5; $f.err$6 = err$6; $f.fromQuoted = fromQuoted; $f.item = item; $f.n = n; $f.n$1 = n$1; $f.n$2 = n$2; $f.n$3 = n$3; $f.n$4 = n$4; $f.ok = ok; $f.ok$1 = ok$1; $f.pv = pv; $f.s = s; $f.s$1 = s$1; $f.s$2 = s$2; $f.u = u; $f.ut = ut; $f.v = v; $f.value = value; $f.wantptr = wantptr; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.literalStore = function(item, v, fromQuoted) { return this.$val.literalStore(item, v, fromQuoted); };
	decodeState.ptr.prototype.valueInterface = function() {
		var _1, _r$2, _r$3, _r$4, _r$5, d, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; d = $f.d; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
			_r$2 = d.scanWhile(9); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_1 = _r$2;
			/* */ if (_1 === (6)) { $s = 3; continue; }
			/* */ if (_1 === (2)) { $s = 4; continue; }
			/* */ if (_1 === (1)) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (_1 === (6)) { */ case 3:
				_r$3 = d.arrayInterface(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				$s = -1; return _r$3;
			/* } else if (_1 === (2)) { */ case 4:
				_r$4 = d.objectInterface(); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
				$s = -1; return new mapType$2(_r$4);
			/* } else if (_1 === (1)) { */ case 5:
				_r$5 = d.literalInterface(); /* */ $s = 10; case 10: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
				$s = -1; return _r$5;
			/* } else { */ case 6:
				d.error(errPhase);
				$panic(new $String("unreachable"));
			/* } */ case 7:
		case 1:
		$s = -1; return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.valueInterface }; } $f._1 = _1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f.d = d; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.valueInterface = function() { return this.$val.valueInterface(); };
	decodeState.ptr.prototype.arrayInterface = function() {
		var _r$2, _r$3, _r$4, d, op, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; d = $f.d; op = $f.op; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		v = $makeSlice(sliceType, 0);
		/* while (true) { */ case 1:
			_r$2 = d.scanWhile(9); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			op = _r$2;
			if (op === 8) {
				/* break; */ $s = 2; continue;
			}
			d.off = d.off - (1) >> 0;
			d.scan.undo(op);
			_r$3 = d.valueInterface(); /* */ $s = 4; case 4: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			v = $append(v, _r$3);
			_r$4 = d.scanWhile(9); /* */ $s = 5; case 5: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			op = _r$4;
			if (op === 8) {
				/* break; */ $s = 2; continue;
			}
			if (!((op === 7))) {
				d.error(errPhase);
			}
		/* } */ $s = 1; continue; case 2:
		$s = -1; return v;
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.arrayInterface }; } $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.d = d; $f.op = op; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.arrayInterface = function() { return this.$val.arrayInterface(); };
	decodeState.ptr.prototype.objectInterface = function() {
		var _key, _r$2, _r$3, _r$4, _r$5, _r$6, _tuple, d, item, key, m, ok, op, start, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _key = $f._key; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _tuple = $f._tuple; d = $f.d; item = $f.item; key = $f.key; m = $f.m; ok = $f.ok; op = $f.op; start = $f.start; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		m = {};
		/* while (true) { */ case 1:
			_r$2 = d.scanWhile(9); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			op = _r$2;
			if (op === 5) {
				/* break; */ $s = 2; continue;
			}
			if (!((op === 1))) {
				d.error(errPhase);
			}
			start = d.off - 1 >> 0;
			_r$3 = d.scanWhile(0); /* */ $s = 4; case 4: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			op = _r$3;
			item = $subslice(d.data, start, (d.off - 1 >> 0));
			_tuple = unquote(item);
			key = _tuple[0];
			ok = _tuple[1];
			if (!ok) {
				d.error(errPhase);
			}
			/* */ if (op === 9) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (op === 9) { */ case 5:
				_r$4 = d.scanWhile(9); /* */ $s = 7; case 7: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
				op = _r$4;
			/* } */ case 6:
			if (!((op === 3))) {
				d.error(errPhase);
			}
			_r$5 = d.valueInterface(); /* */ $s = 8; case 8: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			_key = key; (m || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: _r$5 };
			_r$6 = d.scanWhile(9); /* */ $s = 9; case 9: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
			op = _r$6;
			if (op === 5) {
				/* break; */ $s = 2; continue;
			}
			if (!((op === 4))) {
				d.error(errPhase);
			}
		/* } */ $s = 1; continue; case 2:
		$s = -1; return m;
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.objectInterface }; } $f._key = _key; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._tuple = _tuple; $f.d = d; $f.item = item; $f.key = key; $f.m = m; $f.ok = ok; $f.op = op; $f.start = start; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.objectInterface = function() { return this.$val.objectInterface(); };
	decodeState.ptr.prototype.literalInterface = function() {
		var _1, _r$2, _tuple, _tuple$1, c, d, err, item, n, ok, op, s, start, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _r$2 = $f._r$2; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; c = $f.c; d = $f.d; err = $f.err; item = $f.item; n = $f.n; ok = $f.ok; op = $f.op; s = $f.s; start = $f.start; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		start = d.off - 1 >> 0;
		_r$2 = d.scanWhile(0); /* */ $s = 1; case 1: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		op = _r$2;
		d.off = d.off - (1) >> 0;
		d.scan.undo(op);
		item = $subslice(d.data, start, d.off);
		c = (0 >= item.$length ? ($throwRuntimeError("index out of range"), undefined) : item.$array[item.$offset + 0]);
		_1 = c;
		if (_1 === (110)) {
			$s = -1; return $ifaceNil;
		} else if ((_1 === (116)) || (_1 === (102))) {
			$s = -1; return new $Bool((c === 116));
		} else if (_1 === (34)) {
			_tuple = unquote(item);
			s = _tuple[0];
			ok = _tuple[1];
			if (!ok) {
				d.error(errPhase);
			}
			$s = -1; return new $String(s);
		} else {
			if (!((c === 45)) && (c < 48 || c > 57)) {
				d.error(errPhase);
			}
			_tuple$1 = d.convertNumber(($bytesToString(item)));
			n = _tuple$1[0];
			err = _tuple$1[1];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				d.saveError(err);
			}
			$s = -1; return n;
		}
		$s = -1; return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: decodeState.ptr.prototype.literalInterface }; } $f._1 = _1; $f._r$2 = _r$2; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.c = c; $f.d = d; $f.err = err; $f.item = item; $f.n = n; $f.ok = ok; $f.op = op; $f.s = s; $f.start = start; $f.$s = $s; $f.$r = $r; return $f;
	};
	decodeState.prototype.literalInterface = function() { return this.$val.literalInterface(); };
	getu4 = function(s) {
		var _tuple, err, r, s;
		if (s.$length < 6 || !(((0 >= s.$length ? ($throwRuntimeError("index out of range"), undefined) : s.$array[s.$offset + 0]) === 92)) || !(((1 >= s.$length ? ($throwRuntimeError("index out of range"), undefined) : s.$array[s.$offset + 1]) === 117))) {
			return -1;
		}
		_tuple = strconv.ParseUint(($bytesToString($subslice(s, 2, 6))), 16, 64);
		r = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return -1;
		}
		return ((r.$low >> 0));
	};
	unquote = function(s) {
		var _tuple, ok, s, t;
		t = "";
		ok = false;
		_tuple = unquoteBytes(s);
		s = _tuple[0];
		ok = _tuple[1];
		t = ($bytesToString(s));
		return [t, ok];
	};
	unquoteBytes = function(s) {
		var _1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, _tuple$1, b, c, c$1, dec, nb, ok, r, rr, rr$1, rr$2, rr1, s, size, size$1, t, w, x;
		t = sliceType$2.nil;
		ok = false;
		if (s.$length < 2 || !(((0 >= s.$length ? ($throwRuntimeError("index out of range"), undefined) : s.$array[s.$offset + 0]) === 34)) || !(((x = s.$length - 1 >> 0, ((x < 0 || x >= s.$length) ? ($throwRuntimeError("index out of range"), undefined) : s.$array[s.$offset + x])) === 34))) {
			return [t, ok];
		}
		s = $subslice(s, 1, (s.$length - 1 >> 0));
		r = 0;
		while (true) {
			if (!(r < s.$length)) { break; }
			c = ((r < 0 || r >= s.$length) ? ($throwRuntimeError("index out of range"), undefined) : s.$array[s.$offset + r]);
			if ((c === 92) || (c === 34) || c < 32) {
				break;
			}
			if (c < 128) {
				r = r + (1) >> 0;
				continue;
			}
			_tuple = utf8.DecodeRune($subslice(s, r));
			rr = _tuple[0];
			size = _tuple[1];
			if ((rr === 65533) && (size === 1)) {
				break;
			}
			r = r + (size) >> 0;
		}
		if (r === s.$length) {
			_tmp = s;
			_tmp$1 = true;
			t = _tmp;
			ok = _tmp$1;
			return [t, ok];
		}
		b = $makeSlice(sliceType$2, (s.$length + 8 >> 0));
		w = $copySlice(b, $subslice(s, 0, r));
		while (true) {
			if (!(r < s.$length)) { break; }
			if (w >= (b.$length - 8 >> 0)) {
				nb = $makeSlice(sliceType$2, ($imul(((b.$length + 4 >> 0)), 2)));
				$copySlice(nb, $subslice(b, 0, w));
				b = nb;
			}
			c$1 = ((r < 0 || r >= s.$length) ? ($throwRuntimeError("index out of range"), undefined) : s.$array[s.$offset + r]);
			if ((c$1 === 92)) {
				r = r + (1) >> 0;
				if (r >= s.$length) {
					return [t, ok];
				}
				switch (0) { default:
					_1 = ((r < 0 || r >= s.$length) ? ($throwRuntimeError("index out of range"), undefined) : s.$array[s.$offset + r]);
					if ((_1 === (34)) || (_1 === (92)) || (_1 === (47)) || (_1 === (39))) {
						((w < 0 || w >= b.$length) ? ($throwRuntimeError("index out of range"), undefined) : b.$array[b.$offset + w] = ((r < 0 || r >= s.$length) ? ($throwRuntimeError("index out of range"), undefined) : s.$array[s.$offset + r]));
						r = r + (1) >> 0;
						w = w + (1) >> 0;
					} else if (_1 === (98)) {
						((w < 0 || w >= b.$length) ? ($throwRuntimeError("index out of range"), undefined) : b.$array[b.$offset + w] = 8);
						r = r + (1) >> 0;
						w = w + (1) >> 0;
					} else if (_1 === (102)) {
						((w < 0 || w >= b.$length) ? ($throwRuntimeError("index out of range"), undefined) : b.$array[b.$offset + w] = 12);
						r = r + (1) >> 0;
						w = w + (1) >> 0;
					} else if (_1 === (110)) {
						((w < 0 || w >= b.$length) ? ($throwRuntimeError("index out of range"), undefined) : b.$array[b.$offset + w] = 10);
						r = r + (1) >> 0;
						w = w + (1) >> 0;
					} else if (_1 === (114)) {
						((w < 0 || w >= b.$length) ? ($throwRuntimeError("index out of range"), undefined) : b.$array[b.$offset + w] = 13);
						r = r + (1) >> 0;
						w = w + (1) >> 0;
					} else if (_1 === (116)) {
						((w < 0 || w >= b.$length) ? ($throwRuntimeError("index out of range"), undefined) : b.$array[b.$offset + w] = 9);
						r = r + (1) >> 0;
						w = w + (1) >> 0;
					} else if (_1 === (117)) {
						r = r - (1) >> 0;
						rr$1 = getu4($subslice(s, r));
						if (rr$1 < 0) {
							return [t, ok];
						}
						r = r + (6) >> 0;
						if (utf16.IsSurrogate(rr$1)) {
							rr1 = getu4($subslice(s, r));
							dec = utf16.DecodeRune(rr$1, rr1);
							if (!((dec === 65533))) {
								r = r + (6) >> 0;
								w = w + (utf8.EncodeRune($subslice(b, w), dec)) >> 0;
								break;
							}
							rr$1 = 65533;
						}
						w = w + (utf8.EncodeRune($subslice(b, w), rr$1)) >> 0;
					} else {
						return [t, ok];
					}
				}
			} else if (((c$1 === 34)) || (c$1 < 32)) {
				return [t, ok];
			} else if (c$1 < 128) {
				((w < 0 || w >= b.$length) ? ($throwRuntimeError("index out of range"), undefined) : b.$array[b.$offset + w] = c$1);
				r = r + (1) >> 0;
				w = w + (1) >> 0;
			} else {
				_tuple$1 = utf8.DecodeRune($subslice(s, r));
				rr$2 = _tuple$1[0];
				size$1 = _tuple$1[1];
				r = r + (size$1) >> 0;
				w = w + (utf8.EncodeRune($subslice(b, w), rr$2)) >> 0;
			}
		}
		_tmp$2 = $subslice(b, 0, w);
		_tmp$3 = true;
		t = _tmp$2;
		ok = _tmp$3;
		return [t, ok];
	};
	isValidTag = function(s) {
		var _i, _ref, _rune, c, s;
		if (s === "") {
			return false;
		}
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.length)) { break; }
			_rune = $decodeRune(_ref, _i);
			c = _rune[0];
			if (strings.ContainsRune("!#$%&()*+-./:<=>?@[]^_{|}~ ", c)) {
			} else if (!unicode.IsLetter(c) && !unicode.IsDigit(c)) {
				return false;
			}
			_i += _rune[1];
		}
		return true;
	};
	fillField = function(f) {
		var f;
		f.nameBytes = (new sliceType$2($stringToBytes(f.name)));
		f.equalFold = foldFunc(f.nameBytes);
		return f;
	};
	byName.prototype.Len = function() {
		var x;
		x = this;
		return x.$length;
	};
	$ptrType(byName).prototype.Len = function() { return this.$get().Len(); };
	byName.prototype.Swap = function(i, j) {
		var _tmp, _tmp$1, i, j, x;
		x = this;
		_tmp = $clone(((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]), field);
		_tmp$1 = $clone(((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]), field);
		field.copy(((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]), _tmp);
		field.copy(((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]), _tmp$1);
	};
	$ptrType(byName).prototype.Swap = function(i, j) { return this.$get().Swap(i, j); };
	byName.prototype.Less = function(i, j) {
		var i, j, x;
		x = this;
		if (!(((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]).name === ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]).name)) {
			return ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]).name < ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]).name;
		}
		if (!((((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]).index.$length === ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]).index.$length))) {
			return ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]).index.$length < ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]).index.$length;
		}
		if (!(((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]).tag === ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]).tag)) {
			return ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]).tag;
		}
		return ($subslice(new byIndex(x.$array), x.$offset, x.$offset + x.$length)).Less(i, j);
	};
	$ptrType(byName).prototype.Less = function(i, j) { return this.$get().Less(i, j); };
	byIndex.prototype.Len = function() {
		var x;
		x = this;
		return x.$length;
	};
	$ptrType(byIndex).prototype.Len = function() { return this.$get().Len(); };
	byIndex.prototype.Swap = function(i, j) {
		var _tmp, _tmp$1, i, j, x;
		x = this;
		_tmp = $clone(((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]), field);
		_tmp$1 = $clone(((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]), field);
		field.copy(((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]), _tmp);
		field.copy(((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]), _tmp$1);
	};
	$ptrType(byIndex).prototype.Swap = function(i, j) { return this.$get().Swap(i, j); };
	byIndex.prototype.Less = function(i, j) {
		var _i, _ref, i, j, k, x, x$1, x$2, xik;
		x = this;
		_ref = ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]).index;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			k = _i;
			xik = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			if (k >= ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]).index.$length) {
				return false;
			}
			if (!((xik === (x$1 = ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]).index, ((k < 0 || k >= x$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$1.$array[x$1.$offset + k]))))) {
				return xik < (x$2 = ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]).index, ((k < 0 || k >= x$2.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$2.$array[x$2.$offset + k]));
			}
			_i++;
		}
		return ((i < 0 || i >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + i]).index.$length < ((j < 0 || j >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + j]).index.$length;
	};
	$ptrType(byIndex).prototype.Less = function(i, j) { return this.$get().Less(i, j); };
	typeFields = function(t) {
		var _1, _entry, _entry$1, _entry$2, _entry$3, _i, _key, _key$1, _r$10, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _ref, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, _tuple$1, _v, _v$1, advance, count, current, dominant, f, fi, fields, fj, ft, i, i$1, index, name, name$1, next, nextCount, ok, opts, out, quoted, sf, t, tag, tagged, visited, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _i = $f._i; _key = $f._key; _key$1 = $f._key$1; _r$10 = $f._r$10; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _v = $f._v; _v$1 = $f._v$1; advance = $f.advance; count = $f.count; current = $f.current; dominant = $f.dominant; f = $f.f; fi = $f.fi; fields = $f.fields; fj = $f.fj; ft = $f.ft; i = $f.i; i$1 = $f.i$1; index = $f.index; name = $f.name; name$1 = $f.name$1; next = $f.next; nextCount = $f.nextCount; ok = $f.ok; opts = $f.opts; out = $f.out; quoted = $f.quoted; sf = $f.sf; t = $f.t; tag = $f.tag; tagged = $f.tagged; visited = $f.visited; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		current = new sliceType$1([]);
		next = new sliceType$1([new field.ptr("", sliceType$2.nil, $throwNilPointerError, false, sliceType$3.nil, t, false, false)]);
		count = $makeMap(reflect.Type.keyFor, []);
		nextCount = $makeMap(reflect.Type.keyFor, []);
		visited = $makeMap(reflect.Type.keyFor, []);
		fields = sliceType$1.nil;
		/* while (true) { */ case 1:
			/* if (!(next.$length > 0)) { break; } */ if(!(next.$length > 0)) { $s = 2; continue; }
			_tmp = next;
			_tmp$1 = $subslice(current, 0, 0);
			current = _tmp;
			next = _tmp$1;
			_tmp$2 = nextCount;
			_tmp$3 = $makeMap(reflect.Type.keyFor, []);
			count = _tmp$2;
			nextCount = _tmp$3;
			_ref = current;
			_i = 0;
			/* while (true) { */ case 3:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 4; continue; }
				f = $clone(((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]), field);
				/* */ if ((_entry = visited[reflect.Type.keyFor(f.typ)], _entry !== undefined ? _entry.v : false)) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if ((_entry = visited[reflect.Type.keyFor(f.typ)], _entry !== undefined ? _entry.v : false)) { */ case 5:
					_i++;
					/* continue; */ $s = 3; continue;
				/* } */ case 6:
				_key = f.typ; (visited || $throwRuntimeError("assignment to entry in nil map"))[reflect.Type.keyFor(_key)] = { k: _key, v: true };
				i = 0;
				/* while (true) { */ case 7:
					_r$2 = f.typ.NumField(); /* */ $s = 9; case 9: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					/* if (!(i < _r$2)) { break; } */ if(!(i < _r$2)) { $s = 8; continue; }
					_r$3 = f.typ.Field(i); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					sf = $clone(_r$3, reflect.StructField);
					/* */ if (!(sf.PkgPath === "") && !sf.Anonymous) { $s = 11; continue; }
					/* */ $s = 12; continue;
					/* if (!(sf.PkgPath === "") && !sf.Anonymous) { */ case 11:
						i = i + (1) >> 0;
						/* continue; */ $s = 7; continue;
					/* } */ case 12:
					tag = new reflect.StructTag(sf.Tag).Get("json");
					/* */ if (tag === "-") { $s = 13; continue; }
					/* */ $s = 14; continue;
					/* if (tag === "-") { */ case 13:
						i = i + (1) >> 0;
						/* continue; */ $s = 7; continue;
					/* } */ case 14:
					_tuple = parseTag(tag);
					name = _tuple[0];
					opts = _tuple[1];
					if (!isValidTag(name)) {
						name = "";
					}
					index = $makeSlice(sliceType$3, (f.index.$length + 1 >> 0));
					$copySlice(index, f.index);
					(x = f.index.$length, ((x < 0 || x >= index.$length) ? ($throwRuntimeError("index out of range"), undefined) : index.$array[index.$offset + x] = i));
					ft = sf.Type;
					_r$4 = ft.Name(); /* */ $s = 18; case 18: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					if (!(_r$4 === "")) { _v = false; $s = 17; continue s; }
					_r$5 = ft.Kind(); /* */ $s = 19; case 19: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
					_v = _r$5 === 22; case 17:
					/* */ if (_v) { $s = 15; continue; }
					/* */ $s = 16; continue;
					/* if (_v) { */ case 15:
						_r$6 = ft.Elem(); /* */ $s = 20; case 20: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
						ft = _r$6;
					/* } */ case 16:
					quoted = false;
					/* */ if (new tagOptions(opts).Contains("string")) { $s = 21; continue; }
					/* */ $s = 22; continue;
					/* if (new tagOptions(opts).Contains("string")) { */ case 21:
							_r$7 = ft.Kind(); /* */ $s = 24; case 24: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
							_1 = _r$7;
							if ((_1 === (1)) || (_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6)) || (_1 === (7)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (13)) || (_1 === (14)) || (_1 === (24))) {
								quoted = true;
							}
						case 23:
					/* } */ case 22:
					if (!(name === "") || !sf.Anonymous) { _v$1 = true; $s = 27; continue s; }
					_r$8 = ft.Kind(); /* */ $s = 28; case 28: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
					_v$1 = !((_r$8 === 25)); case 27:
					/* */ if (_v$1) { $s = 25; continue; }
					/* */ $s = 26; continue;
					/* if (_v$1) { */ case 25:
						tagged = !(name === "");
						if (name === "") {
							name = sf.Name;
						}
						fields = $append(fields, fillField(new field.ptr(name, sliceType$2.nil, $throwNilPointerError, tagged, index, ft, new tagOptions(opts).Contains("omitempty"), quoted)));
						if ((_entry$1 = count[reflect.Type.keyFor(f.typ)], _entry$1 !== undefined ? _entry$1.v : 0) > 1) {
							fields = $append(fields, (x$1 = fields.$length - 1 >> 0, ((x$1 < 0 || x$1 >= fields.$length) ? ($throwRuntimeError("index out of range"), undefined) : fields.$array[fields.$offset + x$1])));
						}
						i = i + (1) >> 0;
						/* continue; */ $s = 7; continue;
					/* } */ case 26:
					_key$1 = ft; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[reflect.Type.keyFor(_key$1)] = { k: _key$1, v: (_entry$2 = nextCount[reflect.Type.keyFor(ft)], _entry$2 !== undefined ? _entry$2.v : 0) + (1) >> 0 };
					/* */ if ((_entry$3 = nextCount[reflect.Type.keyFor(ft)], _entry$3 !== undefined ? _entry$3.v : 0) === 1) { $s = 29; continue; }
					/* */ $s = 30; continue;
					/* if ((_entry$3 = nextCount[reflect.Type.keyFor(ft)], _entry$3 !== undefined ? _entry$3.v : 0) === 1) { */ case 29:
						_r$9 = ft.Name(); /* */ $s = 31; case 31: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
						_r$10 = fillField(new field.ptr(_r$9, sliceType$2.nil, $throwNilPointerError, false, index, ft, false, false)); /* */ $s = 32; case 32: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
						next = $append(next, _r$10);
					/* } */ case 30:
					i = i + (1) >> 0;
				/* } */ $s = 7; continue; case 8:
				_i++;
			/* } */ $s = 3; continue; case 4:
		/* } */ $s = 1; continue; case 2:
		$r = sort.Sort(($subslice(new byName(fields.$array), fields.$offset, fields.$offset + fields.$length))); /* */ $s = 33; case 33: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		out = $subslice(fields, 0, 0);
		_tmp$4 = 0;
		_tmp$5 = 0;
		advance = _tmp$4;
		i$1 = _tmp$5;
		/* while (true) { */ case 34:
			/* if (!(i$1 < fields.$length)) { break; } */ if(!(i$1 < fields.$length)) { $s = 35; continue; }
			fi = $clone(((i$1 < 0 || i$1 >= fields.$length) ? ($throwRuntimeError("index out of range"), undefined) : fields.$array[fields.$offset + i$1]), field);
			name$1 = fi.name;
			advance = 1;
			while (true) {
				if (!((i$1 + advance >> 0) < fields.$length)) { break; }
				fj = $clone((x$2 = i$1 + advance >> 0, ((x$2 < 0 || x$2 >= fields.$length) ? ($throwRuntimeError("index out of range"), undefined) : fields.$array[fields.$offset + x$2])), field);
				if (!(fj.name === name$1)) {
					break;
				}
				advance = advance + (1) >> 0;
			}
			if (advance === 1) {
				out = $append(out, fi);
				i$1 = i$1 + (advance) >> 0;
				/* continue; */ $s = 34; continue;
			}
			_tuple$1 = dominantField($subslice(fields, i$1, (i$1 + advance >> 0)));
			dominant = $clone(_tuple$1[0], field);
			ok = _tuple$1[1];
			if (ok) {
				out = $append(out, dominant);
			}
			i$1 = i$1 + (advance) >> 0;
		/* } */ $s = 34; continue; case 35:
		fields = out;
		$r = sort.Sort(($subslice(new byIndex(fields.$array), fields.$offset, fields.$offset + fields.$length))); /* */ $s = 36; case 36: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return fields;
		/* */ } return; } if ($f === undefined) { $f = { $blk: typeFields }; } $f._1 = _1; $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._i = _i; $f._key = _key; $f._key$1 = _key$1; $f._r$10 = _r$10; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._v = _v; $f._v$1 = _v$1; $f.advance = advance; $f.count = count; $f.current = current; $f.dominant = dominant; $f.f = f; $f.fi = fi; $f.fields = fields; $f.fj = fj; $f.ft = ft; $f.i = i; $f.i$1 = i$1; $f.index = index; $f.name = name; $f.name$1 = name$1; $f.next = next; $f.nextCount = nextCount; $f.ok = ok; $f.opts = opts; $f.out = out; $f.quoted = quoted; $f.sf = sf; $f.t = t; $f.tag = tag; $f.tagged = tagged; $f.visited = visited; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	dominantField = function(fields) {
		var _i, _ref, f, fields, i, length, tagged;
		length = (0 >= fields.$length ? ($throwRuntimeError("index out of range"), undefined) : fields.$array[fields.$offset + 0]).index.$length;
		tagged = -1;
		_ref = fields;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			f = $clone(((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]), field);
			if (f.index.$length > length) {
				fields = $subslice(fields, 0, i);
				break;
			}
			if (f.tag) {
				if (tagged >= 0) {
					return [new field.ptr("", sliceType$2.nil, $throwNilPointerError, false, sliceType$3.nil, $ifaceNil, false, false), false];
				}
				tagged = i;
			}
			_i++;
		}
		if (tagged >= 0) {
			return [((tagged < 0 || tagged >= fields.$length) ? ($throwRuntimeError("index out of range"), undefined) : fields.$array[fields.$offset + tagged]), true];
		}
		if (fields.$length > 1) {
			return [new field.ptr("", sliceType$2.nil, $throwNilPointerError, false, sliceType$3.nil, $ifaceNil, false, false), false];
		}
		return [(0 >= fields.$length ? ($throwRuntimeError("index out of range"), undefined) : fields.$array[fields.$offset + 0]), true];
	};
	cachedTypeFields = function(t) {
		var _entry, _key, _r$2, f, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _entry = $f._entry; _key = $f._key; _r$2 = $f._r$2; f = $f.f; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = fieldCache.RWMutex.RLock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		f = (_entry = fieldCache.m[reflect.Type.keyFor(t)], _entry !== undefined ? _entry.v : sliceType$1.nil);
		$r = fieldCache.RWMutex.RUnlock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (!(f === sliceType$1.nil)) {
			$s = -1; return f;
		}
		_r$2 = typeFields(t); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		f = _r$2;
		if (f === sliceType$1.nil) {
			f = new sliceType$1([]);
		}
		$r = fieldCache.RWMutex.Lock(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (fieldCache.m === false) {
			fieldCache.m = $makeMap(reflect.Type.keyFor, []);
		}
		_key = t; (fieldCache.m || $throwRuntimeError("assignment to entry in nil map"))[reflect.Type.keyFor(_key)] = { k: _key, v: f };
		$r = fieldCache.RWMutex.Unlock(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cachedTypeFields }; } $f._entry = _entry; $f._key = _key; $f._r$2 = _r$2; $f.f = f; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	foldFunc = function(s) {
		var _i, _ref, b, nonLetter, s, special, upper;
		nonLetter = false;
		special = false;
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			b = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			if (b >= 128) {
				return bytes.EqualFold;
			}
			upper = (b & 223) >>> 0;
			if (upper < 65 || upper > 90) {
				nonLetter = true;
			} else if ((upper === 75) || (upper === 83)) {
				special = true;
			}
			_i++;
		}
		if (special) {
			return equalFoldRight;
		}
		if (nonLetter) {
			return asciiEqualFold;
		}
		return simpleLetterEqualFold;
	};
	equalFoldRight = function(s, t) {
		var _1, _i, _ref, _tuple, s, sb, sbUpper, size, t, tb, tr;
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			sb = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			if (t.$length === 0) {
				return false;
			}
			tb = (0 >= t.$length ? ($throwRuntimeError("index out of range"), undefined) : t.$array[t.$offset + 0]);
			if (tb < 128) {
				if (!((sb === tb))) {
					sbUpper = (sb & 223) >>> 0;
					if (65 <= sbUpper && sbUpper <= 90) {
						if (!((sbUpper === ((tb & 223) >>> 0)))) {
							return false;
						}
					} else {
						return false;
					}
				}
				t = $subslice(t, 1);
				_i++;
				continue;
			}
			_tuple = utf8.DecodeRune(t);
			tr = _tuple[0];
			size = _tuple[1];
			_1 = sb;
			if ((_1 === (115)) || (_1 === (83))) {
				if (!((tr === 383))) {
					return false;
				}
			} else if ((_1 === (107)) || (_1 === (75))) {
				if (!((tr === 8490))) {
					return false;
				}
			} else {
				return false;
			}
			t = $subslice(t, size);
			_i++;
		}
		if (t.$length > 0) {
			return false;
		}
		return true;
	};
	asciiEqualFold = function(s, t) {
		var _i, _ref, i, s, sb, t, tb;
		if (!((s.$length === t.$length))) {
			return false;
		}
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			sb = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			tb = ((i < 0 || i >= t.$length) ? ($throwRuntimeError("index out of range"), undefined) : t.$array[t.$offset + i]);
			if (sb === tb) {
				_i++;
				continue;
			}
			if ((97 <= sb && sb <= 122) || (65 <= sb && sb <= 90)) {
				if (!((((sb & 223) >>> 0) === ((tb & 223) >>> 0)))) {
					return false;
				}
			} else {
				return false;
			}
			_i++;
		}
		return true;
	};
	simpleLetterEqualFold = function(s, t) {
		var _i, _ref, b, i, s, t;
		if (!((s.$length === t.$length))) {
			return false;
		}
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			b = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			if (!((((b & 223) >>> 0) === ((((i < 0 || i >= t.$length) ? ($throwRuntimeError("index out of range"), undefined) : t.$array[t.$offset + i]) & 223) >>> 0)))) {
				return false;
			}
			_i++;
		}
		return true;
	};
	checkValid = function(data, scan) {
		var _i, _r$2, _r$3, _ref, c, data, scan, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _r$2 = $f._r$2; _r$3 = $f._r$3; _ref = $f._ref; c = $f.c; data = $f.data; scan = $f.scan; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		scan.reset();
		_ref = data;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			c = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			scan.bytes = (x = scan.bytes, x$1 = new $Int64(0, 1), new $Int64(x.$high + x$1.$high, x.$low + x$1.$low));
			_r$2 = scan.step(scan, c); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			/* */ if (_r$2 === 11) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_r$2 === 11) { */ case 3:
				$s = -1; return scan.err;
			/* } */ case 4:
			_i++;
		/* } */ $s = 1; continue; case 2:
		_r$3 = scan.eof(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		/* */ if (_r$3 === 11) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (_r$3 === 11) { */ case 6:
			$s = -1; return scan.err;
		/* } */ case 7:
		$s = -1; return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: checkValid }; } $f._i = _i; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._ref = _ref; $f.c = c; $f.data = data; $f.scan = scan; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	nextValue = function(data, scan) {
		var _1, _i, _r$2, _r$3, _r$4, _ref, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, c, data, err, i, rest, scan, v, value, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _1 = $f._1; _i = $f._i; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$10 = $f._tmp$10; _tmp$11 = $f._tmp$11; _tmp$12 = $f._tmp$12; _tmp$13 = $f._tmp$13; _tmp$14 = $f._tmp$14; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tmp$8 = $f._tmp$8; _tmp$9 = $f._tmp$9; c = $f.c; data = $f.data; err = $f.err; i = $f.i; rest = $f.rest; scan = $f.scan; v = $f.v; value = $f.value; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		value = sliceType$2.nil;
		rest = sliceType$2.nil;
		err = $ifaceNil;
		scan.reset();
		_ref = data;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			i = _i;
			c = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
			_r$2 = scan.step(scan, c); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			v = _r$2;
			/* */ if (v >= 5) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (v >= 5) { */ case 4:
					_1 = v;
					/* */ if ((_1 === (5)) || (_1 === (8))) { $s = 7; continue; }
					/* */ if (_1 === (11)) { $s = 8; continue; }
					/* */ if (_1 === (10)) { $s = 9; continue; }
					/* */ $s = 10; continue;
					/* if ((_1 === (5)) || (_1 === (8))) { */ case 7:
						_r$3 = scan.step(scan, 32); /* */ $s = 13; case 13: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
						/* */ if (_r$3 === 10) { $s = 11; continue; }
						/* */ $s = 12; continue;
						/* if (_r$3 === 10) { */ case 11:
							_tmp = $subslice(data, 0, (i + 1 >> 0));
							_tmp$1 = $subslice(data, (i + 1 >> 0));
							_tmp$2 = $ifaceNil;
							value = _tmp;
							rest = _tmp$1;
							err = _tmp$2;
							$s = -1; return [value, rest, err];
						/* } */ case 12:
						$s = 10; continue;
					/* } else if (_1 === (11)) { */ case 8:
						_tmp$3 = sliceType$2.nil;
						_tmp$4 = sliceType$2.nil;
						_tmp$5 = scan.err;
						value = _tmp$3;
						rest = _tmp$4;
						err = _tmp$5;
						$s = -1; return [value, rest, err];
					/* } else if (_1 === (10)) { */ case 9:
						_tmp$6 = $subslice(data, 0, i);
						_tmp$7 = $subslice(data, i);
						_tmp$8 = $ifaceNil;
						value = _tmp$6;
						rest = _tmp$7;
						err = _tmp$8;
						$s = -1; return [value, rest, err];
					/* } */ case 10:
				case 6:
			/* } */ case 5:
			_i++;
		/* } */ $s = 1; continue; case 2:
		_r$4 = scan.eof(); /* */ $s = 16; case 16: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		/* */ if (_r$4 === 11) { $s = 14; continue; }
		/* */ $s = 15; continue;
		/* if (_r$4 === 11) { */ case 14:
			_tmp$9 = sliceType$2.nil;
			_tmp$10 = sliceType$2.nil;
			_tmp$11 = scan.err;
			value = _tmp$9;
			rest = _tmp$10;
			err = _tmp$11;
			$s = -1; return [value, rest, err];
		/* } */ case 15:
		_tmp$12 = data;
		_tmp$13 = sliceType$2.nil;
		_tmp$14 = $ifaceNil;
		value = _tmp$12;
		rest = _tmp$13;
		err = _tmp$14;
		$s = -1; return [value, rest, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: nextValue }; } $f._1 = _1; $f._i = _i; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$10 = _tmp$10; $f._tmp$11 = _tmp$11; $f._tmp$12 = _tmp$12; $f._tmp$13 = _tmp$13; $f._tmp$14 = _tmp$14; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tmp$8 = _tmp$8; $f._tmp$9 = _tmp$9; $f.c = c; $f.data = data; $f.err = err; $f.i = i; $f.rest = rest; $f.scan = scan; $f.v = v; $f.value = value; $f.$s = $s; $f.$r = $r; return $f;
	};
	SyntaxError.ptr.prototype.Error = function() {
		var e;
		e = this;
		return e.msg;
	};
	SyntaxError.prototype.Error = function() { return this.$val.Error(); };
	scanner.ptr.prototype.reset = function() {
		var s;
		s = this;
		s.step = stateBeginValue;
		s.parseState = $subslice(s.parseState, 0, 0);
		s.err = $ifaceNil;
		s.redo = false;
		s.endTop = false;
	};
	scanner.prototype.reset = function() { return this.$val.reset(); };
	scanner.ptr.prototype.eof = function() {
		var _r$2, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _r$2 = $f._r$2; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		if (!($interfaceIsEqual(s.err, $ifaceNil))) {
			$s = -1; return 11;
		}
		if (s.endTop) {
			$s = -1; return 10;
		}
		_r$2 = s.step(s, 32); /* */ $s = 1; case 1: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_r$2;
		if (s.endTop) {
			$s = -1; return 10;
		}
		if ($interfaceIsEqual(s.err, $ifaceNil)) {
			s.err = new SyntaxError.ptr("unexpected end of JSON input", s.bytes);
		}
		$s = -1; return 11;
		/* */ } return; } if ($f === undefined) { $f = { $blk: scanner.ptr.prototype.eof }; } $f._r$2 = _r$2; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	scanner.prototype.eof = function() { return this.$val.eof(); };
	scanner.ptr.prototype.pushParseState = function(p) {
		var p, s;
		s = this;
		s.parseState = $append(s.parseState, p);
	};
	scanner.prototype.pushParseState = function(p) { return this.$val.pushParseState(p); };
	scanner.ptr.prototype.popParseState = function() {
		var n, s;
		s = this;
		n = s.parseState.$length - 1 >> 0;
		s.parseState = $subslice(s.parseState, 0, n);
		s.redo = false;
		if (n === 0) {
			s.step = stateEndTop;
			s.endTop = true;
		} else {
			s.step = stateEndValue;
		}
	};
	scanner.prototype.popParseState = function() { return this.$val.popParseState(); };
	isSpace = function(c) {
		var c;
		return (c === 32) || (c === 9) || (c === 13) || (c === 10);
	};
	stateBeginValueOrEmpty = function(s, c) {
		var c, s;
		if (c <= 32 && isSpace(c)) {
			return 9;
		}
		if (c === 93) {
			return stateEndValue(s, c);
		}
		return stateBeginValue(s, c);
	};
	stateBeginValue = function(s, c) {
		var _1, c, s;
		if (c <= 32 && isSpace(c)) {
			return 9;
		}
		_1 = c;
		if (_1 === (123)) {
			s.step = stateBeginStringOrEmpty;
			s.pushParseState(0);
			return 2;
		} else if (_1 === (91)) {
			s.step = stateBeginValueOrEmpty;
			s.pushParseState(2);
			return 6;
		} else if (_1 === (34)) {
			s.step = stateInString;
			return 1;
		} else if (_1 === (45)) {
			s.step = stateNeg;
			return 1;
		} else if (_1 === (48)) {
			s.step = state0;
			return 1;
		} else if (_1 === (116)) {
			s.step = stateT;
			return 1;
		} else if (_1 === (102)) {
			s.step = stateF;
			return 1;
		} else if (_1 === (110)) {
			s.step = stateN;
			return 1;
		}
		if (49 <= c && c <= 57) {
			s.step = state1;
			return 1;
		}
		return s.error(c, "looking for beginning of value");
	};
	stateBeginStringOrEmpty = function(s, c) {
		var c, n, s, x, x$1;
		if (c <= 32 && isSpace(c)) {
			return 9;
		}
		if (c === 125) {
			n = s.parseState.$length;
			(x = s.parseState, x$1 = n - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + x$1] = 1));
			return stateEndValue(s, c);
		}
		return stateBeginString(s, c);
	};
	stateBeginString = function(s, c) {
		var c, s;
		if (c <= 32 && isSpace(c)) {
			return 9;
		}
		if (c === 34) {
			s.step = stateInString;
			return 1;
		}
		return s.error(c, "looking for beginning of object key string");
	};
	stateEndValue = function(s, c) {
		var _1, c, n, ps, s, x, x$1, x$2, x$3, x$4, x$5;
		n = s.parseState.$length;
		if (n === 0) {
			s.step = stateEndTop;
			s.endTop = true;
			return stateEndTop(s, c);
		}
		if (c <= 32 && isSpace(c)) {
			s.step = stateEndValue;
			return 9;
		}
		ps = (x = s.parseState, x$1 = n - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? ($throwRuntimeError("index out of range"), undefined) : x.$array[x.$offset + x$1]));
		_1 = ps;
		if (_1 === (0)) {
			if (c === 58) {
				(x$2 = s.parseState, x$3 = n - 1 >> 0, ((x$3 < 0 || x$3 >= x$2.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$2.$array[x$2.$offset + x$3] = 1));
				s.step = stateBeginValue;
				return 3;
			}
			return s.error(c, "after object key");
		} else if (_1 === (1)) {
			if (c === 44) {
				(x$4 = s.parseState, x$5 = n - 1 >> 0, ((x$5 < 0 || x$5 >= x$4.$length) ? ($throwRuntimeError("index out of range"), undefined) : x$4.$array[x$4.$offset + x$5] = 0));
				s.step = stateBeginString;
				return 4;
			}
			if (c === 125) {
				s.popParseState();
				return 5;
			}
			return s.error(c, "after object key:value pair");
		} else if (_1 === (2)) {
			if (c === 44) {
				s.step = stateBeginValue;
				return 7;
			}
			if (c === 93) {
				s.popParseState();
				return 8;
			}
			return s.error(c, "after array element");
		}
		return s.error(c, "");
	};
	stateEndTop = function(s, c) {
		var c, s;
		if (!((c === 32)) && !((c === 9)) && !((c === 13)) && !((c === 10))) {
			s.error(c, "after top-level value");
		}
		return 10;
	};
	stateInString = function(s, c) {
		var c, s;
		if (c === 34) {
			s.step = stateEndValue;
			return 0;
		}
		if (c === 92) {
			s.step = stateInStringEsc;
			return 0;
		}
		if (c < 32) {
			return s.error(c, "in string literal");
		}
		return 0;
	};
	stateInStringEsc = function(s, c) {
		var _1, c, s;
		_1 = c;
		if ((_1 === (98)) || (_1 === (102)) || (_1 === (110)) || (_1 === (114)) || (_1 === (116)) || (_1 === (92)) || (_1 === (47)) || (_1 === (34))) {
			s.step = stateInString;
			return 0;
		} else if (_1 === (117)) {
			s.step = stateInStringEscU;
			return 0;
		}
		return s.error(c, "in string escape code");
	};
	stateInStringEscU = function(s, c) {
		var c, s;
		if (48 <= c && c <= 57 || 97 <= c && c <= 102 || 65 <= c && c <= 70) {
			s.step = stateInStringEscU1;
			return 0;
		}
		return s.error(c, "in \\u hexadecimal character escape");
	};
	stateInStringEscU1 = function(s, c) {
		var c, s;
		if (48 <= c && c <= 57 || 97 <= c && c <= 102 || 65 <= c && c <= 70) {
			s.step = stateInStringEscU12;
			return 0;
		}
		return s.error(c, "in \\u hexadecimal character escape");
	};
	stateInStringEscU12 = function(s, c) {
		var c, s;
		if (48 <= c && c <= 57 || 97 <= c && c <= 102 || 65 <= c && c <= 70) {
			s.step = stateInStringEscU123;
			return 0;
		}
		return s.error(c, "in \\u hexadecimal character escape");
	};
	stateInStringEscU123 = function(s, c) {
		var c, s;
		if (48 <= c && c <= 57 || 97 <= c && c <= 102 || 65 <= c && c <= 70) {
			s.step = stateInString;
			return 0;
		}
		return s.error(c, "in \\u hexadecimal character escape");
	};
	stateNeg = function(s, c) {
		var c, s;
		if (c === 48) {
			s.step = state0;
			return 0;
		}
		if (49 <= c && c <= 57) {
			s.step = state1;
			return 0;
		}
		return s.error(c, "in numeric literal");
	};
	state1 = function(s, c) {
		var c, s;
		if (48 <= c && c <= 57) {
			s.step = state1;
			return 0;
		}
		return state0(s, c);
	};
	state0 = function(s, c) {
		var c, s;
		if (c === 46) {
			s.step = stateDot;
			return 0;
		}
		if ((c === 101) || (c === 69)) {
			s.step = stateE;
			return 0;
		}
		return stateEndValue(s, c);
	};
	stateDot = function(s, c) {
		var c, s;
		if (48 <= c && c <= 57) {
			s.step = stateDot0;
			return 0;
		}
		return s.error(c, "after decimal point in numeric literal");
	};
	stateDot0 = function(s, c) {
		var c, s;
		if (48 <= c && c <= 57) {
			return 0;
		}
		if ((c === 101) || (c === 69)) {
			s.step = stateE;
			return 0;
		}
		return stateEndValue(s, c);
	};
	stateE = function(s, c) {
		var c, s;
		if ((c === 43) || (c === 45)) {
			s.step = stateESign;
			return 0;
		}
		return stateESign(s, c);
	};
	stateESign = function(s, c) {
		var c, s;
		if (48 <= c && c <= 57) {
			s.step = stateE0;
			return 0;
		}
		return s.error(c, "in exponent of numeric literal");
	};
	stateE0 = function(s, c) {
		var c, s;
		if (48 <= c && c <= 57) {
			return 0;
		}
		return stateEndValue(s, c);
	};
	stateT = function(s, c) {
		var c, s;
		if (c === 114) {
			s.step = stateTr;
			return 0;
		}
		return s.error(c, "in literal true (expecting 'r')");
	};
	stateTr = function(s, c) {
		var c, s;
		if (c === 117) {
			s.step = stateTru;
			return 0;
		}
		return s.error(c, "in literal true (expecting 'u')");
	};
	stateTru = function(s, c) {
		var c, s;
		if (c === 101) {
			s.step = stateEndValue;
			return 0;
		}
		return s.error(c, "in literal true (expecting 'e')");
	};
	stateF = function(s, c) {
		var c, s;
		if (c === 97) {
			s.step = stateFa;
			return 0;
		}
		return s.error(c, "in literal false (expecting 'a')");
	};
	stateFa = function(s, c) {
		var c, s;
		if (c === 108) {
			s.step = stateFal;
			return 0;
		}
		return s.error(c, "in literal false (expecting 'l')");
	};
	stateFal = function(s, c) {
		var c, s;
		if (c === 115) {
			s.step = stateFals;
			return 0;
		}
		return s.error(c, "in literal false (expecting 's')");
	};
	stateFals = function(s, c) {
		var c, s;
		if (c === 101) {
			s.step = stateEndValue;
			return 0;
		}
		return s.error(c, "in literal false (expecting 'e')");
	};
	stateN = function(s, c) {
		var c, s;
		if (c === 117) {
			s.step = stateNu;
			return 0;
		}
		return s.error(c, "in literal null (expecting 'u')");
	};
	stateNu = function(s, c) {
		var c, s;
		if (c === 108) {
			s.step = stateNul;
			return 0;
		}
		return s.error(c, "in literal null (expecting 'l')");
	};
	stateNul = function(s, c) {
		var c, s;
		if (c === 108) {
			s.step = stateEndValue;
			return 0;
		}
		return s.error(c, "in literal null (expecting 'l')");
	};
	stateError = function(s, c) {
		var c, s;
		return 11;
	};
	scanner.ptr.prototype.error = function(c, context) {
		var c, context, s;
		s = this;
		s.step = stateError;
		s.err = new SyntaxError.ptr("invalid character " + quoteChar(c) + " " + context, s.bytes);
		return 11;
	};
	scanner.prototype.error = function(c, context) { return this.$val.error(c, context); };
	quoteChar = function(c) {
		var c, s;
		if (c === 39) {
			return "'\\''";
		}
		if (c === 34) {
			return "'\"'";
		}
		s = strconv.Quote(($encodeRune(c)));
		return "'" + $substring(s, 1, (s.length - 1 >> 0)) + "'";
	};
	scanner.ptr.prototype.undo = function(scanCode) {
		var s, scanCode;
		s = this;
		if (s.redo) {
			$panic(new $String("json: invalid use of scanner"));
		}
		s.redoCode = scanCode;
		s.redoState = s.step;
		s.step = stateRedo;
		s.redo = true;
	};
	scanner.prototype.undo = function(scanCode) { return this.$val.undo(scanCode); };
	stateRedo = function(s, c) {
		var c, s;
		s.redo = false;
		s.step = s.redoState;
		return s.redoCode;
	};
	parseTag = function(tag) {
		var idx, tag;
		idx = strings.Index(tag, ",");
		if (!((idx === -1))) {
			return [$substring(tag, 0, idx), ($substring(tag, (idx + 1 >> 0)))];
		}
		return [tag, ""];
	};
	tagOptions.prototype.Contains = function(optionName) {
		var _tmp, _tmp$1, i, next, o, optionName, s;
		o = this.$val;
		if (o.length === 0) {
			return false;
		}
		s = (o);
		while (true) {
			if (!(!(s === ""))) { break; }
			next = "";
			i = strings.Index(s, ",");
			if (i >= 0) {
				_tmp = $substring(s, 0, i);
				_tmp$1 = $substring(s, (i + 1 >> 0));
				s = _tmp;
				next = _tmp$1;
			}
			if (s === optionName) {
				return true;
			}
			s = next;
		}
		return false;
	};
	$ptrType(tagOptions).prototype.Contains = function(optionName) { return new tagOptions(this.$get()).Contains(optionName); };
	ptrType$9.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$11.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	Number.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Float64", name: "Float64", pkg: "", typ: $funcType([], [$Float64, $error], false)}, {prop: "Int64", name: "Int64", pkg: "", typ: $funcType([], [$Int64, $error], false)}];
	ptrType$12.methods = [{prop: "unmarshal", name: "unmarshal", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([$emptyInterface], [$error], false)}, {prop: "init", name: "init", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([sliceType$2], [ptrType$12], false)}, {prop: "error", name: "error", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([$error], [], false)}, {prop: "saveError", name: "saveError", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([$error], [], false)}, {prop: "next", name: "next", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([], [sliceType$2], false)}, {prop: "scanWhile", name: "scanWhile", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([$Int], [$Int], false)}, {prop: "value", name: "value", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([reflect.Value], [], false)}, {prop: "valueQuoted", name: "valueQuoted", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([], [$emptyInterface], false)}, {prop: "indirect", name: "indirect", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([reflect.Value, $Bool], [Unmarshaler, encoding.TextUnmarshaler, reflect.Value], false)}, {prop: "array", name: "array", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([reflect.Value], [], false)}, {prop: "object", name: "object", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([reflect.Value], [], false)}, {prop: "literal", name: "literal", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([reflect.Value], [], false)}, {prop: "convertNumber", name: "convertNumber", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([$String], [$emptyInterface, $error], false)}, {prop: "literalStore", name: "literalStore", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([sliceType$2, reflect.Value, $Bool], [], false)}, {prop: "valueInterface", name: "valueInterface", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([], [$emptyInterface], false)}, {prop: "arrayInterface", name: "arrayInterface", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([], [sliceType], false)}, {prop: "objectInterface", name: "objectInterface", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([], [mapType$2], false)}, {prop: "literalInterface", name: "literalInterface", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([], [$emptyInterface], false)}];
	byName.methods = [{prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Swap", name: "Swap", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Less", name: "Less", pkg: "", typ: $funcType([$Int, $Int], [$Bool], false)}];
	byIndex.methods = [{prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Swap", name: "Swap", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Less", name: "Less", pkg: "", typ: $funcType([$Int, $Int], [$Bool], false)}];
	ptrType$8.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$23.methods = [{prop: "reset", name: "reset", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([], [], false)}, {prop: "eof", name: "eof", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([], [$Int], false)}, {prop: "pushParseState", name: "pushParseState", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([$Int], [], false)}, {prop: "popParseState", name: "popParseState", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([], [], false)}, {prop: "error", name: "error", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([$Uint8, $String], [$Int], false)}, {prop: "undo", name: "undo", pkg: "github.com/cathalgarvey/fmtless/encoding/json", typ: $funcType([$Int], [], false)}];
	tagOptions.methods = [{prop: "Contains", name: "Contains", pkg: "", typ: $funcType([$String], [$Bool], false)}];
	Unmarshaler.init([{prop: "UnmarshalJSON", name: "UnmarshalJSON", pkg: "", typ: $funcType([sliceType$2], [$error], false)}]);
	UnmarshalTypeError.init("", [{prop: "Value", name: "Value", anonymous: false, exported: true, typ: $String, tag: ""}, {prop: "Type", name: "Type", anonymous: false, exported: true, typ: reflect.Type, tag: ""}, {prop: "Offset", name: "Offset", anonymous: false, exported: true, typ: $Int64, tag: ""}]);
	InvalidUnmarshalError.init("", [{prop: "Type", name: "Type", anonymous: false, exported: true, typ: reflect.Type, tag: ""}]);
	decodeState.init("github.com/cathalgarvey/fmtless/encoding/json", [{prop: "data", name: "data", anonymous: false, exported: false, typ: sliceType$2, tag: ""}, {prop: "off", name: "off", anonymous: false, exported: false, typ: $Int, tag: ""}, {prop: "scan", name: "scan", anonymous: false, exported: false, typ: scanner, tag: ""}, {prop: "nextscan", name: "nextscan", anonymous: false, exported: false, typ: scanner, tag: ""}, {prop: "savedError", name: "savedError", anonymous: false, exported: false, typ: $error, tag: ""}, {prop: "useNumber", name: "useNumber", anonymous: false, exported: false, typ: $Bool, tag: ""}]);
	unquotedValue.init("", []);
	Marshaler.init([{prop: "MarshalJSON", name: "MarshalJSON", pkg: "", typ: $funcType([], [sliceType$2, $error], false)}]);
	field.init("github.com/cathalgarvey/fmtless/encoding/json", [{prop: "name", name: "name", anonymous: false, exported: false, typ: $String, tag: ""}, {prop: "nameBytes", name: "nameBytes", anonymous: false, exported: false, typ: sliceType$2, tag: ""}, {prop: "equalFold", name: "equalFold", anonymous: false, exported: false, typ: funcType, tag: ""}, {prop: "tag", name: "tag", anonymous: false, exported: false, typ: $Bool, tag: ""}, {prop: "index", name: "index", anonymous: false, exported: false, typ: sliceType$3, tag: ""}, {prop: "typ", name: "typ", anonymous: false, exported: false, typ: reflect.Type, tag: ""}, {prop: "omitEmpty", name: "omitEmpty", anonymous: false, exported: false, typ: $Bool, tag: ""}, {prop: "quoted", name: "quoted", anonymous: false, exported: false, typ: $Bool, tag: ""}]);
	byName.init(field);
	byIndex.init(field);
	SyntaxError.init("github.com/cathalgarvey/fmtless/encoding/json", [{prop: "msg", name: "msg", anonymous: false, exported: false, typ: $String, tag: ""}, {prop: "Offset", name: "Offset", anonymous: false, exported: true, typ: $Int64, tag: ""}]);
	scanner.init("github.com/cathalgarvey/fmtless/encoding/json", [{prop: "step", name: "step", anonymous: false, exported: false, typ: funcType$1, tag: ""}, {prop: "endTop", name: "endTop", anonymous: false, exported: false, typ: $Bool, tag: ""}, {prop: "parseState", name: "parseState", anonymous: false, exported: false, typ: sliceType$3, tag: ""}, {prop: "err", name: "err", anonymous: false, exported: false, typ: $error, tag: ""}, {prop: "redo", name: "redo", anonymous: false, exported: false, typ: $Bool, tag: ""}, {prop: "redoCode", name: "redoCode", anonymous: false, exported: false, typ: $Int, tag: ""}, {prop: "redoState", name: "redoState", anonymous: false, exported: false, typ: funcType$1, tag: ""}, {prop: "bytes", name: "bytes", anonymous: false, exported: false, typ: $Int64, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = bytes.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = encoding.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = base64.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = errors.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = fmt.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = reflect.$init(); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sort.$init(); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 14; case 14: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf16.$init(); /* */ $s = 15; case 15: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 16; case 16: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		fieldCache = new structType$1.ptr(new sync.RWMutex.ptr(new sync.Mutex.ptr(0, 0), 0, 0, 0, 0), false);
		errPhase = errors.New("JSON decoder out of sync - data changing underfoot?");
		nullLiteral = (new sliceType$2($stringToBytes("null")));
		numberType = reflect.TypeOf(new Number(""));
		_r = reflect.TypeOf($newDataPointer($ifaceNil, ptrType)).Elem(); /* */ $s = 17; case 17: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		marshalerType = _r;
		_r$1 = reflect.TypeOf($newDataPointer($ifaceNil, ptrType$1)).Elem(); /* */ $s = 18; case 18: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		textMarshalerType = _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/gopherjs/websocket/websocketjs"] = (function() {
	var $pkg = {}, $init, js, ReadyState, WebSocket, ptrType, ptrType$1, ptrType$2, funcType, New;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	ReadyState = $pkg.ReadyState = $newType(2, $kindUint16, "websocketjs.ReadyState", true, "github.com/gopherjs/websocket/websocketjs", true, null);
	WebSocket = $pkg.WebSocket = $newType(0, $kindStruct, "websocketjs.WebSocket", true, "github.com/gopherjs/websocket/websocketjs", true, function(Object_, URL_, ReadyState_, BufferedAmount_, Extensions_, Protocol_, BinaryType_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.URL = "";
			this.ReadyState = 0;
			this.BufferedAmount = 0;
			this.Extensions = "";
			this.Protocol = "";
			this.BinaryType = "";
			return;
		}
		this.Object = Object_;
		this.URL = URL_;
		this.ReadyState = ReadyState_;
		this.BufferedAmount = BufferedAmount_;
		this.Extensions = Extensions_;
		this.Protocol = Protocol_;
		this.BinaryType = BinaryType_;
	});
	ptrType = $ptrType(WebSocket);
	ptrType$1 = $ptrType(js.Error);
	ptrType$2 = $ptrType(js.Object);
	funcType = $funcType([ptrType$2], [], false);
	ReadyState.prototype.String = function() {
		var _1, rs;
		rs = this.$val;
		_1 = rs;
		if (_1 === (0)) {
			return "Connecting";
		} else if (_1 === (1)) {
			return "Open";
		} else if (_1 === (2)) {
			return "Closing";
		} else if (_1 === (3)) {
			return "Closed";
		} else {
			return "Unknown";
		}
	};
	$ptrType(ReadyState).prototype.String = function() { return new ReadyState(this.$get()).String(); };
	New = function(url) {
		var err, object, url, ws, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		ws = ptrType.nil;
		err = $ifaceNil;
		$deferred.push([(function() {
			var _tuple, e, jsErr, ok;
			e = $recover();
			if ($interfaceIsEqual(e, $ifaceNil)) {
				return;
			}
			_tuple = $assertType(e, ptrType$1, true);
			jsErr = _tuple[0];
			ok = _tuple[1];
			if (ok && !(jsErr === ptrType$1.nil)) {
				ws = ptrType.nil;
				err = jsErr;
			} else {
				$panic(e);
			}
		}), []]);
		object = new ($global.WebSocket)($externalize(url, $String));
		ws = new WebSocket.ptr(object, "", 0, 0, "", "", "");
		return [ws, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [ws, err]; } }
	};
	$pkg.New = New;
	WebSocket.ptr.prototype.AddEventListener = function(typ, useCapture, listener) {
		var listener, typ, useCapture, ws;
		ws = this;
		ws.Object.addEventListener($externalize(typ, $String), $externalize(listener, funcType), $externalize(useCapture, $Bool));
	};
	WebSocket.prototype.AddEventListener = function(typ, useCapture, listener) { return this.$val.AddEventListener(typ, useCapture, listener); };
	WebSocket.ptr.prototype.RemoveEventListener = function(typ, useCapture, listener) {
		var listener, typ, useCapture, ws;
		ws = this;
		ws.Object.removeEventListener($externalize(typ, $String), $externalize(listener, funcType), $externalize(useCapture, $Bool));
	};
	WebSocket.prototype.RemoveEventListener = function(typ, useCapture, listener) { return this.$val.RemoveEventListener(typ, useCapture, listener); };
	WebSocket.ptr.prototype.Send = function(data) {
		var data, err, ws, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		ws = this;
		$deferred.push([(function() {
			var _tuple, e, jsErr, ok;
			e = $recover();
			if ($interfaceIsEqual(e, $ifaceNil)) {
				return;
			}
			_tuple = $assertType(e, ptrType$1, true);
			jsErr = _tuple[0];
			ok = _tuple[1];
			if (ok && !(jsErr === ptrType$1.nil)) {
				err = jsErr;
			} else {
				$panic(e);
			}
		}), []]);
		ws.Object.send($externalize(data, $emptyInterface));
		return err;
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } }
	};
	WebSocket.prototype.Send = function(data) { return this.$val.Send(data); };
	WebSocket.ptr.prototype.Close = function() {
		var err, ws, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		ws = this;
		$deferred.push([(function() {
			var _tuple, e, jsErr, ok;
			e = $recover();
			if ($interfaceIsEqual(e, $ifaceNil)) {
				return;
			}
			_tuple = $assertType(e, ptrType$1, true);
			jsErr = _tuple[0];
			ok = _tuple[1];
			if (ok && !(jsErr === ptrType$1.nil)) {
				err = jsErr;
			} else {
				$panic(e);
			}
		}), []]);
		ws.Object.close(1000);
		return err;
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } }
	};
	WebSocket.prototype.Close = function() { return this.$val.Close(); };
	ReadyState.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType.methods = [{prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType], [], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType], [], false)}, {prop: "Send", name: "Send", pkg: "", typ: $funcType([$emptyInterface], [$error], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [$error], false)}];
	WebSocket.init("", [{prop: "Object", name: "Object", anonymous: true, exported: true, typ: ptrType$2, tag: ""}, {prop: "URL", name: "URL", anonymous: false, exported: true, typ: $String, tag: "js:\"url\""}, {prop: "ReadyState", name: "ReadyState", anonymous: false, exported: true, typ: ReadyState, tag: "js:\"readyState\""}, {prop: "BufferedAmount", name: "BufferedAmount", anonymous: false, exported: true, typ: $Uint32, tag: "js:\"bufferedAmount\""}, {prop: "Extensions", name: "Extensions", anonymous: false, exported: true, typ: $String, tag: "js:\"extensions\""}, {prop: "Protocol", name: "Protocol", anonymous: false, exported: true, typ: $String, tag: "js:\"protocol\""}, {prop: "BinaryType", name: "BinaryType", anonymous: false, exported: true, typ: $String, tag: "js:\"binaryType\""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/marwan-at-work/hmr/frontend/runtime/hot"] = (function() {
	var $pkg = {}, $init, js, funcType, sliceType, mapType, init, Publish;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	funcType = $funcType([], [], false);
	sliceType = $sliceType(funcType);
	mapType = $mapType($String, sliceType);
	init = function() {
		if ($global.hmrCallbacks === undefined) {
			$global.hmrCallbacks = $externalize($makeMap($String.keyFor, []), mapType);
		}
	};
	Publish = function(importPath) {
		var cbs, i, importPath, length;
		cbs = $global.hmrCallbacks;
		if (cbs[$externalize(importPath, $String)] === undefined) {
			console.log("skipping " + importPath);
			return;
		}
		length = $parseInt(cbs[$externalize(importPath, $String)].length);
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			cbs[$externalize(importPath, $String)][i]();
			i = i + (1) >> 0;
		}
	};
	$pkg.Publish = Publish;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/marwan-at-work/hmr/frontend/runtime"] = (function() {
	var $pkg = {}, $init, json, js, websocketjs, hot, Message, sliceType, main;
	json = $packages["github.com/cathalgarvey/fmtless/encoding/json"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	websocketjs = $packages["github.com/gopherjs/websocket/websocketjs"];
	hot = $packages["github.com/marwan-at-work/hmr/frontend/runtime/hot"];
	Message = $pkg.Message = $newType(0, $kindStruct, "main.Message", true, "github.com/marwan-at-work/hmr/frontend/runtime", true, function(Data_, Name_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Data = "";
			this.Name = "";
			return;
		}
		this.Data = Data_;
		this.Name = Name_;
	});
	sliceType = $sliceType($Uint8);
	main = function() {
		var _tuple, err, ws;
		_tuple = websocketjs.New("ws://localhost:9090/ws");
		ws = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$panic(err);
		}
		$global.hmrTrue = $externalize(true, $Bool);
		ws.AddEventListener("message", false, (function $b(ev) {
			var _i, _i$1, _r, _ref, _ref$1, bts, err$1, ev, importPath, k, msg, obj, pk, pkgs, pkgs$1, v, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _ref = $f._ref; _ref$1 = $f._ref$1; bts = $f.bts; err$1 = $f.err$1; ev = $f.ev; importPath = $f.importPath; k = $f.k; msg = $f.msg; obj = $f.obj; pk = $f.pk; pkgs = $f.pkgs; pkgs$1 = $f.pkgs$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			msg = [msg];
			bts = $internalize(ev.data, $String);
			msg[0] = new Message.ptr("", "");
			_r = json.Unmarshal((new sliceType($stringToBytes(bts))), msg[0]); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			err$1 = _r;
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				$panic(err$1);
			}
			if (msg[0].Name === "") {
				$panic(new $String("empty message name"));
			}
			if (msg[0].Name === "init") {
				pkgs = $global.eval($externalize(msg[0].Data, $String));
				$global._$packages = pkgs;
				$s = -1; return;
			}
			importPath = msg[0].Name;
			pkgs$1 = $global.eval($externalize(msg[0].Data, $String));
			obj = pkgs$1[$externalize(importPath, $String)];
			_ref = js.Keys(obj);
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				k = ((_i < 0 || _i >= _ref.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref.$array[_ref.$offset + _i]);
				v = obj[$externalize(k, $String)];
				if (!(v.prototype === undefined)) {
					_ref$1 = $append(js.Keys(v.prototype), "constructor");
					_i$1 = 0;
					while (true) {
						if (!(_i$1 < _ref$1.$length)) { break; }
						pk = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? ($throwRuntimeError("index out of range"), undefined) : _ref$1.$array[_ref$1.$offset + _i$1]);
						if (!(v.ptr === undefined) && !(v.ptr.prototype === undefined)) {
							$global._$packages[$externalize(importPath, $String)][$externalize(k, $String)].ptr.prototype[$externalize(pk, $String)] = v.ptr.prototype[$externalize(pk, $String)];
							$global._$packages[$externalize(importPath, $String)][$externalize(k, $String)].prototype[$externalize(pk, $String)] = v.prototype[$externalize(pk, $String)];
						} else {
							$global._$packages[$externalize(importPath, $String)][$externalize(k, $String)].prototype[$externalize(pk, $String)] = v.prototype[$externalize(pk, $String)];
						}
						_i$1++;
					}
					_i++;
					continue;
				}
				_i++;
			}
			hot.Publish(importPath);
			$s = -1; return;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._ref = _ref; $f._ref$1 = _ref$1; $f.bts = bts; $f.err$1 = err$1; $f.ev = ev; $f.importPath = importPath; $f.k = k; $f.msg = msg; $f.obj = obj; $f.pk = pk; $f.pkgs = pkgs; $f.pkgs$1 = pkgs$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
		}));
	};
	Message.init("", [{prop: "Data", name: "Data", anonymous: false, exported: true, typ: $String, tag: "json:\"data\""}, {prop: "Name", name: "Name", anonymous: false, exported: true, typ: $String, tag: "json:\"name\""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = json.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = websocketjs.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = hot.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if ($pkg === $mainPkg) {
			main();
			$mainFinished = true;
		}
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$synthesizeMethods();
var $mainPkg = $packages["github.com/marwan-at-work/hmr/frontend/runtime"];
$packages["runtime"].$init();
$go($mainPkg.$init, []);
$flushConsole();

}).call(this);
//# sourceMappingURL=runtime.js.map
