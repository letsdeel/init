'use strict';
require('axios/lib/core/createError');
const fs = require('fs');
const async_hooks = require('async_hooks');
const AWS = require('aws-sdk');

try {
    Object.assign(process.env, Object.assign(JSON.parse(fs.readFileSync('/var/secrets/secrets.json', 'utf8')), process.env));
} catch (err) {
    if (err.code != 'ENOENT') throw err;
}

global.__DEV__ = process.env.NODE_ENV == 'development';
global.log = require('pino')({
    level: String(process.env.LOG_LEVEL || 'info').toLowerCase(),
    formatters: {level: (level) => ({level: level.toUpperCase()})},
    messageKey: 'message',
    mixin: () => ({
        requestId: process.env.ASYNC_CONTEXT ? global.asyncContext?.requestId : global.currentContext?.requestId,
        cronTask: process.env.ASYNC_CONTEXT ? global.asyncContext?.cronTask : global.currentContext?.cronTask,
    }),
    base: undefined,
});

AWS.config.logger = {log: (log) => global.log.info(log)};

if (process.env.S3_ENDPOINT) AWS.config.update({endpoint: new AWS.Endpoint(process.env.S3_ENDPOINT), s3ForcePathStyle: true, signatureVersion: 'v4'});

if (process.env.ASYNC_CONTEXT) {
    const context = new async_hooks.AsyncLocalStorage();
    Object.defineProperty(global, 'asyncContext', {get: () => context.getStore() || context.run.bind(context)});
} else {
    const contexts = {};

    async_hooks
        .createHook({
            init: (asyncId, type, triggerAsyncId) => contexts[triggerAsyncId] && (contexts[asyncId] = contexts[triggerAsyncId]),
            destroy: (asyncId) => delete contexts[asyncId],
        })
        .enable();

    Object.defineProperty(global, 'currentContext', {
        get() {
            const asyncId = async_hooks.executionAsyncId();
            return contexts[asyncId] || (contexts[asyncId] = {});
        },
    });
}

if (process.env.DD_TRACE_ENABLED) global.tracer = require('dd-trace').init();
if (process.env.LIGHTRUN_SECRET) {
    require('lightrun').start({
        lightrunSecret: process.env.LIGHTRUN_SECRET,
        metadata: {
            registration: {
                displayName: process.env.DD_SERVICE,
                tags: [process.env.DD_ENV],
            },
        },
    });
}

global.Sentry = require('@sentry/node');

process.on('uncaughtException', (err, origin) => {
    err.origin = origin;
    Sentry.captureException(err);
    log.fatal(err);
    process.exit(1);
});

for (const m of module.children) {
    if (!m.filename.endsWith('node_modules/axios/lib/core/createError.js')) continue;
    const enhanceError = require('axios/lib/core/enhanceError');
    m.exports = function createError(message, config, code, request, response) {
        const error = enhanceError(new Error(message), config, code, request, response);
        Error.captureStackTrace(error, createError);
        return error;
    };
    break;
}
