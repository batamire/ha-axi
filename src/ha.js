"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HaClient = void 0;
exports.scrub = scrub;
var axi_sdk_js_1 = require("axi-sdk-js");
var CONNECT_TIMEOUT_MS = 5000;
var RETRY_DELAY_MS = 1000;
var HaClient = /** @class */ (function () {
    function HaClient(cfg) {
        this.cfg = cfg;
    }
    HaClient.prototype.get = function (path) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.request("GET", path)];
            });
        });
    };
    /** Mutations are NEVER retried (contract #6). */
    HaClient.prototype.post = function (path, body) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.request("POST", path, body)];
            });
        });
    };
    HaClient.prototype.request = function (method, path, body) {
        return __awaiter(this, void 0, void 0, function () {
            var attempt, out, e_1;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        attempt = function () { return __awaiter(_this, void 0, void 0, function () {
                            var controller, timer, res, text;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        controller = new AbortController();
                                        timer = setTimeout(function () { return controller.abort(); }, CONNECT_TIMEOUT_MS);
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, , 4, 5]);
                                        return [4 /*yield*/, fetch("".concat(this.cfg.url).concat(path), {
                                                method: method,
                                                signal: controller.signal,
                                                headers: {
                                                    Authorization: "Bearer ".concat(this.cfg.token),
                                                    "Content-Type": "application/json",
                                                },
                                                body: method === "POST" ? JSON.stringify(body !== null && body !== void 0 ? body : {}) : undefined,
                                            })];
                                    case 2:
                                        res = _a.sent();
                                        clearTimeout(timer);
                                        timer = setTimeout(function () { return controller.abort(); }, this.cfg.timeoutMs);
                                        return [4 /*yield*/, res.text()];
                                    case 3:
                                        text = _a.sent();
                                        return [2 /*return*/, { status: res.status, text: text }];
                                    case 4:
                                        clearTimeout(timer);
                                        return [7 /*endfinally*/];
                                    case 5: return [2 /*return*/];
                                }
                            });
                        }); };
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 6, , 7]);
                        return [4 /*yield*/, attempt()];
                    case 2:
                        out = _a.sent();
                        if (!(method === "GET" && out.status >= 500)) return [3 /*break*/, 5];
                        return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, RETRY_DELAY_MS); })];
                    case 3:
                        _a.sent();
                        return [4 /*yield*/, attempt()];
                    case 4:
                        out = _a.sent();
                        _a.label = 5;
                    case 5:
                        if (out.status < 200 || out.status >= 300)
                            throw this.httpError(out.status, out.text);
                        return [2 /*return*/, parseMaybeJson(out.text)];
                    case 6:
                        e_1 = _a.sent();
                        if (e_1 instanceof axi_sdk_js_1.AxiError)
                            throw e_1;
                        throw this.networkError(e_1);
                    case 7: return [2 /*return*/];
                }
            });
        });
    };
    HaClient.prototype.httpError = function (status, bodyText) {
        var detail = scrub(bodyText || "HTTP ".concat(status), this.cfg.token);
        switch (status) {
            case 401:
                return new axi_sdk_js_1.AxiError("Authentication failed: ".concat(detail), "AUTH_INVALID", [
                    "check that the long-lived access token is valid",
                    "run `ha-axi ping` to re-verify credentials",
                ]);
            case 404:
                return new axi_sdk_js_1.AxiError("Not found: ".concat(detail), "NOT_FOUND", []);
            case 400:
            case 422:
                return new axi_sdk_js_1.AxiError("Validation failed: ".concat(detail), "VALIDATION_ERROR", []);
            case 429:
                return new axi_sdk_js_1.AxiError("Rate limited by Home Assistant", "RATE_LIMITED", [
                    "retry after a short backoff",
                ]);
            default:
                if (status >= 500) {
                    return new axi_sdk_js_1.AxiError("Home Assistant error (".concat(status, "): ").concat(detail), "UPSTREAM_ERROR", [
                        "check the Home Assistant server logs",
                    ]);
                }
                return new axi_sdk_js_1.AxiError("Unexpected HTTP ".concat(status, ": ").concat(detail), "UNKNOWN", []);
        }
    };
    HaClient.prototype.networkError = function (err) {
        var msg = scrub(err.message || "connection failed", this.cfg.token);
        var timedOut = err.name === "AbortError" || /abort/i.test(msg);
        if (timedOut) {
            return new axi_sdk_js_1.AxiError("Connection to Home Assistant timed out: ".concat(msg), "CONNECTION_FAILED", [
                "check that the instance is reachable",
                "raise the profile `timeout` for slow links",
            ]);
        }
        var tls = /certificate|self-signed|unable to verify|TLS|SSL/i.test(msg);
        var suggestions = tls
            ? [
                "trust the certificate via NODE_EXTRA_CA_CERTS",
                "or set `insecure = true` on the profile",
            ]
            : ["check HASS_URL / profile url and that the instance is up"];
        return new axi_sdk_js_1.AxiError("Cannot reach Home Assistant: ".concat(msg), "CONNECTION_FAILED", suggestions);
    };
    return HaClient;
}());
exports.HaClient = HaClient;
function safeBody(res) {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, res.text()];
                case 1: return [2 /*return*/, _b.sent()];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, ""];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function parseMaybeJson(text) {
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch (_a) {
        return text;
    }
}
/** Tokens never appear anywhere in output — scrub them from any message. */
function scrub(message) {
    var secrets = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        secrets[_i - 1] = arguments[_i];
    }
    var out = message;
    for (var _a = 0, secrets_1 = secrets; _a < secrets_1.length; _a++) {
        var s = secrets_1[_a];
        if (s)
            out = out.split(s).join("[redacted]");
    }
    return out;
}
