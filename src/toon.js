"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRUNCATE_LIMIT = void 0;
exports.extract = extract;
exports.renderList = renderList;
exports.renderDetail = renderDetail;
exports.renderHelp = renderHelp;
exports.renderError = renderError;
exports.relTime = relTime;
exports.truncate = truncate;
var toon_1 = require("@toon-format/toon");
/** Pick a fixed field map off a source object (TOON field map extraction). */
function extract(item, fields) {
    var row = {};
    for (var _i = 0, fields_1 = fields; _i < fields_1.length; _i++) {
        var f = fields_1[_i];
        row[f] = item[f];
    }
    return row;
}
/** Encode a list of rows under a label key. */
function renderList(label, items) {
    var _a;
    return (0, toon_1.encode)((_a = {}, _a[label] = items, _a));
}
/** Encode a single detail object. */
function renderDetail(detail) {
    return (0, toon_1.encode)(detail);
}
/** `help[N]:\n  <line>` block per the #5 prototype shape. */
function renderHelp(lines) {
    if (lines.length === 0)
        return "";
    return "help[".concat(lines.length, "]:\n  ").concat(lines.join("\n  "));
}
/** Structured error: TOON `{error, code}` + optional help block. */
function renderError(message, code, suggestions) {
    var body = (0, toon_1.encode)({ error: message, code: code });
    var help = suggestions && suggestions.length > 0 ? "\n".concat(renderHelp(suggestions)) : "";
    return "".concat(body).concat(help);
}
/** Relative time: <60m → `Nm`, <24h → `Nh`, else `Nd`. */
function relTime(iso, now) {
    if (now === void 0) { now = Date.now(); }
    var diffMin = Math.floor((now - new Date(iso).getTime()) / 60000);
    if (diffMin < 60)
        return "".concat(Math.max(diffMin, 0), "m");
    if (diffMin < 1440)
        return "".concat(Math.floor(diffMin / 60), "h");
    return "".concat(Math.floor(diffMin / 1440), "d");
}
exports.TRUNCATE_LIMIT = 8000;
/**
 * Truncate long field values to the first 8000 chars plus an explicit
 * marker naming what was cut and how to get it back.
 */
function truncate(value, max) {
    if (max === void 0) { max = exports.TRUNCATE_LIMIT; }
    if (typeof value !== "string" || value.length <= max)
        return value;
    var cut = value.length - max;
    return "".concat(value.slice(0, max), "... [truncated ").concat(cut, " chars, use --full]");
}
