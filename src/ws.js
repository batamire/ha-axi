"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.wsCall = wsCall;
var axi_sdk_js_1 = require("axi-sdk-js");
function isRecord(v) {
    return typeof v === "object" && v !== null;
}
/**
 * Stateless one-shot WS bridge (contract #11/#15 scope): connect, auth hello,
 * ONE request/response pair by id, close. No subscriptions, no streaming.
 * Registries + statistics reads only.
 *
 * Prefers Node's native WebSocket global (Node >=22).
 */
function wsCall(cfg_1, type_1) {
    return __awaiter(this, arguments, void 0, function (cfg, type, payload) {
        function send(obj) {
            try {
                ws.send(JSON.stringify(obj));
            }
            catch (e) {
                finish(new axi_sdk_js_1.AxiError("WS send failed: ".concat(e.message), "CONNECTION_FAILED", []));
            }
        }
        var wsUrl, ws, _a, promise, resolve, reject, id, settled, finish, deadline;
        if (payload === void 0) { payload = {}; }
        return __generator(this, function (_b) {
            if (typeof globalThis.WebSocket !== "function") {
                throw new axi_sdk_js_1.AxiError("WebSocket bridge needs Node >=22 (native WebSocket global missing)", "UNKNOWN", ["upgrade Node to >=22"]);
            }
            wsUrl = "".concat(cfg.url.replace(/^http/, "ws"), "/api/websocket");
            ws = new WebSocket(wsUrl);
            _a = Promise.withResolvers(), promise = _a.promise, resolve = _a.resolve, reject = _a.reject;
            id = 0;
            settled = false;
            finish = function (err, value) {
                if (settled)
                    return;
                settled = true;
                clearTimeout(deadline);
                try {
                    ws.close();
                }
                catch (_a) {
                    // already closed
                }
                if (err)
                    reject(err);
                else
                    resolve(value);
            };
            deadline = setTimeout(function () {
                finish(new axi_sdk_js_1.AxiError("WS bridge timed out calling '".concat(type, "'"), "CONNECTION_FAILED", []));
            }, cfg.timeoutMs);
            ws.addEventListener("message", function (ev) {
                var _a, _b;
                var msg;
                try {
                    var parsed = JSON.parse(String(ev.data));
                    if (!isRecord(parsed))
                        return;
                    msg = parsed;
                }
                catch (_c) {
                    return;
                }
                switch (msg.type) {
                    case "auth_required":
                        send({ id: ++id, type: "auth", access_token: cfg.token });
                        break;
                    case "auth_invalid":
                        finish(new axi_sdk_js_1.AxiError("Authentication failed (WS)", "AUTH_INVALID", [
                            "check that the long-lived access token is valid",
                        ]));
                        break;
                    case "auth_ok":
                        send(__assign({ id: ++id, type: type }, payload));
                        break;
                    default:
                        if (msg.id === id && msg.type === "result") {
                            if (msg.success)
                                finish(null, msg.result);
                            else {
                                var err = (_a = msg.error) !== null && _a !== void 0 ? _a : {};
                                finish(new axi_sdk_js_1.AxiError("WS command '".concat(type, "' failed: ").concat((_b = err.message) !== null && _b !== void 0 ? _b : JSON.stringify(err)), err.code === "not_found" ? "NOT_FOUND" : "UPSTREAM_ERROR", []));
                            }
                        }
                }
            });
            ws.addEventListener("error", function () {
                finish(new axi_sdk_js_1.AxiError("Cannot reach Home Assistant over WebSocket", "CONNECTION_FAILED", []));
            });
            ws.addEventListener("close", function () {
                if (!settled) {
                    finish(new axi_sdk_js_1.AxiError("WebSocket closed before a result arrived", "CONNECTION_FAILED", []));
                }
            });
            return [2 /*return*/, promise];
        });
    });
}
