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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configPath = configPath;
exports.resolveConfig = resolveConfig;
var node_child_process_1 = require("node:child_process");
var promises_1 = require("node:fs/promises");
var node_os_1 = require("node:os");
var node_path_1 = require("node:path");
var smol_toml_1 = require("smol-toml");
var axi_sdk_js_1 = require("axi-sdk-js");
var execFileP = (0, node_child_process_1.promisify)(node_child_process_1.execFile);
function configPath(homeDir) {
    var base = process.env.XDG_CONFIG_HOME || (0, node_path_1.join)(homeDir !== null && homeDir !== void 0 ? homeDir : (0, node_os_1.homedir)(), ".config");
    return (0, node_path_1.join)(base, "ha-axi", "config.toml");
}
/** Warn once if the config file is group/world readable. */
function warnIfLoosePerms(path) {
    return __awaiter(this, void 0, void 0, function () {
        var st, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, promises_1.stat)(path)];
                case 1:
                    st = _b.sent();
                    // eslint-disable-next-line no-bitwise -- permission mask check
                    if ((st.mode & 63) !== 0) {
                        process.stderr.write("warning: ".concat(path, " is readable by group/others; run chmod 600 on it\n"));
                    }
                    return [3 /*break*/, 3];
                case 2:
                    _a = _b.sent();
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function readConfigFile(homeDir) {
    return __awaiter(this, void 0, void 0, function () {
        var path, text, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    path = configPath(homeDir);
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.readFile)(path, "utf-8")];
                case 2:
                    text = _b.sent();
                    return [3 /*break*/, 4];
                case 3:
                    _a = _b.sent();
                    return [2 /*return*/, {}];
                case 4: return [4 /*yield*/, warnIfLoosePerms(path)];
                case 5:
                    _b.sent();
                    try {
                        return [2 /*return*/, (0, smol_toml_1.parse)(text)];
                    }
                    catch (e) {
                        throw new axi_sdk_js_1.AxiError("Failed to parse ".concat(path, ": ").concat(e.message), "VALIDATION_ERROR", [
                            "fix the TOML syntax in the config file",
                        ]);
                    }
                    return [2 /*return*/];
            }
        });
    });
}
function pickDefaultProfileName(profiles) {
    if ("default" in profiles)
        return "default";
    return Object.keys(profiles)[0];
}
/** Execute a `token_cmd` and trim its stdout into the token. Never logged. */
function tokenFromCmd(cmd) {
    return __awaiter(this, void 0, void 0, function () {
        var stdout, token, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, execFileP(cmd, { shell: true })];
                case 1:
                    stdout = (_a.sent()).stdout;
                    token = stdout.trim();
                    if (!token)
                        throw new Error("empty output");
                    return [2 /*return*/, token];
                case 2:
                    e_1 = _a.sent();
                    throw new axi_sdk_js_1.AxiError("token_cmd failed: ".concat(e_1.message.split("\n")[0]), "AUTH_MISSING", ["check that the token_cmd runs non-interactively"]);
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Credential resolution, per contract #6:
 * flags > HASS_URL/HASS_TOKEN env > config profiles (--profile/-p; default =
 * profile named `default` or the first defined) > stdin token.
 */
function resolveConfig(flags_1) {
    return __awaiter(this, arguments, void 0, function (flags, opts) {
        var cfgFile, profiles, profileName, profile, url, token, hasLiteralToken, piped, _a, insecure;
        var _b, _c, _d, _e, _f, _g, _h;
        if (opts === void 0) { opts = {}; }
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0: return [4 /*yield*/, readConfigFile(opts.homeDir)];
                case 1:
                    cfgFile = _j.sent();
                    profiles = (_b = cfgFile.profiles) !== null && _b !== void 0 ? _b : {};
                    profileName = (_d = (_c = flags.profile) !== null && _c !== void 0 ? _c : pickDefaultProfileName(profiles)) !== null && _d !== void 0 ? _d : "default";
                    profile = profiles[profileName];
                    url = (_f = (_e = flags.url) !== null && _e !== void 0 ? _e : process.env.HASS_URL) !== null && _f !== void 0 ? _f : profile === null || profile === void 0 ? void 0 : profile.url;
                    token = (_g = flags.token) !== null && _g !== void 0 ? _g : process.env.HASS_TOKEN;
                    if (!url && !profile) {
                        throw new axi_sdk_js_1.AxiError("No Home Assistant connection configured", "AUTH_MISSING", [
                            "set HASS_URL and HASS_TOKEN",
                            "or add [profiles.".concat(profileName, "] with url/token to ").concat(configPath(opts.homeDir)),
                        ]);
                    }
                    if (!(!token && (profile === null || profile === void 0 ? void 0 : profile.token_cmd))) return [3 /*break*/, 3];
                    return [4 /*yield*/, tokenFromCmd(profile.token_cmd)];
                case 2:
                    token = _j.sent();
                    _j.label = 3;
                case 3:
                    hasLiteralToken = flags.token !== undefined ||
                        process.env.HASS_TOKEN !== undefined ||
                        (profile === null || profile === void 0 ? void 0 : profile.token) !== undefined ||
                        (profile === null || profile === void 0 ? void 0 : profile.token_cmd) !== undefined;
                    if (!(!token && !hasLiteralToken && !process.stdin.isTTY)) return [3 /*break*/, 7];
                    if (!(opts.stdin !== undefined)) return [3 /*break*/, 4];
                    _a = opts.stdin;
                    return [3 /*break*/, 6];
                case 4: return [4 /*yield*/, readStdin()];
                case 5:
                    _a = _j.sent();
                    _j.label = 6;
                case 6:
                    piped = _a;
                    if (piped === null || piped === void 0 ? void 0 : piped.trim())
                        token = piped.trim();
                    _j.label = 7;
                case 7:
                    if (!url) {
                        throw new axi_sdk_js_1.AxiError("No url for profile '".concat(profileName, "'"), "VALIDATION_ERROR", [
                            "set url in [profiles.".concat(profileName, "] or pass --url"),
                        ]);
                    }
                    if (!token) {
                        throw new axi_sdk_js_1.AxiError("No token for profile '".concat(profileName, "'"), "AUTH_MISSING", [
                            "set HASS_TOKEN",
                            "or set token/token_cmd in [profiles.".concat(profileName, "]"),
                            "or pipe a long-lived access token via stdin",
                        ]);
                    }
                    insecure = (profile === null || profile === void 0 ? void 0 : profile.insecure) === true;
                    if (insecure) {
                        // One-shot CLI process: disabling verification process-wide is safe here.
                        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
                        process.stderr.write("warning: TLS verification disabled (profile: ".concat(profileName, ")\n"));
                    }
                    return [2 /*return*/, {
                            url: url.replace(/\/+$/, ""),
                            token: token,
                            profile: profileName,
                            timeoutMs: ((_h = profile === null || profile === void 0 ? void 0 : profile.timeout) !== null && _h !== void 0 ? _h : 30) * 1000,
                            insecure: insecure,
                        }];
            }
        });
    });
}
function readStdin() {
    return __awaiter(this, void 0, void 0, function () {
        var chunks, _a, _b, _c, chunk, e_2_1;
        var _d, e_2, _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    chunks = [];
                    _g.label = 1;
                case 1:
                    _g.trys.push([1, 6, 7, 12]);
                    _a = true, _b = __asyncValues(process.stdin);
                    _g.label = 2;
                case 2: return [4 /*yield*/, _b.next()];
                case 3:
                    if (!(_c = _g.sent(), _d = _c.done, !_d)) return [3 /*break*/, 5];
                    _f = _c.value;
                    _a = false;
                    chunk = _f;
                    chunks.push(chunk);
                    _g.label = 4;
                case 4:
                    _a = true;
                    return [3 /*break*/, 2];
                case 5: return [3 /*break*/, 12];
                case 6:
                    e_2_1 = _g.sent();
                    e_2 = { error: e_2_1 };
                    return [3 /*break*/, 12];
                case 7:
                    _g.trys.push([7, , 10, 11]);
                    if (!(!_a && !_d && (_e = _b.return))) return [3 /*break*/, 9];
                    return [4 /*yield*/, _e.call(_b)];
                case 8:
                    _g.sent();
                    _g.label = 9;
                case 9: return [3 /*break*/, 11];
                case 10:
                    if (e_2) throw e_2.error;
                    return [7 /*endfinally*/];
                case 11: return [7 /*endfinally*/];
                case 12: return [2 /*return*/, Buffer.concat(chunks).toString("utf-8")];
            }
        });
    });
}
