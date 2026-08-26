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
exports.TOP_HELP = exports.DESCRIPTION = void 0;
exports.parseGlobalFlags = parseGlobalFlags;
exports.main = main;
var axi_sdk_js_1 = require("axi-sdk-js");
var toon_1 = require("@toon-format/toon");
var version_js_1 = require("./version.js");
var config_js_1 = require("./config.js");
var ha_js_1 = require("./ha.js");
var toon_js_1 = require("./toon.js");
exports.DESCRIPTION = "Agent control for Home Assistant without an MCP server";
// Planned commands are advertised up front so agents can discover the surface;
// each carries a "(planned)" marker until its slice lands.
exports.TOP_HELP = (0, toon_1.encode)({
    usage: "ha-axi <command> [args] [flags]",
    description: exports.DESCRIPTION,
    commands: {
        ping: "Liveness + auth probe (`{ok, profile, version, latency_ms}`)",
        entity: "(planned) List and inspect entities",
        service: "(planned) List services; call them behind safety gates",
        template: "(planned) Render a Jinja2 template server-side",
        history: "(planned) State timelines per entity",
        logbook: "(planned) Human-readable event stream",
        area: "(planned) Area registry reads over the WS bridge",
        device: "(planned) Device registry reads over the WS bridge",
        statistics: "(planned) Recorder statistics over the WS bridge",
    },
    flags: {
        "--profile, -p": "Named connection profile from the config file",
        "--url": "Override Home Assistant URL",
        "--token": "Override long-lived access token",
        "--help": "Show help for a command",
        "--version": "Show version",
    },
    examples: ["ha-axi ping", "ha-axi -p bench ping"],
});
var PLANNED_COMMANDS = {
    entity: true,
    service: true,
    template: true,
    history: true,
    logbook: true,
    area: true,
    device: true,
    statistics: true,
};
/** Split global flags (--profile/-p/--url/--token, both spaced and = forms). */
function parseGlobalFlags(args) {
    var flags = {};
    var rest = [];
    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        var eq = arg.indexOf("=");
        var name_1 = eq === -1 ? arg : arg.slice(0, eq);
        var inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
        var takesValue = name_1 === "--profile" || name_1 === "-p" || name_1 === "--url" || name_1 === "--token";
        if (!takesValue) {
            rest.push(arg);
            continue;
        }
        var value = inlineValue !== null && inlineValue !== void 0 ? inlineValue : args[++i];
        if (value === undefined)
            throw new axi_sdk_js_1.AxiError("Missing value for ".concat(name_1), "VALIDATION_ERROR", []);
        if (name_1 === "--profile" || name_1 === "-p")
            flags.profile = value;
        else if (name_1 === "--url")
            flags.url = value;
        else
            flags.token = value;
    }
    return { flags: flags, rest: rest };
}
function pingCommand(args, ctx) {
    return __awaiter(this, void 0, void 0, function () {
        var cfg, ha, startedAt, config, version;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (args.length > 0) {
                        throw new axi_sdk_js_1.AxiError("Unexpected argument: ".concat(args[0]), "VALIDATION_ERROR", [
                            "Run `ha-axi ping --help` for usage",
                        ]);
                    }
                    return [4 /*yield*/, (0, config_js_1.resolveConfig)(ctx !== null && ctx !== void 0 ? ctx : {})];
                case 1:
                    cfg = _a.sent();
                    ha = new ha_js_1.HaClient(cfg);
                    startedAt = Date.now();
                    return [4 /*yield*/, ha.get("/api/")];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, ha.get("/api/config")];
                case 3:
                    config = (_a.sent());
                    version = typeof (config === null || config === void 0 ? void 0 : config.version) === "string" ? config.version : "unknown";
                    return [2 /*return*/, ((0, toon_1.encode)({
                            ok: true,
                            profile: cfg.profile,
                            version: version,
                            latency_ms: Date.now() - startedAt,
                        }) +
                            "\n" +
                            (0, toon_js_1.renderHelp)(["entity list for inventory"]))];
            }
        });
    });
}
function plannedCommand(name) {
    return function () {
        throw new axi_sdk_js_1.AxiError("".concat(name, " is not implemented yet"), "UNKNOWN", [
            "this verb lands in a later slice",
            "run `ha-axi ping` to verify connectivity meanwhile",
        ]);
    };
}
function formatError(error) {
    if (error instanceof axi_sdk_js_1.AxiError) {
        var code = error.code;
        var finalExit = code === "VALIDATION_ERROR" || code === "AUTH_MISSING" ? 2 : 1;
        var obj = { error: error.message, code: code };
        if (error.suggestions.length > 0)
            obj.help = error.suggestions;
        return { output: "".concat((0, toon_1.encode)(obj), "\n"), exitCode: finalExit };
    }
    var message = error instanceof Error ? error.message : String(error);
    return { output: "".concat((0, toon_1.encode)({ error: message, code: "UNKNOWN" }), "\n"), exitCode: 1 };
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var error_1, _a, output, exitCode;
        var _this = this;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, axi_sdk_js_1.runAxiCli)({
                            description: exports.DESCRIPTION,
                            version: version_js_1.VERSION,
                            topLevelHelp: "".concat(exports.TOP_HELP, "\n"),
                            commands: Object.fromEntries(Object.keys(PLANNED_COMMANDS).map(function (name) { return [name, plannedCommand(name)]; })),
                            home: function () { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                                return [2 /*return*/, exports.TOP_HELP];
                            }); }); },
                            getCommandHelp: function () { return null; },
                            formatError: formatError,
                        })];
                case 1:
                    _b.sent();
                    return [3 /*break*/, 3];
                case 2:
                    error_1 = _b.sent();
                    _a = formatError(error_1), output = _a.output, exitCode = _a.exitCode;
                    process.stdout.write(output);
                    process.exitCode = exitCode;
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
